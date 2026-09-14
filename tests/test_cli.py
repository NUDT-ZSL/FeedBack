"""行式 JSON 命令行入口测试。

覆盖需求列举的边界：空系统、单资源、重复申请、释放未占用资源、
初始化中断后立即申请、释放连续失败到上限、清理部分失败、导入损坏文件，
以及坏 JSON 行、未知命令、导出导入往返。
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

from resource_kernel.cli import run


def feed(lines: list[str], max_retries: int = 3) -> list[dict]:
    """把若干命令行喂给 CLI，返回逐行解析后的响应列表。"""
    in_stream = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
    out_stream = io.StringIO()
    code = run(in_stream, out_stream, max_retries=max_retries)
    assert code == 0
    responses = []
    for line in out_stream.getvalue().splitlines():
        responses.append(json.loads(line))
    return responses


def cmd(**kwargs: object) -> str:
    """构造一行 JSON 命令。"""
    return json.dumps(kwargs, ensure_ascii=False)


class CliBasicTests(unittest.TestCase):
    """空系统与单资源基本行为。"""

    def test_empty_system_queries(self) -> None:
        (resp,) = feed([cmd(op="list_unreleased")])
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["resources"], [])

        (resp,) = feed([cmd(op="list_all")])
        self.assertEqual(resp["resources"], [])

        (resp,) = feed([cmd(op="force_cleanup")])
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["cleanup"]["succeeded"], [])
        self.assertEqual(resp["cleanup"]["manual_review"], [])

    def test_single_resource_lifecycle(self) -> None:
        responses = feed(
            [
                cmd(op="register", name="r"),
                cmd(op="acquire", name="r", owner="w1"),
                cmd(op="status", name="r"),
                cmd(op="list_unreleased"),
                cmd(op="release", name="r"),
                cmd(op="list_unreleased"),
            ]
        )
        self.assertTrue(all(r["ok"] for r in responses), responses)
        self.assertEqual(responses[2]["resource"]["state"], "occupied")
        self.assertEqual(responses[2]["resource"]["owner"], "w1")
        self.assertEqual([r["name"] for r in responses[3]["resources"]], ["r"])
        self.assertEqual(responses[4]["state"], "released")
        self.assertEqual(responses[5]["resources"], [])

    def test_duplicate_register_is_json_error(self) -> None:
        responses = feed(
            [cmd(op="register", name="r"), cmd(op="register", name="r")]
        )
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[1]["ok"])
        self.assertEqual(responses[1]["code"], "resource_already_exists")

    def test_duplicate_acquire_names_holder(self) -> None:
        responses = feed(
            [
                cmd(op="register", name="r"),
                cmd(op="acquire", name="r", owner="w1"),
                cmd(op="acquire", name="r", owner="w2"),
            ]
        )
        self.assertTrue(responses[1]["ok"])
        err = responses[2]
        self.assertFalse(err["ok"])
        self.assertEqual(err["code"], "resource_busy")
        self.assertIn("w1", err["error"])

    def test_release_unoccupied(self) -> None:
        responses = feed(
            [cmd(op="register", name="r"), cmd(op="release", name="r")]
        )
        self.assertFalse(responses[1]["ok"])
        self.assertEqual(responses[1]["code"], "resource_not_occupied")

    def test_status_unknown(self) -> None:
        (resp,) = feed([cmd(op="status", name="ghost")])
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["code"], "resource_not_found")


class CliFailureInjectionTests(unittest.TestCase):
    """通过 config 注入失败：初始化中断、释放连续失败到上限。"""

    def test_init_interrupt_then_immediate_acquire(self) -> None:
        responses = feed(
            [
                cmd(op="config", init_fail={"r": 1}),
                cmd(op="register", name="r"),
                cmd(op="acquire", name="r", owner="old"),
                cmd(op="status", name="r"),
                cmd(op="acquire", name="r", owner="new"),
                cmd(op="status", name="r"),
            ]
        )
        self.assertTrue(responses[0]["ok"])
        self.assertFalse(responses[2]["ok"])
        self.assertEqual(responses[2]["code"], "invalid_state")
        self.assertIn("rolled back", responses[2]["error"])
        # 回退后立即查询：空闲、无归属、计数 0。
        self.assertEqual(responses[3]["resource"]["state"], "idle")
        self.assertIsNone(responses[3]["resource"]["owner"])
        self.assertEqual(responses[3]["resource"]["occupation_count"], 0)
        # 再次申请成功且无残留。
        self.assertTrue(responses[4]["ok"], responses[4])
        status = responses[5]["resource"]
        self.assertEqual(status["state"], "occupied")
        self.assertEqual(status["owner"], "new")
        self.assertEqual(status["occupation_count"], 1)

    def test_release_failures_to_limit_then_cleanup_recovers(self) -> None:
        responses = feed(
            [
                cmd(op="config", release_fail={"r": 2}),
                cmd(op="register", name="r"),
                cmd(op="acquire", name="r", owner="w"),
                cmd(op="release", name="r"),     # 1/2 releasing
                cmd(op="retry", name="r"),       # 2/2 failed
                cmd(op="status", name="r"),
                cmd(op="force_cleanup"),         # 第 3 次：恢复，释放成功
                cmd(op="status", name="r"),
            ],
            max_retries=2,
        )
        self.assertEqual(responses[3]["state"], "releasing")
        self.assertEqual(responses[3]["retry_count"], 1)
        self.assertEqual(responses[4]["state"], "failed")
        self.assertEqual(responses[4]["retry_count"], 2)
        failed_status = responses[5]["resource"]
        self.assertEqual(failed_status["state"], "failed")
        self.assertEqual(failed_status["occupation_count"], 0)
        self.assertIsNone(failed_status["owner"])
        cleanup = responses[6]["cleanup"]
        self.assertEqual(cleanup["succeeded"], ["r"])
        self.assertEqual(cleanup["manual_review"], [])
        self.assertEqual(responses[7]["resource"]["state"], "released")

    def test_force_cleanup_partial_failure(self) -> None:
        responses = feed(
            [
                cmd(op="config", release_fail={"bad": -1}),
                cmd(op="register", name="good"),
                cmd(op="register", name="bad"),
                cmd(op="acquire", name="good", owner="w"),
                cmd(op="acquire", name="bad", owner="w"),
                cmd(op="force_cleanup"),
            ],
            max_retries=1,
        )
        cleanup = responses[5]["cleanup"]
        self.assertEqual(cleanup["succeeded"], ["good"])
        self.assertEqual([f["name"] for f in cleanup["failed"]], ["bad"])
        self.assertEqual(cleanup["manual_review"], ["bad"])


class CliPersistenceTests(unittest.TestCase):
    """CLI 导出/导入与损坏文件。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self._tmp.name, "state.json")

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_export_import_round_trip(self) -> None:
        responses = feed(
            [
                cmd(op="register", name="a"),
                cmd(op="register", name="b"),
                cmd(op="acquire", name="a", owner="w1"),
                cmd(op="release", name="a"),
                cmd(op="export", path=self.path),
                cmd(op="import", path=self.path),
            ]
        )
        self.assertTrue(all(r["ok"] for r in responses), responses)
        resources = responses[5]["resources"]
        self.assertEqual([r["name"] for r in resources], ["a", "b"])
        self.assertEqual(resources[0]["state"], "released")
        self.assertEqual(resources[1]["state"], "idle")

    def test_import_corrupt_file_is_error_and_state_kept(self) -> None:
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write("{broken json!!!")
        responses = feed(
            [
                cmd(op="register", name="keep"),
                cmd(op="acquire", name="keep", owner="w"),
                cmd(op="import", path=self.path),
                cmd(op="status", name="keep"),
            ]
        )
        self.assertTrue(responses[0]["ok"])
        self.assertTrue(responses[1]["ok"])
        err = responses[2]
        self.assertFalse(err["ok"])
        self.assertEqual(err["code"], "persistence_error")
        self.assertIn("not valid JSON", err["error"])
        # 失败后内存状态保持不变。
        still = responses[3]["resource"]
        self.assertEqual(still["state"], "occupied")
        self.assertEqual(still["owner"], "w")

    def test_import_missing_file(self) -> None:
        responses = feed([cmd(op="import", path=os.path.join(self._tmp.name, "x.json"))])
        self.assertFalse(responses[0]["ok"])
        self.assertEqual(responses[0]["code"], "persistence_error")


class CliRobustnessTests(unittest.TestCase):
    """坏输入不中断流；未知命令、inspect、ping、config 校验。"""

    def test_bad_json_line_does_not_stop_stream(self) -> None:
        in_stream = io.StringIO('not a json\n{"op":"ping"}\n')
        out_stream = io.StringIO()
        run(in_stream, out_stream)
        lines = out_stream.getvalue().splitlines()
        self.assertEqual(len(lines), 2)
        first = json.loads(lines[0])
        self.assertFalse(first["ok"])
        self.assertEqual(first["code"], "bad_json")
        second = json.loads(lines[1])
        self.assertTrue(second["pong"])

    def test_non_object_line(self) -> None:
        in_stream = io.StringIO("[1,2]\n")
        out_stream = io.StringIO()
        run(in_stream, out_stream)
        resp = json.loads(out_stream.getvalue())
        self.assertEqual(resp["code"], "invalid_command")

    def test_unknown_op(self) -> None:
        (resp,) = feed([cmd(op="explode")])
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["code"], "unknown_op")

    def test_inspect_returns_snapshot(self) -> None:
        (resp,) = feed(
            [cmd(op="register", name="r"), cmd(op="inspect")]
        )[1:]
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["snapshot"]["version"], 1)
        self.assertEqual(
            [r["name"] for r in resp["snapshot"]["resources"]], ["r"]
        )

    def test_bad_config_rejected(self) -> None:
        (resp,) = feed([cmd(op="config", init_fail={"r": "oops"})])
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["code"], "invalid_config")

    def test_blank_lines_ignored(self) -> None:
        in_stream = io.StringIO("\n\n  \n")
        out_stream = io.StringIO()
        run(in_stream, out_stream)
        self.assertEqual(out_stream.getvalue(), "")


class CliSubprocessTests(unittest.TestCase):
    """真正以子进程方式验证 ``python -m resource_kernel`` 端到端可用。"""

    def test_module_entrypoint(self) -> None:
        proc = subprocess.run(
            [sys.executable, "-m", "resource_kernel"],
            input='{"op":"ping"}\n{"op":"register","name":"x"}\n',
            capture_output=True,
            text=True,
            timeout=30,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [json.loads(line) for line in proc.stdout.splitlines()]
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0]["pong"])
        self.assertTrue(lines[1]["ok"])


if __name__ == "__main__":
    unittest.main()
