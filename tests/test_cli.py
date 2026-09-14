"""逐条 JSON 请求 CLI 的测试。"""

from __future__ import annotations

import base64
import io
import json
import os
import tempfile
import unittest

from storage_repair.cli import RequestProcessor, run_stream


def b64(data: bytes) -> str:
    """标准 base64 编码辅助。"""
    return base64.b64encode(data).decode("ascii")


class RequestProcessorTests(unittest.TestCase):
    """分派、错误隔离与主要操作的端到端 JSON 行为。"""

    def setUp(self) -> None:
        self.processor = RequestProcessor()

    def handle(self, request: dict) -> dict:
        return self.processor.handle(request)

    def test_ping_help_unknown(self) -> None:
        self.assertTrue(self.handle({"op": "ping"})["result"]["pong"])
        ops = self.handle({"op": "help"})["result"]["ops"]
        self.assertIn("repair", ops)
        response = self.handle({"op": "definitely-not-an-op"})
        self.assertFalse(response["ok"])

    def test_non_object_and_missing_op(self) -> None:
        self.assertFalse(self.handle([1, 2])["ok"])
        self.assertFalse(self.handle({})["ok"])

    def test_full_lifecycle(self) -> None:
        response = self.handle({
            "op": "create_stripe", "stripe_id": "s", "k": 2, "m": 1,
            "data_b64": [b64(b"aa"), b64(b"bb")],
        })
        self.assertTrue(response["ok"], response)
        parity = self.handle({"op": "query_position", "stripe_id": "s",
                              "position": 2})["result"]["fingerprint"]
        self.handle({"op": "mark_missing", "stripe_id": "s", "position": 0})
        repair = self.handle({"op": "repair", "stripe_id": "s"})
        self.assertTrue(repair["ok"])
        self.assertTrue(repair["result"]["success"])
        query = self.handle({"op": "query_position", "stripe_id": "s",
                             "position": 0})
        self.assertEqual(query["result"]["status"], "intact")
        self.assertIsNotNone(query["result"]["fingerprint"])

    def test_error_isolated_and_located(self) -> None:
        self.handle({"op": "create_stripe", "stripe_id": "s", "k": 2, "m": 1})
        response = self.handle({
            "op": "write_block", "stripe_id": "s", "position": 9,
            "content_b64": b64(b"aa"),
        })
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["type"], "InvalidPositionError")
        self.assertIn("stripe=s", response["error"]["message"])
        self.assertIn("position=9", response["error"]["message"])
        # 引擎仍可处理后续请求。
        self.assertEqual(
            self.handle({"op": "list_stripes"})["result"]["stripes"], ["s"]
        )

    def test_candidate_conflict_flow(self) -> None:
        self.handle({
            "op": "create_stripe", "stripe_id": "s", "k": 2, "m": 1,
            "data_b64": [b64(b"aa"), b64(b"bb")],
        })
        self.handle({"op": "mark_missing", "stripe_id": "s", "position": 0})
        self.handle({"op": "add_candidate", "stripe_id": "s", "position": 0,
                     "source": "a", "content_b64": b64(b"aa")})
        self.handle({"op": "add_candidate", "stripe_id": "s", "position": 0,
                     "source": "b", "content_b64": b64(b"zz")})
        verify = self.handle({"op": "verify", "stripe_id": "s"})["result"]
        self.assertEqual(verify["positions"]["0"], "conflict")
        repair = self.handle({"op": "repair", "stripe_id": "s"})["result"]
        self.assertFalse(repair["success"])

    def test_import_export_ops(self) -> None:
        self.handle({
            "op": "create_stripe", "stripe_id": "s", "k": 1, "m": 1,
            "data_b64": [b64(b"q")],
        })
        directory = tempfile.mkdtemp()
        path = os.path.join(directory, "snap.json")
        export = self.handle({"op": "export", "path": path})
        self.assertTrue(export["ok"])
        fresh = RequestProcessor()
        response = fresh.handle({"op": "import", "path": path})
        self.assertTrue(response["ok"], response)
        self.assertEqual(response["result"]["stripes"], ["s"])

    def test_bad_base64_rejected(self) -> None:
        self.handle({"op": "create_stripe", "stripe_id": "s", "k": 1, "m": 1})
        response = self.handle({
            "op": "add_candidate", "stripe_id": "s", "position": 0,
            "source": "a", "content_b64": "not base64!!!",
        })
        self.assertFalse(response["ok"])


class StreamTests(unittest.TestCase):
    """JSONL 流式接口：逐行输入、逐行输出、坏行不中断。"""

    def test_run_stream(self) -> None:
        requests = "\n".join([
            json.dumps({"op": "ping"}),
            "# not json",
            json.dumps({"op": "create_stripe", "stripe_id": "s",
                        "k": 1, "m": 1, "data_b64": [b64(b"x")]}),
            "",
        ])
        inp = io.StringIO(requests)
        out = io.StringIO()
        code = run_stream(inp, out)
        self.assertEqual(code, 0)
        lines = [line for line in out.getvalue().splitlines() if line]
        self.assertEqual(len(lines), 3)
        ping, bad_json, create = (json.loads(line) for line in lines)
        self.assertTrue(ping["ok"])
        self.assertFalse(bad_json["ok"])
        self.assertEqual(bad_json["error"]["type"], "JSONDecodeError")
        self.assertTrue(create["ok"])


if __name__ == "__main__":
    unittest.main()
