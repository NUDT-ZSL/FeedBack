"""删除、级联清理、悬空策略切换及其撤销测试。"""

from __future__ import annotations

import unittest

from doctree import DocumentTree, NodeNotFoundError
from doctree.model import DanglingPolicy
from tests.util import clear_history, structure


def build(policy: DanglingPolicy = DanglingPolicy.CASCADE) -> DocumentTree:
    r"""::

          r
         / \
        a   b
       / \   \
      a1 a2   b1
    """
    tree = DocumentTree(policy=policy)
    for nid, parent in [
        ("r", None),
        ("a", "r"),
        ("b", "r"),
        ("a1", "a"),
        ("a2", "a"),
        ("b1", "b"),
    ]:
        tree.add_node(nid, parent)
    return tree


class CascadeDeleteTests(unittest.TestCase):
    def test_delete_subtree_removes_nodes(self) -> None:
        tree = build()
        result = tree.delete("a")
        self.assertEqual(result.deleted_nodes, ("a", "a1", "a2"))
        self.assertEqual(tree.node("r").children, ("b",))
        self.assertNotIn("a", tree)
        self.assertNotIn("a1", tree)
        self.assertFalse(tree.contains("a2"))
        self.assertEqual(result.old_paths["a2"], ("r", "a", "a2"))

    def test_delete_with_incoming_references_cascade(self) -> None:
        tree = build()
        tree.add_reference("b", "a1")
        tree.add_reference("b", "a")
        tree.add_reference("b1", "r")
        result = tree.delete("a")
        # 指向子树内 a / a1 的两条引用被级联清理；b1->r 保留
        self.assertEqual(sorted(result.removed_references), [("b", "a"), ("b", "a1")])
        self.assertEqual(tree.outgoing_references("b"), ())
        self.assertEqual(tree.outgoing_references("b1"), ("r",))
        self.assertEqual(tree.dangling_references(), ())

    def test_delete_internal_references_vanish(self) -> None:
        tree = build()
        tree.add_reference("a1", "a2")  # 子树内部引用
        tree.add_reference("a", "r")    # 子树 -> 外部
        tree.add_reference("b", "a1")   # 外部 -> 子树
        result = tree.delete("a")
        self.assertEqual(result.removed_references, (("b", "a1"),))
        self.assertEqual(tree.all_references(), ())

    def test_delete_root_node(self) -> None:
        tree = build()
        tree.delete("r")
        self.assertEqual(len(tree), 0)
        self.assertEqual(tree.roots, ())

    def test_delete_missing(self) -> None:
        tree = build()
        before = structure(tree)
        with self.assertRaises(NodeNotFoundError):
            tree.delete("ghost")
        self.assertEqual(structure(tree), before)


class KeepDanglingDeleteTests(unittest.TestCase):
    def test_keep_dangling_delete(self) -> None:
        tree = build(policy=DanglingPolicy.KEEP_DANGLING)
        tree.add_reference("b", "a1")
        tree.add_reference("b1", "r")
        result = tree.delete("a")
        self.assertEqual(result.dangling_references, (("b", "a1"),))
        views = tree.references_of("b")
        self.assertEqual([(v.target, v.dangling) for v in views], [("a1", True)])
        # 被引用方已不存在，incoming 查询以现存节点为前提
        with self.assertRaises(NodeNotFoundError):
            tree.incoming_references("a1")

    def test_retarget_dangling_clears_flag(self) -> None:
        tree = build(policy=DanglingPolicy.KEEP_DANGLING)
        tree.add_reference("b", "a1")
        tree.delete("a")
        # a1 的标识被新节点复用：悬空标记应随目标存在性消失
        tree.add_node("a1", "b")
        views = tree.references_of("b")
        self.assertEqual([(v.target, v.dangling) for v in views], [("a1", False)])
        self.assertEqual(tree.dangling_references(), ())


class PolicySwitchTests(unittest.TestCase):
    def test_switch_to_cascade_purges_existing_dangling(self) -> None:
        tree = build(policy=DanglingPolicy.KEEP_DANGLING)
        tree.add_reference("b", "a1")
        tree.add_reference("b1", "r")
        tree.delete("a")
        self.assertEqual(len(tree.dangling_references()), 1)

        tree.set_dangling_policy(DanglingPolicy.CASCADE)
        self.assertIs(tree.policy, DanglingPolicy.CASCADE)
        self.assertEqual(tree.dangling_references(), ())
        self.assertEqual(tree.outgoing_references("b"), ())
        self.assertEqual(tree.outgoing_references("b1"), ("r",))
        tree.check_invariants()

    def test_switch_to_keep_keeps_everything(self) -> None:
        tree = build()
        tree.add_reference("b", "a1")
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
        self.assertEqual(tree.outgoing_references("b"), ("a1",))
        tree.delete("a")
        self.assertEqual(len(tree.dangling_references()), 1)

    def test_same_policy_is_noop(self) -> None:
        tree = clear_history(build())
        cmd = tree.set_dangling_policy(DanglingPolicy.CASCADE)
        self.assertEqual(tree.undo_depth, 0)
        self.assertEqual(cmd.new_policy, cmd.old_policy)

    def test_purge_is_undoable(self) -> None:
        tree = build(policy=DanglingPolicy.KEEP_DANGLING)
        tree.add_reference("b", "a1")
        tree.delete("a")
        tree.set_dangling_policy(DanglingPolicy.CASCADE)
        tree.undo()  # 撤销策略切换：悬空引用精确回到原位
        self.assertIs(tree.policy, DanglingPolicy.KEEP_DANGLING)
        self.assertEqual(
            [(v.target, v.dangling) for v in tree.references_of("b")],
            [("a1", True)],
        )

    def test_policy_string_accepted(self) -> None:
        tree = build()
        tree.set_dangling_policy("keep_dangling")
        self.assertIs(tree.policy, DanglingPolicy.KEEP_DANGLING)
        from doctree import PolicyError

        with self.assertRaises(PolicyError):
            tree.set_dangling_policy("bogus")


if __name__ == "__main__":
    unittest.main()
