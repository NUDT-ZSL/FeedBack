"""需求 1：货物维护与非法配置拒绝（指出位置）。"""

import unittest

from loading import Cargo, ValidationError


class CargoValidationTest(unittest.TestCase):
    def test_valid_cargo(self):
        c = Cargo("C1", 1, 2, 3, weight=4.5, stack_limit=2, fragile=False)
        self.assertEqual(c.dims, (1, 2, 3))
        self.assertAlmostEqual(c.volume, 6)

    def test_unique_id_is_string(self):
        with self.assertRaises(ValidationError) as cm:
            Cargo("", 1, 1, 1, weight=1)
        self.assertIn(".id", cm.exception.location)
        with self.assertRaises(ValidationError):
            Cargo(None, 1, 1, 1, weight=1)

    def test_dimensions_must_be_positive(self):
        bad_values = [0, -1, -0.001]
        for bad in bad_values:
            with self.assertRaises(ValidationError) as cm:
                Cargo("C", bad, 1, 1, weight=1)
            self.assertIn(".length", cm.exception.location)
            with self.assertRaises(ValidationError) as cm:
                Cargo("C", 1, bad, 1, weight=1)
            self.assertIn(".width", cm.exception.location)
            with self.assertRaises(ValidationError) as cm:
                Cargo("C", 1, 1, bad, weight=1)
            self.assertIn(".height", cm.exception.location)

    def test_weight_must_be_positive(self):
        with self.assertRaises(ValidationError) as cm:
            Cargo("C", 1, 1, 1, weight=0)
        self.assertIn(".weight", cm.exception.location)

    def test_non_numbers_rejected_with_location(self):
        cases = [
            (dict(length="1"), ".length"),
            (dict(width=None), ".width"),
            (dict(height=[1]), ".height"),
            (dict(weight="重"), ".weight"),
        ]
        for overrides, location_suffix in cases:
            kwargs = dict(length=1, width=1, height=1, weight=1)
            kwargs.update(overrides)
            with self.assertRaises(ValidationError) as cm:
                Cargo("C", **kwargs)
            self.assertTrue(
                cm.exception.location.endswith(location_suffix),
                cm.exception.location,
            )

    def test_nan_and_infinity_rejected(self):
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValidationError):
                Cargo("C", bad, 1, 1, weight=1)

    def test_stack_limit_non_negative_integer(self):
        Cargo("C", 1, 1, 1, weight=1, stack_limit=0)
        with self.assertRaises(ValidationError) as cm:
            Cargo("C", 1, 1, 1, weight=1, stack_limit=-1)
        self.assertIn(".stack_limit", cm.exception.location)
        with self.assertRaises(ValidationError):
            Cargo("C", 1, 1, 1, weight=1, stack_limit=1.5)

    def test_fragile_forces_zero_stack_limit(self):
        c = Cargo("C", 1, 1, 1, weight=1, stack_limit=5, fragile=True)
        self.assertTrue(c.fragile)
        self.assertEqual(c.stack_limit, 0)

    def test_fragile_must_be_bool(self):
        with self.assertRaises(ValidationError):
            Cargo("C", 1, 1, 1, weight=1, fragile="yes")

    def test_duplicate_id_rejected_by_system(self):
        from loading import LoadingSystem

        s = LoadingSystem()
        s.add_cargo(Cargo("DUP", 1, 1, 1, weight=1))
        with self.assertRaises(Exception):
            s.add_cargo(Cargo("DUP", 2, 2, 2, weight=1))


if __name__ == "__main__":
    unittest.main()
