"""mapmatching.network —— 路网维护：节点、路段、方向与禁行约束。

约束模型
--------
* 每个节点 :class:`Node` 与路段 :class:`Edge` 都有全局唯一标识，重复登记
  同标识会抛 :class:`DuplicateIdError`（幂等更新需显式调用 replace/更新
  接口，见 :class:`RoadNetwork`）。
* 路段有方向：``ONEWAY``（单行，只允许 from -> to）或 ``TWOWAY``（双行）。
* 路段有长度（登记时可显式给米数，缺省取起终点几何距离）和禁行开关。
* 任何“反向走单行 / 走禁行路段”的通行尝试都会抛出带路段标识的异常；
  :meth:`RoadNetwork.validate_route` 在校验整条路径时还会给出断点位置
  （第几段衔接、涉及的节点/路段）。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Dict, Iterable, List, Optional, Tuple

from .errors import MapMatchingError
from .geometry import Geometry, Point


class Direction(str, Enum):
    """路段的物理通行方向属性。"""

    ONEWAY = "oneway"
    TWOWAY = "twoway"


class Traversal(str, Enum):
    """一次具体通行相对路段定义方向（from->to）的朝向。"""

    FORWARD = "forward"
    REVERSE = "reverse"


class DuplicateIdError(MapMatchingError):
    """节点或路段标识重复登记。"""


class NodeNotFoundError(MapMatchingError):
    """引用了未登记的节点。"""


class EdgeNotFoundError(MapMatchingError):
    """引用了未登记的路段。"""


class EdgeClosedError(MapMatchingError):
    """试图通行被禁行的路段。``edge_id`` 指出具体路段。"""

    def __init__(self, edge_id: str, detail: str = ""):
        self.edge_id = edge_id
        super().__init__(
            f"路段 {edge_id} 当前禁行，禁止通行" + (f"（{detail}）" if detail else "")
        )


class WrongWayError(MapMatchingError):
    """试图反向通行单行路段。``edge_id`` 指出具体路段。"""

    def __init__(self, edge_id: str, detail: str = ""):
        self.edge_id = edge_id
        super().__init__(
            f"单行路段 {edge_id} 不允许反向通行" + (f"（{detail}）" if detail else "")
        )


class PathValidationError(MapMatchingError):
    """路径不合法。

    属性：
        breakpoint_index: 出问题的衔接位置。0 表示第一段本身不可通行；
            k>=1 表示“第 k-1 段 -> 第 k 段”的衔接非法。
        edge_id: 涉及的路段标识（首段不可通行或衔接约束违例时给出）。
        reason: 机器可读原因，``not_connected`` / ``closed`` / ``wrong_way``
            / ``unknown_edge``。
    """

    def __init__(
        self,
        message: str,
        breakpoint_index: int,
        edge_id: Optional[str] = None,
        reason: str = "not_connected",
        from_node: Optional[str] = None,
        to_node: Optional[str] = None,
    ):
        self.breakpoint_index = breakpoint_index
        self.edge_id = edge_id
        self.reason = reason
        self.from_node = from_node
        self.to_node = to_node
        super().__init__(message)


@dataclass(frozen=True)
class Node:
    node_id: str
    point: Point


@dataclass(frozen=True)
class Edge:
    """一条有向定义的路段。

    ``oneway=True`` 表示只允许 ``from_node -> to_node``；``closed=True``
    表示双向均禁行（临时管制可通过 :meth:`RoadNetwork.set_closed` 切换）。
    """

    edge_id: str
    from_node: str
    to_node: str
    length: float
    oneway: bool = True
    closed: bool = False

    @property
    def direction(self) -> Direction:
        return Direction.ONEWAY if self.oneway else Direction.TWOWAY


# 路径中的“一步”：路段标识 + 通行朝向
RouteStep = Tuple[str, Traversal]


class RoadNetwork:
    def __init__(self) -> None:
        self._nodes: Dict[str, Node] = {}
        self._edges: Dict[str, Edge] = {}
        # 邻接表：node -> list of (edge_id, traversal, to_node, length)
        self._adj: Dict[str, List[Tuple[str, Traversal, str, float]]] = {}

    # ------------------------------------------------------------------ #
    # 维护
    # ------------------------------------------------------------------ #
    def add_node(self, node_id: str, point: Point, *, replace: bool = False) -> Node:
        if node_id in self._nodes and not replace:
            raise DuplicateIdError(f"节点标识重复：{node_id}")
        node = Node(node_id=node_id, point=point)
        self._nodes[node_id] = node
        self._adj.setdefault(node_id, [])
        return node

    def add_edge(
        self,
        edge_id: str,
        from_node: str,
        to_node: str,
        *,
        length: Optional[float] = None,
        oneway: bool = True,
        closed: bool = False,
        replace: bool = False,
    ) -> Edge:
        if edge_id in self._edges and not replace:
            raise DuplicateIdError(f"路段标识重复：{edge_id}")
        if from_node not in self._nodes:
            raise NodeNotFoundError(f"路段 {edge_id} 的起点 {from_node} 未登记")
        if to_node not in self._nodes:
            raise NodeNotFoundError(f"路段 {edge_id} 的终点 {to_node} 未登记")
        if length is None:
            length = Geometry.segment_length(
                self._nodes[from_node].point, self._nodes[to_node].point
            )
        edge = Edge(
            edge_id=edge_id,
            from_node=from_node,
            to_node=to_node,
            length=float(length),
            oneway=oneway,
            closed=closed,
        )
        existed = edge_id in self._edges
        # 邻接表对每条路段只登记一次（顺行，双行再加一条逆行），因此
        # 替换已有路段时需要整体重建，避免残留旧朝向的出边。
        self._edges[edge_id] = edge
        if existed:
            self._rebuild_adjacency()
        else:
            self._append_adjacency(edge)
        return edge

    def set_closed(self, edge_id: str, closed: bool) -> Edge:
        """临时禁行 / 解除禁行。返回切换后的路段（新的不可变对象）。

        邻接关系不删除，只切换 ``closed`` 标志——这样路径搜索与校验能在
        “禁行”状态下明确指出是哪条路段挡住了通行。
        """
        old = self.get_edge(edge_id)
        new = Edge(
            edge_id=old.edge_id,
            from_node=old.from_node,
            to_node=old.to_node,
            length=old.length,
            oneway=old.oneway,
            closed=closed,
        )
        self._edges[edge_id] = new
        return new

    def _append_adjacency(self, edge: Edge) -> None:
        self._adj.setdefault(edge.from_node, []).append(
            (edge.edge_id, Traversal.FORWARD, edge.to_node, edge.length)
        )
        if not edge.oneway:
            self._adj.setdefault(edge.to_node, []).append(
                (edge.edge_id, Traversal.REVERSE, edge.from_node, edge.length)
            )

    def _rebuild_adjacency(self) -> None:
        self._adj = {node_id: [] for node_id in self._nodes}
        for edge in self._edges.values():
            self._append_adjacency(edge)

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    @property
    def nodes(self) -> Dict[str, Node]:
        return dict(self._nodes)

    @property
    def edges(self) -> Dict[str, Edge]:
        return dict(self._edges)

    def get_node(self, node_id: str) -> Node:
        try:
            return self._nodes[node_id]
        except KeyError:
            raise NodeNotFoundError(f"节点不存在：{node_id}") from None

    def get_edge(self, edge_id: str) -> Edge:
        try:
            return self._edges[edge_id]
        except KeyError:
            raise EdgeNotFoundError(f"路段不存在：{edge_id}") from None

    def endpoint_of(self, step: RouteStep) -> Tuple[str, str]:
        """返回一步通行的 ``(进入节点, 离开节点)``。"""
        edge_id, traversal = step
        edge = self.get_edge(edge_id)
        if traversal is Traversal.FORWARD:
            return edge.from_node, edge.to_node
        return edge.to_node, edge.from_node

    def edges_between(self, node_a: str, node_b: str) -> List[RouteStep]:
        """返回图上从 node_a 直接到 node_b 的所有合法走法（考虑禁行与单行）。"""
        result: List[RouteStep] = []
        for edge_id, traversal, to_node, _length in self._adj.get(node_a, []):
            edge = self._edges[edge_id]
            if edge.closed:
                continue
            if to_node == node_b:
                result.append((edge_id, traversal))
        return result

    def outgoing(
        self, node_id: str, *, include_closed: bool = False
    ) -> List[Tuple[RouteStep, str, float]]:
        """节点的全部可通行出边：``((edge_id, traversal), to_node, length)``。"""
        result = []
        for edge_id, traversal, to_node, length in self._adj.get(node_id, []):
            edge = self._edges[edge_id]
            if edge.closed and not include_closed:
                continue
            result.append(((edge_id, traversal), to_node, length))
        return result

    # ------------------------------------------------------------------ #
    # 通行约束
    # ------------------------------------------------------------------ #
    def check_traversal(self, edge_id: str, traversal: Traversal) -> None:
        """检查单步通行是否合法，非法时抛出带路段标识的异常。"""
        edge = self.get_edge(edge_id)
        if edge.closed:
            raise EdgeClosedError(
                edge_id,
                f"{edge.from_node}->{edge.to_node}",
            )
        if traversal is Traversal.REVERSE and edge.oneway:
            raise WrongWayError(
                edge_id,
                f"路段定义方向 {edge.from_node}->{edge.to_node}，"
                f"当前请求 {edge.to_node}->{edge.from_node}",
            )

    def validate_route(self, steps: Iterable[RouteStep]) -> None:
        """校验一条完整路径：每步可通行且相邻步首尾相接。

        非法时抛出 :class:`PathValidationError`，其中 ``breakpoint_index``
        即断点位置（0 基），``edge_id`` 指出涉事路段，``reason`` 区分
        禁行 / 逆行 / 不连通。
        """
        steps = list(steps)
        prev_to: Optional[str] = None
        for index, (edge_id, traversal) in enumerate(steps):
            if edge_id not in self._edges:
                raise PathValidationError(
                    f"断点位于第 {index} 段：路段 {edge_id} 不存在",
                    breakpoint_index=index,
                    edge_id=edge_id,
                    reason="unknown_edge",
                )
            from_node, to_node = self.endpoint_of((edge_id, traversal))
            # 衔接：上一段的终点必须等于本段起点
            if prev_to is not None and from_node != prev_to:
                raise PathValidationError(
                    f"断点位于第 {index-1} 段与第 {index} 段之间："
                    f"上段结束于节点 {prev_to}，本段 {edge_id} 却从节点 "
                    f"{from_node} 开始，首尾不相接",
                    breakpoint_index=index,
                    edge_id=edge_id,
                    reason="not_connected",
                    from_node=prev_to,
                    to_node=from_node,
                )
            # 通行约束
            edge = self._edges[edge_id]
            if edge.closed:
                raise PathValidationError(
                    f"断点位于第 {index} 段：路段 {edge_id} 禁行，禁止通行",
                    breakpoint_index=index,
                    edge_id=edge_id,
                    reason="closed",
                )
            if traversal is Traversal.REVERSE and edge.oneway:
                raise PathValidationError(
                    f"断点位于第 {index} 段：单行路段 {edge_id} "
                    f"({edge.from_node}->{edge.to_node}) 被反向通行",
                    breakpoint_index=index,
                    edge_id=edge_id,
                    reason="wrong_way",
                )
            prev_to = to_node

    def route_length(self, steps: Iterable[RouteStep]) -> float:
        return sum(self.get_edge(edge_id).length for edge_id, _ in steps)

    def describe_route(self, steps: Iterable[RouteStep]) -> str:
        """生成可读的路径描述，如 ``n1 -[e1|顺行]-> n2``。"""
        steps = list(steps)
        if not steps:
            return "<空路径>"
        parts: List[str] = []
        first_from, _ = self.endpoint_of(steps[0])
        parts.append(first_from)
        for edge_id, traversal in steps:
            _, to_node = self.endpoint_of((edge_id, traversal))
            arrow = "顺行" if traversal is Traversal.FORWARD else "逆行"
            parts.append(f"-[{edge_id}|{arrow}]->")
            parts.append(to_node)
        return " ".join(parts)
