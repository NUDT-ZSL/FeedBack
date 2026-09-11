"""逐行 JSON 命令行接口的测试。"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest

from causal_engine import CausalEngine
from causal_engine.cli import process_command, run_stream


def run_commands(lines: list[str]) -> tuple[CausalEngine, list[dict]]:
    """把命令行字符串喂给 CLI，返回 (最终引擎, 解析后的响应列表)。"""
    inp = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
    out = io.StringIO()
    engine = run_stream(inp, out)
    responses = [json.loads(line) for line in out.getvalue().splitlines()]
    return engine, responses


class TestCLICommands(unittest.TestCase):
    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = os.path.join(self.tmpdir.name, "state.json")

    def _event(self, **kwargs) -> dict:
        return {"cmd": "append", "event": kwargs}

    def _build_commands(self) -> list[str]:
        return [
            json.dumps({"cmd": "register", "process_id": "p1"}),
            json.dumps({"cmd": "register", "process_id": "p2"}),
            json.dumps(
                self._event(
                    event_id="a1", process_id="p1", seq=1, vector={"p1": 0}
                )
            ),
            json.dumps(
                self._event(
                    event_id="b1", process_id="p2", seq=1, vector={"p2": 0}
                )
            ),
            json.dumps(
                self._event(
                    event_id="b2",
                    process_id="p2",
                    seq=2,
                    vector={"p1": 1, "p2": 1},
                    payload={"msg": "hello"},
                )
            ),
        ]

    def test_register_append_state_get_list(self) -> None:
        engine, responses = run_commands(self._build_commands())
        self.assertTrue(all(r["ok"] for r in responses), responses)

        inp = io.StringIO(
            "\n".join(
                [
                    json.dumps({"cmd": "state"}),
                    json.dumps({"cmd": "get", "event_id": "b2"}),
                    json.dumps({"cmd": "get", "event_id": "missing"}),
                    json.dumps({"cmd": "list", "process_id": "p2"}),
                ]
            )
            + "\n"
        )
        out = io.StringIO()
        engine = run_stream(inp, out, engine)
        more = [json.loads(line) for line in out.getvalue().splitlines()]
        state_resp, get_resp, missing_resp, list_resp = more
        self.assertEqual(state_resp["result"]["total_events"], 3)
        self.assertEqual(get_resp["result"]["event_id"], "b2")
        self.assertEqual(get_resp["result"]["payload"], {"msg": "hello"})
        self.assertIsNone(missing_resp["result"])
        self.assertEqual(
            [e["event_id"] for e in list_resp["result"]], ["b1", "b2"]
        )

    def test_snapshot_success_and_failure(self) -> None:
        commands = self._build_commands()
        commands.append(
            json.dumps({"cmd": "snapshot", "process_cut": {"p1": 1, "p2": 2}})
        )
        _, responses = run_commands(commands)
        snap = responses[-1]
        self.assertTrue(snap["ok"])
        self.assertEqual([e["event_id"] for e in snap["result"]], ["a1", "b1", "b2"])

        _, bad = run_commands(
            self._build_commands()
            + [
                json.dumps(
                    {"cmd": "snapshot", "process_cut": {"p1": 0, "p2": 2}}
                )
            ]
        )
        self.assertFalse(bad[-1]["ok"])
        self.assertIn("error", bad[-1])
        self.assertEqual(
            bad[-1]["error_type"], "InconsistentSnapshotError"
        )
        self.assertIn("a1", bad[-1]["error"])

    def test_replay_and_dedup(self) -> None:
        _, responses = run_commands(
            self._build_commands()
            + [json.dumps({"cmd": "replay", "seeds": ["b2", "b2"]})]
        )
        replay = responses[-1]
        self.assertTrue(replay["ok"])
        self.assertEqual(
            [e["event_id"] for e in replay["result"]], ["a1", "b1", "b2"]
        )

    def test_replay_unknown_seed(self) -> None:
        _, responses = run_commands(
            [json.dumps({"cmd": "replay", "seeds": ["ghost"]})]
        )
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["error_type"], "UnknownEventError")

    def test_error_paths_as_json(self) -> None:
        cases: list[tuple[dict, str]] = [
            ({"cmd": "register", "process_id": "p1"}, "ok-first"),
        ]
        engine = CausalEngine()
        engine.register_process("p1")
        # 直接用 process_command 精确断言错误结构
        _, dup = process_command(
            engine, {"cmd": "register", "process_id": "p1"}
        )
        self.assertFalse(dup["ok"])
        self.assertEqual(dup["error_type"], "DuplicateProcessError")

        _, unknown_cmd = process_command(engine, {"cmd": "frobnicate"})
        self.assertFalse(unknown_cmd["ok"])
        self.assertIn("unknown command", unknown_cmd["error"])

        _, missing_field = process_command(engine, {"cmd": "save"})
        self.assertEqual(missing_field["error_type"], "ProtocolError")
        self.assertIn("path", missing_field["error"])

        _, bad_json_type = process_command(engine, {"cmd": "state", "extra": 0})
        self.assertTrue(bad_json_type["ok"])

    def test_malformed_input_lines(self) -> None:
        inp = io.StringIO("not json\n\n" + json.dumps({"cmd": "state"}) + "\n")
        out = io.StringIO()
        run_stream(inp, out)
        responses = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertEqual(len(responses), 2)  # 空行被忽略
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["error_type"], "ProtocolError")
        self.assertTrue(responses[1]["ok"])

    def test_non_object_line(self) -> None:
        inp = io.StringIO("[1, 2]\n")
        out = io.StringIO()
        run_stream(inp, out)
        response = json.loads(out.getvalue().strip())
        self.assertFalse(response["ok"])

    def test_append_bad_event_payload(self) -> None:
        _, responses = run_commands(
            [
                json.dumps({"cmd": "register", "process_id": "p1"}),
                json.dumps({"cmd": "append", "event": {"event_id": "e"}}),
            ]
        )
        self.assertFalse(responses[1]["ok"])
        self.assertIn("missing", responses[1]["error"])

    def test_save_load_dump_round_trip(self) -> None:
        commands = self._build_commands()
        commands.append(json.dumps({"cmd": "save", "path": self.path}))
        commands.append(json.dumps({"cmd": "dump"}))
        _, responses = run_commands(commands)
        self.assertTrue(responses[-2]["ok"])
        self.assertEqual(responses[-2]["result"]["saved"], True)
        dump = responses[-1]["result"]
        self.assertEqual(len(dump["events"]), 3)

        _, loaded_responses = run_commands(
            [
                json.dumps({"cmd": "load", "path": self.path}),
                json.dumps({"cmd": "replay", "seeds": ["b2"]}),
            ]
        )
        self.assertTrue(loaded_responses[0]["ok"])
        self.assertEqual(loaded_responses[0]["result"]["total_events"], 3)
        self.assertEqual(
            [e["event_id"] for e in loaded_responses[1]["result"]],
            ["a1", "b1", "b2"],
        )

    def test_load_missing_file_error_json(self) -> None:
        _, responses = run_commands(
            [json.dumps({"cmd": "load", "path": os.path.join(self.path, "x")})]
        )
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["error_type"], "PersistenceError")

    def test_seq_gap_rejected_via_cli(self) -> None:
        _, responses = run_commands(
            [
                json.dumps({"cmd": "register", "process_id": "p1"}),
                json.dumps(
                    self._event(
                        event_id="a1", process_id="p1", seq=1, vector={"p1": 0}
                    )
                ),
                json.dumps(
                    self._event(
                        event_id="a3", process_id="p1", seq=3, vector={"p1": 1}
                    )
                ),
            ]
        )
        self.assertFalse(responses[2]["ok"])
        self.assertEqual(responses[2]["error_type"], "InvalidEventError")
        self.assertIn("expected 2", responses[2]["error"])


if __name__ == "__main__":
    unittest.main()
