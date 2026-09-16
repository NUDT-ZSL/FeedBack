"""需求 3：逐层继承解析，与手工推导一致。"""

import unittest

from themeoracle import DesignSystem


def build_system():
    """构造一棵三层树 + 一个旁支：

        root          覆盖 c.a=#111111, c.b=#222222
        ├─ light      覆盖 c.a=#aaaaaa
        │  └─ soft    覆盖 c.c=#cccccc
        └─ dark       覆盖 c.a=#000000, c.b=#222222
           └─ amoled  （无覆盖）

    变量：c.a / c.b / c.c（color），c.d 默认 #dddddd 无人覆盖
    """
    ds = DesignSystem()
    ds.add_variable("c.a", "color", "#eeeeee")
    ds.add_variable("c.b", "color", "#eeeeee")
    ds.add_variable("c.c", "color", "#eeeeee")
    ds.add_variable("c.d", "color", "#dddddd")
    ds.add_theme("root", overrides={"c.a": "#111111", "c.b": "#222222"})
    ds.add_theme("light", parent="root", overrides={"c.a": "#aaaaaa"})
    ds.add_theme("soft", parent="light", overrides={"c.c": "#cccccc"})
    ds.add_theme("dark", parent="root",
                 overrides={"c.a": "#000000", "c.b": "#222222"})
    ds.add_theme("amoled", parent="dark")
    return ds


class ResolutionTest(unittest.TestCase):
    def setUp(self):
        self.ds = build_system()

    def test_self_override_wins(self):
        r = self.ds.resolve("light", "c.a")
        self.assertEqual(r.value.hex, "#aaaaaa")
        self.assertEqual(r.source, "light")
        self.assertFalse(r.used_default)

    def test_walk_up_to_parent(self):
        r = self.ds.resolve("light", "c.b")
        self.assertEqual(r.value.hex, "#222222")
        self.assertEqual(r.source, "root")

    def test_walk_up_two_levels(self):
        r = self.ds.resolve("soft", "c.b")
        self.assertEqual(r.value.hex, "#222222")
        self.assertEqual(r.source, "root")
        self.assertEqual(r.chain, ("soft", "light", "root"))

    def test_nearer_ancestor_shadows_farther(self):
        r = self.ds.resolve("soft", "c.a")
        self.assertEqual(r.value.hex, "#aaaaaa")
        self.assertEqual(r.source, "light")

    def test_sibling_branch_isolation(self):
        # dark 支不应看到 light 的覆盖
        r = self.ds.resolve("amoled", "c.a")
        self.assertEqual(r.value.hex, "#000000")
        self.assertEqual(r.source, "dark")
        r2 = self.ds.resolve("amoled", "c.b")
        self.assertEqual(r2.value.hex, "#222222")
        self.assertEqual(r2.source, "dark")  # 就近的 dark，而非 root

    def test_fallback_to_variable_default(self):
        r = self.ds.resolve("root", "c.d")
        self.assertTrue(r.used_default)
        self.assertIsNone(r.source)
        self.assertEqual(r.value.hex, "#dddddd")

    def test_resolve_all_matches_individual_resolve(self):
        for theme in self.ds.theme_names:
            everything = self.ds.resolve_all(theme)
            for vid in self.ds.variable_ids:
                one = self.ds.resolve(theme, vid)
                self.assertEqual(everything[vid].value, one.value)
                self.assertEqual(everything[vid].source, one.source)
                self.assertEqual(everything[vid].used_default, one.used_default)
            self.assertEqual(list(everything), list(self.ds.variable_ids))

    def test_manual_layer_by_layer_derivation(self):
        """把逐层手工推导的期望表与系统解析结果逐格对比。"""
        expected = {
            "root":   {"c.a": ("#111111", "root"),
                       "c.b": ("#222222", "root"),
                       "c.c": ("#eeeeee", None),
                       "c.d": ("#dddddd", None)},
            "light":  {"c.a": ("#aaaaaa", "light"),
                       "c.b": ("#222222", "root"),
                       "c.c": ("#eeeeee", None),
                       "c.d": ("#dddddd", None)},
            "soft":   {"c.a": ("#aaaaaa", "light"),
                       "c.b": ("#222222", "root"),
                       "c.c": ("#cccccc", "soft"),
                       "c.d": ("#dddddd", None)},
            "dark":   {"c.a": ("#000000", "dark"),
                       "c.b": ("#222222", "dark"),
                       "c.c": ("#eeeeee", None),
                       "c.d": ("#dddddd", None)},
            "amoled": {"c.a": ("#000000", "dark"),
                       "c.b": ("#222222", "dark"),
                       "c.c": ("#eeeeee", None),
                       "c.d": ("#dddddd", None)},
        }
        for theme, vars_ in expected.items():
            for vid, (hex_value, source) in vars_.items():
                r = self.ds.resolve(theme, vid)
                self.assertEqual(r.value.hex, hex_value, f"{theme}/{vid}")
                self.assertEqual(r.source, source, f"{theme}/{vid}")

    def test_override_themes_lists_covering_themes(self):
        self.assertEqual(
            self.ds.override_themes("c.a"),
            ("dark", "light", "root"),
        )
        self.assertEqual(self.ds.override_themes("c.c"), ("soft",))
        self.assertEqual(self.ds.override_themes("c.d"), ())

    def test_change_parent_changes_resolution(self):
        # 把 soft 从 light 改挂到 dark：c.a 来源随之改变
        self.ds.set_parent("soft", "dark")
        r = self.ds.resolve("soft", "c.a")
        self.assertEqual(r.value.hex, "#000000")
        self.assertEqual(r.source, "dark")
        # 自身覆盖仍生效
        self.assertEqual(self.ds.resolve("soft", "c.c").source, "soft")

    def test_new_theme_after_variables_resolves_defaults(self):
        self.ds.add_theme("fresh")
        r = self.ds.resolve("fresh", "c.a")
        self.assertTrue(r.used_default)
        self.assertEqual(r.value.hex, "#eeeeee")


if __name__ == "__main__":
    unittest.main()
