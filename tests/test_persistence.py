"""增量保存 / 加载重建 / 版本回滚 / diff / 损坏文件校验的单元测试。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from typing import Any, Dict, List

from doctree.exceptions import (
    InvalidChangeError,
    ValidationError,
    VersionNotFoundError,
)
from doctree.persistence import FORMAT, FORMAT_VERSION, load, save
from doctree.tree import POLICY_LENIENT, DocumentTree


def build_editable_tree() -> DocumentTree:
    """r -> (a -> a1, b)，b1 -> a1。"""
    t = DocumentTree()
    t.add("r", None, "section")
    t.add("a", "r", "section")
    t.add("b", "r", "note")
    t.add("a1", "a", "note", content="v1")
    t.add_ref("b", "a1")
    return t


class JournalTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "tree.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def read_records(self) -> List[Dict[str, Any]]:
        with open(self.path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]


class SaveLoadBasicTest(JournalTestBase):
    def test_empty_tree_save_load(self) -> None:
        t = DocumentTree()
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(len(u), 0)
        self.assertEqual(u.version, 0)
        u.validate()

    def test_save_empty_then_edit_then_append(self) -> None:
        t = DocumentTree()
        save(t, self.path)
        t.add("r", None, "section")
        t.add("a", "r", "note")
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(u.preorder_ids(), ["r", "a"])
        self.assertEqual(u.version, 2)

    def test_save_then_load_state_identical(self) -> None:
        t = build_editable_tree()
        t.move("a", "r", 1)
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(u.version, t.version)
        self.assertEqual(u.preorder_ids(), t.preorder_ids())
        for nid in t.preorder_ids():
            self.assertEqual(u.get_node(nid).to_dict(), t.get_node(nid).to_dict())
        self.assertEqual(u.get_dangling_refs(), t.get_dangling_refs())

    def test_incremental_append_records_only(self) -> None:
        t = build_editable_tree()
        info1 = save(t, self.path)
        records_after_first = len(self.read_records())
        t.update_content("a1", "v2")
        t.add("c", "r", "note")
        info2 = save(t, self.path)
        records_after_second = len(self.read_records())
        self.assertEqual(info1["mode"], "full")
        self.assertEqual(info2["mode"], "append")
        self.assertEqual(info2["records_written"], 2)
        self.assertEqual(records_after_second - records_after_first, 2)

    def test_save_to_new_path_rewrites_full_journal(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        other = os.path.join(self._tmp.name, "other.dtj")
        info = save(t, other)
        self.assertEqual(info["mode"], "full")
        self.assertEqual(load(other).preorder_ids(), t.preorder_ids())

    def test_save_load_lenient_with_dangling(self) -> None:
        t = DocumentTree(ref_policy=POLICY_LENIENT)
        t.add("r", None, "section")
        t.add("o", "r", "note")
        t.add_ref("o", "ghost")
        t.add("x", "r", "note")
        t.remove("x")  # 无入边引用，普通删除
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(u.ref_policy, POLICY_LENIENT)
        self.assertEqual(u.get_dangling_refs(), [{"owner": "o", "target": "ghost"}])

    def test_header_format(self) -> None:
        save(build_editable_tree(), self.path)
        header = self.read_records()[0]
        self.assertEqual(header["type"], "header")
        self.assertEqual(header["format"], FORMAT)
        self.assertEqual(header["format_version"], FORMAT_VERSION)
        self.assertEqual(header["seq"], 1)

    def test_load_missing_file_raises(self) -> None:
        with self.assertRaises(FileNotFoundError):
            load(os.path.join(self._tmp.name, "nope.dtj"))


class ReplayValidationTest(JournalTestBase):
    def _corrupt_line(self, line_no_1based: int, new_text: str) -> None:
        with open(self.path, encoding="utf-8") as fh:
            lines = fh.readlines()
        lines[line_no_1based - 1] = new_text + "\n"
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            fh.writelines(lines)

    def test_non_json_line_reports_line_number(self) -> None:
        save(build_editable_tree(), self.path)
        self._corrupt_line(3, "{not json")
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 3", str(ctx.exception))

    def test_blank_line_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        self._corrupt_line(2, "")
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_bad_header_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        records = self.read_records()
        records[0]["format"] = "something-else"
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_non_consecutive_seq_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        records = self.read_records()
        records[-1]["seq"] = records[-1]["seq"] + 5
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertIn("seq", str(ctx.exception))
        self.assertIsNotNone(ctx.exception.change_index)

    def test_change_referencing_missing_node_rejected(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        # 追加一条 ref_add 指向不存在的 target（cascade 下非法）。
        last_seq = len(self.read_records())
        with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(
                json.dumps(
                    {
                        "type": "change",
                        "seq": last_seq + 1,
                        "segment": 0,
                        "base_version": t.version,
                        "version": t.version + 1,
                        "change": {"op": "ref_add", "owner": "b", "target": "ghost"},
                    }
                )
                + "\n"
            )
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        # 错误必须指出第几条变更。
        self.assertEqual(ctx.exception.change_no, 6)
        self.assertIsNotNone(ctx.exception.change_index)

    def test_move_creating_cycle_rejected(self) -> None:
        t = build_editable_tree()
        v = t.version
        save(t, self.path)
        last_seq = len(self.read_records())
        with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(
                json.dumps(
                    {
                        "type": "change",
                        "seq": last_seq + 1,
                        "segment": 0,
                        "base_version": v,
                        "version": v + 1,
                        "change": {"op": "move", "node_id": "a", "new_parent_id": "a1", "index": 0},
                    }
                )
                + "\n"
            )
        with self.assertRaises(InvalidChangeError):
            load(self.path)

    def test_move_bad_index_rejected(self) -> None:
        t = build_editable_tree()
        v = t.version
        save(t, self.path)
        last_seq = len(self.read_records())
        with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(
                json.dumps(
                    {
                        "type": "change",
                        "seq": last_seq + 1,
                        "segment": 0,
                        "base_version": v,
                        "version": v + 1,
                        "change": {"op": "move", "node_id": "b", "new_parent_id": "r", "index": 99},
                    }
                )
                + "\n"
            )
        with self.assertRaises(InvalidChangeError):
            load(self.path)

    def test_gap_in_base_version_rejected(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        records = self.read_records()
        # 篡改最后一条的 base_version，使其与前一条不衔接。
        records[-1]["base_version"] = 999
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(InvalidChangeError):
            load(self.path)

    def test_duplicate_version_number_rejected(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        last_seq = len(self.read_records())
        with open(self.path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(
                json.dumps(
                    {
                        "type": "change",
                        "seq": last_seq + 1,
                        "segment": 0,
                        "base_version": t.version,
                        "version": 1,  # 重复版本号
                        "change": {"op": "content", "node_id": "a1", "new": "x"},
                    }
                )
                + "\n"
            )
        with self.assertRaises(InvalidChangeError):
            load(self.path)

    def test_snapshot_base_version_mismatch_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        records = self.read_records()
        records[1]["base_version"] = 42  # 快照记录基准与快照内 version(0) 不符
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_corrupt_change_missing_field_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        records = self.read_records()
        # 0 号快照是“首次变更前”的空快照；节点由 add 变更创建。
        # 删掉第一条 add 变更中节点的 kind，重放必须报错并指出第几条变更。
        del records[2]["change"]["node"]["kind"]
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertEqual(ctx.exception.change_no, 1)

    def test_corrupt_segment_snapshot_missing_field_rejected(self) -> None:
        # 回滚产生第二个分段快照，破坏其中的节点字段应被快照校验拦住。
        t = build_editable_tree()
        save(t, self.path)
        t.rollback(3)
        save(t, self.path)
        records = self.read_records()
        snapshot_records = [r for r in records if r["type"] == "snapshot"]
        self.assertGreaterEqual(len(snapshot_records), 2)
        seg1 = snapshot_records[1]
        some_node = next(iter(seg1["snapshot"]["nodes"]))
        del seg1["snapshot"]["nodes"][some_node]["kind"]
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_snapshot_with_orphan_rejected(self) -> None:
        save(build_editable_tree(), self.path)
        records = self.read_records()
        # 在快照里塞一个父节点不存在的节点。
        records[1]["snapshot"]["nodes"]["zombie"] = {
            "node_id": "zombie",
            "parent_id": "ghost",
            "kind": "note",
            "content": "",
            "children": [],
            "refs": [],
        }
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_empty_file_rejected(self) -> None:
        open(self.path, "w").close()
        with self.assertRaises(ValidationError):
            load(self.path)


class VersioningTest(JournalTestBase):
    def test_version_increments_per_change(self) -> None:
        t = DocumentTree()
        self.assertEqual(t.version, 0)
        t.add("r", None, "section")
        self.assertEqual(t.version, 1)
        t.add("a", "r", "note")
        self.assertEqual(t.version, 2)

    def test_cascade_delete_records_each_ref_removal(self) -> None:
        t = build_editable_tree()  # b -> a1
        v_before = t.version
        t.remove("a1")  # 删 a1 + 级联清理 b->a1 = 2 条变更
        self.assertEqual(t.version, v_before + 2)

    def test_state_at_version_replay(self) -> None:
        t = build_editable_tree()
        save(t, self.path)  # v5
        t.update_content("a1", "v2")  # v6
        t.add("c", "r", "note")  # v7
        v0 = t.state_at_version(0)
        self.assertEqual(len(v0), 0)
        v5 = t.state_at_version(5)
        self.assertEqual(v5.get_node("a1").content, "v1")
        v6 = t.state_at_version(6)
        self.assertEqual(v6.get_node("a1").content, "v2")
        self.assertNotIn("c", v6)
        v7 = t.state_at_version(7)
        self.assertIn("c", v7)

    def test_state_at_unknown_version_raises(self) -> None:
        t = build_editable_tree()
        with self.assertRaises(VersionNotFoundError):
            t.state_at_version(999)
        with self.assertRaises(ValidationError):
            t.state_at_version("1")  # type: ignore[arg-type]

    def test_rollback_restores_state(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        t.update_content("a1", "v2")
        t.add("c", "r", "note")
        t.rollback(5)
        self.assertEqual(t.version, 5)
        self.assertEqual(t.get_node("a1").content, "v1")
        self.assertNotIn("c", t)
        self.assertEqual(t.get_node("r").children, ["a", "b"])
        t.validate()

    def test_rollback_unknown_version_raises(self) -> None:
        t = build_editable_tree()
        with self.assertRaises(VersionNotFoundError):
            t.rollback(42)

    def test_version_monotonic_after_rollback(self) -> None:
        t = build_editable_tree()  # v5
        t.update_content("a1", "v2")  # v6
        t.rollback(5)
        t.update_content("a1", "v3")
        self.assertEqual(t.version, 7)  # 不复用 6
        # 回滚后新分段只含新版本号 7，旧版本 6 留在旧分段里只读保留。
        new_segment_versions = [w["version"] for w in t._segments[-1]["changes"]]
        self.assertEqual(new_segment_versions, [7])

    def test_rollback_edit_save_load_roundtrip(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        t.update_content("a1", "v2")  # v6
        t.add("c", "r", "note")      # v7
        save(t, self.path)
        t.rollback(5)
        t.update_content("a1", "v3")  # v8
        save(t, self.path)

        u = load(self.path)
        self.assertEqual(u.version, 8)
        self.assertEqual(u.get_node("a1").content, "v3")
        self.assertNotIn("c", u)
        # 历史版本仍可从文件重放。
        self.assertEqual(u.state_at_version(6).get_node("a1").content, "v2")
        self.assertEqual(u.state_at_version(7).get_node("a1").content, "v2")
        self.assertIn("c", u.state_at_version(7))
        self.assertEqual(u.state_at_version(8).get_node("a1").content, "v3")
        u.rollback(6)
        self.assertEqual(u.version, 6)
        u.validate()

    def test_history_lists_all_versions(self) -> None:
        t = build_editable_tree()  # v5：v3 时 r/a/b 已存在，a1 在 v4 加入
        t.rollback(3)
        t.update_content("b", "z")  # v6，不复用 4/5
        self.assertEqual(t.history(), [0, 1, 2, 3, 4, 5, 6])

    def test_diff_versions_add_remove_move_content_refs(self) -> None:
        t = DocumentTree()
        t.add("r", None, "section")  # 1
        t.add("a", "r", "note")      # 2
        t.add("b", "r", "note")      # 3
        t.add_ref("b", "a")          # 4
        t.update_content("a", "txt")  # 5
        t.move("b", "a", 0)          # 6：跨层移动，b 的父节点 r -> a
        d = t.diff_versions(0, 6).to_dict()
        self.assertEqual(d["added"], ["a", "b", "r"])
        self.assertEqual(d["removed"], [])

        # 其余类别只统计“两版本都存在”的节点，按相邻版本区间比较：
        # v3 -> v4 是加引用，v4 -> v5 是改内容，v5 -> v6 是跨层移动。
        d_ref = t.diff_versions(3, 4).to_dict()
        self.assertEqual(d_ref["refs_added"], [{"owner": "b", "target": "a"}])
        self.assertEqual(d_ref["refs_removed"], [])
        d_content = t.diff_versions(4, 5).to_dict()
        self.assertEqual(d_content["content_changed"],
                         [{"node_id": "a", "old": "", "new": "txt"}])

        # moved：拿移动前后（v5 -> v6）比较。
        dm = t.diff_versions(5, 6).to_dict()
        self.assertEqual(len(dm["moved"]), 1)
        self.assertEqual(dm["moved"][0]["node_id"], "b")
        self.assertEqual(dm["moved"][0]["old_parent_id"], "r")
        self.assertEqual(dm["moved"][0]["new_parent_id"], "a")
        self.assertEqual(dm["moved"][0]["new_path"], ["r", "a", "b"])

        d2 = t.diff_versions(6, 5).to_dict()
        self.assertEqual(d2["added"], [])
        self.assertEqual(d2["removed"], [])
        self.assertEqual(len(d2["moved"]), 1)
        self.assertEqual(d2["moved"][0]["node_id"], "b")

        # 反向跨多个版本：v6 的 a 内容为 txt，v4 为空。
        d3 = t.diff_versions(6, 4).to_dict()
        self.assertEqual(d3["content_changed"], [{"node_id": "a", "old": "txt", "new": ""}])

    def test_diff_sibling_reorder_reports_shifted_positions(self) -> None:
        # 同父重排：被拖动节点与发生位移的兄弟都会出现在 moved 中。
        t = DocumentTree()
        t.add("r", None, "section")  # 1
        t.add("a", "r", "note")      # 2
        t.add("b", "r", "note")      # 3
        t.move("b", "r", 0)          # 4：[a,b] -> [b,a]
        d = t.diff_versions(3, 4).to_dict()
        moved_ids = {m["node_id"] for m in d["moved"]}
        self.assertEqual(moved_ids, {"a", "b"})

    def test_diff_after_cascade_delete(self) -> None:
        t = build_editable_tree()
        v = t.version
        t.remove("a1")
        d = t.diff_versions(v, t.version).to_dict()
        self.assertEqual(d["removed"], ["a1"])
        self.assertEqual(d["refs_removed"], [{"owner": "b", "target": "a1"}])

    def test_loaded_tree_edits_append_valid_journal(self) -> None:
        t = build_editable_tree()
        save(t, self.path)
        u = load(self.path)
        self.assertEqual(u.version, 5)
        u.update_content("a1", "after-load")
        save(u, self.path)
        w = load(self.path)
        self.assertEqual(w.version, 6)
        self.assertEqual(w.get_node("a1").content, "after-load")


if __name__ == "__main__":
    unittest.main()
