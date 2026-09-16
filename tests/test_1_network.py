"""需求 1：路网维护、唯一标识、方向与禁行约束。"""

import unittest

from mapmatching import (
    Direction,
    DuplicateIdError,
    EdgeClosedError,
    NodeNotFoundError,
    PathValidationError,
    Point,
    RoadNetwork,
    Traversal,
    WrongWayError,
)
from mapmatching.scenarios import build_world


class TestRoadNetwork(unittest.TestCase):
    def setUp(self):
        self.net = build_world()

    def test_nodes_and_edges_have_unique_ids(self):
        with self.assertRaises(DuplicateIdError):
            self.net.add_node("n00", Point(999, 999))
        with self.assertRaises(DuplicateIdError):
            self.net.add_edge("b0", "n00", "n10")

    def test_edge_requires_existing_endpoints(self):
        with self.assertRaises(NodeNotFoundError):
            self.net.add_edge("x1", "n00", "n99")

    def test_edge_direction_and_length(self):
        b0 = self.net.get_edge("b0")
        self.assertTrue(b0.oneway)
        self.assertEqual(b0.direction, Direction.ONEWAY)
        self.assertAlmostEqual(b0.length, 100.0)
        t0 = self.net.get_edge("t0")
        self.assertFalse(t0.oneway)
        self.assertEqual(t0.direction, Direction.TWOWAY)

    def test_custom_length_kept(self):
        self.net.add_node("p", Point(0, 0))
        self.net.add_node("q", Point(3, 4))
        edge = self.net.add_edge("pq", "p", "q", length=42.0)
        self.assertEqual(edge.length, 42.0)

    def test_reverse_oneway_is_rejected_with_edge_id(self):
        with self.assertRaises(WrongWayError) as ctx:
            self.net.check_traversal("b0", Traversal.REVERSE)
        # 必须指出是哪条路段
        self.assertEqual(ctx.exception.edge_id, "b0")

    def test_reverse_twoway_allowed(self):
        # 双行路段反向不抛异常
        self.net.check_traversal("t0", Traversal.REVERSE)
        self.net.check_traversal("c1", Traversal.REVERSE)

    def test_closed_edge_rejected_with_edge_id(self):
        self.net.set_closed("b1", True)
        with self.assertRaises(EdgeClosedError) as ctx:
            self.net.check_traversal("b1", Traversal.FORWARD)
        self.assertEqual(ctx.exception.edge_id, "b1")
        # 解除后恢复
        self.net.set_closed("b1", False)
        self.net.check_traversal("b1", Traversal.FORWARD)

    def test_validate_route_detects_disconnect_with_breakpoint(self):
        # b1: n10->n20，紧接 b0: n00->n10，首尾不相接，断点在第 1 段
        with self.assertRaises(PathValidationError) as ctx:
            self.net.validate_route([
                ("b1", Traversal.FORWARD),
                ("b0", Traversal.FORWARD),
            ])
        err = ctx.exception
        self.assertEqual(err.reason, "not_connected")
        self.assertEqual(err.breakpoint_index, 1)
        self.assertEqual(err.from_node, "n20")
        self.assertEqual(err.to_node, "n00")

    def test_validate_route_detects_wrong_way_breakpoint(self):
        with self.assertRaises(PathValidationError) as ctx:
            self.net.validate_route([("c0", Traversal.REVERSE)])
        self.assertEqual(ctx.exception.reason, "wrong_way")
        self.assertEqual(ctx.exception.breakpoint_index, 0)
        self.assertEqual(ctx.exception.edge_id, "c0")

    def test_validate_route_detects_closed_breakpoint(self):
        self.net.set_closed("b1", True)
        with self.assertRaises(PathValidationError) as ctx:
            self.net.validate_route([
                ("b0", Traversal.FORWARD),
                ("b1", Traversal.FORWARD),
            ])
        self.assertEqual(ctx.exception.reason, "closed")
        self.assertEqual(ctx.exception.breakpoint_index, 1)
        self.assertEqual(ctx.exception.edge_id, "b1")

    def test_valid_route_accepted(self):
        # 底廊全程合法
        self.net.validate_route([
            ("b0", Traversal.FORWARD),
            ("b1", Traversal.FORWARD),
            ("b2", Traversal.FORWARD),
        ])
        # 绕行顶廊（含双行边的反向 c2）合法
        self.net.validate_route([
            ("b0", Traversal.FORWARD),
            ("c1", Traversal.FORWARD),
            ("t1", Traversal.FORWARD),
            ("c2", Traversal.REVERSE),
            ("b2", Traversal.FORWARD),
        ])

    def test_describe_route_readable(self):
        text = self.net.describe_route([
            ("c1", Traversal.REVERSE),
            ("t1", Traversal.FORWARD),
        ])
        self.assertIn("c1", text)
        self.assertIn("逆行", text)
        self.assertIn("t1", text)


if __name__ == "__main__":
    unittest.main()
