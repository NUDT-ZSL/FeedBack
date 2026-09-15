"""需求 3、4：按版本解析——类型/必填/枚举校验、错误定位、默认值、未知字段。"""

import copy
import unittest

from evo_kernel import ParseError
from evo_kernel.parser import parse

from .scenario import V1_FIELDS, V2_FIELDS, build_kernel
from evo_kernel.rules import FieldRule
from evo_kernel.versions import Version


def _version(vid, fields):
    return Version(version_id=vid, parent=None, fields=[FieldRule.from_dict(f) for f in fields])


class TestParsing(unittest.TestCase):
    def test_valid_record_normalized(self):
        v1 = _version("v1", V1_FIELDS)
        result = parse(v1, {"id": 7, "name": "n", "status": "draft", "score": 3})
        self.assertTrue(result.ok)
        # number 字段里的整数规整为 float；缺省 tags 补 []
        self.assertEqual(
            result.data,
            {"id": 7, "name": "n", "status": "draft", "score": 3.0, "tags": []},
        )
        self.assertEqual(result.defaults_applied, ["tags"])

    def test_bool_is_not_integer_or_number(self):
        v1 = _version("v1", V1_FIELDS)
        result = parse(v1, {"id": True, "name": "n", "status": "draft"})
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].path, "id")
        self.assertIn("integer", result.errors[0].expected)

    def test_missing_required_collected_with_path_expected_actual(self):
        v1 = _version("v1", V1_FIELDS)
        result = parse(v1, {"name": "n"})
        paths = {e.path for e in result.errors}
        self.assertIn("id", paths)
        self.assertIn("status", paths)
        err = next(e for e in result.errors if e.path == "status")
        self.assertIsNone(err.actual)
        self.assertEqual(err.reason, "缺少必填字段")
        # require_ok 抛出聚合错误
        with self.assertRaises(ParseError) as ctx:
            result.require_ok()
        self.assertEqual(ctx.exception.version_id, "v1")
        self.assertEqual(len(ctx.exception.field_errors), 2)

    def test_enum_violation_reports_expected_values(self):
        v1 = _version("v1", V1_FIELDS)
        result = parse(v1, {"id": 1, "name": "n", "status": "archived"})
        err = result.errors[0]
        self.assertEqual(err.path, "status")
        self.assertEqual(err.reason, "枚举取值非法")
        self.assertIn("draft", err.expected)
        self.assertEqual(err.actual, "archived")

    def test_multiple_errors_sorted_by_path(self):
        v2 = _version("v2", V2_FIELDS)
        bad = {
            "id": "x",
            "name": 3,
            "status": "gone",
            "address": {"city": 9},
        }
        result = parse(v2, bad)
        paths = [e.path for e in result.errors]
        self.assertEqual(paths, sorted(paths))
        self.assertIn("address.city", paths)

    def test_nested_and_array_element_paths(self):
        from .scenario import V3_FIELDS

        v3 = _version("v3", V3_FIELDS)
        bad = {
            "id": 1,
            "title": "t",
            "status": "live",
            "tags": [{"label": "ok"}, {"label": 7}],
        }
        result = parse(v3, bad)
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].path, "tags[1].label")

    def test_unknown_fields_are_reported_not_dropped(self):
        v1 = _version("v1", V1_FIELDS)
        raw = {
            "id": 1,
            "name": "n",
            "status": "draft",
            "future_field": {"x": 1},
            "another": "v",
        }
        raw_copy = copy.deepcopy(raw)
        result = parse(v1, raw)
        self.assertTrue(result.ok)
        self.assertEqual(set(result.unknown), {"future_field", "another"})
        self.assertEqual(result.unknown["future_field"], {"x": 1})
        # 投影后的数据不含未知键
        self.assertNotIn("future_field", result.data)
        # 输入不被修改
        self.assertEqual(raw, raw_copy)

    def test_defaults_fill_nested_missing_paths(self):
        v2 = _version("v2", V2_FIELDS)
        result = parse(
            v2, {"id": 1, "name": "n", "status": "draft", "address": {"zip": "1"}}
        )
        self.assertTrue(result.ok, result.errors)
        self.assertEqual(result.data["address"], {"city": "unknown", "zip": "1"})
        self.assertIn("address.city", result.defaults_applied)
        # address 整体缺省时不补（对象本身无默认值），也不算错误（非必填）
        result2 = parse(v2, {"id": 1, "name": "n", "status": "draft"})
        self.assertTrue(result2.ok)
        self.assertNotIn("address", result2.data)

    def test_top_level_must_be_object(self):
        v1 = _version("v1", V1_FIELDS)
        result = parse(v1, [1, 2])
        self.assertFalse(result.ok)
        self.assertEqual(result.errors[0].path, "<root>")

    def test_envelope_reader_uses_version_tag(self):
        k = build_kernel()
        result = k.read_envelope({"version": "v1", "data": {"id": 1, "name": "n", "status": "draft"}})
        self.assertEqual(result.version_id, "v1")
        with self.assertRaises(Exception):
            k.read_envelope({"version": "v9", "data": {}})
        with self.assertRaises(ParseError):
            k.read_envelope({"version": "v1", "data": {"id": "bad"}})

    def test_reproducible_output(self):
        v1 = _version("v1", V1_FIELDS)
        raw = {"status": "draft", "id": 1, "name": "n", "z": 1, "a": 2}
        r1 = parse(v1, copy.deepcopy(raw))
        r2 = parse(v1, copy.deepcopy(raw))
        self.assertEqual(r1.to_dict(), r2.to_dict())


if __name__ == "__main__":
    unittest.main()
