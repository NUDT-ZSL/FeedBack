"""mapmatching.store —— 临时禁行后的增量重算（需求 7）。

核心保证
========
当某条路段 E 被临时禁行时：

1. **只动经过它的片段**
   先逐点重匹配以发现"最佳匹配发生变化"的采样时刻（dirty ticks），
   再结合旧片段中实际使用 E 的片段，精确圈定每个来源中受影响的
   连续匹配 run；其余 run（连同其片段 Python 对象）原样保留，可用
   ``is`` 直接验证未受影响片段没有改变。
2. **结果与从头重算完全一致**
   受影响 run 用与全量还原完全相同的确定性 DP 重算；更新完成后自动
   执行等价性校验：把受影响轨迹在当前路网上从头全量重匹配、重拼接，
   逐片段（tick 区间 + 规范内容）与增量结果比对，完全一致才置
   ``equivalent_to_full_rebuild=True``。
3. **可追溯**
   每次更新返回 :class:`IncrementalUpdate`，列出被替换/新增/消失的
   片段、原样复用的片段、新出现的不可达断点。

正确性依据（禁行的单调性）
--------------------------
禁行只会让候选消失，不会产生新候选，因此：原本偏离过远的未匹配点
不可能变为匹配，连续匹配 run 的边界只会"分裂"，不会"合并"；旧最优
路径若不经过 E，移除含 E 的候选后它仍可行且代价不变，故仍是确定性
DP 的最优解。所以"片段使用 E 或片段内存在最佳匹配变化的采样点"
就是受影响面的精确（非近似）判据。

解除禁行不具备上述单调性（可能让原本绕路的片段出现更短补路），局部
无法严格判定影响面，故采用保守策略：可能受益的轨迹整轨迹重算，其余
轨迹的 :class:`Reconstruction` 对象原样不动，并同样执行等价性校验。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .geometry import Geometry
from .matching import Matcher, MatchResult, MatchStatus
from .pathfinding import (
    LEG_UNREACHABLE,
    Fragment,
    Leg,
    PathBuildDiagnostic,
    PathBuilder,
    SourceBuild,
)
from .samples import Track
from .tracker import MultiSourceConflict, Reconstruction, TrackReconstructor


@dataclass
class _RunCache:
    """某来源一个连续匹配 run 的缓存（供下次增量更新复用）。"""

    run_results: List[MatchResult]
    fragments: List[Fragment]
    broken: List[Leg]

    @property
    def tick_span(self) -> Tuple[int, int]:
        return (
            self.run_results[0].observation.tick,
            self.run_results[-1].observation.tick,
        )

    def touches_ticks(self, ticks: frozenset) -> bool:
        return any(r.observation.tick in ticks for r in self.run_results)


@dataclass
class _TrackEntry:
    track: Track
    reconstruction: Reconstruction
    run_cache: Dict[str, List[_RunCache]] = field(default_factory=dict)


@dataclass
class FragmentChange:
    track_id: str
    source: str
    old: Optional[Fragment]
    new: Optional[Fragment]

    @property
    def kind(self) -> str:
        if self.old is None:
            return "created"
        if self.new is None:
            return "removed"
        return "replaced"

    def describe(self) -> str:
        span = lambda f: (
            f"tick{f.anchors[0].tick}-{f.anchors[-1].tick}" if f else "-"
        )
        if self.kind == "replaced":
            return (
                f"轨迹 {self.track_id} 来源 {self.source} 片段 "
                f"{span(self.old)} 被重算替换（内容变化）"
            )
        if self.kind == "created":
            return (
                f"轨迹 {self.track_id} 来源 {self.source} 新片段 "
                f"{span(self.new)}"
            )
        return (
            f"轨迹 {self.track_id} 来源 {self.source} 片段 "
            f"{span(self.old)} 消失（断片结构变化）"
        )


@dataclass
class IncrementalUpdate:
    """一次禁行/解禁变更的增量结果报告。"""

    edge_id: str
    closed: bool
    changes: List[FragmentChange] = field(default_factory=list)
    reused_fragments: List[str] = field(default_factory=list)
    untouched_fragment_ids: List[str] = field(default_factory=list)
    new_unreachable: List[Tuple[str, str, Leg]] = field(default_factory=list)
    recomputed_tracks: List[str] = field(default_factory=list)
    untouched_tracks: List[str] = field(default_factory=list)
    equivalent_to_full_rebuild: Optional[bool] = None

    def describe(self) -> str:
        action = "临时禁行" if self.closed else "解除禁行"
        lines = [
            f"==== 路段 {self.edge_id} {action}后的增量更新报告 ====",
            f"  重算轨迹：{self.recomputed_tracks or '无'}",
            f"  完全未触及轨迹（Reconstruction 对象原样保留）："
            f"{self.untouched_tracks or '无'}",
            f"  片段变更 {len(self.changes)} 个：",
        ]
        for change in self.changes:
            lines.append(f"    - {change.describe()}")
        lines.append(
            f"  原样复用片段 {len(self.reused_fragments)} 个"
            + (f"（含：{', '.join(self.reused_fragments[:6])}"
               f"{'…' if len(self.reused_fragments) > 6 else ''}）"
               if self.reused_fragments else "")
        )
        if self.new_unreachable:
            lines.append("  新出现的不可达断点：")
            for track_id, source, leg in self.new_unreachable:
                lines.append(
                    f"    - 轨迹 {track_id} 来源 {source} "
                    f"tick {leg.from_tick}->{leg.to_tick}：{leg.reason}"
                )
        eq = {True: "完全一致", False: "不一致（异常！）", None: "未校验"}[
            self.equivalent_to_full_rebuild
        ]
        lines.append(f"  与从头全量重算的逐片段比对：{eq}")
        return "\n".join(lines)


class ReconstructionStore:
    """持有路网、匹配器与全部已还原轨迹，支持禁行增量更新。"""

    def __init__(
        self,
        network,
        matcher: Optional[Matcher] = None,
        reconstructor: Optional[TrackReconstructor] = None,
        *,
        verify_equivalence: bool = True,
    ):
        self.network = network
        self.matcher = matcher or Matcher(network)
        self.reconstructor = reconstructor or TrackReconstructor(self.matcher)
        # 与重建器共享同一个 builder，保证增量与全量走完全相同的算法
        self.builder: PathBuilder = self.reconstructor.builder
        self.verify_equivalence = verify_equivalence
        self._entries: Dict[str, _TrackEntry] = {}

    # ------------------------------------------------------------------ #
    # 登记并全量还原
    # ------------------------------------------------------------------ #
    def register(self, track: Track) -> Reconstruction:
        reconstruction = self.reconstructor.reconstruct(track)
        self._entries[track.track_id] = _TrackEntry(
            track=track,
            reconstruction=reconstruction,
            run_cache=self._build_run_cache(reconstruction),
        )
        return reconstruction

    def get(self, track_id: str) -> Reconstruction:
        return self._entries[track_id].reconstruction

    def track_ids(self) -> List[str]:
        return sorted(self._entries)

    def _build_run_cache(
        self, reconstruction: Reconstruction
    ) -> Dict[str, List[_RunCache]]:
        cache: Dict[str, List[_RunCache]] = {}
        for source, results in reconstruction.match_results.items():
            runs = self.builder._split_runs(
                sorted(results, key=lambda r: r.observation.tick)
            )
            build = reconstruction.source_builds[source]
            caches: List[_RunCache] = []
            for run in sorted(runs, key=lambda r: r[0].observation.tick):
                lo = run[0].observation.tick
                hi = run[-1].observation.tick
                frags = [
                    f for f in build.fragments
                    if f.anchors[0].tick >= lo and f.anchors[-1].tick <= hi
                ]
                broken = [l for l in build.unreachable_legs if lo <= l.from_tick <= hi]
                caches.append(_RunCache(run, frags, broken))
            cache[source] = caches
        return cache

    # ------------------------------------------------------------------ #
    # 禁行 / 解禁
    # ------------------------------------------------------------------ #
    def set_edge_closed(self, edge_id: str, closed: bool) -> IncrementalUpdate:
        self.network.set_closed(edge_id, closed)
        if closed:
            return self._incremental_close(edge_id)
        return self._conservative_reopen(edge_id)

    def close_edge(self, edge_id: str) -> IncrementalUpdate:
        return self.set_edge_closed(edge_id, True)

    def reopen_edge(self, edge_id: str) -> IncrementalUpdate:
        return self.set_edge_closed(edge_id, False)

    # ------------------------------------------------------------------ #
    # 临时禁行：严格片段级增量
    # ------------------------------------------------------------------ #
    def _incremental_close(self, edge_id: str) -> IncrementalUpdate:
        report = IncrementalUpdate(edge_id=edge_id, closed=True)

        # 1) 不做任何重匹配，先从旧结果精确圈定"可能受影响"的来源：
        #    a) 某片段实际使用了 E；或
        #    b) 某采样点的旧最佳候选就在 E 上（DP 可能为它选了别的边，
        #       但禁行后该点的最佳匹配可能改变）。
        #    禁行只会移除候选，其余来源的匹配与路径在数学上不可能改变。
        for track_id, entry in self._entries.items():
            candidate_sources = self._candidate_sources(entry, edge_id)
            if not candidate_sources:
                report.untouched_tracks.append(track_id)
                # 不触发该轨迹的任何重匹配/重拼接
                continue

            # 2) 仅对候选来源做逐点重匹配，找出 dirty ticks
            fresh_matches: Dict[str, List[MatchResult]] = {}
            dirty: Dict[str, frozenset] = {}
            for source in candidate_sources:
                old_results = entry.reconstruction.match_results[source]
                new_results = self.matcher.match_observations(
                    [mr.observation for mr in old_results]
                )
                fresh_matches[source] = new_results
                ticks = {
                    old_mr.observation.tick
                    for old_mr, new_mr in zip(old_results, new_results)
                    if self._best_changed(old_mr, new_mr)
                }
                if ticks:
                    dirty[source] = frozenset(ticks)

            # 3) 用"片段使用 E 或触碰 dirty tick"做 run 级判定，重算受影响 run
            affected = self._affected_sources(entry, edge_id, dirty)
            if not affected:
                report.untouched_tracks.append(track_id)
                continue
            report.recomputed_tracks.append(track_id)
            self._recompute_track(
                entry, edge_id, affected, dirty, fresh_matches, report
            )
            entry.reconstruction.conflicts = self.reconstructor._detect_conflicts(
                entry.track, entry.reconstruction.match_results
            )

        # 4) 等价性校验：受影响轨迹在当前路网上从头全量重算必须相同
        if self.verify_equivalence:
            report.equivalent_to_full_rebuild = self._verify_equivalence(
                report.recomputed_tracks
            )
        return report

    def _candidate_sources(self, entry: _TrackEntry, edge_id: str) -> set:
        """可能因 edge_id 禁行而改变结果的来源（精确预筛）。

        命中条件（满足任一）：
        a) 某片段实际使用了 E —— 路径必然失效，需要重拼接；
        b) 某采样点旧最佳候选在 E 上 —— 最佳匹配可能改变；
        c) 某采样点到 E 的垂直距离不超过匹配阈值 —— E 虽可能不是
           最佳，但它原本出现在候选列表中，禁行后候选列表会变化。
        a/b 是路径变化的精确判据；c 保证连候选明细都与全量重算一致。
        """
        edge = self.network.get_edge(edge_id)
        a_pt = self.network.get_node(edge.from_node).point
        b_pt = self.network.get_node(edge.to_node).point
        threshold = self.matcher.config.max_distance
        sources = set()
        for source, caches in entry.run_cache.items():
            uses_edge = any(
                edge_id in frag.used_edges
                for rc in caches for frag in rc.fragments
            )
            near_edge = any(
                mr.best is not None and (
                    mr.best.edge_id == edge_id
                    or Geometry.project_on_segment(
                        mr.observation.point, a_pt, b_pt
                    )[1] <= threshold + 1e-9
                )
                for mr in entry.reconstruction.match_results[source]
            )
            if uses_edge or near_edge:
                sources.add(source)
        return sources

    @staticmethod
    def _best_changed(old_mr: MatchResult, new_mr: MatchResult) -> bool:
        ob, nb = old_mr.best, new_mr.best
        if (ob is None) != (nb is None):
            return True
        if ob is not None and (
            ob.edge_id != nb.edge_id or ob.traversal is not nb.traversal
        ):
            return True
        return False

    @staticmethod
    def _affected_sources(
        entry: _TrackEntry,
        edge_id: str,
        dirty_ticks: Dict[str, frozenset],
    ) -> set:
        affected = set()
        for source, caches in entry.run_cache.items():
            uses_edge = any(
                edge_id in frag.used_edges
                for rc in caches for frag in rc.fragments
            )
            if uses_edge or source in dirty_ticks:
                affected.add(source)
        return affected

    def _recompute_track(
        self,
        entry: _TrackEntry,
        edge_id: str,
        affected_sources: set,
        dirty_ticks: Dict[str, frozenset],
        fresh_matches: Dict[str, List[MatchResult]],
        report: IncrementalUpdate,
    ) -> None:
        new_cache: Dict[str, List[_RunCache]] = {}

        for source, caches in entry.run_cache.items():
            if source not in affected_sources:
                # 路径不受影响。若该来源因"候选临近被禁边"而做过重匹配，
                # 仅刷新逐点匹配结果（候选明细），片段对象一律原样保留。
                if source in fresh_matches:
                    entry.reconstruction.match_results[source] = fresh_matches[source]
                new_cache[source] = caches
                for rc in caches:
                    report.reused_fragments.extend(
                        f.content_id() for f in rc.fragments
                    )
                    report.untouched_fragment_ids.extend(
                        f.content_id() for f in rc.fragments
                    )
                continue

            ticks = dirty_ticks.get(source, frozenset())
            new_results = fresh_matches[source]
            new_caches: List[_RunCache] = []
            all_fragments: List[Fragment] = []
            all_broken: List[Leg] = []
            # 该来源全部旧片段（按内容 ID），用于受影响 run 内部的对象复用
            old_by_id = {
                f.content_id(): f
                for rc in caches for f in rc.fragments
            }

            for rc in caches:
                run_uses_edge = any(edge_id in f.used_edges for f in rc.fragments)
                if not run_uses_edge and not rc.touches_ticks(ticks):
                    # 该 run 不受影响：片段对象原样复用（is 相同）
                    new_caches.append(rc)
                    all_fragments.extend(rc.fragments)
                    all_broken.extend(rc.broken)
                    report.reused_fragments.extend(
                        f.content_id() for f in rc.fragments
                    )
                    report.untouched_fragment_ids.extend(
                        f.content_id() for f in rc.fragments
                    )
                    continue

                # 受影响 run：禁行使 run 可能按新的未匹配点分裂。
                # 在当前路网上只构建一次，diff 与落盘共用同一结果。
                lo, hi = rc.tick_span
                scoped = [
                    mr for mr in new_results if lo <= mr.observation.tick <= hi
                ]
                sub_pieces = []
                run_frags: List[Fragment] = []
                run_broken: List[Leg] = []
                for sub_run in self.builder._split_runs(scoped):
                    frags, broken = self.builder._build_run(source, sub_run)
                    sub_pieces.append((sub_run, frags, broken))
                    run_frags.extend(frags)
                    run_broken.extend(broken)

                # 受影响 run 内部内容未变的片段（不经过被禁边的部分），
                # 复用旧 Python 对象——"未受影响片段不得改变"。
                for idx, frag in enumerate(run_frags):
                    old_frag = old_by_id.get(frag.content_id())
                    if old_frag is not None and old_frag.canonical() == frag.canonical():
                        run_frags[idx] = old_frag
                        report.reused_fragments.append(old_frag.content_id())
                        report.untouched_fragment_ids.append(old_frag.content_id())

                # 以复用后的片段对象建立缓存（按 sub 切回）
                offset = 0
                for sub_run, frags, broken in sub_pieces:
                    n = len(frags)
                    new_caches.append(
                        _RunCache(sub_run, run_frags[offset:offset + n], broken)
                    )
                    offset += n

                self._diff_run(entry.track.track_id, source, rc,
                               run_frags, run_broken, report)
                all_fragments.extend(run_frags)
                all_broken.extend(run_broken)

            new_cache[source] = new_caches
            entry.reconstruction.match_results[source] = new_results
            entry.reconstruction.source_builds[source] = self._assemble_build(
                source, new_results, all_fragments, all_broken
            )

        entry.run_cache = new_cache

    def _diff_run(
        self,
        track_id: str,
        source: str,
        old_rc: _RunCache,
        new_frags: List[Fragment],
        new_broken: List[Leg],
        report: IncrementalUpdate,
    ) -> None:
        old_by_span = {f.tick_span: f for f in old_rc.fragments}
        new_by_span = {f.tick_span: f for f in new_frags}
        for span in sorted(set(old_by_span) | set(new_by_span)):
            of, nf = old_by_span.get(span), new_by_span.get(span)
            if of is not None and nf is not None:
                if of.content_id() != nf.content_id():
                    report.changes.append(FragmentChange(track_id, source, of, nf))
            elif nf is not None:
                report.changes.append(FragmentChange(track_id, source, None, nf))
            else:
                report.changes.append(FragmentChange(track_id, source, of, None))

        old_broken_keys = {(l.from_tick, l.to_tick) for l in old_rc.broken}
        for leg in new_broken:
            if (leg.from_tick, leg.to_tick) not in old_broken_keys:
                report.new_unreachable.append((track_id, source, leg))

    def _assemble_build(
        self,
        source: str,
        new_results: List[MatchResult],
        fragments: List[Fragment],
        broken: List[Leg],
    ) -> SourceBuild:
        """按与 PathBuilder.build 完全相同的规则组装 SourceBuild。"""
        diagnostics: List[PathBuildDiagnostic] = []
        for leg in broken:
            diagnostics.append(PathBuildDiagnostic(
                from_tick=leg.from_tick,
                to_tick=leg.to_tick,
                kind=LEG_UNREACHABLE,
                message=(
                    f"来源 {source} 在 tick={leg.from_tick} 与 "
                    f"tick={leg.to_tick} 之间不可达：{leg.reason}；"
                    f"轨迹在此断开为两个片段"
                ),
            ))
        for frag in fragments:
            diagnostics.extend(self.builder._fragment_diagnostics(source, frag))
        for mr in new_results:
            if mr.status is MatchStatus.UNMATCHED:
                diagnostics.append(PathBuildDiagnostic(
                    from_tick=mr.observation.tick,
                    to_tick=mr.observation.tick,
                    kind=LEG_UNREACHABLE,
                    message=(
                        f"来源 {source} tick={mr.observation.tick} 的采样点"
                        f"未匹配（{mr.unmatched.describe()}），不参与任何片段"
                    ),
                ))
        diagnostics.sort(key=lambda d: (d.from_tick, d.to_tick, d.kind))
        return SourceBuild(
            source=source,
            fragments=fragments,
            unmatched=[r for r in new_results if r.status is MatchStatus.UNMATCHED],
            unreachable_legs=broken,
            diagnostics=diagnostics,
        )

    # ------------------------------------------------------------------ #
    # 解除禁行：整轨迹重算，但内容不变的片段/轨迹原样复用
    # ------------------------------------------------------------------ #
    def _conservative_reopen(self, edge_id: str) -> IncrementalUpdate:
        """解禁不具备禁行的单调性，无法局部精确判定影响面，因此：

        * 每条轨迹在当前路网上完整重算；
        * 重算后内容（``content_id``）与旧结果完全一致的片段，复用旧
          Python 对象——未受影响片段在内容与对象上都不改变；
        * 整条轨迹无任何变化时，连 :class:`Reconstruction` 都原样保留。
        """
        report = IncrementalUpdate(edge_id=edge_id, closed=False)

        for track_id, entry in list(self._entries.items()):
            fresh = self.reconstructor.reconstruct(entry.track)
            changed = self._diff_reconstruction(
                track_id, entry.reconstruction, fresh, report
            )
            if not changed:
                # 整条轨迹不受解禁影响：对象原样保留
                report.untouched_tracks.append(track_id)
                continue

            report.recomputed_tracks.append(track_id)
            # 以"内容 ID 相同则复用旧对象"的方式落盘，保持片段身份稳定
            reused = self._reuse_identical_fragments(
                entry.reconstruction, fresh
            )
            entry.reconstruction = fresh
            entry.run_cache = self._build_run_cache(fresh)
            report.reused_fragments.extend(reused)

        if self.verify_equivalence:
            report.equivalent_to_full_rebuild = self._verify_equivalence(
                report.recomputed_tracks
            )
        return report

    @staticmethod
    def _diff_reconstruction(
        track_id: str,
        old: Reconstruction,
        new: Reconstruction,
        report: IncrementalUpdate,
    ) -> bool:
        """内容层面比较两次还原；有任何差异返回 True，并登记片段变化。"""
        changed = False
        for source in sorted(set(old.source_builds) | set(new.source_builds)):
            old_build = old.source_builds.get(source)
            new_build = new.source_builds.get(source)
            old_frags = old_build.fragments if old_build else []
            new_frags = new_build.fragments if new_build else []
            old_by_span = {f.tick_span: f for f in old_frags}
            new_by_span = {f.tick_span: f for f in new_frags}
            for span in sorted(set(old_by_span) | set(new_by_span)):
                of, nf = old_by_span.get(span), new_by_span.get(span)
                if of is not None and nf is not None:
                    if of.content_id() != nf.content_id():
                        changed = True
                        report.changes.append(
                            FragmentChange(track_id, source, of, nf)
                        )
                elif nf is not None:
                    changed = True
                    report.changes.append(FragmentChange(track_id, source, None, nf))
                else:
                    changed = True
                    report.changes.append(FragmentChange(track_id, source, of, None))
            old_broken = {
                (l.from_tick, l.to_tick)
                for l in (old_build.unreachable_legs if old_build else [])
            }
            for leg in (new_build.unreachable_legs if new_build else []):
                if (leg.from_tick, leg.to_tick) not in old_broken:
                    changed = True
                    report.new_unreachable.append((track_id, source, leg))
        return changed

    @staticmethod
    def _reuse_identical_fragments(
        old: Reconstruction, new: Reconstruction
    ) -> List[str]:
        """把 new 中与 old 内容相同的片段替换为旧对象，返回复用的 ID。"""
        reused: List[str] = []
        old_by_id = {
            f.content_id(): f
            for build in old.source_builds.values()
            for f in build.fragments
        }
        for build in new.source_builds.values():
            for index, frag in enumerate(build.fragments):
                old_frag = old_by_id.get(frag.content_id())
                if old_frag is not None and old_frag.canonical() == frag.canonical():
                    build.fragments[index] = old_frag
                    reused.append(frag.content_id())
        return reused

    # ------------------------------------------------------------------ #
    # 等价性校验
    # ------------------------------------------------------------------ #
    def _verify_equivalence(self, track_ids: List[str]) -> bool:
        for track_id in track_ids:
            entry = self._entries[track_id]
            fresh = self.reconstructor.reconstruct(entry.track)
            current = entry.reconstruction

            if sorted(current.source_builds) != sorted(fresh.source_builds):
                return False
            for source in fresh.source_builds:
                cur_sig = sorted(
                    (f.tick_span, f.canonical())
                    for f in current.source_builds[source].fragments
                )
                new_sig = sorted(
                    (f.tick_span, f.canonical())
                    for f in fresh.source_builds[source].fragments
                )
                if cur_sig != new_sig:
                    return False
                cur_broken = sorted(
                    (l.from_tick, l.to_tick, l.kind, l.reason)
                    for l in current.source_builds[source].unreachable_legs
                )
                new_broken = sorted(
                    (l.from_tick, l.to_tick, l.kind, l.reason)
                    for l in fresh.source_builds[source].unreachable_legs
                )
                if cur_broken != new_broken:
                    return False
                # 未匹配点集合也必须一致
                cur_un = sorted(
                    mr.observation.tick
                    for mr in current.source_builds[source].unmatched
                )
                new_un = sorted(
                    mr.observation.tick
                    for mr in fresh.source_builds[source].unmatched
                )
                if cur_un != new_un:
                    return False

            if not self._conflicts_equal(current.conflicts, fresh.conflicts):
                return False
        return True

    @staticmethod
    def _conflicts_equal(
        a: List[MultiSourceConflict], b: List[MultiSourceConflict]
    ) -> bool:
        def sig(c: MultiSourceConflict):
            return (
                c.tick,
                tuple(sorted((c.source_a, c.source_b))),
                c.kind,
                c.best_a.edge_id if c.best_a else None,
                c.best_b.edge_id if c.best_b else None,
            )

        return sorted(map(sig, a)) == sorted(map(sig, b))
