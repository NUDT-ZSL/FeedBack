"""批处理调度器的准入控制核心。

本模块只做决策与状态维护，不真正执行任务。所有时间量（处理量、
截止时刻、占用区间、当前时刻）都由可注入的逻辑时钟驱动，不读取
任何墙上时间，因此可以离线复现容量紧张、紧急插队等各种场景。

调度语义
--------
* 每个资源有固定的单位时间处理容量；同一资源同一时刻只处理一个
  任务，任务占用区间为 ``[start, end)``，时长 = 处理量 / 容量，
  同一资源上的占用区间互不重叠，任意时间点占用不超过容量。
* 每次准入时，对该资源上所有"尚未开始"（start >= 当前时钟）的
  任务按 (截止时刻升序, 优先级降序, 提交序号升序) 重新紧凑排列；
  已经开始（start < 当前时钟）的任务区间固定不变。
* 已承诺的紧急任务（committed=True）一经准入不得被挤掉：任何新
  任务若会导致某个已承诺任务无法在其截止前完成，新任务必须被拒绝。
* 已承诺任务仅凭重排无法准入时，可以抢占同资源上的非承诺任务为
  其腾位置；被抢占任务记录原因并回到待排（pending）状态，处理量
  与截止时刻保持不变，时钟推进时按 (优先级降序, 截止时刻升序,
  提交序号升序) 重新尝试准入，仍按原优先级参与。
* 拒绝（容量不足 / 截止已过 / 资源不存在 / 标识重复）不会改变
  任何已排入任务；抢占若在最终仍无法准入时也会整体回退。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, List, Optional, Tuple

# 准入拒绝原因
REASON_RESOURCE_NOT_FOUND = "resource_not_found"
REASON_DEADLINE_PASSED = "deadline_passed"
REASON_CAPACITY_INSUFFICIENT = "capacity_insufficient"
REASON_DUPLICATE_TASK_ID = "duplicate_task_id"

# 任务状态
STATUS_SCHEDULED = "scheduled"
STATUS_PENDING = "pending"

# 手动抢占的默认原因
DEFAULT_PREEMPT_REASON = "manual"


class SchedulerError(Exception):
    """操作级错误（非法参数、未知标识、时钟回退、导入校验失败等）。

    与准入拒绝不同：准入拒绝是正常业务结论，通过
    :class:`AdmissionResult` 表达并记入拒绝记录；本异常表示请求
    本身有问题，抛出时系统状态保持不变。
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Resource:
    """资源：单位时间的处理容量。"""

    resource_id: str
    capacity: Fraction


@dataclass
class Task:
    """任务：处理量与截止时刻均按逻辑时钟计量。"""

    task_id: str
    resource_id: str
    amount: Fraction
    deadline: Fraction
    priority: int
    committed: bool
    submit_seq: int
    status: str = STATUS_PENDING
    start: Optional[Fraction] = None
    end: Optional[Fraction] = None


@dataclass
class AdmissionResult:
    """准入结论。admitted=False 时 reason 为拒绝原因。"""

    admitted: bool
    reason: Optional[str] = None
    task: Optional[Task] = None
    preempted: List[str] = field(default_factory=list)


def _as_fraction(value: object, field_name: str) -> Fraction:
    """把 int/Fraction 等数值转换为 Fraction，非法时抛操作级错误。"""
    if isinstance(value, bool):
        raise SchedulerError("invalid_number", f"字段 {field_name} 不是合法数值: {value!r}")
    if isinstance(value, Fraction):
        return value
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, float):
        return Fraction(value)
    raise SchedulerError("invalid_number", f"字段 {field_name} 不是合法数值: {value!r}")


class Scheduler:
    """批处理调度器：维护资源、任务、占用时间线与各类记录。

    所有公开方法都不读取墙上时间；时间只能通过
    :meth:`advance_clock` 推进。
    """

    def __init__(self) -> None:
        self.clock: Fraction = Fraction(0)
        self.resources: Dict[str, Resource] = {}
        self.tasks: Dict[str, Task] = {}
        self.rejections: List[dict] = []
        self.preemptions: List[dict] = []
        self._submit_seq: int = 0
        self._record_seq: int = 0

    # ------------------------------------------------------------------
    # 资源管理
    # ------------------------------------------------------------------
    def register_resource(self, resource_id: str, capacity: object) -> Resource:
        """注册资源。容量必须是非负数值（允许 0，表示永不可用）。"""
        if not isinstance(resource_id, str) or not resource_id:
            raise SchedulerError("invalid_resource_id", f"资源标识非法: {resource_id!r}")
        if resource_id in self.resources:
            raise SchedulerError("duplicate_resource_id", f"资源已存在: {resource_id}")
        cap = _as_fraction(capacity, "capacity")
        if cap < 0:
            raise SchedulerError("invalid_capacity", f"容量不能为负: {cap}")
        resource = Resource(resource_id=resource_id, capacity=cap)
        self.resources[resource_id] = resource
        return resource

    # ------------------------------------------------------------------
    # 任务提交与准入
    # ------------------------------------------------------------------
    def submit_task(
        self,
        task_id: str,
        resource_id: str,
        amount: object,
        deadline: object,
        priority: int = 0,
        committed: bool = False,
    ) -> AdmissionResult:
        """提交任务并给出准入结论。

        拒绝时返回 admitted=False 及原因（资源不存在 / 截止已过 /
        容量不足 / 标识重复），并写入拒绝记录；拒绝不改变任何已排入
        任务。已承诺任务在必要时触发对非承诺任务的抢占；若抢占后仍
        无法准入，则整体回退并拒绝。
        """
        if not isinstance(task_id, str) or not task_id:
            raise SchedulerError("invalid_task_id", f"任务标识非法: {task_id!r}")
        amount_f = _as_fraction(amount, "amount")
        if amount_f <= 0:
            raise SchedulerError("invalid_amount", f"处理量必须为正: {amount_f}")
        deadline_f = _as_fraction(deadline, "deadline")
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise SchedulerError("invalid_priority", f"优先级必须是整数: {priority!r}")
        if not isinstance(committed, bool):
            raise SchedulerError("invalid_committed", f"承诺标记必须是布尔值: {committed!r}")

        if task_id in self.tasks:
            return self._reject(task_id, REASON_DUPLICATE_TASK_ID)
        if resource_id not in self.resources:
            return self._reject(task_id, REASON_RESOURCE_NOT_FOUND)
        if deadline_f <= self.clock:
            return self._reject(task_id, REASON_DEADLINE_PASSED)

        task = Task(
            task_id=task_id,
            resource_id=resource_id,
            amount=amount_f,
            deadline=deadline_f,
            priority=priority,
            committed=committed,
            submit_seq=self._next_submit_seq(),
        )

        placement = self._try_schedule(resource_id, extra=task)
        if placement is not None:
            self.tasks[task_id] = task
            self._apply_placement(placement)
            return AdmissionResult(admitted=True, task=task)

        if committed:
            # 容量紧张：按确定性顺序逐个抢占非承诺任务，直到可准入。
            excluded: List[str] = []
            for victim in self._preemptible_tasks(resource_id):
                excluded.append(victim.task_id)
                placement = self._try_schedule(
                    resource_id, extra=task, excluded=frozenset(excluded)
                )
                if placement is not None:
                    self.tasks[task_id] = task
                    for victim_id in excluded:
                        self._do_preempt(
                            self.tasks[victim_id],
                            reason=f"preempted_for:{task_id}",
                            displaced_by=task_id,
                        )
                    self._apply_placement(placement)
                    return AdmissionResult(
                        admitted=True, task=task, preempted=list(excluded)
                    )
            # 抢占全部非承诺任务仍不可行：不做任何修改，直接拒绝。

        return self._reject(task_id, REASON_CAPACITY_INSUFFICIENT)

    # ------------------------------------------------------------------
    # 抢占
    # ------------------------------------------------------------------
    def preempt_task(self, task_id: str, reason: str = DEFAULT_PREEMPT_REASON) -> dict:
        """手动抢占一个已排入的非承诺任务，使其回到待排状态。

        被抢占任务的处理量与截止时刻保持不变；时钟推进时按原优先级
        重新参与准入。承诺任务不允许被抢占。
        """
        task = self.tasks.get(task_id)
        if task is None:
            raise SchedulerError("task_not_found", f"任务不存在: {task_id}")
        if task.committed:
            raise SchedulerError(
                "cannot_preempt_committed", f"已承诺任务不可被抢占: {task_id}"
            )
        if task.status != STATUS_SCHEDULED:
            raise SchedulerError("task_not_scheduled", f"任务未处于已排入状态: {task_id}")
        return self._do_preempt(task, reason=reason, displaced_by=None)

    def _do_preempt(self, task: Task, reason: str, displaced_by: Optional[str]) -> dict:
        """执行抢占：清空占用区间、回到待排状态并记录。"""
        task.status = STATUS_PENDING
        task.start = None
        task.end = None
        record = {
            "seq": self._next_record_seq(),
            "time": self.clock,
            "task_id": task.task_id,
            "reason": reason,
            "displaced_by": displaced_by,
        }
        self.preemptions.append(record)
        return record

    def _preemptible_tasks(self, resource_id: str) -> List[Task]:
        """可被抢占的任务，按 (优先级升序, 截止时刻降序, 标识升序) 排序。"""
        candidates = [
            t
            for t in self.tasks.values()
            if t.resource_id == resource_id
            and t.status == STATUS_SCHEDULED
            and not t.committed
        ]
        candidates.sort(key=lambda t: (t.priority, -t.deadline, t.task_id))
        return candidates

    # ------------------------------------------------------------------
    # 逻辑时钟
    # ------------------------------------------------------------------
    def advance_clock(self, new_time: object) -> List[str]:
        """把逻辑时钟推进到 new_time（不允许回退）。

        推进后按 (优先级降序, 截止时刻升序, 提交序号升序) 重新尝试
        准入所有待排任务，返回本次被重新准入的任务标识列表。
        """
        moment = _as_fraction(new_time, "time")
        if moment < self.clock:
            raise SchedulerError(
                "invalid_clock", f"时钟不能回退: 当前 {self.clock}, 目标 {moment}"
            )
        self.clock = moment
        return self._retry_pending()

    def _retry_pending(self) -> List[str]:
        """尝试重新准入所有待排任务，返回成功准入的任务标识。"""
        admitted: List[str] = []
        pending = sorted(
            (t for t in self.tasks.values() if t.status == STATUS_PENDING),
            key=lambda t: (-t.priority, t.deadline, t.submit_seq),
        )
        for task in pending:
            if task.deadline <= self.clock:
                continue  # 截止已过，继续留在待排状态
            placement = self._try_schedule(task.resource_id, extra=task)
            if placement is not None:
                self._apply_placement(placement)
                admitted.append(task.task_id)
        return admitted

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def query_occupancy(self, resource_id: str, start: object, end: object) -> dict:
        """查询某资源在 [start, end) 范围内的容量占用。

        返回与范围相交的占用区间（按 (start, end, task_id) 稳定排序）
        以及范围内总的占用时长。
        """
        resource = self.resources.get(resource_id)
        if resource is None:
            raise SchedulerError("resource_not_found", f"资源不存在: {resource_id}")
        begin = _as_fraction(start, "start")
        finish = _as_fraction(end, "end")
        if finish < begin:
            raise SchedulerError("invalid_range", f"时间范围非法: [{begin}, {finish})")
        intervals = []
        total_busy = Fraction(0)
        for task in self.tasks.values():
            if task.resource_id != resource_id or task.status != STATUS_SCHEDULED:
                continue
            assert task.start is not None and task.end is not None
            if task.start < finish and task.end > begin:
                intervals.append(
                    {
                        "task_id": task.task_id,
                        "start": task.start,
                        "end": task.end,
                        "committed": task.committed,
                    }
                )
                total_busy += min(finish, task.end) - max(begin, task.start)
        intervals.sort(key=lambda iv: (iv["start"], iv["end"], iv["task_id"]))
        return {
            "resource_id": resource_id,
            "capacity": resource.capacity,
            "start": begin,
            "end": finish,
            "intervals": intervals,
            "total_busy": total_busy,
        }

    def query_task(self, task_id: str) -> dict:
        """查询任务的排入位置与预计完成时刻（end）。"""
        task = self.tasks.get(task_id)
        if task is None:
            raise SchedulerError("task_not_found", f"任务不存在: {task_id}")
        return {
            "task_id": task.task_id,
            "resource_id": task.resource_id,
            "amount": task.amount,
            "deadline": task.deadline,
            "priority": task.priority,
            "committed": task.committed,
            "status": task.status,
            "start": task.start,
            "end": task.end,
        }

    def query_records(self) -> dict:
        """返回所有被拒绝与被抢占的记录，按发生顺序（seq 升序）。"""
        return {
            "rejections": list(self.rejections),
            "preemptions": list(self.preemptions),
        }

    # ------------------------------------------------------------------
    # 内部：排程与记录
    # ------------------------------------------------------------------
    def _try_schedule(
        self,
        resource_id: str,
        extra: Optional[Task] = None,
        excluded: frozenset = frozenset(),
    ) -> Optional[Dict[str, Tuple[Fraction, Fraction]]]:
        """尝试为资源重排时间线，可行则返回 {任务标识: (start, end)}。

        可行性要求：新任务（extra）在其截止前完成，且所有已承诺的
        可重排任务都在各自截止前完成；已经开始的任务区间固定不动。
        """
        resource = self.resources[resource_id]
        if resource.capacity <= 0:
            return None
        now = self.clock
        fixed_intervals: List[Tuple[Fraction, Fraction]] = []
        movable: List[Task] = []
        for task in self.tasks.values():
            if task.resource_id != resource_id or task.status != STATUS_SCHEDULED:
                continue
            if task.task_id in excluded:
                continue
            assert task.start is not None and task.end is not None
            if task.start < now:
                fixed_intervals.append((task.start, task.end))
            else:
                movable.append(task)
        if extra is not None:
            movable.append(extra)

        cursor = now
        for start, end in fixed_intervals:
            if end > now:
                cursor = max(cursor, end)

        movable.sort(key=lambda t: (t.deadline, -t.priority, t.submit_seq))
        placement: Dict[str, Tuple[Fraction, Fraction]] = {}
        for task in movable:
            duration = task.amount / resource.capacity
            placement[task.task_id] = (cursor, cursor + duration)
            cursor += duration

        for task in movable:
            if task is extra or task.committed:
                _, end = placement[task.task_id]
                if end > task.deadline:
                    return None
        return placement

    def _apply_placement(self, placement: Dict[str, Tuple[Fraction, Fraction]]) -> None:
        """把一次可行排程写回任务状态。"""
        for task_id, (start, end) in placement.items():
            task = self.tasks[task_id]
            task.start = start
            task.end = end
            task.status = STATUS_SCHEDULED

    def _reject(self, task_id: str, reason: str) -> AdmissionResult:
        """记录一次拒绝并返回拒绝结论（不改变任何已排入任务）。"""
        self.rejections.append(
            {
                "seq": self._next_record_seq(),
                "time": self.clock,
                "task_id": task_id,
                "reason": reason,
            }
        )
        return AdmissionResult(admitted=False, reason=reason)

    def _next_submit_seq(self) -> int:
        seq = self._submit_seq
        self._submit_seq += 1
        return seq

    def _next_record_seq(self) -> int:
        seq = self._record_seq
        self._record_seq += 1
        return seq
