"""剖析会话的公开数据模型。

约定：
- 深度（depth）定义为该帧的祖先数量，根帧深度为 0。
- 逻辑时刻（timestamp）为单调意义上的逻辑时钟，允许整数或浮点。
- 自耗时（self_time）必须为正数；幂等判定对自耗时做精确相等比较。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Tuple


@dataclass(frozen=True)
class Sample:
    """一条采样：某线程在某逻辑时刻对某帧的自耗时观测。"""

    thread_id: str
    timestamp: float
    frame_id: str
    depth: int
    self_time: float
    source: str = "default"


@dataclass(frozen=True)
class Observation:
    """冲突中的一方观测：谁（source）对哪帧报告了多大的自耗时。"""

    frame_id: str
    self_time: float
    source: str


@dataclass
class ConflictRecord:
    """同一（线程, 时刻）被多来源给出互相矛盾采样时的冲突记录。

    双方（或多方）观测全部保留在 observations 中，且均未计入聚合结果，
    绝不静默择一。
    """

    thread_id: str
    timestamp: float
    observations: list = field(default_factory=list)  # list[Observation]

    @property
    def frame_ids(self) -> Tuple[str, ...]:
        return tuple(obs.frame_id for obs in self.observations)

    def involves(self, frame_id: str) -> bool:
        return any(obs.frame_id == frame_id for obs in self.observations)

    def describe(self) -> str:
        parts = "；".join(
            f"来源 {obs.source!r} 报告帧 {obs.frame_id!r} 自耗时 {obs.self_time}"
            for obs in self.observations
        )
        return (
            f"采样冲突：线程 {self.thread_id!r} 时刻 {self.timestamp}，"
            f"{parts}。各方观测均已保留，均未计入聚合耗时。"
        )


@dataclass(frozen=True)
class GapRecord:
    """一段数据缺失区间（线程中断导致），区间两端均为闭区间。

    缺失区间只用于标记"数据不完整"，绝不折算为零耗时。
    """

    thread_id: str
    start: float
    end: float
    reason: str = ""

    def overlaps(self, lo: float, hi: float) -> bool:
        return self.start <= hi and lo <= self.end


@dataclass(frozen=True)
class Rejection:
    """一条被拒绝的采样，携带其在批次中的位置与原因。"""

    batch_index: int
    thread_id: str
    timestamp: float
    frame_id: str
    reason: str

    def describe(self) -> str:
        return (
            f"采样被拒绝：批次第 {self.batch_index} 条，线程 {self.thread_id!r} "
            f"时刻 {self.timestamp} 帧 {self.frame_id!r}，原因：{self.reason}"
        )


@dataclass
class IngestReport:
    """一批采样的摄入结果。"""

    accepted: int = 0
    duplicates: int = 0
    rejected: list = field(default_factory=list)   # list[Rejection]
    conflicts: list = field(default_factory=list)  # list[ConflictRecord]，本批新增或更新的冲突


@dataclass(frozen=True)
class FrameStats:
    """单帧的查询结果。"""

    frame_id: str
    name: str
    thread_id: str
    depth: int
    self_time: float
    cumulative_time: float
    ratio: float                 # 占会话总耗时比例，总耗时为 0 时为 0.0
    is_hotspot: bool
    eligible: bool               # 是否有资格参与热点判定
    ineligibility_reasons: Tuple[str, ...]  # 无资格的原因（数据缺失/存在冲突）
    sample_count: int
    gap_affected: bool
    has_conflict: bool


@dataclass(frozen=True)
class ChainLink:
    """调用链上的一环（从根到目标帧有序排列）。"""

    frame_id: str
    name: str
    thread_id: str
    self_time: float
    cumulative_time: float
    share: float  # 该环累计耗时占会话总耗时比例


@dataclass(frozen=True)
class SourceContribution:
    """某一来源对某帧自耗时的贡献。"""

    source: str
    self_time: float
    sample_count: int


@dataclass(frozen=True)
class ContributionReport:
    """某帧的贡献来源：各来源计入的自耗时 + 涉及该帧的冲突记录。"""

    frame_id: str
    sources: Tuple[SourceContribution, ...]  # 按来源名稳定排序
    conflicts: Tuple[ConflictRecord, ...]    # 按 (线程, 时刻) 稳定排序
