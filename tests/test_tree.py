"""DocumentTree 的单元测试：增删、跨层拖拽合法性、查询、引用维护与策略。"""

from __future__ import annotations

import unittest

from doctree.exceptions import (
    DanglingReferenceError,
    NodeNotFoundError,
    ValidationError,
)
from doctree.model import Node
from doctree.tree import (
    POLICY_CASCADE,
    POLICY_LENIENT,
    POLICY_STRICT,
    DocumentTree,
)


def build_sample_tree(policy: str = POLICY_CASCADE) -> DocumentTree:
    """构造 4 层嵌套样例树::

        r(section)
        ├─ a(section)
        │  ├─ a1(note, "a1-content")
        │  │  └─ a1x(note)
        │  └─ a2(note)
        ├─ b(section)
        │  └─ b1(ref) -> a1
        └─ c(note)
    """
    t = DocumentTree(ref_policy=policy)
    t.add("r", None, "section")
    t.add("a", "r", "section")
    t.add("b", "r", "section")
    t.add("c", "r", "note")
    t.add("a1", "a", "note", content="a1-content")
    t.add("a2", "a", "note")
    t.add("a1x", "a1", "note")
    t.add("b1", "b", "ref")
    t.add_ref("b1", "a1")
    return t


class AddTest(unittest.TestCase):
    def test_add_root_and_children(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")
        t.add("a", "r", "note", content="x", refs=[])
        self.assertEqual(t.root_id, "r")
        self.assertEqual(t.get_node("r").children, ["a"])
        self.assertEqual(t.get_node("a").parent_id, "r")
        self.assertEqual(len(t), 2)

    def test_empty_tree_queries(self) -> None:
        t = DocumentTree()
        self.assertEqual(t.preorder_ids(), [])
        self.assertEqual(t.find_by_kind("note"), [])
        self.assertEqual(t.get_dangling_refs(), [])
        self.assertIsNone(t.root_id)
        t.validate()

    def test_second_root_rejected(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")
        with self.assertRaises(ValidationError):
            t.add("r2", None, "section")

    def test_duplicate_id_rejected(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")
        with self.assertRaises(ValidationError):
            t.add("r", "r", "note")

    def test_missing_parent_rejected(self) -> None:
        t = DocumentTree()
        with self.assertRaises(NodeNotFoundError):
            t.add("x", "ghost", "note")

    def test_bad_arguments_rejected(self) -> None:
        t = DocumentTree()
        with self.assertRaises(ValidationError):
            t.add("", None, "section")
        with self.assertRaises(ValidationError):
            t.add("r", None, "")
        with self.assertRaises(ValidationError):
            t.add("r", None, "section", content=1)  # type: ignore[arg-type]

    def test_ref_to_missing_node_rejected_by_default(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")
        with self.assertRaises(DanglingReferenceError):
            t.add("a", "r", "note", refs=["ghost"])

    def test_self_ref_at_add_rejected_even_lenient(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        with self.assertRaises(ValidationError):
            t.add("a", "r", "note", refs=["a"])

    def test_duplicate_refs_at_add_rejected(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        with self.assertRaises(ValidationError):
            t.add("a", "r", "note", refs=["x", "x"])


class MoveTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = build_sample_tree()

    def test_reorder_within_same_parent(self) -> None:
        result = self.tree.move("a", "r", 2)
        self.assertEqual(self.tree.get_node("r").children, ["b", "c", "a"])
        self.assertEqual(result.old_path, ["r", "a"])
        self.assertEqual(result.new_path, ["r", "a"])
        self.assertEqual(result.moved_ids, ["a", "a1", "a1x", "a2"])

    def test_move_to_front_index_zero(self) -> None:
        self.tree.move("c", "r", 0)
        self.assertEqual(self.tree.get_node("r").children, ["c", "a", "b"])

    def test_cross_level_move_subtree(self) -> None:
        # 把 a 整棵子树移到 b 下，index 0；b1 与 a 成为兄弟。
        result = self.tree.move("a", "b", 0)
        self.assertEqual(self.tree.get_node("b").children, ["a", "b1"])
        self.assertEqual(self.tree.get_node("a").parent_id, "b")
        self.assertEqual(result.new_path, ["r", "b", "a"])
        self.assertEqual(result.moved_ids, ["a", "a1", "a1x", "a2"])
        # 子树内部结构不变。
        self.assertEqual(self.tree.get_path("a1x"), ["r", "b", "a", "a1", "a1x"])
        self.tree.validate()

    def test_move_leaf_keeps_other_order(self) -> None:
        self.tree.move("c", "a", 1)
        self.assertEqual(self.tree.get_node("a").children, ["a1", "c", "a2"])
        self.assertEqual(self.tree.get_node("r").children, ["a", "b"])

    def test_move_to_end_with_explicit_last_index(self) -> None:
        # 同父移动时，末位下标按“摘下后”的 children 长度算。
        self.tree.move("a", "r", 2)
        self.assertEqual(self.tree.get_node("r").children, ["b", "c", "a"])

    def test_move_none_index_appends(self) -> None:
        self.tree.move("a", "b", None)
        self.assertEqual(self.tree.get_node("b").children, ["b1", "a"])

    def test_move_into_self_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.move("a", "a", 0)

    def test_move_into_descendant_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.move("a", "a1", 0)
        with self.assertRaises(ValidationError):
            self.tree.move("a", "a1x", 0)

    def test_move_nonexistent_node_rejected(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.move("ghost", "r", 0)

    def test_move_to_nonexistent_parent_rejected(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.move("a", "ghost", 0)

    def test_move_index_out_of_range_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.move("c", "a", 99)
        with self.assertRaises(ValidationError):
            self.tree.move("c", "a", -1)
        # 同父重排：摘下后只有 2 个兄弟，最大下标为 2。
        with self.assertRaises(ValidationError):
            self.tree.move("a", "r", 3)

    def test_failed_move_leaves_state_untouched(self) -> None:
        before = self.tree.dump_state()
        with self.assertRaises(ValidationError):
            self.tree.move("a", "a1", 0)
        self.assertEqual(self.tree.dump_state(), before)
        self.assertEqual(self.tree.version, before["version"])

    def test_move_reports_boundary_refs(self) -> None:
        # b1 -> a1 是跨边界入边（移动 a 子树时 b1 在外）。
        result = self.tree.move("a", "b", 0)
        self.assertIn(
            {"owner": "b1", "target": "a1", "direction": "in"},
            result.affected_refs,
        )

    def test_move_root_rejected_when_it_would_cycle(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.move("r", "a", 0)

    def test_move_single_node_tree(self) -> None:
        t = DocumentTree()
        t.add("solo", None, "section")
        with self.assertRaises(ValidationError):
            t.move("solo", "solo", 0)


class QueryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = build_sample_tree()

    def test_path(self) -> None:
        self.assertEqual(self.tree.get_path("r"), ["r"])
        self.assertEqual(self.tree.get_path("a1x"), ["r", "a", "a1", "a1x"])

    def test_path_missing_node(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.get_path("ghost")

    def test_subtree_preorder_full(self) -> None:
        self.assertEqual(
            self.tree.get_subtree("r"),
            ["r", "a", "a1", "a1x", "a2", "b", "b1", "c"],
        )
        self.assertEqual(self.tree.get_subtree("a"), ["a", "a1", "a1x", "a2"])

    def test_subtree_max_depth(self) -> None:
        self.assertEqual(self.tree.get_subtree("r", max_depth=0), ["r"])
        self.assertEqual(self.tree.get_subtree("r", max_depth=1), ["r", "a", "b", "c"])
        self.assertEqual(self.tree.get_subtree("a", max_depth=1), ["a", "a1", "a2"])

    def test_subtree_bad_depth(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.get_subtree("r", max_depth=-1)

    def test_find_by_kind_preorder(self) -> None:
        notes = [n.node_id for n in self.tree.find_by_kind("note")]
        self.assertEqual(notes, ["a1", "a1x", "a2", "c"])  # 严格前序
        self.assertEqual([n.node_id for n in self.tree.find_by_kind("ref")], ["b1"])
        self.assertEqual(self.tree.find_by_kind("missing"), [])

    def test_resolve_refs_existing(self) -> None:
        resolved = self.tree.resolve_refs("b1")
        self.assertEqual(len(resolved), 1)
        self.assertTrue(resolved[0]["exists"])
        self.assertFalse(resolved[0]["dangling"])
        self.assertEqual(resolved[0]["node"]["node_id"], "a1")

    def test_resolve_refs_sorted(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "z")
        t.add_ref("o", "a")
        t.add_ref("o", "m")
        self.assertEqual([r["target"] for r in t.resolve_refs("o")], ["a", "m", "z"])


class ContentAndRefsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = build_sample_tree()

    def test_update_content(self) -> None:
        self.tree.update_content("a1", "new")
        self.assertEqual(self.tree.get_node("a1").content, "new")

    def test_update_same_content_no_version_bump(self) -> None:
        v = self.tree.version
        self.tree.update_content("a1", "a1-content")
        self.assertEqual(self.tree.version, v)

    def test_update_content_missing_node(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.update_content("ghost", "x")

    def test_add_remove_ref(self) -> None:
        self.tree.add_ref("c", "a2")
        self.assertIn("a2", self.tree.get_node("c").refs)
        self.tree.remove_ref("c", "a2")
        self.assertNotIn("a2", self.tree.get_node("c").refs)

    def test_duplicate_ref_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.add_ref("b1", "a1")

    def test_self_ref_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.add_ref("a1", "a1")

    def test_ref_missing_target_rejected_default(self) -> None:
        with self.assertRaises(DanglingReferenceError):
            self.tree.add_ref("c", "ghost")

    def test_remove_nonexistent_ref(self) -> None:
        with self.assertRaises(ValidationError):
            self.tree.remove_ref("c", "a1")

    def test_ref_missing_owner(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            self.tree.add_ref("ghost", "a1")


class RemoveAndPolicyTest(unittest.TestCase):
    def test_remove_subtree(self) -> None:
        t = build_sample_tree()
        result = t.remove("a")
        self.assertEqual(result.removed_ids, ["a", "a1", "a1x", "a2"])
        self.assertNotIn("a", t)
        self.assertEqual(t.get_node("r").children, ["b", "c"])
        t.validate()

    def test_remove_root_empties_tree(self) -> None:
        t = build_sample_tree()
        t.remove("r")
        self.assertEqual(len(t), 0)
        self.assertIsNone(t.root_id)
        t.validate()

    def test_remove_missing_node(self) -> None:
        t = DocumentTree()
        with self.assertRaises(NodeNotFoundError):
            t.remove("ghost")

    # -- cascade（默认） -------------------------------------------------

    def test_cascade_removes_inbound_refs_and_reports(self) -> None:
        t = build_sample_tree()  # b1 -> a1
        result = t.remove("a1")
        self.assertEqual(result.removed_ids, ["a1", "a1x"])
        self.assertEqual(
            result.removed_refs, [{"owner": "b1", "target": "a1"}]
        )
        self.assertEqual(t.get_node("b1").refs, set())
        self.assertEqual(t.get_dangling_refs(), [])
        t.validate()

    def test_cascade_delete_all_referrers_of_deep_target(self) -> None:
        t = build_sample_tree()
        t.add_ref("c", "a1x")
        result = t.remove("a1")
        self.assertEqual(
            result.removed_refs,
            [
                {"owner": "b1", "target": "a1"},
                {"owner": "c", "target": "a1x"},
            ],
        )

    def test_internal_refs_disappear_with_subtree(self) -> None:
        # 专用树：子树内部互指，且子树外没有任何节点引用子树内的节点。
        t = DocumentTree()
        t.add("r", None, "section")
        t.add("a", "r", "section")
        t.add("a1", "a", "note")
        t.add("a2", "a", "note")
        t.add_ref("a2", "a1")  # 子树内部互指
        result = t.remove("a")
        self.assertEqual(result.removed_refs, [])  # 不清理内部引用
        t.validate()

    # -- strict ----------------------------------------------------------

    def test_strict_rejects_remove_with_inbound_refs(self) -> None:
        t = build_sample_tree(policy=POLICY_STRICT)  # b1 -> a1
        with self.assertRaises(DanglingReferenceError) as ctx:
            t.remove("a1")
        self.assertEqual(
            ctx.exception.dangling, [{"owner": "b1", "target": "a1"}]
        )
        # 回滚：节点和引用都还在。
        self.assertIn("a1", t)
        self.assertEqual(t.get_node("b1").refs, {"a1"})
        t.validate()

    def test_strict_allows_remove_without_inbound_refs(self) -> None:
        t = build_sample_tree(policy=POLICY_STRICT)
        t.remove("c")  # 没有任何引用涉及 c
        self.assertNotIn("c", t)

    # -- lenient ---------------------------------------------------------

    def test_lenient_keeps_dangling_refs(self) -> None:
        t = build_sample_tree(policy=POLICY_LENIENT)  # b1 -> a1
        result = t.remove("a1")
        self.assertEqual(result.removed_refs, [])
        dangling = t.get_dangling_refs()
        self.assertEqual(dangling, [{"owner": "b1", "target": "a1"}])
        resolved = t.resolve_refs("b1")
        self.assertFalse(resolved[0]["exists"])
        self.assertTrue(resolved[0]["dangling"])
        self.assertIsNone(resolved[0]["node"])
        # lenient 状态下 validate 必须通过。
        t.validate()

    def test_lenient_add_dangling_ref_directly(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "ghost")
        self.assertEqual(t.get_dangling_refs(), [{"owner": "o", "target": "ghost"}])

    def test_dangling_ref_resolves_when_target_recreated(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "x")
        t.add("x", "r", "note")
        self.assertEqual(t.get_dangling_refs(), [])
        self.assertTrue(t.resolve_refs("o")[0]["exists"])

    def test_remove_last_dangling_ref_clears_it(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "ghost")
        t.remove_ref("o", "ghost")
        self.assertEqual(t.get_dangling_refs(), [])

    # -- 策略切换 --------------------------------------------------------

    def test_switch_lenient_to_strict_with_dangling_fails(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "ghost")
        with self.assertRaises(DanglingReferenceError):
            t.set_ref_policy(POLICY_STRICT)
        self.assertEqual(t.ref_policy, POLICY_LENIENT)  # 未切换

    def test_switch_lenient_to_cascade_cleans_dangling(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "ghost")
        cleaned = t.set_ref_policy(POLICY_CASCADE)
        self.assertEqual(cleaned, [{"owner": "o", "target": "ghost"}])
        self.assertEqual(t.get_dangling_refs(), [])
        t.validate()

    def test_unknown_policy_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            DocumentTree(ref_policy="bogus")
        t = DocumentTree()
        with self.assertRaises(ValidationError):
            t.set_ref_policy("bogus")


class ValidateTest(unittest.TestCase):
    def test_valid_tree_passes(self) -> None:
        build_sample_tree().validate()
        DocumentTree().validate()

    def test_manual_corruption_detected(self) -> None:
        t = build_sample_tree()
        # 双向不一致。
        t.get_node("r").children.remove("c")
        with self.assertRaises(ValidationError):
            t.validate()

        t2 = build_sample_tree()
        t2.get_node("c").parent_id = "a"  # 但 a.children 不含 c
        with self.assertRaises(ValidationError):
            t2.validate()

        t3 = build_sample_tree()
        t3.get_node("a1").refs.add("a1")  # 自引用
        with self.assertRaises(ValidationError):
            t3.validate()


if __name__ == "__main__":
    unittest.main()
