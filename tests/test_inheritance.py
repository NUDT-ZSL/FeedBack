"""需求 2：主题登记、继承链、未知父主题（含链条）与成环拒绝。"""

import unittest

from themeoracle import (
    DesignSystem,
    DuplicateThemeError,
    ParentThemeNotFoundError,
    InheritanceCycleError,
    InvalidValueError,
    VariableNotFoundError,
)


class ThemeAndInheritanceTest(unittest.TestCase):
    def setUp(self):
        self.ds = DesignSystem()
        self.ds.add_variable("c", "color", "#000000")

    def test_add_theme_and_duplicate(self):
        self.ds.add_theme("base")
        with self.assertRaises(DuplicateThemeError) as ctx:
            self.ds.add_theme("base")
        self.assertEqual(ctx.exception.theme_name, "base")
        self.assertIn("themes[", ctx.exception.location)

    def test_unknown_parent_rejected_with_chain(self):
        with self.assertRaises(ParentThemeNotFoundError) as ctx:
            self.ds.add_theme("child", parent="ghost")
        err = ctx.exception
        self.assertEqual(err.theme_name, "child")
        self.assertEqual(err.missing_parent, "ghost")
        self.assertEqual(err.chain, ["child", "ghost"])
        self.assertIn("child -> ghost", str(err))
        self.assertNotIn("child", self.ds.theme_names)

    def test_unknown_grandparent_chain_on_load_style(self):
        # 模拟载入场景：a 父 b，b 父缺失的 c —— 链条应完整给出
        from themeoracle.model import Theme

        themes = {
            "a": Theme("a", "b"),
            "b": Theme("b", "c"),
        }
        variables = {"c": self.ds.get_variable("c")}
        from themeoracle.persistence import _validate_parent_relations

        with self.assertRaises(ParentThemeNotFoundError) as ctx:
            _validate_parent_relations(themes)
        self.assertEqual(ctx.exception.chain, ["a", "b", "c"])

    def test_inheritance_chain_walk(self):
        self.ds.add_theme("root")
        self.ds.add_theme("mid", parent="root")
        self.ds.add_theme("leaf", parent="mid")
        self.assertEqual(
            self.ds.inheritance_chain("leaf"), ("leaf", "mid", "root")
        )
        self.assertEqual(self.ds.inheritance_chain("root"), ("root",))

    def test_set_parent_cycle_rejected(self):
        self.ds.add_theme("a")
        self.ds.add_theme("b", parent="a")
        self.ds.add_theme("c", parent="b")
        with self.assertRaises(InheritanceCycleError) as ctx:
            self.ds.set_parent("a", "c")
        chain = ctx.exception.chain
        self.assertEqual(chain[0], "a")
        self.assertEqual(chain[-1], "a")
        self.assertIn("c", chain)
        # 拒绝后继承关系不变
        self.assertIsNone(self.ds.get_theme("a").parent)
        self.assertEqual(self.ds.get_theme("b").parent, "a")

    def test_self_parent_rejected(self):
        self.ds.add_theme("solo")
        with self.assertRaises(InheritanceCycleError):
            self.ds.set_parent("solo", "solo")

    def test_set_parent_unknown_parent_keeps_state(self):
        self.ds.add_theme("a")
        with self.assertRaises(ParentThemeNotFoundError):
            self.ds.set_parent("a", "nope")
        self.assertIsNone(self.ds.get_theme("a").parent)

    def test_descendants_stable_sorted(self):
        self.ds.add_theme("root")
        self.ds.add_theme("mid1", parent="root")
        self.ds.add_theme("mid2", parent="root")
        self.ds.add_theme("leaf", parent="mid1")
        # 结果包含自身与全部子孙，按名称稳定排序
        self.assertEqual(
            self.ds.descendants("root"), ("leaf", "mid1", "mid2", "root")
        )
        self.assertEqual(self.ds.descendants("mid2"), ("mid2",))
        self.assertEqual(self.ds.descendants("leaf"), ("leaf",))

    def test_topo_order_parents_first(self):
        self.ds.add_theme("root")
        self.ds.add_theme("z-child", parent="root")
        self.ds.add_theme("a-child", parent="root")
        self.ds.add_theme("deep", parent="z-child")
        order = self.ds.themes_in_topo_order()
        self.assertLess(order.index("root"), order.index("z-child"))
        self.assertLess(order.index("z-child"), order.index("deep"))
        self.assertLess(order.index("a-child"), order.index("deep") + 1)
        self.assertEqual(order[0], "root")
        # 同父下按名称排序
        self.assertLess(order.index("a-child"), order.index("z-child"))

    def test_override_unknown_variable_rejected_with_location(self):
        self.ds.add_theme("t")
        with self.assertRaises(VariableNotFoundError) as ctx:
            self.ds.add_theme("u", parent="t", overrides={"nope": "#fff"})
        self.assertEqual(ctx.exception.variable_id, "nope")
        self.assertIn("u", ctx.exception.location)
        self.assertNotIn("u", self.ds.theme_names)

    def test_override_bad_type_rejected_with_location(self):
        self.ds.add_theme("t")
        with self.assertRaises(InvalidValueError) as ctx:
            self.ds.set_override("t", "c", 12345)
        self.assertEqual(ctx.exception.variable_id, "c")
        self.assertIn("overrides", ctx.exception.location)
        self.assertNotIn("c", self.ds.get_theme("t").overrides)

    def test_set_parent_then_chain_cache_refreshes(self):
        self.ds.add_theme("a")
        self.ds.add_theme("b")
        self.ds.add_theme("c", parent="b")
        self.assertEqual(self.ds.inheritance_chain("c"), ("c", "b"))
        self.ds.set_parent("b", "a")
        self.assertEqual(self.ds.inheritance_chain("c"), ("c", "b", "a"))


if __name__ == "__main__":
    unittest.main()
