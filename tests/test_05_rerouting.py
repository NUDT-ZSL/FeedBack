"""需求 5：剩余空间/载重不足时跨车厢改派，不超限、不重复装载。"""

import unittest

from loading import Cargo, LoadingSystem, PlacementError, Vehicle
from loading.geometry import Box

from tests._helpers import assert_plan_valid


class ReroutingTest(unittest.TestCase):
    def test_overflow_goes_to_next_vehicle(self):
        s = LoadingSystem()
        # 车厢高 2，2x2x2 箱子只能放一层：V1 沿 x 放 2 件，V2 放 3 件
        s.add_vehicle(Vehicle("V1", 4, 2, 2, max_weight=10000))
        s.add_vehicle(Vehicle("V2", 6, 2, 2, max_weight=10000))
        for i in range(5):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10))
        s.plan_all()
        v1 = s.plan.placements["V1"]
        v2 = s.plan.placements["V2"]
        self.assertEqual(len(v1), 2)
        self.assertEqual(len(v2), 3)
        assert_plan_valid(self, s)

    def test_blocked_zone_causes_reroute(self):
        s = LoadingSystem()
        s.add_vehicle(
            Vehicle("V1", 10, 2, 2, 10000, blocked=(Box(8, 0, 0, 2, 2, 2),))
        )
        s.add_vehicle(Vehicle("V2", 10, 2, 2, max_weight=10000))
        # V1 可用长度 8：4 件；第 5 件必须改派 V2
        for i in range(5):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10))
        s.plan_all()
        self.assertEqual(len(s.plan.placements["V1"]), 4)
        self.assertEqual(len(s.plan.placements["V2"]), 1)
        self.assertEqual(s.plan.placements["V2"][0].x, 0)

    def test_weight_limit_causes_reroute(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 100, 100, 100, max_weight=50))
        s.add_vehicle(Vehicle("V2", 100, 100, 100, max_weight=50))
        s.add_cargo(Cargo("A", 1, 1, 1, weight=40))
        s.add_cargo(Cargo("B", 1, 1, 1, weight=40))
        s.plan_all()
        self.assertEqual(s.locate_cargo("A")["vehicle_id"], "V1")
        self.assertEqual(s.locate_cargo("B")["vehicle_id"], "V2")

    def test_no_cargo_loaded_twice(self):
        s = LoadingSystem()
        for vid, cap in [("V1", 6), ("V2", 6), ("V3", 6)]:
            s.add_vehicle(Vehicle(vid, cap, 2, 2, max_weight=10000))
        for i in range(7):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10))
        s.plan_all()
        all_ids = [p.cargo_id for p in s.all_placements()]
        self.assertEqual(sorted(all_ids), sorted(set(all_ids)))
        self.assertEqual(len(all_ids), 7)

    def test_unplaceable_when_all_vehicles_full(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 2, 2, 2, max_weight=10000))
        s.add_cargo(Cargo("A", 2, 2, 2, weight=10))
        s.add_cargo(Cargo("B", 2, 2, 2, weight=10))
        with self.assertRaises(PlacementError):
            s.plan_all()

    def test_weight_exhausted_everywhere_reports_error(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 100, 100, 100, max_weight=10))
        s.add_vehicle(Vehicle("V2", 100, 100, 100, max_weight=10))
        s.add_cargo(Cargo("A", 1, 1, 1, weight=8))
        s.add_cargo(Cargo("B", 1, 1, 1, weight=8))
        s.add_cargo(Cargo("C", 1, 1, 1, weight=8))
        with self.assertRaises(PlacementError):
            s.plan_all()

    def test_incremental_reroute_after_blocked_zone_added(self):
        # 先排满，再给 V1 增加不可用区域，货物应改派到 V2
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 6, 2, 2, max_weight=10000))
        s.add_vehicle(Vehicle("V2", 6, 2, 2, max_weight=10000))
        for i in range(4):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10))
        s.plan_all()
        self.assertEqual(len(s.plan.placements["V1"]), 3)
        s.update_vehicle(
            Vehicle("V1", 6, 2, 2, 10000, blocked=(Box(4, 0, 0, 2, 2, 2),))
        )
        self.assertEqual(len(s.plan.placements["V1"]), 2)
        self.assertEqual(len(s.plan.placements["V2"]), 2)
        assert_plan_valid(self, s)


if __name__ == "__main__":
    unittest.main()
