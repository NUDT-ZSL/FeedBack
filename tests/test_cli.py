"""命令行入口 main.py 的单元测试：逐行 JSON、base64/hex、错误 JSON 化。"""

from __future__ import annotations

import base64
import io
import json
import os
import random
import tempfile
import unittest
from contextlib import redirect_stdout

import main as cli


def _pseudo_bytes(seed: int, n: int) -> bytes:
    rng = random.Random(seed)
    return bytes(rng.randrange(256) for _ in range(n))


def _run(obj: dict) -> dict:
    """把一条命令送进 handle_line 并解析 JSON 输出。"""
    return json.loads(cli.handle_line(json.dumps(obj)))


class CliFingerprintTests(unittest.TestCase):
    """fingerprint 命令。"""

    def test_fingerprint_base64(self) -> None:
        data = _pseudo_bytes(90, 30000)
        res = _run({"cmd": "fingerprint", "data_b64": base64.b64encode(data).decode()})
        self.assertNotIn("error", res)
        self.assertEqual(len(res["digest"]), 64)
        self.assertEqual(res["size"], 30000)
        self.assertGreater(res["chunk_count"], 0)

    def test_fingerprint_hex_and_binary_safe(self) -> None:
        data = bytes(range(256)) * 4
        res = _run({"cmd": "fingerprint", "data_hex": data.hex()})
        self.assertEqual(res["size"], 1024)
        res2 = _run(
            {"cmd": "fingerprint", "data_b64": base64.b64encode(data).decode()}
        )
        self.assertEqual(res["digest"], res2["digest"])

    def test_empty_input(self) -> None:
        res = _run({"cmd": "fingerprint", "data_b64": ""})
        self.assertEqual(res["size"], 0)
        self.assertEqual(len(res["digest"]), 64)

    def test_custom_config(self) -> None:
        data = _pseudo_bytes(91, 40000)
        res = _run(
            {
                "cmd": "fingerprint",
                "data_b64": base64.b64encode(data).decode(),
                "config": {"avg_size": 256, "min_size": 64, "max_size": 1024},
            }
        )
        self.assertGreater(res["chunk_count"], 10)

    def test_bad_config_returns_json_error(self) -> None:
        res = _run(
            {
                "cmd": "fingerprint",
                "data_b64": "",
                "config": {"avg_size": 0, "min_size": 1, "max_size": 2},
            }
        )
        self.assertIn("error", res)
        self.assertEqual(res["error_type"], "InvalidConfigError")


class CliDiffPatchCompareTests(unittest.TestCase):
    """diff/patch/compare 命令与二进制往返。"""

    def setUp(self) -> None:
        self.old = _pseudo_bytes(92, 120000)
        self.new = self.old[:50000] + b"\x00\xff" * 100 + self.old[50000:]

    def test_diff_patch_roundtrip_hex_input(self) -> None:
        res = _run(
            {
                "cmd": "diff",
                "old_hex": self.old.hex(),
                "new_hex": self.new.hex(),
            }
        )
        self.assertNotIn("error", res)
        self.assertLess(res["patch_size"], len(self.new) // 2)
        patched = _run(
            {
                "cmd": "patch",
                "old_hex": self.old.hex(),
                "delta": res,
            }
        )
        self.assertEqual(base64.b64decode(patched["data_b64"]), self.new)

    def test_compare_identical_and_different(self) -> None:
        same = _run(
            {
                "cmd": "compare",
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(self.old).decode(),
            }
        )
        self.assertEqual(same["similarity"], 1.0)
        other = _pseudo_bytes(93, 120000)
        diff_res = _run(
            {
                "cmd": "compare",
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(other).decode(),
            }
        )
        self.assertEqual(diff_res["similarity"], 0.0)

    def test_patch_mismatch_error_carries_both_fingerprints(self) -> None:
        delta = _run(
            {
                "cmd": "diff",
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(self.new).decode(),
            }
        )
        res = _run(
            {
                "cmd": "patch",
                "old_b64": base64.b64encode(b"X" + self.old[1:]).decode(),
                "delta": delta,
            }
        )
        self.assertIn("error", res)
        self.assertEqual(res["error_type"], "FingerprintMismatchError")
        self.assertEqual(len(res["expected"]), 64)
        self.assertEqual(len(res["actual"]), 64)


class CliSaveLoadDumpTests(unittest.TestCase):
    """save/load/dump 与文件往返。"""

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="cdiff-cli-")
        self.path = os.path.join(self.tmp, "patch.json")
        self.old = _pseudo_bytes(94, 80000)
        self.new = self.old + b"appended-data" * 10

    def tearDown(self) -> None:
        if os.path.exists(self.path):
            os.remove(self.path)
        os.rmdir(self.tmp)

    def test_save_from_old_new_then_load_then_patch(self) -> None:
        saved = _run(
            {
                "cmd": "save",
                "path": self.path,
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(self.new).decode(),
            }
        )
        self.assertEqual(saved["saved"], self.path)
        loaded = _run({"cmd": "load", "path": self.path})
        self.assertNotIn("error", loaded)
        patched = _run(
            {
                "cmd": "patch",
                "old_b64": base64.b64encode(self.old).decode(),
                "delta": loaded,
            }
        )
        self.assertEqual(base64.b64decode(patched["data_b64"]), self.new)

    def test_load_missing_file_is_json_error(self) -> None:
        res = _run({"cmd": "load", "path": os.path.join(self.tmp, "nope.json")})
        self.assertEqual(res["error_type"], "CorruptPatchError")
        self.assertIn("cannot read", res["error"])

    def test_patch_from_path(self) -> None:
        _run(
            {
                "cmd": "save",
                "path": self.path,
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(self.new).decode(),
            }
        )
        res = _run(
            {
                "cmd": "patch",
                "old_b64": base64.b64encode(self.old).decode(),
                "path": self.path,
            }
        )
        self.assertEqual(base64.b64decode(res["data_b64"]), self.new)

    def test_dump_lists_ops(self) -> None:
        delta = _run(
            {
                "cmd": "diff",
                "old_b64": base64.b64encode(self.old).decode(),
                "new_b64": base64.b64encode(self.new).decode(),
            }
        )
        res = _run({"cmd": "dump", "delta": delta})
        self.assertNotIn("error", res)
        self.assertEqual(len(res["old_digest"]), 64)
        self.assertTrue(all(op["op"] in ("COPY", "ADD") for op in res["ops"]))
        self.assertEqual(res["new_size"], len(self.new))
        self.assertIn("stats", res)


class CliProtocolErrorsTests(unittest.TestCase):
    """协议级错误全部以一行 JSON 返回。"""

    def test_unknown_command(self) -> None:
        res = _run({"cmd": "frobnicate"})
        self.assertIn("error", res)

    def test_missing_binary_field(self) -> None:
        res = _run({"cmd": "fingerprint"})
        self.assertIn("missing binary field", res["error"])

    def test_bad_base64(self) -> None:
        res = _run({"cmd": "fingerprint", "data_b64": "@@@"})
        self.assertEqual(res["error_type"], "CdiffError")

    def test_command_not_object(self) -> None:
        out = cli.handle_line("[1, 2, 3]")
        self.assertIn("error", json.loads(out))

    def test_malformed_json_line(self) -> None:
        out = cli.handle_line("{not json")
        payload = json.loads(out)
        self.assertIn("error", payload)


class CliStdinDriverTests(unittest.TestCase):
    """main() 从标准输入逐行驱动，错误行不影响后续命令。"""

    def test_multiple_lines_with_error_in_middle(self) -> None:
        lines = [
            json.dumps({"cmd": "fingerprint", "data_hex": "ab"}),
            json.dumps({"cmd": "bogus"}),
            "",  # 空行跳过
            json.dumps({"cmd": "compare", "data_hex": "ab"}),  # 缺字段
            json.dumps({"cmd": "fingerprint", "data_b64": "AA=="}),
        ]
        fake_in = io.StringIO("\n".join(lines) + "\n")
        fake_out = io.StringIO()
        old_stdin = cli.sys.stdin
        old_stdout = cli.sys.stdout
        try:
            cli.sys.stdin = fake_in
            with redirect_stdout(fake_out):
                rc = cli.main([])
        finally:
            cli.sys.stdin = old_stdin
            cli.sys.stdout = old_stdout
        self.assertEqual(rc, 0)
        results = [json.loads(line) for line in fake_out.getvalue().splitlines()]
        self.assertEqual(len(results), 4)  # 空行不产出
        self.assertNotIn("error", results[0])
        self.assertIn("error", results[1])
        self.assertIn("error", results[2])
        self.assertNotIn("error", results[3])


if __name__ == "__main__":
    unittest.main()
