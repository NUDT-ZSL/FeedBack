"""main.py 命令行端到端测试。"""

from __future__ import annotations

import io
import json
import subprocess
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import main as cli

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "examples"


def run_cli(argv) -> dict:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = cli.main(argv)
    assert code == 0, argv
    return json.loads(buf.getvalue())


class CliBatchTests(unittest.TestCase):
    def test_full_example(self) -> None:
        result = run_cli([
            "-e", str(EXAMPLES / "events.jsonl"),
            "-r", str(EXAMPLES / "rules.json"),
            "-w", "60", "-g", "service,instance",
            "--allowed-lateness", "300",
            "-f", "sum,avg,min,max,count",
        ])
        summary = result["summary"]
        self.assertEqual(summary["events_received"], 32)
        self.assertEqual(summary["events_dropped_late"], 1)  # 09:30 的 legacy 事件
        self.assertEqual(summary["event_parse_errors"], 0)
        self.assertEqual(result["rule_errors"], [])
        self.assertGreater(len(result["aggregations"]), 0)
        # 每个聚合点字段完整。
        for point in result["aggregations"]:
            self.assertEqual(
                set(point),
                {"metric_name", "func", "timestamp", "window_start", "window_end",
                 "key_tags", "value"},
            )
        # 告警成对出现 firing/resolved，且包含通配规则 cpu_us_regions_hot。
        rule_ids = {a["rule_id"] for a in result["alerts"]}
        self.assertIn("cpu_auth_high", rule_ids)
        self.assertIn("cpu_us_regions_hot", rule_ids)
        self.assertIn("error_spike_sliding", rule_ids)
        statuses = [a["status"] for a in result["alerts"]]
        self.assertIn("firing", statuses)
        self.assertIn("resolved", statuses)
        for alert in result["alerts"]:
            self.assertEqual(
                set(alert),
                {"alert_id", "rule_id", "metric_name", "status", "window_start",
                 "window_end", "value", "threshold", "channel", "tags"},
            )

    def test_error_files(self) -> None:
        result = run_cli([
            "-e", str(EXAMPLES / "events_with_errors.jsonl"),
            "-r", str(EXAMPLES / "rules_with_errors.json"),
            "-w", "60",
        ])
        self.assertEqual(result["summary"]["event_parse_errors"], 6)
        self.assertEqual(len(result["rule_errors"]), 9)
        # 合法规则仍生效。
        self.assertTrue(any(a["rule_id"] == "valid_cpu" for a in result["alerts"]))

    def test_stdin_dash(self) -> None:
        payload = (
            '{"metric_name": "cpu", "value": 99, '
            '"timestamp": "2026-09-09T10:00:01Z", "tags": {"service": "auth"}}\n'
        )
        old_stdin = sys.stdin
        sys.stdin = io.StringIO(payload)
        try:
            result = run_cli(["-e", "-", "-w", "60", "-f", "max"])
        finally:
            sys.stdin = old_stdin
        self.assertEqual(result["aggregations"][0]["value"], 99.0)

    def test_tag_filter_and_metric_args(self) -> None:
        result = run_cli([
            "-e", str(EXAMPLES / "events.jsonl"),
            "-r", str(EXAMPLES / "rules.json"),
            "-w", "60", "-g", "service,region",
            "--metric", "cpu_usage",
            "--tag-filter", "service=auth",
            "-f", "avg",
        ])
        self.assertTrue(result["aggregations"])
        for p in result["aggregations"]:
            self.assertEqual(p["metric_name"], "cpu_usage")
            self.assertEqual(p["key_tags"].get("service"), "auth")

    def test_output_file(self) -> None:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            code = cli.main([
                "-e", str(EXAMPLES / "events.jsonl"),
                "-r", str(EXAMPLES / "rules.json"),
                "-o", str(out),
            ])
            self.assertEqual(code, 0)
            data = json.loads(out.read_text(encoding="utf-8"))
            self.assertIn("alerts", data)

    def test_empty_input_is_valid(self) -> None:
        old_stdin = sys.stdin
        sys.stdin = io.StringIO("")
        try:
            result = run_cli(["-w", "60"])
        finally:
            sys.stdin = old_stdin
        self.assertEqual(result["aggregations"], [])
        self.assertEqual(result["alerts"], [])


class CliInteractiveTests(unittest.TestCase):
    def test_interactive_dynamic_rules(self) -> None:
        script = (
            '{"metric_name": "cpu_usage", "value": 50, '
            '"timestamp": "2026-09-09T10:00:05Z", "tags": {"region": "us-east"}}\n'
            f":rules {EXAMPLES / 'rules_extra.json'}\n"
            '{"metric_name": "cpu_usage", "value": 99, '
            '"timestamp": "2026-09-09T10:01:05Z", "tags": {"region": "us-east"}}\n'
            ":rules-list\n"
            ":alerts\n"
            ":quit\n"
        )
        proc = subprocess.run(
            [sys.executable, str(ROOT / "main.py"), "--interactive", "-w", "60",
             "--allowed-lateness", "3600"],
            input=script, capture_output=True, text=True, encoding="utf-8",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        types = [json.loads(line).get("type") for line in proc.stdout.splitlines() if line]
        self.assertIn("rules_loaded", types)
        self.assertIn("alert", types)
        loaded = [json.loads(l) for l in proc.stdout.splitlines()
                  if l and json.loads(l).get("type") == "rules_loaded"][0]
        self.assertEqual(loaded["new_ids"], ["cpu_critical"])


if __name__ == "__main__":
    unittest.main()
