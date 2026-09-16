"""数据模型与内置校验。

时刻一律为**整数毫秒**；拟合参数（斜率 ratio、截距 shift）一律用
:class:`fractions.Fraction` 精确表示，保证重复计算逐位一致、导出导入无损。
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import List, Optional, Sequence, Tuple

from .errors import ValidationError
from .timecode import Number, format_millis, to_millis


# --------------------------------------------------------------------------- #
# 输入模型
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Entry:
    """一条字幕条目：半开区间 ``[start, end)``（毫秒）与文本。"""

    start: int
    end: int
    text: str

    @property
    def mid(self) -> int:
        return (self.start + self.end) // 2


def _validate_entries(entries: Sequence[Entry], location: Tuple[str, ...]) -> List[Entry]:
    """公共校验：条目必须是列表、起>=0、止>=起、起点单调不减。

    返回拷贝，避免外部再改动绕过校验。
    """
    if not isinstance(entries, (list, tuple)):
        raise ValidationError("字幕条目必须是列表", location)
    out: List[Entry] = []
    prev_start: Optional[int] = None
    for i, raw in enumerate(entries):
        loc = location + (f"entry[{i}]",)
        if not isinstance(raw, Entry):
            raise ValidationError(f"条目必须是 Entry，实际为 {type(raw).__name__}", loc)
        if raw.start < 0:
            raise ValidationError(f"起始时刻不能为负：{format_millis(raw.start)}", loc)
        if raw.end < raw.start:
            raise ValidationError(
                f"结束时刻 {format_millis(raw.end)} 早于起始时刻 {format_millis(raw.start)}",
                loc,
            )
        if not isinstance(raw.text, str):
            raise ValidationError("字幕文本必须是字符串", loc)
        if prev_start is not None and raw.start < prev_start:
            raise ValidationError(
                "起始时刻必须单调不减："
                f"第 {i} 条起点 {format_millis(raw.start)} 早于前一条 {format_millis(prev_start)}",
                loc,
            )
        prev_start = raw.start
        out.append(raw)
    return out


@dataclass(frozen=True)
class Reference:
    """基准时间轴。"""

    entries: List[Entry]
    source: str = "reference"

    def __post_init__(self) -> None:
        if not isinstance(self.source, str) or not self.source.strip():
            raise ValidationError("基准来源说明不能为空", ("reference", "source"))
        checked = _validate_entries(self.entries, ("reference",))
        if not checked:
            raise ValidationError("基准时间轴不能为空", ("reference",))
        object.__setattr__(self, "entries", checked)


@dataclass(frozen=True)
class SubtitleTrack:
    """候选字幕轨：唯一标识、来源说明、条目列表。"""

    track_id: str
    source: str
    entries: List[Entry]

    def __post_init__(self) -> None:
        if not isinstance(self.track_id, str) or not self.track_id.strip():
            raise ValidationError("字幕轨标识不能为空或非字符串", ("track", "id"))
        if any(ch in self.track_id for ch in "/\n\r\t"):
            raise ValidationError(
                f"轨标识不能包含 / 或制表/换行符：{self.track_id!r}", ("track", self.track_id)
            )
        if not isinstance(self.source, str) or not self.source.strip():
            raise ValidationError("来源说明不能为空", ("track", self.track_id, "source"))
        checked = _validate_entries(self.entries, ("track", self.track_id))
        if not checked:
            raise ValidationError("字幕轨不能为空", ("track", self.track_id))
        object.__setattr__(self, "entries", checked)


# --------------------------------------------------------------------------- #
# 对齐结果模型
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Anchor:
    """一个文本匹配锚点。

    时间一律取条目中点（毫秒）。``kind`` 为 ``"exact"``（归一化文本完全一致）
    或 ``"fuzzy"``（相似度达阈值）。
    """

    ref_index: int
    cand_index: int
    ref_mid: int
    cand_mid: int
    score: float
    kind: str
    evidence: str

    def as_tuple(self) -> Tuple[int, int]:
        return (self.ref_index, self.cand_index)


@dataclass(frozen=True)
class Segment:
    """一段连续片段的线性校正：``ref_ms = ratio * cand_ms + shift``。

    域以候选时刻划分：``[domain_lo, domain_lo)``，首段下界为 ``None``（-∞），
    末段上界为 ``None``（+∞）；内部分界在两段相邻锚点候选中点之间。
    """

    index: int
    ratio: Fraction
    shift: Fraction
    anchors: Tuple[Anchor, ...]
    domain_lo: Optional[int]
    domain_hi: Optional[int]
    # 拟合诊断（毫秒，参照基准）。
    residual_max_abs: int
    residual_mse: Fraction

    @property
    def residual_rms(self) -> float:
        """残差均方根（毫秒，浮点，仅供展示；精确诊断看 residual_mse）。"""
        return float(self.residual_mse ** 0.5)

    def contains(self, cand_ms: int) -> bool:
        if self.domain_lo is not None and cand_ms < self.domain_lo:
            return False
        if self.domain_hi is not None and cand_ms >= self.domain_hi:
            return False
        return True

    def correct(self, cand_ms: Number) -> Fraction:
        return self.ratio * Fraction(to_millis(cand_ms)) + self.shift

    def extrapolates(self, cand_ms: int) -> bool:
        """查询时刻是否超出本段锚点覆盖范围（需要外推）。"""
        los = [a.cand_mid for a in self.anchors]
        return cand_ms < min(los) or cand_ms > max(los)


@dataclass(frozen=True)
class MissingInterval:
    """候选轨中段缺失，以基准毫秒表示 ``[ref_lo, ref_hi]``。

    两侧分别由 ``left_anchor`` / ``right_anchor`` 定界；``duration_ms`` 为
    缺失时长，``confidence`` 0~1。
    """

    ref_lo: int
    ref_hi: int
    left_anchor: Tuple[int, int]
    right_anchor: Tuple[int, int]
    duration_ms: int
    confidence: float
    reason: str

    @property
    def mid(self) -> Fraction:
        return (Fraction(self.ref_lo) + self.ref_hi) / 2


@dataclass(frozen=True)
class ToleranceViolation:
    """校正后仍超出容差的一个基准区间。"""

    ref_start: int
    ref_end: int
    max_residual: int
    anchor_points: Tuple[Tuple[int, int], ...]


@dataclass(frozen=True)
class ToleranceReport:
    """容差配置与超限区间（按基准起点稳定排序、相邻重叠已合并）。"""

    tolerance_ms: int
    violations: Tuple[ToleranceViolation, ...]

    @property
    def within_tolerance(self) -> bool:
        return not self.violations


@dataclass(frozen=True)
class BiasEstimate:
    """三类偏差的分项估计（需求 2）。

    * ``shift_ms`` —— 整体平移（截距，毫秒）
    * ``rate_ratio`` —— 线性速率漂移（候选/基准速率比，1 表示无漂移）
    * ``missing_intervals`` —— 局部缺失区间
    """

    shift_ms: Fraction
    rate_ratio: Fraction
    missing_intervals: Tuple[MissingInterval, ...]
    shift_confidence: float
    rate_confidence: float
    shift_basis: str
    rate_basis: str


@dataclass(frozen=True)
class SegmentQuery:
    """任意时刻查询的结果（需求 6）。"""

    track_id: str
    cand_ms: int
    corrected_ms: Fraction
    segment_index: int
    ratio: Fraction
    shift: Fraction
    anchors: Tuple[Anchor, ...]
    extrapolated: bool
    in_missing_gap: bool
    residual_mse: Fraction


@dataclass(frozen=True)
class AlignmentReport:
    """一条候选轨的完整对齐结果与可复核依据。"""

    track_id: str
    segments: Tuple[Segment, ...]
    anchors: Tuple[Anchor, ...]
    bias: BiasEstimate
    tolerance: ToleranceReport
    status: str
    note: str = ""

    def segment_for(self, cand_ms: int) -> Segment:
        for seg in self.segments:
            if seg.contains(cand_ms):
                return seg
        # 理论上不可达：末段上界 +∞。
        return self.segments[-1]


# --------------------------------------------------------------------------- #
# 冲突模型（需求 5）
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class ConflictParams:
    track_id: str
    segment_index: int
    ratio: Fraction
    shift: Fraction
    anchor_ref_range: Tuple[int, int]


@dataclass(frozen=True)
class Conflict:
    """两条轨在同一基准区间上的互相矛盾的校正参数。"""

    interval_ref_lo: int
    interval_ref_hi: int
    track_a: ConflictParams
    track_b: ConflictParams
    rate_delta: Fraction
    shift_delta_ms: Fraction
    reason: str

    def key(self) -> Tuple[str, str, int, int]:
        a, b = sorted((self.track_a.track_id, self.track_b.track_id))
        return (a, b, self.interval_ref_lo, self.interval_ref_hi)


# --------------------------------------------------------------------------- #
# 配置
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class AlignConfig:
    """对齐参数。全部有确定性默认值。

    :param similarity_threshold: 模糊锚点相似度阈值（0~1）。
    :param min_anchors: 单段拟合所需最少锚点数（2 个才能辨识速率）。
    :param cut_residual_factor: 切口检测时，残差超过中位绝对残差的倍数。
    :param min_cut_gap_ms: 两侧预测在基准轴上的最小错位，才算中段缺失。
    :param tolerance_ms: 验收容差（毫秒）。
    :param conflict_rate_eps: 判矛盾时速率比差阈值（绝对值）。
    :param conflict_shift_eps_ms: 判矛盾时平移差阈值（毫秒）。
    :param fuzzy_anchor_cap: 模糊锚点数相对候选条目数的上限比例，
        超过时只保留相似度最高的若干个（至少保留 min_anchors 个）。
    """

    similarity_threshold: float = 0.45
    min_anchors: int = 2
    cut_residual_factor: float = 3.0
    min_cut_gap_ms: int = 1500
    tolerance_ms: int = 250
    conflict_rate_eps: Fraction = Fraction(2, 100)
    conflict_shift_eps_ms: int = 400
    fuzzy_anchor_cap: float = 0.8

    def __post_init__(self) -> None:
        def bad(msg: str) -> None:
            raise ValidationError(msg, ("config",))

        if not (0.0 < self.similarity_threshold <= 1.0):
            bad("similarity_threshold 必须在 (0, 1] 内")
        if self.min_anchors < 2:
            bad("min_anchors 至少为 2（单点无法辨识速率）")
        if self.cut_residual_factor <= 1.0:
            bad("cut_residual_factor 必须大于 1")
        if self.min_cut_gap_ms < 0:
            bad("min_cut_gap_ms 不能为负")
        if self.tolerance_ms < 0:
            bad("tolerance_ms 不能为负")
        if not (0 < self.conflict_rate_eps):
            bad("conflict_rate_eps 必须为正")
        if self.conflict_shift_eps_ms < 0:
            bad("conflict_shift_eps_ms 不能为负")
        if not (0.0 < self.fuzzy_anchor_cap <= 1.0):
            bad("fuzzy_anchor_cap 必须在 (0, 1] 内")
