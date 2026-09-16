"""需求 7：单文件写出/载入、损坏与缺字段清晰报错、失败后状态不变。"""

import json
import os
import tempfile
import unittest

from themeoracle import DesignSystem, persistence, SerializationError
from themeoracle.valuetypes import Color


def build_rich_system():
    ds = DesignSystem()
    ds.add_variable("color.primary", "color", "#3366ff")
    ds.add_variable("radius.base", "length", "4px")
    ds.add_variable("font.scale", "number", 1.0)
    ds.add_theme("base", overrides={"color.primary": "#3366ff"})
    ds.add_theme("dark", parent="base", overrides={"color.primary": "#0a0a0a"})
    ds.add_theme("amoled", parent="dark", overrides={"color.primary": "#000000"})
    # 焐热一些缓存，确认缓存不影响序列化内容
    ds.resolve_all("amoled")
    return ds


class RoundTripTest(unittest.TestCase):
    def setUp(self):
        self.ds = build_rich_system()

    def assert_systems_equal(self, a, b):
        self.assertEqual(a.variable_ids, b.variable_ids)
        self.assertEqual(a.theme_names, b.theme_names)
        for vid in a.variable_ids:
            va, vb = a.get_variable(vid), b.get_variable(vid)
            self.assertEqual(va.type_name, vb.type_name)
            self.assertEqual(va.default, vb.default)
        for name in a.theme_names:
            ta, tb = a.get_theme(name), b.get_theme(name)
            self.assertEqual(ta.parent, tb.parent)
            self.assertEqual(ta.overrides, tb.overrides)
            for vid in a.variable_ids:
                ra, rb = a.resolve(name, vid), b.resolve(name, vid)
                self.assertEqual(ra.value, rb.value, f"{name}/{vid}")
                self.assertEqual(ra.source, rb.source, f"{name}/{vid}")
                self.assertEqual(ra.used_default, rb.used_default, f"{name}/{vid}")
        self.assertEqual(
            [(r.variable_id, r.theme_name, r.assignments) for r in a.conflicts()],
            [(r.variable_id, r.theme_name, r.assignments) for r in b.conflicts()],
        )

    def test_to_dict_shape(self):
        data = persistence.to_dict(self.ds)
        self.assertEqual(data["format"], "themeoracle/v1")
        self.assertEqual({v["id"] for v in data["variables"]},
                         {"color.primary", "radius.base", "font.scale"})
        self.assertEqual([t["name"] for t in data["themes"]],
                         ["base", "dark", "amoled"])  # 拓扑序
        self.assertIsNone(data["themes"][0]["parent"])
        self.assertEqual(data["themes"][1]["parent"], "base")
        # color.primary 三种取值 => amoled/dark 视角下各一条冲突
        conflict_vars = {(c["variable_id"], c["theme"]) for c in data["conflicts"]}
        self.assertIn(("color.primary", "dark"), conflict_vars)
        self.assertIn(("color.primary", "amoled"), conflict_vars)

    def test_loads_roundtrip(self):
        text = persistence.dumps(self.ds)
        loaded = persistence.loads(text)
        self.assert_systems_equal(self.ds, loaded)

    def test_save_load_file_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "nested", "system.json")
            with self.assertRaises(SerializationError):
                persistence.save(self.ds, path)  # 目录不存在 -> 清晰报错
            os.makedirs(os.path.dirname(path))
            persistence.save(self.ds, path)
            self.assertTrue(os.path.exists(path))
            loaded = persistence.load(path)
            self.assert_systems_equal(self.ds, loaded)

    def test_load_into_existing_target_replaces_state(self):
        target = DesignSystem()
        target.add_variable("old", "string", "old")
        target.add_theme("oldtheme")
        persistence.loads(persistence.dumps(self.ds), target=target)
        self.assertNotIn("old", target.variable_ids)
        self.assertEqual(target.theme_names, ("amoled", "base", "dark"))
        self.assertEqual(
            target.resolve("amoled", "color.primary").value, Color("#000000")
        )

    def test_unicode_content_roundtrip(self):
        ds = DesignSystem()
        ds.add_variable("标题色", "color", "#333333")
        ds.add_theme("夜间模式", overrides={"标题色": "#eeeeee"})
        loaded = persistence.loads(persistence.dumps(ds))
        self.assertEqual(loaded.get_theme("夜间模式").parent, None)
        self.assertEqual(
            loaded.resolve("夜间模式", "标题色").value, Color("#eeeeee")
        )


class CorruptionTest(unittest.TestCase):
    def setUp(self):
        self.good_text = persistence.dumps(build_rich_system())
        self.target = build_rich_system()
        # 记录目标系统原有状态快照
        self.before = {
            "variables": self.target.variable_ids,
            "themes": self.target.theme_names,
            "amoled_color": self.target.resolve("amoled", "color.primary").value,
        }

    def load_bad(self, mutated):
        with self.assertRaises(SerializationError) as ctx:
            persistence.loads(mutated, target=self.target)
        return ctx.exception

    def assert_state_unchanged(self):
        self.assertEqual(self.target.variable_ids, self.before["variables"])
        self.assertEqual(self.target.theme_names, self.before["themes"])
        self.assertEqual(
            self.target.resolve("amoled", "color.primary").value,
            self.before["amoled_color"],
        )

    def test_broken_json_reports_position(self):
        err = self.load_bad("{ not json")
        self.assertIn("合法 JSON", str(err))
        self.assertEqual(err.location, "<root>")
        self.assert_state_unchanged()

    def test_root_not_object(self):
        err = self.load_bad("[]")
        self.assertIn("根对象", str(err))
        self.assert_state_unchanged()

    def test_missing_format(self):
        data = json.loads(self.good_text)
        del data["format"]
        err = self.load_bad(json.dumps(data))
        self.assertIn("format", err.location)
        self.assert_state_unchanged()

    def test_wrong_format(self):
        data = json.loads(self.good_text)
        data["format"] = "something-else"
        err = self.load_bad(json.dumps(data))
        self.assertIn("格式标识不符", str(err))
        self.assert_state_unchanged()

    def test_missing_theme_fields(self):
        for field in ("name", "parent", "overrides"):
            data = json.loads(self.good_text)
            del data["themes"][0][field]
            err = self.load_bad(json.dumps(data))
            self.assertIn(field, str(err))
            self.assertTrue(err.location.startswith("themes[0]"))
            self.assert_state_unchanged()

    def test_missing_variable_fields(self):
        for field in ("id", "type", "default"):
            data = json.loads(self.good_text)
            del data["variables"][0][field]
            err = self.load_bad(json.dumps(data))
            self.assertIn(field, str(err))
            self.assertTrue(err.location.startswith("variables[0]"))
            self.assert_state_unchanged()

    def test_empty_system_roundtrip(self):
        empty = DesignSystem()
        loaded = persistence.loads(persistence.dumps(empty))
        self.assertEqual(loaded.variable_ids, ())
        self.assertEqual(loaded.theme_names, ())
        self.assertEqual(loaded.conflicts(), [])

    def test_missing_sections(self):
        data = json.loads(self.good_text)
        del data["variables"]
        err = self.load_bad(json.dumps(data))
        self.assertIn("variables", str(err))
        self.assertIn("缺少必需字段", str(err))

        data = json.loads(self.good_text)
        del data["themes"]
        err = self.load_bad(json.dumps(data))
        self.assertIn("themes", str(err))
        self.assert_state_unchanged()

    def test_duplicate_variable_id_in_file(self):
        data = json.loads(self.good_text)
        data["variables"][1]["id"] = data["variables"][0]["id"]
        err = self.load_bad(json.dumps(data))
        self.assertIn("重复", str(err))
        self.assertIn("variables[1]", err.location)
        self.assert_state_unchanged()

    def test_bad_typed_default_in_file(self):
        data = json.loads(self.good_text)
        index = next(
            i for i, v in enumerate(data["variables"])
            if v["id"] == "font.scale"
        )
        data["variables"][index]["default"] = "big"
        err = self.load_bad(json.dumps(data))
        self.assertIn("number", str(err))
        self.assertIn("font.scale", str(err))
        self.assertEqual(err.location, f"variables[{index}].default")
        self.assert_state_unchanged()

    def test_override_unknown_variable(self):
        data = json.loads(self.good_text)
        data["themes"][0]["overrides"]["ghost.var"] = "#123456"
        err = self.load_bad(json.dumps(data))
        self.assertIn("ghost.var", str(err))
        self.assertIn("overrides", err.location)
        self.assert_state_unchanged()

    def test_override_wrong_type(self):
        data = json.loads(self.good_text)
        data["themes"][0]["overrides"]["radius.base"] = 16
        err = self.load_bad(json.dumps(data))
        self.assertIn("length", str(err))
        self.assert_state_unchanged()

    def test_unknown_parent(self):
        data = json.loads(self.good_text)
        data["themes"][0]["parent"] = "missing-parent"
        err = self.load_bad(json.dumps(data))
        self.assertIn("missing-parent", str(err))
        self.assertIn("base -> missing-parent", str(err))
        self.assert_state_unchanged()

    def test_inheritance_cycle_in_file(self):
        data = json.loads(self.good_text)
        # base <- dark <- amoled；让 base 的父指向 amoled 成环
        data["themes"][0]["parent"] = "amoled"
        err = self.load_bad(json.dumps(data))
        self.assertIn("环", str(err))
        chain = err.chain if hasattr(err, "chain") else None
        # ParentThemeNotFoundError 不会出现（三个主题都在）
        self.assert_state_unchanged()

    def test_tampered_conflict_snapshot_detected(self):
        data = json.loads(self.good_text)
        data["conflicts"][0]["assignments"][0]["value"] = "#ffffff"
        err = self.load_bad(json.dumps(data))
        self.assertIn("冲突记录", str(err))
        self.assertEqual(err.location, "conflicts")
        self.assert_state_unchanged()

    def test_missing_conflict_detected(self):
        data = json.loads(self.good_text)
        data["conflicts"] = []
        err = self.load_bad(json.dumps(data))
        self.assertIn("冲突记录", str(err))
        self.assert_state_unchanged()

    def test_malformed_conflict_entry(self):
        data = json.loads(self.good_text)
        del data["conflicts"][0]["assignments"]
        err = self.load_bad(json.dumps(data))
        self.assertTrue(err.location.startswith("conflicts[0]"))
        self.assert_state_unchanged()

    def test_conflicts_section_absent_is_ok(self):
        # conflicts 段缺失时按空列表处理，但重新推导出的非空 => 必须失败
        data = json.loads(self.good_text)
        del data["conflicts"]
        with self.assertRaises(SerializationError):
            persistence.loads(json.dumps(data))
        # 无冲突的系统缺失该段则应通过
        clean = DesignSystem()
        clean.add_variable("x", "string", "d")
        clean.add_theme("t")
        text = persistence.dumps(clean)
        data2 = json.loads(text)
        del data2["conflicts"]
        loaded = persistence.loads(json.dumps(data2))
        self.assertEqual(loaded.resolve("t", "x").value, "d")

    def test_missing_file_clear_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SerializationError) as ctx:
                persistence.load(os.path.join(tmp, "nope.json"))
            self.assertIn("无法读取文件", str(ctx.exception))

    def test_field_type_errors(self):
        # variables 不是列表
        data = json.loads(self.good_text)
        data["variables"] = {}
        err = self.load_bad(json.dumps(data))
        self.assertEqual(err.location, "variables")
        # 主题名不是字符串
        data = json.loads(self.good_text)
        data["themes"][0]["name"] = 42
        err = self.load_bad(json.dumps(data))
        self.assertIn("name", err.location)
        self.assert_state_unchanged()

    def test_save_failure_leaves_no_temp_file(self):
        ds = build_rich_system()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "sys.json")
            persistence.save(ds, path)
            leftovers = [
                f for f in os.listdir(tmp) if f.startswith(".") and f.endswith(".tmp")
            ]
            self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
