"""JSON 保存/载入、往返一致性、损坏文件拒绝与原状态保持测试。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

import doctree
from doctree import DocumentTree, SerializationError
from doctree.model import DanglingPolicy
from doctree.persistence import Serde, dumps, load_into, loads
from tests.util import build_doc_tree, clear_history, structure


class RoundTripTests(unittest.TestCase):
    def test_empty_tree_roundtrip(self) -> None:
        tree = DocumentTree()
        restored = loads(dumps(tree))
        self.assertEqual(structure(restored), structure(tree))
        self.assertEqual(restored.undo_depth, 0)

    def test_full_tree_roundtrip(self) -> None:
        tree = build_doc_tree()
        restored = loads(dumps(tree))
        self.assertEqual(structure(restored), structure(tree))
        self.assertEqual(restored.all_node_ids(), tree.all_node_ids())

    def test_roundtrip_preserves_order_and_paths(self) -> None:
        tree = clear_history(build_doc_tree())
        tree.move("ch2", "s2", 0)
        tree.move("n1", None, 0)
        tree.undo()
        restored = loads(dumps(tree))
        self.assertEqual(
            restored.node("doc").children, tree.node("doc").children
        )
        self.assertEqual(restored.path_of("n3"), tree.path_of("n3"))
        self.assertEqual(restored.undo_depth, 1)
        self.assertEqual(restored.redo_depth, 1)

    def test_undo_redo_history_survives_roundtrip(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        tree.delete("n2")
        tree.undo()
        state_before = structure(tree)

        restored = loads(dumps(tree))
        # 载入后撤销可精确回到删除前
        restored.undo()
        expected = tree
        expected.undo()
        self.assertEqual(structure(restored), structure(expected))
        # 两边都可以重做
        restored.redo()
        expected.redo()
        self.assertEqual(structure(restored), structure(expected))
        self.assertEqual(structure(restored), state_before)

    def test_dangling_policy_roundtrip(self) -> None:
        tree = DocumentTree(policy=DanglingPolicy.KEEP_DANGLING)
        tree.add_node("r")
        tree.add_node("a", "r")
        tree.add_node("b", "r")
        tree.add_reference("a", "b")
        tree.delete("b")
        self.assertEqual(len(tree.dangling_references()), 1)
        restored = loads(dumps(tree))
        self.assertIs(restored.policy, DanglingPolicy.KEEP_DANGLING)
        self.assertEqual(len(restored.dangling_references()), 1)


    def test_redo_branch_roundtrip_uses_pop_order(self) -> None:
        """redo 栈按“最近撤销在前”存储；文件校验必须按实际重做顺序（栈尾先）回放。

        回归：同类型命令连续撤销多个后保存，旧实现按存储顺序应用 redo，
        导致载入自校验误判文件损坏。
        """
        tree = DocumentTree()
        tree.add_node("r")
        tree.add_node("a", "r")
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
        tree.set_dangling_policy(DanglingPolicy.CASCADE)
        tree.set_dangling_policy(DanglingPolicy.KEEP_DANGLING)
        tree.undo()
        tree.undo()
        tree.undo()
        self.assertEqual(tree.redo_depth, 3)
        restored = loads(dumps(tree))  # 曾在此抛 SerializationError
        self.assertEqual(restored.redo_depth, 3)
        restored.redo()
        restored.redo()
        restored.redo()
        self.assertIs(restored.policy, DanglingPolicy.KEEP_DANGLING)


class FileIoTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "doc.json")

    def tearDown(self) -> None:
        for name in os.listdir(self.tmp):
            os.unlink(os.path.join(self.tmp, name))
        os.rmdir(self.tmp)

    def test_save_and_load_file(self) -> None:
        tree = build_doc_tree()
        doctree.save_to_file(tree, self.path)
        self.assertTrue(os.path.exists(self.path))
        restored = doctree.load_from_file(self.path)
        self.assertEqual(structure(restored), structure(tree))

    def test_load_into_keeps_identity_and_preserves_on_failure(self) -> None:
        tree = build_doc_tree()
        doctree.save_to_file(tree, self.path)
        target = DocumentTree()
        target.add_node("existing")
        returned = load_into(target, self.path)
        self.assertIs(returned, target)
        self.assertIn("doc", target)

        bad = os.path.join(self.tmp, "bad.json")
        with open(bad, "w", encoding="utf-8") as handle:
            handle.write("{ not json")
        before = structure(target)
        with self.assertRaises(SerializationError):
            load_into(target, bad)
        # 失败后原状态保持不变，且对象标识不变
        self.assertIs(returned, target)
        self.assertEqual(structure(target), before)

    def test_load_missing_file(self) -> None:
        with self.assertRaises(SerializationError):
            doctree.load_from_file(os.path.join(self.tmp, "nope.json"))


class CorruptFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self.good = Serde.tree_to_dict(build_doc_tree())

    def _expect_error(self, data: object) -> None:
        with self.assertRaises(SerializationError):
            Serde.dict_to_tree(data)

    def test_not_json(self) -> None:
        with self.assertRaises(SerializationError):
            loads("<<<not json>>>")

    def test_missing_fields(self) -> None:
        for field_name in ("version", "policy", "roots", "nodes"):
            data = json.loads(json.dumps(self.good))
            del data[field_name]
            self._expect_error(data)

    def test_bad_version(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["version"] = 999
        self._expect_error(data)

    def test_bad_policy(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["policy"] = "weird"
        self._expect_error(data)

    def test_duplicate_id(self) -> None:
        data = json.loads(json.dumps(self.good))
        # 让两个键映射到同一个 id
        data["nodes"]["n2"]["id"] = "n1"
        self._expect_error(data)

    def test_parent_child_mismatch(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n1"]["parent"] = "doc"  # 但 s1.children 仍含 n1
        self._expect_error(data)

    def test_dangling_child(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["s1"]["children"].append("ghost")
        self._expect_error(data)

    def test_missing_parent(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n1"]["parent"] = "ghost"
        self._expect_error(data)

    def test_self_parent_cycle(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n1"]["parent"] = "n1"
        self._expect_error(data)

    def test_indirect_cycle(self) -> None:
        # 构造与根断开的三环：s1 -> s2 -> n1 -> s1（双向链接保持一致，
        # 但整组节点从根不可达且成环，必须被拒绝）。
        data = json.loads(json.dumps(self.good))
        data["nodes"]["ch1"]["children"] = []
        data["nodes"]["s1"]["parent"] = "n1"
        data["nodes"]["s1"]["children"] = ["s2"]
        data["nodes"]["s2"]["parent"] = "s1"
        data["nodes"]["s2"]["children"] = ["n1"]
        data["nodes"]["n1"]["parent"] = "s2"
        data["nodes"]["n1"]["children"] = ["s1"]
        self._expect_error(data)

    def test_roots_parent_inconsistency(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["roots"] = ["doc", "ch1"]  # ch1 仍有父节点
        self._expect_error(data)

    def test_self_reference(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n2"]["references"].append("n2")
        self._expect_error(data)

    def test_duplicate_reference(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n2"]["references"].append("n3")
        data["nodes"]["n2"]["references"].append("n3")
        self._expect_error(data)

    def test_dangling_reference_rejected_under_cascade(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["nodes"]["n2"]["references"].append("ghost")
        self._expect_error(data)

    def test_dangling_reference_accepted_under_keep(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["policy"] = DanglingPolicy.KEEP_DANGLING.value
        data["nodes"]["n2"]["references"].append("ghost")
        del data["history"]  # 无历史文件：悬空引用按策略接受并标记
        restored = Serde.dict_to_tree(data)
        self.assertEqual(
            [(v.target, v.dangling) for v in restored.references_of("n2")],
            [("ghost", True)],
        )

    def test_duplicate_root(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["roots"] = ["doc", "doc"]
        self._expect_error(data)

    def test_root_missing_in_nodes(self) -> None:
        data = json.loads(json.dumps(self.good))
        data["roots"] = ["doc", "ghost"]
        self._expect_error(data)

    def test_history_inconsistent_with_state_rejected(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        data = json.loads(dumps(tree))
        # 篡改当前结构，但历史仍声称可回到该结构
        data["nodes"]["s1"]["parent"] = "doc"
        data["nodes"]["ch1"]["children"].insert(0, "s1")
        data["nodes"]["ch2"]["children"] = []
        with self.assertRaises(SerializationError):
            Serde.dict_to_tree(data)

    def test_malformed_history_command_rejected(self) -> None:
        tree = build_doc_tree()
        tree.move("s1", "ch2", 0)
        data = json.loads(dumps(tree))
        del data["history"]["undo"][0]["node_id"]
        with self.assertRaises(SerializationError):
            Serde.dict_to_tree(data)


if __name__ == "__main__":
    unittest.main()
