"""拖拽移动：校验拒绝、位置语义、路径/引用报告与顺序稳定性。"""

from __future__ import annotations

import unittest

from doctree import (
    CycleError,
    DocumentTree,
    InvalidPositionError,
    NodeNotFoundError,
)
from tests.util import structure


def build() -> DocumentTree:
    tree = DocumentTree()
    for nid, parent in [
        ("r", None),
        ("a", "r"),
        ("b", "r"),
        ("c", "r"),
        ("a1", "a"),
        ("a2", "a"),
        ("b1", "b"),
        ("root2", None),
    ]:
        tree.add_node(nid, parent)
    return tree


class MoveRejectionTests(unittest.TestCase):
    def test_move_missing_node(self) -> None:
        tree = build()
        before = structure(tree)
        with self.assertRaises(NodeNotFoundError):
            tree.move("ghost", "r", 0)
        self.assertEqual(structure(tree), before)

    def test_move_to_missing_parent(self) -> None:
        tree = build()
        before = structure(tree)
        with self.assertRaises(NodeNotFoundError):
            tree.move("a", "ghost", 0)
        self.assertEqual(structure(tree), before)

    def test_move_into_self(self) -> None:
        tree = build()
        before = structure(tree)
        with self.assertRaises(CycleError):
            tree.move("a", "a", 0)
        self.assertEqual(structure(tree), before)

    def test_move_into_own_subtree(self) -> None:
        tree = build()
        before = structure(tree)
        with self.assertRaises(CycleError):
            tree.move("a", "a1", 0)
        with self.assertRaises(CycleError):
            tree.move("a", "a2", 1)
        self.assertEqual(structure(tree), before)

    def test_position_out_of_range(self) -> None:
        tree = build()
        # r 有 a,b,c 三个孩子，把 a 移到 r 下时先摘下，合法范围 0..2。
        with self.assertRaises(InvalidPositionError):
            tree.move("a", "r", 3)
        with self.assertRaises(InvalidPositionError):
            tree.move("a", "r", -1)
        # 跨父移动：b 有一个孩子 b1，合法范围 0..1。
        with self.assertRaises(InvalidPositionError):
            tree.move("a", "b", 2)
        # 根层级有 r、root2，把 a（当前非根）移为根时合法范围 0..2。
        with self.assertRaises(InvalidPositionError):
            tree.move("a", None, 3)
        self.assertEqual(tree.node("r").children, ("a", "b", "c"))

    def test_move_to_same_spot_rejected(self) -> None:
        tree = build()
        with self.assertRaises(InvalidPositionError):
            tree.move("a", "r", 0)
        with self.assertRaises(InvalidPositionError):
            tree.move("b", "r", 1)
        self.assertEqual(tree.node("r").children, ("a", "b", "c"))


class SameParentReorderTests(unittest.TestCase):
    """同父节点重排采用 remove-then-insert 语义，结果必须稳定可复现。"""

    def test_move_first_to_end(self) -> None:
        tree = build()
        result = tree.move("a", "r", 2)
        self.assertEqual(tree.node("r").children, ("b", "c", "a"))
        self.assertEqual(result.index, 2)
        self.assertEqual(result.moved_nodes, ("a", "a1", "a2"))

    def test_move_last_to_front(self) -> None:
        tree = build()
        tree.move("c", "r", 0)
        self.assertEqual(tree.node("r").children, ("c", "a", "b"))

    def test_rotate_left_step_by_step_is_deterministic(self) -> None:
        sequences = []
        for _ in range(3):
            tree = build()
            # 三步旋转：把当前第一个孩子移到末尾
            tree.move("a", "r", 2)
            tree.move("b", "r", 2)
            tree.move("c", "r", 2)
            sequences.append(tree.node("r").children)
        self.assertTrue(all(seq == ("a", "b", "c") for seq in sequences))

    def test_move_middle_forward_and_back(self) -> None:
        tree = build()
        tree.move("b", "r", 2)  # [a,c,b]
        self.assertEqual(tree.node("r").children, ("a", "c", "b"))
        tree.move("b", "r", 1)  # [a,b,c]
        self.assertEqual(tree.node("r").children, ("a", "b", "c"))


class CrossLevelMoveTests(unittest.TestCase):
    def test_move_subtree_cross_level(self) -> None:
        tree = build()
        result = tree.move("a", "b1", 0)
        # a 整棵子树挂到 b1 下
        self.assertEqual(tree.node("b1").children, ("a",))
        self.assertEqual(tree.node("a").parent, "b1")
        self.assertEqual(result.moved_nodes, ("a", "a1", "a2"))
        self.assertEqual(result.old_paths["a2"], ("r", "a", "a2"))
        self.assertEqual(result.new_paths["a2"], ("r", "b", "b1", "a", "a2"))
        self.assertEqual(result.old_paths["a"], ("r", "a"))
        self.assertEqual(result.new_paths["a"], ("r", "b", "b1", "a"))
        # r 的孩子中 a 消失，顺序剩余 b,c
        self.assertEqual(tree.node("r").children, ("b", "c"))
        tree.check_invariants()

    def test_move_to_root_level(self) -> None:
        tree = build()
        tree.move("a1", None, 1)
        self.assertEqual(tree.roots, ("r", "a1", "root2"))
        self.assertIsNone(tree.node("a1").parent)
        self.assertEqual(tree.node("a").children, ("a2",))

    def test_move_root_into_node(self) -> None:
        tree = build()
        tree.move("root2", "c", 0)
        self.assertEqual(tree.roots, ("r",))
        self.assertEqual(tree.node("c").children, ("root2",))
        self.assertEqual(tree.path_of("root2"), ("r", "c", "root2"))

    def test_repeated_moves_order_stable(self) -> None:
        def script() -> DocumentTree:
            tree = build()
            tree.move("a1", "r", 1)  # r: a, a1, b, c ; a: a2
            tree.move("a2", "r", 2)  # r: a, a1, a2, b, c ; a: 空
            tree.move("a1", "a", 0)  # a: a1 ; r: a, a2, b, c
            return tree

        first = script()
        self.assertEqual(first.node("r").children, ("a", "a2", "b", "c"))
        self.assertEqual(first.node("a").children, ("a1",))
        # 同样脚本再跑一遍，结果必须逐位一致（稳定可复现）
        second = script()
        self.assertEqual(second.node("r").children, first.node("r").children)
        self.assertEqual(second.node("a").children, first.node("a").children)


class AffectedReferencesTests(unittest.TestCase):
    def test_affected_references_reported(self) -> None:
        tree = build()
        tree.add_reference("c", "a1")    # 外部 -> 子树内
        tree.add_reference("a2", "root2")  # 子树内 -> 外部
        tree.add_reference("b", "c")     # 无关引用
        result = tree.move("a", "b", 0)
        keys = sorted((ref.source, ref.target) for ref in result.affected_references)
        self.assertEqual(keys, [("a2", "root2"), ("c", "a1")])
        for ref in result.affected_references:
            if ref.source == "c":
                self.assertTrue(ref.target_in_subtree)
                self.assertFalse(ref.source_in_subtree)
                self.assertEqual(ref.target_old_path, ("r", "a", "a1"))
                self.assertEqual(ref.target_new_path, ("r", "b", "a", "a1"))
            if ref.source == "a2":
                self.assertTrue(ref.source_in_subtree)
                self.assertFalse(ref.target_in_subtree)
                self.assertEqual(ref.source_old_path, ("r", "a", "a2"))
                self.assertEqual(ref.source_new_path, ("r", "b", "a", "a2"))
        # 无关引用不受影响
        self.assertEqual(tree.outgoing_references("b"), ("c",))


if __name__ == "__main__":
    unittest.main()
