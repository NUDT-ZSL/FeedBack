"""结算求解器：在全部可行用券集合中求总优惠最大的方案。

语义（严格、可验收）
--------------------

给定一张券 c（门槛 T_c、额度 D_c、适用品类、互斥组 g_c）与订单行：

1. 券只能“命中”适用品类的商品行；
2. 一张中选券必须**整行占有**若干命中行 M：被占行商品额之和 ``sum(M) ≥ T_c``
   才算满足门槛；该行商品额同时承担抵扣，券实际抵扣
   ``min(D_c, sum(M))``；
3. 任意两行……任意商品行在整个方案中至多被一张券占有（不得重复抵扣）；
4. 同一互斥组至多中选一张券。

优化目标：总抵扣额最大；并列时按“中选券标识排序元组的字典序”取最小者；
再并列（同一中选集合、不同占行）时按本模块固定的行序搜索结果为准。
以上规则全部确定性，重复求解结果逐字节一致。

算法
----

- 券之间按“同互斥组 或 可命中行集合相交”连边，求连通分量；分量之间券、行互不
  相交，可独立精确求解后合并（平局规则在分量上的独立最优即全局最优）。
- 分量内按券标识排序做 DFS + 位掩码备忘录；每张券枚举的占行掩码只保留“紧致”
  掩码（删去任何一行就会门槛不足或抵扣下降），它们严格支配其他掩码。
- 单张券的抵扣额按行商品额做**最大余数法**分摊（份额按行额比例，余数按
  小数部分大者优先、并列按行标识），结果确定。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, FrozenSet, List, Mapping, Optional, Sequence, Tuple

from .models import (
    Application,
    CouponSpec,
    LineAllocation,
    OrderLine,
    eligible_lines_for,
)

# 分量规模保护：离线验收模块以正确性优先，超规模给出明确错误而非悄悄变慢。
MAX_COMPONENT_COUPONS = 20
MAX_COMPONENT_LINES = 22


class SolveLimitError(RuntimeError):
    """连通分量超过可精确求解的规模上限。"""


@dataclass(frozen=True)
class ComponentSolution:
    """单个连通分量的最优方案。"""

    coupon_ids: Tuple[str, ...]                # 分量内全部参与求解的券（标识序）
    line_ids: Tuple[str, ...]                  # 分量行宇宙（标识序）
    chosen: Tuple[Tuple[str, Tuple[str, ...]], ...]  # (券标识, 占行标识序列)
    applications: Tuple[Application, ...]
    total_discount_cents: int


@dataclass(frozen=True)
class SolveOutput:
    """整单纯求解输出（解释/指纹由上层组装）。"""

    solutions: Tuple[ComponentSolution, ...]
    applications: Tuple[Application, ...]
    rejected_threshold: Tuple[str, ...]        # 即便独占全部命中行也不够门槛
    candidates: Tuple[str, ...]                # 所有参与求解的券
    total_discount_cents: int


# ---------------------------------------------------------------------------
# 确定性分摊
# ---------------------------------------------------------------------------

def allocate_discount(
    line_ids: Sequence[str],
    line_totals: Mapping[str, int],
    discount_cents: int,
) -> Tuple[LineAllocation, ...]:
    """把 ``discount_cents`` 按行商品额比例、用最大余数法分摊到各行。

    每个分摊额不超过该行商品额；由于入参保证 discount ≤ 行额之和，最终分完。
    余数并列时按行标识字典序，保证确定性。
    """
    total = sum(line_totals[lid] for lid in line_ids)
    pool = min(discount_cents, total)
    if not line_ids or pool == 0:
        return tuple(LineAllocation(lid, 0) for lid in line_ids)

    floors: Dict[str, int] = {}
    remainders: List[Tuple[int, str]] = []  # (余数分子, 行标识)；比例基数统一为 total
    allocated = 0
    for lid in line_ids:
        scaled = pool * line_totals[lid]
        q, r = divmod(scaled, total)
        floors[lid] = q
        allocated += q
        remainders.append((r, lid))

    left = pool - allocated
    # 余数大者先补 1 分；并列按行标识升序。
    remainders.sort(key=lambda x: (-x[0], x[1]))
    for _, lid in remainders:
        if left <= 0:
            break
        if floors[lid] < line_totals[lid]:
            floors[lid] += 1
            left -= 1
    # 理论上不会有余下金额（pool ≤ 总额）；防御性兜底按行序补。
    idx = 0
    ordered = sorted(line_ids)
    while left > 0:
        lid = ordered[idx % len(ordered)]
        if floors[lid] < line_totals[lid]:
            floors[lid] += 1
            left -= 1
        idx += 1

    return tuple(LineAllocation(lid, floors[lid]) for lid in line_ids)


# ---------------------------------------------------------------------------
# 分量分解
# ---------------------------------------------------------------------------

def _components(
    specs: Sequence[CouponSpec],
    eligible: Mapping[str, List[OrderLine]],
) -> List[List[str]]:
    ids = sorted(s.coupon_id for s in specs)
    by_id = {s.coupon_id: s for s in specs}
    lines_of = {cid: frozenset(ln.line_id for ln in eligible[cid]) for cid in ids}

    parent = {cid: cid for cid in ids}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            # 以标识较小者为根，进一步保证过程确定。
            if ra < rb:
                parent[rb] = ra
            else:
                parent[ra] = rb

    # 互斥组连边。
    groups: Dict[str, List[str]] = {}
    for cid in ids:
        g = by_id[cid].exclusive_group
        if g is not None:
            groups.setdefault(g, []).append(cid)
    for members in groups.values():
        for other in members[1:]:
            union(members[0], other)

    # 命中行相交连边（用 行 -> 券列表 反查）。
    via_line: Dict[str, List[str]] = {}
    for cid in ids:
        for lid in lines_of[cid]:
            via_line.setdefault(lid, []).append(cid)
    for members in via_line.values():
        for other in members[1:]:
            union(members[0], other)

    buckets: Dict[str, List[str]] = {}
    for cid in ids:
        buckets.setdefault(find(cid), []).append(cid)
    comps = [sorted(v) for v in buckets.values()]
    comps.sort(key=lambda c: c[0])
    return comps


# ---------------------------------------------------------------------------
# 分量内精确求解
# ---------------------------------------------------------------------------

def _tight_masks(bits: Tuple[int, ...], weights: Mapping[int, int], threshold: int, discount: int) -> List[int]:
    """枚举可用行位集合中的“紧致占行掩码”。

    掩码 M 可行要求行额总和 ≥ 门槛；若删掉其中任意一行后仍可行且抵扣不下降，
    则 M 被严格支配（同样可行、同样抵扣、还多放出一行），直接剔除。

    ``bits`` 为可用位（按行标识升序）；用 take-first DFS 产出，顺序固定。
    """
    results: List[int] = []

    def dfs(pos: int, mask: int, total: int) -> None:
        if pos == len(bits):
            if total < threshold:
                return
            # 紧致性：删掉任一占入行都会导致门槛不足或抵扣下降。
            b = mask
            while b:
                low = b & -b
                rest_total = total - weights[low]
                if rest_total >= threshold and min(discount, rest_total) >= min(discount, total):
                    return  # 被支配
                b -= low
            results.append(mask)
            return
        bit = bits[pos]
        # 先取后舍：固定搜索顺序（也是占行平局时的裁决顺序）。
        dfs(pos + 1, mask | bit, total + weights[bit])
        dfs(pos + 1, mask, total)

    dfs(0, 0, 0)
    return results


@dataclass(frozen=True)
class _Best:
    value: int
    chosen: Tuple[Tuple[str, int], ...]  # (券标识, 占行掩码)


def _solve_component_exact(
    comp_ids: Sequence[str],
    by_id: Mapping[str, CouponSpec],
    comp_line_ids: Sequence[str],
    eligible_mask_of: Mapping[str, int],
    totals_by_bit: Mapping[int, int],
    force_include: FrozenSet[str] = frozenset(),
) -> Optional[_Best]:
    """分量内 DFS + 备忘录精确求解。

    返回 ``None`` 表示 ``force_include`` 无法满足。平局：总抵扣高者胜，
    再按中选券标识排序元组字典序（较短前缀优先）。
    """
    n = len(comp_ids)
    if n > MAX_COMPONENT_COUPONS or len(comp_line_ids) > MAX_COMPONENT_LINES:
        raise SolveLimitError(
            f"连通分量超出精确求解上限（券 {n}>{MAX_COMPONENT_COUPONS} 或 "
            f"行 {len(comp_line_ids)}>{MAX_COMPONENT_LINES}），首券 {comp_ids[0]!r}"
        )

    bit_of = {lid: 1 << i for i, lid in enumerate(comp_line_ids)}
    bits_sorted = tuple(bit_of[lid] for lid in comp_line_ids)  # 行标识升序

    # 互斥组 -> 位；每张券至多带一个互斥组位，同组两张券不能同时中选。
    group_names = sorted({g for cid in comp_ids if (g := by_id[cid].exclusive_group)})
    group_bit = {name: 1 << k for k, name in enumerate(group_names)}
    coupon_group_bit = {cid: (group_bit[g] if (g := by_id[cid].exclusive_group) else 0) for cid in comp_ids}

    memo: Dict[Tuple[int, int, int], Optional[_Best]] = {}

    def bits_tuple(mask_avail: int) -> Tuple[int, ...]:
        out: List[int] = []
        for b in bits_sorted:
            if mask_avail & b:
                out.append(b)
        return tuple(out)

    def better(a: Optional[_Best], b: Optional[_Best]) -> Optional[_Best]:
        if a is None:
            return b
        if b is None:
            return a
        if b.value != a.value:
            return b if b.value > a.value else a
        ka = tuple(cid for cid, _ in a.chosen)
        kb = tuple(cid for cid, _ in b.chosen)
        return b if kb < ka else a

    def dfs(i: int, available: int, used_groups: int) -> Optional[_Best]:
        if i == n:
            return _Best(0, ())
        key = (i, available, used_groups)
        if key in memo:
            return memo[key]

        cid = comp_ids[i]
        spec = by_id[cid]
        emask = eligible_mask_of[cid] & available

        # 先“不选”。
        best: Optional[_Best] = dfs(i + 1, available, used_groups)
        if cid in force_include:
            best = None  # 强制中选：不允许跳过

        my_group = coupon_group_bit[cid]
        if emask and not (my_group & used_groups):
            usable_bits = bits_tuple(emask)
            for mask in _tight_masks(usable_bits, totals_by_bit, spec.threshold_cents, spec.discount_cents):
                total_w = 0
                b = mask
                while b:
                    low = b & -b
                    total_w += totals_by_bit[low]
                    b -= low
                gain = min(spec.discount_cents, total_w)
                sub = dfs(i + 1, available & ~mask, used_groups | my_group)
                if sub is None:
                    continue
                cand = _Best(gain + sub.value, ((cid, mask),) + sub.chosen)
                best = better(best, cand)

        memo[key] = best
        return best

    best = dfs(0, (1 << len(comp_line_ids)) - 1, 0)
    if best is None:
        return None
    unknown = force_include - set(comp_ids)
    if unknown:
        return None
    return best


def solve_component(
    comp_ids: Sequence[str],
    specs: Sequence[CouponSpec],
    lines: Sequence[OrderLine],
    force_include: FrozenSet[str] = frozenset(),
) -> Optional[ComponentSolution]:
    """对指定券集合（视作一个分量）求解，供反事实解释复用。"""
    by_id = {s.coupon_id: s for s in specs}
    eligible = {cid: eligible_lines_for(by_id[cid], lines) for cid in comp_ids}
    line_set = sorted({ln.line_id for lst in eligible.values() for ln in lst})
    bit_of = {lid: 1 << i for i, lid in enumerate(line_set)}
    totals_by_bit = {bit_of[ln.line_id]: ln.line_total_cents for ln in lines if ln.line_id in bit_of}
    eligible_mask_of = {
        cid: sum(bit_of[ln.line_id] for ln in eligible[cid]) for cid in comp_ids
    }
    best = _solve_component_exact(
        tuple(sorted(comp_ids)), by_id, line_set, eligible_mask_of, totals_by_bit, force_include
    )
    if best is None:
        return None
    total_by_line = {ln.line_id: ln.line_total_cents for ln in lines}
    apps: List[Application] = []
    chosen_pairs: List[Tuple[str, Tuple[str, ...]]] = []
    for cid, mask in best.chosen:
        owned = tuple(lid for lid in line_set if mask & bit_of[lid])  # 已按行标识序
        alloc = allocate_discount(owned, total_by_line, by_id[cid].discount_cents)
        elig_ids = tuple(ln.line_id for ln in eligible[cid])
        apps.append(
            Application(
                coupon_id=cid,
                allocations=alloc,
                total_discount_cents=sum(a.amount_cents for a in alloc),
                eligible_line_ids=elig_ids,
                eligible_total_cents=sum(total_by_line[x] for x in elig_ids),
            )
        )
        chosen_pairs.append((cid, owned))
    apps.sort(key=lambda a: a.coupon_id)
    return ComponentSolution(
        coupon_ids=tuple(sorted(comp_ids)),
        line_ids=tuple(line_set),
        chosen=tuple(chosen_pairs),
        applications=tuple(apps),
        total_discount_cents=best.value,
    )


# ---------------------------------------------------------------------------
# 整单求解
# ---------------------------------------------------------------------------

def solve(specs: Sequence[CouponSpec], lines: Sequence[OrderLine]) -> SolveOutput:
    """对一组券参数与订单行精确求解。

    调用方需保证券标识唯一、行标识唯一、品类引用有效（引擎层负责）。
    永远不够门槛的券不进入搜索，直接列入 ``rejected_threshold``。
    """
    by_id = {s.coupon_id: s for s in specs}
    eligible: Dict[str, List[OrderLine]] = {
        s.coupon_id: eligible_lines_for(s, lines) for s in specs
    }
    total_by_line = {ln.line_id: ln.line_total_cents for ln in lines}

    always_bad = tuple(
        sorted(
            cid
            for cid, lst in eligible.items()
            if sum(ln.line_total_cents for ln in lst) < by_id[cid].threshold_cents
        )
    )
    feasible_specs = [by_id[cid] for cid in sorted(by_id) if cid not in set(always_bad)]

    solutions: List[ComponentSolution] = []
    applications: List[Application] = []
    total = 0
    for comp in _components(feasible_specs, eligible):
        sol = solve_component(comp, feasible_specs, lines)
        assert sol is not None  # 分量内不含强制券，空集永远可行
        solutions.append(sol)
        applications.extend(sol.applications)
        total += sol.total_discount_cents

    applications.sort(key=lambda a: a.coupon_id)
    return SolveOutput(
        solutions=tuple(solutions),
        applications=tuple(applications),
        rejected_threshold=always_bad,
        candidates=tuple(s.coupon_id for s in feasible_specs),
        total_discount_cents=total,
    )
