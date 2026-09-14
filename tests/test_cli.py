"""CLI 测试：逐行 JSON 命令、输出格式与各类边界行为。"""

import io
import json
import os
import tempfile
import unittest

from batch_scheduler.cli import main


def run_cli(lines) -> list:
    """以字符串列表为输入运行 CLI，返回逐行解析后的输出。"""
    stdin = io.StringIO("\n".join(lines) + "\n")
    stdout = io.StringIO()
    main(stdin, stdout)
    out = stdout.getvalue()
    return [json.loads(line) for line in out.splitlines()] if out.strip() else []


def cmd(**kwargs) -> str:
    return json.dumps(kwargs, ensure_ascii=False)


class CliBasicTests(unittest.TestCase):
    def test_every_line_is_json_with_ok_field(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r1", capacity=2),
                cmd(cmd="submit_task", task_id="t1", resource_id="r1", amount=4, deadline=10),
                "not json at all",
                cmd(cmd="unknown_command_xyz"),
                "",  # 空行应被忽略，不产生输出
            ]
        )
        self.assertEqual(len(outputs), 4)
        for line in outputs:
            self.assertIn("ok", line)
        self.assertTrue(outputs[0]["ok"])
        self.assertTrue(outputs[1]["ok"])
        self.assertFalse(outputs[2]["ok"])
        self.assertEqual(outputs[2]["error"], "invalid_json")
        self.assertFalse(outputs[3]["ok"])
        self.assertEqual(outputs[3]["error"], "unknown_command")

    def test_submit_admit_and_reject(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r1", capacity=2),
                cmd(cmd="submit_task", task_id="t1", resource_id="r1", amount=4, deadline=10),
                cmd(cmd="submit_task", task_id="t1", resource_id="r1", amount=1, deadline=10),
                cmd(cmd="submit_task", task_id="t2", resource_id="ghost", amount=1, deadline=10),
            ]
        )
        admit = outputs[1]
        self.assertTrue(admit["ok"])
        self.assertTrue(admit["admitted"])
        self.assertEqual(admit["task"]["start"], 0)
        self.assertEqual(admit["task"]["end"], 2)
        dup = outputs[2]
        self.assertTrue(dup["ok"])
        self.assertFalse(dup["admitted"])
        self.assertEqual(dup["reason"], "duplicate_task_id")
        ghost = outputs[3]
        self.assertFalse(ghost["admitted"])
        self.assertEqual(ghost["reason"], "resource_not_found")

    def test_deadline_earlier_than_clock(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r1", capacity=1),
                cmd(cmd="advance_clock", time=5),
                cmd(cmd="submit_task", task_id="t", resource_id="r1", amount=1, deadline=3),
            ]
        )
        self.assertFalse(outputs[2]["admitted"])
        self.assertEqual(outputs[2]["reason"], "deadline_passed")

    def test_zero_capacity_resource(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r0", capacity=0),
                cmd(cmd="submit_task", task_id="t", resource_id="r0", amount=1, deadline=100),
            ]
        )
        self.assertTrue(outputs[0]["ok"])
        self.assertFalse(outputs[1]["admitted"])
        self.assertEqual(outputs[1]["reason"], "capacity_insufficient")

    def test_preempt_nonexistent_task(self) -> None:
        outputs = run_cli([cmd(cmd="preempt", task_id="ghost")])
        self.assertFalse(outputs[0]["ok"])
        self.assertEqual(outputs[0]["error"], "task_not_found")

    def test_missing_field(self) -> None:
        outputs = run_cli([cmd(cmd="register_resource", resource_id="r1")])
        self.assertFalse(outputs[0]["ok"])
        self.assertEqual(outputs[0]["error"], "missing_field")

    def test_committed_boundary_via_cli(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r1", capacity=2),
                cmd(cmd="submit_task", task_id="c", resource_id="r1", amount=8, deadline=4,
                    committed=True),
                cmd(cmd="query_task", task_id="c"),
            ]
        )
        self.assertTrue(outputs[1]["admitted"])  # end == deadline == 4，恰好卡住边界
        self.assertEqual(outputs[2]["task"]["end"], 4)


class CliScenarioTests(unittest.TestCase):
    """容量紧张 + 紧急插队 + 抢占 + 记录顺序的完整场景。"""

    def test_urgent_preemption_scenario(self) -> None:
        outputs = run_cli(
            [
                cmd(cmd="register_resource", resource_id="r1", capacity=1),
                cmd(cmd="submit_task", task_id="a", resource_id="r1", amount=3, deadline=3,
                    priority=1),
                cmd(cmd="submit_task", task_id="b", resource_id="r1", amount=2, deadline=10,
                    priority=5),
                cmd(cmd="submit_task", task_id="u", resource_id="r1", amount=2, deadline=4,
                    committed=True),
                cmd(cmd="query_task", task_id="a"),
                cmd(cmd="query_occupancy", resource_id="r1", start=0, end=10),
                cmd(cmd="query_records"),
                cmd(cmd="advance_clock", time=2),
                cmd(cmd="query_task", task_id="b"),
            ]
        )
        urgent = outputs[3]
        self.assertTrue(urgent["admitted"])
        self.assertEqual(urgent["preempted"], ["a"])
        self.assertEqual(urgent["task"]["start"], 0)
        self.assertEqual(urgent["task"]["end"], 2)
        # a 回到待排状态。
        self.assertEqual(outputs[4]["task"]["status"], "pending")
        self.assertIsNone(outputs[4]["task"]["start"])
        # 占用时间线：u[0,2]、b[2,4]，互不重叠。
        intervals = outputs[5]["intervals"]
        self.assertEqual(
            [(iv["task_id"], iv["start"], iv["end"]) for iv in intervals],
            [("u", 0, 2), ("b", 2, 4)],
        )
        # 记录：只有一条抢占记录，displaced_by 为 u。
        records = outputs[6]
        self.assertEqual(records["rejections"], [])
        self.assertEqual(len(records["preemptions"]), 1)
        self.assertEqual(records["preemptions"][0]["task_id"], "a")
        self.assertEqual(records["preemptions"][0]["displaced_by"], "u")
        # 时钟推进到 2 后 a 截止已过，无法重新准入；b 保持 [2,4]。
        self.assertEqual(outputs[7]["resumed"], [])
        self.assertEqual(outputs[8]["task"]["start"], 2)


class CliPersistenceTests(unittest.TestCase):
    def test_export_import_round_trip_and_corrupted_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            good = os.path.join(tmp, "state.json")
            bad = os.path.join(tmp, "broken.json")
            with open(bad, "w", encoding="utf-8") as fh:
                fh.write("{ broken")
            outputs = run_cli(
                [
                    cmd(cmd="register_resource", resource_id="r1", capacity=1),
                    cmd(cmd="submit_task", task_id="a", resource_id="r1", amount=2, deadline=10),
                    cmd(cmd="preempt", task_id="a"),
                    cmd(cmd="export", path=good),
                    # 导出后改变状态：推进时钟并加新任务。
                    cmd(cmd="advance_clock", time=5),
                    cmd(cmd="submit_task", task_id="b", resource_id="r1", amount=1, deadline=20),
                    # 导入损坏文件：报错且状态不变。
                    cmd(cmd="import", path=bad),
                    cmd(cmd="dump_state"),
                    # 导入正常文件：恢复到导出时的状态。
                    cmd(cmd="import", path=good),
                    cmd(cmd="dump_state"),
                ]
            )
            self.assertTrue(outputs[3]["ok"])
            corrupted = outputs[6]
            self.assertFalse(corrupted["ok"])
            self.assertEqual(corrupted["error"], "invalid_import")
            # 导入失败后状态保持不变（仍是推进时钟后的状态）。
            state_after_failure = outputs[7]["state"]
            self.assertEqual(state_after_failure["clock"], 5)
            self.assertIn("b", [t["task_id"] for t in state_after_failure["tasks"]])
            # 正常导入恢复导出时的状态。
            self.assertTrue(outputs[8]["ok"])
            restored = outputs[9]["state"]
            self.assertEqual(restored["clock"], 0)
            task_ids = [t["task_id"] for t in restored["tasks"]]
            self.assertEqual(task_ids, ["a"])
            self.assertEqual(restored["tasks"][0]["status"], "pending")
            self.assertEqual(len(restored["preemptions"]), 1)


if __name__ == "__main__":
    unittest.main()
