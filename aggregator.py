# -*- coding: utf-8 -*-
"""流式区间（窗口）聚合内核。

本模块只用 Python 标准库实现，核心特性：

* 事件可以乱序到达，聚合结果与"按 ``(ts, event_id)`` 排序后一次性批处理"
  完全一致；
* 支持 ``sum`` / ``count`` / ``min`` / ``max`` 四种聚合；
* 区间左闭右开、起点按 ``slide`` 对齐，一个事件可同时落入多个重叠区间；
* 支持 ``retract`` 撤回，且允许"提前撤回"（retract 先于 add 到达，先暂存、
  等 add 到达后立即抵消）；
* 基于逻辑时间（整数 ``ts``）的 watermark 与区间 finalize 机制；
* JSON 增量快照（``save`` / ``load`` / ``replay``），加载时做严格一致性校验。

语义细节见同目录 ``README.md``。
"""

from __future__ import annotations

import bisect
import json
import math
import os
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

__all__ = [
    "AGGREGATORS",
    "Event",
    "WindowResult",
    "IngestResult",
    "WindowAggregator",
    "SnapshotError",
    "window_starts_for_ts",
]

#: 支持的聚合函数名。
AGGREGATORS: Tuple[str, ...] = ("sum", "count", "min", "max")

_SNAPSHOT_FORMAT = "window-aggregator-snapshot"
_SNAPSHOT_VERSION = 1


# ---------------------------------------------------------------------------
# 小工具
# ---------------------------------------------------------------------------

def _is_plain_int(x: Any) -> bool:
    """判断是否为真正的 int（排除 bool，因为 ``bool`` 是 ``int`` 的子类）。"""
    return isinstance(x, int) and not isinstance(x, bool)


def _floor_multiple(x: int, step: int) -> int:
    """不大于 ``x`` 的最大 ``step`` 整数倍（对负数也成立，因为 // 向下取整）。"""
    return (x // step) * step


def _ceil_multiple(x: int, step: int) -> int:
    """不小于 ``x`` 的最小 ``step`` 整数倍（对负数也成立）。"""
    return (-((-x) // step)) * step


def window_starts_for_ts(ts: int, window_size: int, slide: int) -> List[int]:
    """返回覆盖时间戳 ``ts`` 的所有区间起点（升序）。

    覆盖 ``ts`` 的最后一个区间起点是 ``floor(ts / slide) * slide``
    （区间为左闭右开，所以边界上的点属于右侧新区间）；由于
    ``window_size = k * slide``，向前一共覆盖 ``k`` 个区间。
    """
    last = _floor_multiple(ts, slide)
    k = window_size // slide
    return [last - (k - 1 - i) * slide for i in range(k)]


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Event:
    """一条输入事件。

    :param event_id: 事件唯一 ID，非空字符串。add 与撤回它的 retract
        使用**同一个** event_id。
    :param key: 分组维度（设备、用户等），非空字符串。
    :param ts: 整数逻辑时间戳，允许为负（不是墙上时钟，方便测试）。
    :param op: ``"add"`` 或 ``"retract"``。
    :param value: 有限、非负浮点数（int 输入会被规范化为 float）。
        retract 的 ``key`` / ``ts`` / ``value`` 必须与被撤回的 add 完全一致，
        否则该 retract 会被判为非法。
    """

    event_id: str
    key: str
    ts: int
    op: str
    value: float

    def __post_init__(self) -> None:
        if not isinstance(self.event_id, str) or not self.event_id:
            raise ValueError("event_id 必须是非空字符串")
        if not isinstance(self.key, str) or not self.key:
            raise ValueError("key 必须是非空字符串")
        if not _is_plain_int(self.ts):
            raise ValueError("ts 必须是整数（不能是布尔值或浮点数）")
        if self.op not in ("add", "retract"):
            raise ValueError("op 只能是 'add' 或 'retract'")
        if isinstance(self.value, bool) or not isinstance(self.value, (int, float)):
            raise ValueError("value 必须是有限的非负数值")
        if not math.isfinite(float(self.value)):
            raise ValueError("value 必须有限（不能是 NaN 或 Infinity）")
        if self.value < 0:
            raise ValueError("value 必须非负")
        # dataclass 是 frozen 的，用 __dict__ 绕过做一次规范化。
        object.__setattr__(self, "value", float(self.value))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "event_id": self.event_id,
            "key": self.key,
            "ts": self.ts,
            "op": self.op,
            "value": self.value,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], op_override: Optional[str] = None) -> "Event":
        """从 JSON 风格的字典构造事件。

        :param op_override: 强制使用某个 op（命令行 ``retract`` 命令用）。
        :raises ValueError: 字段缺失、类型不对或存在未知字段时抛出。
        """
        if not isinstance(data, Mapping):
            raise ValueError("事件必须是 JSON 对象")
        allowed = {"event_id", "key", "ts", "op", "value"}
        unknown = set(data) - allowed
        if unknown:
            raise ValueError(f"事件包含未知字段: {sorted(unknown)!r}")
        missing = allowed - set(data) - ({"op"} if op_override is not None else set())
        if missing:
            raise ValueError(f"事件缺少字段: {sorted(missing)!r}")
        op = op_override if op_override is not None else data["op"]
        return cls(
            event_id=data["event_id"],
            key=data["key"],
            ts=data["ts"],
            op=op,
            value=data["value"],
        )


@dataclass(frozen=True)
class WindowResult:
    """一次 ``query`` 返回的单个区间聚合结果。"""

    key: str
    window_start: int
    window_end: int
    #: 聚合值；``min`` / ``max`` 在区间内没有活跃事件时为 ``None``。
    value: Optional[float]
    #: 区间是否 finalized：结构上已关闭（window_end <= watermark）**且**
    #: 关闭后未被迟到事件改动。一旦迟到写入改动该区间，finalized 回退为
    #: ``False``（语义：结果已变更、需要重新下发）。
    finalized: bool
    #: 该区间在 finalize 之后是否被迟到事件修改过（单调的脏标记）。
    finalized_dirty: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "window_start": self.window_start,
            "window_end": self.window_end,
            "value": self.value,
            "finalized": self.finalized,
            "finalized_dirty": self.finalized_dirty,
        }


@dataclass(frozen=True)
class IngestResult:
    """``ingest`` 一条事件后的处理结果。

    ``status`` 取值：

    * ``"applied"``：add 已写入聚合；
    * ``"retracted"``：retract 已生效，或 add 到达时正好被暂存的提前
      retract 抵消（此时 ``pending_matched=True``）；
    * ``"pending_retract"``：retract 已暂存，等待对应 add 到达；
    * ``"rejected"``：非法事件被忽略（``accepted=False``，``error`` 有值）。
    """

    accepted: bool
    status: str
    event_id: str
    key: str
    ts: int
    op: str
    value: float
    #: 本次实际发生聚合值变化的区间起点列表（升序）。
    windows: List[int] = field(default_factory=list)
    error: Optional[str] = None
    error_kind: Optional[str] = None
    #: 不致命的提示（例如暂存的提前 retract 与后到的 add 不一致，
    #: 该 retract 被判非法、add 正常生效）。
    warning: Optional[str] = None
    #: 是否有落在已 finalize 区间的改动（迟到）。
    late: bool = False
    #: 被迟到改动弄脏的、已 finalize 的区间起点。
    dirty_windows: List[int] = field(default_factory=list)
    #: 本次 add 是否与一条暂存的提前 retract 配对。
    pending_matched: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "accepted": self.accepted,
            "status": self.status,
            "event_id": self.event_id,
            "key": self.key,
            "ts": self.ts,
            "op": self.op,
            "value": self.value,
            "windows": list(self.windows),
            "error": self.error,
            "error_kind": self.error_kind,
            "warning": self.warning,
            "late": self.late,
            "dirty_windows": list(self.dirty_windows),
            "pending_matched": self.pending_matched,
        }


@dataclass
class _AddRecord:
    """一条已接受 add 的内部记录。"""

    key: str
    ts: int
    value: float
    retracted: bool = False


class SnapshotError(ValueError):
    """快照文件损坏 / 缺失字段 / 一致性校验失败。"""


# ---------------------------------------------------------------------------
# 核心引擎
# ---------------------------------------------------------------------------

class WindowAggregator:
    """流式区间聚合引擎。

    :param window_size: 区间宽度（正整数）。
    :param slide: 滑动步长（正整数），必须整除 ``window_size``。
    :param default_agg: 默认聚合函数，``query`` 时可用 ``agg`` 参数覆盖。
    """

    def __init__(
        self,
        window_size: int,
        slide: int,
        default_agg: str = "sum",
    ) -> None:
        if not _is_plain_int(window_size) or window_size <= 0:
            raise ValueError("window_size 必须是正整数")
        if not _is_plain_int(slide) or slide <= 0:
            raise ValueError("slide 必须是正整数")
        if window_size % slide != 0:
            raise ValueError(
                f"slide({slide}) 必须能整除 window_size({window_size})"
            )
        if default_agg not in AGGREGATORS:
            raise ValueError(
                f"不支持的聚合函数 {default_agg!r}，可选: {AGGREGATORS}"
            )
        self.window_size: int = window_size
        self.slide: int = slide
        self.default_agg: str = default_agg

        # event_id -> 已接受的 add 记录
        self._adds: Dict[str, _AddRecord] = {}
        # event_id -> 提前到达、等待配对的 retract 事件
        self._pending_retracts: Dict[str, Event] = {}
        # (key, window_start) -> 区间内活跃贡献值的有序多重集
        self._windows: Dict[Tuple[str, int], List[float]] = {}
        # finalize 之后又被改动的 (key, window_start)
        self._dirty: set = set()
        # None 表示从未推进过 watermark
        self.watermark: Optional[int] = None

        # 计数器
        self._accepted_count = 0
        self._illegal_count = 0
        # 被撤回（当前处于撤回状态）的 add 条数
        self._retracted_count = 0
        # 落在已关闭（结构上 finalized）区间内的写入次数（迟到 add/retract）
        self._late_count = 0

    # ------------------------------------------------------------------ #
    # 事件写入
    # ------------------------------------------------------------------ #

    def ingest(self, event: Union[Event, Mapping[str, Any]]) -> IngestResult:
        """接收一条事件并更新聚合状态。

        ``event`` 可以是 :class:`Event`，也可以是 JSON 风格的字典
        （字典构造失败会计入非法事件并返回 ``accepted=False`` 的结果，
        而不是抛异常）。
        """
        if isinstance(event, Event):
            ev = event
        elif isinstance(event, Mapping):
            try:
                ev = Event.from_dict(event)
            except (ValueError, TypeError) as exc:
                self._illegal_count += 1
                return IngestResult(
                    accepted=False,
                    status="rejected",
                    event_id=str(event.get("event_id", "")) if isinstance(event, Mapping) else "",
                    key=str(event.get("key", "")) if isinstance(event, Mapping) else "",
                    ts=event.get("ts") if _is_plain_int(event.get("ts")) else 0,
                    op=str(event.get("op", "")),
                    value=float(event["value"])
                    if isinstance(event.get("value"), (int, float))
                    and not isinstance(event.get("value"), bool)
                    and math.isfinite(float(event["value"]))
                    else 0.0,
                    error=str(exc),
                    error_kind="invalid_event",
                )
        else:
            raise TypeError("event 必须是 Event 或字典")

        if ev.op == "add":
            return self._ingest_add(ev)
        return self._ingest_retract(ev)

    def _ingest_add(self, ev: Event) -> IngestResult:
        if ev.event_id in self._adds:
            return self._reject(
                ev,
                "duplicate_add",
                f"event_id={ev.event_id!r} 的 add 已存在，不能重复接受",
            )

        pending = self._pending_retracts.pop(ev.event_id, None)
        if pending is not None:
            mismatch = self._retract_mismatch_reason(
                pending, key=ev.key, ts=ev.ts, value=ev.value
            )
            if mismatch is not None:
                # 提前到达的 retract 与真正的 add 对不上：retract 判非法，
                # add 照常生效。
                self._illegal_count += 1
                return self._apply_add(
                    ev,
                    warning=(
                        f"暂存的提前 retract(event_id={ev.event_id!r}) "
                        f"与 add 不一致，已忽略该 retract：{mismatch}"
                    ),
                )
            # add 与提前 retract 配对成功：净贡献为 0，不触碰任何区间。
            self._accepted_count += 1
            self._retracted_count += 1
            self._adds[ev.event_id] = _AddRecord(
                key=ev.key, ts=ev.ts, value=ev.value, retracted=True
            )
            return IngestResult(
                accepted=True,
                status="retracted",
                **ev_kwargs(ev),
                pending_matched=True,
            )

        return self._apply_add(ev)

    def _apply_add(self, ev: Event, warning: Optional[str] = None) -> IngestResult:
        starts = window_starts_for_ts(ev.ts, self.window_size, self.slide)
        for s in starts:
            vals = self._windows.setdefault((ev.key, s), [])
            bisect.insort(vals, ev.value)
        self._adds[ev.event_id] = _AddRecord(
            key=ev.key, ts=ev.ts, value=ev.value
        )
        self._accepted_count += 1
        dirty = [s for s in starts if self._is_finalized_start(s)]
        if dirty:
            self._late_count += 1
        for s in dirty:
            self._dirty.add((ev.key, s))
        return IngestResult(
            accepted=True,
            status="applied",
            **ev_kwargs(ev),
            windows=starts,
            late=bool(dirty),
            dirty_windows=dirty,
            warning=warning,
        )

    def _ingest_retract(self, ev: Event) -> IngestResult:
        if ev.event_id in self._pending_retracts:
            return self._reject(
                ev,
                "duplicate_pending_retract",
                f"event_id={ev.event_id!r} 已有一条等待配对的 retract，"
                "不能重复撤回",
            )

        rec = self._adds.get(ev.event_id)
        if rec is None:
            # 提前撤回：暂存，等 add 到达再配对。
            self._pending_retracts[ev.event_id] = ev
            self._accepted_count += 1
            return IngestResult(
                accepted=True,
                status="pending_retract",
                **ev_kwargs(ev),
            )

        if rec.retracted:
            return self._reject(
                ev,
                "double_retract",
                f"event_id={ev.event_id!r} 的 add 已经被撤回，不能重复撤回",
            )

        reason = self._retract_mismatch_reason(
            ev, key=rec.key, ts=rec.ts, value=rec.value
        )
        if reason is not None:
            return self._reject(
                ev,
                "retract_mismatch",
                f"retract(event_id={ev.event_id!r}) 与原 add 不一致：{reason}",
            )

        starts = window_starts_for_ts(rec.ts, self.window_size, self.slide)
        for s in starts:
            vals = self._windows[(rec.key, s)]
            idx = bisect.bisect_left(vals, rec.value)
            # 状态一致性：记录在，值就一定在多重集里。
            if idx >= len(vals) or vals[idx] != rec.value:
                raise RuntimeError(  # pragma: no cover - 内部不变量
                    f"引擎内部状态损坏：找不到 event_id={ev.event_id!r} 的贡献值"
                )
            vals.pop(idx)
            if not vals:
                del self._windows[(rec.key, s)]
        rec.retracted = True
        self._retracted_count += 1
        self._accepted_count += 1
        dirty = [s for s in starts if self._is_finalized_start(s)]
        if dirty:
            self._late_count += 1
        for s in dirty:
            # 即使撤回后区间变空，"finalize 后发生过变化"这一事实仍保留。
            self._dirty.add((rec.key, s))
        return IngestResult(
            accepted=True,
            status="retracted",
            **ev_kwargs(ev),
            windows=starts,
            late=bool(dirty),
            dirty_windows=dirty,
        )

    @staticmethod
    def _retract_mismatch_reason(
        retract: Event, *, key: str, ts: int, value: float
    ) -> Optional[str]:
        """检查 retract 的 key/ts/value 是否与原 add 完全一致。"""
        if retract.key != key:
            return f"key 不同（retract={retract.key!r}, add={key!r}）"
        if retract.ts != ts:
            return f"ts 不同（retract={retract.ts}, add={ts}）"
        if retract.value != value:
            return f"value 不同（retract={retract.value}, add={value}）"
        return None

    def _reject(self, ev: Event, kind: str, message: str) -> IngestResult:
        self._illegal_count += 1
        return IngestResult(
            accepted=False,
            status="rejected",
            **ev_kwargs(ev),
            error=message,
            error_kind=kind,
        )

    # ------------------------------------------------------------------ #
    # Watermark
    # ------------------------------------------------------------------ #

    def advance_watermark(self, t: int) -> int:
        """把 watermark 推进到 ``t``（只能单调不减），返回当前 watermark。

        区间 ``[s, s+window_size)`` 在 ``s + window_size <= watermark``
        时被视为 finalized。``t`` 必须是非负整数；从未推进过时 watermark
        为 ``None``（不 finalize 任何区间，包括负时间戳区间）。
        """
        if not _is_plain_int(t):
            raise ValueError("watermark 必须是整数")
        if t < 0:
            raise ValueError("watermark 必须非负")
        if self.watermark is not None and t < self.watermark:
            raise ValueError(
                f"watermark 不能回退（当前={self.watermark}, 请求={t}）"
            )
        self.watermark = t
        return t

    def _is_finalized_start(self, start: int) -> bool:
        return (
            self.watermark is not None
            and start + self.window_size <= self.watermark
        )

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #

    def _normalize_range(self, start: int, end: int) -> Tuple[int, int]:
        if not _is_plain_int(start) or not _is_plain_int(end):
            raise ValueError("start / end 必须是整数")
        if end <= start:
            return 0, 0  # 空范围
        # 查询边界自动向 slide 网格外扩对齐：
        # start 向下取整、end 向上取整。
        return _floor_multiple(start, self.slide), _ceil_multiple(end, self.slide)

    def _compute(self, values: Optional[List[float]], agg: str) -> Optional[float]:
        if values is None:
            if agg == "min" or agg == "max":
                return None
            if agg == "sum":
                return 0.0
            return 0  # count
        if agg == "sum":
            # math.fsum 是"精确部分和 + 单次舍入"，结果只取决于值的多重集、
            # 与累加顺序无关，从而保证乱序流式处理与排序批处理逐位相等。
            return math.fsum(values)
        if agg == "count":
            return len(values)
        if agg == "min":
            return values[0]
        if agg == "max":
            return values[-1]
        raise ValueError(f"不支持的聚合函数 {agg!r}")  # pragma: no cover

    def query(
        self,
        key: str,
        start: int,
        end: int,
        agg: Optional[str] = None,
    ) -> List[WindowResult]:
        """返回 ``[start, end)`` 范围内、某个 key 的全部区间聚合值。

        边界会自动向 slide 网格外扩对齐（详见 README）。网格内每个区间
        都会返回一条结果，即使其中没有任何事件（``sum=0``、``count=0``、
        ``min/max=None``）。结果按 ``window_start`` 升序。
        """
        if not isinstance(key, str) or not key:
            raise ValueError("key 必须是非空字符串")
        agg = agg or self.default_agg
        if agg not in AGGREGATORS:
            raise ValueError(f"不支持的聚合函数 {agg!r}，可选: {AGGREGATORS}")
        aligned_start, aligned_end = self._normalize_range(start, end)
        results: List[WindowResult] = []
        s = aligned_start
        while s < aligned_end:
            values = self._windows.get((key, s))
            closed = self._is_finalized_start(s)
            dirty = (key, s) in self._dirty
            results.append(
                WindowResult(
                    key=key,
                    window_start=s,
                    window_end=s + self.window_size,
                    value=self._compute(values, agg),
                    # 结构上已关闭、但被迟到事件改动过的区间：finalized 回退
                    # 为 False，表示"结果已变更、需要重新下发/查询"。
                    finalized=closed and not dirty,
                    finalized_dirty=dirty,
                )
            )
            s += self.slide
        return results

    def query_all(
        self,
        start: int,
        end: int,
        agg: Optional[str] = None,
    ) -> List[WindowResult]:
        """返回范围内所有 key 的区间聚合值，按 ``(key, window_start)`` 升序。

        只包含当前仍有活跃贡献的 key；所有贡献都被撤回的 key 不出现。
        """
        agg = agg or self.default_agg
        if agg not in AGGREGATORS:
            raise ValueError(f"不支持的聚合函数 {agg!r}，可选: {AGGREGATORS}")
        aligned_start, aligned_end = self._normalize_range(start, end)
        keys = sorted({k for (k, _s) in self._windows})
        results: List[WindowResult] = []
        for key in keys:
            s = aligned_start
            while s < aligned_end:
                values = self._windows.get((key, s))
                if values is not None:
                    closed = self._is_finalized_start(s)
                    dirty = (key, s) in self._dirty
                    results.append(
                        WindowResult(
                            key=key,
                            window_start=s,
                            window_end=s + self.window_size,
                            value=self._compute(values, agg),
                            finalized=closed and not dirty,
                            finalized_dirty=dirty,
                        )
                    )
                s += self.slide
        return results

    # ------------------------------------------------------------------ #
    # 状态摘要
    # ------------------------------------------------------------------ #

    def get_state(self) -> Dict[str, Any]:
        """返回引擎内部状态摘要（用于监控 / 命令行 ``state``）。"""
        finalized_windows = sum(
            1
            for (k, s) in self._windows
            if self._is_finalized_start(s) and (k, s) not in self._dirty
        )
        return {
            "window_size": self.window_size,
            "slide": self.slide,
            "default_agg": self.default_agg,
            "watermark": self.watermark,
            "accepted_events": self._accepted_count,
            "retracted_events": self._retracted_count,
            "illegal_events": self._illegal_count,
            # 落在已关闭区间内的写入次数（迟到 add / 迟到 retract 各计一次）
            "late_events": self._late_count,
            "pending_retracts": len(self._pending_retracts),
            "tracked_adds": len(self._adds),
            "active_windows": len(self._windows),
            "active_keys": len({k for (k, _s) in self._windows}),
            # 结构上已关闭（window_end <= watermark）的活跃区间数
            "closed_active_windows": sum(
                1 for (_k, s) in self._windows
                if self._is_finalized_start(s)
            ),
            # 当前对外仍报告 finalized=True 的区间（已关闭且未被迟到改动）
            "finalized_active_windows": finalized_windows,
            "dirty_windows": len(self._dirty),
        }

    # ------------------------------------------------------------------ #
    # 快照
    # ------------------------------------------------------------------ #

    def to_snapshot(self) -> Dict[str, Any]:
        """返回可 JSON 序列化的快照字典（``save`` 的内存版本，CLI ``dump`` 用）。"""
        events = [
            {
                "event_id": eid,
                "key": rec.key,
                "ts": rec.ts,
                "value": rec.value,
                "retracted": rec.retracted,
            }
            for eid, rec in sorted(self._adds.items())
        ]
        windows = [
            {
                "key": key,
                "start": s,
                "count": len(vals),
                "sum": math.fsum(vals),
                "values": list(vals),
            }
            for (key, s), vals in sorted(self._windows.items())
        ]
        return {
            "format": _SNAPSHOT_FORMAT,
            "version": _SNAPSHOT_VERSION,
            "config": {
                "window_size": self.window_size,
                "slide": self.slide,
                "default_agg": self.default_agg,
            },
            "watermark": self.watermark,
            "stats": {
                "accepted_events": self._accepted_count,
                "retracted_events": self._retracted_count,
                "illegal_events": self._illegal_count,
                "late_events": self._late_count,
            },
            "pending_retracts": [
                ev.to_dict() for _eid, ev in sorted(self._pending_retracts.items())
            ],
            "events": events,
            "windows": windows,
            "dirty": [
                {"key": key, "start": s}
                for (key, s) in sorted(self._dirty)
            ],
        }

    def save(self, path: Union[str, os.PathLike]) -> None:
        """把完整状态写到 JSON 文件（先写临时文件再原子替换）。"""
        data = json.dumps(
            self.to_snapshot(), ensure_ascii=False, indent=2, allow_nan=False
        )
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp_path, path)

    @classmethod
    def load(cls, path: Union[str, os.PathLike]) -> "WindowAggregator":
        """从 JSON 快照重建引擎，并做严格一致性校验。

        :raises SnapshotError: 文件无法读取、JSON 损坏、字段缺失/非法、
            或聚合状态与事件记录不一致。
        """
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except FileNotFoundError as exc:
            raise SnapshotError(f"快照文件不存在: {path}") from exc
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"快照文件不是合法 JSON: {exc}") from exc
        except OSError as exc:
            raise SnapshotError(f"读取快照文件失败: {exc}") from exc
        return cls.from_snapshot(raw)

    @classmethod
    def from_snapshot(cls, raw: Any) -> "WindowAggregator":
        """从快照字典重建引擎（与 :meth:`load` 相同的校验，方便测试）。"""
        if not isinstance(raw, dict):
            raise SnapshotError("快照顶层必须是 JSON 对象")
        if raw.get("format") != _SNAPSHOT_FORMAT:
            raise SnapshotError(
                f"快照 format 不匹配: 期望 {_SNAPSHOT_FORMAT!r}, "
                f"实际 {raw.get('format')!r}"
            )
        if raw.get("version") != _SNAPSHOT_VERSION:
            raise SnapshotError(
                f"快照版本不支持: 期望 {_SNAPSHOT_VERSION}, "
                f"实际 {raw.get('version')!r}"
            )

        cfg = raw.get("config")
        if not isinstance(cfg, dict):
            raise SnapshotError("快照缺少 config 对象")
        try:
            agg = cls(
                window_size=cfg["window_size"],
                slide=cfg["slide"],
                default_agg=cfg.get("default_agg", "sum"),
            )
        except KeyError as exc:
            raise SnapshotError(f"config 缺少字段: {exc.args[0]!r}") from exc
        except (ValueError, TypeError) as exc:
            raise SnapshotError(f"config 非法: {exc}") from exc

        wm = raw.get("watermark")
        if wm is not None:
            if not _is_plain_int(wm) or wm < 0:
                raise SnapshotError("watermark 必须为 null 或非负整数")
        agg.watermark = wm

        stats = raw.get("stats", {})
        if not isinstance(stats, dict):
            raise SnapshotError("stats 必须是对象")
        for name in (
            "accepted_events",
            "retracted_events",
            "illegal_events",
            "late_events",
        ):
            if name == "late_events" and name not in stats:
                continue  # 兼容旧版快照
            v = stats[name]
            if not _is_plain_int(v) or v < 0:
                raise SnapshotError(f"stats.{name} 必须是非负整数")
        agg._accepted_count = stats["accepted_events"]
        agg._retracted_count = stats["retracted_events"]
        agg._illegal_count = stats["illegal_events"]
        agg._late_count = stats.get("late_events", 0)

        # --- 事件记录 --------------------------------------------------
        events = raw.get("events")
        if not isinstance(events, list):
            raise SnapshotError("events 必须是数组")
        for i, item in enumerate(events):
            where = f"events[{i}]"
            if not isinstance(item, dict):
                raise SnapshotError(f"{where} 必须是对象")
            try:
                ev = Event(
                    event_id=item["event_id"],
                    key=item["key"],
                    ts=item["ts"],
                    op="add",
                    value=item["value"],
                )
            except KeyError as exc:
                raise SnapshotError(f"{where} 缺少字段 {exc.args[0]!r}") from exc
            except (ValueError, TypeError) as exc:
                raise SnapshotError(f"{where} 非法: {exc}") from exc
            if "retracted" not in item or not isinstance(item["retracted"], bool):
                raise SnapshotError(f"{where}.retracted 必须是布尔值")
            if ev.event_id in agg._adds:
                raise SnapshotError(f"{where}: event_id {ev.event_id!r} 重复")
            agg._adds[ev.event_id] = _AddRecord(
                key=ev.key,
                ts=ev.ts,
                value=ev.value,
                retracted=item["retracted"],
            )

        # --- 暂存的提前 retract ---------------------------------------
        pending = raw.get("pending_retracts")
        if not isinstance(pending, list):
            raise SnapshotError("pending_retracts 必须是数组")
        for i, item in enumerate(pending):
            where = f"pending_retracts[{i}]"
            try:
                ev = Event.from_dict(item)
            except (ValueError, TypeError) as exc:
                raise SnapshotError(f"{where} 非法: {exc}") from exc
            if ev.op != "retract":
                raise SnapshotError(f"{where} 必须是 retract 事件")
            if ev.event_id in agg._pending_retracts:
                raise SnapshotError(f"{where}: event_id {ev.event_id!r} 重复")
            if ev.event_id in agg._adds:
                raise SnapshotError(
                    f"{where}: event_id {ev.event_id!r} 已有 add，"
                    "不应再处于待匹配状态"
                )
            agg._pending_retracts[ev.event_id] = ev

        # --- 区间状态 --------------------------------------------------
        windows = raw.get("windows")
        if not isinstance(windows, list):
            raise SnapshotError("windows 必须是数组")
        for i, item in enumerate(windows):
            where = f"windows[{i}]"
            if not isinstance(item, dict):
                raise SnapshotError(f"{where} 必须是对象")
            key = item.get("key")
            start = item.get("start")
            vals = item.get("values")
            if not isinstance(key, str) or not key:
                raise SnapshotError(f"{where}.key 必须是非空字符串")
            if not _is_plain_int(start):
                raise SnapshotError(f"{where}.start 必须是整数")
            if start % agg.slide != 0:
                raise SnapshotError(
                    f"{where}.start={start} 不是 slide({agg.slide}) 的整数倍"
                )
            if not isinstance(vals, list) or not vals:
                raise SnapshotError(
                    f"{where}.values 必须是非空数组（空区间应被删除而不是落盘）"
                )
            clean: List[float] = []
            for j, v in enumerate(vals):
                if isinstance(v, bool) or not isinstance(v, (int, float)):
                    raise SnapshotError(f"{where}.values[{j}] 必须是数值")
                if not math.isfinite(float(v)):
                    raise SnapshotError(f"{where}.values[{j}] 必须有限")
                clean.append(float(v))
            clean.sort()
            if "count" in item and item["count"] != len(clean):
                raise SnapshotError(f"{where}.count 与 values 长度不一致")
            if "sum" in item:
                stored_sum = item["sum"]
                if (
                    isinstance(stored_sum, bool)
                    or not isinstance(stored_sum, (int, float))
                    or not math.isfinite(float(stored_sum))
                    or float(stored_sum) != math.fsum(clean)
                ):
                    raise SnapshotError(f"{where}.sum 与 values 重算结果不一致")
            pk = (key, start)
            if pk in agg._windows:
                raise SnapshotError(f"{where}: 区间 ({key!r}, {start}) 重复")
            agg._windows[pk] = clean

        # --- finalize 后脏标记 ----------------------------------------
        dirty = raw.get("dirty")
        if not isinstance(dirty, list):
            raise SnapshotError("dirty 必须是数组")
        for i, item in enumerate(dirty):
            where = f"dirty[{i}]"
            if not isinstance(item, dict):
                raise SnapshotError(f"{where} 必须是对象")
            key = item.get("key")
            start = item.get("start")
            if not isinstance(key, str) or not key:
                raise SnapshotError(f"{where}.key 必须是非空字符串")
            if not _is_plain_int(start) or start % agg.slide != 0:
                raise SnapshotError(
                    f"{where}.start 必须是 slide 的整数倍"
                )
            agg._dirty.add((key, start))

        # --- 整体一致性：用事件记录重放一遍，必须与区间状态完全相等 -----
        expected: Dict[Tuple[str, int], List[float]] = {}
        for rec in agg._adds.values():
            if rec.retracted:
                continue
            for s in window_starts_for_ts(rec.ts, agg.window_size, agg.slide):
                bisect.insort(expected.setdefault((rec.key, s), []), rec.value)
        if set(expected) != set(agg._windows):
            only_snapshot = sorted(set(agg._windows) - set(expected))
            only_expected = sorted(set(expected) - set(agg._windows))
            raise SnapshotError(
                "快照一致性校验失败：活跃区间集合与事件记录不符 "
                f"（仅快照中有: {only_snapshot[:5]}，仅重放得到: {only_expected[:5]}）"
            )
        for pk, vals in expected.items():
            if vals != agg._windows[pk]:
                raise SnapshotError(
                    f"快照一致性校验失败：区间 {pk} 的贡献多重集与事件记录不符"
                )
        # retracted 计数必须与记录一致
        real_retracted = sum(1 for r in agg._adds.values() if r.retracted)
        if real_retracted != agg._retracted_count:
            raise SnapshotError(
                f"stats.retracted_events={agg._retracted_count} 与事件记录 "
                f"({real_retracted}) 不一致"
            )

        return agg

    @classmethod
    def replay(
        cls,
        path: Union[str, os.PathLike],
        extra_events: Iterable[Union[Event, Mapping[str, Any]]] = (),
    ) -> Tuple["WindowAggregator", List[IngestResult]]:
        """从快照恢复后继续 ingest 事件。

        等价于"不中断地一次性处理全部事件"（见 README 快照语义）。
        返回 ``(引擎, 后续事件的 IngestResult 列表)``。
        """
        agg = cls.load(path)
        results = [agg.ingest(ev) for ev in extra_events]
        return agg, results


def ev_kwargs(ev: Event) -> Dict[str, Any]:
    """IngestResult 构造时复用事件公共字段。"""
    return {
        "event_id": ev.event_id,
        "key": ev.key,
        "ts": ev.ts,
        "op": ev.op,
        "value": ev.value,
    }
