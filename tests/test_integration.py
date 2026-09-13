"""端到端集成测试：多棵嵌套树、跨层拖拽、引用、回滚后持久化的综合场景。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from typing import Any, Dict, List

import main as cli
from doctree import POLICY_CASCADE, POLICY_LENIENT, POLICY_STRICT, DocumentTree, load
from doctree.persistence import save


def build_deep_tree() -> DocumentTree:
    r"""构造 4 层 11 节点树::

        root
        ├─ s1
        │  ├─ s1a
        │  │  ├─ l1 (note)
        │  │  └─ l2 (note)
        │  └─ s1b
        │     └─ l3 (ref) -> l1
        ├─ s2
        │  └─ l4 (note)
        └─ s3
           ├─ l5 (note)
           └─ l6 (note) -> l4
    """
    t = DocumentTree()
    t.add("root", None, "section")
    t.add("s1", "root", "section")
    t.add("s2", "root", "section")
    t.add("s3", "root", "section")
    t.add("s1a", "s1", "section")
    t.add("s1b", "s1", "section")
    t.add("l1", "s1a", "note", content="one")
    t.add("l2", "s1a", "note", content="two")
    t.add("l3", "s1b", "ref")
    t.add("l4", "s2", "note", content="four")
    t.add("l5", "s3", "note", content="five")
    t.add("l6", "s3", "note", content="six")
    t.add_ref("l3", "l1")
    t.add_ref("l6", "l4")
    return t


class DeepTreeIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tree = build_deep_tree()

    def test_initial_structure(self) -> None:
        self.assertEqual(len(self.tree), 12)
        self.assertEqual(
            self.tree.preorder_ids(),
            ["root", "s1", "s1a", "l1", "l2", "s1b", "l3", "s2", "l4", "s3", "l5", "l6"],
        )
        self.tree.validate()

    def test_deep_cross_level_move(self) -> None:
        # 把 s1a 整棵子树从 s1 下移到 s3 下中间位置。
        result = self.tree.move("s1a", "s3", 1)
        self.assertEqual(result.moved_ids, ["s1a", "l1", "l2"])
        self.assertEqual(result.new_path, ["root", "s3", "s1a"])
        self.assertEqual(self.tree.get_path("l2"), ["root", "s3", "s1a", "l2"])
        # l3 -> l1 是跨越移动子树边界的入边引用。
        self.assertIn(
            {"owner": "l3", "target": "l1", "direction": "in"},
            result.affected_refs,
        )
        # 引用仍然有效。
        self.assertEqual(self.tree.get_node("l3").refs, {"l1"})
        self.tree.validate()

    def test_cascade_delete_middle_subtree_cleans_refs(self) -> None:
        result = self.tree.remove("s1a")
        self.assertEqual(result.removed_ids, ["s1a", "l1", "l2"])
        self.assertEqual(result.removed_refs, [{"owner": "l3", "target": "l1"}])
        self.assertEqual(self.tree.get_node("l3").refs, set())
        self.assertEqual(self.tree.get_dangling_refs(), [])
        self.tree.validate()

    def test_lenient_delete_marks_dangling(self) -> None:
        self.tree.set_ref_policy(POLICY_LENIENT)
        self.tree.remove("s2")  # l6 -> l4 变悬空
        dangling = self.tree.get_dangling_refs()
        self.assertEqual(dangling, [{"owner": "l6", "target": "l4"}])
        resolved = [r for r in self.tree.resolve_refs("l6") if r["target"] == "l4"][0]
        self.assertTrue(resolved["dangling"])
        # 重建目标节点后悬空消除。
        self.tree.add("l4", "s2" if "s2" in self.tree else "root", "note", content="new-four")
        self.assertEqual(self.tree.get_dangling_refs(), [])

    def test_strict_delete_blocked_then_cascade_succeeds(self) -> None:
        self.tree.set_ref_policy(POLICY_STRICT)
        with self.assertRaises(Exception):
            self.tree.remove("s1a")
        self.tree.set_ref_policy(POLICY_CASCADE)
        result = self.tree.remove("s1a")
        self.assertEqual(result.removed_refs, [{"owner": "l3", "target": "l1"}])


class RebuildAfterFullDeleteTest(unittest.TestCase):
    def test_remove_root_then_add_new_root(self) -> None:
        t = build_deep_tree()
        t.remove("root")
        self.assertEqual(len(t), 0)
        self.assertIsNone(t.root_id)
        t.add("newroot", None, "section")
        t.add("n1", "newroot", "note")
        self.assertEqual(t.preorder_ids(), ["newroot", "n1"])
        t.validate()

    def test_replay_remove_and_rebuild_root(self) -> None:
        t = build_deep_tree()
        v = t.version
        t.remove("root")
        t.add("newroot", None, "section")
        rebuilt = t.state_at_version(t.version)
        self.assertEqual(rebuilt.preorder_ids(), ["newroot"])
        middle = t.state_at_version(v + 1)
        self.assertEqual(len(middle), 0)


class PersistenceLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "life.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_multi_save_load_with_moves_and_refs(self) -> None:
        t = build_deep_tree()
        save(t, self.path)
        t.move("s2", "s1", 1)
        t.update_content("l1", "changed")
        save(t, self.path)
        t.set_ref_policy(POLICY_LENIENT)
        t.remove("l4")
        save(t, self.path)

        u = load(self.path)
        u.validate()
        self.assertEqual(u.preorder_ids(), t.preorder_ids())
        self.assertEqual(u.ref_policy, POLICY_LENIENT)
        self.assertEqual(u.get_dangling_refs(), [{"owner": "l6", "target": "l4"}])
        self.assertEqual(u.get_node("l1").content, "changed")

    def test_rollback_save_without_further_edits(self) -> None:
        t = build_deep_tree()
        save(t, self.path)
        v = t.version
        t.update_content("l1", "temp")
        save(t, self.path)
        t.rollback(v)
        save(t, self.path)  # 回滚后不编辑直接保存：新分段只有 checkpoint 快照
        u = load(self.path)
        self.assertEqual(u.version, v)
        self.assertEqual(u.get_node("l1").content, "one")
        # 旧版本仍可重放。
        self.assertEqual(u.state_at_version(v + 1).get_node("l1").content, "temp")

    def test_double_rollback_then_edit(self) -> None:
        t = build_deep_tree()
        v_full = t.version
        t.update_content("l1", "a")
        va = t.version
        t.update_content("l2", "b")
        t.rollback(v_full)          # 跨版本回退：产生新分段
        self.assertEqual(len(t._segments), 2)
        segs_after_first = len(t._segments)
        t.rollback(v_full)          # 已在目标版本：无操作，不再产生分段
        self.assertEqual(len(t._segments), segs_after_first)
        t.rollback(0)
        self.assertEqual(len(t), 0)
        t.add("z", None, "section")
        self.assertGreater(t.version, va)  # 版本号持续单调

    def test_lenient_roundtrip_preserves_dangling_through_rollback(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add("x", "r", "note")
        t.add_ref("o", "x")
        save(t, self.path)
        t.remove("x")  # 悬空
        dangling_version = t.version
        save(t, self.path)
        t.add("y", "r", "note")
        save(t, self.path)

        u = load(self.path)
        at_dangling = u.state_at_version(dangling_version)
        self.assertEqual(at_dangling.get_dangling_refs(), [{"owner": "o", "target": "x"}])
        self.assertEqual(at_dangling.ref_policy, POLICY_LENIENT)


class CliEndToEndTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "e2e.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run_file(self, commands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        import io

        text = "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in commands)
        out = io.StringIO()
        cli.run(io.StringIO(text), out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_scripted_session_matches_in_process(self) -> None:
        commands = [
            {"op": "add", "node_id": "root", "parent_id": None, "kind": "section"},
            {"op": "add", "node_id": "a", "parent_id": "root", "kind": "section"},
            {"op": "add", "node_id": "b", "parent_id": "root", "kind": "note"},
            {"op": "add", "node_id": "a1", "parent_id": "a", "kind": "note", "content": "x"},
            {"op": "add_ref", "owner": "b", "target": "a1"},
            {"op": "move", "node_id": "a", "parent_id": "root", "index": 1},
            {"op": "save", "path": self.path},
            {"op": "policy", "policy": "lenient"},
            {"op": "remove", "node_id": "a1"},
            {"op": "dangling"},
            {"op": "save", "path": self.path},
        ]
        results = self._run_file(commands)
        for i, r in enumerate(results):
            self.assertNotIn("error", r, f"command {i}: {r}")
        self.assertEqual(results[9]["dangling"], [{"owner": "b", "target": "a1"}])
        self.assertEqual(results[10]["mode"], "append")

        # 用新会话 load，状态应一致。
        loaded = self._run_file(
            [{"op": "load", "path": self.path}, {"op": "dangling"}]
        )
        self.assertEqual(loaded[0]["policy"], "lenient")
        self.assertEqual(loaded[1]["dangling"], [{"owner": "b", "target": "a1"}])

    def test_cli_error_on_bad_diff_version(self) -> None:
        results = self._run_file(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "diff", "v1": 0, "v2": 99},
            ]
        )
        self.assertEqual(results[1]["code"], "version_not_found")


if __name__ == "__main__":
    unittest.main()
