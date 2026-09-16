"""需求 7：临时禁行后只重算受影响片段，且与从头重算完全一致。"""

import unittest

from mapmatching import (
    Matcher,
    MatchConfig,
    ReconstructionStore,
    Point,
    Track,
)
from mapmatching.scenarios import build_world, point_on


class TestIncrementalRecompute(unittest.TestCase):
    def setUp(self):
        self.net = build_world()
        self.matcher = Matcher(self.net, MatchConfig(max_distance=20.0))
        self.store = ReconstructionStore(self.net, self.matcher)

        # 车辆 E：底廊走廊，tick1 在 b0，tick4 在 b2（中间丢点，
        # 正常情况下补路走 b1）；tick10 又回到 b0 起点附近——
        # n30 一带无法合法到达单行 b0 的入口 n00，形成第二个片段。
        east = Track("veh-east")
        east.add(1, point_on("b0", 0.5), "gps", 1)
        east.add(4, point_on("b2", 0.5), "gps", 2)
        east.add(10, point_on("b0", 0.05), "gps", 3)
        self.recon_east = self.store.register(east)

        # 车辆 W：只在顶廊 t0/t1/t2 行驶，与 b1 完全无关
        west = Track("veh-west")
        west.add(1, point_on("t0", 0.5), "gps", 1)
        west.add(2, point_on("t1", 0.5), "gps", 2)
        west.add(3, point_on("t2", 0.5), "gps", 3)
        self.recon_west = self.store.register(west)

    def test_initial_state(self):
        east_frags = self.recon_east.source_builds["gps"].fragments
        # 一个含 b1 补路的片段 + 一个 b0 孤岛片段
        self.assertTrue(any("b1" in f.used_edges for f in east_frags))
        b0_frags = [f for f in east_frags if f.used_edges == ["b0"]]
        self.assertEqual(len(b0_frags), 1)
        self.b0_fragment = b0_frags[0]

    def test_close_only_recomputes_affected_fragments(self):
        east_before = list(self.store.get("veh-east").source_builds["gps"].fragments)
        west_before = self.store.get("veh-west")
        b0_island = next(
            f for f in east_before if f.used_edges == ["b0"]
        )

        report = self.store.close_edge("b1")

        # 1) west 与 b1 无关：整个 Reconstruction 对象原样保留
        self.assertIn("veh-west", report.untouched_tracks)
        self.assertIs(self.store.get("veh-west"), west_before)

        # 2) east 被重算
        self.assertIn("veh-east", report.recomputed_tracks)

        # 3) east 中不经过 b1 的 b0 孤岛片段：对象原样保留（is 相同）
        east_after = self.store.get("veh-east").source_builds["gps"]
        self.assertIn(b0_island, east_after.fragments)
        self.assertIn(b0_island.content_id(), report.reused_fragments)

        # 4) 经过 b1 的片段内容确实改变：补路改走 c1-t1-c2
        affected = [f for f in east_after.fragments if "b0" in f.used_edges
                    and f.tick_span[0] == 1]
        self.assertTrue(affected)
        edge_seq = [e for e, _ in affected[0].steps]
        self.assertNotIn("b1", edge_seq)
        self.assertEqual(edge_seq, ["b0", "c1", "t1", "c2", "b2"])
        # 新路径自身合法
        self.net.validate_route(affected[0].steps)

        # 5) 增量结果与从头全量重算完全一致（模块已自动校验）
        self.assertIs(report.equivalent_to_full_rebuild, True)

    def test_close_makes_unreachable_when_no_alternative(self):
        # 同时禁掉绕行所需的 c1/t1/c2 中关键边后，补路应转为不可达
        self.store.close_edge("b1")
        self.store.close_edge("c1")
        report = self.store.close_edge("t1")
        self.assertIs(report.equivalent_to_full_rebuild, True)
        build = self.store.get("veh-east").source_builds["gps"]
        # tick1 与 tick4 之间现在不可达
        spans = sorted(
            (l.from_tick, l.to_tick) for l in build.unreachable_legs
        )
        self.assertIn((1, 4), spans)
        # 任何产出的片段依然合法
        for frag in build.fragments:
            self.net.validate_route(frag.steps)

    def test_reopen_restores_route_and_keeps_equivalence(self):
        self.store.close_edge("b1")
        closed_frag = next(
            f for f in self.store.get("veh-east").source_builds["gps"].fragments
            if f.tick_span[0] == 1 and f.tick_span[1] == 4
        )
        self.assertNotIn("b1", closed_frag.used_edges)

        report = self.store.reopen_edge("b1")
        self.assertIs(report.equivalent_to_full_rebuild, True)

        # west 在解禁流程中也未发生内容变化
        self.assertIn("veh-west", report.untouched_tracks)

        reopened_frag = next(
            f for f in self.store.get("veh-east").source_builds["gps"].fragments
            if f.tick_span[0] == 1 and f.tick_span[1] == 4
        )
        # 补路恢复为最短的 b1
        self.assertEqual(
            [e for e, _ in reopened_frag.steps],
            ["b0", "b1", "b2"],
        )

    def test_full_rebuild_independent_cross_check(self):
        # 不依赖模块自检：用全新 store 在禁行路网上从头登记，结果必须一致
        self.store.close_edge("b1")
        self.store.close_edge("c2")

        net2 = build_world()
        net2.set_closed("b1", True)
        net2.set_closed("c2", True)
        store2 = ReconstructionStore(net2, Matcher(net2, MatchConfig(max_distance=20.0)))

        east = Track("veh-east")
        east.add(1, point_on("b0", 0.5), "gps", 1)
        east.add(4, point_on("b2", 0.5), "gps", 2)
        east.add(10, point_on("b0", 0.05), "gps", 3)
        store2.register(east)

        def signatures(recon):
            return sorted(
                (f.source, f.tick_span, f.canonical())
                for f in recon.fragments
            )

        self.assertEqual(
            signatures(self.store.get("veh-east")),
            signatures(store2.get("veh-east")),
        )


if __name__ == "__main__":
    unittest.main()
