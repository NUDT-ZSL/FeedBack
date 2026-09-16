"""需求 2 & 3：叙事目标/槽位配置校验，素材填入时的类型与前置依赖校验。"""

import unittest

from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot
from story_composer.errors import (
    DanglingReferenceError,
    SlotConflictError,
    SlotFillError,
    UnknownGoalError,
    ValidationError,
)


def U(unit_id, unit_type="scene", body="正文", version=1, prerequisites=(), group=None):
    return MaterialUnit(
        unit_id, unit_type, body, version=version,
        prerequisites=frozenset(prerequisites), group=group,
    )


class TestGoalConfig(unittest.TestCase):
    def test_illegal_configs(self):
        with self.assertRaises(ValueError):
            NarrativeGoal("", "aud", [Slot("s", "scene")])
        with self.assertRaises(ValueError):
            NarrativeGoal("g", "", [Slot("s", "scene")])
        with self.assertRaises(ValueError):
            NarrativeGoal("g", "aud", [])  # 没有槽位
        with self.assertRaises(ValueError):
            NarrativeGoal("g", "aud", ["not-a-slot"])  # type: ignore[list-item]
        with self.assertRaises(ValueError):
            Slot("", "scene")
        with self.assertRaises(ValueError):
            Slot("s", "")
        with self.assertRaises(ValueError):
            Slot("s", "scene", required="yes")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            NarrativeGoal(
                "g", "aud", [Slot("s", "scene"), Slot("s", "dialogue")]
            )  # 槽位 id 重复

    def test_register_and_unknown(self):
        c = Composer()
        with self.assertRaises(UnknownGoalError):
            c.get_sequence("nope")
        g = NarrativeGoal("g", "aud", [Slot("s", "scene", required=False)])
        c.register_goal(g)
        self.assertEqual([x.goal_id for x in c.all_goals()], ["g"])
        # 非必填槽位允许为空，不算未满足
        self.assertEqual(c.unfilled_required("g"), [])

    def test_required_unfilled(self):
        c = Composer()
        c.register_goal(NarrativeGoal("g", "aud", [Slot("s", "scene")]))
        self.assertEqual(c.unfilled_required("g"), ["s"])

    def test_reregister_change_type_rejected_when_filled(self):
        c = Composer()
        c.register_unit(U("a", "scene"))
        c.register_goal(NarrativeGoal("g", "aud", [Slot("s", "scene")]))
        c.fill_slot("g", "s", "a")
        with self.assertRaises(ValidationError):
            c.register_goal(
                NarrativeGoal("g", "aud", [Slot("s", "dialogue")])
            )
        # 未被引用的新目标类型错误
        with self.assertRaises(ValidationError):
            c.register_goal("nope")  # type: ignore[arg-type]

    def test_reregister_reorder_slots(self):
        c = Composer()
        c.register_unit(U("a", "scene"))
        c.register_unit(U("b", "scene", prerequisites=["a"]))
        c.register_goal(
            NarrativeGoal(
                "g", "aud",
                [Slot("s1", "scene"), Slot("s2", "scene")],
            )
        )
        c.fill_slot("g", "s1", "a")
        c.fill_slot("g", "s2", "b")
        # 交换槽位顺序后，b 的前置依赖在新位置之前不再满足 -> 拒绝改写
        with self.assertRaises(SlotFillError) as cm:
            c.register_goal(
                NarrativeGoal(
                    "g", "aud",
                    [Slot("s2", "scene"), Slot("s1", "scene")],
                )
            )
        self.assertEqual(cm.exception.missing_dependency, "a")
        # 合法重排（a 仍在 b 之前，只是在后面追加空槽位）
        c.register_goal(
            NarrativeGoal(
                "g", "aud",
                [Slot("s1", "scene"), Slot("s2", "scene"),
                 Slot("s3", "note", required=False)],
            )
        )
        self.assertEqual(c.get_sequence("g").material_ids(), ("a", "b"))


class TestFillSlot(unittest.TestCase):
    def setUp(self):
        self.c = Composer()
        self.c.register_unit(U("a", "scene"))
        self.c.register_unit(U("b", "dialogue"))
        self.c.register_unit(U("c", "scene", prerequisites=["a"]))
        self.c.register_goal(
            NarrativeGoal(
                "g", "新观众",
                [Slot("s1", "scene"), Slot("s2", "dialogue"),
                 Slot("s3", "scene")],
            )
        )

    def test_type_mismatch_rejected(self):
        with self.assertRaises(SlotFillError) as cm:
            self.c.fill_slot("g", "s2", "a")  # scene 塞进 dialogue 槽
        err = cm.exception
        self.assertEqual(err.goal_id, "g")
        self.assertEqual(err.slot_id, "s2")
        self.assertEqual(err.unit_id, "a")
        self.assertIsNone(err.missing_dependency)
        self.assertIn("dialogue", str(err))

    def test_missing_prerequisite_rejected_with_detail(self):
        # 直接往 s3 填 c，但 a 还没有出现在更早槽位
        with self.assertRaises(SlotFillError) as cm:
            self.c.fill_slot("g", "s3", "c")
        err = cm.exception
        self.assertEqual(err.goal_id, "g")
        self.assertEqual(err.slot_id, "s3")
        self.assertEqual(err.unit_id, "c")
        self.assertEqual(err.missing_dependency, "a")
        self.assertIn("a", str(err))

    def test_prereq_must_be_earlier_not_later(self):
        # a 放到 s3 不能让更前面的 c 合法
        self.c.fill_slot("g", "s3", "a")
        with self.assertRaises(SlotFillError):
            self.c.fill_slot("g", "s1", "c")  # 依赖 a 出现在更后槽位

    def test_dangling_unit_reference(self):
        with self.assertRaises(DanglingReferenceError) as cm:
            self.c.fill_slot("g", "s1", "ghost")
        self.assertEqual(cm.exception.dependency, "ghost")
        self.assertEqual(cm.exception.slot_id, "s1")

    def test_unknown_slot(self):
        with self.assertRaises(ValidationError) as cm:
            self.c.fill_slot("g", "nope", "a")
        self.assertEqual(cm.exception.slot_id, "nope")

    def test_happy_path_and_sequence(self):
        self.c.fill_slot("g", "s1", "a", source="editor")
        self.c.fill_slot("g", "s3", "c", source="editor")
        seq = self.c.get_sequence("g")
        self.assertEqual(seq.material_ids(), ("a", "c"))
        e1 = seq.entries[0]
        self.assertEqual((e1.unit_id, e1.version, e1.sources), ("a", 1, ("editor",)))
        # 依赖也可由同组替代版本满足（group 语义）
        self.c.register_unit(U("a2", "scene", "重拍版", version=2, group="a"))
        self.c.fill_slot("g", "s1", "a2", source="reviewer")
        r = self.c.get_slot_resolution("g", "s1")
        self.assertEqual(r.chosen.unit_id, "a2")  # 新版本胜出
        self.c.fill_slot("g", "s3", "c", source="editor")  # 幂等

    def test_same_source_different_unit_hard_conflict_rejected(self):
        self.c.fill_slot("g", "s1", "a", source="editor")
        # 同槽位另一类型无关单元；先用一个 scene 单元 z
        self.c.register_unit(U("z", "scene"))
        with self.assertRaises(SlotConflictError) as cm:
            self.c.fill_slot("g", "s1", "z", source="editor")
        err = cm.exception
        self.assertEqual(err.existing_unit_id, "a")
        self.assertEqual(err.incoming_unit_id, "z")
        self.assertEqual(err.source, "editor")
        # 拒绝后状态不变
        self.assertEqual(self.c.get_sequence("g").material_ids(), ("a",))

    def test_fill_same_unit_idempotent(self):
        self.c.fill_slot("g", "s1", "a", source="editor")
        self.c.fill_slot("g", "s1", "a", source="editor")
        self.assertEqual(self.c.slot_sources("g", "s1"), (("editor", "a", 1),))


if __name__ == "__main__":
    unittest.main()
