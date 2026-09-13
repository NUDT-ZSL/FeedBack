"""CLI 的**子进程黑盒**端到端测试。

与 ``test_cli.py``（进程内直接调 ``run``）不同，这里用 ``subprocess`` 真正
启动 ``python main.py``，把命令通过 stdin 喂进去，断言：

- 每条输入命令都得到**恰好一行可解析的 JSON**（一一对应，不多不少）；
- 错误路径的输出含 ``error`` 字段且 ``code`` 稳定，进程**不崩溃**、
  退出码为 0，后续命令继续得到正常结果；
- load 坏文件 / 不连续变更记录 / rollback 不存在版本 / move 移进子树
  等异常路径下，会话内存状态不被污染。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from typing import Any, Dict, List, Optional, Sequence

import main as cli  # 仅用于定位 main.py 的绝对路径

MAIN_PY = os.path.abspath(cli.__file__)


def run_subprocess(
    commands: Sequence[Dict[str, Any]], *, cwd: Optional[str] = None
) -> List[Dict[str, Any]]:
    """启动一个全新的 main.py 子进程，喂入命令，返回逐行解析后的 JSON 结果。

    同时断言输出行数与命令数相等、退出码为 0、每行都是合法 JSON。
    """
    stdin_text = "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in commands)
    proc = subprocess.run(
        [sys.executable, MAIN_PY],
        input=stdin_text,
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=cwd,
        timeout=30,
    )
    assert proc.returncode == 0, f"process exited {proc.returncode}\nstderr:\n{proc.stderr}"
    lines = proc.stderr.splitlines()
    assert not lines, f"unexpected stderr output:\n{proc.stderr}"
    out_lines = proc.stdout.splitlines()
    assert len(out_lines) == len(commands), (
        f"expected {len(commands)} output lines, got {len(out_lines)}:\n{proc.stdout}"
    )
    results: List[Dict[str, Any]] = []
    for i, line in enumerate(out_lines):
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError as exc:  # pragma: no cover - 失败即测试失败
            raise AssertionError(f"output line {i} is not valid JSON: {line!r}") from exc
        assert isinstance(parsed, dict), f"line {i} is not a JSON object: {line!r}"
        results.append(parsed)
    return results


def build_good_journal(path: str) -> None:
    """用一个干净的子进程会话生成合法日志。"""
    run_subprocess(
        [
            {"op": "add", "node_id": "r", "parent_id": None, "kind": "section"},
            {"op": "add", "node_id": "a", "parent_id": "r", "kind": "section"},
            {"op": "add", "node_id": "a1", "parent_id": "a", "kind": "note", "content": "x"},
            {"op": "add", "node_id": "b", "parent_id": "r", "kind": "note"},
            {"op": "add_ref", "owner": "b", "target": "a1"},
            {"op": "save", "path": path},
        ]
    )


class BlackboxErrorContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def path(self, name: str) -> str:
        return os.path.join(self.dir, name)

    def _tamper(self, name: str, mutate) -> str:
        """读回日志，按 ``mutate(records)`` 篡改后重写。"""
        p = self.path(name)
        build_good_journal(p)
        with open(p, encoding="utf-8") as fh:
            records = [json.loads(line) for line in fh if line.strip()]
        mutate(records)
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")
        return p

    # ------------------------------------------------ 基础契约

    def test_every_command_emits_exactly_one_json_line(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "path", "node_id": "r"},
                {"op": "dump"},
            ]
        )
        self.assertTrue(all("ok" in r or "error" in r for r in results))

    def test_garbage_input_line_is_json_error_and_session_lives(self) -> None:
        # 直接构造原始字节流：坏 JSON 行夹在正常命令之间。
        stdin_text = (
            '{"op":"add","node_id":"r","parent_id":null,"kind":"s"}\n'
            "this is not json\n"
            '{"op":"path","node_id":"r"}\n'
        )
        proc = subprocess.run(
            [sys.executable, MAIN_PY],
            input=stdin_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0)
        lines = proc.stdout.splitlines()
        self.assertEqual(len(lines), 3)
        r1, r2, r3 = (json.loads(x) for x in lines)
        self.assertNotIn("error", r1)
        self.assertEqual(r2["code"], "invalid_json")
        self.assertIn("error", r2)
        self.assertEqual(r3["path"], ["r"])  # 坏行后会话继续工作

    def test_move_into_subtree_is_json_error(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "add", "node_id": "a", "parent_id": "r", "kind": "s"},
                {"op": "add", "node_id": "a1", "parent_id": "a", "kind": "n"},
                {"op": "move", "node_id": "a", "parent_id": "a1", "index": 0},
                {"op": "path", "node_id": "a"},
            ]
        )
        err = results[3]
        self.assertEqual(err["code"], "validation_error")
        self.assertIn("cycle", err["error"])
        self.assertIn("error", err)
        # 状态未变。
        self.assertEqual(results[4]["path"], ["r", "a"])

    def test_move_to_self_is_json_error(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "move", "node_id": "r", "parent_id": "r", "index": 0},
            ]
        )
        self.assertEqual(results[1]["code"], "validation_error")

    def test_move_bad_index_is_json_error(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "add", "node_id": "a", "parent_id": "r", "kind": "n"},
                {"op": "move", "node_id": "a", "parent_id": "r", "index": 9},
            ]
        )
        self.assertEqual(results[2]["code"], "validation_error")
        self.assertIn("out of range", results[2]["error"])

    def test_rollback_unknown_version_is_json_error(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "rollback", "version": 99},
                {"op": "dump"},
            ]
        )
        self.assertEqual(results[1]["code"], "version_not_found")
        self.assertIn("99", results[1]["error"])
        # 回滚失败不改变当前版本。
        self.assertEqual(results[2]["version"], 1)

    def test_remove_referenced_node_strict_is_json_error(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "add", "node_id": "x", "parent_id": "r", "kind": "n"},
                {"op": "add", "node_id": "y", "parent_id": "r", "kind": "n"},
                {"op": "add_ref", "owner": "y", "target": "x"},
                {"op": "policy", "policy": "strict"},
                {"op": "remove", "node_id": "x"},
                {"op": "dangling"},
            ]
        )
        self.assertEqual(results[5]["code"], "dangling_reference")
        self.assertEqual(results[6]["dangling"], [])  # strict 失败，引用仍有效

    # ------------------------------------------------ load 坏文件

    def test_load_non_existent_file(self) -> None:
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "load", "path": self.path("missing.dtj")},
                {"op": "dump"},
            ]
        )
        self.assertEqual(results[1]["code"], "file_not_found")
        self.assertIn("error", results[1])
        # 加载失败：会话保持加载前状态。
        self.assertEqual(results[2]["root_id"], "r")
        self.assertEqual(results[2]["version"], 1)

    def test_load_garbage_file_is_json_error(self) -> None:
        p = self.path("garbage.dtj")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write("this is not a journal at all\n")
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "load", "path": p},
                {"op": "dump"},
            ]
        )
        err = results[1]
        self.assertEqual(err["code"], "validation_error")
        self.assertIn("line 1", err["error"])
        self.assertIn("invalid JSON", err["error"])
        # 会话内存未被半加载污染。
        self.assertEqual(results[2]["root_id"], "r")
        self.assertEqual(results[2]["version"], 1)

    def test_load_wrong_header_record_is_json_error(self) -> None:
        p = self.path("badheader.dtj")
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(json.dumps({"type": "change", "seq": 1}) + "\n")
        results = run_subprocess([{"op": "load", "path": p}])
        err = results[0]
        self.assertEqual(err["code"], "validation_error")
        self.assertIn("header", err["error"])

    def test_load_non_consecutive_seq_error_locates_change(self) -> None:
        def mutate(records: List[Dict[str, Any]]) -> None:
            records[-1]["seq"] += 5  # 断号

        p = self._tamper("gap.dtj", mutate)
        results = run_subprocess(
            [
                {"op": "load", "path": p},
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
            ]
        )
        err = results[0]
        self.assertEqual(err["code"], "invalid_change")
        self.assertIn("error", err)
        # 错误必须定位到第几条变更 / 行号 / op / node。
        self.assertEqual(err["change_no"], 5)
        self.assertEqual(err["op"], "ref_add")
        self.assertEqual(err["node_id"], "b")
        self.assertIn("line_no", err)
        self.assertIn("not consecutive", err["error"])
        # 加载失败后会话仍是空树，可正常继续。
        self.assertNotIn("error", results[1])
        self.assertEqual(results[1]["node"]["node_id"], "r")

    def test_load_cycle_change_error_locates_node(self) -> None:
        p = self.path("cycle.dtj")
        build_good_journal(p)
        with open(p, encoding="utf-8") as fh:
            records = [json.loads(x) for x in fh if x.strip()]
        v = records[-1]["version"]
        records.append(
            {
                "type": "change",
                "seq": len(records) + 1,
                "segment": 0,
                "base_version": v,
                "version": v + 1,
                "change": {"op": "move", "node_id": "a", "new_parent_id": "a1", "index": 0},
            }
        )
        with open(p, "w", encoding="utf-8", newline="\n") as fh:
            for r in records:
                fh.write(json.dumps(r) + "\n")

        results = run_subprocess([{"op": "load", "path": p}, {"op": "dump"}])
        err = results[0]
        self.assertEqual(err["code"], "invalid_change")
        self.assertEqual(err["change_no"], 6)
        self.assertEqual(err["op"], "move")
        self.assertEqual(err["node_id"], "a")
        self.assertIn("cycle", err["error"])
        # 加载失败：dump 出来是空树，而不是半截状态。
        self.assertEqual(results[1]["size"], 0)
        self.assertIsNone(results[1]["root_id"])

    def test_load_missing_target_ref_error(self) -> None:
        def mutate(records: List[Dict[str, Any]]) -> None:
            records[-1]["change"]["target"] = "ghost"

        p = self._tamper("badref.dtj", mutate)
        results = run_subprocess([{"op": "load", "path": p}])
        err = results[0]
        self.assertEqual(err["code"], "invalid_change")
        self.assertEqual(err["change_no"], 5)
        self.assertEqual(err["node_id"], "b")
        self.assertIn("ghost", err["error"])

    def test_load_base_version_mismatch_error(self) -> None:
        def mutate(records: List[Dict[str, Any]]) -> None:
            records[3]["base_version"] = 99  # 第 2 条变更的链断了

        p = self._tamper("base.dtj", mutate)
        results = run_subprocess([{"op": "load", "path": p}])
        err = results[0]
        self.assertEqual(err["code"], "invalid_change")
        self.assertEqual(err["change_no"], 2)
        self.assertIn("99", err["error"])
        self.assertIn("does not match", err["error"])

    def test_load_corrupt_snapshot_error(self) -> None:
        def mutate(records: List[Dict[str, Any]]) -> None:
            # 把唯一快照整体替换成带孤儿节点的坏快照。
            records[1]["snapshot"] = {
                "version": 0,
                "root_id": None,
                "policy": "cascade",
                "nodes": {
                    "z": {
                        "node_id": "z",
                        "parent_id": "missing-parent",
                        "kind": "n",
                        "content": "",
                        "children": [],
                        "refs": [],
                    }
                },
            }

        p = self._tamper("badsnap.dtj", mutate)
        results = run_subprocess([{"op": "load", "path": p}])
        self.assertEqual(results[0]["code"], "validation_error")
        self.assertIn("line 2", results[0]["error"])

    # ------------------------------------------------ 正常路径对照

    def test_good_file_loads_and_continues_in_subprocess(self) -> None:
        p = self.path("good.dtj")
        build_good_journal(p)
        results = run_subprocess(
            [
                {"op": "load", "path": p},
                {"op": "subtree", "node_id": "r"},
                {"op": "resolve", "node_id": "b"},
            ]
        )
        self.assertNotIn("error", results[0])
        self.assertEqual(results[0]["version"], 5)
        self.assertEqual(results[1]["ids"], ["r", "a", "a1", "b"])
        self.assertTrue(results[2]["refs"][0]["exists"])

    def test_save_load_roundtrip_after_rollback_in_subprocess(self) -> None:
        p = self.path("rb.dtj")
        results = run_subprocess(
            [
                {"op": "add", "node_id": "r", "parent_id": None, "kind": "s"},
                {"op": "add", "node_id": "a", "parent_id": "r", "kind": "n", "content": "v1"},
                {"op": "save", "path": p},                       # v2 落盘
                {"op": "update_content", "node_id": "a", "content": "v2"},
                {"op": "save", "path": p},                       # v3 落盘
                {"op": "rollback", "version": 2},                # 回到 save 边界
                {"op": "path", "node_id": "r"},                  # 只查询
                {"op": "update_content", "node_id": "a", "content": "v3"},
                {"op": "save", "path": p},                       # 新分支 v4
                {"op": "load", "path": p},
                {"op": "diff", "v1": 3, "v2": 4},
            ]
        )
        for i, r in enumerate(results):
            self.assertNotIn("error", r, f"command {i}: {r}")
        self.assertEqual(results[5]["version"], 2)
        self.assertEqual(results[9]["version"], 4)
        diff = results[10]["diff"]
        self.assertEqual(
            diff["content_changed"],
            [{"node_id": "a", "old": "v2", "new": "v3"}],
        )


if __name__ == "__main__":
    unittest.main()
