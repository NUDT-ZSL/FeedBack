"""mapmatching.scenarios —— 演示与测试共用的离线构造场景。

场景是一个 2 行 4 列的微型路网（坐标单位：米）：

    n01 ---- t0(双行) ---- n11 ---- t1(双行) ---- n21 ---- t2(双行) ---- n31
     |                      |                      |                      |
    c0(单行向北)          c1(双行)               c2(双行)               c3(双行)
     |                      |                      |                      |
    n00 ---- b0(单行向东) -> n10 ---- b1(单行向东) -> n20 ---- b2(单行向东) -> n30

* 底廊 b0/b1/b2 为单行向东；
* 顶廊 t0/t1/t2 为双行；
* 竖廊 c0 只向北，c1/c2/c3 双行。
因此底廊任意一段被禁行时，车辆可经相邻竖廊绕行顶廊，形成可验证的
补路与增量重算场景。
"""

from __future__ import annotations

from typing import Tuple

from .geometry import Point
from .network import RoadNetwork

NODES = {
    "n00": (0, 0), "n10": (100, 0), "n20": (200, 0), "n30": (300, 0),
    "n01": (0, 100), "n11": (100, 100), "n21": (200, 100), "n31": (300, 100),
}

# (edge_id, from, to, oneway)
EDGES = [
    ("b0", "n00", "n10", True),
    ("b1", "n10", "n20", True),
    ("b2", "n20", "n30", True),
    ("t0", "n01", "n11", False),
    ("t1", "n11", "n21", False),
    ("t2", "n21", "n31", False),
    ("c0", "n00", "n01", True),
    ("c1", "n10", "n11", False),
    ("c2", "n20", "n21", False),
    ("c3", "n30", "n31", False),
]


def build_world() -> RoadNetwork:
    net = RoadNetwork()
    for node_id, (x, y) in NODES.items():
        net.add_node(node_id, Point(x, y))
    for edge_id, frm, to, oneway in EDGES:
        net.add_edge(edge_id, frm, to, oneway=oneway)
    return net


def point_on(edge_id: str, t: float, dy: float = 0.0) -> Point:
    """沿路段定义方向比例 t 处、横向偏移 dy 米的采样坐标。"""
    spec = {e[0]: (e[1], e[2]) for e in EDGES}
    frm, to = spec[edge_id]
    ax, ay = NODES[frm]
    bx, by = NODES[to]
    x = ax + (bx - ax) * t
    y = ay + (by - ay) * t
    # 横向偏移：垂直于路段方向（水平边 -> y 方向；竖直边 -> x 方向）
    if abs(bx - ax) >= abs(by - ay):
        return Point(x, y + dy)
    return Point(x + dy, y)


def edge_endpoints(edge_id: str) -> Tuple[str, str]:
    for eid, frm, to, _ in EDGES:
        if eid == edge_id:
            return frm, to
    raise KeyError(edge_id)
