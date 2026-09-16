"""结算引擎：状态维护、多来源发放与冲突、增量求解编排。

核心不变量
----------

- 品类必须先登记，商品行才能引用；行标识、券标识在各自集合内唯一。
- 每次修改状态的操作都是“先完整校验、后落库”：失败时引擎状态不变。
- 同一逻辑券的每次发放（:class:`Issue`）都保留；多来源参数矛盾生成
  :class:`ConflictRecord` 并冻结该券，绝不静默择一。
- 求解以“连通分量”为缓存单元：只有输入签名变化的分量才会重算，
  其余分量直接复用既有 :class:`Application` 对象；增量结果与从头求解逐字段一致，
  未受影响的抵扣连对象都不会重建。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from .errors import ConstraintViolation, ValidationError
from .explain import build_component_rejections, frozen_rejection, threshold_rejection
from .fingerprint import fingerprint
from .models import (
    NEUTRAL_SOURCE,
    NEUTRAL_VERSION,
    Application,
    Category,
    ComponentSnapshot,
    ConflictRecord,
    Coupon,
    CouponSpec,
    CouponStatus,
    Issue,
    OrderLine,
    RejectedCoupon,
    SolveResult,
    eligible_lines_for,
    spec_signature,
)
from .solver import ComponentSolution, _components, solve_component


@dataclass(frozen=True)
class ChangeReport:
    """一次券变更后的增量重算报告。"""

    action: str                                 # add / issue / revoke / revoke_issue / resolve
    coupon_id: str
    reused_components: Tuple[str, ...]
    recomputed_components: Tuple[str, ...]
    retired_components: Tuple[str, ...]
    total_discount_before_cents: Optional[int]
    total_discount_after_cents: Optional[int]
    unchanged_application_ids: Tuple[str, ...]  # 前后中选且 Application 对象原样复用
    new_application_ids: Tuple[str, ...]
    removed_application_ids: Tuple[str, ...]


class SettlementEngine:
    """券、订单、冲突与求解结果的容器。"""

    def __init__(self) -> None:
        self._categories: Dict[str, Category] = {}
        self._lines: Dict[str, OrderLine] = {}
        self._coupons: Dict[str, Coupon] = {}
        self._conflict_seq: int = 0
        # 分量输入签名 -> 分量求解结果（跨 solve 复用）。
        self._comp_cache: Dict[str, ComponentSolution] = {}
        self._last_result: Optional[SolveResult] = None
        self._prev_result: Optional[SolveResult] = None
        self._last_stats: Tuple[Tuple[str, ...], Tuple[str, ...], Tuple[str, ...]] = ((), (), ())

    # ------------------------------------------------------------------ 品类

    def register_category(self, category_id: str, name: str = "") -> Category:
        cat = Category.build(category_id, name)
        if cat.category_id in self._categories:
            raise ConstraintViolation(f"品类 {cat.category_id!r} 已登记", ["categories", cat.category_id])
        self._categories[cat.category_id] = cat
        return cat

    def categories(self) -> Tuple[Category, ...]:
        return tuple(self._categories[k] for k in sorted(self._categories))

    # ---------------------------------------------------------------- 订单行

    def set_order(self, lines: Sequence[OrderLine]) -> None:
        """整单替换；先做全部校验（含标识唯一、品类已登记），失败状态不变。"""
        if not isinstance(lines, (list, tuple)):
            raise ValidationError("订单行必须是列表", ["order", "lines"])
        seen: Dict[str, OrderLine] = {}
        for i, ln in enumerate(lines):
            if not isinstance(ln, OrderLine):
                raise ValidationError(f"第 {i} 项不是 OrderLine", ["order", "lines", i])
            if ln.category_id not in self._categories:
                raise ValidationError(
                    f"商品行 {ln.line_id!r} 引用了未登记品类 {ln.category_id!r}",
                    ["order", "lines", i, "category_id"],
                )
            if ln.line_id in seen:
                raise ValidationError(f"商品行标识重复: {ln.line_id!r}", ["order", "lines", i, "line_id"])
            if ln.line_total_cents != ln.unit_price_cents * ln.quantity:
                raise ValidationError(
                    f"商品行 {ln.line_id!r} 行总额与单价×数量不符", ["order", "lines", i]
                )
            seen[ln.line_id] = ln
        self._lines = dict(seen)

    def add_line(self, line: OrderLine) -> None:
        """追加一行；校验失败状态不变。"""
        if not isinstance(line, OrderLine):
            raise ValidationError("参数必须是 OrderLine", ["order", "lines"])
        if line.category_id not in self._categories:
            raise ValidationError(
                f"商品行 {line.line_id!r} 引用了未登记品类 {line.category_id!r}",
                [line.line_id, "category_id"],
            )
        if line.line_id in self._lines:
            raise ConstraintViolation(f"商品行标识重复: {line.line_id!r}", [line.line_id, "line_id"])
        self._lines[line.line_id] = line

    def remove_line(self, line_id: str) -> None:
        if line_id not in self._lines:
            raise ConstraintViolation(f"商品行不存在: {line_id!r}", ["order", "lines", line_id])
        del self._lines[line_id]

    def lines(self) -> Tuple[OrderLine, ...]:
        return tuple(self._lines[k] for k in sorted(self._lines))

    # ------------------------------------------------------------ 券的发放

    def issue_coupon(
        self,
        spec: CouponSpec,
        source: str = NEUTRAL_SOURCE,
        version: int = NEUTRAL_VERSION,
    ) -> Optional[ConflictRecord]:
        """登记/更新一次券发放（纯状态变更，不触发求解）。

        - 同一 ``coupon_id`` 可被不同来源各发放一次；同来源以更大 ``version`` 再次发放
          视为该来源更新参数。
        - 多来源参数完全一致 → 状态 SINGLE，不产生冲突。
        - 多来源参数矛盾 → 状态 CONFLICTED，生成/更新冲突记录并冻结该券，双方全保留。

        返回当前冲突记录（无冲突时为 ``None``）。校验失败时引擎状态不变。
        """
        if not isinstance(spec, CouponSpec):
            raise ValidationError("参数必须是 CouponSpec", ["coupons"])
        issue = Issue.build(source, version, spec)
        existing = self._coupons.get(spec.coupon_id)
        issues: List[Issue] = list(existing.issues) if existing else []

        same = [i for i, x in enumerate(issues) if x.source == issue.source]
        if same:
            idx = same[0]
            old = issues[idx]
            if old.version > issue.version:
                raise ConstraintViolation(
                    f"来源 {issue.source!r} 已发放版次 {old.version}，不能用更旧版次 {issue.version} 覆盖",
                    [spec.coupon_id, "issues", issue.source, "version"],
                )
            if old.version == issue.version and old.spec != spec:
                raise ConstraintViolation(
                    f"来源 {issue.source!r} 在同一版次 {version} 下给出了不同参数；同版次参数不可变更",
                    [spec.coupon_id, "issues", issue.source, "version"],
                )
            if old.version == version and old.spec == spec:
                return existing.conflict if existing else None  # 幂等重放
            issues[idx] = issue
        else:
            issues.append(issue)

        coupon, conflict = self._assemble_coupon(spec.coupon_id, issues, existing)
        self._coupons[spec.coupon_id] = coupon
        return conflict

    def add_coupon(self, spec: CouponSpec) -> ChangeReport:
        """以默认来源登记一张新券，并立即增量求解，返回增量报告。"""
        if spec.coupon_id in self._coupons:
            raise ConstraintViolation(
                f"券 {spec.coupon_id!r} 已存在；多来源发放请用 issue_coupon", [spec.coupon_id]
            )
        self.issue_coupon(spec)
        self.solve()
        return self.last_change_report("add", spec.coupon_id)

    def revoke_coupon(self, coupon_id: str) -> ChangeReport:
        """撤销整张逻辑券（含全部来源发放与冲突记录），并增量求解。"""
        if coupon_id not in self._coupons:
            raise ConstraintViolation(f"券不存在: {coupon_id!r}", ["coupons", coupon_id])
        del self._coupons[coupon_id]
        self.solve()
        return self.last_change_report("revoke", coupon_id)

    def revoke_issue(self, coupon_id: str, source: str) -> Optional[ConflictRecord]:
        """撤销某来源对某券的一次发放（纯状态变更）；最后一条发放被撤则整券消失。"""
        coupon = self._coupons.get(coupon_id)
        if coupon is None:
            raise ConstraintViolation(f"券不存在: {coupon_id!r}", ["coupons", coupon_id])
        remaining = [i for i in coupon.issues if i.source != source]
        if len(remaining) == len(coupon.issues):
            raise ConstraintViolation(
                f"来源 {source!r} 未发放过券 {coupon_id!r}", [coupon_id, "issues", source]
            )
        if not remaining:
            del self._coupons[coupon_id]
            return None
        rebuilt, conflict = self._assemble_coupon(coupon_id, remaining, coupon)
        self._coupons[coupon_id] = rebuilt
        return conflict

    def _assemble_coupon(
        self,
        coupon_id: str,
        issues: Sequence[Issue],
        previous: Optional[Coupon],
    ) -> Tuple[Coupon, Optional[ConflictRecord]]:
        """根据全部发放组装逻辑券，判定一致/冲突/裁决状态。"""
        issues = tuple(sorted(issues, key=lambda x: (x.source, x.version)))
        sigs = {spec_signature(i.spec) for i in issues}
        prior = previous.conflict if previous is not None else None

        if len(sigs) == 1:
            # 单一来源，或多来源参数完全一致：无冲突。
            return Coupon(coupon_id=coupon_id, issues=issues, status=CouponStatus.SINGLE), None

        # 参数矛盾。若此前已人工裁决且裁决来源仍在，则继续尊重该来源（含其新版参数）。
        resolved_source = prior.resolved_source if prior is not None else None
        if resolved_source is not None and any(i.source == resolved_source for i in issues):
            conflict = ConflictRecord(
                coupon_id=coupon_id,
                issues=issues,
                created_at_seq=prior.created_at_seq,
                resolved_source=resolved_source,
            )
            return (
                Coupon(coupon_id=coupon_id, issues=issues, status=CouponStatus.RESOLVED, conflict=conflict),
                conflict,
            )

        seq = prior.created_at_seq if prior is not None else self._next_conflict_seq()
        conflict = ConflictRecord(coupon_id=coupon_id, issues=issues, created_at_seq=seq)
        return (
            Coupon(coupon_id=coupon_id, issues=issues, status=CouponStatus.CONFLICTED, conflict=conflict),
            conflict,
        )

    def _next_conflict_seq(self) -> int:
        self._conflict_seq += 1
        return self._conflict_seq

    # ------------------------------------------------------------ 冲突裁决

    def resolve_conflict(self, coupon_id: str, source: str) -> ConflictRecord:
        """人工裁决：指定以某来源的参数为准。所有发放记录仍保留。"""
        coupon = self._coupons.get(coupon_id)
        if coupon is None:
            raise ConstraintViolation(f"券不存在: {coupon_id!r}", ["coupons", coupon_id])
        if coupon.conflict is None:
            raise ConstraintViolation(f"券 {coupon_id!r} 不存在冲突，无需裁决", [coupon_id, "conflict"])
        if not any(i.source == source for i in coupon.issues):
            raise ConstraintViolation(
                f"来源 {source!r} 未发放过券 {coupon_id!r}", [coupon_id, "resolved_source"]
            )
        conflict = coupon.conflict.with_resolution(source)
        self._coupons[coupon_id] = Coupon(
            coupon_id=coupon_id, issues=coupon.issues, status=CouponStatus.RESOLVED, conflict=conflict
        )
        return conflict

    def conflicts(self) -> Tuple[ConflictRecord, ...]:
        return tuple(c.conflict for c in self._coupons.values() if c.conflict is not None)

    def conflict(self, coupon_id: str) -> Optional[ConflictRecord]:
        coupon = self._coupons.get(coupon_id)
        return coupon.conflict if coupon else None

    def coupons(self, include_frozen: bool = True) -> Tuple[Coupon, ...]:
        out = [c for c in self._coupons.values() if include_frozen or c.active()]
        return tuple(sorted(out, key=lambda c: c.coupon_id))

    # ---------------------------------------------------------------- 求解

    def _active_specs(self) -> List[CouponSpec]:
        return [c.spec for c in self._coupons.values() if c.active()]

    def _order_fingerprint(self) -> str:
        return fingerprint(
            "order",
            [
                [ln.line_id, ln.category_id, ln.unit_price_cents, ln.quantity, ln.line_total_cents]
                for ln in self.lines()
            ],
        )

    def _coupon_fingerprint(self) -> str:
        payload = []
        for cid in sorted(self._coupons):
            c = self._coupons[cid]
            payload.append(
                [
                    cid,
                    c.status.value,
                    [[i.source, i.version, list(spec_signature(i.spec))] for i in c.issues],
                    c.conflict.resolved_source if c.conflict else None,
                ]
            )
        return fingerprint("coupons", payload)

    def _component_signature(self, comp_ids: Sequence[str], line_ids: Sequence[str]) -> str:
        specs_by_id = {c.coupon_id: c.spec for c in self._coupons.values() if c.active()}
        lines_by_id = self._lines
        payload = [
            "compinput",
            [[cid, list(spec_signature(specs_by_id[cid]))] for cid in sorted(comp_ids)],
            [
                [lid, lines_by_id[lid].category_id, lines_by_id[lid].line_total_cents]
                for lid in sorted(line_ids)
            ],
        ]
        return fingerprint("compinput", payload)

    def solve(self) -> SolveResult:
        """求当前订单与券面的最优方案。

        增量性：按连通分量签名命中缓存，未变化分量不重算、:class:`Application`
        原样复用；结果与“清空缓存从头求解”逐字段一致（由测试复核）。
        """
        previous = self._last_result
        specs = self._active_specs()
        specs_by_id = {s.coupon_id: s for s in specs}
        lines = self.lines()
        eligible = {cid: eligible_lines_for(specs_by_id[cid], lines) for cid in specs_by_id}

        threshold_fail = tuple(
            sorted(
                cid
                for cid, lst in eligible.items()
                if sum(ln.line_total_cents for ln in lst) < specs_by_id[cid].threshold_cents
            )
        )
        feasible_specs = [specs_by_id[cid] for cid in sorted(specs_by_id) if cid not in set(threshold_fail)]
        comps = _components(feasible_specs, eligible)

        old_keys = set(previous.component_keys) if previous else set()
        new_sigs: Dict[str, str] = {}
        applications: List[Application] = []
        rejected: List[RejectedCoupon] = []
        snapshots: List[ComponentSnapshot] = []
        reused_keys: List[str] = []
        recomputed_keys: List[str] = []
        total = 0

        for comp in comps:
            comp_line_set = sorted({ln.line_id for cid in comp for ln in eligible[cid]})
            sig = self._component_signature(comp, comp_line_set)
            comp_key = "|".join(comp)
            new_sigs[comp_key] = sig

            cached = self._comp_cache.get(sig)
            if cached is None:
                cached = solve_component(comp, feasible_specs, list(self._lines.values()))
                assert cached is not None  # 空集永远可行
                self._comp_cache[sig] = cached
                recomputed_keys.append(comp_key)
            else:
                reused_keys.append(comp_key)

            comp_rejected = build_component_rejections(cached, feasible_specs, list(self._lines.values()), eligible)
            snapshots.append(
                ComponentSnapshot(
                    component_key=comp_key,
                    coupon_ids=cached.coupon_ids,
                    line_ids=cached.line_ids,
                    applications=cached.applications,
                    rejected=comp_rejected,
                    total_discount_cents=cached.total_discount_cents,
                    fingerprint=sig,
                )
            )
            applications.extend(cached.applications)
            rejected.extend(comp_rejected)
            total += cached.total_discount_cents

        for cid in threshold_fail:
            rejected.append(threshold_rejection(specs_by_id[cid], eligible[cid]))
        frozen_ids = tuple(sorted(cid for cid, c in self._coupons.items() if not c.active()))
        for cid in frozen_ids:
            rejected.append(frozen_rejection(cid, self._coupons[cid].conflict))

        applications.sort(key=lambda a: a.coupon_id)
        rejected.sort(key=lambda r: r.coupon_id)

        order_fp = self._order_fingerprint()
        coupon_fp = self._coupon_fingerprint()
        result_fp = fingerprint(
            "result",
            [
                "result",
                order_fp,
                coupon_fp,
                [
                    [a.coupon_id, a.total_discount_cents, [[x.line_id, x.amount_cents] for x in a.allocations]]
                    for a in applications
                ],
                total,
            ],
        )
        result = SolveResult(
            applications=tuple(applications),
            rejected=tuple(rejected),
            total_discount_cents=total,
            eligible_coupon_ids=tuple(s.coupon_id for s in feasible_specs),
            frozen_coupon_ids=frozen_ids,
            component_keys=tuple(snap.component_key for snap in snapshots),
            component_fingerprints={snap.component_key: snap.fingerprint for snap in snapshots},
            fingerprint=result_fp,
            order_fingerprint=order_fp,
            coupon_fingerprint=coupon_fp,
        )

        retired_keys = tuple(sorted(old_keys - set(new_sigs)))
        self._prev_result = previous
        self._last_result = result
        self._last_stats = (
            tuple(sorted(reused_keys)),
            tuple(sorted(recomputed_keys)),
            retired_keys,
        )
        return result

    def last_change_report(self, action: str, coupon_id: str) -> ChangeReport:
        """对比最近一次 :meth:`solve` 前后的方案，生成增量报告。"""
        before = self._prev_result
        after = self._last_result
        reused, recomputed, retired = self._last_stats

        before_apps = {a.coupon_id: a for a in before.applications} if before else {}
        after_apps = {a.coupon_id: a for a in after.applications} if after else {}
        unchanged, new_ids, removed_ids = [], [], []
        for cid, app in after_apps.items():
            old = before_apps.get(cid)
            if old is not None and old is app:  # 同一对象：未受影响分量原样复用
                unchanged.append(cid)
            elif old is None:
                new_ids.append(cid)
        for cid in before_apps:
            if cid not in after_apps:
                removed_ids.append(cid)

        return ChangeReport(
            action=action,
            coupon_id=coupon_id,
            reused_components=reused,
            recomputed_components=recomputed,
            retired_components=retired,
            total_discount_before_cents=before.total_discount_cents if before else None,
            total_discount_after_cents=after.total_discount_cents if after else None,
            unchanged_application_ids=tuple(unchanged),
            new_application_ids=tuple(sorted(new_ids)),
            removed_application_ids=tuple(sorted(removed_ids)),
        )

    @property
    def last_result(self) -> Optional[SolveResult]:
        return self._last_result

    def solve_from_scratch(self) -> SolveResult:
        """清空分量缓存后重新求解（用于自检：结果必须与增量求解一致）。"""
        self._comp_cache = {}
        self._prev_result = self._last_result
        result = self.solve()
        return result

    # -------------------------------------------------------- 供持久化使用

    def _state_for_snapshot(self) -> dict:
        return {
            "categories": [
                {"category_id": c.category_id, "name": c.name} for c in self.categories()
            ],
            "lines": [
                {
                    "line_id": ln.line_id,
                    "category_id": ln.category_id,
                    "unit_price_cents": ln.unit_price_cents,
                    "quantity": ln.quantity,
                    "line_total_cents": ln.line_total_cents,
                }
                for ln in self.lines()
            ],
            "coupons": [_coupon_to_dict(self._coupons[cid]) for cid in sorted(self._coupons)],
            "conflict_seq": self._conflict_seq,
        }

    def _replace_state(self, other: "SettlementEngine") -> None:
        """整体替换内部状态（持久化载入在校验全部通过后调用）。"""
        self._categories = other._categories
        self._lines = other._lines
        self._coupons = other._coupons
        self._conflict_seq = other._conflict_seq
        self._comp_cache = other._comp_cache
        self._last_result = other._last_result
        self._prev_result = other._prev_result
        self._last_stats = other._last_stats


def _coupon_to_dict(coupon: Coupon) -> dict:
    return {
        "coupon_id": coupon.coupon_id,
        "status": coupon.status.value,
        "issues": [
            {"source": i.source, "version": i.version, "spec": _spec_to_dict(i.spec)}
            for i in coupon.issues
        ],
        "conflict": (
            {
                "created_at_seq": coupon.conflict.created_at_seq,
                "resolved_source": coupon.conflict.resolved_source,
            }
            if coupon.conflict is not None
            else None
        ),
    }


def _spec_to_dict(spec: CouponSpec) -> dict:
    return {
        "coupon_id": spec.coupon_id,
        "threshold_cents": spec.threshold_cents,
        "discount_cents": spec.discount_cents,
        "applicable_categories": sorted(spec.applicable_categories),
        "exclusive_group": spec.exclusive_group,
        "priority": spec.priority,
    }
