"""SubtitleSystem —— 包的对外门面。

负责：维护基准与候选轨、驱动“匹配 → 稳健拟合 → 切口检测 → 分段建模 →
容差/冲突分析”的完整流水线、提供确定性查询接口。
"""

from __future__ import annotations

from fractions import Fraction
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

from . import analysis, fitter
from .errors import AlignmentError, ValidationError
from .matcher import AnchorMatcher
from .model import (
    AlignConfig,
    AlignmentReport,
    Anchor,
    BiasEstimate,
    Conflict,
    Entry,
    Reference,
    Segment,
    SegmentQuery,
    SubtitleTrack,
)
from .timecode import Number, to_millis


class SubtitleSystem:
    """基准时间轴 + 若干候选轨的容器与对齐引擎。

    构造后对象状态不可被外部集合直接篡改：添加轨时做唯一性校验，
    载入（:func:`subalign.from_json`）走“先构建临时对象、整体成功再替换”
    的失败原子性约定。
    """

    def __init__(
        self,
        reference: Reference,
        tracks: Optional[Sequence[SubtitleTrack]] = None,
        config: Optional[AlignConfig] = None,
    ):
        self._reference = reference
        self._config = config or AlignConfig()
        self._tracks: Dict[str, SubtitleTrack] = {}
        self._reports: Dict[str, AlignmentReport] = {}
        self._conflicts: List[Conflict] = []
        if tracks:
            for t in tracks:
                self.add_track(t)

    # ------------------------------------------------------------------ #
    # 维护（需求 1）
    # ------------------------------------------------------------------ #
    @property
    def reference(self) -> Reference:
        return self._reference

    @property
    def config(self) -> AlignConfig:
        return self._config

    def track_ids(self) -> List[str]:
        """按加入顺序（== 标识字典序由 add 时保证之外的稳定次序）返回。"""
        return list(self._tracks)

    def get_track(self, track_id: str) -> SubtitleTrack:
        if track_id not in self._tracks:
            raise ValidationError(f"未知字幕轨：{track_id!r}", ("track", track_id))
        return self._tracks[track_id]

    def add_track(self, track: SubtitleTrack) -> None:
        if not isinstance(track, SubtitleTrack):
            raise ValidationError(
                f"必须是 SubtitleTrack，实际为 {type(track).__name__}", ("track",)
            )
        if track.track_id in self._tracks:
            raise ValidationError(
                f"字幕轨标识重复：{track.track_id!r}", ("track", track.track_id)
            )
        self._tracks[track.track_id] = track
        self._reports.pop(track.track_id, None)
        self._conflicts = []  # 轨集合变化，冲突作废，需重算

    # ------------------------------------------------------------------ #
    # 对齐流水线（需求 2/3/4）
    # ------------------------------------------------------------------ #
    def align(self, track_id: Optional[str] = None) -> Dict[str, AlignmentReport]:
        """对齐一条轨或全部轨；返回轨 id → 报告（插入序稳定）。"""
        if track_id is not None:
            targets = [self.get_track(track_id)]
        else:
            targets = list(self._tracks.values())

        matcher = AnchorMatcher(
            threshold=self._config.similarity_threshold,
            fuzzy_cap=self._config.fuzzy_anchor_cap,
            min_anchors=self._config.min_anchors,
        )
        for tr in targets:
            self._reports[tr.track_id] = self._align_one(tr, matcher)

        # 冲突依赖全部报告；单轨重算时也全量重算，保证一致。
        self._conflicts = analysis.detect_conflicts(
            self._reports,
            self._config.conflict_rate_eps,
            self._config.conflict_shift_eps_ms,
        )
        return {t.track_id: self._reports[t.track_id] for t in targets}

    def _align_one(self, track: SubtitleTrack, matcher: AnchorMatcher) -> AlignmentReport:
        anchors = matcher.match(self._reference.entries, track.entries)
        if len(anchors) < self._config.min_anchors:
            return AlignmentReport(
                track_id=track.track_id,
                segments=(),
                anchors=tuple(anchors),
                bias=_empty_bias(anchors),
                tolerance=analysis.build_tolerance_report(
                    self._reference.entries, (), anchors, self._config.tolerance_ms
                ),
                status="insufficient_anchors",
                note=(
                    f"仅有 {len(anchors)} 个锚点，少于最少要求 "
                    f"{self._config.min_anchors}，无法辨识速率；未做校正"
                ),
            )

        cuts = fitter.detect_cuts(
            anchors,
            residual_factor=self._config.cut_residual_factor,
            min_gap_ms=self._config.min_cut_gap_ms,
            min_anchors=self._config.min_anchors,
        )
        segments, missing = fitter.build_segments(
            anchors, cuts, self._config.min_anchors, self._reference.entries
        )
        (
            shift,
            rate,
            shift_conf,
            rate_conf,
            shift_basis,
            rate_basis,
        ) = fitter.aggregate_bias(segments, missing, anchors)
        tolerance = analysis.build_tolerance_report(
            self._reference.entries, segments, anchors, self._config.tolerance_ms
        )
        bias = BiasEstimate(
            shift_ms=shift,
            rate_ratio=rate,
            missing_intervals=tuple(missing),
            shift_confidence=shift_conf,
            rate_confidence=rate_conf,
            shift_basis=shift_basis,
            rate_basis=rate_basis,
        )
        status = "aligned" if len(segments) == 1 else "aligned_segmented"
        note = ""
        if missing:
            note = (
                f"检测到 {len(missing)} 处中段缺失，已在缺失两侧分别拟合，"
                "速率估计不含缺失区间"
            )
        return AlignmentReport(
            track_id=track.track_id,
            segments=tuple(segments),
            anchors=tuple(
                sorted(anchors, key=lambda a: (a.cand_mid, a.ref_index))
            ),
            bias=bias,
            tolerance=tolerance,
            status=status,
            note=note,
        )

    def report(self, track_id: str) -> AlignmentReport:
        if track_id not in self._reports:
            raise AlignmentError(f"轨 {track_id!r} 尚未对齐，请先调用 align()")
        return self._reports[track_id]

    def reports(self) -> Dict[str, AlignmentReport]:
        return dict(self._reports)

    def conflicts(self) -> List[Conflict]:
        """冲突记录（需求 5），按 (区间起点, 终点, 双方 id) 稳定排序。"""
        return list(self._conflicts)

    # ------------------------------------------------------------------ #
    # 查询（需求 6）
    # ------------------------------------------------------------------ #
    def correct_time(
        self, track_id: str, cand_ms: Number
    ) -> SegmentQuery:
        """回答“某轨在某候选时刻校正后的基准时刻”，附参数与锚点溯源。

        重复调用结果逐位一致（全部整数/Fraction 运算，无随机、无浮点排序）。
        """
        rep = self.report(track_id)
        x = to_millis(cand_ms, ("query", track_id))
        if not rep.segments:
            raise AlignmentError(
                f"轨 {track_id!r} 锚点不足，没有可用校正参数",
            )
        seg = rep.segment_for(x)
        corrected = seg.ratio * Fraction(x) + seg.shift
        # 是否落在某个缺失区间对应的候选域分界附近：查询 x 位于两段之间
        # 不会发生（段域首尾相接），但可标出 x 是否处于缺失区间基准投影。
        in_gap = self._in_missing_gap(rep, x, seg)
        return SegmentQuery(
            track_id=track_id,
            cand_ms=x,
            corrected_ms=corrected,
            segment_index=seg.index,
            ratio=seg.ratio,
            shift=seg.shift,
            anchors=seg.anchors,
            extrapolated=seg.extrapolates(x),
            in_missing_gap=in_gap,
            residual_mse=seg.residual_mse,
        )

    def _in_missing_gap(
        self, rep: AlignmentReport, x: int, seg: Segment
    ) -> bool:
        """x 是否处于相邻段分界（即缺失切口）所在的候选时刻。

        段域半开相接，分界点本身归右侧段；这里用一个 0 宽判定：
        只有 x 恰好等于分界才记 True，避免夸大“缺失中”的范围。
        """
        if seg.index == 0:
            return False
        boundary = seg.domain_lo
        return boundary is not None and x == boundary

    def corrected_entries(
        self, track_id: str
    ) -> List[Tuple[Entry, Fraction, Fraction]]:
        """便捷接口：把该轨每条条目起止都校正，返回 (原条目, 校正起, 校正止)。"""
        rep = self.report(track_id)
        out: List[Tuple[Entry, Fraction, Fraction]] = []
        for e in self.get_track(track_id).entries:
            qs = self.correct_time(track_id, e.start)
            qe = self.correct_time(track_id, e.end)
            out.append((e, qs.corrected_ms, qe.corrected_ms))
        return out

    def tolerance_violations(self, track_id: str):
        return self.report(track_id).tolerance.violations

    # ------------------------------------------------------------------ #
    # 便捷构造
    # ------------------------------------------------------------------ #
    @staticmethod
    def build(
        ref_entries: Sequence[Entry],
        track_specs: Mapping[str, Tuple[str, Sequence[Entry]]],
        config: Optional[AlignConfig] = None,
        ref_source: str = "reference",
    ) -> "SubtitleSystem":
        """快速构造：``{轨id: (来源说明, 条目)}``。"""
        sys = SubtitleSystem(Reference(list(ref_entries), source=ref_source), config=config)
        for tid in sorted(track_specs):
            source, entries = track_specs[tid]
            sys.add_track(SubtitleTrack(tid, source, list(entries)))
        return sys


def _empty_bias(anchors: Sequence[Anchor]) -> BiasEstimate:
    return BiasEstimate(
        shift_ms=Fraction(0),
        rate_ratio=Fraction(1),
        missing_intervals=(),
        shift_confidence=0.0,
        rate_confidence=0.0,
        shift_basis="锚点不足，未估计平移（按 0 处理）",
        rate_basis=f"仅有 {len(anchors)} 个锚点，未估计速率（按 1 处理）",
    )
