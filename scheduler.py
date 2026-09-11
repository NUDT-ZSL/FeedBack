"""scheduler.py — 可嵌入的逻辑时钟截止时间调度内核。

设计要点
========
* :class:`Task` 是不可变 dataclass，表示一个带绝对截止时刻的任务。
* :class:`DeadlineScheduler` 维护一个从 0 开始、只增不减的逻辑时钟，
  所有超时判定只基于逻辑时钟，**完全不读取系统墙上时间**。
* 核心结构是最小堆，堆元素为 ``(deadline, priority, task_id)``：
  deadline 小的先触发；同一 deadline 下 priority 数值小的先触发；
  再相同则 task_id 字典序在前。
* 取消采用**惰性删除**：取消时只把任务从活跃表移到取消记录表，堆条目原地
  保留；堆条目在 ``poll_expired`` / ``peek_next`` 弹出堆顶时才被跳过和摘除。
  因此取消操作不需要从堆中部删除元素，永远不会破坏堆序。

超时边界规则（详见 README）
==========================
``deadline <= clock`` 即视为超时。也就是说 **deadline 恰好等于当前逻辑时钟
的那一刻，任务已经算超时**（半开区间语义：触发时刻点本身到期）。

仅依赖 Python 标准库（``heapq`` / ``dataclasses`` / ``json`` / ``pathlib``）。
"""

from __future__ import annotations

import heapq
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

#: 快照格式版本号。load 时只接受相同主版本。
SNAPSHOT_VERSION = 1

#: 堆条目：(绝对截止时刻, 优先级, 任务 id)
HeapEntry = Tuple[int, int, str]


class SchedulerError(Exception):
    """内核的可预期错误。

    包括：非法任务字段、task_id 重复、时钟回退、超过内存上限、
    取消不存在的任务、快照文件损坏或一致性校验失败等。
    调用方可以捕获这一个异常类型来处理所有业务错误。
    """


@dataclass(frozen=True)
class Task:
    """一个带截止时间的任务。

    :param task_id: 非空字符串，内核运行期内全局唯一。
    :param owner: 非空字符串，任务来源（提交方标识），用于批量取消。
    :param deadline: 绝对截止时刻，非负整数逻辑时间。
    :param priority: 整数优先级，数值越小越优先（允许负数）。
    :param payload: 任意可被 ``json.dumps`` 序列化的对象，随任务一起返回与持久化。
    """

    task_id: str
    owner: str
    deadline: int
    priority: int
    payload: Any = None


# ---------------------------------------------------------------------------
# 校验与序列化辅助函数
# ---------------------------------------------------------------------------
def _is_real_int(value: Any) -> bool:
    """判断 value 是否是真正的 int。

    ``bool`` 是 ``int`` 的子类，但 ``True/False`` 作为时间或优先级没有意义，
    这里显式拒绝。
    """
    return type(value) is int


def _require_nonempty_str(value: Any, field_name: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise SchedulerError(
            f"{field_name} must be a non-empty string, got {value!r}"
        )


def validate_task(task: Any) -> None:
    """校验一个 :class:`Task` 的全部字段，不合法时抛 :class:`SchedulerError`。"""
    if not isinstance(task, Task):
        raise SchedulerError(f"expected a Task instance, got {type(task).__name__}")
    _require_nonempty_str(task.task_id, "task_id")
    _require_nonempty_str(task.owner, "owner")
    if not _is_real_int(task.deadline) or task.deadline < 0:
        raise SchedulerError(
            f"task {task.task_id!r}: deadline must be a non-negative integer, "
            f"got {task.deadline!r}"
        )
    if not _is_real_int(task.priority):
        raise SchedulerError(
            f"task {task.task_id!r}: priority must be an integer, "
            f"got {task.priority!r}"
        )
    # allow_nan=False：NaN / Infinity 不是合法 JSON，拒绝掉。
    try:
        json.dumps(task.payload, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise SchedulerError(
            f"task {task.task_id!r}: payload is not JSON-serializable: {exc}"
        ) from exc


def task_to_dict(task: Task) -> Dict[str, Any]:
    """把 Task 转成稳定字段顺序的普通 dict。"""
    return {
        "task_id": task.task_id,
        "owner": task.owner,
        "deadline": task.deadline,
        "priority": task.priority,
        "payload": task.payload,
    }


def task_from_dict(obj: Any) -> Task:
    """从用户输入的 JSON 对象构造 Task，缺字段/多字段/类型错误都会报错。"""
    if not isinstance(obj, dict):
        raise SchedulerError(f"task must be a JSON object, got {type(obj).__name__}")
    required = ("task_id", "owner", "deadline", "priority")
    for key in required:
        if key not in obj:
            raise SchedulerError(f"task is missing required field {key!r}")
    if "payload" not in obj:
        payload = None
    else:
        payload = obj["payload"]
    extras = set(obj) - set(required) - {"payload"}
    if extras:
        raise SchedulerError(f"task has unknown fields: {sorted(extras)}")
    task = Task(
        task_id=obj["task_id"],
        owner=obj["owner"],
        deadline=obj["deadline"],
        priority=obj["priority"],
        payload=payload,
    )
    validate_task(task)
    return task


# ---------------------------------------------------------------------------
# 内核
# ---------------------------------------------------------------------------
class DeadlineScheduler:
    """逻辑时钟驱动的截止时间调度内核。

    :param max_tasks: 活跃任务数上限。``None`` 表示精确模式（无上限）；
        传入非负整数表示受限模式，活跃任务数达到上限后新的 ``register``
        会被**拒绝**并抛出 :class:`SchedulerError`，不会静默丢弃。
        ``0`` 表示一个任务都不允许注册。
    """

    def __init__(self, max_tasks: Optional[int] = None) -> None:
        if max_tasks is not None:
            if not _is_real_int(max_tasks) or max_tasks < 0:
                raise SchedulerError(
                    "max_tasks must be a non-negative integer or None, "
                    f"got {max_tasks!r}"
                )
        self._max_tasks: Optional[int] = max_tasks
        self._clock: int = 0
        # 最小堆：只做 heappush / heappop，不做中部删除，堆序始终成立。
        self._heap: List[HeapEntry] = []
        # 活跃任务：task_id -> Task（已取消 / 已超时弹出的任务不在此表中）。
        self._tasks: Dict[str, Task] = {}
        # 已取消任务的完整记录（取消是惰性的，堆条目可能尚未摘除）。
        self._cancelled_tasks: Dict[str, Task] = {}
        # 运行期内见过的全部 task_id，保证运行期内全局唯一。
        self._known_ids: set = set()
        # 累计已超时弹出的任务数。
        self._expired_count: int = 0

    # -- 基本属性 ----------------------------------------------------------
    @property
    def clock(self) -> int:
        """当前逻辑时钟（绝对逻辑时间）。"""
        return self._clock

    @property
    def max_tasks(self) -> Optional[int]:
        """活跃任务数上限，``None`` 表示无上限。"""
        return self._max_tasks

    # -- 时钟 --------------------------------------------------------------
    def advance_to(self, t: int) -> int:
        """把逻辑时钟推进到 ``t``（单调不减）。

        推进本身**不会**自动弹出任务，是否取出超时任务由调用方显式
        :meth:`poll_expired` 决定。允许推进到当前值（空操作）。

        :raises SchedulerError: ``t`` 不是非负整数，或小于当前时钟（回退）。
        """
        if not _is_real_int(t) or t < 0:
            raise SchedulerError(
                f"advance target must be a non-negative integer, got {t!r}"
            )
        if t < self._clock:
            raise SchedulerError(
                f"logical clock cannot go backwards: current={self._clock}, "
                f"attempted={t}"
            )
        self._clock = t
        return self._clock

    # -- 注册 / 取消 -------------------------------------------------------
    def register(self, task: Task) -> Task:
        """注册一个新任务并放入堆中。

        允许注册 ``deadline <= 当前时钟`` 的任务：它会在下一次
        :meth:`poll_expired` 时立即被取出。

        :raises SchedulerError: 字段非法、task_id 在运行期内重复、
            或活跃任务数已达到 ``max_tasks`` 上限。
        """
        validate_task(task)
        if task.task_id in self._known_ids:
            raise SchedulerError(
                f"duplicate task_id {task.task_id!r}: task_id must be unique "
                f"for the lifetime of the kernel"
            )
        if self._max_tasks is not None and len(self._tasks) >= self._max_tasks:
            raise SchedulerError(
                f"active task limit reached: max_tasks={self._max_tasks}, "
                f"active={len(self._tasks)}; cancel or poll tasks before "
                f"registering new ones"
            )
        self._tasks[task.task_id] = task
        self._known_ids.add(task.task_id)
        heapq.heappush(
            self._heap, (task.deadline, task.priority, task.task_id)
        )
        return task

    def cancel(self, task_id: str) -> bool:
        """取消单个任务（惰性删除）。

        任务从活跃表移到取消记录表，堆条目保留到日后弹出时跳过。
        成功返回 ``True``。

        :raises SchedulerError: task_id 不是非空字符串、任务不存在
            （从未注册或已超时弹出）、或任务已经被取消过。
        """
        _require_nonempty_str(task_id, "task_id")
        task = self._tasks.pop(task_id, None)
        if task is not None:
            self._cancelled_tasks[task_id] = task
            return True
        if task_id in self._cancelled_tasks:
            raise SchedulerError(f"task {task_id!r} is already cancelled")
        raise SchedulerError(
            f"task {task_id!r} not found (never registered or already expired)"
        )

    def cancel_by_owner(self, owner: str) -> int:
        """批量取消某来源的全部**活跃**任务，返回实际取消的数量。

        没有该 owner 的活跃任务时返回 ``0``（不算错误）。
        """
        _require_nonempty_str(owner, "owner")
        ids = [
            tid for tid, task in self._tasks.items() if task.owner == owner
        ]
        for tid in ids:
            self._cancelled_tasks[tid] = self._tasks.pop(tid)
        return len(ids)

    # -- 内部：惰性删除 -----------------------------------------------------
    def _drop_stale_heap_root(self) -> None:
        """只要堆顶是惰性删除条目（已取消/已弹出），就摘掉它。

        堆中部的惰性条目不动；它们会在将来升到堆顶时被同样跳过。
        """
        while self._heap:
            _, _, task_id = self._heap[0]
            if task_id in self._tasks:
                return
            heapq.heappop(self._heap)

    # -- 查询 --------------------------------------------------------------
    def peek_next(self) -> Optional[int]:
        """返回下一个未取消任务的最早 deadline；没有任何活跃任务时返回 ``None``。

        调用会顺带清理堆顶连续的惰性删除条目，因此“堆里只剩已取消任务”
        的情况下返回 ``None``。
        """
        self._drop_stale_heap_root()
        if not self._heap:
            return None
        return self._heap[0][0]

    def poll_expired(self) -> List[Task]:
        """取出当前时钟下所有已超时且未取消的任务。

        判定规则：``deadline <= clock``（deadline 恰好在当前时刻点也算超时）。
        返回顺序严格按 ``(deadline 升序, priority 升序, task_id 升序)``。
        被取出的任务从内核移除，**重复调用不会重复返回**；已取消任务
        永远不会出现在结果里，其堆条目被顺手清理。
        """
        due: List[Task] = []
        while self._heap and self._heap[0][0] <= self._clock:
            deadline, priority, task_id = heapq.heappop(self._heap)
            task = self._tasks.pop(task_id, None)
            if task is None:
                # 惰性删除条目：已取消（已超时弹出的条目本来就不会留在堆里）。
                continue
            # 堆弹出顺序本身就是 (deadline, priority, task_id) 升序，
            # 末尾再显式排序一次，保证即使内部实现调整，对外顺序契约不变。
            due.append(task)
            self._expired_count += 1
        due.sort(key=lambda t: (t.deadline, t.priority, t.task_id))
        return due

    def stats(self) -> Dict[str, Any]:
        """返回内核观测信息。

        键说明：

        * ``clock``：当前逻辑时钟
        * ``active_tasks``：活跃任务数（既没取消也没超时弹出）
        * ``cancelled_tasks``：累计已取消任务数
        * ``expired_tasks``：累计已超时弹出任务数
        * ``heap_stale_entries``：堆中尚未被物理摘除的惰性删除条目数
        * ``heap_size``：堆当前物理长度（= 活跃条目 + 惰性条目）
        * ``active_by_owner``：按 owner 分组的活跃任务计数
        * ``max_tasks``：构造时给定的上限（``None`` 表示无上限）
        """
        stale = sum(
            1 for _, _, task_id in self._heap if task_id not in self._tasks
        )
        by_owner: Dict[str, int] = {}
        for task in self._tasks.values():
            by_owner[task.owner] = by_owner.get(task.owner, 0) + 1
        return {
            "clock": self._clock,
            "active_tasks": len(self._tasks),
            "cancelled_tasks": len(self._cancelled_tasks),
            "expired_tasks": self._expired_count,
            "heap_stale_entries": stale,
            "heap_size": len(self._heap),
            "active_by_owner": dict(sorted(by_owner.items())),
            "max_tasks": self._max_tasks,
        }

    # -- 持久化 -------------------------------------------------------------
    def to_snapshot(self) -> Dict[str, Any]:
        """导出可 JSON 序列化的完整快照（活跃任务 + 取消记录 + 时钟 + 计数）。

        快照是紧凑后的逻辑状态：堆中惰性删除条目不会被写回，重建后的堆
        只包含活跃任务（``heap_stale_entries`` 归零），但所有对外可观测
        语义（时钟、活跃/取消/超时计数、后续 poll 结果）完全一致。
        """
        records: List[Dict[str, Any]] = []
        for task_id in sorted(self._tasks):
            record = task_to_dict(self._tasks[task_id])
            record["cancelled"] = False
            records.append(record)
        for task_id in sorted(self._cancelled_tasks):
            record = task_to_dict(self._cancelled_tasks[task_id])
            record["cancelled"] = True
            records.append(record)
        return {
            "version": SNAPSHOT_VERSION,
            "clock": self._clock,
            "max_tasks": self._max_tasks,
            "tasks": records,
            "stats": {
                "active": len(self._tasks),
                "cancelled": len(self._cancelled_tasks),
                "expired": self._expired_count,
            },
        }

    def save(self, path: os.PathLike) -> None:
        """把快照以 JSON 写入 ``path``。

        先写临时文件再原子替换，避免写到一半时留下损坏的目标文件。
        """
        target = Path(path)
        if target.parent and not target.parent.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + f".{os.getpid()}.tmp")
        try:
            tmp.write_text(
                json.dumps(self.to_snapshot(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            os.replace(tmp, target)
        finally:
            if tmp.exists():
                try:
                    tmp.unlink()
                except OSError:
                    pass

    @classmethod
    def from_snapshot(
        cls, data: Any, source: str = "<snapshot>"
    ) -> "DeadlineScheduler":
        """从已解析的 JSON 对象重建内核并做严格一致性校验。

        :raises SchedulerError: 结构损坏、字段缺失/类型错误、task_id 重复、
            deadline 为负、priority 不是整数、时钟为负、取消标记与任务不对应、
            计数不一致等。错误信息统一带 ``source`` 前缀，便于定位文件。
        """

        def fail(msg: str) -> None:
            raise SchedulerError(f"invalid snapshot {source}: {msg}")

        if not isinstance(data, dict):
            fail(f"top-level value must be an object, got {type(data).__name__}")
        if data.get("version") != SNAPSHOT_VERSION:
            fail(
                f"unsupported version {data.get('version')!r}, "
                f"expected {SNAPSHOT_VERSION}"
            )

        clock = data.get("clock")
        if not _is_real_int(clock) or clock < 0:
            fail(f"clock must be a non-negative integer, got {clock!r}")

        max_tasks = data.get("max_tasks", None)
        if max_tasks is not None and (
            not _is_real_int(max_tasks) or max_tasks < 0
        ):
            fail(
                "max_tasks must be null or a non-negative integer, "
                f"got {max_tasks!r}"
            )

        records = data.get("tasks")
        if not isinstance(records, list):
            fail("'tasks' must be a list")

        active: Dict[str, Task] = {}
        cancelled: Dict[str, Task] = {}
        required_fields = {"task_id", "owner", "deadline", "priority", "payload",
                           "cancelled"}
        for index, record in enumerate(records):
            where = f"tasks[{index}]"
            if not isinstance(record, dict):
                fail(f"{where} must be an object")
            missing = required_fields - set(record)
            if missing:
                fail(f"{where} missing fields: {sorted(missing)}")
            extras = set(record) - required_fields
            if extras:
                fail(f"{where} has unknown fields: {sorted(extras)}")
            if not isinstance(record["cancelled"], bool):
                fail(f"{where}.cancelled must be true or false")
            try:
                task = Task(
                    task_id=record["task_id"],
                    owner=record["owner"],
                    deadline=record["deadline"],
                    priority=record["priority"],
                    payload=record["payload"],
                )
                validate_task(task)
            except SchedulerError as exc:
                fail(f"{where}: {exc}")
            if task.task_id in active or task.task_id in cancelled:
                fail(f"duplicate task_id {task.task_id!r}")
            if record["cancelled"]:
                cancelled[task.task_id] = task
            else:
                active[task.task_id] = task

        stats = data.get("stats")
        if not isinstance(stats, dict):
            fail("'stats' must be an object")
        extras = set(stats) - {"active", "cancelled", "expired"}
        if extras:
            fail(f"stats has unknown fields: {sorted(extras)}")
        for key in ("active", "cancelled", "expired"):
            if key not in stats:
                fail(f"stats missing field {key!r}")
            if not _is_real_int(stats[key]) or stats[key] < 0:
                fail(f"stats.{key} must be a non-negative integer")
        if stats["active"] != len(active):
            fail(
                f"stats.active={stats['active']} does not match number of "
                f"active tasks ({len(active)})"
            )
        if stats["cancelled"] != len(cancelled):
            fail(
                f"stats.cancelled={stats['cancelled']} does not match number "
                f"of cancelled tasks ({len(cancelled)})"
            )
        if max_tasks is not None and len(active) > max_tasks:
            fail(
                f"snapshot has {len(active)} active tasks but max_tasks="
                f"{max_tasks}"
            )

        scheduler = cls(max_tasks=max_tasks)
        scheduler._clock = clock
        scheduler._tasks = active
        scheduler._cancelled_tasks = cancelled
        scheduler._known_ids = set(active) | set(cancelled)
        scheduler._expired_count = stats["expired"]
        # 只重建活跃任务的堆；一次性 heapify，等价于逐个 heappush。
        scheduler._heap = [
            (task.deadline, task.priority, task.task_id)
            for task in active.values()
        ]
        heapq.heapify(scheduler._heap)
        return scheduler

    @classmethod
    def load(cls, path: os.PathLike) -> "DeadlineScheduler":
        """从 JSON 文件读取并重建内核；文件不存在/损坏/不一致都报明确错误。"""
        source = str(path)
        try:
            text = Path(path).read_text(encoding="utf-8")
        except FileNotFoundError:
            raise SchedulerError(f"snapshot file not found: {source}") from None
        except OSError as exc:
            raise SchedulerError(f"cannot read snapshot {source}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SchedulerError(
                f"corrupt snapshot {source}: invalid JSON at line "
                f"{exc.lineno} column {exc.colno}: {exc.msg}"
            ) from exc
        return cls.from_snapshot(data, source=source)
