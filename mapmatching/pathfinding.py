"""mapmatching.pathfinding —— 把连续匹配点串成合法路径，并在缺失处补路。

职责（对应需求 4、5）
--------------------
* 在每个采样点的候选路段集合上做一次维特比式动态规划：发射代价取匹配
  代价，转移代价取路网上的行驶长度，从而选出整体代价最低、且处处
  合法（首尾相接、不逆行、不走禁行路）的候选序列。
* 相邻锚点的衔接分三类：
  - ``continue`` 同一顺向路段的延续（采样点落在同一条路上）；
  - ``direct``   相邻路段首尾直接相接，无需补路；
  - ``filled``   采样跳变或丢点导致锚点不相邻，按 Dijkstra 最短路
    在路网上补出满足方向约束的衔接路段；
  - ``unreachable`` 路网拓扑上不存在合法衔接 → 显式标记该段不可达，
    轨迹在此断成两个片段，绝不制造非法路径。
* 未匹配采样点（偏离过远）天然成为片段边界，并单独留痕。

确定性：所有并列最优都用固定签名（路段:朝向、补路序列）做字典序
裁决，因此同输入必得同输出——这是需求 7“增量与全量结果完全一致”
的基础。
"""

from __future__ import annotations

import hashlib
import heapq
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .matching import Candidate, MatchResult, MatchStatus
from .network import RoadNetwork, RouteStep
from .samples import Observation

# leg.kind 的取值
LEG_CONTINUE = "continue"
LEG_DIRECT = "direct"
LEG_FILLED = "filled"
LEG_UNREACHABLE = "unreachable"


@dataclass(frozen=True)
class PathBuildConfig:
    # 补路行驶长度超过该值（米）时，在诊断中标注“疑似跳变”
    jump_fill_distance: float = 200.0


@dataclass(frozen=True)
class Anchor:
    """一个被选中的匹配锚点。"""

    observation: Observation
    candidate: Candidate

    @property
    def tick(self) -> int:
        return self.observation.tick

    @property
    def step(self) -> RouteStep:
        return self.candidate.edge_id, self.candidate.traversal


@dataclass(frozen=True)
class PathBuildDiagnostic:
    """一个衔接的可读说明（补路依据 / 不可达断点 / 未匹配点）。"""

    from_tick: int
    to_tick: int
    kind: str
    message: str


@dataclass
class Leg:
    """两个相邻锚点之间的衔接结果。"""

    from_tick: int
    to_tick: int
    kind: str                        # continue / direct / filled / unreachable
    travel_length: float = 0.0       # 该衔接实际行驶长度（米，DP 转移代价）
    fill_steps: List[RouteStep] = field(default_factory=list)  # 补出的中间路段
    tick_gap: int = 1
    missing_samples: int = 0         # 两锚点间缺失的采样时刻数（tick_gap-1）
    jump_suspected: bool = False
    reason: str = ""                 # 不可达时的原因说明

    def is_reachable(self) -> bool:
        return self.kind != LEG_UNREACHABLE


@dataclass
class Fragment:
    """一段连续、合法、可追溯的行驶路径。"""

    fragment_id: str
    source: str
    anchors: List[Anchor]
    legs: List[Leg]
    steps: List[RouteStep]
    total_cost: float

    @property
    def tick_span(self) -> Tuple[int, int]:
        return self.anchors[0].tick, self.anchors[-1].tick

    @property
    def used_edges(self) -> List[str]:
        return sorted({edge_id for edge_id, _ in self.steps})

    def canonical(self) -> tuple:
        """与重算结果做严格比对用的规范表示。"""
        return (
            self.source,
            tuple(
                (a.tick, a.observation.source, a.observation.seq,
                 a.candidate.edge_id, a.candidate.traversal.value,
                 round(a.candidate.cost, 9))
                for a in self.anchors
            ),
            tuple(
                (l.from_tick, l.to_tick, l.kind,
                 tuple((e, t.value) for e, t in l.fill_steps),
                 round(l.travel_length, 9), l.missing_samples, l.jump_suspected)
                for l in self.legs
            ),
            tuple((e, t.value) for e, t in self.steps),
            round(self.total_cost, 9),
        )

    def content_id(self) -> str:
        """由片段规范内容派生的短标识：内容相同则 ID 相同。"""
        digest = hashlib.sha1(repr(self.canonical()).encode("utf-8")).hexdigest()[:10]
        span = f"tick{self.anchors[0].tick}-{self.anchors[-1].tick}"
        return f"{self.source}:{span}:{digest}"


@dataclass
class SourceBuild:
    """单个来源的完整还原结果。"""

    source: str
    fragments: List[Fragment]
    unmatched: List[MatchResult]
    unreachable_legs: List[Leg]
    diagnostics: List[PathBuildDiagnostic]


# DP 状态：(累计代价, 路径签名, 上一列候选下标, 衔接 Leg)
_DpState = Tuple[float, tuple, int, Optional[Leg]]


class PathBuilder:
    def __init__(self, network: RoadNetwork, config: Optional[PathBuildConfig] = None):
        self.network = network
        self.config = config or PathBuildConfig()

    # ------------------------------------------------------------------ #
    # 路网上的最短路（Dijkstra，方向与禁行由邻接表保证）
    # ------------------------------------------------------------------ #
    def shortest_path(
        self, start: str, goal: str
    ) -> Optional[Tuple[float, List[RouteStep]]]:
        """返回 ``(长度, 路径步序列)``；不可达返回 None。

        邻接表只包含当前合法的通行方向（单行反向、禁行路均不在其中），
        因此搜出的路径天然满足全部方向约束。同长度路径用固定次序
        （到达节点、路段标识）打破并列，保证结果可复现。
        """
        if start not in self.network.nodes or goal not in self.network.nodes:
            return None
        if start == goal:
            return 0.0, []

        dist: Dict[str, float] = {start: 0.0}
        prev: Dict[str, Tuple[str, RouteStep]] = {}
        visited = set()
        heap: List[Tuple[float, str]] = [(0.0, start)]

        while heap:
            d, u = heapq.heappop(heap)
            if u in visited:
                continue
            if u == goal:
                break
            visited.add(u)
            # 固定的邻接展开次序 -> 同长度下确定性的路径选择
            # item = (step, to_node, length)，step = (edge_id, traversal)
            neighbors = sorted(
                self.network.outgoing(u),
                key=lambda item: (item[2], item[1],
                                  item[0][0], item[0][1].value),
            )
            for step, v, length in neighbors:
                nd = d + length
                if nd + 1e-12 < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = (u, step)
                    heapq.heappush(heap, (nd, v))

        if goal not in dist:
            return None
        steps: List[RouteStep] = []
        node = goal
        while node != start:
            prev_node, step = prev[node]
            steps.append(step)
            node = prev_node
        steps.reverse()
        return dist[goal], steps

    # ------------------------------------------------------------------ #
    # 单个来源的还原
    # ------------------------------------------------------------------ #
    @staticmethod
    def _split_runs(ordered: List[MatchResult]) -> List[List[MatchResult]]:
        """以未匹配点为硬边界，把匹配结果切成若干连续 run。"""
        runs: List[List[MatchResult]] = []
        current: List[MatchResult] = []
        for result in ordered:
            if result.status is MatchStatus.MATCHED:
                current.append(result)
            elif current:
                runs.append(current)
                current = []
        if current:
            runs.append(current)
        return runs

    def build(
        self,
        source: str,
        match_results: List[MatchResult],
    ) -> SourceBuild:
        ordered = sorted(match_results, key=lambda r: r.observation.tick)
        runs = self._split_runs(ordered)

        fragments: List[Fragment] = []
        unreachable_legs: List[Leg] = []
        diagnostics: List[PathBuildDiagnostic] = []

        for run_results in runs:
            run_fragments, broken = self._build_run(source, run_results)
            fragments.extend(run_fragments)
            unreachable_legs.extend(broken)
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
            for frag in run_fragments:
                diagnostics.extend(self._fragment_diagnostics(source, frag))

        for result in ordered:
            if result.status is MatchStatus.UNMATCHED:
                u = result.unmatched
                diagnostics.append(PathBuildDiagnostic(
                    from_tick=result.observation.tick,
                    to_tick=result.observation.tick,
                    kind=LEG_UNREACHABLE,
                    message=(
                        f"来源 {source} tick={result.observation.tick} 的采样点"
                        f"未匹配（{u.describe()}），不参与任何片段"
                    ),
                ))

        diagnostics.sort(key=lambda d: (d.from_tick, d.to_tick, d.kind))
        return SourceBuild(
            source=source,
            fragments=fragments,
            unmatched=[r for r in ordered if r.status is MatchStatus.UNMATCHED],
            unreachable_legs=unreachable_legs,
            diagnostics=diagnostics,
        )

    def _build_run(
        self, source: str, run_results: List[MatchResult]
    ) -> Tuple[List[Fragment], List[Leg]]:
        """对一个连续匹配 run 做全量 DP，返回（片段列表，不可达衔接列表）。"""
        pieces, broken = self._dp_split(run_results)
        fragments: List[Fragment] = []
        for lo, hi, table in pieces:
            anchors, legs, total_cost = self._backtrack(run_results, lo, hi, table)
            steps = self._assemble_steps(anchors, legs)
            fragment = Fragment(
                fragment_id="",
                source=source,
                anchors=anchors,
                legs=legs,
                steps=steps,
                total_cost=total_cost,
            )
            fragment.fragment_id = fragment.content_id()
            fragments.append(fragment)
        return fragments, broken

    def _fragment_diagnostics(
        self, source: str, fragment: Fragment
    ) -> List[PathBuildDiagnostic]:
        return [
            PathBuildDiagnostic(
                from_tick=leg.from_tick,
                to_tick=leg.to_tick,
                kind=LEG_FILLED,
                message=self._fill_message(source, leg),
            )
            for leg in fragment.legs
            if leg.kind == LEG_FILLED
        ]

    # ------------------------------------------------------------------ #
    # 受影响 run 的局部重算（供禁行增量更新使用）
    # ------------------------------------------------------------------ #
    def rebuild_run(
        self,
        source: str,
        run_results: List[MatchResult],
        affected_edges: frozenset,
    ) -> Tuple[List[Fragment], List[Leg], List[PathBuildDiagnostic]]:
        """只重算一个 run 中经过受影响路段的片段。

        流程：
        1. 全量 DP（与 :meth:`_build_run` 同算法、同输入），得到“新真相”
           的全部片段；
        2. 新片段凡不经过任何受影响路段的，其 :meth:`Fragment.content_id`
           必然与旧片段一致——调用方据此原样复用旧对象（未受影响片段
           不改变）；
        3. 经过受影响路段的片段才作为“重算产物”返回。

        额外返回该 run 重算后产生的不可达 leg 与补路诊断。
        """
        fragments, broken = self._build_run(source, run_results)
        changed = [f for f in fragments if affected_edges & set(f.used_edges)]
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
        for frag in changed:
            diagnostics.extend(self._fragment_diagnostics(source, frag))
        return changed, broken, diagnostics

    # ------------------------------------------------------------------ #
    # DP
    # ------------------------------------------------------------------ #
    def _dp_transform(self, cand: Candidate) -> _DpState:
        return (cand.cost, (self._sig(cand),), -1, None)

    def _dp_split(self, run_results: List[MatchResult]):
        """对一段连续匹配结果做 DP；不可达列之间断片。

        返回：
            pieces: 若干 ``(起始列, 结束列, DP 表)``
            broken: 断点处的 unreachable Leg
        """
        columns = [r.candidates for r in run_results]
        pieces: List[Tuple[int, int, List[List[_DpState]]]] = []
        broken: List[Leg] = []

        lo = 0
        table: List[List[_DpState]] = [[self._dp_transform(c) for c in columns[0]]]

        for k in range(1, len(columns)):
            col_states: List[Optional[_DpState]] = []
            for j, cand in enumerate(columns[k]):
                best: Optional[_DpState] = None
                for i, prev in enumerate(table[-1]):
                    leg = self._connect(
                        columns[k - 1][i], cand,
                        run_results[k - 1].observation.tick,
                        run_results[k].observation.tick,
                    )
                    if leg.kind == LEG_UNREACHABLE:
                        continue
                    total = prev[0] + cand.cost + leg.travel_length
                    sig = (
                        prev[1]
                        + tuple(e for e, _ in leg.fill_steps)
                        + (self._sig(cand),)
                    )
                    if best is None or (total, sig) < (best[0], best[1]):
                        best = (total, sig, i, leg)
                col_states.append(best)

            if all(state is None for state in col_states):
                # k-1 的任何候选都无法合法到达 k 的任何候选 → 断片
                pieces.append((lo, k - 1, table))
                leg = self._connect(
                    columns[k - 1][0], columns[k][0],
                    run_results[k - 1].observation.tick,
                    run_results[k].observation.tick,
                    force_unreachable=True,
                )
                broken.append(leg)
                lo = k
                table = [[self._dp_transform(c) for c in columns[k]]]
            else:
                # 不可达的个别候选不可选；可达列正常推进
                table.append([s if s is not None else self._dead_state()
                              for s in col_states])

        pieces.append((lo, len(columns) - 1, table))
        return pieces, broken

    @staticmethod
    def _dead_state() -> _DpState:
        return (float("inf"), (), -1, None)

    def _backtrack(self, run_results, lo, hi, table):
        end_states = table[hi - lo]
        # 跳过断片重启动遗留的死状态
        live = [j for j, s in enumerate(end_states) if s[0] < float("inf")]
        end_j = min(live, key=lambda j: (end_states[j][0], end_states[j][1]))
        total = end_states[end_j][0]

        anchors_rev: List[Anchor] = []
        legs_rev: List[Leg] = []
        j = end_j
        for k in range(hi, lo, -1):
            state = table[k - lo][j]
            _cost, _sig, back_j, leg = state
            anchors_rev.append(Anchor(run_results[k].observation,
                                      run_results[k].candidates[j]))
            legs_rev.append(leg)
            j = back_j
        anchors_rev.append(Anchor(run_results[lo].observation,
                                  run_results[lo].candidates[j]))
        return list(reversed(anchors_rev)), list(reversed(legs_rev)), total

    @staticmethod
    def _sig(cand: Candidate) -> str:
        return f"{cand.edge_id}:{cand.traversal.value}"

    def _assemble_steps(self, anchors: List[Anchor], legs: List[Leg]) -> List[RouteStep]:
        """把锚点边与补路边交织成完整合法路径，并交付路网强制校验。"""
        steps: List[RouteStep] = [anchors[0].step]
        for leg, anchor in zip(legs, anchors[1:]):
            if leg.kind == LEG_CONTINUE:
                # 与上一锚点同一边同朝向，该路段已在路径中
                continue
            steps.extend(leg.fill_steps)
            steps.append(anchor.step)
        # 强制自检：首尾相接 / 单行 / 禁行，任一违例直接抛错（内部防线）
        self.network.validate_route(steps)
        return steps

    # ------------------------------------------------------------------ #
    # 锚点衔接
    # ------------------------------------------------------------------ #
    def _connect(
        self,
        a: Candidate,
        b: Candidate,
        from_tick: int,
        to_tick: int,
        *,
        force_unreachable: bool = False,
    ) -> Leg:
        gap = max(1, to_tick - from_tick)
        missing = gap - 1
        if force_unreachable:
            return self._leg_unreachable(a, b, from_tick, to_tick, missing)

        edge_len = self.network.get_edge(a.edge_id).length

        if a.edge_id == b.edge_id and a.traversal is b.traversal:
            if b.offset + 1e-9 >= a.offset:
                return Leg(
                    from_tick=from_tick, to_tick=to_tick,
                    kind=LEG_CONTINUE,
                    travel_length=b.offset - a.offset,
                    tick_gap=gap, missing_samples=missing,
                )
            # 同一边上纵向倒退（典型跳点）：先开到出口，绕路，再从入口进来
            sp = self.shortest_path(a.to_node, b.from_node)
            if sp is None:
                return self._leg_unreachable(a, b, from_tick, to_tick, missing)
            path_length, path = sp
            travel = (edge_len - a.offset) + path_length + b.offset
            return self._leg_filled(a, b, from_tick, to_tick, gap, missing,
                                    path, travel)

        sp = self.shortest_path(a.to_node, b.from_node)
        if sp is None:
            return self._leg_unreachable(a, b, from_tick, to_tick, missing)
        path_length, path = sp
        travel = (edge_len - a.offset) + path_length + b.offset
        if not path:
            return Leg(
                from_tick=from_tick, to_tick=to_tick,
                kind=LEG_DIRECT,
                travel_length=travel,
                tick_gap=gap, missing_samples=missing,
            )
        return self._leg_filled(a, b, from_tick, to_tick, gap, missing,
                                path, travel)

    def _leg_filled(self, a, b, from_tick, to_tick, gap, missing,
                    path, travel) -> Leg:
        leg = Leg(
            from_tick=from_tick, to_tick=to_tick,
            kind=LEG_FILLED,
            travel_length=travel,
            fill_steps=list(path),
            tick_gap=gap, missing_samples=missing,
            jump_suspected=travel > self.config.jump_fill_distance,
            reason=(
                f"经 {len(path)} 条补出路段由 {a.to_node} 绕行至 "
                f"{b.from_node}，补路长度 {travel:.2f}m"
            ),
        )
        return leg

    def _leg_unreachable(self, a, b, from_tick, to_tick, missing) -> Leg:
        return Leg(
            from_tick=from_tick, to_tick=to_tick,
            kind=LEG_UNREACHABLE,
            tick_gap=max(1, to_tick - from_tick),
            missing_samples=missing,
            reason=(
                f"自路段 {a.edge_id} 的出口节点 {a.to_node} 到路段 "
                f"{b.edge_id} 的进入节点 {b.from_node}，在当前单行/"
                f"禁行约束下不存在合法通路"
            ),
        )

    def _fill_message(self, source: str, leg: Leg) -> str:
        via = "、".join(edge_id for edge_id, _ in leg.fill_steps)
        tag = "，疑似采样跳变" if leg.jump_suspected else ""
        missing_txt = (
            f"，跨越 {leg.missing_samples} 个缺失采样时刻"
            if leg.missing_samples else ""
        )
        return (
            f"来源 {source} 在 tick={leg.from_tick} 与 tick={leg.to_tick} "
            f"之间补路：{via}，补路行驶 {leg.travel_length:.2f}m"
            f"{missing_txt}{tag}"
        )
