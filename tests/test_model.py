"""节点模型（Node）与 MoveResult 的单元测试。"""

from __future__ import annotations

import unittest

from doctree.exceptions import ValidationError
from doctree.model import MoveResult, Node


class NodeModelTest(unittest.TestCase):
    def test_valid_node_defaults(self) -> None:
        n = Node(node_id="n1", parent_id=None, kind="section")
        self.assertEqual(n.content, "")
        self.assertEqual(n.children, [])
        self.assertEqual(n.refs, set())

    def test_empty_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id="", parent_id=None, kind="section")

    def test_non_string_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id=1, parent_id=None, kind="section")  # type: ignore[arg-type]

    def test_empty_kind_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id="n", parent_id=None, kind="")

    def test_bad_parent_type_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id="n", parent_id=1, kind="x")  # type: ignore[arg-type]

    def test_content_must_be_string(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id="n", parent_id=None, kind="x", content=123)  # type: ignore[arg-type]

    def test_self_reference_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Node(node_id="n", parent_id=None, kind="x", refs={"n"})

    def test_children_copied_refs_deduplicated_to_set(self) -> None:
        n = Node(node_id="n", parent_id=None, kind="x", children=["a", "a"], refs={"b", "b"})
        self.assertEqual(n.children, ["a", "a"])  # children 保留顺序与重复（由树层校验）
        self.assertEqual(n.refs, {"b"})

    def test_roundtrip_serialization(self) -> None:
        n = Node(node_id="n", parent_id="p", kind="note", content="c", children=["x"], refs={"a", "b"})
        data = n.to_dict()
        self.assertEqual(data["refs"], ["a", "b"])  # 排序输出
        n2 = Node.from_dict(data)
        self.assertEqual(n2, n)

    def test_from_dict_missing_fields(self) -> None:
        with self.assertRaises(ValueError):
            Node.from_dict({"node_id": "n"})
        with self.assertRaises(ValueError):
            Node.from_dict("not-a-dict")  # type: ignore[arg-type]

    def test_from_dict_duplicate_refs(self) -> None:
        data = {"node_id": "n", "parent_id": None, "kind": "x", "refs": ["a", "a"]}
        with self.assertRaises(ValueError):
            Node.from_dict(data)

    def test_move_result_to_dict(self) -> None:
        r = MoveResult(
            moved_ids=["a", "a1"],
            old_path=["r", "a"],
            new_path=["r", "b", "a"],
            affected_refs=[{"owner": "x", "target": "a1", "direction": "in"}],
        )
        d = r.to_dict()
        self.assertEqual(d["moved_ids"], ["a", "a1"])
        self.assertEqual(d["new_path"], ["r", "b", "a"])
        self.assertEqual(len(d["affected_refs"]), 1)


if __name__ == "__main__":
    unittest.main()
