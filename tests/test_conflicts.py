"""需求 5：继承链上互相矛盾的取值必须双方保留并生成可读冲突记录。"""

import unittest

from themeoracle import DesignSystem
from themeoracle.valuetypes import Color


class ConflictTest(unittest.TestCase):
    def setUp(self):
        self.ds = DesignSystem()
        self.ds.add_variable("c.primary", "color", "#888888")
        self.ds.add_variable("radius", "length", "4px")
        self.ds.add_theme("root", overrides={"c.primary": "#ffffff"})
        self.ds.add_theme("mid", parent="root",
                          overrides={"c.primary": "#000000"})
        self.ds.add_theme("leaf", parent="mid",
                          overrides={"c.primary": "#000000"})  # 与 mid 相同，不算冲突
        self.ds.add_theme("side", parent="root",
                          overrides={"radius": "8px"})

    def test_conflict_keeps_both_values(self):
        records = self.ds.conflicts("mid", "c.primary")
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec.variable_id, "c.primary")
        self.assertEqual(rec.theme_name, "mid")
        # 两个主题都在，取值都保留，顺序为链上就近到远
        self.assertEqual(rec.themes, ["mid", "root"])
        self.assertEqual(rec.values[0], Color("#000000"))
        self.assertEqual(rec.values[1], Color("#ffffff"))

    def test_effective_value_still_nearest_but_other_retained(self):
        r = self.ds.resolve("mid", "c.primary")
        self.assertEqual(r.value, Color("#000000"))
        rec = self.ds.conflicts("mid", "c.primary")[0]
        # 被遮蔽的 root 取值仍可从冲突记录中取到
        self.assertEqual(rec.assignments[1], ("root", Color("#ffffff")))

    def test_identical_override_down_chain_is_not_conflict(self):
        # leaf 与 mid 取值相同；链上虽然有三处覆盖但只有两种值 => 有冲突
        # （root 不同），且记录里三个主题都保留
        records = self.ds.conflicts("leaf", "c.primary")
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].themes, ["leaf", "mid", "root"])
        distinct = {v for _, v in records[0].assignments}
        self.assertEqual(len(distinct), 2)

    def test_no_conflict_when_chain_agrees_or_silent(self):
        self.assertEqual(self.ds.conflicts("side", "c.primary"), [])
        self.assertEqual(self.ds.conflicts("root", "c.primary"), [])
        self.assertEqual(self.ds.conflicts("side", "radius"), [])

    def test_conflict_visible_from_descendant_perspective(self):
        # leaf 视角同样能看到 mid/root 的矛盾
        records = self.ds.conflicts("leaf", "c.primary")
        self.assertEqual(len(records), 1)
        self.assertIn("leaf", records[0].describe())

    def test_all_conflicts_stable_order(self):
        self.ds.add_variable("a", "string", "x")
        self.ds.set_override("root", "a", "ROOT")
        self.ds.set_override("mid", "a", "MID")
        records = self.ds.conflicts()
        # 按主题拓扑序、变量标识排序：mid 的两个冲突在前（c < r? a < c）
        keys = [(r.theme_name, r.variable_id) for r in records]
        self.assertEqual(keys, sorted(keys, key=lambda k: (
            self.ds.themes_in_topo_order().index(k[0]), k[1]
        )))
        # mid 与 leaf 视角各自出现
        perspectives = {r.theme_name for r in records}
        self.assertIn("mid", perspectives)
        self.assertIn("leaf", perspectives)
        self.assertNotIn("side", perspectives)

    def test_readable_describe_mentions_variable_themes_values(self):
        text = self.ds.conflicts("mid", "c.primary")[0].describe()
        for token in ("c.primary", "mid", "root", "#000000", "#ffffff"):
            self.assertIn(token, text)

    def test_to_dict_roundtrip_shape(self):
        rec = self.ds.conflicts("mid", "c.primary")[0]
        d = rec.to_dict(self.ds.get_variable("c.primary")._type)
        self.assertEqual(d["variable_id"], "c.primary")
        self.assertEqual(d["assignments"][0]["theme"], "mid")
        self.assertEqual(d["assignments"][0]["value"], "#000000")
        self.assertEqual(d["assignments"][1]["value"], "#ffffff")

    def test_conflict_resolves_after_removing_one_side(self):
        self.ds.remove_override("mid", "c.primary")
        # leaf=#000000 vs root=#ffffff 仍冲突；mid 已退出
        rec = self.ds.conflicts("leaf", "c.primary")[0]
        self.assertEqual(rec.themes, ["leaf", "root"])
        self.ds.remove_override("leaf", "c.primary")
        self.assertEqual(self.ds.conflicts("leaf", "c.primary"), [])
        # 无冲突后取值沿链回落到 root
        self.assertEqual(
            self.ds.resolve("leaf", "c.primary").value, Color("#ffffff")
        )


if __name__ == "__main__":
    unittest.main()
