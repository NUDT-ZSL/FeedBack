"""命令行入口的端到端测试。"""

import io
import json
import os
import tempfile
import unittest

from leasekernel.cli import handle_command, run
from leasekernel.clock import ManualClock
from leasekernel.kernel import LeaseKernel, ValidationError


def run_lines(lines, initial=0.0):
    """对若干命令行跑一遍 run，返回解析后的输出字典列表。"""
    inp = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
    out = io.StringIO()
    errors = run(inp, out, initial)
    records = [json.loads(line) for line in out.getvalue().splitlines()]
    return records, errors


def cmd(kernel, obj):
    """直接执行一条命令（缺字段会抛异常，便于断言）。"""
    return handle_command(kernel, obj)


class CliBasicTest(unittest.TestCase):
    def test_empty_input(self) -> None:
        records, errors = run_lines([])
        self.assertEqual(records, [])
        self.assertEqual(errors, 0)

    def test_blank_lines_ignored(self) -> None:
        records, _ = run_lines(["", "   "])
        self.assertEqual(records, [])

    def test_full_lifecycle(self) -> None:
        lines = [
            json.dumps({"cmd": "register", "resource": "r",
                        "ttl": 100, "epsilon": 10}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
            json.dumps({"cmd": "status", "resource": "r"}),
            json.dumps({"cmd": "advance", "delta": 40}),
            json.dumps({"cmd": "renew", "resource": "r", "holder": "a",
                        "generation": 1, "local_time": 40}),
            json.dumps({"cmd": "write", "resource": "r", "holder": "a",
                        "generation": 1}),
            json.dumps({"cmd": "release", "resource": "r",
                        "holder": "a", "generation": 1}),
        ]
        records, errors = run_lines(lines)
        self.assertEqual(errors, 0)
        self.assertTrue(all(r["ok"] for r in records))
        self.assertEqual(records[1]["granted"], True)
        self.assertEqual(records[2]["status"]["state"], "safe")
        self.assertEqual(records[3]["now"], 40)
        self.assertTrue(records[4]["renewed"])
        self.assertTrue(records[5]["allowed"])
        self.assertTrue(records[6]["released"])

    def test_duplicate_acquire_is_json_denial_not_error(self) -> None:
        records, errors = run_lines([
            json.dumps({"cmd": "register", "resource": "r", "ttl": 10}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "b"}),
        ])
        self.assertEqual(errors, 0)
        self.assertFalse(records[2]["granted"])
        self.assertEqual(records[2]["reason"], "lease_active_other_holder")

    def test_release_nonexistent_lease_is_json_error(self) -> None:
        records, errors = run_lines([
            json.dumps({"cmd": "register", "resource": "r", "ttl": 10}),
            json.dumps({"cmd": "release", "resource": "r",
                        "holder": "a", "generation": 1}),
        ])
        self.assertEqual(errors, 1)
        self.assertFalse(records[1]["ok"])
        self.assertIn("error", records[1])
        self.assertEqual(records[1]["line"], 2)

    def test_malformed_json_line(self) -> None:
        records, errors = run_lines(["{oops"])
        self.assertEqual(errors, 1)
        self.assertFalse(records[0]["ok"])
        self.assertEqual(records[0]["error_type"], "JSONDecodeError")
        self.assertEqual(records[0]["line"], 1)

    def test_unknown_command_and_missing_field(self) -> None:
        records, _ = run_lines([
            json.dumps({"cmd": "frobnicate"}),
            json.dumps({"cmd": "register", "resource": "r"}),  # 缺 ttl
            json.dumps({"cmd": "acquire"}),
        ])
        for rec in records:
            self.assertFalse(rec["ok"])
            self.assertIn("error", rec)

    def test_not_an_object(self) -> None:
        k = LeaseKernel(ManualClock(0.0))
        with self.assertRaises(ValidationError):
            handle_command(k, [1, 2, 3])  # type: ignore[arg-type]


class ClockControlTest(unittest.TestCase):
    def test_rollback_and_jump_via_cli(self) -> None:
        lines = [
            json.dumps({"cmd": "register", "resource": "r",
                        "ttl": 10, "epsilon": 1}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
            json.dumps({"cmd": "set_clock", "time": 999}),
            json.dumps({"cmd": "status", "resource": "r"}),
            json.dumps({"cmd": "set_clock", "time": 0}),
            json.dumps({"cmd": "status", "resource": "r"}),
            json.dumps({"cmd": "write", "resource": "r",
                        "holder": "a", "generation": 1}),
        ]
        records, errors = run_lines(lines)
        self.assertEqual(errors, 0)
        self.assertEqual(records[3]["status"]["state"], "expired")
        # 回退后依然过期（高水位）
        self.assertEqual(records[5]["status"]["state"], "expired")
        self.assertFalse(records[6]["allowed"])

    def test_advance_negative_rejected(self) -> None:
        records, errors = run_lines([json.dumps({"cmd": "advance", "delta": -1})])
        self.assertEqual(errors, 1)
        self.assertFalse(records[0]["ok"])

    def test_zero_epsilon_boundary(self) -> None:
        lines = [
            json.dumps({"cmd": "register", "resource": "r",
                        "ttl": 5, "epsilon": 0}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
            json.dumps({"cmd": "advance", "delta": 4}),
            json.dumps({"cmd": "status", "resource": "r"}),
            json.dumps({"cmd": "advance", "delta": 1}),
            json.dumps({"cmd": "status", "resource": "r"}),
        ]
        records, errors = run_lines(lines)
        self.assertEqual(errors, 0)
        self.assertEqual(records[3]["status"]["state"], "safe")
        self.assertEqual(records[5]["status"]["state"], "expired")


class LogAndInspectTest(unittest.TestCase):
    def test_log_contains_decisions_with_reasons(self) -> None:
        records, _ = run_lines([
            json.dumps({"cmd": "register", "resource": "r",
                        "ttl": 10, "epsilon": 1}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
            json.dumps({"cmd": "acquire", "resource": "r", "holder": "b"}),
            json.dumps({"cmd": "log"}),
        ])
        events = records[3]["events"]
        kinds = [(e["kind"], e["result"], e["reason"]) for e in events]
        self.assertIn(("register", "ok", "registered"), kinds)
        self.assertIn(("grant", "ok", "granted"), kinds)
        self.assertIn(("acquire", "denied", "lease_active_other_holder"), kinds)
        self.assertTrue(all("monotonic" in e and "clock_now" in e
                            for e in events))

    def test_log_limit(self) -> None:
        k = LeaseKernel(ManualClock(0.0))
        k.register_resource("r", ttl=10)
        k.acquire("r", "a")
        out = cmd(k, {"cmd": "log", "limit": 1})
        self.assertEqual(out["count"], 1)
        with self.assertRaises(ValidationError):
            cmd(k, {"cmd": "log", "limit": -2})

    def test_inspect_returns_full_state(self) -> None:
        k = LeaseKernel(ManualClock(3.0))
        k.register_resource("r", ttl=10, epsilon=2)
        out = cmd(k, {"cmd": "inspect"})
        state = out["state"]
        self.assertEqual(state["clock"]["now"], 3.0)
        self.assertIn("r", state["resources"])
        self.assertEqual(state["resources"]["r"]["ttl"], 10.0)
        self.assertEqual(state["resources"]["r"]["epsilon"], 2.0)

    def test_reset(self) -> None:
        k = LeaseKernel(ManualClock(5.0))
        k.register_resource("r", ttl=10)
        out = cmd(k, {"cmd": "reset", "initial": 7})
        self.assertTrue(out["ok"])
        self.assertEqual(out["now"], 7.0)
        self.assertEqual(k.to_dict()["resources"], {})


class ExportImportCliTest(unittest.TestCase):
    def test_export_import_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            lines1 = [
                json.dumps({"cmd": "register", "resource": "r",
                            "ttl": 100, "epsilon": 10}),
                json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
                json.dumps({"cmd": "advance", "delta": 5}),
                json.dumps({"cmd": "export", "path": path}),
            ]
            records, errors = run_lines(lines1)
            self.assertEqual(errors, 0)
            self.assertTrue(os.path.exists(path))
            with open(path, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
            self.assertEqual(saved["clock"]["now"], 5.0)

            lines2 = [
                json.dumps({"cmd": "import", "path": path}),
                json.dumps({"cmd": "status", "resource": "r"}),
            ]
            records2, errors2 = run_lines(lines2)
            self.assertEqual(errors2, 0)
            self.assertTrue(records2[0]["ok"])
            self.assertEqual(records2[1]["status"]["holder"], "a")

    def test_import_corrupt_file_returns_json_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{garbage")
            records, errors = run_lines([
                json.dumps({"cmd": "register", "resource": "r", "ttl": 10}),
                json.dumps({"cmd": "import", "path": path}),
                json.dumps({"cmd": "status", "resource": "r"}),
            ])
            self.assertEqual(errors, 1)
            self.assertFalse(records[1]["ok"])
            self.assertEqual(records[1]["error_type"], "PersistenceError")
            # 导入失败后原状态保持不变：资源仍可查询
            self.assertTrue(records[2]["ok"])
            self.assertEqual(records[2]["status"]["state"], "free")

    def test_import_validation_error_expire_before_grant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            records, _ = run_lines([
                json.dumps({"cmd": "register", "resource": "r",
                            "ttl": 10, "epsilon": 1}),
                json.dumps({"cmd": "acquire", "resource": "r", "holder": "a"}),
                json.dumps({"cmd": "export", "path": path}),
            ])
            self.assertTrue(records[2]["ok"])
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            data["resources"]["r"]["lease"]["expire_mono"] = -1
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            records2, errors = run_lines([json.dumps(
                {"cmd": "import", "path": path})])
            self.assertEqual(errors, 1)
            self.assertIn("到期时刻", records2[0]["error"])


if __name__ == "__main__":
    unittest.main()
