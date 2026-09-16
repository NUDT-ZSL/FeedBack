"""需求 3：确定的放置位置与朝向，与到达顺序无关。"""

import copy
import random
import unittest

from loading import Cargo, LoadingSystem, Vehicle


def _snapshot(system):
    return sorted(
        (
            p.cargo_id,
            p.vehicle_id,
            round(p.x, 9),
            round(p.y, 9),
            round(p.z, 9),
            tuple(p.orientation),
            p.level,
        )
        for p in system.all_placements()
    )


def _build(pool, order, vehicles):
    s = LoadingSystem()
    for v in vehicles:
        s.add_vehicle(copy.deepcopy(v))
    for idx in order:
        s.add_cargo(copy.deepcopy(pool[idx]))
    s.plan_all()
    return s


class DeterminismTest(unittest.TestCase):
    def setUp(self):
        random.seed(20260916)
        self.pool = [
            Cargo(
                f"C{i:02d}",
                random.choice([1, 2, 3]),
                random.choice([1, 2, 3]),
                random.choice([1, 2, 3]),
                weight=random.randint(1, 50),
                stack_limit=random.choice([0, 1, 2]),
                fragile=random.random() < 0.1,
            )
            for i in range(30)
        ]
        self.vehicles = [
            Vehicle("VA", 8, 8, 6, max_weight=100000),
            Vehicle("VB", 6, 6, 5, max_weight=100000),
            Vehicle("VC", 4, 5, 4, max_weight=100000),
        ]

    def test_same_plan_regardless_of_arrival_order(self):
        orders = [list(range(30))]
        rng = random.Random(99)
        for _ in range(20):
            o = list(range(30))
            rng.shuffle(o)
            orders.append(o)
        snapshots = {tuple(_snapshot(_build(self.pool, o, self.vehicles)))
                     for o in orders}
        self.assertEqual(len(snapshots), 1)

    def test_repeated_full_plans_identical(self):
        s = _build(self.pool, list(range(30)), self.vehicles)
        first = _snapshot(s)
        s.plan_all()
        s.plan_all()
        self.assertEqual(_snapshot(s), first)

    def test_placement_coordinates_and_orientation_determined(self):
        # 单件：确定贴原点、恒等朝向
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 5, 5, 5, 100))
        s.add_cargo(Cargo("A", 2, 1, 1, weight=10))
        s.plan_all()
        p = s.locate_cargo("A")
        self.assertEqual((p["x"], p["y"], p["z"]), (0, 0, 0))
        self.assertEqual(p["orientation"], (0, 1, 2))

    def test_orientation_actually_rotates_dims(self):
        # 1x2x4 的货物无法以恒等朝向放入高 2 的车厢，必须旋转
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 5, 5, 2, 100))
        s.add_cargo(Cargo("R", 1, 2, 4, weight=10))
        s.plan_all()
        p = s.locate_cargo("R")
        self.assertEqual((p["x"], p["y"], p["z"]), (0, 0, 0))
        # 旋转后高度（dz）必须 <= 车厢高 2，且朝向是合法排列
        self.assertIn(tuple(p["orientation"]), {(0, 1, 2), (0, 2, 1),
                                                (1, 0, 2), (1, 2, 0),
                                                (2, 0, 1), (2, 1, 0)})
        from loading.models import oriented_dims

        dims = oriented_dims((1, 2, 4), p["orientation"])
        self.assertEqual(dims[2], 2)


if __name__ == "__main__":
    unittest.main()
