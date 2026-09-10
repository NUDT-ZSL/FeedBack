"""分布式任务调度协调模块（离线模拟版）。

本模块实现调度器的"大脑":class:`Scheduler`，工作节点只负责执行，节点之间
不进行真实网络通信，所有消息传递都通过对 Scheduler 的直接方法调用来模拟。

核心概念
--------

- **逻辑时钟**：一个单调递增的非负整数，由 :meth:`Scheduler.tick` 显式推进，
  与墙上时间无关，便于在单元测试中注入确定性的时间。
- **调度表达式**：简化的 cron 风格表达式，取值见下。
- **租约（lease）**：节点 acquire 到任务后持有租约，租约到期前其他节点不能抢占；
  节点通过 heartbeat 批量续约自己持有的任务。

调度表达式语法（不支持范围语法 ``a-b``）
---------------------------------------

- ``"7"``：只在逻辑时钟第 7 个单位触发；
- ``"*/5"``：从第 5 个时钟单位起，每 5 个单位触发一次（5, 10, 15, ...），
  时钟 0 永远不触发任何任务；
- ``"3,7"``：在第 3、第 7 个单位触发，逗号分隔多值；
- ``"*/5,7"``：上述集合取并集；一个表达式中最多出现一个 ``*/n`` 分段。

租约过期边界规则（重要）
-----------------------

采用 **闭区间失效** 规则，tick 与 acquire 走同一个判定函数
:meth:`Scheduler._lease_expired`，不存在两份比较逻辑：

    ``lease_expire_at <= 当前时钟`` 即视为过期。

等价地说，当 ``当前时钟 >= lease_expire_at`` 时租约失效——
``lease_expire_at == 当前时钟`` 的那一刻任务就已经失联、可被重新分配。
例如租约长度为 3、在时钟 2 续约，则 ``lease_expire_at = 5``：时钟 4 时租约
仍然有效（4 < 5），时钟 5 时立即失效（5 <= 5）。判定在每次 ``tick()`` 与
``acquire()`` 之前进行。

同一时钟单位的去重
------------------

任务在某个时钟单位最多被一个节点持有一次。任务记录 ``last_fired_at``，
即使持有者在同一个时钟单位内主动下线（``remove_node``）或任务被回收，
该任务在这个时钟单位也不会再次被分配出去，必须等到下一个触发点。
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

__all__ = ["Scheduler", "Task", "Node", "SchedulerError", "SNAPSHOT_VERSION"]

SNAPSHOT_VERSION = 1

_INT_RE = re.compile(r"^[0-9]+$")


class SchedulerError(Exception):
    """调度器领域错误：非法参数、重复注册、未注册节点、快照损坏等。"""


@dataclass
class Task:
    """一个可调度任务的内部状态。

    Attributes:
        task_id: 唯一任务 id（非空字符串）。
        schedule: 原始调度表达式，例如 ``"*/5,7"``。
        ticks: 表达式中显式列举的触发时钟集合（解析结果）。
        period: ``*/n`` 中的步长 n；没有步长分段时为 None。
        owner: 当前持有节点的 node_id；未分配时为 None。
        lease_expire_at: 租约到期的逻辑时钟；未分配时为 None。
        last_fired_at: 上一次被分配（触发）时的逻辑时钟。
    """

    task_id: str
    schedule: str
    ticks: frozenset
    period: Optional[int]
    owner: Optional[str] = None
    lease_expire_at: Optional[int] = None
    last_fired_at: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """返回可安全暴露给外部的详情副本（值拷贝，不含内部对象引用）。"""
        return {
            "task_id": self.task_id,
            "schedule": self.schedule,
            "period": self.period,
            "ticks": sorted(self.ticks),
            "owner": self.owner,
            "lease_expire_at": self.lease_expire_at,
            "last_fired_at": self.last_fired_at,
        }


@dataclass
class Node:
    """一个工作节点的内部状态。

    Attributes:
        node_id: 唯一节点 id（非空字符串）。
        last_heartbeat: 最近一次心跳的逻辑时钟；注册即视为一次心跳。
        tasks: 该节点当前持有的 task_id 集合。
    """

    node_id: str
    last_heartbeat: Optional[int]
    tasks: Set[str] = field(default_factory=set)

    def to_dict(self) -> Dict[str, Any]:
        """返回可安全暴露给外部的详情副本。"""
        return {
            "node_id": self.node_id,
            "last_heartbeat": self.last_heartbeat,
            "tasks": sorted(self.tasks),
        }


def _is_plain_int(value: Any) -> bool:
    """判断是否为真正的 int（排除 bool，因为 True/False 是 int 的子类）。"""
    return isinstance(value, int) and not isinstance(value, bool)


class Scheduler:
    """协调器：维护任务表、节点表与逻辑时钟，负责任务分配与故障转移。

    Args:
        lease_duration: 租约长度（逻辑时钟单位），必须为正整数，默认 3。
    """

    def __init__(self, lease_duration: int = 3) -> None:
        if not _is_plain_int(lease_duration) or lease_duration < 1:
            raise SchedulerError("lease_duration 必须是正整数")
        self._clock: int = 0
        self._lease_duration: int = lease_duration
        self._tasks: Dict[str, Task] = {}
        self._nodes: Dict[str, Node] = {}

    # ------------------------------------------------------------------ #
    # 调度表达式
    # ------------------------------------------------------------------ #
    @staticmethod
    def parse_schedule(schedule: Any) -> Tuple[frozenset, Optional[int]]:
        """解析调度表达式，返回 ``(显式触发时钟集合, 步长)``。

        Raises:
            SchedulerError: 表达式为空、含非数字、负数、零、非法步长等。
        """
        if not isinstance(schedule, str):
            raise SchedulerError("schedule 必须是非空字符串")
        text = schedule.strip()
        if not text:
            raise SchedulerError("schedule 不能为空串")

        ticks: Set[int] = set()
        period: Optional[int] = None
        for raw_part in text.split(","):
            part = raw_part.strip()
            if not part:
                raise SchedulerError(f"调度表达式含空分段: {schedule!r}")
            if part.startswith("*/"):
                num = part[2:].strip()
                if not _INT_RE.match(num):
                    raise SchedulerError(f"非法步长分段: {raw_part!r}")
                step = int(num)
                if step < 1:
                    raise SchedulerError(f"步长必须是正整数: {raw_part!r}")
                if period is not None:
                    raise SchedulerError("一个调度表达式中最多只能有一个 */n 分段")
                period = step
            else:
                if not _INT_RE.match(part):
                    raise SchedulerError(
                        f"调度分段必须是非负整数字面量: {raw_part!r}"
                    )
                value = int(part)
                if value == 0:
                    raise SchedulerError("逻辑时钟从 1 开始触发，不允许使用 0")
                ticks.add(value)
        return frozenset(ticks), period

    @staticmethod
    def _matches(ticks: frozenset, period: Optional[int], clock: int) -> bool:
        """判断 ``clock`` 是否命中调度表达式。时钟 0 永不命中。"""
        if clock <= 0:
            return False
        if clock in ticks:
            return True
        if period is not None and clock % period == 0:
            return True
        return False

    def _is_due(self, task: Task) -> bool:
        """任务当前是否到了触发点且本时钟单位尚未被分配过。"""
        return (
            task.owner is None
            and task.last_fired_at != self._clock
            and self._matches(task.ticks, task.period, self._clock)
        )

    # ------------------------------------------------------------------ #
    # 注册
    # ------------------------------------------------------------------ #
    def register_task(self, task_id: str, schedule: str) -> None:
        """注册一个新任务。重复 task_id 报错，绝不静默覆盖。"""
        if not isinstance(task_id, str) or not task_id.strip():
            raise SchedulerError("task_id 必须是非空字符串")
        if task_id in self._tasks:
            raise SchedulerError(f"任务已存在: {task_id!r}")
        ticks, period = self.parse_schedule(schedule)
        self._tasks[task_id] = Task(
            task_id=task_id,
            schedule=schedule.strip(),
            ticks=ticks,
            period=period,
        )

    def add_node(self, node_id: str) -> None:
        """注册一个新工作节点。重复 node_id 报错；注册时刻记为首次心跳。"""
        if not isinstance(node_id, str) or not node_id.strip():
            raise SchedulerError("node_id 必须是非空字符串")
        if node_id in self._nodes:
            raise SchedulerError(f"节点已存在: {node_id!r}")
        self._nodes[node_id] = Node(node_id=node_id, last_heartbeat=self._clock)

    def remove_node(self, node_id: str) -> List[str]:
        """节点主动下线：立即释放它持有的全部任务。

        Returns:
            被释放的 task_id 列表（排序后）。
        """
        node = self._nodes.get(node_id)
        if node is None:
            raise SchedulerError(f"节点未注册: {node_id!r}")
        released = sorted(node.tasks)
        for task_id in released:
            task = self._tasks.get(task_id)
            if task is not None:
                task.owner = None
                task.lease_expire_at = None
        del self._nodes[node_id]
        return released

    # ------------------------------------------------------------------ #
    # 时钟 / 心跳 / 租约
    # ------------------------------------------------------------------ #
    @property
    def clock(self) -> int:
        """当前逻辑时钟。"""
        return self._clock

    @property
    def lease_duration(self) -> int:
        """租约长度（逻辑时钟单位）。"""
        return self._lease_duration

    def tick(self, n: int = 1) -> int:
        """把逻辑时钟向前推进 ``n`` 个单位，然后做一次失联/租约回收。

        中间时钟没有观察者，在最终时刻检查一次与逐单位检查等价（任务只在
        ``acquire`` 时按当时时钟分配）。
        """
        if not _is_plain_int(n) or n < 1:
            raise SchedulerError("tick 的参数 n 必须是正整数")
        self._clock += n
        self._reap_expired_leases()
        return self._clock

    def heartbeat(self, node_id: str) -> List[str]:
        """节点心跳：把该节点持有的所有任务续约到 ``当前时钟 + 租约长度``。

        只能续约节点自己持有的任务；未注册节点心跳报错。
        Returns:
            本次续约的 task_id 列表（排序后）。
        """
        node = self._nodes.get(node_id)
        if node is None:
            raise SchedulerError(f"节点未注册: {node_id!r}")
        node.last_heartbeat = self._clock
        renewed: List[str] = []
        for task_id in sorted(node.tasks):
            task = self._tasks.get(task_id)
            # 不变式上 task.owner 一定是本节点；防御性校验避免续约他人任务。
            if task is not None and task.owner == node_id:
                task.lease_expire_at = self._clock + self._lease_duration
                renewed.append(task_id)
        return renewed

    def _reap_expired_leases(self) -> None:
        """回收所有到期租约，owner 清空。过期规则见 :meth:`_lease_expired`。"""
        for task in self._tasks.values():
            if task.owner is not None and self._lease_expired(
                task.lease_expire_at, self._clock
            ):
                owner_node = self._nodes.get(task.owner)
                if owner_node is not None:
                    owner_node.tasks.discard(task.task_id)
                task.owner = None
                task.lease_expire_at = None

    @staticmethod
    def _lease_expired(lease_expire_at: Optional[int], clock: int) -> bool:
        """唯一的租约过期判定：``lease_expire_at <= clock`` 即过期。

        无租约（None）的任务不参与回收（调用方已先检查 owner）。
        tick 与 acquire 两条路径都经由 :meth:`_reap_expired_leases` 调用本方法。
        """
        return lease_expire_at is not None and lease_expire_at <= clock

    # ------------------------------------------------------------------ #
    # 分配 / 完成
    # ------------------------------------------------------------------ #
    def acquire(self, node_id: str) -> List[Dict[str, Any]]:
        """工作节点拉取任务。

        先做失联回收，再把所有"当前时钟命中调度表达式、没有有效租约、本时钟
        单位尚未分配过"的任务一次性分配给该节点，并发放长度为
        ``lease_duration`` 的新租约。同一时钟单位内连续调用（无论是否同一
        节点）不会重复分配。

        Returns:
            本次新分配任务的租约信息列表，按 task_id 排序，每个元素为
            ``{"task_id", "lease_expire_at", "schedule"}``；没有新任务时
            返回空列表。注意只包含本次新拿到的任务，不含该节点之前已持有、
            只是仍在租约内的任务。
        """
        node = self._nodes.get(node_id)
        if node is None:
            raise SchedulerError(f"节点未注册: {node_id!r}")
        self._reap_expired_leases()

        acquired: List[Dict[str, Any]] = []
        for task_id in sorted(self._tasks):
            task = self._tasks[task_id]
            if not self._is_due(task):
                continue
            expire_at = self._clock + self._lease_duration
            task.owner = node_id
            task.lease_expire_at = expire_at
            task.last_fired_at = self._clock
            node.tasks.add(task_id)
            acquired.append(
                {
                    "task_id": task_id,
                    "lease_expire_at": expire_at,
                    "schedule": task.schedule,
                }
            )
        return acquired

    def complete(self, node_id: str, task_id: str) -> None:
        """任务完成上报。只有任务的当前 owner 可以上报，否则报错。

        完成后释放租约，任务在后续触发点可以再次被分配；同一时钟单位内
        不会立即被重新 acquire（见模块文档的去重规则）。
        """
        if node_id not in self._nodes:
            raise SchedulerError(f"节点未注册: {node_id!r}")
        task = self._tasks.get(task_id)
        if task is None:
            raise SchedulerError(f"任务未注册: {task_id!r}")
        if task.owner != node_id:
            raise SchedulerError(
                f"任务 {task_id!r} 不属于节点 {node_id!r}"
                f"（当前 owner: {task.owner!r}）"
            )
        self._nodes[node_id].tasks.discard(task_id)
        task.owner = None
        task.lease_expire_at = None

    # ------------------------------------------------------------------ #
    # 状态查询
    # ------------------------------------------------------------------ #
    def get_task(self, task_id: str) -> Dict[str, Any]:
        """返回任务当前详情；任务不存在时报错。"""
        task = self._tasks.get(task_id)
        if task is None:
            raise SchedulerError(f"任务未注册: {task_id!r}")
        return task.to_dict()

    def get_node(self, node_id: str) -> Dict[str, Any]:
        """返回节点详情及其持有的任务；节点不存在时报错。"""
        node = self._nodes.get(node_id)
        if node is None:
            raise SchedulerError(f"节点未注册: {node_id!r}")
        return node.to_dict()

    def list_tasks(self) -> List[Dict[str, Any]]:
        """返回所有任务详情，按 task_id 排序。"""
        return [self._tasks[tid].to_dict() for tid in sorted(self._tasks)]

    def list_nodes(self) -> List[Dict[str, Any]]:
        """返回所有节点详情，按 node_id 排序。"""
        return [self._nodes[nid].to_dict() for nid in sorted(self._nodes)]

    def get_orphaned_tasks(self) -> List[str]:
        """返回"已到触发点但当前没有 owner"的任务 id。

        用于排查调度积压。注意本方法是纯查询，不推进失联判定：租约刚到期、
        但还没有任何一次 ``tick()``/``acquire()`` 触发回收的任务仍挂在原
        owner 名下，不会出现在这里。
        """
        return [
            tid
            for tid in sorted(self._tasks)
            if self._is_due(self._tasks[tid])
        ]

    # ------------------------------------------------------------------ #
    # 快照持久化
    # ------------------------------------------------------------------ #
    def snapshot(self) -> Dict[str, Any]:
        """导出可 JSON 序列化的完整状态快照。"""
        return {
            "version": SNAPSHOT_VERSION,
            "clock": self._clock,
            "lease_duration": self._lease_duration,
            "tasks": [
                {
                    "task_id": t.task_id,
                    "schedule": t.schedule,
                    "owner": t.owner,
                    "lease_expire_at": t.lease_expire_at,
                    "last_fired_at": t.last_fired_at,
                }
                for t in (self._tasks[tid] for tid in sorted(self._tasks))
            ],
            "nodes": [
                {
                    "node_id": n.node_id,
                    "last_heartbeat": n.last_heartbeat,
                    "tasks": sorted(n.tasks),
                }
                for n in (self._nodes[nid] for nid in sorted(self._nodes))
            ],
        }

    def save(self, path: str) -> None:
        """把快照原子写入 ``path``（UTF-8、带缩进）。

        先在目标同目录写临时文件并 fsync，再用 ``os.replace`` 原子替换：
        序列化失败、写盘失败或替换失败都不会破坏已有的目标文件，也不会
        留下半个快照；失败时清理临时文件并抛 :class:`SchedulerError`。
        """
        payload = json.dumps(self.snapshot(), ensure_ascii=False, indent=2) + "\n"
        directory = os.path.dirname(os.path.abspath(path))
        tmp_path: Optional[str] = None
        try:
            fd, tmp_path = tempfile.mkstemp(
                prefix=".snapshot-", suffix=".tmp", dir=directory
            )
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(payload)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, path)
        except OSError as exc:
            if tmp_path is not None:
                with contextlib.suppress(OSError):
                    os.remove(tmp_path)
            raise SchedulerError(f"写入快照文件失败: {exc}")

    @classmethod
    def restore(cls, data: Any) -> "Scheduler":
        """从快照字典重建 Scheduler，并严格校验一致性。

        Raises:
            SchedulerError: 字段缺失/类型错误/引用悬空/双向关系不一致/
                last_fired_at 与调度表达式矛盾等。
        """

        def need(container: Any, key: str) -> Any:
            if not isinstance(container, dict) or key not in container:
                raise SchedulerError(f"快照缺少字段: {key!r}")
            return container[key]

        if not isinstance(data, dict):
            raise SchedulerError("快照根节点必须是 JSON 对象")
        version = need(data, "version")
        if version != SNAPSHOT_VERSION:
            raise SchedulerError(
                f"不支持的快照版本: {version!r}，期望 {SNAPSHOT_VERSION}"
            )
        clock = need(data, "clock")
        if not _is_plain_int(clock) or clock < 0:
            raise SchedulerError("快照字段 clock 必须是非负整数")
        lease_duration = need(data, "lease_duration")
        if not _is_plain_int(lease_duration) or lease_duration < 1:
            raise SchedulerError("快照字段 lease_duration 必须是正整数")

        raw_nodes = need(data, "nodes")
        raw_tasks = need(data, "tasks")
        if not isinstance(raw_nodes, list) or not isinstance(raw_tasks, list):
            raise SchedulerError("快照字段 nodes/tasks 必须是数组")

        # ---- 先建节点表 ----
        nodes: Dict[str, Node] = {}
        for index, item in enumerate(raw_nodes):
            if not isinstance(item, dict):
                raise SchedulerError(f"nodes[{index}] 必须是对象")
            node_id = need(item, "node_id")
            if not isinstance(node_id, str) or not node_id.strip():
                raise SchedulerError(f"nodes[{index}].node_id 必须是非空字符串")
            if node_id in nodes:
                raise SchedulerError(f"快照中节点重复: {node_id!r}")
            last_heartbeat = need(item, "last_heartbeat")
            if last_heartbeat is not None:
                if (
                    not _is_plain_int(last_heartbeat)
                    or not (0 <= last_heartbeat <= clock)
                ):
                    raise SchedulerError(
                        f"节点 {node_id!r} 的 last_heartbeat 必须落在 [0, clock]"
                    )
            task_ids = need(item, "tasks")
            if not isinstance(task_ids, list) or not all(
                isinstance(x, str) for x in task_ids
            ):
                raise SchedulerError(f"节点 {node_id!r} 的 tasks 必须是字符串数组")
            if len(set(task_ids)) != len(task_ids):
                raise SchedulerError(f"节点 {node_id!r} 的 tasks 含重复项")
            nodes[node_id] = Node(
                node_id=node_id,
                last_heartbeat=last_heartbeat,
                tasks=set(task_ids),
            )

        # ---- 再建任务表并做引用校验 ----
        tasks: Dict[str, Task] = {}
        for index, item in enumerate(raw_tasks):
            if not isinstance(item, dict):
                raise SchedulerError(f"tasks[{index}] 必须是对象")
            task_id = need(item, "task_id")
            if not isinstance(task_id, str) or not task_id.strip():
                raise SchedulerError(f"tasks[{index}].task_id 必须是非空字符串")
            if task_id in tasks:
                raise SchedulerError(f"快照中任务重复: {task_id!r}")
            schedule = need(item, "schedule")
            try:
                ticks, period = cls.parse_schedule(schedule)
            except SchedulerError as exc:
                raise SchedulerError(f"任务 {task_id!r} 的调度表达式非法: {exc}")

            owner = need(item, "owner")
            lease_expire_at = need(item, "lease_expire_at")
            last_fired_at = need(item, "last_fired_at")

            if owner is not None and not isinstance(owner, str):
                raise SchedulerError(f"任务 {task_id!r} 的 owner 必须是字符串或 null")
            if lease_expire_at is not None:
                if not _is_plain_int(lease_expire_at) or lease_expire_at < 0:
                    raise SchedulerError(
                        f"任务 {task_id!r} 的 lease_expire_at 不能是负数"
                    )
            if last_fired_at is not None:
                if not _is_plain_int(last_fired_at) or not (
                    0 <= last_fired_at <= clock
                ):
                    raise SchedulerError(
                        f"任务 {task_id!r} 的 last_fired_at 必须落在 [0, clock]"
                    )
                if not cls._matches(ticks, period, last_fired_at):
                    raise SchedulerError(
                        f"任务 {task_id!r} 的 last_fired_at={last_fired_at} "
                        f"不命中其调度表达式 {schedule!r}"
                    )

            if owner is None and lease_expire_at is not None:
                raise SchedulerError(
                    f"任务 {task_id!r} 没有 owner 却带有 lease_expire_at"
                )
            if owner is not None:
                if lease_expire_at is None:
                    raise SchedulerError(
                        f"任务 {task_id!r} 有 owner 却缺少 lease_expire_at"
                    )
                if owner not in nodes:
                    raise SchedulerError(
                        f"任务 {task_id!r} 的 owner {owner!r} 不存在于节点表"
                    )

            tasks[task_id] = Task(
                task_id=task_id,
                schedule=schedule.strip(),
                ticks=ticks,
                period=period,
                owner=owner,
                lease_expire_at=lease_expire_at,
                last_fired_at=last_fired_at,
            )

        # ---- 双向引用一致性 ----
        for node_id, node in nodes.items():
            for task_id in node.tasks:
                if task_id not in tasks:
                    raise SchedulerError(
                        f"节点 {node_id!r} 持有不存在的任务 {task_id!r}"
                    )
                if tasks[task_id].owner != node_id:
                    raise SchedulerError(
                        f"节点 {node_id!r} 持有任务 {task_id!r}，"
                        f"但任务 owner 是 {tasks[task_id].owner!r}"
                    )
        for task_id, task in tasks.items():
            if task.owner is not None and task_id not in nodes[task.owner].tasks:
                raise SchedulerError(
                    f"任务 {task_id!r} 的 owner 是 {task.owner!r}，"
                    f"但该节点的任务集合中没有它"
                )

        scheduler = cls(lease_duration=lease_duration)
        scheduler._clock = clock
        scheduler._tasks = tasks
        scheduler._nodes = nodes
        return scheduler

    @classmethod
    def load(cls, path: str) -> "Scheduler":
        """从 JSON 快照文件重建 Scheduler。文件损坏/非法时抛 SchedulerError。"""
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise SchedulerError(f"快照文件不存在: {path!r}")
        except UnicodeDecodeError as exc:
            raise SchedulerError(f"快照文件不是合法的 UTF-8 文本: {exc}")
        except json.JSONDecodeError as exc:
            raise SchedulerError(
                f"快照文件不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: "
                f"{exc.msg}"
            )
        except OSError as exc:
            raise SchedulerError(f"读取快照文件失败: {exc}")
        return cls.restore(data)
