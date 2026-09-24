"""对齐推演引擎。

沿锚点与片段顺序推导每段相对媒体的偏移量，检测重叠/越界/时长倒置/
锚点缺失等矛盾。矛盾双方依据均保留；用户裁决或锚点修正后仅重算受
影响片段，结果与整体重推一致。
"""
from __future__ import annotations

from typing import Optional

from .models import (Anchor, AlignmentResult, Conflict, Evidence, MediaInfo,
                     Segment)

DEFAULT_TOLERANCE = 0.5  # 秒：锚点偏移与上下文偏移差异的容忍阈值


class AlignmentEngine:
    def __init__(self, media: MediaInfo, segments: list, anchors: list,
                 tolerance: float = DEFAULT_TOLERANCE):
        self.media = media
        self.segments = sorted(segments, key=lambda s: (s.start, s.id))
        self.anchors = {a.id: a for a in anchors}
        self.tolerance = tolerance
        self.resolutions = {}            # conflict_id -> choice
        self.results = {}                # segment_id -> AlignmentResult
        self.conflicts = {}              # conflict_id -> Conflict
        self.recompute_all()

    # ---------- 偏移推导 ----------
    def _anchor_offsets(self) -> list:
        """每段由自身锚点直接给出的偏移（无锚点为 None）。"""
        out = []
        for s in self.segments:
            a = self.anchors.get(s.anchor_id) if s.anchor_id else None
            out.append(a.media_time - s.start if a else None)
        return out

    def _context_offset(self, i: int, anchor_off: list):
        """由前后最近锚点段插值/顺延得到的上下文偏移及依据说明。"""
        prev = next((j for j in range(i - 1, -1, -1)
                     if anchor_off[j] is not None), None)
        nxt = next((j for j in range(i + 1, len(self.segments))
                    if anchor_off[j] is not None), None)
        if prev is not None and nxt is not None:
            t = (i - prev) / (nxt - prev)
            off = anchor_off[prev] * (1 - t) + anchor_off[nxt] * t
            return off, ("interp",
                         f"由相邻锚点段 {self.segments[prev].id} 与 "
                         f"{self.segments[nxt].id} 线性插值")
        if prev is not None:
            return anchor_off[prev], ("carry_prev",
                                      f"沿用前向锚点段 {self.segments[prev].id}")
        if nxt is not None:
            return anchor_off[nxt], ("carry_next",
                                     f"沿用后向锚点段 {self.segments[nxt].id}")
        return None, ("no_anchor", "全片无可用锚点，无法判定偏移")

    # ---------- 整体重算 ----------
    def recompute_all(self):
        anchor_off = self._anchor_offsets()
        self.results = {}
        self.conflicts = {}
        for i, seg in enumerate(self.segments):
            self.results[seg.id] = self._compute_one(i, seg, anchor_off)
        for seg in self.segments:
            self._merge_neighbor_conflicts(seg.id)
        self._compute_drift()

    def _merge_neighbor_conflicts(self, seg_id: str):
        """把相邻段产生但涉及本段的矛盾（如重叠）并入本段结果。"""
        res = self.results[seg_id]
        for cid, conf in self.conflicts.items():
            if seg_id in conf.segment_ids and cid not in res.conflict_ids:
                res.conflict_ids.append(cid)
                if res.status == "ok":
                    res.status = "conflict"

    def _compute_one(self, i: int, seg: Segment,
                     anchor_off: list) -> AlignmentResult:
        ev, cids = [], []
        own = anchor_off[i]
        anchor_missing = False
        if seg.anchor_id and own is None:
            anchor_missing = True
            ev.append(Evidence("no_anchor",
                               f"引用的锚点 {seg.anchor_id} 不存在"))
        ctx_off, (kind, desc) = self._context_offset(i, anchor_off)
        if own is not None:
            ev.append(Evidence("anchor",
                               f"锚点 {seg.anchor_id}（媒体时刻 "
                               f"{self.anchors[seg.anchor_id].media_time:.3f}s）",
                               own))
        if ctx_off is not None:
            ev.append(Evidence(kind, desc, ctx_off))
        # 选择生效偏移：锚点优先，矛盾时看裁决。
        # 仅当上下文估计来自双侧锚点插值（interp）时才构成强矛盾；
        # 单侧顺延（carry）证据较弱，只记录不冲突。
        offset, status = None, "ok"
        if own is not None and ctx_off is not None and \
                kind == "interp" and abs(own - ctx_off) > self.tolerance:
            cid = f"anchor:{seg.id}"
            choice = self.resolutions.get(cid)
            conf = Conflict(cid, "anchor_vs_context", [seg.id],
                            f"锚点偏移 {own:+.3f}s 与上下文偏移 "
                            f"{ctx_off:+.3f}s 矛盾",
                            [Evidence("anchor", "锚点直接给出", own),
                             Evidence("context", "相邻锚点插值给出", ctx_off)],
                            choice)
            self.conflicts[cid] = conf
            cids.append(cid)
            status = "conflict"
            offset = own if choice != "context" else ctx_off
        elif own is not None:
            offset = own
        elif ctx_off is not None:
            offset = ctx_off
            if anchor_missing:
                status = "conflict"
        return self._finish(i, seg, offset, status, ev, cids)

    def _finish(self, i, seg, offset, status, ev, cids) -> AlignmentResult:
        """结构性检查（倒置/越界/重叠）并生成最终结果。"""
        a_start = seg.start + offset if offset is not None else None
        a_end = seg.end + offset if offset is not None else None
        if seg.end <= seg.start:
            cid = f"invert:{seg.id}"
            self.conflicts[cid] = Conflict(
                cid, "invert", [seg.id],
                f"时长倒置：结束 {seg.end:.3f}s 不晚于开始 {seg.start:.3f}s",
                [Evidence("invert", "结束时刻必须大于开始时刻")],
                self.resolutions.get(cid))
            cids.append(cid)
            ev.append(Evidence("invert", "时长倒置，对齐结果不可信"))
            status = "untrusted"
        if offset is None:
            if not any(e.kind == "no_anchor" for e in ev):
                ev.append(Evidence("no_anchor", "无锚点可推导偏移"))
            status = "untrusted"
        else:
            if a_start < 0 or a_end > self.media.duration:
                cid = f"bounds:{seg.id}"
                self.conflicts[cid] = Conflict(
                    cid, "bounds", [seg.id],
                    f"越界：对齐后 [{a_start:.3f}, {a_end:.3f}] 超出媒体 "
                    f"[0, {self.media.duration:.3f}]",
                    [Evidence("bounds", "对齐区间", None),
                     Evidence("bounds", f"媒体总长 {self.media.duration:.3f}s")],
                    self.resolutions.get(cid))
                cids.append(cid)
                ev.append(Evidence("bounds", "对齐后超出媒体范围"))
                if status == "ok":
                    status = "conflict"
            # 与下一段的重叠检查（基于对齐后时刻）
            if i + 1 < len(self.segments):
                nseg = self.segments[i + 1]
                # 下一段偏移可能尚未算完，这里用标称重叠判断
                if seg.end > nseg.start:
                    cid = f"overlap:{seg.id}:{nseg.id}"
                    self.conflicts[cid] = Conflict(
                        cid, "overlap", [seg.id, nseg.id],
                        f"重叠：{seg.id} 结束 {seg.end:.3f}s 晚于 "
                        f"{nseg.id} 开始 {nseg.start:.3f}s",
                        [Evidence("overlap", f"{seg.id} 结束 {seg.end:.3f}s"),
                         Evidence("overlap", f"{nseg.id} 开始 {nseg.start:.3f}s")],
                        self.resolutions.get(cid))
                    cids.append(cid)
                    ev.append(Evidence("overlap", f"与 {nseg.id} 时间重叠"))
                    if status == "ok":
                        status = "conflict"
        return AlignmentResult(seg.id, offset, a_start, a_end, status,
                               ev, cids)

    def _compute_drift(self):
        """漂移 = 相邻段偏移差；累计漂移 = 相对首段的偏移差。"""
        prev_off, base = None, None
        for seg in self.segments:
            r = self.results[seg.id]
            if r.offset is None:
                r.drift = r.cumulative_drift = None
                continue
            if base is None:
                base = r.offset
            r.drift = None if prev_off is None else r.offset - prev_off
            r.cumulative_drift = r.offset - base
            prev_off = r.offset

    def drift_trend(self) -> list:
        """[(segment_id, offset, drift, cumulative_drift)]，供趋势展示。"""
        return [(s.id, self.results[s.id].offset, self.results[s.id].drift,
                 self.results[s.id].cumulative_drift) for s in self.segments]

    # ---------- 增量更新 ----------
    def _dependents_of_anchor(self, anchor_id: str) -> set:
        """偏移推导依赖该锚点的片段下标集合（自身 + 前后顺延/插值链）。"""
        anchor_off = self._anchor_offsets()
        holders = [i for i, s in enumerate(self.segments)
                   if s.anchor_id == anchor_id]
        affected = set(holders)
        for h in holders:
            j = h - 1
            while j >= 0 and anchor_off[j] is None:
                affected.add(j)
                j -= 1
            j = h + 1
            while j < len(self.segments) and anchor_off[j] is None:
                affected.add(j)
                j += 1
        return affected

    def _recompute_subset(self, indices: set):
        """只重算给定下标的片段结果与相关矛盾，其余保持不变。"""
        anchor_off = self._anchor_offsets()
        # 重叠矛盾涉及相邻段，把后继段一并纳入重算范围
        indices = set(indices) | {i + 1 for i in indices
                                  if i + 1 < len(self.segments)}
        touched_ids = {self.segments[i].id for i in indices}
        # 清除涉及这些片段的旧矛盾
        for cid in [c for c, conf in self.conflicts.items()
                    if touched_ids & set(conf.segment_ids)]:
            del self.conflicts[cid]
        for i in sorted(indices):
            seg = self.segments[i]
            res = self._compute_one(i, seg, anchor_off)
            self.results[seg.id] = res
            self._merge_neighbor_conflicts(seg.id)
        self._compute_drift()
        return touched_ids

    def update_anchor(self, anchor_id: str, new_time: float) -> set:
        """修正锚点时刻，仅重算受影响片段，返回受影响片段 id 集合。"""
        if anchor_id not in self.anchors:
            raise KeyError(f"锚点不存在: {anchor_id}")
        self.anchors[anchor_id].media_time = new_time
        return self._recompute_subset(self._dependents_of_anchor(anchor_id))

    def resolve_conflict(self, conflict_id: str, choice: str) -> set:
        """裁决矛盾（如 anchor/context），仅重算受影响片段。"""
        if conflict_id not in self.conflicts:
            raise KeyError(f"矛盾不存在: {conflict_id}")
        self.resolutions[conflict_id] = choice
        seg_ids = self.conflicts[conflict_id].segment_ids
        indices = {i for i, s in enumerate(self.segments) if s.id in seg_ids}
        # 锚点矛盾的裁决会改变该段偏移，进而影响其插值下游
        for i in list(indices):
            s = self.segments[i]
            if s.anchor_id:
                indices |= self._dependents_of_anchor(s.anchor_id)
        return self._recompute_subset(indices)
