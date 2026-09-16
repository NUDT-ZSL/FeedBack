"""需求 4：连续匹配点串成合法路径——首尾相接、单行/禁行拒绝与断点定位。"""

import unittest

from mapmatching import (
    Matcher,
    MatchConfig,
    Observation,
    PathBuilder,
    Point,
    Track,
    TrackReconstructor,
    Traversal,
)
from mapmatching.scenarios import build_world, point_on


def make_track(points, source="gps", start_seq=1):
    track = Track("v1")
    for i, (tick, p) in enumerate(points):
        track.add(tick, p, source, start_seq + i)
    return track


class TestPathAssembly(unittest.TestCase):
    def setUp(self):
        self.net = build_world()
        self.matcher = Matcher(self.net, MatchConfig(max_distance=20.0))
        self.reconstructor = TrackReconstructor(self.matcher)

    def test_consecutive_edges_join_end_to_end(self):
        track = make_track([
            (1, point_on("b0", 0.5)),
            (2, point_on("b1", 0.5)),
            (3, point_on("b2", 0.5)),
        ])
        recon = self.reconstructor.reconstruct(track)
        self.assertEqual(len(recon.fragments), 1)
        frag = recon.fragments[0]
        edge_seq = [e for e, _ in frag.steps]
        self.assertEqual(edge_seq, ["b0", "b1", "b2"])
        # 交付的每条路径都必须通过路网的强制合法性校验
        self.net.validate_route(frag.steps)

    def test_turn_through_intersection_is_valid(self):
        track = make_track([
            (1, point_on("b0", 0.8)),
            (2, point_on("c1", 0.5)),
            (3, point_on("t1", 0.5)),
        ])
        frag = self.reconstructor.reconstruct(track).fragments[0]
        edge_seq = [e for e, _ in frag.steps]
        self.assertEqual(edge_seq, ["b0", "c1", "t1"])
        self.net.validate_route(frag.steps)

    def test_never_emits_wrong_way_step(self):
        # 采样点物理上落在单行 b0 上，系统只能产出顺行候选，
        # 无论如何拼接都不能出现 b0 逆行。
        track = make_track([
            (1, point_on("b0", 0.9)),
            (2, point_on("b0", 0.1)),   # 同边纵向倒退（跳点）
        ])
        recon = self.reconstructor.reconstruct(track)
        for frag in recon.fragments:
            for edge_id, trav in frag.steps:
                if edge_id == "b0":
                    self.assertIs(trav, Traversal.FORWARD)

    def test_closed_edge_breaks_path_with_located_breakpoint(self):
        # 底廊 b1 被禁行：沿底廊无法从 n10 到 n20，
        # 采样证据只在底廊时，该衔接必须被标记为不可达并给出断点。
        self.net.set_closed("b1", True)
        track = make_track([
            (1, point_on("b0", 0.9)),
            (2, point_on("b1", 0.5)),   # b1 此刻不会产生候选 -> 未匹配
            (3, point_on("b2", 0.2)),
        ])
        recon = self.reconstructor.reconstruct(track)
        build = recon.source_builds["gps"]
        # 中间点未匹配
        self.assertEqual([mr.observation.tick for mr in build.unmatched], [2])
        # 轨迹被未匹配点切成两个片段，且都合法
        tick_spans = sorted(f.tick_span for f in build.fragments)
        self.assertEqual(tick_spans, [(1, 1), (3, 3)])
        # 诊断必须指出断点位置（tick 2）
        messages = "\n".join(d.message for d in build.diagnostics)
        self.assertIn("tick=2", messages)
        self.assertIn("未匹配", messages)

    def test_forced_disconnect_marked_unreachable(self):
        # 封掉 n10 的全部对外出路（b1、c1 禁行；b0 是单行只能进 n10），
        # 使 n10 成为有向图上的"汇"：b0 末端的采样与 b2 始端的采样之间
        # 不存在任何合法补路，必须明确标记不可达并指出断点节点。
        self.net.set_closed("b1", True)
        self.net.set_closed("c1", True)
        track = Track("v1")
        track.add(1, point_on("b0", 0.95), "gps", 1)
        track.add(2, point_on("b2", 0.1), "gps", 2)
        results = self.matcher.match_observations(track.by_source("gps"))
        build = PathBuilder(self.net).build("gps", results)
        self.assertTrue(build.unreachable_legs)
        leg = build.unreachable_legs[0]
        self.assertEqual(leg.from_tick, 1)
        self.assertEqual(leg.to_tick, 2)
        self.assertEqual(leg.kind, "unreachable")
        self.assertIn("n10", leg.reason)  # 指出从哪个节点出发不可达
        # 两个锚点各自成片段，系统不产出任何非法衔接
        self.assertEqual(len(build.fragments), 2)
        for frag in build.fragments:
            self.net.validate_route(frag.steps)


if __name__ == "__main__":
    unittest.main()
