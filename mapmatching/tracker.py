"""mapmatching.tracker —— 多来源轨迹总装与冲突留存（需求 6）。

同一目标的同一逻辑时刻可能被多个来源上报。处理原则：

* **各方独立还原、结果全部保留**：每个来源各自完成“采样 -> 候选匹配
  -> 合法路径”，:class:`Reconstruction` 同时持有各方的
  :class:`~mapmatching.pathfinding.SourceBuild` 与其逐点匹配结果，
  绝不择一丢弃。
* **矛盾显式记录**：逐对来源、逐共同时刻比对各自的匹配结论——
  - 双方都匹配但路段（或行驶朝向）不同 → ``match_disagree``；
  - 一方匹配、另一方因偏离过远未匹配 → ``match_vs_unmatched``；
  - 双方都未匹配视为一致（都表示“不知道”），不记冲突；
  - 匹配到同一路段同一朝向视为互相印证，不记冲突。
* 冲突记录 :class:`MultiSourceConflict` 是人可读的，明确指出逻辑时刻、
  两个来源、两个采样点坐标以及各自的匹配结果。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .matching import Candidate, Matcher, MatchResult, MatchStatus, UnmatchedSample
from .pathfinding import Fragment, PathBuilder, SourceBuild
from .samples import Observation, Track

CONFLICT_MATCH_DISAGREE = "match_disagree"
CONFLICT_MATCH_VS_UNMATCHED = "match_vs_unmatched"


@dataclass(frozen=True)
class MultiSourceConflict:
    """两个来源在同一逻辑时刻的矛盾记录（只读、可追溯）。"""

    track_id: str
    tick: int
    source_a: str
    source_b: str
    observation_a: Observation
    observation_b: Observation
    kind: str
    best_a: Optional[Candidate] = None
    best_b: Optional[Candidate] = None
    unmatched_a: Optional[UnmatchedSample] = None
    unmatched_b: Optional[UnmatchedSample] = None

    def describe(self) -> str:
        head = (
            f"[冲突] 轨迹 {self.track_id} 在逻辑时刻 tick={self.tick}："
            f"来源 {self.source_a} 与来源 {self.source_b} 上报矛盾"
        )
        p_a = self.observation_a.point
        p_b = self.observation_b.point
        if self.kind == CONFLICT_MATCH_VS_UNMATCHED:
            kind_line = "  矛盾类型：一方匹配到路网，另一方偏离路网过远被标记未匹配。"
        else:
            kind_line = "  矛盾类型：双方匹配到不同路段（或行驶朝向相反）。"
        lines = [
            head,
            kind_line,
            f"  · 来源 {self.source_a}（序号 {self.observation_a.seq}）："
            f"坐标 ({p_a.x:.2f}, {p_a.y:.2f}) — "
            f"{self._side(self.best_a, self.unmatched_a)}",
            f"  · 来源 {self.source_b}（序号 {self.observation_b.seq}）："
            f"坐标 ({p_b.x:.2f}, {p_b.y:.2f}) — "
            f"{self._side(self.best_b, self.unmatched_b)}",
            "  双方结论均已保留，未做静默择一；需人工或上游裁决。",
        ]
        return "\n".join(lines)

    @staticmethod
    def _side(best: Optional[Candidate], unmatched: Optional[UnmatchedSample]) -> str:
        if best is not None:
            return best.basis()
        if unmatched is not None:
            return f"未匹配（{unmatched.describe()}）"
        return "无结论"


@dataclass
class Reconstruction:
    """一条轨迹（可含多来源）的完整还原结果。"""

    track_id: str
    source_builds: Dict[str, SourceBuild] = field(default_factory=dict)
    match_results: Dict[str, List[MatchResult]] = field(default_factory=dict)
    conflicts: List[MultiSourceConflict] = field(default_factory=list)

    @property
    def fragments(self) -> List[Fragment]:
        result: List[Fragment] = []
        for source in sorted(self.source_builds):
            result.extend(self.source_builds[source].fragments)
        return result

    def fragment_by_id(self, fragment_id: str) -> Optional[Fragment]:
        for build in self.source_builds.values():
            for frag in build.fragments:
                if frag.fragment_id == fragment_id:
                    return frag
        return None

    def used_edges(self) -> List[str]:
        edges = set()
        for build in self.source_builds.values():
            for frag in build.fragments:
                edges.update(frag.used_edges)
        return sorted(edges)

    def all_diagnostics(self):
        result = []
        for source in sorted(self.source_builds):
            result.extend(self.source_builds[source].diagnostics)
        return sorted(result, key=lambda d: (d.from_tick, d.to_tick, d.kind))


class TrackReconstructor:
    """把登记好的 :class:`Track` 还原为 :class:`Reconstruction`。"""

    def __init__(self, matcher: Matcher, builder: Optional[PathBuilder] = None):
        self.matcher = matcher
        self.builder = builder or PathBuilder(matcher.network)

    def reconstruct(self, track: Track) -> Reconstruction:
        result = Reconstruction(track_id=track.track_id)

        # 每个来源只做一次匹配，结果同时供路径拼接与冲突检测使用
        for source in track.sources():
            observations = track.by_source(source)
            match_results = self.matcher.match_observations(observations)
            result.match_results[source] = match_results
            result.source_builds[source] = self.builder.build(source, match_results)

        result.conflicts = self._detect_conflicts(track, result.match_results)
        return result

    # ------------------------------------------------------------------ #
    def _detect_conflicts(
        self,
        track: Track,
        match_results: Dict[str, List[MatchResult]],
    ) -> List[MultiSourceConflict]:
        # tick -> source -> (MatchResult, Observation)
        table: Dict[int, Dict[str, tuple]] = {}
        for source, results in match_results.items():
            for mr in results:
                table.setdefault(mr.observation.tick, {})[source] = (
                    mr, mr.observation
                )

        sources = sorted(match_results.keys())
        conflicts: List[MultiSourceConflict] = []
        for tick in sorted(table):
            present = table[tick]
            for i in range(len(sources)):
                for j in range(i + 1, len(sources)):
                    sa, sb = sources[i], sources[j]
                    if sa not in present or sb not in present:
                        continue
                    mr_a, obs_a = present[sa]
                    mr_b, obs_b = present[sb]
                    conflict = self._compare(
                        track.track_id, tick, sa, sb,
                        mr_a, mr_b, obs_a, obs_b,
                    )
                    if conflict is not None:
                        conflicts.append(conflict)
        return conflicts

    @staticmethod
    def _compare(
        track_id, tick, sa, sb, mr_a, mr_b, obs_a, obs_b
    ) -> Optional[MultiSourceConflict]:
        a_ok = mr_a.status is MatchStatus.MATCHED
        b_ok = mr_b.status is MatchStatus.MATCHED

        if a_ok and b_ok:
            ba, bb = mr_a.best, mr_b.best
            if ba.edge_id != bb.edge_id or ba.traversal is not bb.traversal:
                return MultiSourceConflict(
                    track_id=track_id, tick=tick,
                    source_a=sa, source_b=sb,
                    observation_a=obs_a, observation_b=obs_b,
                    kind=CONFLICT_MATCH_DISAGREE,
                    best_a=ba, best_b=bb,
                )
            return None
        if a_ok != b_ok:
            return MultiSourceConflict(
                track_id=track_id, tick=tick,
                source_a=sa, source_b=sb,
                observation_a=obs_a, observation_b=obs_b,
                kind=CONFLICT_MATCH_VS_UNMATCHED,
                best_a=mr_a.best if a_ok else None,
                best_b=mr_b.best if b_ok else None,
                unmatched_a=None if a_ok else mr_a.unmatched,
                unmatched_b=None if b_ok else mr_b.unmatched,
            )
        # 双方都未匹配：结论一致（都无结论），不记冲突
        return None
