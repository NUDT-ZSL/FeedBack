"""需求 7：装载明细、剩余空间/载重、利用率、货物定位，结果稳定有序。"""

import unittest

from loading import Cargo, LoadingSystem, Vehicle
from loading.geometry import Box


class QueryTest(unittest.TestCase):
    def setUp(self):
        s = LoadingSystem()
        s.add_vehicle(
            Vehicle("V1", 10, 4, 4, max_weight=1000,
                    blocked=(Box(9, 0, 0, 1, 4, 4),))
        )
        s.add_vehicle(Vehicle("V2", 6, 4, 4, max_weight=500))
        s.add_cargo(Cargo("C1", 2, 2, 2, weight=100, stack_limit=1))
        s.add_cargo(Cargo("C2", 2, 2, 2, weight=50, stack_limit=1))
        s.add_cargo(Cargo("C3", 4, 2, 2, weight=200))
        s.add_cargo(Cargo("C4", 2, 2, 2, weight=600))
        s.plan_all()
        self.s = s

    def test_vehicle_details_weights_and_volumes(self):
        d = self.s.vehicle_details("V1")
        self.assertEqual(d["vehicle_id"], "V1")
        # 不可用区域体积被扣除
        self.assertAlmostEqual(d["interior_volume"], 160)
        self.assertAlmostEqual(d["blocked_volume"], 16)
        self.assertAlmostEqual(d["usable_volume"], 144)
        self.assertGreater(d["used_volume"], 0)
        self.assertAlmostEqual(
            d["remaining_weight"], d["max_weight"] - d["used_weight"]
        )
        self.assertAlmostEqual(
            d["remaining_volume"], d["usable_volume"] - d["used_volume"]
        )
        self.assertAlmostEqual(
            d["space_utilization"], d["used_volume"] / d["usable_volume"]
        )
        self.assertGreaterEqual(d["space_utilization"], 0.0)
        self.assertLessEqual(d["space_utilization"], 1.0 + 1e-9)

    def test_details_sorted_by_level_and_coordinates(self):
        d = self.s.vehicle_details("V1")
        keys = [(it["level"], it["z"], it["x"], it["y"]) for it in d["items"]]
        self.assertEqual(keys, sorted(keys))

    def test_all_vehicle_details_stable_order(self):
        ids = [d["vehicle_id"] for d in self.s.all_vehicle_details()]
        self.assertEqual(ids, ["V1", "V2"])

    def test_locate_cargo(self):
        loc = self.s.locate_cargo("C4")
        self.assertIn(loc["vehicle_id"], ("V1", "V2"))
        self.assertGreaterEqual(loc["x"], 0)
        self.assertEqual(set(loc), {"cargo_id", "vehicle_id", "x", "y", "z",
                                    "level", "orientation"})

    def test_locate_unknown_cargo_raises(self):
        with self.assertRaises(Exception):
            self.s.locate_cargo("NOPE")

    def test_every_cargo_located_once(self):
        located = {cid: self.s.locate_cargo(cid) for cid in sorted(self.s.cargos)}
        positions = [
            (v["vehicle_id"], v["x"], v["y"], v["z"]) for v in located.values()
        ]
        self.assertEqual(len(positions), len(set(positions)))
        for cid, loc in located.items():
            self.assertEqual(loc["cargo_id"], cid)

    def test_listings_stable_order(self):
        self.assertEqual([c.id for c in self.s.list_cargos()],
                         sorted(self.s.cargos))
        self.assertEqual([v.id for v in self.s.list_vehicles()],
                         sorted(self.s.vehicles))


if __name__ == "__main__":
    unittest.main()
