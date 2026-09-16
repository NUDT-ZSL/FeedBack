"""需求 2：车厢维护、不可用区域、重叠/边界拒绝。"""

import unittest

from loading import Cargo, LoadingSystem, Vehicle, ValidationError
from loading.geometry import Box


class VehicleValidationTest(unittest.TestCase):
    def test_valid_vehicle(self):
        v = Vehicle("V1", 10, 4, 3, max_weight=5000)
        self.assertEqual(v.dims, (10, 4, 3))
        self.assertEqual(v.blocked, ())

    def test_id_required(self):
        with self.assertRaises(ValidationError) as cm:
            Vehicle("   ", 10, 4, 3, max_weight=5000)
        self.assertIn(".id", cm.exception.location)

    def test_dimensions_and_weight_positive(self):
        for kwargs, suffix in [
            (dict(length=0), ".length"),
            (dict(width=-2), ".width"),
            (dict(height=0), ".height"),
            (dict(max_weight=-1), ".max_weight"),
        ]:
            params = dict(id="V", length=10, width=4, height=3, max_weight=5000)
            params.update(kwargs)
            with self.assertRaises(ValidationError) as cm:
                Vehicle(**params)
            self.assertTrue(
                cm.exception.location.endswith(suffix), cm.exception.location
            )

    def test_blocked_zone_must_have_positive_size(self):
        with self.assertRaises(ValidationError) as cm:
            Vehicle("V", 10, 4, 3, 5000, blocked=(Box(0, 0, 0, 0, 2, 2),))
        self.assertIn("blocked[0].dx", cm.exception.location)

    def test_blocked_zone_missing_field(self):
        with self.assertRaises(ValidationError) as cm:
            Vehicle.from_dict(
                {
                    "id": "V",
                    "length": 10,
                    "width": 4,
                    "height": 3,
                    "max_weight": 5000,
                    "blocked": [{"x": 0, "y": 0, "z": 0, "dx": 1}],
                }
            )
        self.assertIn("blocked[0]", cm.exception.location)

    def test_blocked_zone_inside_interior(self):
        with self.assertRaises(ValidationError) as cm:
            Vehicle("V", 10, 4, 3, 5000, blocked=(Box(9, 0, 0, 2, 2, 2),))
        self.assertIn("blocked[0]", cm.exception.location)
        with self.assertRaises(ValidationError):
            Vehicle("V", 10, 4, 3, 5000, blocked=(Box(0, 0, -1, 1, 1, 1),))

    def test_blocked_zones_must_not_overlap_each_other(self):
        with self.assertRaises(ValidationError) as cm:
            Vehicle(
                "V",
                10,
                4,
                3,
                5000,
                blocked=(Box(0, 0, 0, 2, 2, 2), Box(1, 1, 0, 2, 2, 2)),
            )
        self.assertIn("互相重叠", str(cm.exception))

    def test_usable_volume_excludes_blocked(self):
        v = Vehicle("V", 10, 4, 3, 5000, blocked=(Box(0, 0, 0, 2, 2, 2),))
        self.assertAlmostEqual(v.usable_volume, 120 - 8)


class PlacementCollisionTest(unittest.TestCase):
    def test_cargo_never_overlaps_blocked_zone(self):
        s = LoadingSystem()
        # 不可用区域占据 x>=8 的整截面，2 单位宽货物只能放在 0..6
        s.add_vehicle(
            Vehicle("V1", 10, 2, 2, 10000, blocked=(Box(8, 0, 0, 2, 2, 2),))
        )
        for i in range(4):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10))
        s.plan_all()
        xs = sorted(p.x for p in s.plan.placements["V1"])
        self.assertEqual(xs, [0, 2, 4, 6])

    def test_cargo_never_overlaps_each_other(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V1", 6, 6, 6, 10000))
        for i in range(6):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10, stack_limit=0))
        s.plan_all()
        boxes = [p.box for p in s.plan.placements["V1"]]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                from loading.geometry import overlap

                self.assertFalse(overlap(boxes[i], boxes[j]))


if __name__ == "__main__":
    unittest.main()
