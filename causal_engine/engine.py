"""因果一致性快照与部分回放引擎的核心实现。

本模块只使用 Python 标准库，不做任何网络 IO。核心概念：

- :class:`Event`：某个逻辑进程追加的带向量时钟的事件。
- :class:`CausalEngine`：维护进程表、每进程的事件序列与"已知向量"，
  提供因果一致性快照、因果闭包（部分回放）以及 JSON 持久化。

向量时钟约定
-------------
事件 ``e`` 的 ``vector`` 表示事件 *发生之前* 发送进程已知的各进程最大
``seq``（不包含本事件自己）。因此：

- ``vector[e.process_id]`` 必须恰好等于 ``e.seq - 1``；
- 其它进程分量不能超过该进程当前已经产生的最大 ``seq``；
- 发送者此前见过的所有进程都必须继续出现在 vector 中，且各分量不能
  小于此前已知的值（知识单调增长：不丢进程、不回退）。

事件追加成功后，发送进程的当前向量更新为
``max(旧向量, event.vector)``，再把自己的分量置为 ``event.seq``。
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from causal_engine.exceptions import (
    DuplicateEventError,
    DuplicateProcessError,
    InconsistentSnapshotError,
    InvalidCutError,
    InvalidEventError,
    PersistenceError,
    UnknownEventError,
    UnknownProcessError,
)

SNAPSHOT_FORMAT = "causal-engine-snapshot"
SNAPSHOT_VERSION = 1


def _is_int(value: object) -> bool:
    """判断是否为真正的整数（排除 ``bool``）。"""
    return isinstance(value, int) and not isinstance(value, bool)


def _is_non_empty_str(value: object) -> bool:
    """判断是否为非空字符串。"""
    return isinstance(value, str) and value != ""


@dataclass(frozen=True)
class Event:
    """带向量时钟的不可变事件。

    :param event_id: 全局唯一的非空事件标识。
    :param process_id: 产生该事件的逻辑进程标识（必须已注册）。
    :param seq: 进程内单调连续递增的序号，从 1 开始。
    :param vector: 事件发生前的向量时钟，``process_id -> 已知最大 seq``。
    :param payload: 任意可 JSON 序列化的负载。
    """

    event_id: str
    process_id: str
    seq: int
    vector: dict[str, int] = field(default_factory=dict)
    payload: Any = None

    def __post_init__(self) -> None:
        if not _is_non_empty_str(self.event_id):
            raise InvalidEventError("event_id must be a non-empty string")
        if not _is_non_empty_str(self.process_id):
            raise InvalidEventError("process_id must be a non-empty string")
        if not _is_int(self.seq) or self.seq < 1:
            raise InvalidEventError(
                f"seq must be an integer >= 1 for event {self.event_id!r}, "
                f"got {self.seq!r}"
            )
        if not isinstance(self.vector, Mapping):
            raise InvalidEventError(
                f"vector must be a dict for event {self.event_id!r}"
            )
        checked_vector: dict[str, int] = {}
        for pid, value in self.vector.items():
            if not _is_non_empty_str(pid):
                raise InvalidEventError(
                    f"vector keys must be non-empty process_id strings in event "
                    f"{self.event_id!r}, got {pid!r}"
                )
            if not _is_int(value) or value < 0:
                raise InvalidEventError(
                    f"vector value for process {pid!r} in event {self.event_id!r} "
                    f"must be a non-negative integer, got {value!r}"
                )
            checked_vector[pid] = value
        # frozen dataclass：拷贝一份，避免外部继续修改传入的 dict
        object.__setattr__(self, "vector", checked_vector)

    def to_dict(self) -> dict[str, Any]:
        """序列化为可 JSON 化的普通字典。"""
        return {
            "event_id": self.event_id,
            "process_id": self.process_id,
            "seq": self.seq,
            "vector": dict(self.vector),
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, data: Any) -> "Event":
        """从普通字典构造事件，字段缺失或类型错误时抛出
        :class:`InvalidEventError`。"""
        if not isinstance(data, Mapping):
            raise InvalidEventError("event must be a JSON object")
        missing = [
            key
            for key in ("event_id", "process_id", "seq", "vector")
            if key not in data
        ]
        if missing:
            raise InvalidEventError(
                "event is missing required field(s): " + ", ".join(missing)
            )
        return cls(
            event_id=data["event_id"],
            process_id=data["process_id"],
            seq=data["seq"],
            vector=dict(data["vector"]),
            payload=data.get("payload"),
        )


class CausalEngine:
    """因果一致性快照与部分回放引擎。

    内部状态：

    - ``_vectors``：每个进程的"当前已知向量"（进程注册时初始化为
      ``{process_id: 0}``）；
    - ``_events``：``event_id -> Event`` 的全局索引；
    - ``_by_process``：每个进程按 seq 升序排列的事件列表，第 ``n`` 个
      元素即该进程 seq 为 ``n+1`` 的事件。
    """

    def __init__(self) -> None:
        self._vectors: dict[str, dict[str, int]] = {}
        self._events: dict[str, Event] = {}
        self._by_process: dict[str, list[Event]] = {}

    # ------------------------------------------------------------------
    # 进程注册
    # ------------------------------------------------------------------
    def register_process(self, process_id: str) -> str:
        """注册一个逻辑进程。

        :param process_id: 非空进程标识。
        :return: 注册成功的 process_id。
        :raises DuplicateProcessError: 进程已注册，异常上带冲突的 id。
        :raises InvalidEventError: process_id 不是非空字符串。
        """
        if not _is_non_empty_str(process_id):
            raise InvalidEventError("process_id must be a non-empty string")
        if process_id in self._vectors:
            raise DuplicateProcessError(process_id)
        self._vectors[process_id] = {process_id: 0}
        self._by_process[process_id] = []
        return process_id

    def registered_processes(self) -> list[str]:
        """返回所有已注册进程，按注册顺序排列。"""
        return list(self._vectors.keys())

    # ------------------------------------------------------------------
    # 事件追加与向量时钟校验
    # ------------------------------------------------------------------
    def append(self, event: Event) -> Event:
        """追加一个事件并推进发送进程的向量时钟。

        校验顺序：事件类型 -> 进程已注册 -> event_id 全局唯一 ->
        seq 恰好为当前最大 seq + 1 -> vector 合法。任何一条不满足都会
        拒绝事件，引擎状态保持不变。

        :raises UnknownProcessError: 事件来自未注册进程。
        :raises DuplicateEventError: event_id 已存在。
        :raises InvalidEventError: seq 不连续或 vector 非法。
        """
        if not isinstance(event, Event):
            raise InvalidEventError(
                f"append expects an Event instance, got {type(event).__name__}"
            )
        pid = event.process_id
        if pid not in self._vectors:
            raise UnknownProcessError(pid, "append")
        if event.event_id in self._events:
            raise DuplicateEventError(event.event_id)

        expected_seq = len(self._by_process[pid]) + 1
        if event.seq != expected_seq:
            raise InvalidEventError(
                f"seq for process {pid!r} must be consecutive: expected "
                f"{expected_seq}, got {event.seq} (event {event.event_id!r})"
            )

        self._validate_vector(event)
        self._ensure_json_serializable(event)

        # 全部校验通过后才修改状态
        current = self._vectors[pid]
        for other_pid, value in event.vector.items():
            if value > current.get(other_pid, 0):
                current[other_pid] = value
        current[pid] = event.seq

        self._by_process[pid].append(event)
        self._events[event.event_id] = event
        return event

    def _validate_vector(self, event: Event) -> None:
        """校验事件向量时钟的全部因果约束。"""
        pid = event.process_id
        vector = event.vector
        current = self._vectors[pid]

        # 1) 所有被引用进程必须已注册
        for referenced_pid in vector:
            if referenced_pid not in self._vectors:
                raise UnknownProcessError(referenced_pid, "vector")

        # 2) 自己的分量必须恰好等于 seq - 1
        own_value = vector.get(pid)
        if own_value is None:
            raise InvalidEventError(
                f"vector of event {event.event_id!r} must contain the sender "
                f"process {pid!r}"
            )
        if own_value != event.seq - 1:
            raise InvalidEventError(
                f"vector[{pid!r}] of event {event.event_id!r} must equal "
                f"seq - 1 = {event.seq - 1}, got {own_value}"
            )

        # 3) 知识单调：此前见过的进程必须继续出现
        known = set(current.keys())
        missing = sorted(known - set(vector.keys()))
        if missing:
            raise InvalidEventError(
                f"vector of event {event.event_id!r} drops previously seen "
                f"process(es): {', '.join(missing)}"
            )

        # 4) 每个分量不能超过对应进程当前已经产生的最大 seq，
        #    也不能小于发送进程此前已知的值（知识单调，不允许回退）
        for referenced_pid, value in vector.items():
            max_seq = len(self._by_process[referenced_pid])
            if value > max_seq:
                raise InvalidEventError(
                    f"vector[{referenced_pid!r}] = {value} in event "
                    f"{event.event_id!r} exceeds current max seq {max_seq} "
                    f"of process {referenced_pid!r}"
                )
            prior = current.get(referenced_pid, 0)
            if value < prior:
                raise InvalidEventError(
                    f"vector[{referenced_pid!r}] = {value} in event "
                    f"{event.event_id!r} regresses from previously known "
                    f"value {prior} for process {pid!r}"
                )

    @staticmethod
    def _ensure_json_serializable(event: Event) -> None:
        try:
            json.dumps(event.payload)
        except (TypeError, ValueError) as exc:
            raise InvalidEventError(
                f"payload of event {event.event_id!r} is not JSON serializable: {exc}"
            ) from exc

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def get_event(self, event_id: str) -> Event | None:
        """按 event_id 返回事件，不存在时返回 ``None``。"""
        return self._events.get(event_id)

    def list_events(self, process_id: str) -> list[Event]:
        """返回某进程的全部事件，按 seq 升序。

        :raises UnknownProcessError: 进程未注册。
        """
        if process_id not in self._vectors:
            raise UnknownProcessError(process_id, "list_events")
        return list(self._by_process[process_id])

    def get_state(self) -> dict[str, Any]:
        """返回引擎当前状态的可 JSON 化快照。

        结构::

            {
              "total_events": int,
              "processes": {
                process_id: {"max_seq": int, "vector": {pid: seq, ...}}
              }
            }
        """
        return {
            "total_events": len(self._events),
            "processes": {
                pid: {
                    "max_seq": len(self._by_process[pid]),
                    "vector": dict(self._vectors[pid]),
                }
                for pid in self._vectors
            },
        }

    # ------------------------------------------------------------------
    # 因果一致性快照
    # ------------------------------------------------------------------
    def consistent_snapshot(
        self, process_cut: Mapping[str, int]
    ) -> list[Event]:
        """返回 cut 之内且因果闭合的事件集合。

        :param process_cut: ``process_id -> 该进程纳入快照的最大 seq``。
            未出现的已注册进程按 cut=0 处理。
        :return: 满足约束的事件列表，按 ``(process_id, seq)`` 升序。
        :raises InvalidCutError: cut 引用未注册进程、值非法或超过当前最大 seq。
        :raises InconsistentSnapshotError: cut 切掉了某些事件的因果前驱，
            异常上带 ``missing_predecessors`` 与 ``required_by``。
        """
        cut = self._validate_cut(process_cut)

        # cut 内每个进程纳入的都是 seq 前缀 [1..cut_p]，因此只要不存在
        # "cut 内事件依赖 cut 外事件" 的边，所有候选事件就自动因果闭合。
        # 遍历每个 cut 内事件的 vector 分量，收集穿过 cut 边界的依赖。
        candidates: list[Event] = []
        missing_required_by: dict[str, set[str]] = {}
        for pid in self._vectors:
            limit = cut[pid]
            for event in self._by_process[pid][:limit]:
                candidates.append(event)
                for ref_pid, seq_no in event.vector.items():
                    if seq_no > cut[ref_pid]:
                        pred = self._event_at(ref_pid, seq_no)
                        missing_required_by.setdefault(pred.event_id, set()).add(
                            event.event_id
                        )

        if missing_required_by:
            missing_ids = sorted(missing_required_by)
            required_by = {
                missing_id: sorted(missing_required_by[missing_id])
                for missing_id in missing_ids
            }
            raise InconsistentSnapshotError(missing_ids, required_by)

        return sorted(candidates, key=lambda e: (e.process_id, e.seq))

    def _validate_cut(self, process_cut: Mapping[str, int]) -> dict[str, int]:
        if not isinstance(process_cut, Mapping):
            raise InvalidCutError("process_cut must be a dict of process_id -> seq")
        normalized = {pid: 0 for pid in self._vectors}
        for pid, seq_no in process_cut.items():
            if pid not in self._vectors:
                raise UnknownProcessError(pid, "process_cut")
            if not _is_int(seq_no) or seq_no < 0:
                raise InvalidCutError(
                    f"cut for process {pid!r} must be a non-negative integer, "
                    f"got {seq_no!r}"
                )
            max_seq = len(self._by_process[pid])
            if seq_no > max_seq:
                raise InvalidCutError(
                    f"cut for process {pid!r} is {seq_no} but its current max "
                    f"seq is {max_seq}"
                )
            normalized[pid] = seq_no
        return normalized

    # ------------------------------------------------------------------
    # 部分回放（因果闭包）
    # ------------------------------------------------------------------
    def replay_closure(self, seeds: Iterable[str]) -> list[Event]:
        """返回回放 seeds 所需的最小因果完整事件集合。

        即 seeds 与其全部传递因果前驱的并集，按 ``(process_id, seq)``
        升序返回。seeds 中的重复 id 只计一次。

        :param seeds: event_id 的可迭代对象。
        :raises UnknownEventError: 任一 seed 不存在，异常上带全部缺失 id。
        :raises InvalidEventError: seed 不是非空字符串。
        """
        if not isinstance(seeds, Iterable) or isinstance(seeds, (str, bytes)):
            raise InvalidEventError("seeds must be an iterable of event_id strings")

        ordered_seeds: list[str] = []
        seen: set[str] = set()
        for seed in seeds:
            if not _is_non_empty_str(seed):
                raise InvalidEventError("seed event_id must be a non-empty string")
            if seed not in seen:
                seen.add(seed)
                ordered_seeds.append(seed)

        missing = [seed for seed in ordered_seeds if seed not in self._events]
        if missing:
            raise UnknownEventError(missing)

        closure: set[str] = set()
        stack: list[Event] = [self._events[seed] for seed in ordered_seeds]
        while stack:
            event = stack.pop()
            if event.event_id in closure:
                continue
            closure.add(event.event_id)
            for ref_pid, seq_no in event.vector.items():
                if seq_no > 0:
                    stack.append(self._event_at(ref_pid, seq_no))

        return sorted(
            (self._events[eid] for eid in closure),
            key=lambda e: (e.process_id, e.seq),
        )

    def _event_at(self, process_id: str, seq: int) -> Event:
        """取某进程指定 seq 的事件。

        能走到这里的引用都经过 append/load 校验，必然存在。
        """
        return self._by_process[process_id][seq - 1]

    # ------------------------------------------------------------------
    # JSON 持久化
    # ------------------------------------------------------------------
    def dump(self) -> dict[str, Any]:
        """返回完整引擎状态的可 JSON 化字典。"""
        return {
            "format": SNAPSHOT_FORMAT,
            "version": SNAPSHOT_VERSION,
            "processes": list(self._vectors.keys()),
            "events": [
                event.to_dict()
                for pid in self._vectors
                for event in self._by_process[pid]
            ],
            "vectors": {
                pid: dict(self._vectors[pid]) for pid in self._vectors
            },
        }

    def save(self, path: str | os.PathLike[str]) -> None:
        """把进程表、事件列表与每进程向量写入 JSON 文件。

        :raises PersistenceError: 路径不可写或状态无法序列化。
        """
        try:
            data = self.dump()
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2)
        except OSError as exc:
            raise PersistenceError(f"failed to write snapshot to {path!r}: {exc}") from exc
        except (TypeError, ValueError) as exc:
            raise PersistenceError(
                f"failed to serialize snapshot to {path!r}: {exc}"
            ) from exc

    @classmethod
    def load(cls, path: str | os.PathLike[str]) -> "CausalEngine":
        """从 JSON 文件重建引擎并做完整一致性校验。

        :raises PersistenceError: 文件无法读取、JSON 损坏、字段缺失、
            event_id 重复、seq 不连续、vector 引用未注册进程/超出最大
            seq/发送者分量不等于 seq-1，或保存的向量与重算结果不一致。
        """
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError as exc:
            raise PersistenceError(f"snapshot file not found: {path!r}") from exc
        except OSError as exc:
            raise PersistenceError(f"failed to read snapshot {path!r}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise PersistenceError(
                f"snapshot file {path!r} is not valid JSON at line "
                f"{exc.lineno} column {exc.colno}: {exc.msg}"
            ) from exc
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Any) -> "CausalEngine":
        """从 ``dump()`` 风格的字典重建引擎并校验一致性。"""
        if not isinstance(data, Mapping):
            raise PersistenceError("snapshot root must be a JSON object")

        fmt = data.get("format")
        if fmt != SNAPSHOT_FORMAT:
            raise PersistenceError(
                f"unsupported snapshot format: {fmt!r} (expected {SNAPSHOT_FORMAT!r})"
            )
        version = data.get("version")
        if version != SNAPSHOT_VERSION:
            raise PersistenceError(
                f"unsupported snapshot version: {version!r} "
                f"(expected {SNAPSHOT_VERSION})"
            )

        raw_processes = data.get("processes")
        raw_events = data.get("events")
        raw_vectors = data.get("vectors")
        if not isinstance(raw_processes, list):
            raise PersistenceError("snapshot field 'processes' must be a list")
        if not isinstance(raw_events, list):
            raise PersistenceError("snapshot field 'events' must be a list")
        if not isinstance(raw_vectors, Mapping):
            raise PersistenceError("snapshot field 'vectors' must be an object")

        engine = cls()

        # ---- 进程表 ----
        seen_processes: set[str] = set()
        for raw_pid in raw_processes:
            if not _is_non_empty_str(raw_pid):
                raise PersistenceError(
                    f"process id must be a non-empty string, got {raw_pid!r}"
                )
            if raw_pid in seen_processes:
                raise PersistenceError(
                    f"duplicate process in snapshot processes: {raw_pid!r}"
                )
            seen_processes.add(raw_pid)
            engine._vectors[raw_pid] = {raw_pid: 0}
            engine._by_process[raw_pid] = []

        # ---- 事件：结构、唯一性、归属 ----
        seen_ids: set[str] = set()
        parsed_events: list[Event] = []
        for index, raw_event in enumerate(raw_events):
            try:
                event = Event.from_dict(raw_event)
            except InvalidEventError as exc:
                raise PersistenceError(f"events[{index}] is invalid: {exc}") from exc

            if event.event_id in seen_ids:
                raise PersistenceError(
                    f"events[{index}] has duplicate event_id {event.event_id!r}"
                )
            seen_ids.add(event.event_id)

            if event.process_id not in engine._vectors:
                raise PersistenceError(
                    f"events[{index}] ({event.event_id!r}) belongs to unregistered "
                    f"process {event.process_id!r}"
                )
            parsed_events.append(event)

        # ---- 按进程分组、按 seq 排序，校验 seq 从 1 连续不重复 ----
        for event in parsed_events:
            engine._by_process[event.process_id].append(event)
            engine._events[event.event_id] = event
        for pid, history in engine._by_process.items():
            history.sort(key=lambda e: e.seq)
            for expected_seq, event in enumerate(history, start=1):
                if event.seq != expected_seq:
                    raise PersistenceError(
                        f"event {event.event_id!r} breaks seq continuity for "
                        f"process {pid!r}: expected {expected_seq}, got {event.seq}"
                    )

        # ---- vector 校验（此时各进程最大 seq 已知）----
        for pid, history in engine._by_process.items():
            known: set[str] = {pid}
            prior_vector: dict[str, int] = {pid: 0}
            for event in history:
                for ref_pid in event.vector:
                    if ref_pid not in engine._vectors:
                        raise PersistenceError(
                            f"event {event.event_id!r} vector references "
                            f"unregistered process {ref_pid!r}"
                        )
                own_value = event.vector.get(pid)
                if own_value != event.seq - 1:
                    raise PersistenceError(
                        f"event {event.event_id!r} vector[{pid!r}] must equal "
                        f"seq - 1 = {event.seq - 1}, got {own_value}"
                    )
                dropped = known - set(event.vector.keys())
                if dropped:
                    raise PersistenceError(
                        f"event {event.event_id!r} vector drops previously seen "
                        f"process(es): {', '.join(sorted(dropped))}"
                    )
                for ref_pid, value in event.vector.items():
                    max_seq = len(engine._by_process[ref_pid])
                    if value > max_seq:
                        raise PersistenceError(
                            f"event {event.event_id!r} vector[{ref_pid!r}] = "
                            f"{value} exceeds max seq {max_seq} of process "
                            f"{ref_pid!r}"
                        )
                    prior = prior_vector.get(ref_pid, 0)
                    if value < prior:
                        raise PersistenceError(
                            f"event {event.event_id!r} vector[{ref_pid!r}] = "
                            f"{value} regresses from previously known value "
                            f"{prior} for process {pid!r}"
                        )
                known |= set(event.vector.keys())
                prior_vector = dict(event.vector)

        # ---- 重算每进程当前向量，与文件中保存的对比 ----
        recomputed = engine._recompute_vectors()
        for pid in engine._vectors:
            if pid not in raw_vectors:
                raise PersistenceError(
                    f"snapshot 'vectors' is missing entry for process {pid!r}"
                )
            saved_vector = raw_vectors[pid]
            if not isinstance(saved_vector, Mapping):
                raise PersistenceError(
                    f"snapshot vectors[{pid!r}] must be an object"
                )
            saved_clean: dict[str, int] = {}
            for key, value in saved_vector.items():
                if not _is_non_empty_str(key) or not _is_int(value) or value < 0:
                    raise PersistenceError(
                        f"snapshot vectors[{pid!r}] contains invalid entry "
                        f"{key!r}: {value!r}"
                    )
                saved_clean[key] = value
            if saved_clean != recomputed[pid]:
                raise PersistenceError(
                    f"snapshot vectors[{pid!r}] is inconsistent with events: "
                    f"saved {saved_clean}, recomputed {recomputed[pid]}"
                )
        extra = set(raw_vectors) - set(engine._vectors)
        if extra:
            raise PersistenceError(
                "snapshot 'vectors' contains unregistered process(es): "
                + ", ".join(sorted(extra))
            )

        engine._vectors = recomputed
        return engine

    def _recompute_vectors(self) -> dict[str, dict[str, int]]:
        """按各进程自己的事件序列重放，重算每个进程的当前已知向量。

        每个进程的知识只依赖自己追加事件时声明的 vector，因此各进程可以
        独立按 seq 顺序折叠，无需跨进程排序。
        """
        result: dict[str, dict[str, int]] = {}
        for pid, history in self._by_process.items():
            current = {pid: 0}
            for event in history:
                for ref_pid, value in event.vector.items():
                    if value > current.get(ref_pid, 0):
                        current[ref_pid] = value
                current[pid] = event.seq
            result[pid] = current
        return result
