"""需求 1：素材单元维护 —— 唯一标识、类型/正文/版本、前置依赖、
悬空引用定位、成环拒绝。"""

import unittest

from story_composer import (
    Composer,
    MaterialUnit,
    NarrativeGoal,
    Slot,
)
from story_composer.errors import (
    CyclicDependencyError,
    DanglingReferenceError,
    DuplicateIdError,
    UnknownUnitError,
    ValidationError,
)


def U(unit_id, unit_type="scene", body="正文", version=1, prerequisites=(), group=None):
    return MaterialUnit(
        unit_id, unit_type, body, version=version,
        prerequisites=frozenset(prerequisites), group=group,
    )


class TestMaterialUnitModel(unittest.TestCase):
    def test_valid_unit(self):
        u = U("a", "scene", "hello")
        self.assertEqual(u.unit_id, "a")
        self.assertEqual(u.version, 1)
        # 未显式给 group 时，group 默认等于 id（无替代版本）
        self.assertEqual(u.group, "a")
        self.assertEqual(u.fingerprint, ("a", 1, "a"))

    def test_illegal_fields(self):
        with self.assertRaises(ValueError):
            MaterialUnit("", "scene", "x")
        with self.assertRaises(ValueError):
            MaterialUnit("a", "", "x")
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", "x", version=0)
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", "x", version=True)
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", 123)  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            U("a", prerequisites=["a"])  # 自依赖
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", "x",
                         prerequisites=("b", "b"))  # 重复依赖（未预先去重）
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", "x", prerequisites=frozenset([""]))
        with self.assertRaises(ValueError):
            MaterialUnit("a", "scene", "x", group="")

    def test_units_are_immutable(self):
        u = U("a")
        with self.assertRaises(Exception):
            u.body = "other"  # type: ignore[misc]


class TestRegistration(unittest.TestCase):
    def setUp(self):
        self.c = Composer()

    def test_register_and_get_stable_order(self):
        self.c.register_unit(U("c"))
        self.c.register_unit(U("a"))
        self.c.register_unit(U("b"))
        self.assertEqual([u.unit_id for u in self.c.all_units()], ["a", "b", "c"])

    def test_duplicate_id_rejected(self):
        self.c.register_unit(U("a"))
        with self.assertRaises(DuplicateIdError) as cm:
            self.c.register_unit(U("a", body="另一个"))
        self.assertEqual(cm.exception.unit_id, "a")

    def test_get_unknown(self):
        with self.assertRaises(UnknownUnitError):
            self.c.get_unit("ghost")

    def test_register_wrong_type(self):
        with self.assertRaises(ValidationError):
            self.c.register_unit("not-a-unit")  # type: ignore[arg-type]


class TestPrerequisites(unittest.TestCase):
    def setUp(self):
        self.c = Composer()

    def test_dangling_reference_rejected_with_location(self):
        # 注册时依赖尚不存在 -> 拒绝，并能拿到位置与缺失 id
        with self.assertRaises(DanglingReferenceError) as cm:
            self.c.register_unit(U("a", prerequisites=["missing"]))
        err = cm.exception
        self.assertEqual(err.unit_id, "a")
        self.assertEqual(err.dependency, "missing")
        self.assertIn("missing", str(err))
        self.assertIn("前置依赖", err.where)
        # 被拒绝的单元确实没有入库
        self.assertNotIn("a", [u.unit_id for u in self.c.all_units()])

    def test_chain_ok(self):
        self.c.register_unit(U("a"))
        self.c.register_unit(U("b", prerequisites=["a"]))
        self.c.register_unit(U("c", prerequisites=["a", "b"]))
        self.assertEqual(len(self.c.all_units()), 3)

    def test_direct_cycle_rejected(self):
        # a <- b <- c，再把 a 改写成依赖 c，形成 a -> c -> b -> a
        self.c.register_unit(U("a"))
        self.c.register_unit(U("b", prerequisites=["a"]))
        self.c.register_unit(U("c", prerequisites=["b"]))
        with self.assertRaises(CyclicDependencyError) as cm:
            self.c.update_unit(U("a", prerequisites=["c"]))
        cyc = cm.exception.cycle
        self.assertEqual(cyc[0], cyc[-1])
        self.assertEqual(set(cyc), {"a", "b", "c"})
        # 改写被整体拒绝：a 仍然没有前置依赖
        self.assertEqual(set(self.c.get_unit("a").prerequisites), set())

    def test_two_node_cycle_via_update(self):
        # b 已依赖 a；再把 a 改写成依赖 b，形成 a -> b -> a
        self.c.register_unit(U("a"))
        self.c.register_unit(U("b", prerequisites=["a"]))
        with self.assertRaises(CyclicDependencyError):
            self.c.update_unit(U("a", prerequisites=["b"]))
        # 改写被拒绝，a 仍然没有前置依赖
        self.assertEqual(set(self.c.get_unit("a").prerequisites), set())

    def test_update_unknown_and_register_existing(self):
        self.c.register_unit(U("a"))
        with self.assertRaises(UnknownUnitError):
            self.c.update_unit(U("x"))
        with self.assertRaises(DuplicateIdError):
            self.c.register_unit(U("a"))


class TestRemoval(unittest.TestCase):
    def setUp(self):
        self.c = Composer()
        self.c.register_unit(U("a"))
        self.c.register_unit(U("b", prerequisites=["a"]))
        self.c.register_goal(
            NarrativeGoal("g", "aud", (Slot("s1", "scene"), Slot("s2", "scene")))
        )
        self.c.fill_slot("g", "s1", "a")
        self.c.fill_slot("g", "s2", "b")

    def test_remove_with_dependents_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            self.c.remove_unit("a")  # b 依赖 a
        self.assertIn("b", str(cm.exception))

    def test_remove_referenced_rejected(self):
        with self.assertRaises(ValidationError) as cm:
            self.c.remove_unit("b")  # 被故事线引用
        self.assertIn("s2", str(cm.exception))

    def test_remove_ok_after_detach(self):
        self.c.clear_slot("g", "s2")
        self.c.update_unit(U("b"))  # 去掉对 a 的依赖
        self.c.remove_unit("b")
        with self.assertRaises(UnknownUnitError):
            self.c.get_unit("b")

    def test_remove_unknown(self):
        with self.assertRaises(UnknownUnitError):
            self.c.remove_unit("ghost")


if __name__ == "__main__":
    unittest.main()
