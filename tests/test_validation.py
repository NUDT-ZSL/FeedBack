"""逐字段校验：类型、范围、枚举、必填路径、错误报告质量（需求 3）。"""

import unittest

from cfgkernel.errors import FieldProblem, ValidationError

from tests.helpers import build_kernel


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()
        # 两个严格（error 策略）字段，专门验证硬校验失败必须报错
        self.k.register_field(
            "net.hard_power", "int", "1.0.0", default=10,
            min_value=0, max_value=30)  # 默认 range_policy=error
        self.k.register_field(
            "net.hard_mode", "enum", "1.0.0", default="b",
            enum_members=[("b", "1.0.0"), ("g", "1.0.0")])  # error 策略

    def test_wrong_type_reports_path_expected_actual(self):
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({"net": {"tx_power": "high"}}, "1.0.0")
        problems = cm.exception.problems
        paths = {p.path for p in problems}
        self.assertIn("net.tx_power", paths)
        p = next(p for p in problems if p.path == "net.tx_power")
        self.assertEqual(p.kind, FieldProblem.KIND_TYPE)
        self.assertIn("int", p.expected)
        self.assertEqual(p.actual, "high")

    def test_bool_is_not_int(self):
        # Python 中 True/False 不能被当成 1/0 静默接受
        with self.assertRaises(ValidationError):
            self.k.normalize({"net": {"tx_power": True}}, "1.0.0")

    def test_out_of_range_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({"net": {"hard_power": 99}}, "1.0.0")
        p = cm.exception.problems[0]
        self.assertEqual(p.path, "net.hard_power")
        self.assertEqual(p.kind, FieldProblem.KIND_RANGE)
        self.assertIn("[0, 30]", p.expected)

    def test_string_length_validated(self):
        with self.assertRaises(ValidationError):
            self.k.normalize(
                {"system": {"name": "x" * 17}}, "1.0.0")

    def test_illegal_enum_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({"net": {"hard_mode": "wifi7"}}, "1.0.0")
        p = cm.exception.problems[0]
        self.assertEqual(p.kind, FieldProblem.KIND_ENUM)
        self.assertIn("wifi7", str(p))

    def test_collects_multiple_problems_at_once(self):
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({
                "net": {"hard_power": "bad", "hard_mode": "nope"},
                "system": {"name": "x" * 50},
            }, "1.0.0")
        paths = {p.path for p in cm.exception.problems}
        self.assertEqual(
            paths, {"net.hard_power", "net.hard_mode", "system.name"})

    def test_nested_list_index_path(self):
        self.k.register_field(
            "net.scan_list", "list", "1.0.0", default=[],
            min_length=0, max_length=4, elem_type="int")
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({"net": {"scan_list": [1, "x", 3]}}, "1.0.0")
        p = cm.exception.problems[0]
        self.assertEqual(p.path, "net.scan_list[1]")
        self.assertEqual(p.kind, FieldProblem.KIND_TYPE)

    def test_list_length_validated(self):
        self.k.register_field(
            "net.scan_list", "list", "1.0.0", default=[0],
            min_length=1, max_length=4, elem_type="int")
        with self.assertRaises(ValidationError) as cm:
            self.k.normalize({"net": {"scan_list": [1, 2, 3, 4, 5]}}, "1.0.0")
        self.assertEqual(cm.exception.problems[0].kind, FieldProblem.KIND_RANGE)

    def test_valid_config_passes(self):
        cfg = self.k.normalize({
            "system": {"name": "site-01"},
            "net": {"tx_power": 18, "wifi_mode": "n", "channel": 11},
        }, "1.5.0")
        self.assertEqual(cfg.get("system.name"), "site-01")
        self.assertEqual(cfg.get("net.tx_power"), 18)
        self.assertEqual(cfg.get("net.wifi_mode"), "n")


if __name__ == "__main__":
    unittest.main()
