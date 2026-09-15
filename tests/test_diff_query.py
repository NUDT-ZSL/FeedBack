"""需求 6、7：版本/数据差异报告与查询接口。"""

import unittest

from .scenario import V1_FIELDS, V2_FIELDS, V3_FIELDS, build_kernel


class TestDiff(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()

    def _kinds(self, diffs, path):
        return [d["kind"] for d in d if d["path"] == path]

    def test_version_diff_v1_v2(self):
        report = self.k.version_diff("v1", "v2")
        diffs = report["diffs"]
        # 稳定排序
        paths = [d["path"] for d in diffs]
        self.assertEqual(paths, sorted(paths))
        self.assertIn("address", paths)
        self.assertIn("address.city", paths)
        enum_diff = next(d for d in diffs if d["path"] == "status" and d["kind"] == "enum_changed")
        self.assertEqual(enum_diff["detail"]["enum_values_added"], ["archived"])
        self.assertEqual(enum_diff["detail"]["enum_values_removed"], [])

    def test_version_diff_v2_v3_removed_and_type_changed(self):
        diffs = self.k.version_diff("v2", "v3")["diffs"]
        self.assertIn("name", [d["path"] for d in diffs if d["kind"] == "removed"])
        self.assertIn("title", [d["path"] for d in diffs if d["kind"] == "added"])
        # tags[] 元素类型 string -> object
        tag_item = next(d for d in diffs if d["path"] == "tags[]")
        self.assertEqual(tag_item["kind"], "type_changed")
        self.assertEqual(tag_item["detail"], {"from_type": "string", "to_type": "object"})
        # 嵌套新增 tags[].label
        self.assertIn("tags[].label", [d["path"] for d in diffs])
        # status 枚举变化：新增 live，移除 published
        status = next(d for d in diffs if d["path"] == "status" and d["kind"] == "enum_changed")
        self.assertEqual(status["detail"]["enum_values_added"], ["live"])
        self.assertEqual(status["detail"]["enum_values_removed"], ["published"])

    def test_version_diff_is_symmetric_for_add_remove(self):
        fwd = self.k.version_diff("v1", "v2")["diffs"]
        rev = self.k.version_diff("v2", "v1")["diffs"]
        self.assertIn("address", [d["path"] for d in fwd if d["kind"] == "added"])
        self.assertIn("address", [d["path"] for d in rev if d["kind"] == "removed"])

    def test_data_diff_shows_defaults_unknown_and_errors(self):
        raw = {"id": 1, "name": "d", "status": "published", "ghost": 12}
        report = self.k.data_diff("v1", "v3", raw)
        kinds = {(d["path"], d["kind"]) for d in report["diffs"]}
        self.assertIn(("ghost", "unknown"), kinds)
        # score 在两个版本都补了默认值
        self.assertIn(("score", "default_applied"), kinds)
        self.assertEqual(report["parse_ok"], {"v1": True, "v3": False})
        # v3 直接解析旧数据缺 title，报告 parse_error
        errs = [d for d in report["diffs"] if d["kind"] == "parse_error"]
        self.assertTrue(any(d["detail"]["version"] == "v3" for d in errs))

    def test_diff_cross_chain_fails(self):
        self.k.register_version("other", V1_FIELDS)
        with self.assertRaises(Exception):
            self.k.version_diff("v1", "other")


class TestQuery(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()

    def test_query_field_rule(self):
        rule = self.k.field_rule("v2", "address.city")
        self.assertEqual(rule["type"], "string")
        self.assertEqual(rule["default"], "unknown")
        item = self.k.field_rule("v3", "tags[]")
        self.assertEqual(item["type"], "object")
        label = self.k.field_rule("v3", "tags[].label")
        self.assertEqual(label["required"], True)
        with self.assertRaises(Exception):
            self.k.field_rule("v1", "address.city")

    def test_field_lifecycle_intro_and_deprecation(self):
        life = self.k.field_lifecycle()
        by_path = {(r["path"], r["introduced"], r["deprecated"]) for r in life}
        self.assertIn(("id", "v1", None), by_path)
        self.assertIn(("name", "v1", "v3"), by_path)
        self.assertIn(("title", "v3", None), by_path)
        self.assertIn(("address", "v2", None), by_path)
        # 按路径稳定排序
        self.assertEqual([r["path"] for r in life], sorted(r["path"] for r in life))
        # 路径过滤
        self.assertEqual([r["path"] for r in self.k.field_lifecycle("name")], ["name"])

    def test_query_parse_result_and_migration_path(self):
        result = self.k.query_parse(
            "v1", {"id": 1, "name": "d", "status": "draft"}
        )
        self.assertTrue(result.ok)
        self.assertEqual(self.k.migration_path("v1", "v3"), ["v1", "v2", "v3"])
        plan = self.k.plan_migration("v1", "v3")
        self.assertEqual(len(plan["steps"]), 2)
        self.assertEqual(plan["steps"][1]["fields_removed"], ["name"])

    def test_versions_stable_order(self):
        self.assertEqual(self.k.versions(), ["v1", "v2", "v3"])
        self.assertEqual(self.k.version_chain("v3"), ["v1", "v2", "v3"])


if __name__ == "__main__":
    unittest.main()
