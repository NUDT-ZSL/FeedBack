"""配置与金额校验测试：非法配置必须被拒绝并指出位置。"""
import unittest

from settlement import CouponSpec, OrderLine, SettlementEngine, ValidationError


class MoneyValidationTests(unittest.TestCase):
    def test_positive_amounts_required(self):
        for bad in (0, -1, "0", "-0.01"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError) as cm:
                    CouponSpec.build("C1", bad, 10)
                self.assertIn("C1", str(cm.exception))
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", 10, 0)

    def test_at_most_two_decimals(self):
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", "10.001", 5)
        # 两位小数可以。
        spec = CouponSpec.build("C1", "10.01", "5.50")
        self.assertEqual((spec.threshold_cents, spec.discount_cents), (1001, 550))

    def test_reject_float_nan_inf_and_bool(self):
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", float("nan"), 5)
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", float("inf"), 5)
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", True, 5)

    def test_error_points_to_field(self):
        with self.assertRaises(ValidationError) as cm:
            CouponSpec.build("C9", 100, -5)
        self.assertIn("C9", cm.exception.path)
        self.assertIn("discount", cm.exception.path)


class CouponValidationTests(unittest.TestCase):
    def test_bad_identifier(self):
        for bad in ("", "   ", "has space", "x" * 65):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    CouponSpec.build(bad, 10, 5)

    def test_bad_category_in_spec(self):
        with self.assertRaises(ValidationError) as cm:
            CouponSpec.build("C1", 10, 5, applicable_categories=["", "food"])
        self.assertIn("applicable_categories", cm.exception.path)

    def test_bad_group_and_priority(self):
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", 10, 5, exclusive_group="")
        with self.assertRaises(ValidationError):
            CouponSpec.build("C1", 10, 5, priority=1.5)

    def test_all_categories_when_empty(self):
        spec = CouponSpec.build("C1", 10, 5)
        self.assertTrue(spec.applies_to_category("anything"))


class OrderLineValidationTests(unittest.TestCase):
    def setUp(self):
        self.engine = SettlementEngine()
        self.engine.register_category("food")

    def test_quantity_must_be_positive_int(self):
        for bad in (0, -1, 1.5, True):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError):
                    OrderLine.build("L1", "food", 10, bad, known_categories=["food"])

    def test_category_must_be_registered(self):
        with self.assertRaises(ValidationError) as cm:
            OrderLine.build("L1", "ghost", 10, 1, known_categories=["food"])
        self.assertIn("尚未登记", str(cm.exception))
        self.assertIn("L1", cm.exception.path)

    def test_unknown_category_rejected_by_engine_before_state_change(self):
        before = self.engine.lines()
        with self.assertRaises(ValidationError):
            self.engine.add_line(OrderLine.build("L1", "ghost", 10, 1))
        self.assertEqual(before, self.engine.lines())

    def test_duplicate_line_rejected(self):
        self.engine.add_line(OrderLine.build("L1", "food", 10, 1, ["food"]))
        with self.assertRaises(ValidationError):
            self.engine.set_order(
                [
                    OrderLine.build("L1", "food", 10, 1),
                    OrderLine.build("L1", "food", 20, 2),
                ]
            )

    def test_line_total(self):
        ln = OrderLine.build("L1", "food", "12.34", 3, ["food"])
        self.assertEqual(ln.line_total_cents, 1234 * 3)


if __name__ == "__main__":
    unittest.main()
