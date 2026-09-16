"""需求 3：采样点匹配到候选路段——代价、依据与未匹配标记。"""

import unittest

from mapmatching import (
    Matcher,
    MatchConfig,
    MatchStatus,
    Observation,
    Point,
    Traversal,
)
from mapmatching.scenarios import build_world, point_on


class TestMatching(unittest.TestCase):
    def setUp(self):
        self.net = build_world()
        self.matcher = Matcher(self.net, MatchConfig(max_distance=20.0))

    def test_point_on_edge_matches_with_low_cost(self):
        obs = Observation(tick=1, point=point_on("b1", 0.5, dy=3),
                          source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        self.assertEqual(result.status, MatchStatus.MATCHED)
        best = result.best
        self.assertEqual(best.edge_id, "b1")
        self.assertEqual(best.traversal, Traversal.FORWARD)
        self.assertAlmostEqual(best.distance, 3.0, places=6)
        self.assertLessEqual(best.cost, 3.0 + 1e-9)
        # 依据可读
        self.assertIn("b1", best.basis())
        self.assertIn("垂直偏离", best.basis())

    def test_candidates_sorted_by_cost(self):
        # n11 路口附近：t0/t1/c1/b 边的端点区都会产生候选
        obs = Observation(tick=1, point=Point(100, 100), source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        costs = [c.cost for c in result.candidates]
        self.assertEqual(costs, sorted(costs))
        self.assertGreaterEqual(len(result.candidates), 2)

    def test_twoway_edge_offers_both_traversals(self):
        obs = Observation(tick=1, point=point_on("t1", 0.3, dy=2),
                          source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        self.assertEqual(result.status, MatchStatus.MATCHED)
        dirs = {c.traversal for c in result.candidates
                if c.edge_id == "t1"}
        self.assertEqual(dirs, {Traversal.FORWARD, Traversal.REVERSE})

    def test_oneway_edge_offers_only_forward(self):
        obs = Observation(tick=1, point=point_on("b0", 0.5),
                          source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        self.assertTrue(all(
            c.edge_id != "b0" or c.traversal is Traversal.FORWARD
            for c in result.candidates
        ))

    def test_too_far_point_is_unmatched_not_snapped(self):
        # 最近的边也在 200m 开外（路网集中在 y=0/100 的 x=0..300 带内）
        obs = Observation(tick=1, point=Point(500, 500), source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        self.assertEqual(result.status, MatchStatus.UNMATCHED)
        self.assertIsNone(result.best)
        self.assertEqual(result.candidates, [])
        self.assertIsNotNone(result.unmatched)
        # 未匹配必须给出证据：最近路段与距离、阈值
        self.assertGreater(result.unmatched.nearest_distance, 20.0)
        self.assertIn("不强行贴合", result.unmatched.describe())
        self.assertIn("未匹配", result.explain())

    def test_closed_edge_produces_no_candidate_but_kept_as_evidence(self):
        self.net.set_closed("b1", True)
        obs = Observation(tick=1, point=point_on("b1", 0.5),
                          source="gps", seq=1)
        result = self.matcher.match_sample(obs)
        # b1 是该处最近的边，但禁行不应产生候选
        self.assertEqual(result.unmatched.nearest_edge_id, "b1")
        self.assertFalse(any(c.edge_id == "b1" for c in result.candidates))

    def test_offset_advances_along_direction(self):
        near_start = self.matcher.match_sample(
            Observation(1, point_on("b2", 0.1), "gps", 1)).best
        near_end = self.matcher.match_sample(
            Observation(2, point_on("b2", 0.9), "gps", 2)).best
        self.assertLess(near_start.offset, near_end.offset)


if __name__ == "__main__":
    unittest.main()
