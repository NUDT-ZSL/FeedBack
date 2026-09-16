"""ProfilerSession：一次剖析会话的帧树、采样、缺口、冲突与查询。

核心不变式：
- 对每个帧 f：f.cumulative == f.self_time + Σ f.children.cumulative
- 会话总耗时 == 所有根帧累计耗时之和 == 全部被接受采样的自耗时之和
- 增量重算只触及受影响帧及其祖先，且结果与全量重算完全一致
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

from .errors import FrameError, GapError
from .models import (
    ChainLink,
    ConflictRecord,
    ContributionReport,
    FrameStats,
    GapRecord,
    IngestReport,
    Observation,
    Rejection,
    Sample,
    SourceContribution,
)


@dataclass
class _Frame:
    """内部帧节点。children 保持插入顺序，保证遍历顺序稳定。"""

    frame_id: str
    thread_id: str
    name: str
    parent_id: Optional[str]
    depth: int
    children: List[str] = field(default_factory=list)
    # 被接受的采样，键为 (thread_id, timestamp)，用于幂等与冲突撤回
    samples: Dict[Tuple[str, float], Sample] = field(default_factory=dict)
    self_time: float = 0.0
    cumulative: float = 0.0
    has_conflict: bool = False


class ProfilerSession:
    """一次剖析会话。热点阈值为累计耗时占会话总耗时的比例。"""

    DEFAULT_HOTSPOT_THRESHOLD = 0.20

    def __init__(self, hotspot_threshold: float = DEFAULT_HOTSPOT_THRESHOLD):
        if not 0.0 < hotspot_threshold <= 1.0:
            raise ValueError(f"热点阈值必须在 (0, 1] 内，得到 {hotspot_threshold}")
        self._threshold = float(hotspot_threshold)
        self._frames: Dict[str, _Frame] = {}
        # 已被接受并入树的采样，键为 (thread_id, timestamp)
        self._accepted: Dict[Tuple[str, float], Sample] = {}
        # 冲突记录及其索引（键为 (thread_id, timestamp)），同一位置的冲突会合并追加
        self._conflicts: List[ConflictRecord] = []
        self._conflict_index: Dict[Tuple[str, float], int] = {}
        self._gaps: List[GapRecord] = []
        # 增量重算的脏集合：只重算这些帧（调用方保证祖先也在集合内）
        self._dirty: set = set()

    # ------------------------------------------------------------------
    # 1. 帧结构管理
    # ------------------------------------------------------------------

    def add_frame(
        self,
        frame_id: str,
        thread_id: str,
        name: str,
        parent_id: Optional[str] = None,
    ) -> None:
        """登记一个调用帧。父帧必须已存在（根帧 parent_id 为 None）。

        新帧没有任何子帧，因此挂到已存在的父帧下不可能成环。
        """
        if frame_id in self._frames:
            raise FrameError(f"帧标识重复：{frame_id!r}")
        if parent_id is None:
            depth = 0
        else:
            parent = self._frames.get(parent_id)
            if parent is None:
                raise FrameError(f"父帧不存在：{parent_id!r}（帧 {frame_id!r}）")
            depth = parent.depth + 1
        self._frames[frame_id] = _Frame(
            frame_id=frame_id,
            thread_id=thread_id,
            name=name,
            parent_id=parent_id,
            depth=depth,
        )
        if parent_id is not None:
            self._frames[parent_id].children.append(frame_id)

    def reparent_frame(self, frame_id: str, new_parent_id: Optional[str]) -> None:
        """修正某帧的归属。不允许成环；只重算新旧两条祖先链。

        被移动子树自身的自耗时与累计耗时不变，但其深度会更新；
        旧父链失去该子树的累计，新父链获得该子树的累计。
        """
        frame = self._require_frame(frame_id)
        if new_parent_id is not None:
            if new_parent_id == frame_id:
                raise FrameError(f"帧不能作为自己的父帧：{frame_id!r}")
            new_parent = self._frames.get(new_parent_id)
            if new_parent is None:
                raise FrameError(f"父帧不存在：{new_parent_id!r}")
            # 成环检查：从 new_parent 一路向上，若遇到 frame_id 则成环
            cursor: Optional[str] = new_parent_id
            while cursor is not None:
                if cursor == frame_id:
                    raise FrameError(
                        f"归属修正会成环：{frame_id!r} 是 {new_parent_id!r} 的祖先"
                    )
                cursor = self._frames[cursor].parent_id

        old_parent_id = frame.parent_id
        if old_parent_id == new_parent_id:
            return  # 无变化，幂等

        if old_parent_id is not None:
            self._frames[old_parent_id].children.remove(frame_id)
            self._mark_dirty_up(old_parent_id)
        frame.parent_id = new_parent_id
        if new_parent_id is not None:
            self._frames[new_parent_id].children.append(frame_id)
            self._mark_dirty_up(new_parent_id)
            new_depth = self._frames[new_parent_id].depth + 1
        else:
            new_depth = 0
        self._set_depth(frame_id, new_depth)
        self._dirty.add(frame_id)  # 深度变化不影响数值，但保持一致性
        self._recompute_dirty()

    def _set_depth(self, frame_id: str, depth: int) -> None:
        frame = self._frames[frame_id]
        frame.depth = depth
        for child_id in frame.children:
            self._set_depth(child_id, depth + 1)

    def _require_frame(self, frame_id: str) -> _Frame:
        frame = self._frames.get(frame_id)
        if frame is None:
            raise FrameError(f"帧不存在：{frame_id!r}")
        return frame

    # ------------------------------------------------------------------
    # 2. 采样摄入：校验、幂等、冲突
    # ------------------------------------------------------------------

    def add_samples(self, samples: Iterable[Sample], source: str = "default") -> IngestReport:
        """摄入一批采样。逐条校验，拒绝不中断批次，位置与原因记入报告。

        - 同一线程同一时刻的重复采样（帧与自耗时完全一致）按幂等跳过；
        - 同一位置出现不同观测时保留双方、生成冲突记录，且双方均不计入聚合；
        - 自耗时非正、深度与栈不一致、帧不存在、线程不匹配的采样被拒绝。
        """
        report = IngestReport()
        for index, sample in enumerate(samples):
            if source != "default" and sample.source == "default":
                sample = Sample(
                    thread_id=sample.thread_id,
                    timestamp=sample.timestamp,
                    frame_id=sample.frame_id,
                    depth=sample.depth,
                    self_time=sample.self_time,
                    source=source,
                )
            self._ingest_one(index, sample, report)
        self._recompute_dirty()
        return report

    def _ingest_one(self, index: int, sample: Sample, report: IngestReport) -> None:
        def reject(reason: str) -> None:
            report.rejected.append(
                Rejection(
                    batch_index=index,
                    thread_id=sample.thread_id,
                    timestamp=sample.timestamp,
                    frame_id=sample.frame_id,
                    reason=reason,
                )
            )

        frame = self._frames.get(sample.frame_id)
        if frame is None:
            reject(f"帧不存在：{sample.frame_id!r}")
            return
        if frame.thread_id != sample.thread_id:
            reject(
                f"线程不匹配：帧 {sample.frame_id!r} 属于线程 {frame.thread_id!r}，"
                f"采样来自线程 {sample.thread_id!r}"
            )
            return
        if sample.self_time <= 0:
            reject(f"自耗时必须为正数，得到 {sample.self_time}")
            return
        if sample.depth != frame.depth:
            reject(
                f"深度与调用栈不一致：采样深度 {sample.depth}，"
                f"帧 {sample.frame_id!r} 实际深度 {frame.depth}"
            )
            return

        key = (sample.thread_id, sample.timestamp)

        # 该位置已有冲突：追加一方观测，双方仍均不计入聚合
        if key in self._conflict_index:
            record = self._conflicts[self._conflict_index[key]]
            record.observations.append(
                Observation(sample.frame_id, sample.self_time, sample.source)
            )
            frame.has_conflict = True
            report.conflicts.append(record)
            return

        existing = self._accepted.get(key)
        if existing is not None:
            if (
                existing.frame_id == sample.frame_id
                and existing.self_time == sample.self_time
            ):
                report.duplicates += 1  # 幂等：同一采样的重复上报
                return
            # 冲突：撤回原有观测的聚合贡献，双方一并保留在冲突记录中
            self._withdraw(existing)
            record = ConflictRecord(
                thread_id=sample.thread_id,
                timestamp=sample.timestamp,
                observations=[
                    Observation(existing.frame_id, existing.self_time, existing.source),
                    Observation(sample.frame_id, sample.self_time, sample.source),
                ],
            )
            self._conflict_index[key] = len(self._conflicts)
            self._conflicts.append(record)
            self._frames[existing.frame_id].has_conflict = True
            frame.has_conflict = True
            report.conflicts.append(record)
            return

        # 正常接受
        self._accepted[key] = sample
        frame.samples[key] = sample
        frame.self_time += sample.self_time
        self._mark_dirty_up(sample.frame_id)
        report.accepted += 1

    def _withdraw(self, sample: Sample) -> None:
        """把一条已接受采样从聚合中撤回（因冲突），帧数据保留在冲突记录里。"""
        del self._accepted[(sample.thread_id, sample.timestamp)]
        frame = self._frames[sample.frame_id]
        del frame.samples[(sample.thread_id, sample.timestamp)]
        frame.self_time -= sample.self_time
        self._mark_dirty_up(sample.frame_id)

    # ------------------------------------------------------------------
    # 3. 归并与重算
    # ------------------------------------------------------------------

    def _mark_dirty_up(self, frame_id: str) -> None:
        """把某帧及其全部祖先标脏（自耗时变化只向上传播）。"""
        cursor: Optional[str] = frame_id
        while cursor is not None:
            self._dirty.add(cursor)
            cursor = self._frames[cursor].parent_id

    def _recompute_dirty(self) -> None:
        """增量重算：只重算脏集合中的帧，按深度从深到浅保证子帧先完成。"""
        if not self._dirty:
            return
        for fid in sorted(self._dirty, key=lambda f: -self._frames[f].depth):
            frame = self._frames[fid]
            frame.cumulative = frame.self_time + sum(
                self._frames[c].cumulative for c in frame.children
            )
        self._dirty.clear()

    def recompute_full(self) -> None:
        """从头重新归并：由已接受采样重建全部自耗时与累计耗时。

        增量路径的结果必须与此完全一致（测试中有逐项断言）。
        """
        for frame in self._frames.values():
            frame.self_time = sum(s.self_time for s in frame.samples.values())
        for fid in sorted(self._frames, key=lambda f: -self._frames[f].depth):
            frame = self._frames[fid]
            frame.cumulative = frame.self_time + sum(
                self._frames[c].cumulative for c in frame.children
            )
        self._dirty.clear()

    # ------------------------------------------------------------------
    # 4. 数据缺失区间
    # ------------------------------------------------------------------

    def mark_gap(
        self, thread_id: str, start: float, end: float, reason: str = ""
    ) -> GapRecord:
        """标记一段因线程中断产生的数据缺失区间（闭区间）。

        缺失区间不折算为零耗时，只用于把落在其中的帧标记为数据不完整，
        使其失去热点判定资格，避免被误判为热点。
        """
        if end < start:
            raise GapError(f"缺失区间起止颠倒：start={start} > end={end}")
        record = GapRecord(thread_id=thread_id, start=start, end=end, reason=reason)
        self._gaps.append(record)
        return record

    def missing_intervals(self, thread_id: Optional[str] = None) -> Tuple[GapRecord, ...]:
        """按 (线程, 起点, 终点) 稳定顺序返回缺失区间。"""
        gaps = [g for g in self._gaps if thread_id is None or g.thread_id == thread_id]
        return tuple(sorted(gaps, key=lambda g: (g.thread_id, g.start, g.end)))

    def _gap_affected(self, frame: _Frame) -> bool:
        """帧自身采样的时刻区间与其所属线程的缺失区间相交即为受影响。"""
        if not frame.samples:
            return False
        timestamps = [key[1] for key in frame.samples]
        lo, hi = min(timestamps), max(timestamps)
        return any(
            gap.thread_id == frame.thread_id and gap.overlaps(lo, hi)
            for gap in self._gaps
        )

    # ------------------------------------------------------------------
    # 5/7. 查询
    # ------------------------------------------------------------------

    @property
    def total_time(self) -> float:
        """会话总耗时：全部根帧累计耗时之和（即全部被接受采样的自耗时之和）。"""
        return sum(
            frame.cumulative for frame in self._frames.values() if frame.parent_id is None
        )

    @property
    def conflicts(self) -> Tuple[ConflictRecord, ...]:
        """全部冲突记录，按 (线程, 时刻) 稳定排序。"""
        return tuple(
            sorted(self._conflicts, key=lambda c: (c.thread_id, c.timestamp))
        )

    def frame_ids(self) -> Tuple[str, ...]:
        """全部帧标识，按登记顺序（稳定）。"""
        return tuple(self._frames.keys())

    def frame_stats(self, frame_id: str) -> FrameStats:
        """单帧统计：自耗时、累计耗时、占比、是否热点及资格原因。"""
        frame = self._require_frame(frame_id)
        total = self.total_time
        ratio = frame.cumulative / total if total > 0 else 0.0
        gap_affected = self._gap_affected(frame)
        reasons: List[str] = []
        if gap_affected:
            reasons.append("采样区间与数据缺失区间相交，数据不完整")
        if frame.has_conflict:
            reasons.append("存在未裁决的采样冲突，双方均未计入聚合")
        eligible = not reasons
        return FrameStats(
            frame_id=frame.frame_id,
            name=frame.name,
            thread_id=frame.thread_id,
            depth=frame.depth,
            self_time=frame.self_time,
            cumulative_time=frame.cumulative,
            ratio=ratio,
            is_hotspot=eligible and ratio >= self._threshold,
            eligible=eligible,
            ineligibility_reasons=tuple(reasons),
            sample_count=len(frame.samples),
            gap_affected=gap_affected,
            has_conflict=frame.has_conflict,
        )

    def hotspots(self, threshold: Optional[float] = None) -> Tuple[FrameStats, ...]:
        """热点帧列表：按累计耗时降序、帧标识升序稳定排序。

        数据不完整（缺失/冲突）的帧不会出现在结果中。
        """
        limit = self._threshold if threshold is None else float(threshold)
        if not 0.0 < limit <= 1.0:
            raise ValueError(f"热点阈值必须在 (0, 1] 内，得到 {limit}")
        stats = [self.frame_stats(fid) for fid in self._frames]
        hot = [s for s in stats if s.eligible and s.ratio >= limit]
        hot.sort(key=lambda s: (-s.cumulative_time, s.frame_id))
        return tuple(hot)

    def call_chain(self, frame_id: str) -> Tuple[ChainLink, ...]:
        """从根到目标帧的完整调用链，含每环的自耗时、累计耗时与占比。"""
        self._require_frame(frame_id)
        total = self.total_time
        chain: List[ChainLink] = []
        cursor: Optional[str] = frame_id
        while cursor is not None:
            frame = self._frames[cursor]
            chain.append(
                ChainLink(
                    frame_id=frame.frame_id,
                    name=frame.name,
                    thread_id=frame.thread_id,
                    self_time=frame.self_time,
                    cumulative_time=frame.cumulative,
                    share=frame.cumulative / total if total > 0 else 0.0,
                )
            )
            cursor = frame.parent_id
        chain.reverse()
        return tuple(chain)

    def contributions(self, frame_id: str) -> ContributionReport:
        """某帧的贡献来源：各来源计入的自耗时与样本数，以及涉及该帧的冲突。"""
        frame = self._require_frame(frame_id)
        by_source: Dict[str, List[float]] = {}
        counts: Dict[str, int] = {}
        for sample in frame.samples.values():
            by_source.setdefault(sample.source, []).append(sample.self_time)
        sources = tuple(
            SourceContribution(
                source=src,
                self_time=sum(by_source[src]),
                sample_count=len(by_source[src]),
            )
            for src in sorted(by_source)
        )
        conflicts = tuple(c for c in self.conflicts if c.involves(frame_id))
        return ContributionReport(frame_id=frame_id, sources=sources, conflicts=conflicts)
