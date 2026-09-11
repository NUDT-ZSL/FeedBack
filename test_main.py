# -*- coding: utf-8 -*-
"""main.py CLI 的 unittest 测试。"""

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

import main


def run_cli(argv, stdin_text=None):
    """执行 CLI，返回 (exit_code, stdout 解析后的 JSON)。"""
    buf = io.StringIO()
    with redirect_stdout(buf):
        if stdin_text is not None:
            with mock.patch("sys.stdin", io.StringIO(stdin_text)):
                code = main.main(argv)
        else:
            code = main.main(argv)
    out = buf.getvalue()
    return code, json.loads(out) if out.strip() else None


class TestCliCommands(unittest.TestCase):
    def test_compile_report(self):
        code, out = run_cli(
            ["compile", "--pattern-id", "p1", "--pattern", "ERROR {code:int} {msg:*}"]
        )
        self.assertEqual(code, 0)
        self.assertEqual(out["pattern_id"], "p1")
        self.assertGreater(out["state_count"], 0)
        self.assertGreater(out["transition_count"], 0)
        self.assertEqual(
            out["placeholders"],
            [{"name": "code", "type": "int"}, {"name": "msg", "type": "greedy"}],
        )

    def test_match(self):
        code, out = run_cli(
            [
                "match",
                "--pattern", "01=ERROR {code:int} {msg:*}",
                "--pattern", "02={line}",
                "--text", "ERROR 42 disk full",
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(
            out, {"pattern_id": "01", "fields": {"code": 42, "msg": "disk full"}}
        )

    def test_match_no_hit_outputs_null(self):
        code, out = run_cli(
            ["match", "--pattern", "01=zzz", "--text", "abc"]
        )
        self.assertEqual(code, 0)
        self.assertIsNone(out)

    def test_match_all_ascending(self):
        code, out = run_cli(
            [
                "match-all",
                "--pattern", "b={x}",
                "--pattern", "a={x}",
                "--pattern", "c=nope",
                "--text", "hello",
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual([h["pattern_id"] for h in out], ["a", "b"])

    def test_extract(self):
        code, out = run_cli(
            [
                "extract",
                "--pattern", "p=user={u} host={h}",
                "--pattern-id", "p",
                "--text", "user=alice host=web01",
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(out, ["alice", "web01"])

    def test_explain_failure(self):
        code, out = run_cli(
            [
                "explain",
                "--pattern", "p=ERROR {code:int}",
                "--pattern-id", "p",
                "--text", "ERROR abc",
            ]
        )
        self.assertEqual(code, 0)
        self.assertFalse(out["matched"])
        self.assertEqual(out["position"], 6)
        self.assertIn("digit", out["reason"])

    def test_stream_line_mode(self):
        code, out = run_cli(
            ["stream", "--pattern", "01=ERROR {code:int} {msg:*}"],
            stdin_text="ERROR 1 a\nnope\nERROR 2 b\n",
        )
        self.assertEqual(code, 0)
        self.assertEqual(len(out), 3)
        self.assertEqual(out[0]["fields"], {"code": 1, "msg": "a"})
        self.assertIsNone(out[1]["pattern_id"])
        self.assertEqual(out[2]["fields"], {"code": 2, "msg": "b"})

    def test_stream_chunked_matches_line_mode(self):
        text = "ERROR 1 a\nnope\nERROR 2 b"
        argv = ["stream", "--pattern", "01=ERROR {code:int} {msg:*}"]
        _, one_shot = run_cli(argv, stdin_text=text)
        for size in (1, 3, 7):
            code, chunked = run_cli(
                argv + ["--chunk-size", str(size)], stdin_text=text
            )
            self.assertEqual(code, 0)
            self.assertEqual(chunked, one_shot, msg="chunk size %d" % size)

    def test_stream_max_buffer_overflow(self):
        # 行模式下每行自带换行，未终结缓冲不会超限；用固定分片触发溢出
        code, out = run_cli(
            [
                "stream",
                "--pattern", "01=OK {v:int}",
                "--max-buffer", "4",
                "--chunk-size", "3",
            ],
            stdin_text="xxxxxxxxxx\nOK 3\n",
        )
        self.assertEqual(code, 0)
        self.assertEqual(out[0]["error"], "buffer_overflow")
        self.assertEqual(out[-1]["fields"], {"v": 3})


class TestCliSnapshot(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = os.path.join(self.tmpdir.name, "snap.json")

    def test_save_then_match_and_stats(self):
        code, out = run_cli(
            [
                "save",
                "--pattern", "01=ERROR {code:int} {msg:*}",
                "--pattern", "02=user={u}",
                "--output", self.path,
            ]
        )
        self.assertEqual(code, 0)
        self.assertEqual(out["pattern_count"], 2)

        code, out = run_cli(
            ["match", "--snapshot", self.path, "--text", "ERROR 9 boom"]
        )
        self.assertEqual(code, 0)
        self.assertEqual(out["fields"], {"code": 9, "msg": "boom"})

        code, out = run_cli(["stats", "--snapshot", self.path])
        self.assertEqual(code, 0)
        self.assertEqual(out["pattern_count"], 2)
        self.assertIn("01", out["patterns"])

    def test_load_corrupted_snapshot(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("not json!!")
        code, out = run_cli(["stats", "--snapshot", self.path])
        self.assertEqual(code, 1)
        self.assertIn("error", out)


class TestCliErrors(unittest.TestCase):
    """错误一律以含 error 字段的 JSON 返回，退出码 1。"""

    def test_duplicate_pattern_id(self):
        code, out = run_cli(
            ["match", "--pattern", "p=a", "--pattern", "p=b", "--text", "a"]
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        self.assertIn("p", out["error"])

    def test_syntax_error(self):
        code, out = run_cli(["compile", "--pattern-id", "p", "--pattern", "{x"])
        self.assertEqual(code, 1)
        self.assertIn("error", out)

    def test_unknown_pattern_id(self):
        code, out = run_cli(
            ["extract", "--pattern", "p=a", "--pattern-id", "ghost", "--text", "a"]
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)
        self.assertIn("ghost", out["error"])

    def test_bad_pattern_spec(self):
        code, out = run_cli(["match", "--pattern", "noequalsign", "--text", "a"])
        self.assertEqual(code, 1)
        self.assertIn("error", out)

    def test_missing_snapshot_file(self):
        code, out = run_cli(
            ["stats", "--snapshot", "definitely-not-here-12345.json"]
        )
        self.assertEqual(code, 1)
        self.assertIn("error", out)


if __name__ == "__main__":
    unittest.main()
