"""一维分组装箱求解。

策略：

1. **分组聚合**：同一 ``group`` 的物品视为一个不可分割的“组物品”，
   尺寸为组内物品尺寸之和；
2. **下界**：``ceil(总尺寸 / 最大箱容量)``。注意分组数*不*构成
   下界——不同分组可以共享同一个箱子，约束只在于组不可拆分；
3. **FFD 启发式（group 合并）**：组按尺寸降序，依次放入第一个能容纳
   它的已开启箱子，放不下则开启新箱；
4. **分支定界验证**：若启发式用箱数严格大于下界，则用 DFS 分支定界
   搜索最优解（同负载/同容量对称剪枝、体积与大组下界、最优解截断）。
   展开节点数超过 :data:`NODE_LIMIT` 时停止并把 ``optimal`` 置为 False。
"""

from __future__ import annotations

import math
import sys
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .models import BinSpec, Item, PackingResult
from .validation import normalize_bins, normalize_items

EPS = 1e-9
NODE_LIMIT = 500_000

# B&B 搜索终止状态。
_FOUND = "found"
_EXHAUSTED = "exhausted"
_ABORTED = "aborted"


def _aggregate_groups(
    items: Sequence[Item],
) -> List[Tuple[str, float, List[str]]]:
    """把物品聚合成组。

    :returns: 元素为 ``(group, 总尺寸, 组内 item_id 列表)`` 的列表，
        按 group 首次出现顺序排列，组内 item_id 排序。
    """
    order: List[str] = []
    group_size: Dict[str, float] = {}
    group_items: Dict[str, List[str]] = {}
    for item in items:
        if item.group not in group_size:
            order.append(item.group)
            group_size[item.group] = 0.0
            group_items[item.group] = []
        group_size[item.group] += item.size
        group_items[item.group].append(item.item_id)
    return [
        (name, group_size[name], sorted(group_items[name])) for name in order
    ]


def _infeasible(
    reasons: List[str],
    lower_bound: int,
    oversized: Optional[List[str]] = None,
) -> PackingResult:
    """构造不可行结果。"""
    return PackingResult(
        bins={},
        used_bins=0,
        optimal=False,
        lower_bound=lower_bound,
        feasible=False,
        reasons=reasons,
        infeasible_groups=oversized or [],
    )


def _ffd_groups(
    groups: Sequence[Tuple[str, float, List[str]]],
    capacities: Sequence[float],
) -> Optional[List[int]]:
    """组级 FFD：返回每个组所在的箱子下标；无解返回 None。

    组按调用方给定顺序到达，先尝试已开启箱子（按开启先后），再开启
    第一个容量足够的空箱。
    """
    loads: List[float] = [0.0] * len(capacities)
    used: List[int] = []
    assignment: List[int] = [-1] * len(groups)
    for gi, (_name, size, _items) in enumerate(groups):
        for bi in used:
            if loads[bi] + size <= capacities[bi] + EPS:
                loads[bi] += size
                assignment[gi] = bi
                break
        else:
            for bi in range(len(capacities)):
                if loads[bi] == 0.0 and size <= capacities[bi] + EPS:
                    loads[bi] = size
                    used.append(bi)
                    assignment[gi] = bi
                    break
            else:
                return None
    return assignment


def _build_result(
    groups: Sequence[Tuple[str, float, List[str]]],
    bins: Sequence[BinSpec],
    assignment: Sequence[int],
    lower_bound: int,
    optimal: bool,
) -> PackingResult:
    """根据组→箱分配构造 PackingResult。"""
    bin_items: Dict[str, List[str]] = {}
    for gi, bin_index in enumerate(assignment):
        bin_id = bins[bin_index].bin_id
        bin_items.setdefault(bin_id, []).extend(groups[gi][2])
    for bin_id in bin_items:
        bin_items[bin_id].sort()
    return PackingResult(
        bins=bin_items,
        used_bins=len(bin_items),
        optimal=optimal,
        lower_bound=lower_bound,
        feasible=True,
    )


def _branch_and_bound(
    sizes: Sequence[float],
    capacities: Sequence[float],
    stop_at: int,
) -> Tuple[str, Optional[List[int]]]:
    """分支定界求用箱数严格小于 ``stop_at`` 的方案。

    组按 ``sizes`` 顺序依次放置；箱子容量异构（调用方按容量降序传入）。

    :returns: ``(状态, 分配)``；状态为

        * ``found``：找到用箱数 < stop_at 的方案；
        * ``exhausted``：穷举剪枝后不存在这样的方案；
        * ``aborted``：节点数超过 :data:`NODE_LIMIT`，未能判定。
    """
    n = len(sizes)
    m = len(capacities)
    cap_max = capacities[0]
    loads = [0.0] * m
    used_flag = [False] * m
    current = [-1] * n
    best_assign: Optional[List[int]] = None
    state = {"nodes": 0, "aborted": False}

    def node_bound(i: int, used_count: int) -> Optional[int]:
        """当前节点最终用箱数的乐观下界；判定此分支必不可行时返回 None。"""
        remaining = sizes[i:]
        # 已开启箱的总剩余容量装不下的部分，必须由新箱承担。
        residual_open = sum(
            capacities[bi] - loads[bi] for bi in range(m) if used_flag[bi]
        )
        rem_sum = sum(remaining)
        extra = 0
        if rem_sum > residual_open + EPS:
            extra = math.ceil((rem_sum - residual_open) / cap_max - EPS)

        # 大于最大箱容一半的组两两不能同箱，每个都要独占一个箱位。
        big = [g for g in remaining if g > cap_max / 2.0 + EPS]
        if big:
            open_slots = sorted(
                capacities[bi] - loads[bi]
                for bi in range(m)
                if used_flag[bi] and capacities[bi] - loads[bi] >= big[-1] - EPS
            )
            placed = 0
            slots = list(open_slots)
            for g in sorted(big, reverse=True):
                for k, slot in enumerate(slots):
                    if slot + EPS >= g:
                        slots.pop(k)
                        placed += 1
                        break
            extra = max(extra, len(big) - placed)

        # 存在任何箱子（开或不开）都装不下的组 → 分支不可行。
        for g in remaining:
            fit_open = any(
                used_flag[bi] and loads[bi] + g <= capacities[bi] + EPS
                for bi in range(m)
            )
            fit_empty = any(
                not used_flag[bi] and g <= capacities[bi] + EPS for bi in range(m)
            )
            if not fit_open and not fit_empty:
                return None
        return used_count + extra

    def dfs(i: int, used_count: int) -> bool:
        """返回 True 表示得到终止信号（找到更优解或节点超限）。"""
        nonlocal best_assign
        state["nodes"] += 1
        if state["nodes"] > NODE_LIMIT:
            state["aborted"] = True
            return True
        if used_count >= stop_at:
            return False
        if i == n:
            best_assign = list(current)
            return True
        bound = node_bound(i, used_count)
        if bound is None or bound >= stop_at:
            return False
        g = sizes[i]

        # 已开启箱候选：按剩余容量升序（best-fit 先走紧凑分支）；
        # (容量, 负载) 相同的箱子互为对称，只尝试一个。
        open_candidates = [
            bi
            for bi in range(m)
            if used_flag[bi] and loads[bi] + g <= capacities[bi] + EPS
        ]
        open_candidates.sort(key=lambda bi: (capacities[bi] - loads[bi], bi))
        candidates: List[int] = []
        seen_state: set = set()
        for bi in open_candidates:
            key = (round(capacities[bi], 12), round(loads[bi], 12))
            if key not in seen_state:
                seen_state.add(key)
                candidates.append(bi)

        # 空箱候选：同容量空箱彼此对称，每种容量只取当前下标最小的一个，
        # 且大容量优先（先试大箱可更早暴露装不下的分支）。
        first_empty_by_cap: Dict[float, int] = {}
        for bi in range(m):
            if not used_flag[bi] and g <= capacities[bi] + EPS:
                first_empty_by_cap.setdefault(capacities[bi], bi)
        candidates.extend(
            sorted(first_empty_by_cap.values(), key=lambda bi: (-capacities[bi], bi))
        )

        for bi in candidates:
            is_new = not used_flag[bi]
            loads[bi] += g
            if is_new:
                used_flag[bi] = True
            current[i] = bi
            stop = dfs(i + 1, used_count + (1 if is_new else 0))
            loads[bi] -= g
            if is_new:
                used_flag[bi] = False
            current[i] = -1
            if stop:
                return True
        return False

    sys.setrecursionlimit(max(1000, n * 4 + 100))
    dfs(0, 0)
    if state["aborted"]:
        return _ABORTED, None
    if best_assign is not None:
        return _FOUND, best_assign
    return _EXHAUSTED, None


def pack_items(
    items: Optional[Sequence[Any]] = None,
    bins: Optional[Sequence[Any]] = None,
) -> PackingResult:
    """求解分组一维装箱。

    入参既可以是已归一化的 :class:`~optcore.models.Item` /
    :class:`~optcore.models.BinSpec`，也可以是命令行风格的原始字典
    （``group`` 缺省为 ``"default"``，``bin_id`` 可自动生成）。

    :param items: 物品清单（同组物品不可拆箱）。
    :param bins: 可用箱子（容量可异构、数量有限）。
    :returns: 装箱结果；无解时 ``feasible=False`` 并在 ``reasons`` 中
        给出不可行证明（超限分组或组数多于箱数）。
    """
    norm_items: List[Item] = normalize_items(items)
    norm_bins: List[BinSpec] = normalize_bins(bins)

    if not norm_items:
        return PackingResult(bins={}, used_bins=0, optimal=True, lower_bound=0)

    groups = _aggregate_groups(norm_items)
    norm_bins = sorted(norm_bins, key=lambda b: (-b.capacity, b.bin_id))
    capacities = [b.capacity for b in norm_bins]
    total_size = sum(size for _name, size, _ids in groups)

    if not norm_bins:
        return _infeasible(
            ["未提供任何箱子，无法装箱"], lower_bound=len(groups)
        )

    cap_max = capacities[0]
    lower_bound = math.ceil(total_size / cap_max - EPS)

    # 不可行证明 1：存在任何箱子都装不下的分组。
    oversized = sorted(
        name for name, size, _ids in groups if size > cap_max + EPS
    )
    if oversized:
        return _infeasible(
            [f"分组 {oversized} 的总尺寸超过最大箱子容量 {cap_max:g}，无法装箱"],
            lower_bound,
            oversized,
        )

    # 不可行证明 1b：全部箱子的总容量都装不下全部物品。
    total_capacity = sum(capacities)
    if total_size > total_capacity + EPS:
        return _infeasible(
            [
                f"物品总体积 {total_size:g} 超过全部箱子总容量 {total_capacity:g}，"
                "无解"
            ],
            lower_bound,
        )

    # FFD 启发式（组按尺寸降序，平局按 group 字典序保证确定性）。
    order = [idx for idx, _g in sorted(
        enumerate(groups), key=lambda x: (-x[1][1], x[1][0])
    )]
    ordered_groups = [groups[idx] for idx in order]
    sizes = [g[1] for g in ordered_groups]

    heuristic = _ffd_groups(ordered_groups, capacities)
    if heuristic is None:
        # FFD 失败：分支定界先做纯粹的可行性判定。
        status, found = _branch_and_bound(sizes, capacities, len(norm_bins) + 1)
        if status == _EXHAUSTED:
            return _infeasible(
                ["穷举所有组分配（含对称剪枝）后仍无法装入全部箱子，故无解"],
                lower_bound,
            )
        if status == _ABORTED:
            return _infeasible(
                ["分支定界超过节点上限仍未找到可行装箱，无法判定可行性"],
                lower_bound,
            )
        heuristic = found

    best = heuristic
    heuristic_used = len(set(best))

    # 用分支定界逐次收紧上界，证明/改进启发式的最优性。
    optimal = True
    if heuristic_used > lower_bound:
        status, found = _branch_and_bound(sizes, capacities, heuristic_used)
        if status == _ABORTED:
            optimal = False
        elif status == _EXHAUSTED:
            optimal = True  # 不存在用箱更少的方案
        else:
            best = found
            # 继续向更低用箱数收紧，直到触达下界、穷尽或节点超限。
            while len(set(best)) > lower_bound:
                next_status, next_found = _branch_and_bound(
                    sizes, capacities, len(set(best))
                )
                if next_status == _FOUND:
                    best = next_found
                    continue
                optimal = next_status == _EXHAUSTED
                break
            else:
                optimal = True  # 已达到理论下界

    restored = [0] * len(groups)
    for pos, gi in enumerate(order):
        restored[gi] = best[pos]
    return _build_result(groups, norm_bins, restored, lower_bound, optimal)
