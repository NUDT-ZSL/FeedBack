"""监测系统核心：来源维护、读数接入、异常判定、缺失标记、增量重算。"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import (
    Anomaly,
    Baseline,
    ConflictRecord,
    IngestResult,
    MissingInterval,
    Reading,
    ThresholdSegment,
)


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _is_time(t) -> bool:
    return isinstance(t, int) and not isinstance(t, bool)


@dataclass
class _SourceState:
    source_id: str
    park: str
    metric_type: str
    period: int = 1                # 期望上报周期（逻辑时刻单位）
    max_missed_periods: int = 1    # 连续缺失超过该周期数即标记数据缺失
    readings: dict = field(default_factory=dict)   # time -> [Reading, ...]（冲突时多于一条）
    last_time: int | None = None
    baseline: Baseline | None = None
    thresholds: list = field(default_factory=list)  # [ThresholdSegment]，已按 start 排序且不重叠
    anomalies: list = field(default_factory=list)   # 缓存的异常判定，按 sort_key 排序
    conflicts: dict = field(default_factory=dict)   # time -> ConflictRecord
    recompute_log: list = field(default_factory=list)  # 每次增量重算的 (lo, hi) 区间，供验收核对

    def sorted_times(self):
        return sorted(self.readings)

    def readings_at(self, t):
        return sorted(self.readings[t], key=lambda r: r.channel)

    def threshold_at(self, t) -> ThresholdSegment | None:
        for seg in self.thresholds:
            if seg.covers(t):
                return seg
        return None


class MonitoringSystem:
    """园区排放连续观测识别模块（离线、确定性、可验收）。"""

    def __init__(self):
        self._sources: dict[str, _SourceState] = {}

    # ------------------------------------------------------------ 来源维护（需求 1）

    def add_source(self, source_id: str, park: str, metric_type: str,
                   period: int = 1, max_missed_periods: int = 1) -> None:
        if source_id in self._sources:
            raise ValueError(f"来源标识重复：{source_id}")
        if period <= 0:
            raise ValueError("上报周期必须为正整数")
        self._sources[source_id] = _SourceState(
            source_id=source_id, park=park, metric_type=metric_type,
            period=period, max_missed_periods=max_missed_periods,
        )

    def source(self, source_id: str) -> _SourceState:
        try:
            return self._sources[source_id]
        except KeyError:
            raise KeyError(f"未知来源：{source_id}") from None

    def sources(self):
        return {sid: (s.park, s.metric_type) for sid, s in self._sources.items()}

    # ------------------------------------------------------------ 读数接入（需求 2、7）

    def ingest(self, readings) -> list[IngestResult]:
        """接入一条或一批读数，逐条返回结果。

        - 同一来源同一时刻重复上报相同数值：幂等忽略（duplicate）；
        - 时刻倒退、读数非数值：拒绝（rejected），reason 中指出批次位置与原因；
        - 同一时刻不同通道给出矛盾数值：双方均保留，并生成冲突记录（conflict）。
        """
        if isinstance(readings, Reading):
            readings = [readings]
        return [self._ingest_one(i, r) for i, r in enumerate(readings)]

    def _ingest_one(self, index: int, r: Reading) -> IngestResult:
        sid = getattr(r, "source_id", None)
        t = getattr(r, "time", None)
        if sid not in self._sources:
            return IngestResult("rejected", index, sid, t,
                                f"批次第 {index} 条：未知来源 {sid!r}，已拒绝")
        st = self._sources[sid]
        if not _is_time(t):
            return IngestResult("rejected", index, sid, None,
                                f"批次第 {index} 条：来源 {sid} 的时刻 {t!r} 不是整数，已拒绝")
        if not _is_number(r.value):
            return IngestResult("rejected", index, sid, t,
                                f"批次第 {index} 条：来源 {sid} 在时刻 {t} 的读数 "
                                f"{r.value!r} 不是有效数值，已拒绝")
        if st.last_time is not None and t < st.last_time:
            return IngestResult("rejected", index, sid, t,
                                f"批次第 {index} 条：来源 {sid} 时刻倒退 "
                                f"（{t} < 已接收的 {st.last_time}），已拒绝")

        value = float(r.value)
        existing = list(st.readings.get(t, ()))  # 快照，避免后续 append 污染
        if any(e.value == value for e in existing):
            return IngestResult("duplicate", index, sid, t,
                                f"批次第 {index} 条：来源 {sid} 时刻 {t} 的重复上报，幂等忽略")

        reading = Reading(sid, t, value, r.channel)
        st.readings.setdefault(t, []).append(reading)
        st.last_time = t

        if existing:  # 同一时刻已有不同数值 -> 冲突，双方保留并记录
            entries = tuple((e.channel, e.value) for e in existing) + ((r.channel, value),)
            st.conflicts[t] = ConflictRecord(sid, t, entries)
            status, reason = "conflict", st.conflicts[t].describe()
        else:
            status, reason = "accepted", ""

        # 新读数即时判定，保持异常缓存始终最新
        prev = self._prev_reading(st, reading)
        st.anomalies.extend(self._judge(st, reading, prev))
        st.anomalies.sort(key=lambda a: a.sort_key())
        return IngestResult(status, index, sid, t, reason)

    # ------------------------------------------------------------ 配置（需求 3）

    def set_baseline(self, source_id: str, points) -> None:
        """设置/修正基线曲线，只增量重算受影响的时段。"""
        st = self.source(source_id)
        new = Baseline(points)
        old, st.baseline = st.baseline, new
        ranges = _baseline_diff_ranges(old, new, self._reading_span(st))
        self._recompute(st, ranges)

    def set_thresholds(self, source_id: str, segments) -> None:
        """设置/调整分段阈值，只增量重算受影响的时段。

        同一来源同一时刻最多一个生效阈值：分段区间重叠时抛出 ValueError。
        """
        st = self.source(source_id)
        segs = sorted((ThresholdSegment(int(s.start), s.end, s.tolerance, s.max_jump,
                                        s.lower, s.upper) for s in segments),
                      key=lambda s: s.start)
        for prev, cur in zip(segs, segs[1:]):
            if prev.end is None or cur.start < prev.end:
                raise ValueError(
                    f"来源 {source_id} 的阈值分段 [{prev.start}, {prev.end}) 与 "
                    f"[{cur.start}, {cur.end}) 重叠：同一时刻最多一个生效阈值")
        old, st.thresholds = st.thresholds, segs
        ranges = _threshold_diff_ranges(old, segs)
        self._recompute(st, ranges)

    # ------------------------------------------------------------ 异常判定（需求 4）

    def _prev_reading(self, st: _SourceState, reading: Reading) -> Reading | None:
        """判定用“上一条读数”：同来源、时刻严格更早（或同时刻先到达）的最近一条。"""
        prev = None
        for t in st.sorted_times():
            if t > reading.time:
                break
            for r in st.readings_at(t):
                if r is reading:
                    return prev
                prev = r
        return prev

    def _judge(self, st: _SourceState, r: Reading, prev: Reading | None) -> list[Anomaly]:
        seg = st.threshold_at(r.time)
        if seg is None:
            return []
        out = []
        base = st.baseline.value_at(r.time) if st.baseline else None

        if seg.tolerance is not None and base is not None:
            dev = abs(r.value - base)
            if dev > seg.tolerance:
                out.append(Anomaly(
                    st.source_id, r.time, r.value, r.channel, "deviation",
                    f"读数 {r.value} 偏离基线 {base:.6g} 达 {dev:.6g}，"
                    f"超过容差 {seg.tolerance}",
                    {"baseline": base, "tolerance": seg.tolerance, "deviation": dev},
                    dev / seg.tolerance if seg.tolerance else math.inf))

        if seg.max_jump is not None and prev is not None \
                and 0 < r.time - prev.time <= st.period:
            delta = abs(r.value - prev.value)
            if delta > seg.max_jump:
                out.append(Anomaly(
                    st.source_id, r.time, r.value, r.channel, "jump",
                    f"读数由时刻 {prev.time} 的 {prev.value} 跳变 {delta:.6g}，"
                    f"超过单周期最大跳变 {seg.max_jump}",
                    {"prev_time": prev.time, "prev_value": prev.value,
                     "delta": delta, "max_jump": seg.max_jump},
                    delta / seg.max_jump if seg.max_jump else math.inf))

        for bound, name, cmp in ((seg.lower, "lower", lambda v, b: v < b),
                                 (seg.upper, "upper", lambda v, b: v > b)):
            if bound is not None and cmp(r.value, bound):
                excess = abs(r.value - bound)
                scale = seg.tolerance if seg.tolerance else max(1.0, abs(bound))
                out.append(Anomaly(
                    st.source_id, r.time, r.value, r.channel, "out_of_bounds",
                    f"读数 {r.value} 越出{'下' if name == 'lower' else '上'}限 {bound}，"
                    f"超出 {excess:.6g}",
                    {"bound": bound, "side": name, "excess": excess},
                    excess / scale))
        return out

    def anomalies(self, source_id: str | None = None) -> list[Anomaly]:
        if source_id is not None:
            return list(self.source(source_id).anomalies)
        out = []
        for st in self._sources.values():
            out.extend(st.anomalies)
        return sorted(out, key=lambda a: (a.source_id, a.sort_key()))

    # ------------------------------------------------------------ 数据缺失（需求 5）

    def missing_intervals(self, source_id: str) -> list[MissingInterval]:
        """连续多个周期未上报的区间。缺失时刻不参与判定，也不按零值处理。"""
        st = self.source(source_id)
        times = st.sorted_times()
        out = []
        for t0, t1 in zip(times, times[1:]):
            missing = tuple(range(t0 + st.period, t1, st.period))
            if len(missing) > st.max_missed_periods:
                out.append(MissingInterval(source_id, missing[0], missing[-1], missing))
        return out

    # ------------------------------------------------------------ 冲突记录（需求 7）

    def conflicts(self, source_id: str | None = None) -> list[ConflictRecord]:
        if source_id is not None:
            st = self.source(source_id)
            return [st.conflicts[t] for t in sorted(st.conflicts)]
        out = []
        for st in self._sources.values():
            out.extend(st.conflicts[t] for t in sorted(st.conflicts))
        return out

    def readings(self, source_id: str) -> list[Reading]:
        """该来源保留的全部读数（含冲突双方），按时刻与通道排序。"""
        st = self.source(source_id)
        return [r for t in st.sorted_times() for r in st.readings_at(t)]

    # ------------------------------------------------------------ 增量重算（需求 8）

    def _reading_span(self, st: _SourceState):
        times = st.sorted_times()
        return (times[0], times[-1]) if times else None

    def _recompute(self, st: _SourceState, ranges) -> None:
        """只重算给定时段内的判定，区间外缓存保持不变。"""
        for lo, hi in ranges:
            st.anomalies = [a for a in st.anomalies
                            if not _in_range(a.time, lo, hi)]
            st.anomalies.extend(self._detect_range(st, lo, hi))
            st.recompute_log.append((lo, hi))
        st.anomalies.sort(key=lambda a: a.sort_key())

    def _detect_range(self, st: _SourceState, lo, hi) -> list[Anomaly]:
        """重算 [lo, hi] 内的判定；跳变判定的“上一条”取区间前最近读数，与全量一致。"""
        prev = None
        for t in st.sorted_times():
            if lo is not None and t >= lo:
                break
            for r in st.readings_at(t):
                prev = r
        out = []
        for t in st.sorted_times():
            if not _in_range(t, lo, hi):
                continue
            for r in st.readings_at(t):
                out.extend(self._judge(st, r, prev))
                prev = r
        return out

    def _detect_all(self, st: _SourceState) -> list[Anomaly]:
        out, prev = [], None
        for t in st.sorted_times():
            for r in st.readings_at(t):
                out.extend(self._judge(st, r, prev))
                prev = r
        return sorted(out, key=lambda a: a.sort_key())

    def recompute_all(self, source_id: str) -> list[Anomaly]:
        """从头重新判定该来源（不改动缓存），用于与增量结果比对。"""
        return self._detect_all(self.source(source_id))

    def is_consistent(self, source_id: str) -> bool:
        """增量重算结果是否与从头重新判定完全一致。"""
        st = self.source(source_id)
        return st.anomalies == self._detect_all(st)

    # ------------------------------------------------------------ 聚类（需求 6，实现在 cluster.py）

    def clusters(self, window: int):
        from .cluster import find_clusters
        return find_clusters(self, window)


# ---------------------------------------------------------------- 区间工具

def _in_range(t, lo, hi) -> bool:
    return (lo is None or t >= lo) and (hi is None or t <= hi)


def _threshold_diff_ranges(old_segs, new_segs):
    """新旧阈值分段（阶梯函数）取值不同的时段集合，返回合并后的 [(lo, hi)]。"""
    bounds = set()
    for s in list(old_segs) + list(new_segs):
        bounds.add(s.start)
        if s.end is not None:
            bounds.add(s.end)
    if not bounds:
        return []
    pts = sorted(bounds)

    def at(segs, t):
        for s in segs:
            if s.covers(t):
                return s.params()
        return None

    ranges, run_lo = [], None
    for i, b in enumerate(pts):
        differ = at(old_segs, b) != at(new_segs, b)
        hi = pts[i + 1] - 1 if i + 1 < len(pts) else None  # 最后一段延伸到无穷远
        if differ and run_lo is None:
            run_lo = b
        if not differ and run_lo is not None:
            ranges.append((run_lo, b - 1))
            run_lo = None
    if run_lo is not None:
        ranges.append((run_lo, None))
    return ranges


def _baseline_diff_ranges(old: Baseline | None, new: Baseline | None, span):
    """新旧基线取值不同的时段。

    两条基线在合并点集划出的每个基本区间上都是线性的：对区间中点采样，
    不同则整个区间（含端点，保守并入）视为受影响；相邻受影响区间合并。
    """
    if old is None or new is None:
        return [span] if span else []
    times = sorted(set(old._times) | set(new._times))
    intervals = [(None, times[0], times[0] - 1)]                    # 头部
    intervals += [(a, b, (a + b) / 2) for a, b in zip(times, times[1:])]
    intervals.append((times[-1], None, times[-1] + 1))              # 尾部

    ranges, run_lo, run_hi = [], None, None
    started = False
    for lo, hi, sample in intervals:
        if old.value_at(sample) != new.value_at(sample):
            if not started:
                run_lo, started = lo, True
            run_hi = hi
        elif started:
            ranges.append((run_lo, run_hi))
            started = False
    if started:
        ranges.append((run_lo, run_hi))
    return ranges
