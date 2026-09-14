"""其余边界：失败操作不入历史、根级移动、策略命令持久化、原状态保持等。"""

from __future__ import annotations

import os
import tempfile
import unittest

import doctree
from doctree import (
    DocumentTree,
    ReferenceValidationError,
    UndoRedoError,
)
from doctree.model import DanglingPolicy
from doctree.persistence import dumps, load_into, loads
from tests.util import build_doc_tree, clear_history, structure


class FailedOperationTests(unittest.TestCase):
    def test_failed_move_does_not_push_history(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        depth = tree.undo_depth
        from doctree import CycleError

        with self.assertRaises(CycleError):
            tree.move("ch2", "s3", 0)  # ch2 -> s3 会进入自己的子树
        self.assertEqual(tree.undo_depth, depth)

    def test_failed_reference_edit_does_not_clear_redo(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        tree.undo()
        self.assertTrue(tree.can_redo)
        with self.assertRaises(ReferenceValidationError):
            tree.add_reference("n1", "n1")  # 自引用
        self.assertTrue(tree.can_redo)  # 失败不清空重做栈
        # 仅保留 build_doc_tree 既有的 n1->n3
        self.assertEqual(tree.outgoing_references("n1"), ("n3",))

    def test_undo_redo_error_messages(self) -> None:
        tree = DocumentTree()
        with self.assertRaisesRegex(UndoRedoError, "撤销栈为空"):
            tree.undo()
        with self.assertRaisesRegex(UndoRedoError, "重做栈为空"):
            tree.redo()


class RootLevelTests(unittest.TestCase):
    def test_move_between_root_positions(self) -> None:
        tree = DocumentTree()
        tree.add_node("a")
        tree.add_node("b")
        tree.add_node("c")
        tree.move("a", None, 2)  # 先摘下：[b,c]，插到末尾 -> [b,c,a]
        self.assertEqual(tree.roots, ("b", "c", "a"))
        tree.undo()
        self.assertEqual(tree.roots, ("a", "b", "c"))

    def test_delete_one_root_keeps_others(self) -> None:
        tree = DocumentTree()
        tree.add_node("a")
        tree.add_node("b")
        tree.add_node("c", "b")
        tree.delete("b")
        self.assertEqual(tree.roots, ("a",))
        self.assertEqual(len(tree), 1)


class InternalReferenceOnMoveTests(unittest.TestCase):
    def test_internal_reference_reported_with_both_flags(self) -> None:
        tree = build_doc_tree()
        tree.add_reference("n1", "s1")  # 子树内部（n1 在 s1 内）
        result = tree.move("s1", "ch2", 0)
        hit = [r for r in result.affected_references
               if (r.source, r.target) == ("n1", "s1")]
        self.assertEqual(len(hit), 1)
        self.assertTrue(hit[0].source_in_subtree)
        self.assertTrue(hit[0].target_in_subtree)
        self.assertEqual(
            hit[0].source_new_path, ("doc", "ch2", "s1", "n1")
        )
        # 引用本身完好、不悬空
        self.assertEqual(tree.outgoing_references("n1"), ("n3", "s1"))


class PolicyHistoryPersistenceTests(unittest.TestCase):
    def test_policy_command_roundtrip_and_replay(self) -> None:
        tree = DocumentTree(policy=DanglingPolicy.KEEP_DANGLING)
        for nid, parent in [("r", None), ("a", "r"), ("b", "r")]:
            tree.add_node(nid, parent)
        tree.add_reference("a", "b")
        clear_history(tree)
        tree.delete("b")  # undo: delete
        tree.set_dangling_policy(DanglingPolicy.CASCADE)  # undo: policy
        self.assertEqual(tree.undo_depth, 2)

        restored = loads(dumps(tree))
        self.assertIs(restored.policy, DanglingPolicy.CASCADE)
        restored.undo()
        self.assertIs(restored.policy, DanglingPolicy.KEEP_DANGLING)
        self.assertEqual(len(restored.dangling_references()), 1)
        restored.undo()
        self.assertIn("b", restored)
        # 重做两步重新回到清理后状态
        restored.redo()
        restored.redo()
        self.assertIs(restored.policy, DanglingPolicy.CASCADE)
        self.assertEqual(restored.dangling_references(), ())


class LoadIntoFailurePreservesHistoryTests(unittest.TestCase):
    def test_failed_load_preserves_everything(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        tree.undo()
        before = dumps(tree)

        tmp = tempfile.mkdtemp()
        try:
            bad_path = os.path.join(tmp, "bad.json")
            with open(bad_path, "w", encoding="utf-8") as handle:
                handle.write('{"version": 1, "policy": "cascade", "roots": [], "nodes": {"x": 1}}')
            with self.assertRaises(doctree.SerializationError):
                load_into(tree, bad_path)
        finally:
            os.unlink(bad_path)
            os.rmdir(tmp)

        # 结构、历史栈与失败前完全一致
        self.assertEqual(dumps(tree), before)
        self.assertTrue(tree.can_redo)
        tree.redo()
        self.assertEqual(tree.node("s1").parent, "ch2")


if __name__ == "__main__":
    unittest.main()
