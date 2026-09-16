"""mapmatching.matching —— 采样点到候选路段的匹配（含代价与依据）。

匹配规则（对应需求 3）
----------------------
* 对每条“当前可通行”的路段计算采样点到线段的垂直距离与垂足：
  - 单行路段只产生顺行候选；
  - 双行路段同时产生顺行 / 逆行两个候选（代价相同，起讫节点相反），
    最终朝向交由路径拼接时的连通与方向约束裁决；
  - 禁行路段不产生候选。
* 代价 ``cost`` 目前以垂直距离为主（米），并保留分项依据
  :attr:`CostBreakdown`，便于追溯“为什么是这个候选”；后续可在不改
  接口的情况下叠加航向、历史先验等分项。
* 距离超过 :attr:`MatchConfig.max_distance` 时，采样点被显式标记为
  ``UNMATCHED``（:class:`UnmatchedSample`），同时记录最近的路段与距离
  作为证据，绝不强行贴合到路网上。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional

from .geometry import Point
from .network import Edge, RoadNetwork, Traversal
from .samples import Observation


class MatchStatus(str, Enum):
    MATCHED = "matched"
    UNMATCHED = "unmatched"


@dataclass(frozen=True)
class CostBreakdown:
    """代价的可追溯分项。单位均为米（代价即米制距离）。"""

    perpendicular_distance: float  # 点到路段中线的垂直距离
    endpoint_clamp: float          # 垂足被夹到端点的距离（0 表示垂足在线段内）

    @property
    def total(self) -> float:
        return self.perpendicular_distance + self.endpoint_clamp

    def describe(self) -> str:
        return (
            f"垂直偏离 {self.perpendicular_distance:.2f}m"
            + (f"，垂足外推夹紧 {self.endpoint_clamp:.2f}m" if self.endpoint_clamp > 1e-9 else "")
        )


@dataclass(frozen=True)
class Candidate:
    """一个候选匹配。"""

    edge_id: str
    traversal: Traversal
    from_node: str
    to_node: str
    projected: Point       # 采样点在路段上的垂足
    offset: float          # 沿“通行方向”从进入端起的纵向位置（米）
    t_forward: float       # 沿路段定义方向 from->to 的比例 [0,1]
    distance: float        # 采样点到路段的垂直距离（米）
    cost: float
    breakdown: CostBreakdown

    def basis(self) -> str:
        """生成该候选的可读匹配依据。"""
        direction = "顺行" if self.traversal is Traversal.FORWARD else "逆行"
        return (
            f"路段 {self.edge_id}（{direction}，{self.from_node}->{self.to_node}），"
            f"{self.breakdown.describe()}，纵向偏移 {self.offset:.2f}m，"
            f"总代价 {self.cost:.2f}m"
        )


@dataclass(frozen=True)
class UnmatchedSample:
    """未匹配采样点的证据。"""

    nearest_edge_id: Optional[str]
    nearest_distance: Optional[float]
    threshold: float
    reason: str = "too_far_from_network"

    def describe(self) -> str:
        if self.nearest_edge_id is None:
            return f"路网为空，无法匹配（阈值 {self.threshold:.1f}m）"
        return (
            f"距最近路段 {self.nearest_edge_id} 仍有 "
            f"{self.nearest_distance:.2f}m，超过匹配阈值 {self.threshold:.1f}m，"
            f"标记为未匹配，不强行贴合"
        )


@dataclass
class MatchResult:
    observation: Observation
    status: MatchStatus
    candidates: List[Candidate] = field(default_factory=list)
    unmatched: Optional[UnmatchedSample] = None

    @property
    def matched(self) -> bool:
        return self.status is MatchStatus.MATCHED

    @property
    def best(self) -> Optional[Candidate]:
        return self.candidates[0] if self.candidates else None

    def explain(self) -> str:
        """可读的匹配结论与依据。"""
        header = (
            f"[tick={self.observation.tick} 来源={self.observation.source}"
            f"#{self.observation.seq}]"
        )
        if self.status is MatchStatus.UNMATCHED:
            return f"{header} 未匹配：{self.unmatched.describe()}"
        lines = [f"{header} 匹配成功，共 {len(self.candidates)} 个候选（按代价升序）："]
        for rank, cand in enumerate(self.candidates, start=1):
            lines.append(f"  {rank}. {cand.basis()}")
        return "\n".join(lines)


@dataclass
class MatchConfig:
    # 采样点偏离路网超过该距离（米）即标记为未匹配
    max_distance: float = 50.0
    # 每个采样点最多保留的候选数
    candidate_limit: int = 8


class Matcher:
    """无状态匹配器（配置持有），线程安全：结果全部通过返回值给出。"""

    def __init__(self, network: RoadNetwork, config: Optional[MatchConfig] = None):
        self.network = network
        self.config = config or MatchConfig()

    def match_sample(self, obs: Observation) -> MatchResult:
        candidates: List[Candidate] = []
        nearest_edge_id: Optional[str] = None
        nearest_distance: Optional[float] = None

        for edge_id, edge in self.network.edges.items():
            cand_or_none, dist = self._candidate_for_edge(obs.point, edge)
            if nearest_distance is None or dist < nearest_distance:
                nearest_distance = dist
                nearest_edge_id = edge_id
            if cand_or_none is not None:
                candidates.extend(cand_or_none)

        candidates.sort(key=lambda c: (c.cost, c.edge_id, c.traversal.value))
        candidates = candidates[: self.config.candidate_limit]

        if candidates:
            return MatchResult(
                observation=obs,
                status=MatchStatus.MATCHED,
                candidates=candidates,
            )

        return MatchResult(
            observation=obs,
            status=MatchStatus.UNMATCHED,
            candidates=[],
            unmatched=UnmatchedSample(
                nearest_edge_id=nearest_edge_id,
                nearest_distance=nearest_distance,
                threshold=self.config.max_distance,
            ),
        )

    def match_observations(self, observations: List[Observation]) -> List[MatchResult]:
        return [self.match_sample(o) for o in observations]

    # ------------------------------------------------------------------ #
    def _candidate_for_edge(self, p: Point, edge: Edge):
        """返回 ``(候选列表, 到该路段的距离)``。

        禁行路段返回 ``(None, 距离)`` —— 距离仍参与“最近路段”证据统计，
        但不会产生候选。
        """
        a = self.network.get_node(edge.from_node).point
        b = self.network.get_node(edge.to_node).point
        dx, dy = b.x - a.x, b.y - a.y
        length_sq = dx * dx + dy * dy
        if length_sq <= 0.0:
            t_raw = 0.0
            projected = a
            distance = p.distance_to(a)
        else:
            t_raw = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length_sq
            t_clamped = max(0.0, min(1.0, t_raw))
            projected = Point(a.x + t_clamped * dx, a.y + t_clamped * dy)
            distance = p.distance_to(projected)

        if edge.closed or distance > self.config.max_distance:
            return None, distance

        edge_len = edge.length if edge.length > 0 else 1e-9
        # 垂足落在端点之外时，沿路段延长线超出的纵向距离（米）
        extension = max(0.0, -t_raw, t_raw - 1.0) * edge_len
        t_clamped = max(0.0, min(1.0, t_raw))
        breakdown = CostBreakdown(
            perpendicular_distance=distance,
            endpoint_clamp=extension,
        )
        cost = breakdown.total

        forward = Candidate(
            edge_id=edge.edge_id,
            traversal=Traversal.FORWARD,
            from_node=edge.from_node,
            to_node=edge.to_node,
            projected=projected,
            offset=t_clamped * edge_len,
            t_forward=t_clamped,
            distance=distance,
            cost=cost,
            breakdown=breakdown,
        )
        if edge.oneway:
            return [forward], distance

        reverse = Candidate(
            edge_id=edge.edge_id,
            traversal=Traversal.REVERSE,
            from_node=edge.to_node,
            to_node=edge.from_node,
            projected=projected,
            offset=(1.0 - t_clamped) * edge_len,
            t_forward=t_clamped,
            distance=distance,
            cost=cost,
            breakdown=breakdown,
        )
        return [forward, reverse], distance
