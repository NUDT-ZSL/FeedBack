"""Schema 强类型校验测试。"""

import unittest

from table_kernel.errors import ValidationError
from table_kernel.schema import FIELD_TYPES, FieldSpec, Schema


class SchemaTest(unittest.TestCase):
    def test_field_type_acceptance(self):
        cases = [
            ("int", 1, True), ("int", -3, True),
            ("int", True, False), ("int", 1.0, False), ("int", "1", False),
            ("float", 1.0, True), ("float", 1, True),
            ("float", True, False), ("float", "1", False),
            ("str", "x", True), ("str", "", True),
            ("str", 1, False), ("str", None, False),
            ("bool", True, True), ("bool", False, True),
            ("bool", 0, False), ("bool", 1, False),
        ]
        for typ, val, ok in cases:
            f = FieldSpec("f", typ)
            if ok:
                f.validate(val)
            else:
                with self.assertRaises(ValidationError):
                    f.validate(val)

    def test_field_spec_rejects_bad_type(self):
        with self.assertRaises(ValidationError):
            FieldSpec("f", "bigint")
        with self.assertRaises(ValidationError):
            FieldSpec("", "int")

    def test_schema_duplicate_field(self):
        with self.assertRaises(ValidationError):
            Schema([FieldSpec("a", "int"), FieldSpec("a", "str")])

    def test_schema_row_validation(self):
        s = Schema({"a": "int", "b": "str", "c": "float", "d": "bool"})
        s.validate_row({"a": 1, "b": "x", "c": 1.5, "d": False})
        s.validate_row({"a": 1, "b": "x", "c": 2, "d": False})  # int 当 float
        bad_rows = [
            {"a": 1, "b": "x", "c": 1.5},               # 缺字段
            {"a": 1, "b": "x", "c": 1.5, "d": 0},       # bool 给 int
            {"a": "1", "b": "x", "c": 1.5, "d": True},  # int 给 str
            {"a": 1, "b": 2, "c": 1.5, "d": True},      # str 给 int
            {"a": 1, "b": "x", "c": 1.5, "d": True, "e": 1},  # 多余字段
            "not a dict",
        ]
        for row in bad_rows:
            with self.assertRaises(ValidationError):
                s.validate_row(row)

    def test_validate_row_error_index(self):
        s = Schema({"a": "int"})
        try:
            s.validate_row({"a": "bad"}, index=42)
        except ValidationError as e:
            self.assertEqual(e.index, 42)
            self.assertEqual(e.path, "a")
        else:
            self.fail("应当抛出 ValidationError")

    def test_field_types_constant(self):
        self.assertEqual(set(FIELD_TYPES), {"int", "float", "str", "bool"})

    def test_float_rejects_nan_and_infinity(self):
        import math
        f = FieldSpec("f", "float")
        for bad in (math.nan, math.inf, -math.inf):
            with self.assertRaises(ValidationError):
                f.validate(bad)
        # 普通浮点与整数字面量仍然接受
        f.validate(0.0)
        f.validate(1)

    def test_schema_as_dict(self):
        s = Schema({"a": "int", "b": "str"})
        self.assertEqual([f.name for f in s.fields], ["a", "b"])
        self.assertTrue(s.has("a"))
        self.assertFalse(s.has("z"))


if __name__ == "__main__":
    unittest.main()
