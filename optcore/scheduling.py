"""带资源约束与 release 时间的排程求解。

求解流程：

1. 校验依赖引用（悬空依赖属于输入错误，在校验阶段抛出）；
2. Kahn 拓扑排序，就绪集合用优先队列按
   ``duration 降序、task_id 字典序`` 选取，即规定的列表调度优先级；
3. 每个任务的开始时间取 ``max(release, 所有前置结束时间)``，再在其
   资源时间线上寻找第一个容纳得下 ``duration`` 的空闲间隙；
4. 依赖成环时给出环上的 task_id 序列作为不可行证明；
5. 在拓扑序上动态规划求一条最长依赖链作为关键路径。

只要依赖是 DAG、duration 为正整数，资源串行 + release 约束下总可以把
任务排到有限时刻（资源数量无限、时间轴无限），因此排程的唯一不可行
来源是依赖成环。模块同时提供 :func:`find_resource_overlaps`，用于对
外部读入的排程做资源冲突校验（持久化往返一致性检查）。
"""

from __future__ import annotations

import heapq
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .errors import InvalidInputError
from .models import ScheduleResult, Task
from .validation import normalize_tasks, validate_task_references


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


def _earliest_gap(
    intervals: Sequence[Tuple[int, int]],
    earliest: int,
    duration: int,
) -> int:
    """在已排区间序列中找最早的可插入时刻。

    :param intervals: 同一资源上已排好的 ``(start, end)`` 列表（无序）。
    :param earliest: 允许的最早开始时刻。
    :param duration: 任务时长（正整数）。
    :returns: 新任务的最早开始时刻。
    """
    if not intervals:
        return earliest
    ordered = sorted(intervals)
    cursor = earliest
    for start, end in ordered:
        if end <= cursor:
            continue  # 整个区间在候选起点之前，无影响
        if start >= cursor + duration:
            return cursor  # cursor 到该区间开始之间有足够空隙
        cursor = max(cursor, end)  # 与区间重叠，顺延到区间结束
    return cursor


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


def schedule_tasks(
    tasks: Optional[Sequence[Any]] = None,
    resources: Optional[Sequence[Any]] = None,  # noqa: ARG001 (登记用，见下)
) -> ScheduleResult:
    """列表调度求解。

    入参可以是 :class:`~optcore.models.Task` 或原始字典（``deps`` 缺省
    为空集，``release`` 缺省为 0，``resource`` 缺省为 ``"default"``）。
    ``resources`` 仅作显式登记，求解以任务中出现的资源为准（资源数量
    没有上限，每个资源是一条串行时间线）。

    :returns: 排程结果；依赖成环时 ``feasible=False`` 且 ``cycle`` 给出
        环上的 task_id 序列。
    :raises InvalidInputError: 字段非法或 deps 指向不存在的任务。
    """
    norm_tasks: List[Task] = normalize_tasks(tasks)
    validate_task_references(norm_tasks)

    if not norm_tasks:
        return ScheduleResult(
            assignments={}, makespan=0, critical_path=[], feasible=True
        )

    task_by_id = {t.task_id: t for t in norm_tasks}
    deps_of, dependents = _build_adjacency(norm_tasks)

    # 不可行证明：依赖成环。
    cycle = find_cycle(norm_tasks)
    if cycle is not None:
        return ScheduleResult(
            assignments={},
            makespan=0,
            critical_path=[],
            feasible=False,
            reasons=[f"任务依赖存在环: {' -> '.join(cycle)}"],
            cycle=cycle,
        )

    remaining_deps: Dict[str, Set[str]] = {
        tid: set(deps) for tid, deps in deps_of.items()
    }
    ready: List[Tuple[int, str]] = []
    for task in norm_tasks:
        if not task.deps:
            heapq.heappush(ready, (-task.duration, task.task_id))

    assignments: Dict[str, Tuple[int, int]] = {}
    timelines: Dict[str, List[Tuple[int, int]]] = {}
    topo: List[str] = []

    while ready:
        _neg_dur, tid = heapq.heappop(ready)
        task = task_by_id[tid]
        earliest = task.release
        for dep in task.deps:
            earliest = max(earliest, assignments[dep][1])
        start = _earliest_gap(
            timelines.setdefault(task.resource, []), earliest, task.duration
        )
        end = start + task.duration
        assignments[tid] = (start, end)
        timelines[task.resource].append((start, end))
        topo.append(tid)

        for nxt in sorted(dependents[tid]):
            remaining_deps[nxt].discard(tid)
            if not remaining_deps[nxt]:
                nxt_task = task_by_id[nxt]
                heapq.heappush(ready, (-nxt_task.duration, nxt))

    # 防御性检查：无环时所有任务都应被调度。
    if len(assignments) != len(norm_tasks):
        cycle = find_cycle(norm_tasks) or []
        return ScheduleResult(
            feasible=False,
            reasons=["内部错误：拓扑排序未覆盖全部任务"],
            cycle=cycle or None,
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
