"""需求 6：最终取值、来源主题、被哪些主题覆盖过，且顺序稳定。"""

import unittest

from themeoracle import DesignSystem, ThemeNotFoundError, VariableNotFoundError


class QueryTest(unittest.TestCase):
    def setUp(self):
        self.ds = DesignSystem()
        self.ds.add_variable("c.bg", "color", "#ffffff")
        self.ds.add_variable("space", "integer", 4)
        self.ds.add_theme("base", overrides={"c.bg": "#f5f5f5", "space": 8})
        self.ds.add_theme("dark", parent="base", overrides={"c.bg": "#111111"})
        self.ds.add_theme("amoled", parent="dark", overrides={"c.bg": "#000000"})
        self.ds.add_theme("solarized", parent="base")

    def test_resolve_reports_value_and_source(self):
        r = self.ds.resolve("amoled", "c.bg")
        self.assertEqual(r.value.hex, "#000000")
        self.assertEqual(r.source, "amoled")
        self.assertEqual(r.chain, ("amoled", "dark", "base"))

    def test_inherited_value_source_is_ancestor_not_self(self):
        r = self.ds.resolve("amoled", "space")
        self.assertEqual(r.value, 8)
        self.assertEqual(r.source, "base")

    def test_default_source_is_none(self):
        r = self.ds.resolve("solarized", "c.bg")
        self.assertEqual(r.source, "base")
        # 新增一个没有任何覆盖的变量，来源应为默认值
        self.ds.add_variable("new", "string", "dflt")
        r2 = self.ds.resolve("solarized", "new")
        self.assertIsNone(r2.source)
        self.assertTrue(r2.used_default)
        self.assertEqual(r2.value, "dflt")

    def test_override_themes_stable_sorted(self):
        self.assertEqual(
            self.ds.override_themes("c.bg"),
            ("amoled", "base", "dark"),
        )
        self.assertEqual(self.ds.override_themes("space"), ("base",))

    def test_query_unknown_theme_or_variable(self):
        with self.assertRaises(ThemeNotFoundError):
            self.ds.resolve("ghost", "c.bg")
        with self.assertRaises(VariableNotFoundError):
            self.ds.resolve("dark", "ghost")
        with self.assertRaises(VariableNotFoundError):
            self.ds.override_themes("ghost")

    def test_theme_overrides_returns_sorted_copy(self):
        ov = self.ds.theme_overrides("base")
        self.assertEqual(list(ov), ["c.bg", "space"])
        ov["c.bg"] = "tampered"
        # 副本改动不影响内部状态
        self.assertEqual(
            self.ds.resolve("base", "c.bg").value.hex, "#f5f5f5"
        )

    def test_resolve_all_sorted_and_complete(self):
        resolved = self.ds.resolve_all("dark")
        self.assertEqual(list(resolved), ["c.bg", "space"])
        self.assertEqual(resolved["c.bg"].value.hex, "#111111")

    def test_stable_order_repeated_calls(self):
        first = [
            (t, v) for t in self.ds.theme_names for v in self.ds.variable_ids
        ]
        second = [
            (t, v) for t in self.ds.theme_names for v in self.ds.variable_ids
        ]
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
