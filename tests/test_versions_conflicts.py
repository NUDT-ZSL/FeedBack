"""需求 4 & 6：替代版本的确定性挑选、平局字典序、矛盾选择双方保留与冲突记录。"""

import unittest

from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot


def U(unit_id, unit_type="scene", body="正文", version=1, prerequisites=(), group=None):
    return MaterialUnit(
        unit_id, unit_type, body, version=version,
        prerequisites=frozenset(prerequisites), group=group,
    )


def goal_two_slots(g="g"):
    return NarrativeGoal(
        g, "aud", [Slot("s1", "scene"), Slot("s2", "scene")]
    )


class TestVersionSelection(unittest.TestCase):
    def setUp(self):
        self.c = Composer()
        # 同一素材 duel 的三个替代版本，分属不同 id、同 group
        self.c.register_unit(U("duel-a", "scene", "初版", version=1, group="duel"))
        self.c.register_unit(U("duel-b", "scene", "重剪版", version=2, group="duel"))
        self.c.register_unit(U("duel-c", "scene", "同分B", version=2, group="duel"))
        self.c.register_goal(goal_two_slots())

    def test_highest_version_wins(self):
        self.c.fill_slot("g", "s1", "duel-a", source="editor")
        self.c.fill_slot("g", "s1", "duel-b", source="reviewer")
        r = self.c.get_slot_resolution("g", "s1")
        self.assertIsNone(r.conflict)
        self.assertEqual(r.chosen.unit_id, "duel-b")
        self.assertEqual(r.chosen.version, 2)
        # 两个来源都记为一致来源（按字典序）
        self.assertEqual(r.sources, ("editor", "reviewer"))

    def test_tie_broken_by_id_lexicographic(self):
        # 版本相同（同分）时按单元 id 字典序：duel-b < duel-c
        self.c.fill_slot("g", "s1", "duel-c", source="editor")
        self.c.fill_slot("g", "s1", "duel-b", source="reviewer")
        r = self.c.get_slot_resolution("g", "s1")
        self.assertEqual(r.chosen.unit_id, "duel-b")

    def test_deterministic_regardless_of_order(self):
        # 单元→来源的映射固定，只改变填入顺序；最终序列（含来源集合）必须一致
        src_of = {"duel-a": "s-a", "duel-b": "s-b", "duel-c": "s-c"}
        orders = [
            ["duel-c", "duel-a", "duel-b"],
            ["duel-b", "duel-c", "duel-a"],
            ["duel-a", "duel-c", "duel-b"],
        ]
        results = set()
        for order in orders:
            c = Composer()
            c.register_unit(U("duel-a", version=1, group="duel"))
            c.register_unit(U("duel-b", version=2, group="duel"))
            c.register_unit(U("duel-c", version=2, group="duel"))
            c.register_goal(goal_two_slots())
            for uid in order:
                c.fill_slot("g", "s1", uid, source=src_of[uid])
            seq = c.get_sequence("g")
            results.add(
                tuple((e.unit_id, e.version, e.sources) for e in seq.entries)
            )
        # 三种填入顺序产出完全相同的序列（含相同来源集合）
        self.assertEqual(len(results), 1)
        only = next(iter(results))
        self.assertEqual(only[0][0], "duel-b")  # 入选版本不受填入顺序影响

    def test_auto_fill_deterministic_and_repeatable(self):
        c = Composer()
        c.register_unit(U("a1", "scene", version=1, group="a"))
        c.register_unit(U("a2", "scene", version=3, group="a"))
        c.register_unit(U("a9", "scene", version=3, group="a"))  # 与 a2 同分
        c.register_goal(NarrativeGoal("g", "aud", [Slot("s1", "scene")]))
        first = [c.auto_fill("g")]
        seq1 = c.get_sequence("g")
        # 重复组合结果完全一致
        c.recompose_all()
        seq2 = c.get_sequence("g")
        self.assertEqual(seq1.entries, seq2.entries)
        self.assertEqual(seq1.material_ids(), ("a2",))  # 同分 id 字典序

    def test_auto_fill_respects_prerequisites_and_order(self):
        c = Composer()
        c.register_unit(U("setup1", "scene", version=1, group="setup"))
        c.register_unit(U("setup2", "scene", version=2, group="setup"))
        c.register_unit(
            U("end1", "scene", version=1, group="end", prerequisites=["setup2"])
        )
        c.register_unit(
            U("end2", "scene", version=5, group="end", prerequisites=["setup2"])
        )
        c.register_goal(
            NarrativeGoal("g", "aud", [Slot("p", "scene"), Slot("q", "scene")])
        )
        c.auto_fill("g")
        self.assertEqual(c.get_sequence("g").material_ids(), ("setup2", "end2"))

    def test_auto_fill_skips_when_prereq_unsatisfiable(self):
        c = Composer()
        c.register_unit(U("lone", "scene"))  # 无依赖，s1 可用
        # base 是 dialogue 类型，在本目标里没有对应槽位，永远放不进去，
        # 因此 needs_base 的前置依赖无法满足，应被跳过而非报错
        c.register_unit(U("base", "dialogue"))
        c.register_unit(U("needs_base", "scene", prerequisites=["base"]))
        c.register_goal(
            NarrativeGoal("g", "aud",
                          [Slot("s1", "scene"), Slot("s2", "ending")])
        )
        c.auto_fill("g")
        # needs_base 不入选 s1；s2 是 ending 类型、没有候选，保持为空
        self.assertEqual(c.get_sequence("g").material_ids(), ("lone",))


class TestCrossSourceConflict(unittest.TestCase):
    def setUp(self):
        self.c = Composer()
        self.c.register_unit(U("ice", "scene", "冰原结局", group="ice"))
        self.c.register_unit(U("fire", "scene", "火山结局", group="fire"))
        self.c.register_unit(U("ice2", "scene", "冰原结局 v2", version=2, group="ice"))
        self.c.register_goal(goal_two_slots())

    def test_conflicting_sources_both_kept_and_recorded(self):
        self.c.fill_slot("g", "s1", "ice", source="writer")
        self.c.fill_slot("g", "s1", "fire", source="producer")
        r = self.c.get_slot_resolution("g", "s1")
        # 双方都保留
        self.assertIsNone(r.chosen)
        self.assertTrue(r.is_conflicted)
        choice_ids = {c.unit_id for c in r.choices}
        self.assertEqual(choice_ids, {"ice", "fire"})
        choice_sources = {c.source for c in r.choices}
        self.assertEqual(choice_sources, {"writer", "producer"})

        conflicts = self.c.conflicts("g")
        self.assertEqual(len(conflicts), 1)
        rec = conflicts[0]
        self.assertEqual((rec.goal_id, rec.slot_id), ("g", "s1"))
        text = rec.render()
        self.assertIn("g", text)
        self.assertIn("s1", text)
        self.assertIn("writer", text)
        self.assertIn("producer", text)
        self.assertIn("ice", text)
        self.assertIn("fire", text)
        # 序列在冲突槽位不静默择一：unit_id 为 None
        seq = self.c.get_sequence("g")
        self.assertIsNone(seq.entries[0].unit_id)
        # 必填槽位处于未解决状态
        self.assertIn("s1", self.c.unfilled_required("g"))

    def test_third_source_with_new_version_joins_conflict(self):
        self.c.fill_slot("g", "s1", "ice", source="writer")
        self.c.fill_slot("g", "s1", "fire", source="producer")
        self.c.fill_slot("g", "s1", "ice2", source="editor")
        rec = self.c.conflicts("g")[0]
        # 三方选择全部保留，不丢任何一方
        self.assertEqual({c.unit_id for c in rec.choices}, {"ice", "fire", "ice2"})

    def test_same_group_different_versions_is_not_conflict(self):
        self.c.fill_slot("g", "s1", "ice", source="writer")
        self.c.fill_slot("g", "s1", "ice2", source="producer")
        self.assertEqual(self.c.conflicts(), [])
        r = self.c.get_slot_resolution("g", "s1")
        self.assertEqual(r.chosen.unit_id, "ice2")

    def test_slot_sources_lists_all(self):
        self.c.fill_slot("g", "s1", "ice", source="writer")
        self.c.fill_slot("g", "s1", "fire", source="producer")
        self.assertEqual(
            self.c.slot_sources("g", "s1"),
            (("producer", "fire", 1), ("writer", "ice", 1)),
        )

    def test_conflicts_order_stable(self):
        c = Composer()
        c.register_unit(U("x", "scene", group="x"))
        c.register_unit(U("y", "scene", group="y"))
        c.register_goal(
            NarrativeGoal("gz", "aud",
                          [Slot("a", "scene"), Slot("b", "scene")])
        )
        c.register_goal(
            NarrativeGoal("ga", "aud",
                          [Slot("a", "scene"), Slot("b", "scene")])
        )
        c.fill_slot("gz", "b", "x", "s1")
        c.fill_slot("gz", "b", "y", "s2")
        c.fill_slot("ga", "a", "x", "s1")
        c.fill_slot("ga", "a", "y", "s2")
        order = [(r.goal_id, r.slot_id) for r in c.conflicts()]
        self.assertEqual(order, [("ga", "a"), ("gz", "b")])


if __name__ == "__main__":
    unittest.main()
