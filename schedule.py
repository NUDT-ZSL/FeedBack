"""排期引擎内核（纯 Python 标准库）。

提供资源可用性管理、任务建模、同资源冲突检测、拖拽移动（move）、
依赖约束下的级联顺延（含菱形依赖去重与阻塞回退），以及 JSON 快照
持久化与一致性校验。

时间模型：整数逻辑时间，区间一律左闭右开 ``[start, end)``；
两个区间重叠当且仅当 ``max(s1, s2) < min(e1, e2)``。
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple


class ScheduleError(ValueError):
    """所有引擎层面的参数 / 状态一致性错误的基类。"""


class NotFoundError(ScheduleError):
    """引用的资源或任务不存在。"""


class ConflictError(ScheduleError):
    """新增任务与同资源已有任务重叠（move 的冲突走 MoveResult，不抛异常）。"""


class SnapshotError(ScheduleError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 结果对象
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Conflict:
    """一对同资源任务之间的一处重叠。"""

    task_id: str
    other_task_id: str
    overlap_start: int
    overlap_end: int

    def to_dict(self) -> Dict[str, object]:
        return {
            "task_id": self.task_id,
            "other_task_id": self.other_task_id,
            "overlap_start": self.overlap_start,
            "overlap_end": self.overlap_end,
            "overlap": [self.overlap_start, self.overlap_end],
        }


@dataclass(frozen=True)
class Adjustment:
    """一次联动顺延中某个任务的位移记录。"""

    task_id: str
    old_start: int
    old_end: int
    new_start: int
    new_end: int

    def to_dict(self) -> Dict[str, object]:
        return {
            "task_id": self.task_id,
            "old_start": self.old_start,
            "old_end": self.old_end,
            "new_start": self.new_start,
            "new_end": self.new_end,
        }


@dataclass(frozen=True)
class BlockedTask:
    """顺延受阻的任务：尝试落点非法（冲突 / 超出可用区间），已回退原位。"""

    task_id: str
    attempted_start: int
    attempted_end: int
    reason: str  # "conflict" 或 "out_of_availability"
    conflicts: Tuple[Conflict, ...] = ()

    def to_dict(self) -> Dict[str, object]:
        return {
            "task_id": self.task_id,
            "attempted_start": self.attempted_start,
            "attempted_end": self.attempted_end,
            "reason": self.reason,
            "conflicts": [c.to_dict() for c in self.conflicts],
        }


@dataclass
class MoveResult:
    """``move`` 的结果。

    - success 为 True 时 final_* 是移动任务的最终落点；conflicts 必为空。
    - success 为 False 时引擎状态没有任何改变，final_* 为 None，
      conflicts 列出与移动任务冲突的全部任务。
    - adjusted / blocked 仅在 success 为 True 时可能非空。
    """

    success: bool
    task_id: str
    final_start: Optional[int]
    final_end: Optional[int]
    conflicts: List[Conflict] = field(default_factory=list)
    adjusted: List[Adjustment] = field(default_factory=list)
    blocked: List[BlockedTask] = field(default_factory=list)

    def to_dict(self) -> Dict[str, object]:
        return {
            "success": self.success,
            "task_id": self.task_id,
            "final": (
                [self.final_start, self.final_end]
                if self.final_start is not None and self.final_end is not None
                else None
            ),
            "conflicts": [c.to_dict() for c in self.conflicts],
            "adjusted": [a.to_dict() for a in self.adjusted],
            "blocked": [b.to_dict() for b in self.blocked],
        }


# ---------------------------------------------------------------------------
# 内部模型
# ---------------------------------------------------------------------------


@dataclass
class _Task:
    task_id: str
    resource_id: str
    start: int
    end: int
    priority: int
    deps: List[str]


@dataclass
class _Resource:
    resource_id: str
    availability: List[Tuple[int, int]]  # 已排序、互不重叠的半开区间


def _overlap(s1: int, e1: int, s2: int, e2: int) -> Optional[Tuple[int, int]]:
    """两个半开区间的重叠部分；不重叠（含仅端点相接）返回 None。"""

    lo = max(s1, s2)
    hi = min(e1, e2)
    if lo < hi:
        return lo, hi
    return None


# ---------------------------------------------------------------------------
# 引擎
# ---------------------------------------------------------------------------


class ScheduleEngine:
    """排期引擎：维护资源、任务与依赖，支持拖拽移动和级联顺延。"""

    SNAPSHOT_VERSION = 1

    def __init__(self) -> None:
        self._resources: Dict[str, _Resource] = {}
        self._tasks: Dict[str, _Task] = {}

    # -- 基础校验 ----------------------------------------------------------

    @staticmethod
    def _require_id(value: object, kind: str) -> str:
        if not isinstance(value, str) or not value:
            raise ScheduleError(f"{kind} 必须是非空字符串")
        return value

    @staticmethod
    def _require_int(value: object, name: str) -> int:
        # bool 是 int 的子类，显式排除，避免 True/False 混入逻辑时间。
        if isinstance(value, bool) or not isinstance(value, int):
            raise ScheduleError(f"{name} 必须是整数，收到 {value!r}")
        return value

    def _normalize_availability(
        self, intervals: object
    ) -> List[Tuple[int, int]]:
        """校验并归一化可用区间：整数、s<e、排序后互不重叠。"""

        if not isinstance(intervals, (list, tuple)) or not intervals:
            raise ScheduleError("availability 必须是非空的 [start, end] 列表")
        normalized: List[Tuple[int, int]] = []
        for idx, item in enumerate(intervals):
            if not isinstance(item, (list, tuple)) or len(item) != 2:
                raise ScheduleError(
                    f"availability[{idx}] 必须是长度为 2 的 [start, end]"
                )
            s = self._require_int(item[0], f"availability[{idx}].start")
            e = self._require_int(item[1], f"availability[{idx}].end")
            if s >= e:
                raise ScheduleError(
                    f"availability[{idx}] 非法：start({s}) 必须小于 end({e})"
                )
            normalized.append((s, e))
        normalized.sort()
        for (s1, e1), (s2, e2) in zip(normalized, normalized[1:]):
            if s2 < e1:  # 端点相接（s2 == e1）合法
                raise ScheduleError(
                    f"资源可用区间重叠：[{s1}, {e1}) 与 [{s2}, {e2})"
                )
        return normalized

    def _within_availability(
        self, resource: _Resource, start: int, end: int
    ) -> bool:
        """任务 [start, end) 是否整体落在资源的某个可用区间内。"""

        return any(s <= start and end <= e for s, e in resource.availability)

    def _conflicts_against(
        self,
        task_id: str,
        resource_id: str,
        start: int,
        end: int,
    ) -> List[Conflict]:
        """列出 [start,end) 在该资源上与其他任务的全部冲突。"""

        result: List[Conflict] = []
        for other in self._tasks.values():
            if other.task_id == task_id or other.resource_id != resource_id:
                continue
            ov = _overlap(start, end, other.start, other.end)
            if ov is not None:
                result.append(
                    Conflict(
                        task_id=task_id,
                        other_task_id=other.task_id,
                        overlap_start=ov[0],
                        overlap_end=ov[1],
                    )
                )
        result.sort(key=lambda c: (c.overlap_start, c.other_task_id))
        return result

    # -- 建模 --------------------------------------------------------------

    def add_resource(
        self, resource_id: str, availability: Sequence[Sequence[int]]
    ) -> None:
        """新增资源及其可用时间区间列表（区间互不重叠，端点相接允许）。"""

        rid = self._require_id(resource_id, "resource_id")
        if rid in self._resources:
            raise ScheduleError(f"资源 {rid!r} 已存在")
        intervals = self._normalize_availability(availability)
        self._resources[rid] = _Resource(rid, intervals)

    def add_task(
        self,
        task_id: str,
        resource_id: str,
        start: int,
        end: int,
        priority: int = 0,
        deps: Optional[Iterable[str]] = None,
    ) -> None:
        """新增任务。

        校验：id 唯一非空、资源存在、start<end、落在资源可用区间内、
        同资源无重叠、依赖存在且无重复 / 自依赖、依赖构成无环图、
        且 start 不早于任一依赖的 end。
        """

        tid = self._require_id(task_id, "task_id")
        rid = self._require_id(resource_id, "resource_id")
        s = self._require_int(start, "start")
        e = self._require_int(end, "end")
        pri = self._require_int(priority, "priority")
        if tid in self._tasks:
            raise ScheduleError(f"任务 {tid!r} 已存在")
        resource = self._resources.get(rid)
        if resource is None:
            raise NotFoundError(f"资源 {rid!r} 不存在")
        if s >= e:
            raise ScheduleError(f"任务时间非法：start({s}) 必须小于 end({e})")
        if not self._within_availability(resource, s, e):
            raise ScheduleError(
                f"任务 {tid!r} 的 [{s}, {e}) 不在资源 {rid!r} 的可用区间内"
            )

        dep_list = list(deps) if deps is not None else []
        seen: Set[str] = set()
        for d in dep_list:
            self._require_id(d, "deps 中的 task_id")
            if d == tid:
                raise ScheduleError(f"任务 {tid!r} 不能依赖自身")
            if d in seen:
                raise ScheduleError(f"任务 {tid!r} 的依赖列表中 {d!r} 重复")
            if d not in self._tasks:
                raise NotFoundError(f"任务 {tid!r} 依赖的任务 {d!r} 不存在")
            seen.add(d)

        # 先挂入再检测加边后是否成环，随后做不变量校验，任何失败都回滚。
        task = _Task(tid, rid, s, e, pri, dep_list)
        self._tasks[tid] = task
        try:
            if self._has_cycle():
                raise ScheduleError(f"加入任务 {tid!r} 后依赖图出现环")
            for d in dep_list:
                dep = self._tasks[d]
                if s < dep.end:
                    raise ScheduleError(
                        f"任务 {tid!r} 的 start({s}) 早于依赖 {d!r} 的 "
                        f"end({dep.end})，不满足 start >= dep.end"
                    )
            clashes = self._conflicts_against(tid, rid, s, e)
            if clashes:
                detail = ", ".join(c.other_task_id for c in clashes)
                raise ConflictError(
                    f"任务 {tid!r} 与同资源任务 {detail} 时间重叠"
                )
        except Exception:
            del self._tasks[tid]
            raise

    def _has_cycle(self) -> bool:
        """Kahn 拓扑排序检测当前依赖图是否有环。"""

        indeg: Dict[str, int] = {tid: 0 for tid in self._tasks}
        dependents: Dict[str, List[str]] = {tid: [] for tid in self._tasks}
        for t in self._tasks.values():
            for d in t.deps:
                indeg[t.task_id] += 1
                dependents[d].append(t.task_id)
        queue: Deque[str] = deque(
            sorted(tid for tid, n in indeg.items() if n == 0)
        )
        visited = 0
        while queue:
            cur = queue.popleft()
            visited += 1
            for nxt in sorted(dependents[cur]):
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    queue.append(nxt)
        return visited != len(self._tasks)

    # -- 移动与联动 --------------------------------------------------------

    def move(self, task_id: str, new_start: int, new_end: int) -> MoveResult:
        """把任务拖拽到新时间并执行依赖联动。

        流程：

        1. 参数校验（任务存在、new_start < new_end、时长保持不变、
           仍满足自身依赖、落在资源可用区间内）；
        2. 冲突检测：移动本身与同资源任何任务重叠则整体失败，
           引擎状态不变、不做任何联动，返回全部冲突；
        3. 应用移动，对所有传递下游按拓扑序（同层优先级高者优先、
           再按 task_id 字典序）顺延，菱形依赖中的任务只处理一次；
        4. 顺延落点若超出可用区间或产生冲突，回退该任务并记为
           blocked，其下游不参与本次联动。
        """

        tid = self._require_id(task_id, "task_id")
        ns = self._require_int(new_start, "new_start")
        ne = self._require_int(new_end, "new_end")
        task = self._tasks.get(tid)
        if task is None:
            raise NotFoundError(f"任务 {tid!r} 不存在")
        if ns >= ne:
            raise ScheduleError(
                f"new_start({ns}) 必须小于 new_end({ne})"
            )
        duration = task.end - task.start
        if ne - ns != duration:
            raise ScheduleError(
                f"移动必须保持时长 {duration} 不变，"
                f"传入时长为 {ne - ns}"
            )
        resource = self._resources[task.resource_id]
        if not self._within_availability(resource, ns, ne):
            raise ScheduleError(
                f"任务 {tid!r} 的目标区间 [{ns}, {ne}) 不在资源 "
                f"{task.resource_id!r} 的可用区间内"
            )
        for d in task.deps:
            dep_end = self._tasks[d].end
            if ns < dep_end:
                raise ScheduleError(
                    f"任务 {tid!r} 移动后的 start({ns}) 早于依赖 "
                    f"{d!r} 的 end({dep_end})，不满足依赖约束"
                )

        # 1) 先做冲突检测：命中即失败，状态不变，不联动。
        clashes = self._conflicts_against(tid, task.resource_id, ns, ne)
        if clashes:
            return MoveResult(
                success=False,
                task_id=tid,
                final_start=None,
                final_end=None,
                conflicts=clashes,
            )

        # 2) 应用移动。
        old_start, old_end = task.start, task.end
        task.start, task.end = ns, ne

        # 3) 级联顺延。
        adjusted, blocked = self._cascade(tid)
        return MoveResult(
            success=True,
            task_id=tid,
            final_start=task.start,
            final_end=task.end,
            adjusted=adjusted,
            blocked=blocked,
        )

    def _collect_downstream(self, root: str) -> Set[str]:
        """收集 root 的所有传递下游（不含 root）。"""

        downstream: Set[str] = set()
        stack = [root]
        while stack:
            cur = stack.pop()
            for t in self._tasks.values():
                if cur in t.deps and t.task_id not in downstream:
                    downstream.add(t.task_id)
                    stack.append(t.task_id)
        return downstream

    def _cascade(
        self, moved_id: str
    ) -> Tuple[List[Adjustment], List[BlockedTask]]:
        """对 moved_id 的下游执行级联顺延。

        顺序：分层 Kahn，每轮在“依赖均已处理”的任务中按
        （优先级降序、task_id 升序）取一个；菱形依赖的任务因此只
        会被处理一次。blocked 任务及其下游被排除，不再参与联动。
        """

        downstream = self._collect_downstream(moved_id)
        if not downstream:
            return [], []

        # induced subgraph 上的入度（只统计同样位于 downstream 中的依赖）。
        indeg: Dict[str, int] = {}
        dependents: Dict[str, List[str]] = {tid: [] for tid in downstream}
        for tid in downstream:
            parents = [d for d in self._tasks[tid].deps if d in downstream]
            indeg[tid] = len(parents)
            for d in parents:
                dependents[d].append(tid)

        # 用 list + min 选择，避免堆中 (-priority, id) 的额外抽象；
        # 任务规模下完全够用，且选择规则显式可读。
        ready = [tid for tid, n in indeg.items() if n == 0]
        excluded: Set[str] = set()  # blocked 任务及其不参与联动的下游
        adjusted: List[Adjustment] = []
        blocked: List[BlockedTask] = []
        processed: Set[str] = set()

        while ready:
            cur = min(
                ready,
                key=lambda x: (-self._tasks[x].priority, x),
            )
            ready.remove(cur)
            processed.add(cur)
            task = self._tasks[cur]

            parents_excluded = any(
                d in excluded for d in task.deps if d in downstream
            )
            if parents_excluded:
                # 上游被阻塞：本任务不参与联动，直接排除并继续传播。
                excluded.add(cur)
            else:
                required = max(
                    (self._tasks[d].end for d in task.deps),
                    default=task.start,
                )
                candidate_start = max(task.start, required)
                duration = task.end - task.start
                candidate_end = candidate_start + duration

                if candidate_start != task.start:
                    resource = self._resources[task.resource_id]
                    if not self._within_availability(
                        resource, candidate_start, candidate_end
                    ):
                        blocked.append(
                            BlockedTask(
                                task_id=cur,
                                attempted_start=candidate_start,
                                attempted_end=candidate_end,
                                reason="out_of_availability",
                            )
                        )
                        excluded.add(cur)
                    else:
                        # 以当前实时状态为障碍：已顺延任务在新位置，
                        # 未处理任务与已回退任务都在真实（原）位置，
                        # 因此任何被接受的落点都保证全局不冲突。
                        # 处理顺序（优先级、id）决定竞争同一空位时谁先得。
                        clashes = self._conflicts_against(
                            cur,
                            task.resource_id,
                            candidate_start,
                            candidate_end,
                        )
                        if clashes:
                            # 回退到原位置（从未改写），记为 blocked。
                            blocked.append(
                                BlockedTask(
                                    task_id=cur,
                                    attempted_start=candidate_start,
                                    attempted_end=candidate_end,
                                    reason="conflict",
                                    conflicts=tuple(clashes),
                                )
                            )
                            excluded.add(cur)
                        else:
                            old_s, old_e = task.start, task.end
                            task.start, task.end = candidate_start, candidate_end
                            adjusted.append(
                                Adjustment(
                                    task_id=cur,
                                    old_start=old_s,
                                    old_end=old_e,
                                    new_start=candidate_start,
                                    new_end=candidate_end,
                                )
                            )

            for nxt in dependents[cur]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    ready.append(nxt)

        adjusted.sort(key=lambda a: (a.new_start, a.task_id))
        blocked.sort(key=lambda b: b.task_id)
        return adjusted, blocked

    # -- 查询 --------------------------------------------------------------

    def get_task(self, task_id: str) -> Dict[str, object]:
        """返回单个任务的完整描述；不存在抛 NotFoundError。"""

        tid = self._require_id(task_id, "task_id")
        task = self._tasks.get(tid)
        if task is None:
            raise NotFoundError(f"任务 {tid!r} 不存在")
        return self._task_dict(task)

    def list_tasks(self, resource_id: Optional[str] = None) -> List[Dict[str, object]]:
        """列出任务，可按资源过滤；按 (start, task_id) 排序。"""

        if resource_id is not None:
            rid = self._require_id(resource_id, "resource_id")
            if rid not in self._resources:
                raise NotFoundError(f"资源 {rid!r} 不存在")
        tasks = [
            t
            for t in self._tasks.values()
            if resource_id is None or t.resource_id == resource_id
        ]
        tasks.sort(key=lambda t: (t.start, t.task_id))
        return [self._task_dict(t) for t in tasks]

    def get_resource_timeline(
        self, resource_id: str, start: int, end: int
    ) -> List[Dict[str, object]]:
        """返回资源在窗口 [start,end) 内与之相交的占用，按开始时间排序。"""

        rid = self._require_id(resource_id, "resource_id")
        s = self._require_int(start, "start")
        e = self._require_int(end, "end")
        if s >= e:
            raise ScheduleError(f"查询窗口非法：start({s}) 必须小于 end({e})")
        if rid not in self._resources:
            raise NotFoundError(f"资源 {rid!r} 不存在")
        result = [
            t
            for t in self._tasks.values()
            if t.resource_id == rid and _overlap(s, e, t.start, t.end) is not None
        ]
        result.sort(key=lambda t: (t.start, t.task_id))
        return [
            {
                "task_id": t.task_id,
                "start": t.start,
                "end": t.end,
                "priority": t.priority,
            }
            for t in result
        ]

    def get_dependency_chain(self, task_id: str) -> List[str]:
        """返回任务的全部传递依赖，按拓扑序（同层按 task_id 字典序）。"""

        tid = self._require_id(task_id, "task_id")
        if tid not in self._tasks:
            raise NotFoundError(f"任务 {tid!r} 不存在")

        # 在由传递依赖构成的子图上做 Kahn，起点为入度为 0 的任务。
        nodes: Set[str] = set()
        stack = [tid]
        while stack:
            cur = stack.pop()
            for d in self._tasks[cur].deps:
                if d not in nodes:
                    nodes.add(d)
                    stack.append(d)
        indeg = {
            x: sum(1 for d in self._tasks[x].deps if d in nodes) for x in nodes
        }
        dependents: Dict[str, List[str]] = {x: [] for x in nodes}
        for x in nodes:
            for d in self._tasks[x].deps:
                if d in nodes:
                    dependents[d].append(x)
        ready = sorted(x for x, n in indeg.items() if n == 0)
        order: List[str] = []
        while ready:
            cur = ready.pop(0)
            order.append(cur)
            for nxt in dependents[cur]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    ready.append(nxt)
            ready.sort()
        return order

    @staticmethod
    def _task_dict(task: _Task) -> Dict[str, object]:
        return {
            "task_id": task.task_id,
            "resource_id": task.resource_id,
            "start": task.start,
            "end": task.end,
            "duration": task.end - task.start,
            "priority": task.priority,
            "deps": list(task.deps),
        }

    # -- 持久化 ------------------------------------------------------------

    def to_dict(self) -> Dict[str, object]:
        """导出完整可重建状态（与 save 写入的结构一致）。"""

        return {
            "version": self.SNAPSHOT_VERSION,
            "resources": [
                {
                    "resource_id": r.resource_id,
                    "availability": [
                        [s, e] for s, e in r.availability
                    ],
                }
                for r in sorted(self._resources.values(), key=lambda r: r.resource_id)
            ],
            "tasks": [
                {
                    "task_id": t.task_id,
                    "resource_id": t.resource_id,
                    "start": t.start,
                    "end": t.end,
                    "priority": t.priority,
                    "deps": list(t.deps),
                }
                for t in sorted(self._tasks.values(), key=lambda t: t.task_id)
            ],
        }

    def save(self, path: str) -> None:
        """把引擎状态写成 JSON 快照文件。"""

        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, ensure_ascii=False, indent=2)

    @classmethod
    def from_dict(cls, data: object) -> "ScheduleEngine":
        """从快照字典重建引擎并做完整一致性校验。"""

        if not isinstance(data, dict):
            raise SnapshotError("快照根节点必须是 JSON 对象")
        required = ("version", "resources", "tasks")
        for key in required:
            if key not in data:
                raise SnapshotError(f"快照缺少必填字段 {key!r}")
        if data["version"] != cls.SNAPSHOT_VERSION:
            raise SnapshotError(
                f"不支持的快照版本 {data['version']!r}，"
                f"当前支持版本 {cls.SNAPSHOT_VERSION}"
            )

        engine = cls()

        resources = data["resources"]
        if not isinstance(resources, list):
            raise SnapshotError("快照字段 resources 必须是列表")
        seen_resources: Set[str] = set()
        for idx, item in enumerate(resources):
            if not isinstance(item, dict):
                raise SnapshotError(f"resources[{idx}] 必须是对象")
            for key in ("resource_id", "availability"):
                if key not in item:
                    raise SnapshotError(
                        f"resources[{idx}] 缺少字段 {key!r}"
                    )
            rid = item["resource_id"]
            if not isinstance(rid, str) or not rid:
                raise SnapshotError(
                    f"resources[{idx}].resource_id 必须是非空字符串"
                )
            if rid in seen_resources:
                raise SnapshotError(f"资源 id {rid!r} 在快照中重复")
            seen_resources.add(rid)
            try:
                intervals = engine._normalize_availability(item["availability"])
            except ScheduleError as exc:
                raise SnapshotError(
                    f"资源 {rid!r} 的可用区间非法：{exc}"
                ) from exc
            engine._resources[rid] = _Resource(rid, intervals)

        tasks = data["tasks"]
        if not isinstance(tasks, list):
            raise SnapshotError("快照字段 tasks 必须是列表")
        seen_tasks: Set[str] = set()
        for idx, item in enumerate(tasks):
            if not isinstance(item, dict):
                raise SnapshotError(f"tasks[{idx}] 必须是对象")
            for key in (
                "task_id",
                "resource_id",
                "start",
                "end",
                "priority",
                "deps",
            ):
                if key not in item:
                    raise SnapshotError(f"tasks[{idx}] 缺少字段 {key!r}")
            tid = item["task_id"]
            if not isinstance(tid, str) or not tid:
                raise SnapshotError(
                    f"tasks[{idx}].task_id 必须是非空字符串"
                )
            if tid in seen_tasks:
                raise SnapshotError(f"任务 id {tid!r} 在快照中重复")
            seen_tasks.add(tid)

        # 两遍重建：第一遍建任务（校验资源、时间、窗口），第二遍校验依赖，
        # 以允许任务在快照中按任意顺序排列。
        raw_tasks: Dict[str, dict] = {}
        for idx, item in enumerate(tasks):
            tid = item["task_id"]
            rid = item["resource_id"]
            if not isinstance(rid, str) or not rid:
                raise SnapshotError(f"任务 {tid!r} 的 resource_id 非法")
            if rid not in engine._resources:
                raise SnapshotError(
                    f"任务 {tid!r} 引用了不存在的资源 {rid!r}"
                )
            start, end, priority = item["start"], item["end"], item["priority"]
            if isinstance(start, bool) or not isinstance(start, int):
                raise SnapshotError(f"任务 {tid!r} 的 start 必须是整数")
            if isinstance(end, bool) or not isinstance(end, int):
                raise SnapshotError(f"任务 {tid!r} 的 end 必须是整数")
            if isinstance(priority, bool) or not isinstance(priority, int):
                raise SnapshotError(f"任务 {tid!r} 的 priority 必须是整数")
            if start >= end:
                raise SnapshotError(
                    f"任务 {tid!r} 非法：start({start}) 必须小于 end({end})"
                )
            resource = engine._resources[rid]
            if not engine._within_availability(resource, start, end):
                raise SnapshotError(
                    f"任务 {tid!r} 的 [{start}, {end}) 不在资源 "
                    f"{rid!r} 的可用区间内"
                )
            raw_tasks[tid] = item
            engine._tasks[tid] = _Task(tid, rid, start, end, priority, [])

        try:
            for tid, item in raw_tasks.items():
                deps = item["deps"]
                if not isinstance(deps, list):
                    raise SnapshotError(f"任务 {tid!r} 的 deps 必须是列表")
                normalized: List[str] = []
                dep_seen: Set[str] = set()
                for d in deps:
                    if not isinstance(d, str) or not d:
                        raise SnapshotError(
                            f"任务 {tid!r} 的依赖 id 必须是非空字符串"
                        )
                    if d == tid:
                        raise SnapshotError(f"任务 {tid!r} 依赖自身")
                    if d in dep_seen:
                        raise SnapshotError(
                            f"任务 {tid!r} 的依赖 {d!r} 重复"
                        )
                    if d not in raw_tasks:
                        raise SnapshotError(
                            f"任务 {tid!r} 依赖了不存在的任务 {d!r}"
                        )
                    dep_seen.add(d)
                    normalized.append(d)
                engine._tasks[tid].deps = normalized

            if engine._has_cycle():
                raise SnapshotError("快照依赖图中存在环")

            # 依赖时序约束。
            for t in engine._tasks.values():
                for d in t.deps:
                    if t.start < engine._tasks[d].end:
                        raise SnapshotError(
                            f"任务 {t.task_id!r} 的 start({t.start}) 早于依赖"
                            f" {d!r} 的 end({engine._tasks[d].end})"
                        )

            # 同资源初始冲突。
            for t in list(engine._tasks.values()):
                clashes = engine._conflicts_against(
                    t.task_id, t.resource_id, t.start, t.end
                )
                if clashes:
                    others = ", ".join(c.other_task_id for c in clashes)
                    raise SnapshotError(
                        f"资源 {t.resource_id!r} 上任务 {t.task_id!r} 与 "
                        f"{others} 时间重叠"
                    )
        except SnapshotError:
            raise
        except ScheduleError as exc:  # 防御性：其余引擎错误包装成快照错误
            raise SnapshotError(f"快照一致性校验失败：{exc}") from exc

        return engine

    @classmethod
    def load(cls, path: str) -> "ScheduleEngine":
        """从 JSON 快照文件重建引擎；文件损坏 / 不一致抛 SnapshotError。"""

        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError as exc:
            raise SnapshotError(f"快照文件不存在：{path}") from exc
        except json.JSONDecodeError as exc:
            raise SnapshotError(
                f"快照文件不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）："
                f"{exc.msg}"
            ) from exc
        except OSError as exc:
            raise SnapshotError(f"读取快照文件失败：{exc}") from exc
        return cls.from_dict(data)
