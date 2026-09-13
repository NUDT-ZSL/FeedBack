"""End-to-end tests for the main.py JSON-line command interface."""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

# Make the workspace root importable when tests run from any cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main


class CliHarness:
    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self.progress = workdir / "progress.json"

    def run(self, commands: list[dict]) -> list[dict]:
        stdin = io.StringIO(
            "".join(json.dumps(c) + "\n" for c in commands)
        )
        stdout = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            old_stdin = sys.stdin
            sys.stdin = stdin
            try:
                rc = main.main(["--progress", str(self.progress)])
            finally:
                sys.stdin = old_stdin
        self.assertEqual(rc, 0)
        lines = [line for line in stdout.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(lines), len(commands))
        return [json.loads(line) for line in lines]

    def assertEqual(self, first, second):  # tiny helper delegation
        assert first == second, f"{first!r} != {second!r}"


class CommandLineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.workdir = Path(self._dir.name)
        self.cli = CliHarness(self.workdir)

    def test_start_status_dump_and_list(self) -> None:
        path = self.workdir / "f.bin"
        path.write_bytes(b"abcdefghij")
        results = self.cli.run(
            [
                {"op": "list"},
                {
                    "op": "start",
                    "file": str(path),
                    "object": "obj",
                    "part_size": 4,
                    "backoff_base": 0,
                },
                {"op": "status", "object": "obj"},
                {"op": "dump", "object": "obj"},
                {"op": "list"},
            ]
        )
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[0]["objects"], [])

        self.assertTrue(results[1]["ok"], results[1])
        expected = hashlib.sha256(b"abcdefghij").hexdigest()
        self.assertEqual(results[1]["final_etag"], expected)

        status = results[2]
        self.assertTrue(status["ok"])
        self.assertEqual(status["total_parts"], 3)
        self.assertEqual(status["completed_parts"], 3)
        self.assertEqual(status["uploaded_bytes"], 10)
        self.assertTrue(status["done"])

        dump = results[3]
        self.assertTrue(dump["ok"])
        self.assertEqual(dump["part_sizes"], [4, 4, 2])
        self.assertEqual(dump["file_sha256"], expected)
        self.assertEqual(
            sorted(int(n) for n in dump["completed"]), [1, 2, 3]
        )
        self.assertEqual(results[4]["objects"], ["obj"])

    def test_start_failure_then_resume(self) -> None:
        # The CLI uses a healthy backend by itself; the failure/retry path is
        # driven through the coordinator API in other tests. Here we verify
        # resume on an existing healthy record simply completes.
        path = self.workdir / "f.bin"
        path.write_bytes(b"abcdefgh")
        results = self.cli.run(
            [
                {
                    "op": "start",
                    "file": str(path),
                    "object": "obj",
                    "part_size": 4,
                    "backoff_base": 0,
                },
                {
                    "op": "resume",
                    "file": str(path),
                    "object": "obj",
                    "part_size": 4,
                    "backoff_base": 0,
                },
            ]
        )
        self.assertTrue(results[0]["ok"])
        self.assertTrue(results[1]["ok"])
        self.assertEqual(results[0]["final_etag"], results[1]["final_etag"])

    def test_cancel_removes_record(self) -> None:
        path = self.workdir / "f.bin"
        path.write_bytes(b"abcdefgh")
        results = self.cli.run(
            [
                {"op": "cancel", "object": "never-existed"},
            ]
        )
        self.assertFalse(results[0]["ok"])
        self.assertIn("no progress record", results[0]["error"])

    def test_duplicate_start_returns_json_error(self) -> None:
        path = self.workdir / "f.bin"
        path.write_bytes(b"abc")
        results = self.cli.run(
            [
                {"op": "start", "file": str(path), "object": "obj"},
                {"op": "start", "file": str(path), "object": "obj"},
            ]
        )
        self.assertTrue(results[0]["ok"])
        self.assertFalse(results[1]["ok"])
        self.assertIn("already", results[1]["error"])

    def test_invalid_json_and_unknown_op(self) -> None:
        stdin = io.StringIO("{not json\n" + json.dumps({"op": "frobnicate"}) + "\n")
        stdout = io.StringIO()
        old_stdin = sys.stdin
        sys.stdin = stdin
        try:
            with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
                main.main(["--progress", str(self.cli.progress)])
        finally:
            sys.stdin = old_stdin
        rows = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertFalse(rows[0]["ok"])
        self.assertIn("not valid JSON", rows[0]["error"])
        self.assertFalse(rows[1]["ok"])
        self.assertIn("unknown op", rows[1]["error"])

    def test_missing_file_returns_json_error(self) -> None:
        results = self.cli.run(
            [{"op": "start", "file": str(self.workdir / "missing"), "object": "o"}]
        )
        self.assertFalse(results[0]["ok"])
        self.assertIn("file not found", results[0]["error"])

    def test_bad_options_are_json_errors(self) -> None:
        path = self.workdir / "f.bin"
        path.write_bytes(b"abc")
        results = self.cli.run(
            [
                {"op": "start", "file": str(path), "object": "o", "part_size": 0},
                {"op": "start", "file": str(path), "object": "o", "concurrency": 0},
            ]
        )
        for row in results:
            self.assertFalse(row["ok"])
            self.assertIn("error", row)

    def test_resume_unknown_object_is_error(self) -> None:
        path = self.workdir / "f.bin"
        path.write_bytes(b"abc")
        results = self.cli.run(
            [{"op": "resume", "file": str(path), "object": "ghost"}]
        )
        self.assertFalse(results[0]["ok"])
        self.assertIn("no progress record", results[0]["error"])

    def test_empty_file_round_trip(self) -> None:
        path = self.workdir / "empty"
        path.write_bytes(b"")
        results = self.cli.run(
            [{"op": "start", "file": str(path), "object": "empty-obj"}]
        )
        self.assertTrue(results[0]["ok"], results[0])
        self.assertEqual(results[0]["status"]["total_parts"], 0)
        self.assertEqual(
            results[0]["final_etag"], hashlib.sha256(b"").hexdigest()
        )


if __name__ == "__main__":
    unittest.main()
