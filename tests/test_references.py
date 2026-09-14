"""引用建立、查询、悬空标记与稳定排序测试。"""

from __future__ import annotations

import unittest

from doctree import DocumentTree, NodeNotFoundError, ReferenceValidationError
from doctree.model import DanglingPolicy


class ReferenceBasicsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = DocumentTree()
        for nid, parent in [("r", None), ("a", "r"), ("b", "r"), ("c", "a"), ("x", None)]:
            self.tree.add_node(nid, parent)

    def test_add_and_query_reference(self) -> None:
        self.tree.add_reference("a", "b")
        self.assertEqual(self.tree.outgoing_references("a"), ("b",))
        views = self.tree.references_of("a")
        self.assertEqual([v.as_tuple() for v in views], [("a", "b", False)])
        self.assertEqual(self.tree.incoming_references("b"), ("a",))
        self.assertEqual(
            [v.source for v in self.tree.referrers_of("b")], ["a"]
        )

    def test_self_reference_rejected(self) -> None:
        with self.assertRaises(ReferenceValidationError):
            self.tree.add_reference("a", "a")
        self.assertEqual(self.tree.outgoing_references("a"), ())

    def test_duplicate_reference_rejected(self) -> None:
        self.tree.add_reference("a", "b")
        with self.assertRaises(ReferenceValidationError):
            self.tree.add_reference("a", "b")
        self.assertEqual(self.tree.outgoing_references("a"), ("b",))

    def test_reference_to_missing_node_rejected(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.add_reference("a", "ghost")
        with self.assertRaises(NodeNotFoundError):
            self.tree.add_reference("ghost", "a")
        self.assertEqual(self.tree.all_references(), ())

    def test_remove_reference(self) -> None:
        self.tree.add_reference("a", "b")
        self.tree.remove_reference("a", "b")
        self.assertEqual(self.tree.outgoing_references("a"), ())
        with self.assertRaises(ReferenceValidationError):
            self.tree.remove_reference("a", "b")

    def test_query_missing_node(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.references_of("ghost")
        with self.assertRaises(NodeNotFoundError):
            self.tree.incoming_references("ghost")

    def test_stable_ordering(self) -> None:
        # 来源顺序按展示前序；同来源按添加顺序。
        self.tree.add_reference("c", "b")
        self.tree.add_reference("a", "x")
        self.tree.add_reference("a", "c")
        self.tree.add_reference("x", "b")
        all_refs = [(v.source, v.target) for v in self.tree.all_references()]
        self.assertEqual(all_refs, [("a", "x"), ("a", "c"), ("c", "b"), ("x", "b")])
        # b 的入链来源按前序：a 不引用 b；c 在 x 之前
        self.assertEqual(self.tree.incoming_references("b"), ("c", "x"))

    def test_multiple_referrers(self) -> None:
        self.tree.add_reference("a", "c")
        self.tree.add_reference("b", "c")
        self.tree.add_reference("x", "c")
        self.assertEqual(self.tree.incoming_references("c"), ("a", "b", "x"))


class DanglingMarkingTests(unittest.TestCase):
    def test_dangling_marked_after_keep_policy_delete(self) -> None:
        tree = DocumentTree(policy=DanglingPolicy.KEEP_DANGLING)
        for nid, parent in [("r", None), ("a", "r"), ("b", "r"), ("c", "a")]:
            tree.add_node(nid, parent)
        tree.add_reference("b", "c")
        tree.add_reference("b", "a")
        result = tree.delete("a")  # 删除 a 与 c
        self.assertEqual(result.dangling_references, (("b", "c"), ("b", "a")))
        self.assertEqual(result.removed_references, ())

        dangling = tree.dangling_references()
        self.assertEqual(
            [(v.source, v.target, v.dangling) for v in dangling],
            [("b", "c", True), ("b", "a", True)],
        )
        views = tree.references_of("b")
        self.assertEqual(
            [(v.target, v.dangling) for v in views],
            [("c", True), ("a", True)],
        )
        # 悬空引用仍可手动删除
        tree.remove_reference("b", "a")
        self.assertEqual([v.target for v in tree.dangling_references()], ["c"])

    def test_deleted_source_references_disappear(self) -> None:
        tree = DocumentTree(policy=DanglingPolicy.KEEP_DANGLING)
        for nid, parent in [("r", None), ("a", "r"), ("b", "r")]:
            tree.add_node(nid, parent)
        tree.add_reference("a", "b")
        tree.delete("a")
        self.assertEqual(tree.all_references(), ())
        self.assertEqual(tree.dangling_references(), ())
        self.assertEqual(tree.incoming_references("b"), ())


if __name__ == "__main__":
    unittest.main()
