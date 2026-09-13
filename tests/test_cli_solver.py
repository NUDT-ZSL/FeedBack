"""统一入口 solve 与命令行 main.py 的测试。"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

from optcore import solve
from optcore.errors import InvalidInputError
from optcore.models import SolveResult

import main as cli


class TestUnifiedSolve(unittest.TestCase):
    def test_empty_inputs(self):
        result = solve()
        self.assertIsInstance(result, SolveResult)
        self.assertTrue(result.feasible)
        self.assertIsNone(result.packing)
        self.assertIsNone(result.schedule)
        self.assertEqual(result.reasons, [])
        payload = result.to_dict()
        self.assertTrue(payload["feasible"])

    def test_only_packing(self):
        result = solve(
            items=[{"item_id": "a", "size": 1, "group": "A"}],
            bins=[{"bin_id": "b", "capacity": 2}],
        )
        self.assertIsNotNone(result.packing)
        self.assertIsNone(result.schedule)
        self.assertTrue(result.feasible)

    def test_only_schedule(self):
        result = solve(tasks=[{"task_id": "a", "duration": 1, "resource": "r"}])
        self.assertIsNone(result.packing)
        self.assertIsNotNone(result.schedule)
        self.assertTrue(result.feasible)

    def test_both_infeasible(self):
        result = solve(
            items=[{"item_id": "x", "size": 9, "group": "G"}],
            bins=[{"bin_id": "b", "capacity": 1}],
            tasks=[
                {"task_id": "a", "duration": 1, "resource": "r", "deps": ["b"]},
                {"task_id": "b", "duration": 1, "resource": "r", "deps": ["a"]},
            ],
        )
        self.assertFalse(result.feasible)
        self.assertFalse(result.packing.feasible)
        self.assertFalse(result.schedule.feasible)
        self.assertEqual(len(result.reasons), 2)
        self.assertTrue(any(r.startswith("[packing]") for r in result.reasons))
        self.assertTrue(any(r.startswith("[schedule]") for r in result.reasons))

    def test_invalid_input_raises(self):
        with self.assertRaises(InvalidInputError):
            solve(items=[{"item_id": "a", "size": "big", "group": "g"}],
                  bins=[{"bin_id": "b", "capacity": 1}])


class TestCLILibrary(unittest.TestCase):
    """不经过子进程，直接驱动 CLI 的处理函数。"""

    def _run_lines(self, lines):
        out = io.StringIO()
        cli.run(io.StringIO("\n".join(lines) + "\n"), out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_solve_and_dump(self):
        responses = self._run_lines([
            json.dumps({"cmd": "solve",
                        "items": [{"item_id": "a", "size": 6, "group": "A"},
                                  {"item_id": "b", "size": 4, "group": "B"}],
                        "bins": [{"bin_id": "b1", "capacity": 10}],
                        "tasks": [{"task_id": "t", "duration": 2,
                                   "resource": "r"}]}),
            json.dumps({"cmd": "dump"}),
        ])
        self.assertTrue(responses[0]["ok"])
        self.assertEqual(responses[0]["result"]["packing"]["used_bins"], 1)
        self.assertTrue(responses[1]["ok"])
        self.assertIn("problem", responses[1]["snapshot"])

    def test_pack_infeasible_is_ok_response(self):
        responses = self._run_lines([
            json.dumps({"cmd": "pack",
                        "items": [{"item_id": "a", "size": 9, "group": "G"}],
                        "bins": [{"bin_id": "b", "capacity": 5}]}),
        ])
        # 不可行是正常求解结果，不是命令错误。
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[0]["result"]["feasible"])
        self.assertTrue(responses[0]["result"]["reasons"])

    def test_schedule_cycle_is_ok_response(self):
        responses = self._run_lines([json.dumps({
            "cmd": "schedule",
            "tasks": [
                {"task_id": "a", "duration": 1, "resource": "r",
                 "deps": ["b"]},
                {"task_id": "b", "duration": 1, "resource": "r",
                 "deps": ["a"]},
            ],
        })])
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[0]["result"]["feasible"])
        self.assertEqual(responses[0]["result"]["cycle"][0],
                         responses[0]["result"]["cycle"][-1])

    def test_blank_lines_ignored(self):
        out = io.StringIO()
        cli.run(io.StringIO("\n  \n" + json.dumps({"cmd": "dump"}) + "\n\n"), out)
        responses = [json.loads(l) for l in out.getvalue().splitlines()]
        self.assertEqual(len(responses), 1)

    def test_malformed_json_error_envelope(self):
        responses = self._run_lines(["{not json"])
        self.assertFalse(responses[0]["ok"])
        self.assertIn("error", responses[0])
        self.assertEqual(responses[0]["error_type"], "JSONDecodeError")

    def test_missing_cmd_error(self):
        responses = self._run_lines([json.dumps({"items": []})])
        self.assertFalse(responses[0]["ok"])
        self.assertIn("error", responses[0])

    def test_unknown_command_error(self):
        responses = self._run_lines([json.dumps({"cmd": "frobnicate"})])
        self.assertFalse(responses[0]["ok"])
        self.assertIn("frobnicate", responses[0]["error"])

    def test_validation_error_as_json(self):
        responses = self._run_lines([json.dumps({
            "cmd": "schedule",
            "tasks": [{"task_id": "a", "duration": 0, "resource": "r"}],
        })])
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["error_type"], "InvalidInputError")

    def test_save_load_roundtrip(self):
        directory = tempfile.mkdtemp()
        path = os.path.join(directory, "cli.json")
        responses = self._run_lines([
            json.dumps({"cmd": "solve",
                        "items": [{"item_id": "a", "size": 3, "group": "A"}],
                        "bins": [{"bin_id": "b", "capacity": 5}],
                        "tasks": [{"task_id": "t", "duration": 1,
                                   "resource": "r"}]}),
            json.dumps({"cmd": "save", "path": path}),
            json.dumps({"cmd": "load", "path": path}),
        ])
        self.assertTrue(all(r["ok"] for r in responses),
                        [r.get("error") for r in responses])
        snapshot = responses[2]["snapshot"]
        self.assertEqual(snapshot["problem"]["items"][0]["item_id"], "a")
        self.assertTrue(snapshot["result"]["feasible"])

    def test_load_missing_path_field(self):
        responses = self._run_lines([json.dumps({"cmd": "load"})])
        self.assertFalse(responses[0]["ok"])
        self.assertIn("path", responses[0]["error"])

    def test_load_missing_file(self):
        responses = self._run_lines([
            json.dumps({"cmd": "load", "path": tempfile.mkdtemp() + "/nope.json"})
        ])
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["error_type"], "PersistenceError")


class TestCLISubprocess(unittest.TestCase):
    """子进程方式验证真实 stdin/stdout 通道与 UTF-8 输出。"""

    def test_stdin_protocol(self):
        commands = "\n".join([
            json.dumps({"cmd": "solve", "items": [], "bins": [],
                        "tasks": []}),
            "{broken",
            json.dumps({"cmd": "schedule", "tasks": [
                {"task_id": "a", "duration": 1, "resource": "r"},
            ]}),
        ])
        proc = subprocess.run(
            [sys.executable, "main.py"],
            input=commands, capture_output=True, text=True,
            encoding="utf-8", cwd=os.path.dirname(os.path.abspath(__file__)) + "/..",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [json.loads(line) for line in proc.stdout.splitlines()]
        self.assertEqual(len(lines), 3)
        self.assertTrue(lines[0]["ok"])
        self.assertFalse(lines[1]["ok"])
        self.assertIn("error", lines[1])
        self.assertTrue(lines[2]["ok"])
        self.assertEqual(lines[2]["result"]["makespan"], 1)

    def test_file_argument(self):
        directory = tempfile.mkdtemp()
        command_file = os.path.join(directory, "commands.txt")
        with open(command_file, "w", encoding="utf-8") as handle:
            handle.write(json.dumps({
                "cmd": "pack",
                "items": [{"item_id": "a", "size": 9, "group": "G"}],
                "bins": [{"bin_id": "b", "capacity": 5}],
            }) + "\n")
        proc = subprocess.run(
            [sys.executable, "main.py", command_file],
            capture_output=True, text=True, encoding="utf-8",
            cwd=os.path.dirname(os.path.abspath(__file__)) + "/..",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        response = json.loads(proc.stdout)
        self.assertTrue(response["ok"])
        self.assertFalse(response["result"]["feasible"])


if __name__ == "__main__":
    unittest.main()
