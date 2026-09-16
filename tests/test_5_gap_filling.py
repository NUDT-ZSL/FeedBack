"""需求 5：采样跳变与缺失时的路网补路（方向合法 / 不可达标记）。"""

import unittest

from mapmatching import (
    Matcher,
    MatchConfig,
    Point,
    Track,
    TrackReconstructor,
    Traversal,
)
from mapmatching.scenarios import build_world, point_on


class TestGapFilling(unittest.TestCase):
    def setUp(self):
        self.net = build_world()
        self.matcher = Matcher(self.net, MatchConfig(max_distance=20.0))
        self.reconstructor = TrackReconstructor(self.matcher)

    def test_missing_samples_are_filled_with_valid_route(self):
        # tick 1 在 b0，tick 4 才在 b2，中间 tick 2/3 丢点。
        # 补路必须沿 b1 合法接上，并记录缺失采样数。
        track = Track("v1")
        track.add(1, point_on("b0", 0.5), "gps", 1)
        track.add(4, point_on("b2", 0.5), "gps", 2)
        frag = self.reconstructor.reconstruct(track).fragments[0]

        edge_seq = [e for e, _ in frag.steps]
        self.assertEqual(edge_seq, ["b0", "b1", "b2"])
        # 交付路径必须通过路网合法性自检
        self.net.validate_route(frag.steps)

        filled = [l for l in frag.legs if l.kind == "filled"]
        self.assertTrue(filled)
        leg = filled[0]
        self.assertEqual(leg.missing_samples, 2)
        self.assertIn("b1", [e for e, _ in leg.fill_steps])

    def test_jump_is_filled_via_top_corridor_respecting_oneway(self):
        # 采样从 b0 直接跳到 b2，且 b1 被临时禁行。
        # 底廊不通，必须经 c1 上顶廊 t1、再经 c2 逆行下来接 b2：
        #   b0 -> c1(顺) -> t1(顺) -> c2(逆) -> b2
        self.net.set_closed("b1", True)
        track = Track("v1")
        track.add(1, point_on("b0", 0.9), "gps", 1)
        track.add(2, point_on("b2", 0.1), "gps", 2)
        frag = self.reconstructor.reconstruct(track).fragments[0]
        edge_seq = [e for e, _ in frag.steps]
        self.assertEqual(edge_seq, ["b0", "c1", "t1", "c2", "b2"])
        # c2 必须是逆行（双行允许），底廊单行 b1 绝不能出现
        self.assertNotIn("b1", edge_seq)
        traversal = dict(frag.steps)
        self.assertIs(traversal["c2"], Traversal.REVERSE)
        self.net.validate_route(frag.steps)

        # 补路诊断中应标注跨距/补路路段
        build = self.reconstructor.reconstruct(track).source_builds["gps"]
        fill_msgs = [d.message for d in build.diagnostics if d.kind == "filled"]
        self.assertTrue(fill_msgs)
        self.assertIn("c1", fill_msgs[0])

    def test_long_fill_flagged_as_jump_suspect(self):
        # 从底廊东端跳到顶廊西端附近：补路须经 c3 上顶廊再沿 t2/t1
        # 逆行约 300m，远超跳变阈值，应标注 jump_suspected。
        track = Track("v1")
        track.add(1, point_on("b2", 0.95), "gps", 1)
        track.add(2, point_on("t0", 0.95), "gps", 2)
        build = self.reconstructor.reconstruct(track).source_builds["gps"]
        filled = [l for f in build.fragments for l in f.legs
                  if l.kind == "filled"]
        self.assertTrue(filled)
        self.assertTrue(any(l.jump_suspected for l in filled))
        fill_edges = {e for l in filled for e, _ in l.fill_steps}
        self.assertIn("c3", fill_edges)
        # 补出的路径自身合法
        for frag in build.fragments:
            self.net.validate_route(frag.steps)

    def test_unreachable_when_no_directed_path_exists(self):
        # 切断 n10 向外的全部出路（b1、c1 禁行，b0 是单行只能进不能出），
        # b0 上的点与 b2 上的点之间无法补路 -> 不可达，断成两个片段。
        self.net.set_closed("b1", True)
        self.net.set_closed("c1", True)
        track = Track("v1")
        track.add(1, point_on("b0", 0.95), "gps", 1)
        track.add(2, point_on("b2", 0.1), "gps", 2)
        build = self.reconstructor.reconstruct(track).source_builds["gps"]
        self.assertTrue(build.unreachable_legs)
        leg = build.unreachable_legs[0]
        self.assertEqual(leg.kind, "unreachable")
        self.assertIn("不存在合法通路", leg.reason)
        # 两个锚点各成片段，系统不产出任何非法衔接
        self.assertEqual(len(build.fragments), 2)

    def test_same_edge_backward_jump_does_not_reverse_oneway(self):
        # 同一条单行边上采样倒退（跳点）：不能直接逆行。
        # 使用独立的"死胡同"路网 A->B->C（单行，无回环），
        # 从 C 附近跳回 A 附近时回不来 -> 不可达断片，且不得出现逆行。
        from mapmatching import RoadNetwork
        dead_net = RoadNetwork()
        for nid, xy in [("A", (1000, 1000)), ("B", (1100, 1000)),
                        ("C", (1200, 1000))]:
            dead_net.add_node(nid, Point(*xy))
        dead_net.add_edge("z1", "A", "B")
        dead_net.add_edge("z2", "B", "C")

        track = Track("dead")
        track.add(1, Point(1190, 1005), "gps", 1)
        track.add(2, Point(1010, 1005), "gps", 2)
        matcher = Matcher(dead_net, MatchConfig(max_distance=20.0))
        from mapmatching import PathBuilder
        build = PathBuilder(dead_net).build(
            "gps", matcher.match_observations(track.by_source("gps"))
        )
        # 要么断开，要么绕路；无论哪种，路径中 z1/z2 都不得逆行
        for frag in build.fragments:
            for edge_id, trav in frag.steps:
                if edge_id in ("z1", "z2"):
                    self.assertIs(trav, Traversal.FORWARD)
        self.assertTrue(build.unreachable_legs)


if __name__ == "__main__":
    unittest.main()
