"""本地数据处理工具画布的节点图内核（最小实现）。

只提供节点、端口、边的基础结构与增删 / 快照能力；自动布局见
layout.LayoutEngine。本模块的公开签名（含 connect / disconnect /
snapshot）在加入布局功能后保持不变。
"""

from __future__ import annotations

import itertools
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass
class Port:
    """节点上的端口。kind 为 'in' 或 'out'。"""

    id: str
    node_id: str
    kind: str

    def __post_init__(self):
        if self.kind not in ("in", "out"):
            raise ValueError(f"port kind 必须是 'in' 或 'out'，实际为 {self.kind!r}")


@dataclass
class Node:
    """画布节点。

    size 为 (width, height)；position 为左上角 (x, y)，布局引擎会更新它。
    """

    id: str
    position: Tuple[float, float] = (0.0, 0.0)
    size: Tuple[float, float] = (160.0, 80.0)
    inputs: List[Port] = field(default_factory=list)
    outputs: List[Port] = field(default_factory=list)

    def add_port(self, port_id: str, kind: str) -> Port:
        for p in self.inputs + self.outputs:
            if p.id == port_id:
                raise ValueError(f"端口 {port_id!r} 已存在于节点 {self.id!r}")
        port = Port(port_id, self.id, kind)
        (self.inputs if kind == "in" else self.outputs).append(port)
        return port

    @property
    def width(self) -> float:
        return self.size[0]

    @property
    def height(self) -> float:
        return self.size[1]

    @property
    def right(self) -> float:
        return self.position[0] + self.size[0]

    @property
    def bottom(self) -> float:
        return self.position[1] + self.size[1]


@dataclass(frozen=True)
class Edge:
    """一条有向边 source -> target（端口可选）。"""

    id: str
    source: str
    target: str
    source_port: Optional[str] = None
    target_port: Optional[str] = None

    @property
    def is_self_loop(self) -> bool:
        return self.source == self.target


class Graph:
    """节点 + 有向边的容器。"""

    def __init__(self):
        self.nodes: Dict[str, Node] = {}
        self.edges: Dict[str, Edge] = {}
        self._edge_seq = itertools.count(1)

    # -- 节点 / 端口 ------------------------------------------------------

    def add_node(
        self,
        node_id: str,
        position: Tuple[float, float] = (0.0, 0.0),
        size: Tuple[float, float] = (160.0, 80.0),
    ) -> Node:
        if node_id in self.nodes:
            raise ValueError(f"节点 {node_id!r} 已存在")
        node = Node(node_id, tuple(position), tuple(size))
        self.nodes[node_id] = node
        return node

    def remove_node(self, node_id: str) -> None:
        if node_id not in self.nodes:
            raise ValueError(f"节点 {node_id!r} 不存在")
        # 连带删除关联边
        for eid in [
            eid
            for eid, e in self.edges.items()
            if e.source == node_id or e.target == node_id
        ]:
            del self.edges[eid]
        del self.nodes[node_id]

    def get_node(self, node_id: str) -> Node:
        return self.nodes[node_id]

    # -- 边 ---------------------------------------------------------------

    def connect(
        self,
        source: str,
        target: str,
        edge_id: Optional[str] = None,
        source_port: Optional[str] = None,
        target_port: Optional[str] = None,
    ) -> Edge:
        """新增一条 source -> target 的有向边，返回该 Edge。

        端点节点必须存在；edge_id 缺省时自动生成 e1, e2, ...。
        签名与行为在布局功能加入后保持不变。
        """
        if source not in self.nodes:
            raise ValueError(f"源节点 {source!r} 不存在")
        if target not in self.nodes:
            raise ValueError(f"目标节点 {target!r} 不存在")
        if edge_id is None:
            edge_id = f"e{next(self._edge_seq)}"
        if edge_id in self.edges:
            raise ValueError(f"边 {edge_id!r} 已存在")
        edge = Edge(edge_id, source, target, source_port, target_port)
        self.edges[edge_id] = edge
        return edge

    def disconnect(self, edge_id: str) -> Edge:
        """按 id 删除一条边并返回被删除的 Edge；不存在则抛 KeyError。"""
        if edge_id not in self.edges:
            raise KeyError(edge_id)
        edge = self.edges.pop(edge_id)
        return edge

    # -- 查询 -------------------------------------------------------------

    def edges_between(self, source: str, target: str) -> List[Edge]:
        return [
            e for e in self.edges.values() if e.source == source and e.target == target
        ]

    def outgoing(self, node_id: str) -> List[Edge]:
        return [e for e in self.edges.values() if e.source == node_id]

    def incoming(self, node_id: str) -> List[Edge]:
        return [e for e in self.edges.values() if e.target == node_id]

    def successors(self, node_id: str) -> List[str]:
        return sorted({e.target for e in self.outgoing(node_id)})

    def predecessors(self, node_id: str) -> List[str]:
        return sorted({e.source for e in self.incoming(node_id)})

    # -- 快照 -------------------------------------------------------------

    def snapshot(self) -> dict:
        """返回可 JSON 化的深拷贝快照（节点位置 / 尺寸 / 端口 / 边）。

        布局前后可对快照做差异比较；该方法签名与行为保持不变。
        """
        return {
            "nodes": {
                nid: {
                    "id": n.id,
                    "position": list(n.position),
                    "size": list(n.size),
                    "inputs": [p.id for p in n.inputs],
                    "outputs": [p.id for p in n.outputs],
                }
                for nid, n in self.nodes.items()
            },
            "edges": [
                {
                    "id": e.id,
                    "source": e.source,
                    "target": e.target,
                    "source_port": e.source_port,
                    "target_port": e.target_port,
                }
                for e in self.edges.values()
            ],
        }

    def apply_positions(self, positions: Dict[str, Tuple[float, float]]) -> None:
        """把布局结果写回节点 position（布局引擎之外的便利方法）。"""
        for nid, pos in positions.items():
            if nid in self.nodes:
                self.nodes[nid].position = (float(pos[0]), float(pos[1]))
