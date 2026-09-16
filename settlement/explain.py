"""求解结果解释：结构化原因 + 可复现的中文文本。

解释完全由求解产物（:class:`SolveResult` / :class:`ComponentSolution`）与当时的
券面、订单状态派生，不重新做任何决策；反事实求解只用于回答“若强行使用某张未选券
会怎样”，其结果不会回写方案，因此解释与求解结果必然一致。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Mapping, Optional, Sequence, Tuple

from .models import (
    ConflictRecord,
    CouponSpec,
    OrderLine,
    RejectedCoupon,
    SolveResult,
)
from .money import format_yuan
from .solver import ComponentSolution, solve_component

# 未选原因码
THRESHOLD_NOT_MET = "threshold_not_met"     # 独占全部适用行仍不够门槛
FROZEN_CONFLICT = "frozen_conflict"         # 多来源参数冲突，已冻结
DOMINATED = "dominated"                     # 强行使用会降低总优惠
TIE_LEXICOGRAPHIC = "tie_lexicographic"     # 同额平局，标识字典序落败


@dataclass(frozen=True)
class HitLine:
    line_id: str
    category_id: str
    line_total_cents: int
    discount_cents: int


@dataclass(frozen=True)
class SelectedExplanation:
    coupon_id: str
    exclusive_group: Optional[str]
    priority: int
    threshold_cents: int
    discount_cents: int
    eligible_line_ids: Tuple[str, ...]
    eligible_total_cents: int
    hit_lines: Tuple[HitLine, ...]
    total_discount_cents: int

    def render(self) -> List[str]:
        head = (
            f"券 {self.coupon_id}：中选。额度 {format_yuan(self.discount_cents)} 元，"
            f"门槛 {format_yuan(self.threshold_cents)} 元"
            f"（适用行合计 {format_yuan(self.eligible_total_cents)} 元，达标）。"
        )
        group = f"互斥组 {self.exclusive_group}。" if self.exclusive_group else "无互斥组。"
        lines = [head + group]
        if self.hit_lines:
            lines.append("  命中商品行及抵扣：")
            for h in self.hit_lines:
                lines.append(
                    f"    - 行 {h.line_id}（品类 {h.category_id}，行额 "
                    f"{format_yuan(h.line_total_cents)} 元）→ 抵扣 "
                    f"{format_yuan(h.discount_cents)} 元"
                )
            lines.append(
                f"  本券合计抵扣 {format_yuan(self.total_discount_cents)} 元；"
                "各行抵扣按行额比例以最大余数法分摊，结果确定。"
            )
        else:
            lines.append("  未占有商品行（抵扣 0 元）。")
        return lines


@dataclass(frozen=True)
class Explanation:
    selected: Tuple[SelectedExplanation, ...]
    rejected: Tuple[RejectedCoupon, ...]
    total_discount_cents: int
    order_total_cents: int
    fingerprint: str
    frozen_coupon_ids: Tuple[str, ...]

    def render(self) -> str:
        return render_text(self)


# ---------------------------------------------------------------------------
# 未选原因（在求解阶段调用，以便直接随 SolveResult 持久化）
# ---------------------------------------------------------------------------

def threshold_rejection(spec: CouponSpec, eligible: Sequence[OrderLine]) -> RejectedCoupon:
    total = sum(ln.line_total_cents for ln in eligible)
    reason = (
        f"券 {spec.coupon_id} 未选用：即使独占其全部适用行，行额合计 "
        f"{format_yuan(total)} 元仍低于门槛 {format_yuan(spec.threshold_cents)} 元，"
        "在当前订单上永远不可用。"
    )
    return RejectedCoupon(
        coupon_id=spec.coupon_id,
        reason_code=THRESHOLD_NOT_MET,
        reason=reason,
        detail={
            "threshold_cents": spec.threshold_cents,
            "eligible_total_cents": total,
            "eligible_line_ids": [ln.line_id for ln in eligible],
        },
    )


def frozen_rejection(coupon_id: str, conflict: Optional[ConflictRecord]) -> RejectedCoupon:
    sources = [i.source for i in conflict.issues] if conflict else []
    reason = (
        f"券 {coupon_id} 未参与求解：该券被多个来源以互相矛盾的参数发放，"
        f"已按规则冻结（来源：{'、'.join(repr(s) for s in sources)}）。"
        "所有参数均保留在冲突记录中，需人工裁决后才会重新参与求解。"
    )
    return RejectedCoupon(
        coupon_id=coupon_id,
        reason_code=FROZEN_CONFLICT,
        reason=reason,
        detail={"sources": sources},
    )


def build_component_rejections(
    solution: ComponentSolution,
    all_specs: Sequence[CouponSpec],
    lines: Sequence[OrderLine],
    eligible: Mapping[str, List[OrderLine]],
) -> Tuple[RejectedCoupon, ...]:
    """对分量内未中选的券，用反事实精确求解给出落选原因。"""
    by_id = {s.coupon_id: s for s in all_specs}
    chosen_ids = tuple(a.coupon_id for a in solution.applications)
    chosen_set = set(chosen_ids)
    out: List[RejectedCoupon] = []

    selected_covered = {}
    for app in solution.applications:
        for lid in app.covered_lines():
            selected_covered.setdefault(lid, []).append(app.coupon_id)

    for cid in solution.coupon_ids:
        if cid in chosen_set:
            continue
        spec = by_id[cid]
        alt = solve_component(solution.coupon_ids, all_specs, lines, force_include=frozenset({cid}))
        # force_include 单券必可行（门槛已由上层过滤），做防御性判空。
        if alt is None:
            out.append(
                RejectedCoupon(
                    coupon_id=cid,
                    reason_code=DOMINATED,
                    reason=f"券 {cid} 无法与必要约束同时满足。",
                    detail={},
                )
            )
            continue
        alt_ids = tuple(a.coupon_id for a in alt.applications)
        related = sorted(
            {
                other
                for other in chosen_ids
                if by_id[other].exclusive_group is not None
                and by_id[other].exclusive_group == spec.exclusive_group
            }
            | {
                selected_covered[lid][0]
                for ln in eligible[cid]
                for lid in [ln.line_id]
                if lid in selected_covered
            }
        )
        if alt.total_discount_cents < solution.total_discount_cents:
            loss = solution.total_discount_cents - alt.total_discount_cents
            detail = {
                "optimal_total_cents": solution.total_discount_cents,
                "forced_total_cents": alt.total_discount_cents,
                "loss_cents": loss,
                "forced_selected_ids": list(alt_ids),
                "related_selected_ids": related,
            }
            reason = (
                f"券 {cid} 未选用：若强制使用它，该部分最优总优惠为 "
                f"{format_yuan(alt.total_discount_cents)} 元，比当前最优 "
                f"{format_yuan(solution.total_discount_cents)} 元少 "
                f"{format_yuan(loss)} 元。"
            )
            if related:
                reason += f"它与中选券 {'、'.join(related)} 存在互斥组或商品行竞争。"
            out.append(RejectedCoupon(cid, DOMINATED, reason, detail))
        else:
            detail = {
                "optimal_selected_ids": list(chosen_ids),
                "forced_selected_ids": list(alt_ids),
                "related_selected_ids": related,
            }
            reason = (
                f"券 {cid} 未选用：强制使用它时总优惠同为 "
                f"{format_yuan(solution.total_discount_cents)} 元，构成平局；"
                f"按券标识字典序，中选集合 {'、'.join(chosen_ids)} 优于包含 {cid} 的集合 "
                f"{'、'.join(alt_ids)}。"
            )
            out.append(RejectedCoupon(cid, TIE_LEXICOGRAPHIC, reason, detail))
    return tuple(sorted(out, key=lambda r: r.coupon_id))


# ---------------------------------------------------------------------------
# 整单解释
# ---------------------------------------------------------------------------

def explain(
    engine: "SettlementEngine-ish",  # noqa: F821 - 仅取其状态与 solve 产物
    result: Optional[SolveResult] = None,
) -> Explanation:
    """由引擎状态与求解结果生成解释。``result`` 缺省时取引擎最近一次求解结果。"""
    res = result if result is not None else engine.last_result
    if res is None:
        res = engine.solve()

    lines = {ln.line_id: ln for ln in engine.lines()}
    coupons = {cid: c for cid, c in engine._coupons.items()}
    specs = {cid: coupons[cid].spec for cid in coupons if coupons[cid].active()}

    selected: List[SelectedExplanation] = []
    for app in res.applications:
        spec = specs[app.coupon_id]
        hits = tuple(
            HitLine(
                line_id=a.line_id,
                category_id=lines[a.line_id].category_id,
                line_total_cents=lines[a.line_id].line_total_cents,
                discount_cents=a.amount_cents,
            )
            for a in app.allocations
        )
        selected.append(
            SelectedExplanation(
                coupon_id=app.coupon_id,
                exclusive_group=spec.exclusive_group,
                priority=spec.priority,
                threshold_cents=spec.threshold_cents,
                discount_cents=spec.discount_cents,
                eligible_line_ids=app.eligible_line_ids,
                eligible_total_cents=app.eligible_total_cents,
                hit_lines=hits,
                total_discount_cents=app.total_discount_cents,
            )
        )
    selected.sort(key=lambda x: x.coupon_id)

    order_total = sum(ln.line_total_cents for ln in lines.values())
    return Explanation(
        selected=tuple(selected),
        rejected=res.rejected,
        total_discount_cents=res.total_discount_cents,
        order_total_cents=order_total,
        fingerprint=res.fingerprint,
        frozen_coupon_ids=res.frozen_coupon_ids,
    )


def render_text(exp: Explanation) -> str:
    """渲染成可复现的中文验收文本。"""
    lines: List[str] = []
    lines.append("================ 结算方案解释 ================")
    lines.append(
        f"订单商品总额 {format_yuan(exp.order_total_cents)} 元；"
        f"最优总优惠 {format_yuan(exp.total_discount_cents)} 元；"
        f"优惠后应付 {format_yuan(max(0, exp.order_total_cents - exp.total_discount_cents))} 元。"
    )
    lines.append("")
    lines.append(f"【中选券 {len(exp.selected)} 张】")
    if not exp.selected:
        lines.append("  （无中选券）")
    for sx in exp.selected:
        lines.extend("  " + s for s in sx.render())
        lines.append("")
    lines.append(f"【未选候选券 {len(exp.rejected)} 张】")
    if not exp.rejected:
        lines.append("  （无其他候选券）")
    for r in exp.rejected:
        lines.append(f"  - {r.reason}")
    lines.append("")
    lines.append(
        "可复现性：本解释由确定性精确求解（总优惠最大、券标识字典序破平局）派生，"
        f"结果指纹 {exp.fingerprint}。"
    )
    return "\n".join(lines)
