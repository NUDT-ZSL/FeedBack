"""撤销/重做：精确还原结构、顺序、引用，栈边界提示与历史分叉。"""

from __future__ import annotations

import unittest

from doctree import DocumentTree, UndoRedoError
from doctree.model import DanglingPolicy
from tests.util import build_doc_tree, clear_history, structure


class UndoRedoBasicsTests(unittest.TestCase):
    def test_empty_stack_messages_and_state(self) -> None:
        tree = DocumentTree()
        with self.assertRaises(UndoRedoError):
            tree.undo()
        with self.assertRaises(UndoRedoError):
            tree.redo()
        self.assertFalse(tree.can_undo)
        self.assertFalse(tree.can_redo)

    def test_move_undo_redo_restores_exactly(self) -> None:
        tree = build_doc_tree()
        before = structure(tree)
        paths_before = {nid: tree.path_of(nid) for nid in tree.all_node_ids()}

        result = tree.move("ch1", "s3", 1)
        self.assertTrue(tree.can_undo)
        self.assertFalse(tree.can_redo)
        moved_state = structure(tree)
        self.assertNotEqual(moved_state, before)

        undone = tree.undo()
        self.assertEqual(undone.kind, "move")
        self.assertEqual(structure(tree), before)
        for nid in tree.all_node_ids():
            self.assertEqual(tree.path_of(nid), paths_before[nid])
        # 引用状态完全还原
        self.assertEqual(len(tree.all_references()), 4)

        redone = tree.redo()
        self.assertEqual(redone.kind, "move")
        self.assertEqual(structure(tree), moved_state)
        self.assertEqual(result.new_paths, {nid: tree.path_of(nid) for nid in result.moved_nodes})

    def test_multi_step_undo_redo_order(self) -> None:
        tree = clear_history(build_doc_tree())
        s0 = structure(tree)
        tree.move("s1", "ch2", 0)
        s1 = structure(tree)
        tree.move("n3", "s2", 0)
        s2 = structure(tree)
        tree.move("n1", None, 0)
        s3 = structure(tree)

        tree.undo()
        self.assertEqual(structure(tree), s2)
        tree.undo()
        self.assertEqual(structure(tree), s1)
        tree.undo()
        self.assertEqual(structure(tree), s0)
        with self.assertRaises(UndoRedoError):
            tree.undo()

        tree.redo()
        self.assertEqual(structure(tree), s1)
        tree.redo()
        self.assertEqual(structure(tree), s2)
        tree.redo()
        self.assertEqual(structure(tree), s3)
        with self.assertRaises(UndoRedoError):
            tree.redo()

    def test_same_parent_reorder_undo(self) -> None:
        tree = DocumentTree()
        tree.add_node("r")
        for nid in ("a", "b", "c"):
            tree.add_node(nid, "r")
        tree.move("a", "r", 2)
        self.assertEqual(tree.node("r").children, ("b", "c", "a"))
        tree.undo()
        self.assertEqual(tree.node("r").children, ("a", "b", "c"))
        tree.redo()
        self.assertEqual(tree.node("r").children, ("b", "c", "a"))


class UndoRedoReferencesTests(unittest.TestCase):
    def test_cascade_delete_undo_restores_references(self) -> None:
        tree = build_doc_tree()
        before = structure(tree)
        tree.delete("ch1")  # ch1/s1/s2/n1 被删；n3->ch1、ch2->s1、s2->n2 受影响
        post_delete = structure(tree)
        self.assertNotIn("ch1", tree)
        # n3->ch1 与 ch2->s1 被级联清理
        self.assertEqual(tree.outgoing_references("n3"), ())
        self.assertEqual(tree.outgoing_references("ch2"), ())

        tree.undo()
        self.assertEqual(structure(tree), before)
        self.assertEqual(tree.outgoing_references("n3"), ("ch1",))
        self.assertEqual(tree.outgoing_references("ch2"), ("s1",))
        self.assertEqual(tree.outgoing_references("s2"), ("n2",))

        tree.redo()
        self.assertEqual(structure(tree), post_delete)
        self.assertEqual(tree.outgoing_references("n3"), ())

    def test_keep_dangling_delete_undo_removes_dangling(self) -> None:
        tree = build_doc_tree()
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
        before = structure(tree)
        tree.delete("s3")  # n2、n3 删除；n1->n3 与 s2->n2 变为悬空
        self.assertEqual(
            [(v.source, v.target) for v in tree.dangling_references()],
            [("n1", "n3"), ("s2", "n2")],
        )
        tree.undo()
        self.assertEqual(structure(tree), before)
        self.assertEqual(tree.dangling_references(), ())
        tree.redo()
        self.assertEqual(len(tree.dangling_references()), 2)

    def test_policy_switch_undo_restores_dangling(self) -> None:
        tree = build_doc_tree()
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
        tree.delete("s3")
        self.assertEqual(len(tree.dangling_references()), 2)
        tree.set_dangling_policy(DanglingPolicy.CASCADE)
        self.assertEqual(tree.dangling_references(), ())
        # 撤销顺序：先撤销切换（两条悬空引用回来），再撤销删除（节点回来）
        tree.undo()
        self.assertEqual(len(tree.dangling_references()), 2)
        tree.undo()
        self.assertEqual(tree.dangling_references(), ())
        self.assertIn("s3", tree)


class HistoryBranchTests(unittest.TestCase):
    def test_new_edit_after_undo_clears_redo(self) -> None:
        tree = clear_history(build_doc_tree())
        tree.move("s1", "ch2", 0)
        tree.move("n3", "s2", 0)
        tree.undo()
        tree.undo()
        self.assertTrue(tree.can_redo)
        tree.add_node("fresh", "doc")
        self.assertFalse(tree.can_redo)  # 新编辑清空未来分支
        # 两次移动都已撤销，仅新增本身留在撤销栈上
        self.assertEqual(tree.undo_depth, 1)
        self.assertIn("fresh", tree)
        tree.undo()
        self.assertNotIn("fresh", tree)
        self.assertEqual(tree.undo_depth, 0)

    def test_reference_edit_after_undo_clears_redo(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        tree.undo()
        self.assertTrue(tree.can_redo)
        tree.add_reference("doc", "n1")
        self.assertFalse(tree.can_redo)


class EditCommandsUndoTests(unittest.TestCase):
    def test_add_node_undo_redo_restores_position(self) -> None:
        tree = DocumentTree()
        tree.add_node("r")
        tree.add_node("a", "r")
        tree.add_node("b", "r")
        clear_history(tree)
        tree.add_node("m", "r", 1)
        self.assertEqual(tree.node("r").children, ("a", "m", "b"))
        tree.undo()
        self.assertNotIn("m", tree)
        self.assertEqual(tree.node("r").children, ("a", "b"))
        tree.redo()
        self.assertIn("m", tree)
        self.assertEqual(tree.node("r").children, ("a", "m", "b"))

    def test_reference_changes_undo_redo(self) -> None:
        tree = clear_history(build_doc_tree())
        tree.add_reference("doc", "n2")
        self.assertEqual(tree.outgoing_references("doc"), ("n2",))
        tree.undo()
        self.assertEqual(tree.outgoing_references("doc"), ())
        tree.redo()
        self.assertEqual(tree.outgoing_references("doc"), ("n2",))

    def test_remove_reference_undo_restores_original_position(self) -> None:
        tree = clear_history(build_doc_tree())
        # n1 当前出链为 (n3,)；再补两条，删除中间一条后撤销应插回原位
        tree.add_reference("n1", "n2")
        tree.add_reference("n1", "ch2")
        self.assertEqual(tree.outgoing_references("n1"), ("n3", "n2", "ch2"))
        tree.remove_reference("n1", "n2")
        self.assertEqual(tree.outgoing_references("n1"), ("n3", "ch2"))
        tree.undo()
        self.assertEqual(tree.outgoing_references("n1"), ("n3", "n2", "ch2"))
        tree.redo()
        self.assertEqual(tree.outgoing_references("n1"), ("n3", "ch2"))


if __name__ == "__main__":
    unittest.main()
