"""需求 7：查询接口 —— 当前素材序列、槽位来源与版本、素材被哪些目标引用、
全部未解决冲突；所有结果按稳定顺序返回。"""

import unittest

from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot


def U(unit_id, unit_type="scene", body="正文", version=1, prerequisites=(), group=None):
    return MaterialUnit(
        unit_id, unit_type, body, version=version,
        prerequisites=frozenset(prerequisites), group=group,
    )


class TestQueries(unittest.TestCase):
    def setUp(self):
        self.c = Composer()
        self.c.register_unit(U("a", "scene"))
        self.c.register_unit(U("a2", "scene", version=2, group="a"))
        self.c.register_unit(U("b", "dialogue", prerequisites=["a"]))
        self.c.register_unit(U("x", "scene", group="x"))
        self.c.register_unit(U("y", "scene", group="y"))
        self.c.register_goal(NarrativeGoal(
            "gz", "aud",
            [Slot("s1", "scene"), Slot("s2", "dialogue"),
             Slot("s3", "scene", required=False)],
        ))
        self.c.register_goal(NarrativeGoal(
            "ga", "aud", [Slot("t1", "scene")]
        ))
        self.c.fill_slot("gz", "s1", "a", source="editor")
        self.c.fill_slot("gz", "s1", "a2", source="reviewer")  # 同组新版本
        self.c.fill_slot("gz", "s2", "b", source="editor")
        self.c.fill_slot("gz", "s3", "x", source="editor")
        self.c.fill_slot("gz", "s3", "y", source="producer")  # 跨组冲突
        self.c.fill_slot("ga", "t1", "a", source="editor")

    def test_sequence_shape_and_order(self):
        seq = self.c.get_sequence("gz")
        self.assertEqual(seq.goal_id, "gz")
        self.assertEqual(seq.audience, "aud")
        positions = [e.position for e in seq.entries]
        self.assertEqual(positions, [0, 1, 2])
        self.assertEqual(
            [(e.slot_id, e.unit_id, e.version) for e in seq.entries],
            [("s1", "a2", 2), ("s2", "b", 1), ("s3", None, None)],
        )
        self.assertEqual(seq.material_ids(), ("a2", "b"))

    def test_slot_sources_and_versions(self):
        self.assertEqual(
            self.c.slot_sources("gz", "s1"),
            (("editor", "a", 1), ("reviewer", "a2", 2)),
        )
        self.assertEqual(
            self.c.slot_sources("gz", "s3"),
            (("editor", "x", 1), ("producer", "y", 1)),
        )

    def test_references_stable_and_effective_flag(self):
        # a v1 在 gz/s1 版本竞争中落败（effective=False），但在 ga/t1 入选
        refs_a = self.c.references("a")
        dicts = [(r.goal_id, r.slot_id, r.source, r.effective) for r in refs_a]
        self.assertEqual(
            dicts,
            [("ga", "t1", "editor", True),
             ("gz", "s1", "editor", False)],
        )
        # a2 只被 gz/s1 引用且入选
        refs_a2 = self.c.references("a2")
        self.assertEqual(len(refs_a2), 1)
        self.assertTrue(refs_a2[0].effective)
        self.assertEqual(refs_a2[0].version, 2)
        # 冲突槽位里的两个选择都不是 effective
        self.assertEqual(
            [(r.unit_id, r.effective) for r in self.c.references("x")],
            [("x", False)],
        )

    def test_referencing_goals_and_referenced_units(self):
        self.assertEqual(self.c.referencing_goals("a"), ["ga", "gz"])
        referenced = dict(self.c.referenced_units())
        self.assertEqual(referenced["a"], ("ga", "gz"))
        self.assertEqual(referenced["a2"], ("gz",))
        # 整体按单元 id 字典序
        self.assertEqual(
            [uid for uid, _ in self.c.referenced_units()],
            ["a", "a2", "b", "x", "y"],
        )

    def test_all_unresolved_conflicts_stable_order(self):
        recs = self.c.conflicts()
        # 当前只有一个冲突；再构造 ga 的冲突，验证跨目标排序
        self.c.fill_slot("ga", "t1", "y", source="producer")
        recs = self.c.conflicts()
        self.assertEqual(
            [(r.goal_id, r.slot_id) for r in recs],
            [("ga", "t1"), ("gz", "s3")],
        )
        # 冲突记录可读，且包含双方来源与素材
        text = recs[1].render()
        for token in ("gz", "s3", "editor", "producer", "x", "y"):
            self.assertIn(token, text)

    def test_conflicts_filtered_by_goal(self):
        recs = self.c.conflicts("ga")
        self.assertEqual(recs, [])
        self.c.fill_slot("ga", "t1", "y", source="producer")
        recs = self.c.conflicts("ga")
        self.assertEqual([(r.goal_id, r.slot_id) for r in recs], [("ga", "t1")])

    def test_query_unknown_raises(self):
        from story_composer.errors import UnknownGoalError, UnknownUnitError
        with self.assertRaises(UnknownGoalError):
            self.c.get_sequence("ghost")
        with self.assertRaises(UnknownUnitError):
            self.c.references("ghost")
        with self.assertRaises(UnknownUnitError):
            self.c.referencing_goals("ghost")

    def test_repeated_queries_are_stable(self):
        first = self.c.get_sequence("gz")
        for _ in range(3):
            again = self.c.get_sequence("gz")
            self.assertEqual(again, first)


if __name__ == "__main__":
    unittest.main()
