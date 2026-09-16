"""核心数据模型：读数、基线、阈值、判定结果、缺失区间、冲突记录、聚类结果。"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, field


# ---------------------------------------------------------------- 读数

@dataclass(frozen=True)
class Reading:
    """一条上报读数。time 为逻辑时刻（整数），channel 为上报通道标识。"""
    source_id: str
    time: int
    value: float
    channel: str = "default"


# ---------------------------------------------------------------- 基线

class Baseline:
    """基线曲线：由若干 (时刻, 基线值) 点定义，点间线性插值，两端之外取端点值。"""

    def __init__(self, points):
        pts = sorted((int(t), float(v)) for t, v in points)
        if not pts:
            raise ValueError("基线至少需要一个点")
        times = [t for t, _ in pts]
        if len(set(times)) != len(times):
            raise ValueError("基线存在重复时刻的点")
        self._times = times
        self._values = [v for _, v in pts]

    @property
    def points(self):
        return list(zip(self._times, self._values))

    def value_at(self, t: float) -> float:
        i = bisect_right(self._times, t)
        if i == 0:
            return self._values[0]
        if i >= len(self._times):
            return self._values[-1]
        t0, t1 = self._times[i - 1], self._times[i]
        v0, v1 = self._values[i - 1], self._values[i]
        if t1 == t0:
            return v1
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0)

    def __eq__(self, other):
        return isinstance(other, Baseline) and self.points == other.points

    def __repr__(self):
        return f"Baseline({self.points!r})"


# ---------------------------------------------------------------- 阈值

@dataclass(frozen=True)
class ThresholdSegment:
    """一段生效区间为 [start, end) 的阈值。end 为 None 表示一直生效到无穷远。

    tolerance: 偏离基线的容差（绝对值）；None 表示不做偏离判定。
    max_jump:  相邻周期间允许的最大跳变（绝对值）；None 表示不做跳变判定。
    lower/upper: 读数越界上下限；None 表示该侧不判定。
    """
    start: int
    end: int | None
    tolerance: float | None = None
    max_jump: float | None = None
    lower: float | None = None
    upper: float | None = None

    def covers(self, t: int) -> bool:
        return self.start <= t and (self.end is None or t < self.end)

    def params(self):
        return (self.tolerance, self.max_jump, self.lower, self.upper)


# ---------------------------------------------------------------- 判定结果

#: 异常类型 -> 排序权重（保证增量重算与全量重算的结果顺序一致）
RULE_ORDER = {"deviation": 0, "jump": 1, "out_of_bounds": 2}


@dataclass(frozen=True)
class Anomaly:
    """一条异常判定。evidence 保存判定依据，reason 为可读说明。"""
    source_id: str
    time: int
    value: float
    channel: str
    kind: str  # deviation | jump | out_of_bounds
    reason: str
    evidence: dict
    severity: float  # 超出幅度相对限值的倍数，>= 1

    def sort_key(self):
        return (self.time, self.channel, RULE_ORDER[self.kind])


# ---------------------------------------------------------------- 数据缺失

@dataclass(frozen=True)
class MissingInterval:
    """一段数据缺失区间，明确列出缺失的逻辑时刻。"""
    source_id: str
    start: int
    end: int
    missing_times: tuple

    @property
    def count(self) -> int:
        return len(self.missing_times)

    def describe(self) -> str:
        return (f"来源 {self.source_id} 在时刻 {self.start}~{self.end} 缺失 "
                f"{self.count} 个周期：{list(self.missing_times)}")


# ---------------------------------------------------------------- 读数冲突

@dataclass(frozen=True)
class ConflictRecord:
    """同一来源同一时刻被多个通道给出矛盾数值时的冲突记录，双方读数均保留。"""
    source_id: str
    time: int
    entries: tuple  # tuple of (channel, value)，按到达顺序

    def describe(self) -> str:
        parts = "，".join(f"通道 {ch}={v}" for ch, v in self.entries)
        return f"来源 {self.source_id} 在时刻 {self.time} 收到冲突读数：{parts}"


# ---------------------------------------------------------------- 聚类结果

@dataclass(frozen=True)
class Cluster:
    """同一园区同一指标在同一时段的异常聚类（可能同源）。"""
    park: str
    metric_type: str
    start: int
    end: int
    contributions: dict  # source_id -> 贡献占比 (0~1)，合计为 1
    anomaly_count: int

    def describe(self) -> str:
        parts = "，".join(f"{sid} 占 {share:.1%}" for sid, share in self.contributions.items())
        return (f"园区 {self.park} 指标 {self.metric_type} 在时刻 {self.start}~{self.end} "
                f"出现可能同源的异常（{self.anomaly_count} 条）：{parts}")


# ---------------------------------------------------------------- 接入结果

@dataclass(frozen=True)
class IngestResult:
    """单条读数的接入结果。index 为其在本批中的位置（从 0 开始）。"""
    status: str  # accepted | duplicate | conflict | rejected
    index: int
    source_id: str
    time: int | None
    reason: str = ""

    @property
    def ok(self) -> bool:
        return self.status in ("accepted", "duplicate", "conflict")
