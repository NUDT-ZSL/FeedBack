"""需求 6：同一轨迹多来源上报且互相矛盾时，双方保留并生成可读冲突记录。"""

import unittest

from mapmatching import (
    Matcher,
    MatchConfig,
    Point,
    Track,
    TrackReconstructor,
)
from mapmatching.scenarios import build_world, point_on


class TestMultiSourceConflict(unittest.TestCase):
    def setUp(self):
        self.net = build_world()
        self.matcher = Matcher(self.net, MatchConfig(max_distance=20.0))
        self.reconstructor = TrackReconstructor(self.matcher)

    def test_agreeing_sources_produce_no_conflict(self):
        track = Track("v1")
        track.add(1, point_on("b1", 0.5, dy=2), "gps-a", 1)
        track.add(1, point_on("b1", 0.5, dy=-2), "gps-b", 1)
        track.add(2, point_on("b2", 0.5), "gps-a", 2)
        track.add(2, point_on("b2", 0.5, dy=1), "gps-b", 2)
        recon = self.reconstructor.reconstruct(track)
        self.assertEqual(recon.conflicts, [])
        # 双方结果都保留
        self.assertEqual(set(recon.source_builds), {"gps-a", "gps-b"})
        self.assertTrue(recon.source_builds["gps-a"].fragments)
        self.assertTrue(recon.source_builds["gps-b"].fragments)

    def test_conflicting_edges_kept_both_and_recorded(self):
        track = Track("v1")
        # 同一时刻：来源 A 说车在底廊 b1，来源 B 说车在顶廊 t1
        track.add(5, point_on("b1", 0.5), "gps-a", 1)
        track.add(5, point_on("t1", 0.5), "gps-b", 1)
        recon = self.reconstructor.reconstruct(track)

        self.assertEqual(len(recon.conflicts), 1)
        conflict = recon.conflicts[0]
        self.assertEqual(conflict.tick, 5)
        self.assertEqual({conflict.source_a, conflict.source_b},
                         {"gps-a", "gps-b"})
        self.assertEqual(conflict.kind, "match_disagree")
        # 记录双方各自的匹配结果
        matched_edges = {conflict.best_a.edge_id, conflict.best_b.edge_id}
        self.assertEqual(matched_edges, {"b1", "t1"})

        # 可读记录：时刻、双方来源、双方结果都要点名
        text = conflict.describe()
        self.assertIn("tick=5", text)
        self.assertIn("gps-a", text)
        self.assertIn("gps-b", text)
        self.assertIn("b1", text)
        self.assertIn("t1", text)
        self.assertIn("均已保留", text)

        # 双方路径都必须仍在结果中，不能静默择一
        sources_with_fragment = {
            f.source for f in recon.fragments
        }
        self.assertEqual(sources_with_fragment, {"gps-a", "gps-b"})

    def test_match_vs_unmatched_conflict_recorded(self):
        track = Track("v1")
        track.add(3, point_on("b1", 0.5), "gps-a", 1)
        track.add(3, Point(500, 500), "gps-b", 1)  # 偏离过远
        recon = self.reconstructor.reconstruct(track)
        self.assertEqual(len(recon.conflicts), 1)
        conflict = recon.conflicts[0]
        self.assertEqual(conflict.kind, "match_vs_unmatched")
        self.assertIsNotNone(conflict.best_a)
        self.assertIsNotNone(conflict.unmatched_b)
        text = conflict.describe()
        self.assertIn("未匹配", text)
        # 偏离的一方不产生片段，但它的未匹配证据仍被保留
        self.assertTrue(recon.source_builds["gps-b"].unmatched)

    def test_both_unmatched_is_not_a_conflict(self):
        track = Track("v1")
        track.add(3, Point(500, 500), "gps-a", 1)
        track.add(3, Point(-500, -500), "gps-b", 1)
        recon = self.reconstructor.reconstruct(track)
        self.assertEqual(recon.conflicts, [])
        self.assertEqual(len(recon.source_builds["gps-a"].unmatched), 1)
        self.assertEqual(len(recon.source_builds["gps-b"].unmatched), 1)

    def test_partial_overlap_multiple_conflicts(self):
        # 只在共同时刻比较；不重叠的时刻不产生冲突
        track = Track("v1")
        track.add(1, point_on("b0", 0.5), "gps-a", 1)
        track.add(2, point_on("b1", 0.5), "gps-a", 2)
        track.add(2, point_on("t1", 0.5), "gps-b", 1)
        track.add(3, point_on("t2", 0.5), "gps-b", 2)
        recon = self.reconstructor.reconstruct(track)
        self.assertEqual(len(recon.conflicts), 1)
        self.assertEqual(recon.conflicts[0].tick, 2)


if __name__ == "__main__":
    unittest.main()
