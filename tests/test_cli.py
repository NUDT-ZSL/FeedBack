"""main.py 行 JSON 命令行入口的单元测试。"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from typing import Any, Dict, List

import main as cli


def run_session(lines: List[str]) -> List[Dict[str, Any]]:
    """把若干命令行喂给会话，返回解析后的结果列表。"""
    inp = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
    out = io.StringIO()
    code = cli.run(inp, out)
    assert code == 0
    return [json.loads(line) for line in out.getvalue().splitlines()]


class CliBasicTest(unittest.TestCase):
    def test_empty_input_produces_nothing(self) -> None:
        self.assertEqual(run_session([]), [])

    def test_blank_lines_ignored(self) -> None:
        results = run_session(["", "   "])
        self.assertEqual(results, [])

    def test_invalid_json_is_json_error(self) -> None:
        (r,) = run_session(["not json"])
        self.assertIn("error", r)
        self.assertEqual(r["code"], "invalid_json")

    def test_non_object_command(self) -> None:
        (r,) = run_session(["[1,2,3]"])
        self.assertEqual(r["code"], "invalid_command")

    def test_unknown_op(self) -> None:
        (r,) = run_session(['{"op":"nope"}'])
        self.assertEqual(r["code"], "unknown_op")

    def test_missing_field(self) -> None:
        (r,) = run_session(['{"op":"add","node_id":"r"}'])
        self.assertEqual(r["code"], "missing_field")


class CliWorkflowTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "cli.dtj")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_full_workflow(self) -> None:
        commands = [
            json.dumps({"op": "add", "node_id": "r", "parent_id": None, "kind": "section"}),
            json.dumps({"op": "add", "node_id": "a", "parent_id": "r", "kind": "section"}),
            json.dumps({"op": "add", "node_id": "b", "parent_id": "r", "kind": "note"}),
            json.dumps({"op": "add", "node_id": "a1", "parent_id": "a", "kind": "note", "content": "x"}),
            json.dumps({"op": "add_ref", "owner": "b", "target": "a1"}),
            json.dumps({"op": "move", "node_id": "a", "parent_id": "r", "index": 1}),
            json.dumps({"op": "path", "node_id": "a1"}),
            json.dumps({"op": "subtree", "node_id": "r"}),
            json.dumps({"op": "find", "kind": "note"}),
            json.dumps({"op": "resolve", "node_id": "b"}),
            json.dumps({"op": "dangling"}),
            json.dumps({"op": "history"}),
            json.dumps({"op": "save", "path": self.path}),
        ]
        results = run_session(commands)
        self.assertTrue(all("error" not in r for r in results), results)
        # move 返回结构。
        move_r = results[5]
        self.assertEqual(move_r["moved_ids"], ["a", "a1"])
        self.assertEqual(move_r["new_path"], ["r", "a"])
        # path。
        self.assertEqual(results[6]["path"], ["r", "a", "a1"])
        # 前序。
        self.assertEqual(results[7]["ids"], ["r", "b", "a", "a1"])
        # find。
        self.assertEqual([n["node_id"] for n in results[8]["nodes"]], ["b", "a1"])
        # resolve。
        self.assertTrue(results[9]["refs"][0]["exists"])
        self.assertEqual(results[10]["dangling"], [])
        # save（第 13 条命令，索引 12）。
        self.assertEqual(results[12]["mode"], "full")

    def test_move_accepts_new_parent_id_key(self) -> None:
        results = run_session(
            [
                json.dumps({"op": "add", "node_id": "r", "parent_id": None, "kind": "s"}),
                json.dumps({"op": "add", "node_id": "a", "parent_id": "r", "kind": "n"}),
                json.dumps({"op": "add", "node_id": "b", "parent_id": "r", "kind": "n"}),
                json.dumps({"op": "move", "node_id": "a", "new_parent_id": "r", "index": 1}),
            ]
        )
        self.assertNotIn("error", results[-1])
        self.assertEqual(results[-1]["new_path"], ["r", "a"])

    def test_errors_are_json_and_session_continues(self) -> None:
        results = run_session(
            [
                json.dumps({"op": "add", "node_id": "r", "parent_id": None, "kind": "s"}),
                json.dumps({"op": "path", "node_id": "ghost"}),
                json.dumps({"op": "move", "node_id": "r", "parent_id": "r", "index": 0}),
                json.dumps({"op": "path", "node_id": "r"}),
            ]
        )
        self.assertIn("error", results[1])
        self.assertEqual(results[1]["code"], "node_not_found")
        self.assertIn("error", results[2])
        self.assertEqual(results[2]["code"], "validation_error")
        # 出错后仍能正常响应。
        self.assertEqual(results[3]["path"], ["r"])

    def test_policy_switch_and_dangling(self) -> None:
        results = run_session(
            [
                json.dumps({"op": "add", "node_id": "r", "parent_id": None, "kind": "s"}),
                json.dumps({"op": "add", "node_id": "o", "parent_id": "r", "kind": "n"}),
                json.dumps({"op": "add", "node_id": "x", "parent_id": "r", "kind": "n"}),
                json.dumps({"op": "add_ref", "owner": "o", "target": "x"}),
                json.dumps({"op": "policy", "policy": "lenient"}),
                json.dumps({"op": "remove", "node_id": "x"}),
                json.dumps({"op": "dangling"}),
                json.dumps({"op": "policy", "policy": "strict"}),  # 应失败
                json.dumps({"op": "policy", "policy": "cascade"}),
                json.dumps({"op": "dangling"}),
            ]
        )
        self.assertNotIn("error", results[4])
        self.assertEqual(results[6]["dangling"], [{"owner": "o", "target": "x"}])
        self.assertIn("error", results[7])
        self.assertEqual(results[7]["code"], "dangling_reference")
        self.assertNotIn("error", results[8])
        self.assertEqual(results[9]["dangling"], [])

    def test_save_load_diff_rollback_session(self) -> None:
        results = run_session(
            [
                json.dumps({"op": "add", "node_id": "r", "parent_id": None, "kind": "s"}),
                json.dumps({"op": "add", "node_id": "a", "parent_id": "r", "kind": "n", "content": "v1"}),
                json.dumps({"op": "save", "path": self.path}),
                json.dumps({"op": "update_content", "node_id": "a", "content": "v2"}),
                json.dumps({"op": "save", "path": self.path}),
                json.dumps({"op": "diff", "v1": 2, "v2": 3}),
                json.dumps({"op": "rollback", "version": 2}),
                json.dumps({"op": "dump"}),
                json.dumps({"op": "load", "path": self.path}),
                json.dumps({"op": "dump"}),
            ]
        )
        for i, r in enumerate(results):
            self.assertNotIn("error", r)
        self.assertEqual(results[4]["mode"], "append")
        self.assertEqual(results[5]["diff"]["content_changed"],
                         [{"node_id": "a", "old": "v1", "new": "v2"}])
        self.assertEqual(results[6]["version"], 2)
        self.assertEqual(results[7]["nodes"]["a"]["content"], "v1")
        # 文件里保存的是 v3。
        self.assertEqual(results[8]["version"], 3)
        self.assertEqual(results[9]["nodes"]["a"]["content"], "v2")

    def test_load_bad_file_reports_error_as_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("garbage\n")
        results = run_session([json.dumps({"op": "load", "path": self.path})])
        self.assertIn("error", results[0])
        self.assertEqual(results[0]["code"], "validation_error")


if __name__ == "__main__":
    unittest.main()
