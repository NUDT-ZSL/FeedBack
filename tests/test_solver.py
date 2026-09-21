"""solver.compute_plan 的核心行为验证。运行：python -m pytest tests 或 python tests/test_solver.py"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from solver import compute_plan  # noqa: E402


def loc(i, on_hand, in_transit, safety, demand):
    return {"id": i, "name": f"L{i}", "on_hand": on_hand,
            "in_transit": in_transit, "safety_stock": safety, "demand": demand}


class TestComputePlan(unittest.TestCase):
    def test_gap_and_supply_split(self):
        plan = compute_plan(
            [loc(1, 100, 0, 50, 200), loc(2, 500, 0, 100, 100)],
            [[0, 100], [100, 0]],
        )
        self.assertEqual(plan["locations"][0]["gap"], 150)
        self.assertEqual(plan["locations"][1]["supply"], 300)
        self.assertTrue(plan["total"]["balanced"])
        self.assertEqual(len(plan["transfers"]), 1)
        self.assertEqual(plan["transfers"][0]["qty"], 150)

    def test_cheapest_lane_wins(self):
        # 需求方 L1；L2 近但 L3 远，近距离线路单位代价必须更低
        plan = compute_plan(
            [loc(1, 0, 0, 0, 100), loc(2, 100, 0, 0, 0), loc(3, 100, 0, 0, 0)],
            [[0, 100, 900], [100, 0, 500], [900, 500, 0]],
        )
        self.assertEqual(len(plan["transfers"]), 1)
        self.assertEqual(plan["transfers"][0]["from"], "L2")

    def test_priority_by_gap_ratio_when_short(self):
        # 总供给 100 < 总缺口 200；L2 缺口率 100%，L3 缺口率 50%，L2 应优先满足
        plan = compute_plan(
            [loc(1, 100, 0, 0, 0), loc(2, 0, 0, 0, 100), loc(3, 100, 0, 0, 200)],
            [[0, 100, 100], [100, 0, 500], [100, 500, 0]],
        )
        self.assertFalse(plan["total"]["balanced"])
        self.assertEqual(plan["total"]["total_unmet"], 100)
        l2, l3 = plan["locations"][1], plan["locations"][2]
        self.assertEqual(l2["unmet"], 0)
        self.assertEqual(l3["unmet"], 100)
        text = "\n".join(plan["explanations"])
        self.assertIn("缺口率", text)
        self.assertIn("L3", text)

    def test_in_transit_counts(self):
        plan = compute_plan(
            [loc(1, 0, 200, 50, 100)], [[0]],
        )
        self.assertEqual(plan["locations"][0]["status"], "surplus")
        self.assertEqual(plan["total"]["total_gap"], 0)

    def test_safety_stock_not_exported(self):
        # L2 仅有安全库存，不应调出
        plan = compute_plan(
            [loc(1, 0, 0, 0, 100), loc(2, 50, 0, 50, 0)],
            [[0, 100], [100, 0]],
        )
        self.assertEqual(plan["transfers"], [])
        self.assertEqual(plan["total"]["total_unmet"], 100)

    def test_time_weight_changes_choice(self):
        # 提高时效权重后，近距离线路优势扩大
        locs = [loc(1, 0, 0, 0, 100), loc(2, 100, 0, 0, 0), loc(3, 100, 0, 0, 0)]
        dist = [[0, 100, 800], [100, 0, 500], [800, 500, 0]]
        cheap = compute_plan(locs, dist, {"time_weight": 0})
        heavy = compute_plan(locs, dist, {"time_weight": 10000})
        self.assertEqual(cheap["transfers"][0]["from"], "L2")
        self.assertEqual(heavy["transfers"][0]["from"], "L2")
        self.assertGreater(heavy["total"]["time_cost"], cheap["total"]["time_cost"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
