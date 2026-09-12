"""scheduler -- 拖拽落位与依赖联动排期引擎（纯标准库，可离线验收）。

时间模型
========
* 所有时间都是整数分钟，任务区间为半开 ``[start, start+duration)``。
* 日历 ``calendar`` 是若干 ``(start, end)`` 半开区间，区间之间允许重叠，
  重叠部分按可用处理（实际按并集语义）；空元组表示该资源全程不可用。

冲突三分类（:class:`ConflictKind`）
==================================
1. ``RESOURCE`` 资源占用：同一资源上并发任务数超过 ``capacity``。
2. ``CALENDAR`` 日历不可用：任务区间未被日历并集完全覆盖，冲突区间是
   请求区间内逐段连续的不可用缺口（可能多条），``obj_id`` 为资源 id。
3. ``DEPENDENCY`` 依赖顺序：
   - 前置任务 p（``p in task.deps``）结束晚于本任务起点；
   - 或本任务的后继任务 u（``task in u.deps``）起点早于本任务新终点。

确定性
======
所有对外列表都按稳定键排序（任务 ``(task_id, start)``，冲突
``(kind, obj_id, overlap_start, overlap_end)``）；内部遍历一律先
``sorted()``，不读取系统时间、不依赖 dict 遍历序。

apply_drop 的联动规则（实现前校验，失败零改动）
===============================================
* 先做图校验（自依赖/成环抛 :class:`CycleError`）、目标点日历覆盖校验
  和"不得早于前置结束"校验——这些是顺延（只能向右）无法修复的，
  违例直接抛 :class:`InfeasibleDropError`，状态逐字段不变。
* 通过后在*草稿*上做不动点修复：依赖后继必须 ``start >= end(前驱)``；
  资源超容时按 ``(start, task_id)`` 最大键确定性挑被顶走者向右推。
  每次推动都严格增大某个整数起点，迭代有上限（:data:`MAX_RIPPLE_ITERS`），
  不会无限递归。
* 顺延只沿依赖方向传播；需要推动 pinned 任务时该分支立即停止，pinned
  记入 ``blocked``：能把前一个任务干净地夹到 pinned 之前（结束恰好等于
  pinned 起点，且不早于其已被迫的下界）就夹，否则保留残余冲突、不再越过。
* 全部计算成功后才一次性提交并写入 undo 日志；任何异常都不留半改状态。

undo
====
线性 undo 栈。每个写操作（``apply_drop`` / ``update_calendar``）返回一个
:class:`UndoToken`；只有"当前栈顶"token 可撤销，过期或已消费的 token 抛
:class:`StaleTokenError`，绝不静默忽略。undo 精确还原旧字段。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional, Sequence, Tuple

__all__ = [
    "Task",
    "Resource",
    "ConflictKind",
    "Conflict",
    "DropCheck",
    "DropResult",
    "CalendarResult",
    "UndoToken",
    "ScheduleError",
    "CycleError",
    "TaskNotFoundError",
    "ResourceNotFoundError",
    "InvalidCalendarError",
    "InfeasibleDropError",
    "StaleTokenError",
    "Scheduler",
    "MAX_RIPPLE_ITERS",
]

MAX_RIPPLE_ITERS = 100_000


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class ScheduleError(Exception):
    """所有排期错误的基类。"""


class CycleError(ScheduleError):
    """自依赖或依赖成环。``cycle`` 为环上任务 id 序列，首尾相同。"""

    def __init__(self, cycle: Sequence[str]):
        self.cycle: Tuple[str, ...] = tuple(cycle)
        super().__init__(f"依赖图存在环: {' -> '.join(self.cycle)}")


class TaskNotFoundError(ScheduleError):
    def __init__(self, task_id: str):
        self.task_id = task_id
        super().__init__(f"任务不存在: {task_id!r}")


class ResourceNotFoundError(ScheduleError):
    def __init__(self, resource_id: str):
        self.resource_id = resource_id
        super().__init__(f"资源不存在: {resource_id!r}")


class InvalidCalendarError(ScheduleError):
    def __init__(self, detail: str):
        super().__init__(f"非法日历: {detail}")


class InfeasibleDropError(ScheduleError):
    """拖拽子点本身无法成立（日历缺口 / 早于前置 / 被 pinned 占住）。"""


class StaleTokenError(ScheduleError):
    def __init__(self, detail: str = "undo token 已失效或已被消费"):
        super().__init__(detail)


# ---------------------------------------------------------------------------
# 模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Task:
    task_id: str
    resource_id: str
    start: int
    duration: int
    deps: Tuple[str, ...] = ()
    pinned: bool = False

    @property
    def end(self) -> int:
        return self.start + self.duration


@dataclass(frozen=True)
class Resource:
    resource_id: str
    capacity: int
    calendar: Tuple[Tuple[int, int], ...] = ()


class ConflictKind(str, Enum):
    RESOURCE = "resource"
    CALENDAR = "calendar"
    DEPENDENCY = "dependency"


@dataclass(frozen=True)
class Conflict:
    kind: ConflictKind
    obj_id: str  # 资源冲突->对方任务 id；日历->资源 id；依赖->相关任务 id
    overlap: Tuple[int, int]  # 半开重叠/缺口区间

    @property
    def sort_key(self) -> Tuple[str, str, int, int]:
        return (self.kind.value, self.obj_id, self.overlap[0], self.overlap[1])


@dataclass(frozen=True)
class DropCheck:
    ok: bool
    conflicts: Tuple[Conflict, ...]
    earliest: Optional[int]  # >= new_start 的最早可行整数起点；无则 None


@dataclass(frozen=True)
class UndoToken:
    seq: int
    kind: str  # "drop" | "calendar"


@dataclass(frozen=True)
class ChangeEntry:
    task_id: str
    old_resource: str
    old_start: int
    new_resource: str
    new_start: int


@dataclass(frozen=True)
class DropResult:
    moved: Tuple[str, ...]              # 被显式拖动/换资源的任务
    delayed: Tuple[str, ...]            # 被顶走或顺延的其余任务（id 序）
    blocked: Tuple[str, ...]            # 挡住传播的 pinned 任务（id 序）
    changes: Tuple[ChangeEntry, ...]    # 可回滚变更记录
    token: UndoToken
    residual_conflicts: Tuple[Conflict, ...]  # pinned 挡路无法消除的残余冲突


@dataclass(frozen=True)
class InvalidTask:
    task_id: str
    start: int
    earliest: Optional[int]


@dataclass(frozen=True)
class CalendarResult:
    resource_id: str
    invalidated: Tuple[InvalidTask, ...]
    token: UndoToken


# ---------------------------------------------------------------------------
# 纯函数工具
# ---------------------------------------------------------------------------


def normalize_calendar(
    calendar: Sequence[Tuple[int, int]],
) -> Tuple[Tuple[int, int], ...]:
    """校验并把日历区间合并为有序、互不重叠的并集区间。"""
    norm: List[Tuple[int, int]] = []
    for item in calendar:
        if (
            not isinstance(item, (tuple, list))
            or len(item) != 2
            or not all(isinstance(v, int) and not isinstance(v, bool) for v in item)
        ):
            raise InvalidCalendarError("每个区间必须是 (start:int, end:int)")
        a, b = item
        if a >= b:
            raise InvalidCalendarError(f"区间 [{a}, {b}) 为空或反向")
        norm.append((a, b))
    norm.sort()
    merged: List[Tuple[int, int]] = []
    for a, b in norm:
        if merged and a <= merged[-1][1]:
            if b > merged[-1][1]:
                merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return tuple(merged)


def uncovered_gaps(
    start: int,
    end: int,
    calendar: Sequence[Tuple[int, int]],
) -> List[Tuple[int, int]]:
    """返回 ``[start,end)`` 内未被日历覆盖的连续缺口（有序）。"""
    gaps: List[Tuple[int, int]] = []
    cursor = start
    for a, b in calendar:  # 已规范化、有序
        if b <= cursor:
            continue
        if a >= end:
            break
        if a > cursor:
            gaps.append((cursor, min(a, end)))
        cursor = max(cursor, b)
        if cursor >= end:
            break
    if cursor < end:
        gaps.append((cursor, end))
    return gaps


def find_cycle(
    task_ids: Sequence[str], deps_of: Dict[str, Tuple[str, ...]]
) -> Optional[Tuple[str, ...]]:
    """确定性 DFS 找环（按 id 升序展开）；自依赖返回 (x, x)。"""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {tid: WHITE for tid in task_ids}

    def dfs(node: str, stack: List[str]) -> Optional[Tuple[str, ...]]:
        color[node] = GRAY
        stack.append(node)
        for dep in deps_of[node]:
            if dep == node:
                return (node, node)
            if color.get(dep) == GRAY:
                idx = stack.index(dep)
                return tuple(stack[idx:]) + (dep,)
            if color.get(dep) == WHITE:
                found = dfs(dep, stack)
                if found is not None:
                    return found
        stack.pop()
        color[node] = BLACK
        return None

    for tid in sorted(task_ids):
        if color[tid] == WHITE:
            found = dfs(tid, [])
            if found is not None:
                return found
    return None


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------


class Scheduler:
    def __init__(
        self,
        tasks: Sequence[Task] = (),
        resources: Sequence[Resource] = (),
    ):
        self._tasks: Dict[str, Task] = {}
        self._resources: Dict[str, Resource] = {}
        # undo 栈：每项 (kind, reverse_entries 或旧日历)
        self._undo: List[Tuple[str, object]] = []
        self._seq = 0

        for res in resources:
            self._add_resource(res)
        for task in tasks:
            self._register_task(task)
        # 全部登记后再统一校验未知依赖、重复依赖与成环（允许前向引用）。
        for task in tasks:
            self._validate_task_deps(task)
        self._assert_acyclic()

    # ---- 只读视图 ----

    def get_task(self, task_id: str) -> Task:
        try:
            return self._tasks[task_id]
        except KeyError:
            raise TaskNotFoundError(task_id) from None

    def get_resource(self, resource_id: str) -> Resource:
        try:
            return self._resources[resource_id]
        except KeyError:
            raise ResourceNotFoundError(resource_id) from None

    def tasks_sorted(self) -> List[Task]:
        return sorted(self._tasks.values(), key=lambda t: (t.task_id, t.start))

    def snapshot(self) -> Tuple[Tuple[Tuple[str, str, int, int, Tuple[str, ...], bool], ...],
                                Tuple[Tuple[str, int, Tuple[Tuple[int, int], ...]], ...]]:
        """可逐字段比较的深快照（任务按 id 排序）。"""
        t = tuple(
            sorted(
                (
                    (x.task_id, x.resource_id, x.start, x.duration, x.deps, x.pinned)
                    for x in self._tasks.values()
                ),
                key=lambda row: row[0],
            )
        )
        r = tuple(
            sorted(
                (
                    (x.resource_id, x.capacity, x.calendar)
                    for x in self._resources.values()
                ),
                key=lambda row: row[0],
            )
        )
        return t, r

    # ---- 构造期校验 ----

    def _add_resource(self, res: Resource) -> None:
        if not isinstance(res, Resource):
            raise ScheduleError("必须提供 Resource")
        if not isinstance(res.capacity, int) or res.capacity < 1:
            raise InvalidCalendarError(f"资源 {res.resource_id!r} capacity 必须 >= 1")
        cal = normalize_calendar(res.calendar)
        if res.resource_id in self._resources:
            raise ScheduleError(f"资源重复定义: {res.resource_id!r}")
        self._resources[res.resource_id] = Resource(
            res.resource_id, res.capacity, cal
        )

    def _register_task(self, task: Task) -> None:
        """字段级校验并登记；跨任务的依赖合法性稍后统一检查。"""
        if not isinstance(task, Task):
            raise ScheduleError("必须提供 Task")
        if not isinstance(task.duration, int) or task.duration <= 0:
            raise ScheduleError(f"任务 {task.task_id!r} duration 必须为正整数")
        if task.task_id in self._tasks:
            raise ScheduleError(f"任务重复定义: {task.task_id!r}")
        if task.resource_id not in self._resources:
            raise ResourceNotFoundError(task.resource_id)
        if len(task.deps) != len(set(task.deps)):
            raise ScheduleError(f"任务 {task.task_id!r} 的 deps 有重复项")
        self._tasks[task.task_id] = task

    def _validate_task_deps(self, task: Task) -> None:
        for dep in task.deps:
            if dep not in self._tasks:
                raise ScheduleError(
                    f"任务 {task.task_id!r} 依赖未知任务 {dep!r}"
                )

    def _assert_acyclic(self) -> None:
        deps_of = {tid: t.deps for tid, t in self._tasks.items()}
        cyc = find_cycle(list(self._tasks), deps_of)
        if cyc is not None:
            raise CycleError(cyc)

    # ---- 依赖视图 ----

    def _successors(self) -> Dict[str, List[str]]:
        succ: Dict[str, List[str]] = {tid: [] for tid in self._tasks}
        for tid in sorted(self._tasks):
            for dep in self._tasks[tid].deps:
                succ[dep].append(tid)
        for v in succ.values():
            v.sort()
        return succ

    # ---- can_drop ----

    def can_drop(
        self, task_id: str, new_start: int, new_resource_id: str
    ) -> DropCheck:
        task = self.get_task(task_id)
        resource = self.get_resource(new_resource_id)
        duration = task.duration
        new_end = new_start + duration

        conflicts: List[Conflict] = []

        # 1) 日历缺口（可能多段）
        for gap in uncovered_gaps(new_start, new_end, resource.calendar):
            conflicts.append(Conflict(ConflictKind.CALENDAR, resource.resource_id, gap))

        # 2) 依赖：前置结束晚于新起点
        for dep in sorted(task.deps):
            p = self._tasks[dep]
            if p.end > new_start:
                conflicts.append(
                    Conflict(ConflictKind.DEPENDENCY, p.task_id, (new_start, p.end))
                )

        # 3) 依赖：后继起点早于新终点（本任务被拖晚时会顶到后继）
        for uid in sorted(self._tasks):
            u = self._tasks[uid]
            if task_id in u.deps and u.start < new_end:
                conflicts.append(
                    Conflict(ConflictKind.DEPENDENCY, u.task_id, (u.start, new_end))
                )

        # 4) 资源占用（容量语义）：事件点扫描，只标记在真正超容时刻与
        # 拖入任务同时在场的任务，避免错峰任务被误判。
        others = sorted(
            (
                x for x in self._tasks.values()
                if x.resource_id == new_resource_id and x.task_id != task_id
            ),
            key=lambda x: (x.start, x.task_id),
        )
        by_id = {x.task_id: x for x in others}
        points = {new_start}
        for x in others:
            if new_start < x.start < new_end:
                points.add(x.start)
            if new_start < x.end < new_end:
                points.add(x.end)
        offenders = set()
        for pt in sorted(points):
            active = [
                x for x in others
                if x.start <= pt < x.end and new_start <= pt < new_end
            ]
            if 1 + len(active) > resource.capacity:
                offenders.update(x.task_id for x in active)
        for tid in sorted(offenders):
            x = by_id[tid]
            overlap = (max(new_start, x.start), min(new_end, x.end))
            conflicts.append(
                Conflict(ConflictKind.RESOURCE, x.task_id, overlap)
            )

        conflicts.sort(key=lambda c: c.sort_key)
        earliest = self._earliest_feasible(task, new_start, new_resource_id)
        return DropCheck(not conflicts, tuple(conflicts), earliest)

    def _earliest_feasible(
        self,
        task: Task,
        new_start: int,
        new_resource_id: str,
    ) -> Optional[int]:
        """不移动任何其它任务的前提下，>= new_start 的最早可行起点。"""
        res = self.get_resource(new_resource_id)
        d = task.duration
        others = [
            x for x in self._tasks.values()
            if x.resource_id == new_resource_id and x.task_id != task.task_id
        ]
        pred_lb = max(
            (self._tasks[p].end for p in task.deps), default=new_start
        )
        succ_ub = min(
            (u.start for u in self._tasks.values() if task.task_id in u.deps),
            default=None,
        )

        # 候选边界点：意图起点、日历区间起点、各占用任务终点、各前置终点。
        candidates = {new_start, pred_lb}
        for a, _b in res.calendar:
            if a >= new_start:
                candidates.add(a)
        for x in others:
            if x.end >= new_start:
                candidates.add(x.end)
        for p in task.deps:
            if self._tasks[p].end >= new_start:
                candidates.add(self._tasks[p].end)

        for s in sorted(candidates):
            if s < new_start or s < pred_lb:
                continue
            if succ_ub is not None and s + d > succ_ub:
                continue
            e = s + d
            # 日历完全覆盖
            if uncovered_gaps(s, e, res.calendar):
                continue
            # 容量：逐事件点清点并发
            points = {s}
            for x in others:
                if x.start > s and x.start < e:
                    points.add(x.start)
            ok = True
            for pt in sorted(points):
                active = 1 + sum(
                    1 for x in others if x.start <= pt < x.end and s <= pt < e
                )
                if active > res.capacity:
                    ok = False
                    break
            if ok:
                return s
        return None

    # ---- apply_drop ----

    def apply_drop(
        self,
        task_id: str,
        new_start: int,
        new_resource_id: str,
    ) -> DropResult:
        task = self.get_task(task_id)
        resource = self.get_resource(new_resource_id)
        if not isinstance(new_start, int) or isinstance(new_start, bool):
            raise ScheduleError("new_start 必须是整数")
        self._assert_acyclic()

        # --- 拖拽子点的硬性前置校验（失败零改动）---
        new_end = new_start + task.duration
        gaps = uncovered_gaps(new_start, new_end, resource.calendar)
        if gaps:
            raise InfeasibleDropError(
                f"任务 {task_id!r} 落点 [{new_start},{new_end}) 存在日历缺口 "
                f"{gaps}（资源 {new_resource_id!r}）"
            )
        for dep in sorted(task.deps):
            p = self._tasks[dep]
            if p.end > new_start:
                raise InfeasibleDropError(
                    f"任务 {task_id!r} 起点 {new_start} 早于前置 {dep!r} "
                    f"结束 {p.end}"
                )
        # 落点窗口内若 pinned 任务自身已占满容量，任何顺延都无法给拖入
        # 任务腾出位置（pinned 不可推、拖入任务不应被自己的操作顶走），
        # 前置拒绝；容量未占满时其余可移动任务交给消解阶段。
        pinned_here = [
            x for x in self._tasks.values()
            if x.task_id != task_id
            and x.resource_id == new_resource_id
            and x.pinned
            and x.start < new_end
            and x.end > new_start
        ]
        if pinned_here:
            check_points = {new_start}
            for x in pinned_here:
                if new_start < x.start < new_end:
                    check_points.add(x.start)
            for pt in sorted(check_points):
                if sum(1 for x in pinned_here if x.start <= pt < x.end) >= resource.capacity:
                    raise InfeasibleDropError(
                        f"任务 {task_id!r} 的落点窗口 [{new_start},{new_end}) 内 "
                        f"pinned 任务已占满资源 {new_resource_id!r} 的容量 "
                        f"{resource.capacity}"
                    )

        # --- 草稿状态 ---
        starts: Dict[str, int] = {tid: t.start for tid, t in self._tasks.items()}
        resof: Dict[str, str] = {tid: t.resource_id for tid, t in self._tasks.items()}
        resof[task_id] = new_resource_id
        starts[task_id] = new_start

        successors = self._successors()
        blocked: set = set()

        def end(tid: str) -> int:
            return starts[tid] + self._tasks[tid].duration

        # 不动点：所有推动都严格增大某个整数起点，必然终止（另有上限保护）。
        for _ in range(MAX_RIPPLE_ITERS):
            changed = False

            # 依赖约束：后继不得早于前驱结束（只向右推）。
            for p in sorted(self._tasks):
                for c in successors[p]:
                    if end(p) <= starts[c]:
                        continue
                    if self._tasks[c].pinned:
                        blocked.add(c)  # 传播停在 pinned 前，残余冲突后置汇总
                        continue
                    need = end(p)
                    if need > starts[c]:
                        starts[c] = need
                        changed = True

            # 资源容量：找最早超容点，把最新的可移动既存任务顶到墙后。
            for rid in sorted(self._resources):
                cap = self._resources[rid].capacity
                live = [tid for tid in self._tasks if resof[tid] == rid]
                points = sorted({starts[tid] for tid in live})
                for pt in points:
                    active = [
                        tid for tid in live
                        if starts[tid] <= pt < end(tid)
                    ]
                    if len(active) <= cap:
                        continue
                    pinned_here = [
                        tid for tid in active if self._tasks[tid].pinned
                    ]
                    # 用户刚拖的任务不作为被顶走对象。
                    movable = [
                        tid for tid in active
                        if not self._tasks[tid].pinned and tid != task_id
                    ]
                    if not movable:
                        # 超容窗口里没有可顶走的既存任务：记墙，保留残余
                        # 冲突，不做无意义往返。
                        blocked.update(pinned_here)
                        continue
                    # 从最新的可移动任务起依次尝试；被顺延者不能越过自己
                    # 的 pinned 直接后继（否则造成依赖倒置），那样只能
                    # 停在墙前并记 blocked。
                    moved_here = False
                    for victim in sorted(
                        movable, key=lambda tid: (starts[tid], tid), reverse=True
                    ):
                        walls = [
                            w for w in active
                            if w != victim and end(w) > starts[victim]
                        ]
                        if not walls:
                            continue
                        target = min(end(w) for w in walls)
                        # pinned 直接后继给 victim 的起点上界。
                        pinned_bound = min(
                            (
                                starts[s] - self._tasks[victim].duration
                                for s in successors[victim]
                                if self._tasks[s].pinned
                            ),
                            default=None,
                        )
                        if pinned_bound is not None and target > pinned_bound:
                            continue
                        starts[victim] = target
                        changed = True
                        moved_here = True
                        break
                    if not moved_here:
                        blocked.update(pinned_here)
                    else:
                        break  # 重排后下一轮重新从最早超容点扫起

            if not changed:
                break
        else:
            raise ScheduleError(
                f"联动迭代超过上限 {MAX_RIPPLE_ITERS}（保护性停机，状态未改）"
            )

        # --- 向左压实：消解"资源顶人"与"依赖顺延"叠加产生的多余空隙 ---
        # 只允许本次被顺延（起点被向右推）的任务回到不早于其原始起点与
        # 前驱结束的最早可行槽；被拖任务固定在新起点，pinned 与无关任务
        # 不动。单调向左、有下界，必然收敛。
        orig_start = {tid: self._tasks[tid].start for tid in self._tasks}
        compactable = [
            tid for tid in self._tasks
            if tid != task_id and starts[tid] > orig_start[tid]
        ]

        def earliest_draft_slot(tid: str, lb: int) -> Optional[int]:
            rid = resof[tid]
            dur = self._tasks[tid].duration
            cal = self._resources[rid].calendar
            cap = self._resources[rid].capacity
            blocker_ids = [
                o for o in self._tasks if o != tid and resof[o] == rid
            ]
            cands = {lb}
            for a, _b in cal:
                if lb <= a <= starts[tid]:
                    cands.add(a)
            for o in blocker_ids:
                e = starts[o] + self._tasks[o].duration
                if lb <= e <= starts[tid]:
                    cands.add(e)
            for s in sorted(cands):
                if s < lb:
                    continue
                e = s + dur
                if uncovered_gaps(s, e, cal):
                    continue
                pts = {s}
                for o in blocker_ids:
                    if s < starts[o] < e:
                        pts.add(starts[o])
                if all(
                    1 + sum(
                        1 for o in blocker_ids
                        if starts[o] <= pt < starts[o] + self._tasks[o].duration
                        and s <= pt < e
                    ) <= cap
                    for pt in sorted(pts)
                ):
                    return s
            return None

        for _ in range(MAX_RIPPLE_ITERS):
            moved_left = False
            for tid in sorted(compactable):
                lb = max(
                    [orig_start[tid]]
                    + [end(p) for p in self._tasks[tid].deps]
                )
                if starts[tid] <= lb:
                    continue
                s = earliest_draft_slot(tid, lb)
                if s is not None and s < starts[tid]:
                    starts[tid] = s
                    moved_left = True
            if not moved_left:
                break
        else:  # pragma: no cover - 单调收敛，理论不可达
            raise ScheduleError("压实迭代超过上限（保护性停机，状态未改）")

        # --- 被拖任务窗口的可实现性闸门 ---
        # 被拖任务（无论是否 pinned）都固定在 new_start。右推不动点收敛后，
        # 若其窗口内仍超容（典型：旁边任务被自己的 pinned 后继钉死、无法
        # 让位），则不存在"保持被拖任务不动"的可行解，整体拒绝、零改动。
        new_end0 = new_start + task.duration
        win_others = [
            o for o in self._tasks.values()
            if o.task_id != task_id and resof[o.task_id] == new_resource_id
        ]
        gate_points = {new_start}
        for o in win_others:
            os_ = starts[o.task_id]
            if new_start < os_ < new_end0:
                gate_points.add(os_)
        for pt in sorted(gate_points):
            active = [task_id] + [
                o.task_id for o in win_others
                if starts[o.task_id] <= pt
                < starts[o.task_id] + o.duration
                and new_start <= pt < new_end0
            ]
            if len(active) > resource.capacity:
                raise InfeasibleDropError(
                    f"任务 {task_id!r} 的落点 [{new_start},{new_end0}) 在 "
                    f"{pt} 时刻资源 {new_resource_id!r} 仍有 {len(active)} "
                    f"个任务（容量 {resource.capacity}），且挡路任务被 pinned "
                    f"约束钉死、无法让位（状态未改）"
                )

        # --- 草稿后置校验：所有发生移动的任务必须落在日历内 ---
        changed_ids = [
            tid for tid in self._tasks
            if starts[tid] != self._tasks[tid].start
            or resof[tid] != self._tasks[tid].resource_id
        ]
        for tid in changed_ids:
            rid = resof[tid]
            t = self._tasks[tid]
            if uncovered_gaps(starts[tid], end(tid), self._resources[rid].calendar):
                raise InfeasibleDropError(
                    f"联动把任务 {tid!r} 推到资源 {rid!r} 的日历之外 "
                    f"[{starts[tid]},{end(tid)})（状态未改）"
                )

        # 残余冲突（pinned 挡路、无法消除）快照，供调用方知晓。
        watch = sorted(set(changed_ids) | {task_id})
        residual: List[Conflict] = []
        for tid in watch:
            rid = resof[tid]
            for other_id in sorted(self._tasks):
                o = self._tasks[other_id]
                if other_id == tid:
                    continue
                # 同资源的 pinned 占用
                if resof[other_id] == rid and o.pinned:
                    ov = (max(starts[tid], starts[other_id]),
                          min(end(tid), end(other_id)))
                    if ov[0] < ov[1]:
                        residual.append(
                            Conflict(ConflictKind.RESOURCE, other_id, ov)
                        )
                # pinned 后继仍早于本任务结束（依赖传播被挡住）
                if tid in o.deps and o.pinned and starts[other_id] < end(tid):
                    residual.append(
                        Conflict(
                            ConflictKind.DEPENDENCY,
                            other_id,
                            (starts[other_id], end(tid)),
                        )
                    )
        residual.sort(key=lambda c: c.sort_key)

        # --- 一次性提交 + undo 日志 ---
        entries: List[ChangeEntry] = []
        new_tasks: Dict[str, Task] = {}
        for tid in sorted(self._tasks):
            old = self._tasks[tid]
            entries.append(
                ChangeEntry(
                    tid, old.resource_id, old.start,
                    resof[tid], starts[tid],
                )
            )
            new_tasks[tid] = Task(
                tid, resof[tid], starts[tid], old.duration, old.deps, old.pinned
            )
        self._seq += 1
        token = UndoToken(self._seq, "drop")
        self._undo.append(("drop", tuple(entries)))
        self._tasks = new_tasks

        delayed = tuple(
            sorted(tid for tid in changed_ids if tid != task_id)
        )
        return DropResult(
            moved=(task_id,),
            delayed=delayed,
            blocked=tuple(sorted(blocked)),
            changes=tuple(
                e for e in entries
                if e.old_start != e.new_start or e.old_resource != e.new_resource
            ),
            token=token,
            residual_conflicts=tuple(residual),
        )

    # ---- 日历变更 ----

    def update_calendar(
        self,
        resource_id: str,
        calendar: Sequence[Tuple[int, int]],
    ) -> CalendarResult:
        resource = self.get_resource(resource_id)
        new_cal = normalize_calendar(calendar)
        self._assert_acyclic()

        invalidated: List[InvalidTask] = []
        for t in sorted(
            (x for x in self._tasks.values() if x.resource_id == resource_id),
            key=lambda x: (x.task_id, x.start),
        ):
            if uncovered_gaps(t.start, t.end, new_cal):
                earliest = self._earliest_in_calendar(
                    t.start, t.duration, new_cal
                )
                invalidated.append(InvalidTask(t.task_id, t.start, earliest))

        self._seq += 1
        token = UndoToken(self._seq, "calendar")
        self._undo.append(("calendar", (resource_id, resource.calendar)))
        self._resources[resource_id] = Resource(
            resource_id, resource.capacity, new_cal
        )
        return CalendarResult(resource_id, tuple(invalidated), token)

    @staticmethod
    def _earliest_in_calendar(
        start: int,
        duration: int,
        calendar: Sequence[Tuple[int, int]],
    ) -> Optional[int]:
        """仅按日历求 >= start 的最早合法起点（忽略占用与依赖）。"""
        for a, b in calendar:
            if b <= start:
                continue
            s = max(a, start)
            if s + duration <= b:
                return s
        return None

    # ---- undo ----

    def undo(self, token: UndoToken) -> None:
        if not self._undo or token.seq != self._seq:
            raise StaleTokenError()
        kind, payload = self._undo[-1]
        if token.kind != kind:
            raise StaleTokenError("token 类型与栈顶操作不匹配")

        if kind == "drop":
            restored: Dict[str, Task] = {}
            for e in payload:  # type: ignore[union-attr]
                old = self._tasks[e.task_id]
                restored[e.task_id] = Task(
                    e.task_id, e.old_resource, e.old_start,
                    old.duration, old.deps, old.pinned,
                )
            # payload 含全部任务，但只复制旧值；保留未变任务一致性。
            for tid, t in self._tasks.items():
                if tid not in restored:
                    restored[tid] = t
            self._tasks = restored
        else:
            rid, old_cal = payload  # type: ignore[misc]
            cur = self._resources[rid]
            self._resources[rid] = Resource(rid, cur.capacity, old_cal)

        self._undo.pop()
        self._seq -= 1
