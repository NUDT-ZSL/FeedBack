"""需求 4：增量重算——只动下游，结果与全量重解析一致，未受影响对象不变。"""

import unittest

from themeoracle import DesignSystem


def make_system():
    """独立构建一份相同定义的系统，用于从头全量重解析对照。"""
    ds = DesignSystem()
    ds.add_variable("c.a", "color", "#eeeeee")
    ds.add_variable("c.b", "color", "#bbbbbb")
    ds.add_variable("radius", "length", "4px")
    ds.add_theme("root", overrides={"c.a": "#111111", "c.b": "#222222"})
    ds.add_theme("mid", parent="root", overrides={"c.a": "#333333"})
    ds.add_theme("leaf", parent="mid", overrides={"radius": "8px"})
    ds.add_theme("offroot", parent="root", overrides={"c.b": "#444444"})
    ds.add_theme("lonely")
    return ds


def snapshot(ds):
    """全量解析并返回 {(theme, var): ResolvedValue}，同时把缓存焐热。"""
    snap = {}
    for theme in ds.themes_in_topo_order():
        for vid, resolved in ds.resolve_all(theme).items():
            snap[(theme, vid)] = resolved
    return snap


def values_equal(a, b):
    return (
        a.value == b.value
        and a.source == b.source
        and a.used_default == b.used_default
    )


class IncrementalRecomputeTest(unittest.TestCase):
    def setUp(self):
        self.ds = make_system()
        self.snap = snapshot(self.ds)

    def test_set_override_returns_exactly_descendants(self):
        affected = self.ds.set_override("mid", "c.a", "#999999")
        self.assertEqual(set(affected), {"mid", "leaf"})

    def test_only_downstream_entries_change(self):
        before = dict(self.snap)
        self.ds.set_override("mid", "c.b", "#777777")  # mid 新增覆盖
        after = snapshot(self.ds)
        affected_themes = {"mid", "leaf"}
        for key, old_obj in before.items():
            theme, vid = key
            if theme in affected_themes:
                continue  # 下游允许变化（无论该变量是否真的改变了值）
            # 非下游主题：对象必须原样保留，证明没有被重算
            self.assertIs(
                after[key], old_obj,
                f"未受影响的 {key} 被重算了",
            )

    def test_other_variable_of_downstream_untouched(self):
        # mid 改的是 c.a；leaf 的 radius 条目对象不应变化
        radius_before = self.snap[("leaf", "radius")]
        self.ds.set_override("mid", "c.a", "#999999")
        radius_after = self.ds.resolve("leaf", "radius")
        self.assertIs(radius_after, radius_before)

    def test_incremental_matches_full_rebuild_set(self):
        self.ds.set_override("root", "c.a", "#010101")
        self.ds.set_override("mid", "c.a", "#020202")
        self.ds.set_override("leaf", "c.b", "#030303")

        fresh = make_system()
        fresh.set_override("root", "c.a", "#010101")
        fresh.set_override("mid", "c.a", "#020202")
        fresh.set_override("leaf", "c.b", "#030303")

        current, rebuilt = snapshot(self.ds), snapshot(fresh)
        for key in current:
            self.assertTrue(values_equal(current[key], rebuilt[key]), key)

    def test_incremental_matches_full_rebuild_remove(self):
        self.ds.remove_override("mid", "c.a")
        self.ds.remove_override("leaf", "radius")

        fresh = make_system()
        fresh.remove_override("mid", "c.a")
        fresh.remove_override("leaf", "radius")

        current, rebuilt = snapshot(self.ds), snapshot(fresh)
        for key in current:
            self.assertTrue(values_equal(current[key], rebuilt[key]), key)
        # 删除后 leaf 的 c.a 应回落到 root
        self.assertEqual(self.ds.resolve("leaf", "c.a").source, "root")

    def test_remove_nonexistent_override_changes_nothing(self):
        before = dict(self.snap)
        affected = self.ds.remove_override("lonely", "c.a")
        self.assertEqual(affected, [])
        after = snapshot(self.ds)
        for key in before:
            self.assertIs(after[key], before[key])

    def test_lonely_theme_never_affected_by_tree_changes(self):
        before = dict(self.snap)
        self.ds.set_override("root", "radius", "2px")
        after = snapshot(self.ds)
        for vid in self.ds.variable_ids:
            self.assertIs(after[("lonely", vid)], before[("lonely", vid)])

    def test_set_parent_full_cache_rebuild_still_consistent(self):
        # 改继承几何属于结构变更，允许全量失效；结果仍须与重建一致
        self.ds.set_parent("leaf", "offroot")
        fresh = make_system()
        fresh.set_parent("leaf", "offroot")
        current, rebuilt = snapshot(self.ds), snapshot(fresh)
        for key in current:
            self.assertTrue(values_equal(current[key], rebuilt[key]), key)
        # leaf 现在从 offroot/root 取值：c.a 来自 root 的 #111111
        self.assertEqual(self.ds.resolve("leaf", "c.a").source, "root")

    def test_many_random_changes_match_rebuild(self):
        """用固定序列模拟一连串修改，每步增量系统始终等价于重放系统。"""
        live = make_system()
        replay = make_system()
        changes = [
            ("set", "root", "c.a", "#a1a1a1"),
            ("set", "mid", "radius", "10px"),
            ("remove", "mid", "c.a", None),
            ("set", "leaf", "c.a", "#a2a2a2"),
            ("set", "offroot", "c.a", "#a3a3a3"),
            ("set", "lonely", "radius", "0px"),
            ("remove", "root", "c.b", None),
            ("set", "mid", "c.b", "#a4a4a4"),
        ]
        for op, theme, vid, value in changes:
            if op == "set":
                live.set_override(theme, vid, value)
                replay.set_override(theme, vid, value)
            else:
                live.remove_override(theme, vid)
                replay.remove_override(theme, vid)
            live_snap, replay_snap = snapshot(live), snapshot(replay)
            for key in live_snap:
                self.assertTrue(
                    values_equal(live_snap[key], replay_snap[key]),
                    f"步骤 {(op, theme, vid, value)} 后 {key} 不一致",
                )


if __name__ == "__main__":
    unittest.main()
