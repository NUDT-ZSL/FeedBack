"""确定性求解器。

目标（按字典序逐级优化）：
1. 未覆盖班次数最少（覆盖优先）；
2. 员工工时极差（最大工时 - 最小工时）最小；
3. 员工夜班数极差最小；
4. 按班次标识排序后的分配序列字典序最小（同分时按员工标识字典序打破平局）。

算法：先用确定性贪心得到一个可行解作为上界，再做带剪枝的深度优先搜索
（分支限界）。搜索顺序与比较规则完全确定，因此同一输入必然得到同一输出。
节点数超过上限时返回当前最优解（上限固定，结果依然确定）。
"""
from __future__ import annotations

from datetime import timedelta
from typing import Dict, List, Optional

from .models import Config, Employee, Shift

DEFAULT_NODE_CAP = 200_000


class _NodeCapExceeded(Exception):
    pass


def conflict_code(a: Shift, b: Shift, min_rest_minutes: int) -> Optional[str]:
    """同一员工承担 a、b 两个班次时的冲突类型：'overlap' / 'rest' / None。"""
    if a.start < b.end and b.start < a.end:
        return "overlap"
    rest = timedelta(minutes=min_rest_minutes)
    if b.end <= a.start and a.start - b.end < rest:
        return "rest"
    if a.end <= b.start and b.start - a.end < rest:
        return "rest"
    return None


def solve(
    shifts: Dict[str, Shift],
    employees: Dict[str, Employee],
    config: Config,
    locked: Optional[Dict[str, str]] = None,
    node_cap: int = DEFAULT_NODE_CAP,
) -> Dict[str, Optional[str]]:
    """求解排班。返回 {班次id: 员工id 或 None（未覆盖）}，包含 locked 班次。

    locked: 必须保持不变的既有分配（调用方保证其满足全部硬约束）。
    """
    locked = dict(locked or {})
    emp_ids = sorted(employees)
    night_flag = {sid: config.is_night_shift(s.start, s.end) for sid, s in shifts.items()}

    result: Dict[str, Optional[str]] = {sid: None for sid in shifts}
    minutes = {e: 0 for e in emp_ids}
    nights = {e: 0 for e in emp_ids}
    assigned: Dict[str, List[Shift]] = {e: [] for e in emp_ids}
    for sid, eid in locked.items():
        s = shifts[sid]
        result[sid] = eid
        minutes[eid] += s.duration_minutes
        nights[eid] += 1 if night_flag[sid] else 0
        assigned[eid].append(s)

    free = [s for sid, s in shifts.items() if sid not in locked]
    # 静态候选：技能覆盖 + 可用时段包含班次（与分配状态无关的部分）
    cand: Dict[str, List[str]] = {}
    for s in free:
        cand[s.id] = [
            e
            for e in emp_ids
            if employees[e].skills >= s.required_skills
            and employees[e].is_available_for(s.start, s.end)
        ]
    # 候选最少的班次优先，其次按开始时刻与标识，保证搜索顺序确定
    order = sorted(free, key=lambda s: (len(cand[s.id]), s.start, s.id))
    all_sids = sorted(shifts)

    def hours_range() -> int:
        vals = list(minutes.values())
        return max(vals) - min(vals) if vals else 0

    def nights_range() -> int:
        vals = list(nights.values())
        return max(vals) - min(vals) if vals else 0

    def feasible(s: Shift, eid: str) -> bool:
        e = employees[eid]
        if minutes[eid] + s.duration_minutes > e.max_minutes:
            return False
        return all(conflict_code(s, t, config.min_rest_minutes) is None for t in assigned[eid])

    def signature(res: Dict[str, Optional[str]]) -> tuple:
        # 已覆盖 (0, 员工id) 排在未覆盖 (1, "") 之前：同分时优先覆盖排前的班次，
        # 覆盖相同员工时按员工标识字典序打破平局
        return tuple((1, "") if res[sid] is None else (0, res[sid]) for sid in all_sids)

    # ---- 贪心种子：按开始时刻依次分配当前工时最少（同分时标识最小）的员工 ----
    g_min = dict(minutes)
    g_assigned = {e: list(v) for e, v in assigned.items()}
    g_res = dict(result)
    g_unc = 0
    for s in sorted(free, key=lambda x: (x.start, x.id)):
        best_e = None
        for e in cand[s.id]:
            if g_min[e] + s.duration_minutes > employees[e].max_minutes:
                continue
            if any(conflict_code(s, t, config.min_rest_minutes) for t in g_assigned[e]):
                continue
            if best_e is None or (g_min[e], e) < (g_min[best_e], best_e):
                best_e = e
        if best_e is None:
            g_unc += 1
        else:
            g_res[s.id] = best_e
            g_min[best_e] += s.duration_minutes
            g_assigned[best_e].append(s)
    g_night = dict(nights)
    for sid, eid in g_res.items():
        if eid is not None and sid not in locked and night_flag[sid]:
            g_night[eid] += 1
    gv = list(g_min.values())
    gn = list(g_night.values())
    best_key = (g_unc, (max(gv) - min(gv)) if gv else 0, (max(gn) - min(gn)) if gn else 0, signature(g_res))
    best_assign: Dict[str, Optional[str]] = dict(g_res)

    # ---- 分支限界 ----
    state_unc = [0]
    nodes = [0]

    def dfs(i: int) -> None:
        nodes[0] += 1
        if nodes[0] > node_cap:
            raise _NodeCapExceeded
        # 剪枝：未覆盖数随分配单调不减；工时/夜班极差不具备单调性
        # （把班次分给当前最少的员工会缩小极差），不能用于剪枝
        if state_unc[0] > best_key[0]:
            return
        if i == len(order):
            key = (state_unc[0], hours_range(), nights_range(), signature(result))
            if key < best_key:
                best_key_update(key)
            return
        s = order[i]
        for e in sorted(cand[s.id], key=lambda e: (minutes[e], e)):
            if not feasible(s, e):
                continue
            result[s.id] = e
            minutes[e] += s.duration_minutes
            nights[e] += 1 if night_flag[s.id] else 0
            assigned[e].append(s)
            dfs(i + 1)
            assigned[e].pop()
            nights[e] -= 1 if night_flag[s.id] else 0
            minutes[e] -= s.duration_minutes
            result[s.id] = None
        state_unc[0] += 1
        dfs(i + 1)
        state_unc[0] -= 1

    def best_key_update(key) -> None:
        nonlocal best_key, best_assign
        best_key = key
        best_assign = dict(result)

    try:
        dfs(0)
    except _NodeCapExceeded:
        pass
    return best_assign
