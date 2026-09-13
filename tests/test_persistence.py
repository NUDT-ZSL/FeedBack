"""持久化测试：save/load 往返一致性、结果一致性校验、坏文件错误信息。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from optcore import solve
from optcore.persistence import (
    Snapshot,
    load_snapshot,
    save,
    save_problem,
)
from optcore.errors import PersistenceError
from optcore.solver import Problem


ITEMS = [
    {"item_id": "a1", "size": 4, "group": "A"},
    {"item_id": "a2", "size": 3, "group": "A"},
    {"item_id": "b1", "size": 5, "group": "B"},
]
BINS = [
    {"bin_id": "x", "capacity": 7},
    {"bin_id": "y", "capacity": 7},
]
TASKS = [
    {"task_id": "t1", "duration": 3, "resource": "r"},
    {"task_id": "t2", "duration": 2, "resource": "r", "deps": ["t1"],
     "release": 5},
    {"task_id": "t3", "duration": 4, "resource": "q"},
]


class TestRoundTrip(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "snapshot.json")

    def _write(self, payload) -> str:
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write(payload)
        return self.path

    def test_save_load_roundtrip(self):
        save(self.path, ITEMS, BINS, TASKS)
        snapshot = load_snapshot(self.path)
        self.assertIsInstance(snapshot, Snapshot)

        # 输入重建一致。
        self.assertEqual(
            sorted(i.item_id for i in snapshot.problem.items),
            ["a1", "a2", "b1"],
        )
        self.assertEqual(
            [b.bin_id for b in snapshot.problem.bins], ["x", "y"]
        )
        self.assertEqual(
            sorted(t.task_id for t in snapshot.problem.tasks),
            ["t1", "t2", "t3"],
        )

        # 结果与重新求解一致。
        result = snapshot.result
        fresh = solve(ITEMS, BINS, TASKS)
        self.assertEqual(result.feasible, fresh.feasible)
        self.assertEqual(result.packing.bins, fresh.packing.bins)
        self.assertEqual(result.packing.used_bins, fresh.packing.used_bins)
        self.assertEqual(result.schedule.assignments,
                         fresh.schedule.assignments)
        self.assertEqual(result.schedule.makespan, fresh.schedule.makespan)
        self.assertEqual(result.schedule.critical_path,
                         fresh.schedule.critical_path)

    def test_roundtrip_idempotent_on_disk(self):
        save(self.path, ITEMS, BINS, TASKS)
        with open(self.path, encoding="utf-8") as handle:
            first = json.load(handle)
        snapshot = load_snapshot(self.path)
        save_problem(self.path, snapshot.problem, snapshot.result)
        with open(self.path, encoding="utf-8") as handle:
            second = json.load(handle)
        self.assertEqual(first, second)

    def test_cycle_proof_roundtrip(self):
        cyclic_tasks = [
            {"task_id": "a", "duration": 1, "resource": "r", "deps": ["b"]},
            {"task_id": "b", "duration": 1, "resource": "r", "deps": ["a"]},
        ]
        result = solve(tasks=cyclic_tasks)
        self.assertFalse(result.feasible)
        problem = Problem.from_raw(tasks=cyclic_tasks)
        save_problem(self.path, problem, result)
        snapshot = load_snapshot(self.path)
        self.assertFalse(snapshot.result.feasible)
        self.assertEqual(
            set(snapshot.result.schedule.cycle[:-1]), {"a", "b"}
        )

    def test_empty_snapshot(self):
        save(self.path)
        snapshot = load_snapshot(self.path)
        self.assertEqual(snapshot.problem.items, [])
        self.assertTrue(snapshot.result.feasible)
        self.assertIsNone(snapshot.result.packing)
        self.assertIsNone(snapshot.result.schedule)


class TestCorruptFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "bad.json")

    def _write(self, payload: str):
        with open(self.path, "w", encoding="utf-8") as handle:
            handle.write(payload)

    def _expect(self, fragment=""):
        with self.assertRaises(PersistenceError) as ctx:
            load_snapshot(self.path)
        if fragment:
            self.assertIn(fragment, str(ctx.exception))

    def test_missing_file(self):
        with self.assertRaises(PersistenceError):
            load_snapshot(os.path.join(self.dir, "nope.json"))

    def test_not_json(self):
        self._write("{ this is not json")
        self._expect("合法 JSON")

    def test_root_not_object(self):
        self._write("[1, 2, 3]")
        self._expect("JSON 对象")

    def test_missing_format(self):
        self._write("{}")
        self._expect("format")

    def test_wrong_format(self):
        self._write(json.dumps({"format": "other", "version": 1}))
        self._expect("快照")

    def test_unsupported_version(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 99, "problem": {},
        }))
        self._expect("版本")

    def test_missing_problem(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
        }))
        self._expect("problem")

    def test_empty_item_id(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"items": [{"item_id": "", "size": 1, "group": "g"}]},
        }))
        self._expect("item_id")

    def test_duplicate_item_id(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"items": [
                {"item_id": "a", "size": 1, "group": "g"},
                {"item_id": "a", "size": 2, "group": "g"},
            ]},
        }))
        self._expect("重复")

    def test_negative_size(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"items": [
                {"item_id": "a", "size": -2, "group": "g"},
            ]},
        }))
        self._expect("正数")

    def test_empty_group(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"items": [
                {"item_id": "a", "size": 1, "group": ""},
            ]},
        }))
        self._expect("group")

    def test_dangling_dep(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"tasks": [
                {"task_id": "a", "duration": 1, "resource": "r",
                 "deps": ["ghost"]},
            ]},
        }))
        self._expect("不存在的任务")

    def test_self_dependency(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"tasks": [
                {"task_id": "a", "duration": 1, "resource": "r",
                 "deps": ["a"]},
            ]},
        }))
        self._expect("自身")

    def test_cycle_without_proof_rejected(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"tasks": [
                {"task_id": "a", "duration": 1, "resource": "r",
                 "deps": ["b"]},
                {"task_id": "b", "duration": 1, "resource": "r",
                 "deps": ["a"]},
            ]},
        }))
        self._expect("环")

    def test_bad_duration(self):
        self._write(json.dumps({
            "format": "optcore-snapshot", "version": 1,
            "problem": {"tasks": [
                {"task_id": "a", "duration": 0, "resource": "r"},
            ]},
        }))
        self._expect("正整数")


class TestResultConsistency(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "tampered.json")
        save(self.path, ITEMS, BINS, TASKS)
        with open(self.path, encoding="utf-8") as handle:
            self.payload = json.load(handle)

    def _reload_expect_error(self, fragment):
        with open(self.path, "w", encoding="utf-8") as handle:
            json.dump(self.payload, handle)
        with self.assertRaises(PersistenceError) as ctx:
            load_snapshot(self.path)
        self.assertIn(fragment, str(ctx.exception))

    def test_overload_bin_rejected(self):
        # 把 b1(5) 塞进容量 7 的箱中，再把 a2(3) 移除伪装：直接篡改
        # 结果，让 x 同时装 a1(4)+a2(3)+b1(5)=12 > 7。
        self.payload["result"]["packing"]["bins"]["x"] = ["a1", "a2", "b1"]
        self._reload_expect_error("超载")

    def test_split_group_rejected(self):
        # 放大容量使负载不超载，从而单独暴露 A 组被拆到两个箱子。
        for bin_spec in self.payload["problem"]["bins"]:
            bin_spec["capacity"] = 9
        self.payload["result"]["packing"]["bins"]["x"] = ["a1", "b1"]  # 9 <= 9
        self.payload["result"]["packing"]["bins"]["y"] = ["a2"]
        self._reload_expect_error("拆")

    def test_missing_item_rejected(self):
        self.payload["result"]["packing"]["bins"]["x"] = ["a1", "a2"]
        del self.payload["result"]["packing"]["bins"]["y"]
        self.payload["result"]["packing"]["used_bins"] = 1
        self._reload_expect_error("遗漏")

    def test_used_bins_mismatch_rejected(self):
        self.payload["result"]["packing"]["used_bins"] = 99
        self._reload_expect_error("used_bins")

    def test_resource_overlap_rejected(self):
        # 放开 t2 的 release 与依赖后，把 t2 放到与 t1 同资源重叠的窗口。
        self.payload["problem"]["tasks"][1]["release"] = 0
        self.payload["problem"]["tasks"][1]["deps"] = []
        assignments = self.payload["result"]["schedule"]["assignments"]
        assignments["t2"] = [2, 4]  # 与 t1 [0,3) 在资源 r 上重叠
        self._reload_expect_error("资源冲突")

    def test_dependency_violation_rejected(self):
        # 放开 release 并把 t2 换到独立资源，只剩依赖先后被违反。
        self.payload["problem"]["tasks"][1]["release"] = 0
        self.payload["problem"]["tasks"][1]["resource"] = "other"
        assignments = self.payload["result"]["schedule"]["assignments"]
        assignments["t2"] = [0, 2]  # 早于前置 t1 完成时刻 3
        self._reload_expect_error("前置")

    def test_release_violation_rejected(self):
        # t2 的 release=5，改成第 1 时刻开始（依赖与资源都放行后仍违规）。
        self.payload["problem"]["tasks"][0]["duration"] = 1  # t1 [0,1)
        assignments = self.payload["result"]["schedule"]["assignments"]
        assignments["t1"] = [0, 1]
        assignments["t2"] = [1, 3]  # 1 < release 5
        self._reload_expect_error("release")

    def test_broken_critical_path_rejected(self):
        self.payload["result"]["schedule"]["critical_path"] = ["t1", "t3"]
        self._reload_expect_error("critical_path")

    def test_makespan_mismatch_rejected(self):
        self.payload["result"]["schedule"]["makespan"] = 999
        self._reload_expect_error("makespan")


if __name__ == "__main__":
    unittest.main()
