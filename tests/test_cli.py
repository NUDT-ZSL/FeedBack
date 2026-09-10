"""命令行入口 main.py 的端到端测试（标准 JSON 行协议）。"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

# 无论以何种方式启动 unittest discovery，都把项目根目录放进 sys.path。
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

import main


def run_cli(lines: list[str]) -> list[dict]:
    """直接调用内存中的 run()，返回解析后的结果字典列表。"""
    return [json.loads(line) for line in main.run(lines)]


class CliBasicTests(unittest.TestCase):
    def test_add_and_plan(self) -> None:
        results = run_cli(
            [
                json.dumps({"op": "add", "id": "a", "fingerprint": "h1"}),
                json.dumps(
                    {"op": "add", "id": "b", "fingerprint": "h2", "deps": ["a"]}
                ),
                json.dumps({"op": "update", "id": "a", "fingerprint": "h1x"}),
                json.dumps({"op": "plan"}),
            ]
        )
        self.assertTrue(all(r["ok"] for r in results))
        self.assertEqual(results[2]["changed"], True)
        self.assertEqual(results[3]["plan"], ["a"])

    def test_empty_lines_skipped(self) -> None:
        results = run_cli(["", "   ", json.dumps({"op": "plan"})])
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["plan"], [])

    def test_invalid_json_returns_error_json(self) -> None:
        results = run_cli(["{oops", json.dumps({"op": "plan"})])
        self.assertFalse(results[0]["ok"])
        self.assertIn("error", results[0])
        # 一条坏命令不影响后续。
        self.assertTrue(results[1]["ok"])

    def test_unknown_op(self) -> None:
        results = run_cli([json.dumps({"op": "frobnicate"})])
        self.assertFalse(results[0]["ok"])
        self.assertEqual(results[0]["type"], "CommandError")

    def test_missing_field_reported(self) -> None:
        results = run_cli([json.dumps({"op": "add", "id": "a"})])
        self.assertFalse(results[0]["ok"])
        self.assertIn("fingerprint", results[0]["error"])

    def test_engine_error_serialized(self) -> None:
        results = run_cli(
            [
                json.dumps({"op": "update", "id": "ghost", "fingerprint": "x"}),
                json.dumps({"op": "remove", "id": "ghost"}),
            ]
        )
        for result in results:
            self.assertFalse(result["ok"])
            self.assertEqual(result["type"], "NodeNotFoundError")

    def test_cycle_error_includes_cycle(self) -> None:
        # 通过 save -> 手改成环 -> load 的方式触发环检测。
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            cyclic = {
                "format_version": 1,
                "nodes": [
                    {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                     "state": "clean", "deps": ["b"]},
                    {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                     "state": "clean", "deps": ["a"]},
                ],
            }
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(cyclic, fh)
            results = run_cli([json.dumps({"op": "load", "path": path})])
        self.assertFalse(results[0]["ok"])
        self.assertEqual(results[0]["type"], "SnapshotError")
        self.assertIn("环", results[0]["error"])


class CliWorkflowTests(unittest.TestCase):
    def test_diamond_workflow_and_explain(self) -> None:
        commands = [
            {"op": "add", "id": "x", "fingerprint": "hx"},
            {"op": "add", "id": "m1", "fingerprint": "hm1", "deps": ["x"]},
            {"op": "add", "id": "m2", "fingerprint": "hm2", "deps": ["x"]},
            {"op": "add", "id": "y", "fingerprint": "hy",
             "deps": ["m1", "m2"]},
            {"op": "update", "id": "x", "fingerprint": "hx2"},
            {"op": "affected", "id": "x"},
            {"op": "explain", "id": "y"},
            {"op": "plan"},
            {"op": "clean", "id": "x"},
            {"op": "plan"},
            {"op": "clean", "id": "m1"},
            {"op": "clean", "id": "m2"},
            {"op": "plan"},
            {"op": "clean", "id": "y"},
            {"op": "plan"},
        ]
        results = run_cli([json.dumps(c) for c in commands])
        self.assertTrue(all(r["ok"] for r in results), results)
        self.assertEqual(results[5]["affected"], ["x", "m1", "m2", "y"])
        self.assertEqual(results[6]["paths"], [["y", "m1", "x"], ["y", "m2", "x"]])
        self.assertEqual(results[7]["plan"], ["x"])
        self.assertEqual(results[9]["plan"], ["m1", "m2"])
        self.assertEqual(results[12]["plan"], ["y"])
        self.assertEqual(results[14]["plan"], [])

    def test_save_load_dump(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "nested", "s.json")
            commands = [
                {"op": "add", "id": "a", "fingerprint": "h1"},
                {"op": "add", "id": "b", "fingerprint": "h2", "deps": ["a"]},
                {"op": "update", "id": "a", "fingerprint": "h1x"},
                {"op": "save", "path": path},
                {"op": "dump"},
                {"op": "load", "path": path},
                {"op": "plan"},
                {"op": "status", "id": "b"},
            ]
            results = run_cli([json.dumps(c) for c in commands])
            self.assertTrue(all(r["ok"] for r in results), results)
            self.assertIn("format_version", results[4]["snapshot"])
            self.assertEqual(results[6]["plan"], ["a"])
            self.assertEqual(results[7]["node"]["state"], "pending")

    def test_remove_and_nodes(self) -> None:
        commands = [
            {"op": "add", "id": "a", "fingerprint": "h"},
            {"op": "add", "id": "b", "fingerprint": "h", "deps": ["a"]},
            {"op": "remove", "id": "a"},
            {"op": "nodes"},
            {"op": "status", "id": "b"},
        ]
        results = run_cli([json.dumps(c) for c in commands])
        self.assertTrue(all(r["ok"] for r in results), results)
        self.assertEqual(results[3]["nodes"], ["b"])
        self.assertEqual(results[4]["node"]["deps"], [])


class CliSubprocessTests(unittest.TestCase):
    """真正走一遍标准输入/标准输出的子进程，验证 main() 管道可用。"""

    def test_stdin_stdout_roundtrip(self) -> None:
        payload = "\n".join(
            [
                json.dumps({"op": "add", "id": "a", "fingerprint": "h1"}),
                json.dumps({"op": "plan"}),
                "",
            ]
        )
        proc = subprocess.run(
            [sys.executable, main.__file__],
            input=payload,
            capture_output=True,
            text=True,
            check=True,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(main.__file__))),
        )
        lines = [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0]["ok"])
        self.assertEqual(lines[1]["plan"], [])


if __name__ == "__main__":
    unittest.main()
