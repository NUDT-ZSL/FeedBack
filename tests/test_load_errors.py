"""load 异常路径的错误质量与加载原子性测试。

覆盖：seq 不连续、基准版本错配、引用不存在节点、移动成环、index 越界、
重复版本、快照损坏、分段交错、非 JSON / 空行 / 坏 header 等；断言错误信息
能定位到“第几条变更 / 行号 / op / node_id / 被破坏的约束”，并验证加载
失败不会产生半成品对象（CLI 会话保持加载前状态的测试见
``test_cli_blackbox.py``）。
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from typing import Any, Callable, Dict, List, Optional

from doctree import DocumentTree
from doctree.exceptions import InvalidChangeError, ValidationError
from doctree.persistence import load, save


class CorruptJournalTestBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name
        self.path = os.path.join(self.dir, "tree.dtj")
        tree = DocumentTree()
        tree.add("r", None, "section")
        tree.add("a", "r", "section")
        tree.add("a1", "a", "note", content="hello")
        tree.add("b", "r", "note")
        tree.add_ref("b", "a1")  # 最后一条是 ref_add，共 5 条变更
        save(tree, self.path)
        # 记录行数：header(1) + snapshot(1) + 5 changes = 7。
        self.initial_lines = 7

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _records(self) -> List[Dict[str, Any]]:
        with open(self.path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]

    def _write(self, records: List[Dict[str, Any]], *, raw_lines: Optional[List[str]] = None) -> None:
        with open(self.path, "w", encoding="utf-8", newline="\n") as fh:
            if raw_lines is not None:
                fh.writelines(line + "\n" for line in raw_lines)
            else:
                for r in records:
                    fh.write(json.dumps(r) + "\n")

    def _tail_change_version(self) -> int:
        recs = self._records()
        return max(r["version"] for r in recs if r.get("type") == "change")

    def _append_change(self, change: Dict[str, Any], *, segment: int = 0) -> None:
        recs = self._records()
        last_version = (
            max(r["version"] for r in recs if r.get("type") == "change" and r.get("segment") == segment)
            if any(r.get("type") == "change" and r.get("segment") == segment for r in recs)
            else recs[1]["base_version"]
        )
        recs.append(
            {
                "type": "change",
                "seq": len(recs) + 1,
                "segment": segment,
                "base_version": last_version,
                "version": last_version + 1,
                "change": change,
            }
        )
        self._write(recs)

    def assertLoadFails(
        self,
        expected: type,
        *,
        check: Optional[Callable[[Exception], None]] = None,
    ) -> Exception:
        with self.assertRaises(expected) as ctx:
            load(self.path)
        if check is not None:
            check(ctx.exception)
        return ctx.exception


class SeqAndStructureTest(CorruptJournalTestBase):
    def test_gap_in_seq_reports_expected_and_actual(self) -> None:
        recs = self._records()
        # 最后一条记录 seq=7（第 5 条变更位于第 7 行）。
        self.assertEqual(recs[-1]["seq"], 7)
        recs[-1]["seq"] += 4  # 7 -> 11，断号
        self._write(recs)

        def check(exc: Exception) -> None:
            self.assertIsInstance(exc, InvalidChangeError)
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.change_no, 5)       # 第 5 条变更
            self.assertEqual(exc.line_no, self.initial_lines)
            self.assertEqual(exc.op, "ref_add")
            self.assertEqual(exc.node_id, "b")
            message = str(exc)
            self.assertIn("not consecutive", message)
            self.assertIn("11", message)       # 实际读到的 seq
            self.assertIn("after seq 6", message)
            self.assertIn("expected 7", message)  # 缺口从缺失的 seq 7 开始

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_duplicated_record_seq_reports_overlap(self) -> None:
        # 手工归档常见损坏：某条 change 行被复制了一份，导致序号回退/重叠。
        recs = self._records()
        duplicate = json.loads(json.dumps(recs[5]))  # 第 4 条变更，seq=6
        recs.insert(5, duplicate)
        self._write(recs)

        def check(exc: Exception) -> None:
            assert isinstance(exc, InvalidChangeError)
            message = str(exc)
            self.assertIn("not consecutive", message)
            self.assertIn("duplicated", message)  # 重叠（而非缺记录）措辞

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_swapped_change_lines_rejected(self) -> None:
        # 交换相邻两条 change 行：seq 立刻不连续，错误定位到先出现的异常行。
        recs = self._records()
        recs[4], recs[5] = recs[5], recs[4]
        self._write(recs)
        with self.assertRaises(InvalidChangeError):
            load(self.path)

    def test_deleted_record_detected_as_gap(self) -> None:
        # 删掉倒数第二条记录，重排行尾 seq 也无法掩盖链断裂（base 不匹配）。
        recs = self._records()
        del recs[-2]
        self._write(recs)
        with self.assertRaises((InvalidChangeError, ValidationError)):
            load(self.path)

    def test_truncated_but_consistent_prefix_loads(self) -> None:
        # 崩溃恢复语义：文件尾部丢失但剩余记录序号连续、链完整时，
        # 重建到“最后一个一致状态”（没有跳过任何仍在文件里的变更）。
        lines = open(self.path, encoding="utf-8").read().splitlines()
        self._write([], raw_lines=lines[:3])  # header + snapshot + 第一条 add
        loaded = load(self.path)
        self.assertEqual(loaded.version, 1)
        self._write([], raw_lines=lines[:2])  # header + snapshot = 空树 v0
        self.assertEqual(load(self.path).version, 0)
        self._write([], raw_lines=lines[:1])  # 只有 header：容错为空树 v0
        self.assertEqual(load(self.path).version, 0)

    def test_blank_line_rejected_with_line_number(self) -> None:
        lines = open(self.path, encoding="utf-8").read().splitlines()
        lines.insert(3, "")
        self._write([], raw_lines=lines)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 4", str(ctx.exception))

    def test_non_json_line_reports_column(self) -> None:
        lines = open(self.path, encoding="utf-8").read().splitlines()
        lines[2] = '{"op": "add", broken'
        self._write([], raw_lines=lines)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 3", str(ctx.exception))
        self.assertIn("invalid JSON", str(ctx.exception))

    def test_bad_header(self) -> None:
        recs = self._records()
        recs[0]["format"] = "unknown"
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 1", str(ctx.exception))

    def test_first_record_not_header(self) -> None:
        recs = self._records()
        recs[0]["type"] = "change"
        self._write(recs)
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_missing_seq_field(self) -> None:
        recs = self._records()
        del recs[2]["seq"]
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 3", str(ctx.exception))

    def test_empty_file(self) -> None:
        open(self.path, "w").close()
        with self.assertRaises(ValidationError):
            load(self.path)


class ChangeReplayErrorContextTest(CorruptJournalTestBase):
    def test_ref_to_missing_node(self) -> None:
        recs = self._records()
        # 把第 5 条变更（ref_add b->a1）改成指向不存在节点。
        last = recs[-1]
        self.assertEqual(last["change"]["op"], "ref_add")
        last["change"]["target"] = "ghost"
        self._write(recs)

        def check(exc: Exception) -> None:
            self.assertIsInstance(exc, InvalidChangeError)
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.change_no, 5)
            self.assertEqual(exc.line_no, 7)
            self.assertEqual(exc.op, "ref_add")
            self.assertEqual(exc.node_id, "b")  # owner
            self.assertIn("ghost", str(exc))
            self.assertIn("does not exist", str(exc))
            data = exc.to_dict()
            self.assertEqual(data["change_no"], 5)
            self.assertEqual(data["line_no"], 7)
            self.assertEqual(data["node_id"], "b")

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_move_creating_cycle(self) -> None:
        self._append_change({"op": "move", "node_id": "a", "new_parent_id": "a1", "index": 0})

        def check(exc: Exception) -> None:
            self.assertIsInstance(exc, InvalidChangeError)
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.op, "move")
            self.assertEqual(exc.node_id, "a")
            self.assertEqual(exc.change_no, 6)
            self.assertIn("cycle", str(exc))

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_move_index_out_of_range(self) -> None:
        self._append_change({"op": "move", "node_id": "b", "new_parent_id": "r", "index": 99})

        def check(exc: Exception) -> None:
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.node_id, "b")
            self.assertIn("out of range", str(exc))
            self.assertEqual(exc.change_no, 6)

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_move_to_missing_parent(self) -> None:
        self._append_change({"op": "move", "node_id": "b", "new_parent_id": "ghost", "index": 0})

        def check(exc: Exception) -> None:
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.op, "move")
            self.assertEqual(exc.node_id, "b")
            self.assertIn("ghost", str(exc))

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_add_with_missing_kind(self) -> None:
        recs = self._records()
        # 第 1 条变更（行 3）是 add r，删掉 kind。
        del recs[2]["change"]["node"]["kind"]
        self._write(recs)

        def check(exc: Exception) -> None:
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.change_no, 1)
            self.assertEqual(exc.line_no, 3)
            self.assertEqual(exc.node_id, "r")
            self.assertIn("missing fields", str(exc))
            self.assertIn("kind", str(exc))

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_add_self_reference(self) -> None:
        # 追加一条 add，其 refs 里含自身 id。
        recs = self._records()
        v = self._tail_change_version()
        recs.append(
            {
                "type": "change",
                "seq": len(recs) + 1,
                "segment": 0,
                "base_version": v,
                "version": v + 1,
                "change": {
                    "op": "add",
                    "node": {
                        "node_id": "z",
                        "parent_id": "r",
                        "kind": "note",
                        "content": "",
                        "children": [],
                        "refs": ["z"],
                    },
                },
            }
        )
        self._write(recs)
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertEqual(ctx.exception.node_id, "z")

    def test_remove_missing_node(self) -> None:
        self._append_change({"op": "remove", "node_id": "ghost"})
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertEqual(ctx.exception.node_id, "ghost")
        self.assertIn("does not exist", str(ctx.exception))

    def test_content_change_missing_node(self) -> None:
        self._append_change({"op": "content", "node_id": "ghost", "new": "x"})
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertEqual(ctx.exception.node_id, "ghost")

    def test_unknown_op(self) -> None:
        self._append_change({"op": "frobnicate"})
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertIn("frobnicate", str(ctx.exception))


class VersionChainTest(CorruptJournalTestBase):
    def test_base_version_mismatch_reports_both_versions(self) -> None:
        recs = self._records()
        # 第 2 条变更（行 4）base_version 被改坏。
        recs[3]["base_version"] = 99
        self._write(recs)

        def check(exc: Exception) -> None:
            assert isinstance(exc, InvalidChangeError)
            self.assertEqual(exc.change_no, 2)
            self.assertEqual(exc.line_no, 4)
            message = str(exc)
            self.assertIn("99", message)
            self.assertIn("does not match", message)
            self.assertIn("replayed state version 1", message)

        self.assertLoadFails(InvalidChangeError, check=check)

    def test_duplicate_version_number(self) -> None:
        recs = self._records()
        recs[-1]["version"] = 1  # 与第 1 条变更重复
        self._write(recs)
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        self.assertIn("duplicate version", str(ctx.exception))

    def test_version_not_greater_than_base_rejected(self) -> None:
        # 线性历史上 version<=base 时该版本号必已在 established 集合中，
        # 因此“版本必须严格大于 base”这一约束首先以重复版本号的形式暴露；
        # 两者都属于 InvalidChangeError 且必须拒绝、不静默跳过。
        recs = self._records()
        recs[-1]["version"] = recs[-1]["base_version"]
        self._write(recs)
        with self.assertRaises(InvalidChangeError) as ctx:
            load(self.path)
        message = str(ctx.exception)
        self.assertTrue(
            "duplicate version" in message or "must be greater than base_version" in message,
            message,
        )

    def test_snapshot_inner_version_mismatch(self) -> None:
        recs = self._records()
        recs[1]["base_version"] = 3  # 记录基准 3，但快照内 version=0
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        message = str(ctx.exception)
        self.assertIn("line 2", message)
        self.assertIn("base_version mismatch", message)

    def test_segment_checkpoint_unknown_branch_point(self) -> None:
        # 回滚产生的 segment 1 快照基准必须是已知历史版本。
        tree = DocumentTree()
        tree.add("r", None, "section")
        save(tree, self.path)
        recs = self._records()
        snap = json.loads(json.dumps(recs[1]["snapshot"]))
        snap["version"] = 42
        recs.append(
            {
                "type": "snapshot",
                "seq": len(recs) + 1,
                "segment": 1,
                "base_version": 42,
                "snapshot": snap,
            }
        )
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("not reachable", str(ctx.exception))

    def test_change_for_segment_before_snapshot(self) -> None:
        recs = self._records()
        v = self._tail_change_version()
        recs.append(
            {
                "type": "change",
                "seq": len(recs) + 1,
                "segment": 3,
                "base_version": 0,
                "version": v + 1,
                "change": {"op": "content", "node_id": "a1", "new": "x"},
            }
        )
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("before that segment's snapshot", str(ctx.exception))

    def test_change_targeting_closed_segment_rejected(self) -> None:
        # 写出 segment1 checkpoint，然后又往 segment 0 追加变更。
        tree = DocumentTree()
        tree.add("r", None, "section")
        tree.add("a", "r", "note")
        save(tree, self.path)
        tree.rollback(1)
        save(tree, self.path)  # 产生 segment 1 快照
        recs = self._records()
        # 找一条合法的 segment 0 content 形态记录附在末尾，但标 segment 0。
        recs.append(
            {
                "type": "change",
                "seq": len(recs) + 1,
                "segment": 0,
                "base_version": 2,
                "version": 3,
                "change": {"op": "content", "node_id": "a", "new": "y"},
            }
        )
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("closed segment", str(ctx.exception))


class SnapshotIntegrityTest(CorruptJournalTestBase):
    def test_snapshot_orphan_node(self) -> None:
        recs = self._records()
        recs[1]["snapshot"]["nodes"] = {
            "zombie": {
                "node_id": "zombie",
                "parent_id": "ghost",
                "kind": "note",
                "content": "",
                "children": [],
                "refs": [],
            }
        }
        recs[1]["snapshot"]["root_id"] = None
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("line 2", str(ctx.exception))

    def test_snapshot_bidirectional_mismatch(self) -> None:
        # 非空快照只出现在回滚产生的 checkpoint 上：先造出含 r、a 的 v2，
        # 再编辑到 v3、回滚到 v2，v2 快照里同时有父子两个节点。
        tree = DocumentTree()
        tree.add("r", None, "section")
        tree.add("a", "r", "note")
        save(tree, self.path)
        tree.update_content("a", "v3")
        tree.rollback(2)
        save(tree, self.path)
        recs = self._records()
        snapshots = [r for r in recs if r.get("type") == "snapshot"]
        seg1 = snapshots[1]
        self.assertIn("r", seg1["snapshot"]["nodes"])
        self.assertIn("a", seg1["snapshot"]["nodes"])
        del seg1["snapshot"]["nodes"]["r"]["children"][0]  # r.children 不再列 a
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("does not list it in children", str(ctx.exception))

    def test_snapshot_duplicate_node_key_mismatch(self) -> None:
        recs = self._records()
        recs[1]["snapshot"]["nodes"] = {}
        recs[1]["snapshot"]["nodes"]["r"] = {
            "node_id": "different",
            "parent_id": None,
            "kind": "s",
            "content": "",
            "children": [],
            "refs": [],
        }
        recs[1]["snapshot"]["root_id"] = "r"
        self._write(recs)
        with self.assertRaises(ValidationError):
            load(self.path)

    def test_snapshot_dangling_ref_under_cascade(self) -> None:
        # 同样利用回滚 checkpoint 制造含节点的快照再塞入悬空引用。
        tree = DocumentTree()
        tree.add("r", None, "section")
        tree.add("a", "r", "note")
        save(tree, self.path)
        tree.update_content("a", "v3")
        tree.rollback(2)
        save(tree, self.path)
        recs = self._records()
        seg1 = [r for r in recs if r.get("type") == "snapshot"][1]
        seg1["snapshot"]["nodes"]["a"]["refs"] = ["ghost"]
        self._write(recs)
        with self.assertRaises(ValidationError) as ctx:
            load(self.path)
        self.assertIn("dangling", str(ctx.exception))


class LoadAtomicityTest(CorruptJournalTestBase):
    def test_load_returns_nothing_on_failure_no_partial_object(self) -> None:
        self._append_change({"op": "move", "node_id": "a", "new_parent_id": "a1", "index": 0})
        result: Any = None
        try:
            result = load(self.path)
        except InvalidChangeError:
            result = None
        self.assertIsNone(result)

    def test_existing_file_still_loads_after_failed_attempt(self) -> None:
        # 第一次加载成功。
        good = load(self.path)
        self.assertEqual(good.version, 5)
        # 写坏文件，加载失败。
        self._append_change({"op": "move", "node_id": "a", "new_parent_id": "a1", "index": 0})
        with self.assertRaises(InvalidChangeError):
            load(self.path)
        # 恢复成原文件后仍能正常加载（失败过程无副作用、无缓存污染）。
        tree = DocumentTree()
        tree.add("r", None, "section")
        tree.add("a", "r", "section")
        tree.add("a1", "a", "note", content="hello")
        tree.add("b", "r", "note")
        tree.add_ref("b", "a1")
        save(tree, self.path)
        again = load(self.path)
        self.assertEqual(again.version, 5)
        self.assertEqual(again.preorder_ids(), good.preorder_ids())

    def test_missing_file_raises_filenotfound(self) -> None:
        with self.assertRaises(FileNotFoundError):
            load(os.path.join(self.dir, "nope.dtj"))


if __name__ == "__main__":
    unittest.main()
