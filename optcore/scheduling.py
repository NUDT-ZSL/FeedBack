"""带资源约束、release/deadline 与资源时间窗的排程求解。

求解流程：

1. 校验依赖引用（悬空依赖属于输入错误，在校验阶段抛出）；
2. Kahn 拓扑排序，就绪集合用优先队列按
   ``duration 降序、task_id 字典序`` 选取，即规定的列表调度优先级；
3. 不可行证明，两类彼此区分：

   * ``cycle``：依赖成环，DFS 三色标记给出环上 task_id 序列；
   * ``window_overload``：release/deadline/资源时间窗冲突。对每个资源，
     任务 t 的可行集合为 ``[E[t], deadline)`` 与资源可用时间窗的交集
     （``E[t]`` 是只考虑依赖链与 release 的最早可开始时刻，拓扑序 DP
     求得）。若某区间 ``[l,r)`` 完整覆盖了若干任务的可行集合，而这些
     任务的总时长超过该区间在资源上的可用时长，则不存在可行排法
     （Hall 型区间能量条件，是可靠的不可行证明）。

4. 列表调度：开始时间取 ``max(E 时刻, 资源时间线最早空隙)`` 且结束不
   晚于 deadline；
5. 在拓扑序上动态规划求一条最长依赖链作为关键路径。

``window_overload`` 判据是必要条件：报告的每个冲突都必然导致无解
（不会误报）；它不保证识别所有时间窗不可行实例（非抢占式单机时间窗
可行性本身是 NP 难问题），但覆盖 release/deadline/资源窗导致的常见
冲突，包括用户验收的双任务场景。
"""

from __future__ import annotations

import heapq
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from .errors import InvalidInputError
from .models import ScheduleResult, Task
from .validation import (
    normalize_resource_windows,
    normalize_tasks,
    validate_task_references,
)

# 不可行类型标识（写入 ScheduleResult.infeasibility_type，便于按类型断言）。
INFEASIBLE_CYCLE = "cycle"
INFEASIBLE_WINDOW_OVERLOAD = "window_overload"


def _build_adjacency(
    tasks: Sequence[Task],
) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
    """返回 (依赖图, 反向图)。

    依赖图 ``deps_of[t]`` 是 t 的前置集合；反向图 ``dependents[u]`` 是
    所有直接依赖 u 的任务。
    """
    deps_of: Dict[str, Set[str]] = {t.task_id: set(t.deps) for t in tasks}
    dependents: Dict[str, Set[str]] = {t.task_id: set() for t in tasks}
    for task in tasks:
        for dep in task.deps:
            dependents[dep].add(task.task_id)
    return deps_of, dependents


def find_cycle(tasks: Sequence[Task]) -> Optional[List[str]]:
    """返回依赖图中的一个环（环上 task_id 序列，首尾不重复）。

    用 DFS 三色标记定位后向边，再沿灰色栈回溯出具体环；无环返回 None。
    """
    deps_of, _dependents = _build_adjacency(tasks)
    WHITE, GRAY, BLACK = 0, 1, 2
    color: Dict[str, int] = {t.task_id: WHITE for t in tasks}
    stack: List[str] = []
    on_stack: Dict[str, int] = {}

    def dfs(node: str) -> Optional[List[str]]:
        color[node] = GRAY
        on_stack[node] = len(stack)
        stack.append(node)
        for nxt in sorted(deps_of[node]):
            if color[nxt] == WHITE:
                found = dfs(nxt)
                if found is not None:
                    return found
            elif color[nxt] == GRAY:
                start = on_stack[nxt]
                return stack[start:] + [nxt]
        stack.pop()
        del on_stack[node]
        color[node] = BLACK
        return None

    for tid in sorted(color):
        if color[tid] == WHITE:
            found = dfs(tid)
            if found is not None:
                return found
    return None


def find_resource_overlaps(
    assignments: Dict[str, Tuple[int, int]],
    tasks: Sequence[Task],
) -> List[Tuple[str, int, int, List[str]]]:
    """检查排程中同资源任务是否时间重叠。

    :returns: 冲突列表，每项为 ``(resource, start, end, [重叠的 task_id])``，
        按资源与开始时间排序。合法排程恒返回空列表。
    """
    by_resource: Dict[str, List[Tuple[int, int, str]]] = {}
    for task in tasks:
        if task.task_id not in assignments:
            continue
        start, end = assignments[task.task_id]
        by_resource.setdefault(task.resource, []).append(
            (start, end, task.task_id)
        )
    conflicts: List[Tuple[str, int, int, List[str]]] = []
    for resource in sorted(by_resource):
        spans = sorted(by_resource[resource])
        for i, (s1, e1, t1) in enumerate(spans):
            group = [t1]
            c_start, c_end = s1, e1
            for s2, e2, t2 in spans[i + 1:]:
                if s2 >= c_end:
                    break
                if s2 < e1:  # 半开区间 [start, end) 上的重叠
                    group.append(t2)
                    c_start = min(c_start, s2)
                    c_end = max(c_end, e2)
            if len(group) > 1:
                conflicts.append((resource, c_start, c_end, sorted(group)))
    return conflicts


def _earliest_starts(
    tasks: Sequence[Task],
    topo: Sequence[str],
    task_by_id: Dict[str, Task],
) -> Dict[str, int]:
    """只考虑 release 与依赖链的最早可开始时刻 ``E[t]``。

    ``E[t] = max(release[t], E[dep] + duration[dep])``，在拓扑序上 DP。
    忽略资源争用，因此是真正最早开始时间的下界。
    """
    earliest: Dict[str, int] = {}
    for tid in topo:
        task = task_by_id[tid]
        value = task.release
        for dep in task.deps:
            value = max(value, earliest[dep] + task_by_id[dep].duration)
        earliest[tid] = value
    return earliest


def _available_length(
    windows: Optional[Sequence[Tuple[int, int]]],
    left: int,
    right: int,
) -> int:
    """区间 [left,right) 与资源可用时间窗的交集总长度。

    ``windows`` 为 None 表示全天可用；区间不相交或为空时返回 0。
    """
    if right <= left:
        return 0
    if not windows:
        return right - left
    total = 0
    for start, end in windows:
        lo = max(left, start)
        hi = min(right, end)
        if hi > lo:
            total += hi - lo
    return total


def find_window_overloads(
    tasks: Sequence[Task],
    earliest: Dict[str, int],
    resource_windows: Dict[str, List[Tuple[int, int]]],
) -> List[Dict[str, Any]]:
    """检测 release/deadline/资源时间窗导致的不可行（区间能量条件）。

    对每个资源上的任务 t 定义有效可行区间 ``[E[t], H[t])``：

    * ``E[t]`` 是只考虑 release 与依赖链的最早开始时刻；
    * ``H[t] = deadline``（若给出），否则当资源只有有限时间窗时取
      最后一个窗的结束时刻（该时刻之后资源不可用），否则为无上界。

    任务 t 只能在资源可用窗与 ``[E[t], H[t])`` 的交集内执行。

    判据（Hall 型区间能量条件，不可行的充分条件，结论可靠）：

    1. 单任务：交集可用时长 < duration → 该任务无处可排；
    2. 区间聚合：对候选区间 ``[l,r)``，所有满足 ``E>=l 且 H<=r``
       的任务必须在该区间内执行，若其总时长超过该区间在资源上的
       可用时长则无解。

    候选边界取自任务的 E、deadline 以及资源窗端点，因为包含关系只在
    这些点上变化。该判据不保证识别全部时间窗不可行实例（非抢占式
    单机时间窗可行性本身是 NP 难的），未覆盖的情形由
    :func:`_exact_schedule` 精确搜索兜底。

    :returns: 冲突字典列表，字段为 resource/window/available/required/tasks。
    """
    by_resource: Dict[str, List[Task]] = {}
    for task in tasks:
        by_resource.setdefault(task.resource, []).append(task)

    conflicts: List[Dict[str, Any]] = []
    for resource in sorted(by_resource):
        res_tasks = by_resource[resource]
        windows = resource_windows.get(resource)
        last_window_end = windows[-1][1] if windows else None

        def effective_hi(task: Task) -> Optional[int]:
            if task.deadline is not None:
                return task.deadline
            return last_window_end  # None 表示无上界

        # 判据 1：单任务可行区间内不存在长度 >= duration 的连续可用段。
        for task in sorted(res_tasks, key=lambda t: t.task_id):
            e_t = earliest[task.task_id]
            hi = effective_hi(task)
            if hi is None:
                continue  # 无 deadline 且资源全天可用：单任务不可能无位可排
            if e_t >= hi:
                # release 不早于可用性的结束时刻：报告二者之间的不可达段。
                conflicts.append({
                    "resource": resource,
                    "window": [hi, e_t] if e_t > hi else [e_t, e_t],
                    "available": 0,
                    "required": task.duration,
                    "tasks": [task.task_id],
                })
                continue
            block = _largest_contiguous_block(windows, e_t, hi)
            if block < task.duration:
                conflicts.append({
                    "resource": resource,
                    "window": [e_t, hi],
                    "available": block,
                    "required": task.duration,
                    "tasks": [task.task_id],
                })

        # 判据 2：区间能量。左边界取任务 E 与资源窗起点，
        # 右边界取 deadline 与资源窗终点。
        bounded = [t for t in res_tasks if effective_hi(t) is not None]
        if not bounded:
            continue
        left_points = sorted({
            earliest[t.task_id] for t in bounded
        } | {start for start, _end in (windows or [])})
        right_points = sorted({
            effective_hi(t) for t in bounded  # type: ignore[arg-type]
        } | {end for _start, end in (windows or [])})
        for left in left_points:
            for right in right_points:
                if right <= left:
                    continue
                contained = [
                    t for t in bounded
                    if earliest[t.task_id] < effective_hi(t)
                    and earliest[t.task_id] >= left
                    and effective_hi(t) <= right
                ]
                if not contained:
                    continue
                required = sum(t.duration for t in contained)
                available = _available_length(windows, left, right)
                if required > available:
                    conflicts.append({
                        "resource": resource,
                        "window": [left, right],
                        "available": available,
                        "required": required,
                        "tasks": sorted(t.task_id for t in contained),
                    })

    # 去重（同一 (resource, window, tasks) 可能由多对边界重复触发），
    # 按资源、窗口、任务集合排序保证输出确定。
    seen: Set[Tuple[Any, ...]] = set()
    unique: List[Dict[str, Any]] = []
    for conflict in conflicts:
        key = (
            conflict["resource"],
            conflict["window"][0],
            conflict["window"][1],
            tuple(conflict["tasks"]),
        )
        if key not in seen:
            seen.add(key)
            unique.append(conflict)
    unique.sort(key=lambda c: (c["resource"], c["window"][0],
                               c["window"][1], tuple(c["tasks"])))
    return unique


def _critical_path(
    tasks: Sequence[Task],
    topo: Sequence[str],
    task_by_id: Dict[str, Task],
) -> List[str]:
    """在拓扑序上动态规划最长依赖链（按 duration 加权）。

    平局按 task_id 字典序确定前驱，保证结果确定。
    """
    longest: Dict[str, int] = {}
    predecessor: Dict[str, Optional[str]] = {}
    for tid in topo:
        task = task_by_id[tid]
        best_len = 0
        best_pred: Optional[str] = None
        for dep in sorted(task.deps):
            if longest[dep] > best_len or (
                longest[dep] == best_len
                and (best_pred is None or dep < best_pred)
            ):
                best_len = longest[dep]
                best_pred = dep
        longest[tid] = best_len + task.duration
        predecessor[tid] = best_pred

    if not longest:
        return []
    # 取链长最大的任务收尾，平局取 task_id 最小者，保证确定性。
    end_task = min(longest, key=lambda tid: (-longest[tid], tid))
    chain: List[str] = []
    cur: Optional[str] = end_task
    while cur is not None:
        chain.append(cur)
        cur = predecessor[cur]
    chain.reverse()
    return chain


def _topological_order(
    tasks: Sequence[Task],
    deps_of: Dict[str, Set[str]],
    dependents: Dict[str, Set[str]],
) -> List[str]:
    """Kahn 拓扑序（平局按 task_id 字典序）；仅对 DAG 调用。"""
    indegree = {tid: len(deps) for tid, deps in deps_of.items()}
    ready = sorted(tid for tid, deg in indegree.items() if deg == 0)
    order: List[str] = []
    while ready:
        tid = heapq.heappop(ready)
        order.append(tid)
        for nxt in sorted(dependents[tid]):
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                heapq.heappush(ready, nxt)
    return order


def _earliest_window_gap(
    intervals: Sequence[Tuple[int, int]],
    windows: Optional[Sequence[Tuple[int, int]]],
    earliest: int,
    duration: int,
) -> Optional[int]:
    """在资源忙区间与可用时间窗双重约束下找最早可插入时刻。

    :param intervals: 同资源已排的 ``(start, end)``。
    :param windows: 合并排序后的可用窗；``None`` 表示全天可用。
    :returns: 最早开始时刻；所有时间窗都放不下时返回 None。
    """
    ordered = sorted(intervals)
    if not windows:
        cursor = earliest
        for start, end in ordered:
            if end <= cursor:
                continue
            if start >= cursor + duration:
                return cursor
            cursor = max(cursor, end)
        return cursor

    cursor = earliest
    for win_start, win_end in windows:
        if win_end <= cursor:
            continue
        candidate = max(cursor, win_start)
        for start, end in ordered:
            if end <= candidate:
                continue
            if start >= candidate + duration:
                break
            candidate = max(candidate, end)
        if candidate + duration <= win_end:
            return candidate
        cursor = win_end  # 本窗剩余长度不足，顺延到下一个时间窗
    return None


def _largest_contiguous_block(
    windows: Optional[Sequence[Tuple[int, int]]],
    left: int,
    right: int,
) -> int:
    """[left,right) 与可用窗交集的最长连续段长度。"""
    if not windows:
        return max(0, right - left)
    best = 0
    for start, end in windows:
        lo = max(left, start)
        hi = min(right, end)
        if hi > lo:
            best = max(best, hi - lo)
    return best


def _max_free_contiguous(
    busy: Sequence[Tuple[int, int]],
    windows: Optional[Sequence[Tuple[int, int]]],
    earliest: int,
    deadline: int,
) -> int:
    """在 ``[earliest, deadline)`` 内、可用窗之内且忙区间之外，求最长
    连续空闲段长度。``windows`` 为 None 表示全天可用。"""
    ordered = sorted(busy)

    def free_in_segment(lo: int, hi: int) -> int:
        if hi <= lo:
            return 0
        cursor = lo
        best = 0
        for start, end in ordered:
            if end <= cursor:
                continue
            if start >= hi:
                break
            best = max(best, min(start, hi) - cursor)
            cursor = max(cursor, end)
            if cursor >= hi:
                break
        return max(best, hi - cursor)

    if windows is None:
        return max(0, free_in_segment(earliest, deadline))
    best = 0
    for win_start, win_end in windows:
        if win_start >= deadline:
            break
        lo = max(win_start, earliest)
        hi = min(win_end, deadline)
        best = max(best, free_in_segment(lo, hi))
    return best


def _window_infeasible_result(
    conflicts: Sequence[Dict[str, Any]],
) -> ScheduleResult:
    """根据冲突时间窗构造 window_overload 不可行结果。"""
    reasons = [
        "[window_overload] 资源 {resource!s} 时间窗 [{w0}, {w1}) 内任务总时长 "
        "{required} 超过可用时长 {available}，涉及任务 {tasks}".format(
            resource=c["resource"],
            w0=c["window"][0],
            w1=c["window"][1],
            required=c["required"],
            available=c["available"],
            tasks=c["tasks"],
        )
        for c in conflicts
    ]
    return ScheduleResult(
        feasible=False,
        reasons=reasons,
        infeasibility_type=INFEASIBLE_WINDOW_OVERLOAD,
        window_conflicts=list(conflicts),
    )


def _exact_schedule(
    tasks: Sequence[Task],
    deps_of: Dict[str, Set[str]],
    dependents: Dict[str, Set[str]],
    task_by_id: Dict[str, Task],
    resource_windows: Dict[str, List[Tuple[int, int]]],
    node_limit: int = 200_000,
) -> Tuple[str, Optional[Dict[str, Tuple[int, int]]], List[Dict[str, Any]]]:
    """非抢占式精确调度（DFS 分支定界），用于启发式错过 deadline 时兜底。

    按就绪任务分支，每个任务放在其资源时间线上满足依赖/release/时间窗
    的最早位置，无法在 deadline 前放置即剪枝。

    :returns: ``("found", assignments, [])``、
        ``("infeasible", None, 冲突证明列表)`` 或
        ``("aborted", None, [])``（超过节点上限）。冲突证明取自一个失败
        叶节点：任务最早可开始时刻 s 到 deadline 的连续可用长度已不足
        duration，是可靠的单任务不可行证据。
    """
    state: Dict[str, Any] = {"nodes": 0, "aborted": False}
    assignments: Dict[str, Tuple[int, int]] = {}
    timelines: Dict[str, List[Tuple[int, int]]] = {}
    remaining: Dict[str, Set[str]] = {
        tid: set(deps) for tid, deps in deps_of.items()
    }
    proof: List[Dict[str, Any]] = []

    def ready_tasks() -> List[str]:
        return sorted(
            (tid for tid, deps in remaining.items() if not deps and tid not in assignments),
            key=lambda tid: (-task_by_id[tid].duration, tid),
        )

    def leaf_proof(ready: List[str]) -> List[Dict[str, Any]]:
        """从失败叶节点构造冲突条目。

        穷尽搜索本身已证明不可行；这里给出叶节点上的具体阻塞窗口：
        在当前部分排程下，任务最早可开始位置到 deadline 之间剩余的
        连续空闲且可用的长度已不足 duration。
        """
        certs: List[Dict[str, Any]] = []
        for tid in ready:
            task = task_by_id[tid]
            if task.deadline is None:
                continue
            earliest = task.release
            for dep in task.deps:
                earliest = max(earliest, assignments[dep][1])
            free_block = _max_free_contiguous(
                timelines.get(task.resource, []),
                resource_windows.get(task.resource),
                earliest,
                task.deadline,
            )
            if free_block < task.duration:
                certs.append({
                    "resource": task.resource,
                    "window": [earliest, task.deadline],
                    "available": free_block,
                    "required": task.duration,
                    "tasks": [tid],
                    "proven_by": "exhaustive_search",
                })
        return certs

    def dfs() -> bool:
        state["nodes"] += 1
        if state["nodes"] > node_limit:
            state["aborted"] = True
            return True
        ready = ready_tasks()
        if not ready:
            return len(assignments) == len(tasks)
        for tid in ready:
            task = task_by_id[tid]
            earliest = task.release
            for dep in task.deps:
                earliest = max(earliest, assignments[dep][1])
            start = _earliest_window_gap(
                timelines.setdefault(task.resource, []),
                resource_windows.get(task.resource),
                earliest,
                task.duration,
            )
            if start is None:
                continue
            end = start + task.duration
            if task.deadline is not None and end > task.deadline:
                continue
            assignments[tid] = (start, end)
            timelines[task.resource].append((start, end))
            changed: List[str] = []
            for nxt in dependents[tid]:
                if tid in remaining[nxt]:
                    remaining[nxt].discard(tid)
                    changed.append(nxt)
            if dfs():
                return True
            for nxt in changed:
                remaining[nxt].add(tid)
            timelines[task.resource].remove((start, end))
            del assignments[tid]
        # 当前就绪集合中无任何任务可放置 → 失败叶节点，留存证明。
        if not proof:
            proof.extend(leaf_proof(ready))
        return False

    found = dfs()
    if state["aborted"]:
        return "aborted", None, []
    if found:
        return "found", dict(assignments), []
    return "infeasible", None, proof


def schedule_tasks(
    tasks: Optional[Sequence[Any]] = None,
    resource_windows: Any = None,
) -> ScheduleResult:
    """列表调度求解。

    入参可以是 :class:`~optcore.models.Task` 或原始字典：``deps`` 缺省
    为空集，``release`` 缺省为 0，``resource`` 缺省为 ``"default"``，
    ``deadline`` 缺省为 None（无上界）。

    :param resource_windows: 两种形态都接受：

        * 原始资源登记列表（CLI/直接调用），元素为字符串或
          ``{"resource": "r", "windows": [[0, 10], [20, 30]]}``；
        * 已解析的 ``resource_id -> [(start, end), ...]`` 字典
          （求解器内部使用）。

        字符串条目或缺省表示该资源全天可用。

    :returns: 排程结果。两类不可行彼此区分：
        ``infeasibility_type="cycle"``（``cycle`` 字段给出环序列）或
        ``infeasibility_type="window_overload"``（``window_conflicts``
        给出冲突资源时间窗）。
    :raises InvalidInputError: 字段非法或 deps 指向不存在的任务。
    """
    norm_tasks: List[Task] = normalize_tasks(tasks)
    validate_task_references(norm_tasks)
    # resource_windows 既可以是原始登记列表（CLI/直接调用），也可以是
    # 求解器预先解析好的 resource -> windows 字典；统一成后者。
    if isinstance(resource_windows, dict):
        resource_windows = {
            rid: sorted((int(s), int(e)) for s, e in wins)
            for rid, wins in resource_windows.items()
        }
    else:
        resource_windows = normalize_resource_windows(resource_windows)

    if not norm_tasks:
        return ScheduleResult(
            assignments={}, makespan=0, critical_path=[], feasible=True
        )

    task_by_id = {t.task_id: t for t in norm_tasks}
    deps_of, dependents = _build_adjacency(norm_tasks)

    # 不可行证明 1：依赖成环（输出格式保持不变）。
    cycle = find_cycle(norm_tasks)
    if cycle is not None:
        return ScheduleResult(
            assignments={},
            makespan=0,
            critical_path=[],
            feasible=False,
            reasons=[f"任务依赖存在环: {' -> '.join(cycle)}"],
            cycle=cycle,
            infeasibility_type=INFEASIBLE_CYCLE,
        )

    topo = _topological_order(norm_tasks, deps_of, dependents)
    earliest_starts = _earliest_starts(norm_tasks, topo, task_by_id)

    # 不可行证明 2：release/deadline/资源时间窗的区间能量冲突。
    conflicts = find_window_overloads(
        norm_tasks, earliest_starts, resource_windows
    )
    if conflicts:
        result = _window_infeasible_result(conflicts)
        return result

    # 列表调度：duration 降序、task_id 字典序打破平局。
    remaining_deps: Dict[str, Set[str]] = {
        tid: set(deps) for tid, deps in deps_of.items()
    }
    ready: List[Tuple[int, str]] = []
    for task in norm_tasks:
        if not task.deps:
            heapq.heappush(ready, (-task.duration, task.task_id))

    assignments: Dict[str, Tuple[int, int]] = {}
    timelines: Dict[str, List[Tuple[int, int]]] = {}
    heuristic_ok = True

    while ready:
        _neg_dur, tid = heapq.heappop(ready)
        task = task_by_id[tid]
        earliest = task.release
        for dep in task.deps:
            earliest = max(earliest, assignments[dep][1])
        start = _earliest_window_gap(
            timelines.setdefault(task.resource, []),
            resource_windows.get(task.resource),
            earliest,
            task.duration,
        )
        if start is None or (
            task.deadline is not None and start + task.duration > task.deadline
        ):
            # 列表调度固定优先级，无法保证 deadline；停止启发式，
            # 交给精确搜索（可行方案可能只需要换一个任务顺序）。
            heuristic_ok = False
            break
        end = start + task.duration
        assignments[tid] = (start, end)
        timelines[task.resource].append((start, end))

        for nxt in sorted(dependents[tid]):
            remaining_deps[nxt].discard(tid)
            if not remaining_deps[nxt]:
                nxt_task = task_by_id[nxt]
                heapq.heappush(ready, (-nxt_task.duration, nxt))

    if not heuristic_ok or len(assignments) != len(norm_tasks):
        # 启发式未能满足时间窗/deadline：精确搜索判定到底可行与否。
        status, exact, proof = _exact_schedule(
            norm_tasks, deps_of, dependents, task_by_id, resource_windows
        )
        if status == "found":
            assignments = exact  # type: ignore[assignment]
        else:
            if status == "infeasible":
                if proof:
                    return _window_infeasible_result(proof)
                # 理论上不会发生（穷尽必有失败叶节点）；用区间能量兜底。
                conflicts = find_window_overloads(
                    norm_tasks, earliest_starts, resource_windows
                )
                if conflicts:
                    return _window_infeasible_result(conflicts)
            # 精确搜索超过节点上限：未能构造可行排法，也未能给出形式化
            # 证明；reason 中明确标注这一点，不伪装成已证明的不可行。
            return ScheduleResult(
                feasible=False,
                reasons=["[window_overload] 时间窗约束下精确搜索超过节点上限，"
                         "未能找到可行排法（不构成形式化不可行证明）"],
                infeasibility_type=INFEASIBLE_WINDOW_OVERLOAD,
            )

    makespan = max(end for _start, end in assignments.values())
    critical_path = _critical_path(norm_tasks, topo, task_by_id)

    result = ScheduleResult(
        assignments=assignments,
        makespan=makespan,
        critical_path=critical_path,
        feasible=True,
    )
    # 构造出的排程必须无资源冲突；若有则属于程序错误，显式暴露。
    overlaps = find_resource_overlaps(assignments, norm_tasks)
    if overlaps:
        raise InvalidInputError(
            f"内部错误：生成的排程存在资源重叠: {overlaps!r}"
        )
    return result
