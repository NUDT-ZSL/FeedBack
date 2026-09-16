"""需求 1：项目维护与非法配置拒绝（错误必须指出位置）。"""

import unittest
from decimal import Decimal

from fund_allocator import Project
from fund_allocator.errors import ValidationError


class TestProjectValidation(unittest.TestCase):
    def test_valid_project(self):
        p = Project.create("P1", 1, "300.00", "100.00", ["100.00", "200.00"], benefit="450")
        self.assertEqual(p.total_need, Decimal("300.00"))
        self.assertEqual(sum(p.phases, Decimal("0")), p.total_need)
        self.assertEqual(p.benefit, Decimal("450.00"))

    def test_benefit_defaults_to_total_need(self):
        p = Project.create("P1", 1, "100.00", "50.00", ["100.00"])
        self.assertEqual(p.benefit, Decimal("100.00"))

    def test_phases_sum_mismatch_points_to_location(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P2", 1, "300.00", "100.00", ["100.00", "150.00"])
        err = cm.exception
        self.assertIn("projects['P2'].phases", str(err))
        self.assertIn("不等于总需求额", err.message)

    def test_empty_phases_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P3", 1, "100.00", "50.00", [])
        self.assertIn("phases", cm.exception.location)

    def test_zero_phase_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P3", 1, "100.00", "50.00", ["100.00", "0"])
        self.assertIn("phases[1]", cm.exception.location)

    def test_min_start_exceeds_total(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P4", 1, "100.00", "150.00", ["100.00"])
        self.assertIn("min_start", cm.exception.location)

    def test_nonpositive_total(self):
        with self.assertRaises(ValidationError):
            Project.create("P5", 1, "0", "0", [])

    def test_negative_amount(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P6", 1, "-100.00", "10.00", ["-100.00"])
        self.assertTrue(str(cm.exception).count("projects['P6']") >= 1)

    def test_bad_precision_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            Project.create("P7", 1, "100.005", "10.00", ["100.005"])
        self.assertIn("精度", cm.exception.message)

    def test_float_must_be_exact_cent(self):
        from fund_allocator.models import money
        # 恰好到分的 float（经 str 规范化）可以接受
        self.assertEqual(money(10.1), Decimal("10.10"))
        # 精度超过分的 float 被拒绝
        with self.assertRaises(ValidationError):
            money(1.005)

    def test_blank_id_rejected(self):
        with self.assertRaises(ValidationError):
            Project.create("   ", 1, "100.00", "10.00", ["100.00"])

    def test_priority_must_be_int(self):
        with self.assertRaises(ValidationError):
            Project.create("P9", 1.5, "100.00", "10.00", ["100.00"])

    def test_roundtrip_dict(self):
        p = Project.create("P1", 2, "300.00", "100.00", ["100.00", "200.00"])
        q = Project.from_dict(p.to_dict())
        self.assertEqual(q, p)

    def test_from_dict_missing_field(self):
        with self.assertRaises(ValidationError) as cm:
            Project.from_dict({
                "id": "X", "priority": 1, "total_need": "100.00",
                "min_start": "10.00",
            })
        self.assertEqual(cm.exception.field, "phases")
        self.assertTrue(cm.exception.location.startswith("projects"))

    def test_from_dict_missing_phases_and_minstart_locates_phases(self):
        """同时缺 phases 和 min_start 时，错误必须定位到 phases 而非 min_start。"""
        with self.assertRaises(ValidationError) as cm:
            Project.from_dict({
                "id": "X", "priority": 1, "total_need": "100.00",
            }, index=2)
        self.assertEqual(cm.exception.field, "phases")
        self.assertIn("projects[2]", cm.exception.location)

    def test_from_dict_non_integer_priority_rejected(self):
        base = {
            "id": "X", "total_need": "100.00", "min_start": "10.00",
            "phases": ["100.00"],
        }
        for bad in (1.5, "1", None, True):
            with self.subTest(bad=bad):
                with self.assertRaises(ValidationError) as cm:
                    Project.from_dict({**base, "priority": bad})
                self.assertIn(".priority", cm.exception.location)
                self.assertIn("整数", cm.exception.message)

    def test_negative_benefit(self):
        with self.assertRaises(ValidationError):
            Project.create("P10", 1, "100.00", "10.00", ["100.00"], benefit="-5")

    def test_funded_phases_ordering(self):
        p = Project.create("P1", 1, "300.00", "100.00", ["100.00", "150.00", "50.00"])
        used, _ = p.funded_phases(Decimal("180.00"))
        self.assertEqual(used, (Decimal("100.00"), Decimal("80.00")))


if __name__ == "__main__":
    unittest.main()
