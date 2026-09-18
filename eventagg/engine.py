"""事件时间聚合引擎核心。

语义约定（验收口径）：

- 窗口归属：固定窗口长度 window_size，窗口起点 = floor(event_time / window_size) * window_size。
- 水位线：每个分组独立维护，等于该分组已到达事件的最大事件时间（单调不减）。
- 迟到判定：事件的到达时间超出"当前水位线 + 允许迟到范围"即迟到，即
  arrival_time > watermark + allowed_lateness，超出量 excess = arrival_time - watermark - allowed_lateness。
  迟到事件仍然计入窗口统计（修正已有结果），绝不静默丢弃。
- 幂等：同一 event_id 以相同 (event_time, value) 重复到达，无论来源是否相同，都不重复计入。
- 冲突：同一 event_id 的 (event_time, value) 与已有版本矛盾时，保留双方全部版本，
  生成可读 ConflictRecord；统计值默认采用"先到生效"（first-wins），
  可通过 resolve_conflict 切换生效版本，切换后受影响窗口重算并记录修正轨迹。
- 一致性：常规到达只重算该事件所在窗口；冲突解决可能改变水位线推进路径，
  因此对全组做确定性重算。任何时刻引擎增量状态都与从头全量重算完全一致，
  可由 recompute_from_scratch 校验。
"""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Dict, List, Optional, Tuple

from .clock import Clock, ManualClock
from .errors import (
    DuplicateGroupError,
    UnknownDomainError,
    UnknownEventError,
    UnknownGroupError,
    ValidationError,
)
from .models import (
    ConflictRecord,
    Correction,
    Event,
    IngestResult,
    IngestStatus,
    Snapshot,
    WindowEntryView,
    WindowStats,
)


def _is_real_number(x: object) -> bool:
    return (
        isinstance(x, (int, float))
        and not isinstance(x, bool)
        and math.isfinite(x)
    )


class _Entry:
    """窗口内一条已计入事件。"""

    __slots__ = ("event", "late", "excess")

    def __init__(self, event: Event, late: bool, excess: Optional[float]) -> None:
        self.event = event
        self.late = late
        self.excess = excess


class _WindowState:
    __slots__ = ("start", "entries", "stats")

    def __init__(self, start: float) -> None:
        self.start = start
        self.entries: List[_Entry] = []
        self.stats = WindowStats(window_start=start)

    def rebuild(self) -> None:
        stats = WindowStats(window_start=self.start)
        for e in self.entries:
            stats.add(e.event.value, e.late)
        self.stats = stats


class _EventRecord:
    """同一 event_id 的全部版本与解决历史。"""

    __slots__ = ("first", "versions", "effective", "resolutions")

    def __init__(self, first: Event) -> None:
        self.first = first
        self.versions: List[Event] = [first]
        self.effective = first
        # (解决时刻, 选中的 source)，按时间顺序追加
        self.resolutions: List[Tuple[float, str]] = []

    def has_version(self, event: Event) -> bool:
        return any(
            v.event_time == event.event_time and v.value == event.value
            for v in self.versions
        )

    def version_for_source(self, source: str) -> Optional[Event]:
        """该来源最近一次报告的版本。"""
        for v in reversed(self.versions):
            if v.source == source:
                return v
        return None

    def effective_as_of(self, t: float) -> Event:
        source = None
        for resolved_at, s in self.resolutions:
            if resolved_at <= t:
                source = s
        if source is None:
            return self.first
        return self.version_for_source(source) or self.first


class _GroupState:
    def __init__(self, group_id: str, domain: str) -> None:
        self.group_id = group_id
        self.domain = domain
        self.watermark: Optional[float] = None
        self.records: Dict[str, _EventRecord] = {}
        self.order: List[str] = []  # event_id 按到达顺序
        self.windows: Dict[float, _WindowState] = {}
        self.corrections: List[Correction] = []
        self.conflicts: List[ConflictRecord] = []


class EventTimeEngine:
    """离线事件时间聚合引擎。

    window_size: 固定窗口长度（>0）。
    allowed_lateness: 水位线允许的迟到范围（>=0）。
    clock: 可注入逻辑时钟，用于审计记录时间戳；缺省为 ManualClock。
    """

    def __init__(
        self,
        window_size: float,
        allowed_lateness: float = 0.0,
        clock: Optional[Clock] = None,
    ) -> None:
        if not _is_real_number(window_size) or window_size <= 0:
            raise ValidationError(
                f"window_size 必须为正实数，得到 {window_size!r}",
                field="window_size",
                location="EventTimeEngine.__init__",
            )
        if not _is_real_number(allowed_lateness) or allowed_lateness < 0:
            raise ValidationError(
                f"allowed_lateness 必须为非负实数，得到 {allowed_lateness!r}",
                field="allowed_lateness",
                location="EventTimeEngine.__init__",
            )
        self.window_size = window_size
        self.allowed_lateness = allowed_lateness
        self._clock: Clock = clock if clock is not None else ManualClock()
        self._domains: set = set()
        self._groups: Dict[str, _GroupState] = {}

    # ------------------------------------------------------------------
    # 1. 域与分组登记
    # ------------------------------------------------------------------
    def register_domain(self, domain_id: str) -> None:
        location = f"register_domain(domain_id={domain_id!r})"
        if not isinstance(domain_id, str) or not domain_id:
            raise ValidationError(
                f"域标识必须为非空字符串，得到 {domain_id!r}",
                field="domain_id",
                location=location,
            )
        self._domains.add(domain_id)

    def register_group(self, group_id: str, domain: str) -> None:
        location = f"register_group(group_id={group_id!r}, domain={domain!r})"
        if not isinstance(group_id, str) or not group_id:
            raise ValidationError(
                f"分组标识必须为非空字符串，得到 {group_id!r}",
                field="group_id",
                location=location,
            )
        if group_id in self._groups:
            raise DuplicateGroupError(group_id, location)
        if domain not in self._domains:
            raise UnknownDomainError(domain, location)
        self._groups[group_id] = _GroupState(group_id, domain)

    # ------------------------------------------------------------------
    # 2-4. 事件接入：校验、幂等、冲突、迟到
    # ------------------------------------------------------------------
    def ingest(self, event: Event) -> IngestResult:
        self._validate_event(event)
        g = self._groups[event.group_id]

        rec = g.records.get(event.event_id)
        if rec is not None:
            if rec.has_version(event):
                return IngestResult(
                    status=IngestStatus.DUPLICATE,
                    event_id=event.event_id,
                    group_id=event.group_id,
                    window_start=self._window_start(event.event_time),
                    message="同一事件重复到达，按幂等处理，未重复计入",
                )
            # 矛盾版本：保留双方，记录冲突，不改动统计（先到生效）
            rec.versions.append(event)
            conflict = ConflictRecord(
                event_id=event.event_id,
                group_id=event.group_id,
                detected_at=self._clock.now(),
                versions=list(rec.versions),
            )
            g.conflicts.append(conflict)
            return IngestResult(
                status=IngestStatus.CONFLICT,
                event_id=event.event_id,
                group_id=event.group_id,
                message=(
                    "与已有版本矛盾，已保留双方并生成冲突记录；"
                    "统计仍采用先生效的版本，可调用 resolve_conflict 切换"
                ),
            )

        late, excess = self._evaluate_lateness(g, event)
        g.records[event.event_id] = _EventRecord(event)
        g.order.append(event.event_id)
        self._apply_event(g, event, late, excess)
        self._advance_watermark(g, event.event_time)

        return IngestResult(
            status=IngestStatus.LATE if late else IngestStatus.ACCEPTED,
            event_id=event.event_id,
            group_id=event.group_id,
            window_start=self._window_start(event.event_time),
            late=late,
            lateness_excess=excess,
            message=(
                f"迟到事件：到达时间超出允许范围 {excess}，已计入并修正结果"
                if late
                else "准时接受"
            ),
        )

    def _validate_event(self, event: Event) -> None:
        location = f"ingest(event_id={getattr(event, 'event_id', None)!r})"
        for name in ("event_id", "group_id", "source"):
            v = getattr(event, name, None)
            if not isinstance(v, str) or not v:
                raise ValidationError(
                    f"{name} 必须为非空字符串，得到 {v!r}",
                    field=name,
                    location=location,
                )
        if event.group_id not in self._groups:
            raise UnknownGroupError(event.group_id, location)
        for name in ("event_time", "arrival_time"):
            v = getattr(event, name)
            if not _is_real_number(v):
                raise ValidationError(
                    f"{name} 必须为有限实数，得到 {v!r}",
                    field=name,
                    location=location,
                )
        if event.event_time > event.arrival_time:
            raise ValidationError(
                f"事件时间 {event.event_time} 晚于到达时间 {event.arrival_time}，拒绝",
                field="event_time",
                location=location,
            )
        if not _is_real_number(event.value):
            raise ValidationError(
                f"数值必须为有限实数，得到 {event.value!r}（类型 {type(event.value).__name__}）",
                field="value",
                location=location,
            )

    def _window_start(self, event_time: float) -> float:
        return math.floor(event_time / self.window_size) * self.window_size

    def _evaluate_lateness(
        self, g: _GroupState, event: Event
    ) -> Tuple[bool, Optional[float]]:
        if g.watermark is None:
            return False, None
        threshold = g.watermark + self.allowed_lateness
        if event.arrival_time > threshold:
            return True, event.arrival_time - threshold
        return False, None

    def _apply_event(
        self, g: _GroupState, event: Event, late: bool, excess: Optional[float]
    ) -> None:
        start = self._window_start(event.event_time)
        window = g.windows.get(start)
        before: Optional[WindowStats] = None
        if window is None:
            window = _WindowState(start)
            g.windows[start] = window
        else:
            before = replace(window.stats)
        window.entries.append(_Entry(event, late, excess))
        window.rebuild()
        if late:
            g.corrections.append(
                Correction(
                    group_id=g.group_id,
                    window_start=start,
                    reason="late-event",
                    event_id=event.event_id,
                    before=before,
                    after=replace(window.stats),
                    lateness_excess=excess,
                    recorded_at=self._clock.now(),
                )
            )

    def _advance_watermark(self, g: _GroupState, event_time: float) -> None:
        if g.watermark is None or event_time > g.watermark:
            g.watermark = event_time

    # ------------------------------------------------------------------
    # 6. 冲突解决
    # ------------------------------------------------------------------
    def resolve_conflict(self, event_id: str, source: str) -> IngestResult:
        """将指定来源的版本设为生效版本，并重算受影响窗口。"""
        location = f"resolve_conflict(event_id={event_id!r}, source={source!r})"
        g, rec = self._find_event(event_id, location)
        version = rec.version_for_source(source)
        if version is None:
            known = [v.source for v in rec.versions]
            raise ValidationError(
                f"来源 {source!r} 未报告过事件 {event_id!r}（已知来源: {known}）",
                field="source",
                location=location,
            )
        if version is rec.effective:
            return IngestResult(
                status=IngestStatus.ACCEPTED,
                event_id=event_id,
                group_id=g.group_id,
                message="该来源版本已是生效版本，无需变更",
            )
        rec.effective = version
        rec.resolutions.append((self._clock.now(), source))
        changed = self._rebuild_group(g)
        for start, (before, after) in changed.items():
            g.corrections.append(
                Correction(
                    group_id=g.group_id,
                    window_start=start,
                    reason="conflict-resolution",
                    event_id=event_id,
                    before=before,
                    after=after,
                    lateness_excess=None,
                    recorded_at=self._clock.now(),
                )
            )
        return IngestResult(
            status=IngestStatus.ACCEPTED,
            event_id=event_id,
            group_id=g.group_id,
            window_start=self._window_start(version.event_time),
            message=f"已切换生效版本为来源 {source!r}，受影响窗口 {sorted(changed)} 已重算",
        )

    def _find_event(
        self, event_id: str, location: str
    ) -> Tuple[_GroupState, _EventRecord]:
        for g in self._groups.values():
            rec = g.records.get(event_id)
            if rec is not None:
                return g, rec
        raise UnknownEventError(event_id, location)

    # ------------------------------------------------------------------
    # 5/8. 全量重算（一致性基准）
    # ------------------------------------------------------------------
    def _effective_events(self, g: _GroupState) -> List[Event]:
        return [g.records[eid].effective for eid in g.order]

    def _rebuild_from(self, g: _GroupState, events: List[Event]):
        windows: Dict[float, _WindowState] = {}
        watermark: Optional[float] = None
        for ev in events:
            late = False
            excess: Optional[float] = None
            if watermark is not None:
                threshold = watermark + self.allowed_lateness
                if ev.arrival_time > threshold:
                    late = True
                    excess = ev.arrival_time - threshold
            start = self._window_start(ev.event_time)
            window = windows.get(start)
            if window is None:
                window = _WindowState(start)
                windows[start] = window
            window.entries.append(_Entry(ev, late, excess))
            if watermark is None or ev.event_time > watermark:
                watermark = ev.event_time
        for window in windows.values():
            window.rebuild()
        return windows, watermark

    def _rebuild_group(self, g: _GroupState) -> Dict[float, Tuple[Optional[WindowStats], Optional[WindowStats]]]:
        """全组重算，返回 {window_start: (before, after)} 的变更集合。"""
        new_windows, new_watermark = self._rebuild_from(g, self._effective_events(g))
        changed: Dict[float, Tuple[Optional[WindowStats], Optional[WindowStats]]] = {}
        for start in set(g.windows) | set(new_windows):
            before = replace(g.windows[start].stats) if start in g.windows else None
            after = replace(new_windows[start].stats) if start in new_windows else None
            if before != after:
                changed[start] = (before, after)
        g.windows = new_windows
        g.watermark = new_watermark
        return changed

    def recompute_from_scratch(self, group_id: str) -> Snapshot:
        """从头全量重算：一致性校验基准，结果必须与引擎增量状态完全一致。"""
        g = self._require_group(group_id, "recompute_from_scratch")
        windows, watermark = self._rebuild_from(g, self._effective_events(g))
        return Snapshot(
            group_id=group_id,
            watermark=watermark,
            windows={start: replace(w.stats) for start, w in windows.items()},
        )

    # ------------------------------------------------------------------
    # 7. 查询
    # ------------------------------------------------------------------
    def _require_group(self, group_id: str, op: str) -> _GroupState:
        g = self._groups.get(group_id)
        if g is None:
            raise UnknownGroupError(group_id, f"{op}(group_id={group_id!r})")
        return g

    def watermark(self, group_id: str) -> Optional[float]:
        return self._require_group(group_id, "watermark").watermark

    def window_stats(self, group_id: str) -> Dict[float, WindowStats]:
        g = self._require_group(group_id, "window_stats")
        return {start: replace(w.stats) for start, w in g.windows.items()}

    def window_events(self, group_id: str, window_start: float) -> List[WindowEntryView]:
        g = self._require_group(group_id, "window_events")
        window = g.windows.get(window_start)
        if window is None:
            return []
        return [
            WindowEntryView(event=e.event, late=e.late, lateness_excess=e.excess)
            for e in window.entries
        ]

    def corrections(self, group_id: str) -> List[Correction]:
        return list(self._require_group(group_id, "corrections").corrections)

    def conflicts(self, group_id: Optional[str] = None) -> List[ConflictRecord]:
        if group_id is not None:
            return list(self._require_group(group_id, "conflicts").conflicts)
        return [c for g in self._groups.values() for c in g.conflicts]

    def snapshot(self, group_id: str) -> Snapshot:
        g = self._require_group(group_id, "snapshot")
        return Snapshot(
            group_id=group_id,
            watermark=g.watermark,
            windows={start: replace(w.stats) for start, w in g.windows.items()},
        )

    def snapshot_as_of(self, group_id: str, t: float) -> Snapshot:
        """as-of 查询：只计入 arrival_time <= t 的事件（冲突解决按 t 之前的生效版本）。"""
        g = self._require_group(group_id, "snapshot_as_of")
        events = []
        for eid in g.order:
            rec = g.records[eid]
            effective = rec.effective_as_of(t)
            if effective.arrival_time <= t:
                events.append(effective)
        windows, watermark = self._rebuild_from(g, events)
        return Snapshot(
            group_id=group_id,
            watermark=watermark,
            windows={start: replace(w.stats) for start, w in windows.items()},
        )
