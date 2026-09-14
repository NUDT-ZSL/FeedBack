"""空树、单节点、多根、顺序与基础不变量测试。"""

from __future__ import annotations

import unittest

from doctree import (
    DocumentTree,
    DuplicateIdError,
    InvalidPositionError,
    NodeNotFoundError,
)
from doctree.model import DanglingPolicy


class EmptyTreeTests(unittest.TestCase):
    def test_empty_tree(self) -> None:
        tree = DocumentTree()
        self.assertEqual(len(tree), 0)
        self.assertEqual(tree.roots, ())
        self.assertEqual(tree.all_node_ids(), ())
        self.assertFalse(tree.can_undo)
        self.assertFalse(tree.can_redo)
        tree.check_invariants()  # 空树合法

    def test_empty_undo_redo_raise_without_change(self) -> None:
        tree = DocumentTree()
        from doctree import UndoRedoError

        with self.assertRaises(UndoRedoError):
            tree.undo()
        with self.assertRaises(UndoRedoError):
            tree.redo()
        self.assertEqual(len(tree), 0)


class SingleNodeTests(unittest.TestCase):
    def test_add_single_root(self) -> None:
        tree = DocumentTree()
        view = tree.add_node("a")
        self.assertEqual(view.id, "a")
        self.assertIsNone(view.parent)
        self.assertEqual(view.children, ())
        self.assertEqual(view.references, ())
        self.assertEqual(tree.roots, ("a",))
        self.assertEqual(tree.all_node_ids(), ("a",))
        self.assertEqual(tree.path_of("a"), ("a",))
        self.assertIn("a", tree)
        self.assertTrue(tree.contains("a"))

    def test_add_invalid_ids(self) -> None:
        tree = DocumentTree()
        with self.assertRaises(DuplicateIdError):
            tree.add_node("")
        with self.assertRaises(DuplicateIdError):
            tree.add_node(123)  # type: ignore[arg-type]
        tree.add_node("a")
        with self.assertRaises(DuplicateIdError):
            tree.add_node("a")

    def test_missing_node_queries(self) -> None:
        tree = DocumentTree()
        with self.assertRaises(NodeNotFoundError):
            tree.node("ghost")
        with self.assertRaises(NodeNotFoundError):
            tree.path_of("ghost")
        with self.assertRaises(NodeNotFoundError):
            tree.subtree_ids("ghost")


class ConstructionAndOrderTests(unittest.TestCase):
    def _build(self) -> DocumentTree:
        tree = DocumentTree()
        tree.add_node("r")
        tree.add_node("a", "r")
        tree.add_node("b", "r")
        tree.add_node("a1", "a")
        tree.add_node("a2", "a")
        tree.add_node("root2")
        return tree

    def test_preorder_and_paths(self) -> None:
        tree = self._build()
        self.assertEqual(tree.all_node_ids(), ("r", "a", "a1", "a2", "b", "root2"))
        self.assertEqual(tree.path_of("a2"), ("r", "a", "a2"))
        self.assertEqual(tree.path_of("root2"), ("root2",))
        self.assertEqual(tree.roots, ("r", "root2"))

    def test_subtree_ids(self) -> None:
        tree = self._build()
        self.assertEqual(tree.subtree_ids("a"), ("a", "a1", "a2"))
        self.assertEqual(tree.subtree_ids("b"), ("b",))

    def test_insert_at_index_and_bounds(self) -> None:
        tree = DocumentTree()
        tree.add_node("r")
        tree.add_node("x", "r", 0)
        tree.add_node("y", "r", 0)
        tree.add_node("z", "r", 1)
        self.assertEqual(tree.node("r").children, ("y", "z", "x"))
        with self.assertRaises(InvalidPositionError):
            tree.add_node("bad", "r", 4)
        with self.assertRaises(InvalidPositionError):
            tree.add_node("bad", "r", -1)

    def test_add_under_missing_parent(self) -> None:
        tree = DocumentTree()
        with self.assertRaises(NodeNotFoundError):
            tree.add_node("x", "ghost")
        self.assertEqual(len(tree), 0)  # 失败后无部分修改

    def test_bidirectional_consistency_view(self) -> None:
        tree = self._build()
        for nid in tree.all_node_ids():
            view = tree.node(nid)
            for child in view.children:
                self.assertEqual(tree.node(child).parent, nid)
            if view.parent is not None:
                self.assertIn(nid, tree.node(view.parent).children)

    def test_policy_coercion(self) -> None:
        tree = DocumentTree(policy="keep_dangling")
        self.assertIs(tree.policy, DanglingPolicy.KEEP_DANGLING)
        from doctree import PolicyError

        with self.assertRaises(PolicyError):
            DocumentTree(policy="nonsense")


if __name__ == "__main__":
    unittest.main()
