"""需求 1：视觉变量的登记、类型校验、重复标识拒绝与定位。"""

import unittest

from themeoracle import (
    DesignSystem,
    Variable,
    ValueType,
    Color,
    Length,
    DuplicateVariableError,
    InvalidValueError,
)


class VariableDefinitionTest(unittest.TestCase):
    def setUp(self):
        self.ds = DesignSystem()

    def test_add_and_list_stable_order(self):
        self.ds.add_variable("z-index", "integer", 0)
        self.ds.add_variable("color.primary", "color", "#3366ff")
        self.ds.add_variable("radius", "length", "4px")
        self.assertEqual(
            self.ds.variable_ids, ("color.primary", "radius", "z-index")
        )

    def test_all_builtin_types_accepted(self):
        cases = {
            "s": ("string", "hello"),
            "i": ("integer", 7),
            "n": ("number", 1.5),
            "b": ("boolean", False),
            "c": ("color", "#abcdef"),
            "l": ("length", "12px"),
        }
        for vid, (type_name, value) in cases.items():
            self.ds.add_variable(vid, type_name, value)
        self.assertIsInstance(self.ds.get_variable("c").default, Color)
        self.assertIsInstance(self.ds.get_variable("l").default, Length)

    def test_duplicate_id_rejected_with_location(self):
        self.ds.add_variable("color.primary", "color", "#fff")
        with self.assertRaises(DuplicateVariableError) as ctx:
            self.ds.add_variable("color.primary", "string", "x")
        self.assertEqual(ctx.exception.variable_id, "color.primary")
        self.assertIn("color.primary", str(ctx.exception))
        self.assertIn("variables[", ctx.exception.location)
        # 拒绝后原变量不受影响
        self.assertEqual(self.ds.get_variable("color.primary").type_name, "color")

    def test_invalid_default_type_rejected_with_location(self):
        with self.assertRaises(InvalidValueError) as ctx:
            self.ds.add_variable("spacing", "length", 16)
        self.assertEqual(ctx.exception.variable_id, "spacing")
        self.assertIn("length", ctx.exception.expected)
        self.assertIn("spacing", ctx.exception.location)

    def test_bool_is_not_integer_or_number(self):
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("i", "integer", True)
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("n", "number", True)

    def test_number_rejects_nan_and_inf(self):
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("n1", "number", float("nan"))
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("n2", "number", float("inf"))

    def test_integer_rejects_float(self):
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("i", "integer", 1.0)

    def test_unknown_type_rejected(self):
        with self.assertRaises(InvalidValueError) as ctx:
            self.ds.add_variable("x", "pixel", 1)
        self.assertIn("未知取值类型", str(ctx.exception))

    def test_color_equivalent_forms_normalize_equal(self):
        self.ds.add_variable("c1", "color", "#ffffff")
        self.ds.add_variable("c2", "color", "#FFF")
        self.ds.add_variable("c3", "color", "rgb(255, 255, 255)")
        v1 = self.ds.get_variable("c1").default
        self.assertEqual(v1, self.ds.get_variable("c2").default)
        self.assertEqual(v1, self.ds.get_variable("c3").default)
        self.assertEqual(v1.hex, "#ffffff")

    def test_bad_color_message(self):
        with self.assertRaises(InvalidValueError) as ctx:
            self.ds.add_variable("c", "color", "not-a-color")
        self.assertEqual(ctx.exception.expected, "color")
        self.assertTrue(ctx.exception.location.startswith("variables["))
        self.assertIn("variables['c'].default", ctx.exception.location)

    def test_length_zero_without_unit_and_equivalence(self):
        self.ds.add_variable("l1", "length", "0")
        self.ds.add_variable("l2", "length", "0px")
        self.assertEqual(
            self.ds.get_variable("l1").default,
            self.ds.get_variable("l2").default,
        )

    def test_nonzero_length_requires_unit(self):
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("l", "length", "16")

    def test_state_unchanged_after_failed_add(self):
        self.ds.add_variable("a", "string", "ok")
        before = self.ds.variable_ids
        with self.assertRaises(InvalidValueError):
            self.ds.add_variable("b", "integer", "wrong")
        self.assertEqual(self.ds.variable_ids, before)

    def test_direct_variable_construction_validates_type_name(self):
        with self.assertRaises(ValueError):
            Variable("v", "nonsense", 1)


if __name__ == "__main__":
    unittest.main()
