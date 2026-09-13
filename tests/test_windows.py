"""release/deadline/资源时间窗导致的不可行证明回归测试。

覆盖：
* 验收实例（同资源两任务 + release 100 + 资源窗 [0,10)）；
* deadline 形式的等价过载；
* 边界可行（时间窗恰好装满、release/deadline 紧贴）；
* 列表调度错过 deadline 时精确搜索重排找回可行解；
* 依赖链 + deadline 不可行；
* 依赖成环路径与类型标识保持不变；
* 字段校验（release < deadline、deadline 正整数、窗口合法）；
* window_overload 证明的快照往返与篡改拒绝。
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from optcore import solve, schedule_tasks
from optcore.errors import InvalidInputError, PersistenceError
from optcore.persistence import save_problem, load_snapshot
from optcore.scheduling import (
    INFEASIBLE_CYCLE,
    INFEASIBLE_WINDOW_OVERLOAD,
    find_window_overloads,
)
from optcore.solver import Problem


def _conflict(result):
    """取第一个冲突时间窗条目。"""
    return result.schedule.window_conflicts[0]


class TestResourceWindowInfeasible(unittest.TestCase):
    def test_acceptance_release_beyond_resource_window(self):
        # 验收第 1 条实例：同资源两个时长 5 的任务，release 0/100，
        # 资源只在 [0,10) 可用。
        result = solve(
            tasks=[
                {"task_id": "a", "duration": 5, "resource": "r", "release": 0},
                {"task_id": "b", "duration": 5, "resource": "r", "release": 100},
            ],
            resources=[{"resource": "r", "windows": [[0, 10]]}],
        )
        schedule = result.schedule
        self.assertFalse(result.feasible)
        self.assertFalse(schedule.feasible)
        self.assertEqual(
            schedule.infeasibility_type, INFEASIBLE_WINDOW_OVERLOAD
        )
        self.assertTrue(schedule.reasons)
        self.assertTrue(
            all("[window_overload]" in r for r in schedule.reasons)
        )
        conflict = _conflict(result)
        # 字段至少包含 resource_id、任务列表、[start,end) 区间。
        self.assertEqual(conflict["resource"], "r")
        self.assertEqual(conflict["tasks"], ["b"])
        window = conflict["window"]
        self.assertEqual(len(window), 2)
        self.assertLessEqual(window[0], window[1])
        self.assertGreater(conflict["required"], conflict["available"])
        self.assertEqual(conflict["required"], 5)
        # 不可行结果不带 assignments/makespan 假象。
        self.assertEqual(schedule.assignments, {})

    def test_schedule_tasks_directly_with_resource_windows(self):
        result = schedule_tasks(
            [
                {"task_id": "a", "duration": 5, "resource": "r"},
                {"task_id": "b", "duration": 5, "resource": "r", "release": 100},
            ],
            [{"resource": "r", "windows": [[0, 10]]}],
        )
        self.assertFalse(result.feasible)
        self.assertEqual(result.infeasibility_type, "window_overload")

    def test_deadline_overload(self):
        # 三个时长 5 的任务都必须在 [0,10) 完成：总需求 15 > 10。
        result = solve(tasks=[
            {"task_id": "a", "duration": 5, "resource": "r", "deadline": 10},
            {"task_id": "b", "duration": 5, "resource": "r", "deadline": 10},
            {"task_id": "c", "duration": 5, "resource": "r", "deadline": 10},
        ])
        schedule = result.schedule
        self.assertFalse(schedule.feasible)
        self.assertEqual(
            schedule.infeasibility_type, INFEASIBLE_WINDOW_OVERLOAD
        )
        multi = [
            c for c in schedule.window_conflicts
            if c["required"] > c["available"]
        ]
        self.assertTrue(multi)
        self.assertEqual(set(multi[0]["tasks"]), {"a", "b", "c"})

    def test_partial_deadline_is_feasible(self):
        # 只有 c 受 deadline 约束时可以先排 c，其余任务顺延：可行。
        result = solve(tasks=[
            {"task_id": "a", "duration": 5, "resource": "r"},
            {"task_id": "b", "duration": 5, "resource": "r"},
            {"task_id": "c", "duration": 5, "resource": "r", "deadline": 10},
        ])
        self.assertTrue(result.schedule.feasible, result.schedule.reasons)
        self.assertLessEqual(result.schedule.assignments["c"][1], 10)

    def test_single_task_window_too_small(self):
        # 单个任务 duration 6，可行区间 [5,10) 只有 5。
        result = solve(tasks=[
            {"task_id": "a", "duration": 6, "resource": "r",
             "release": 5, "deadline": 10},
        ])
        schedule = result.schedule
        self.assertFalse(schedule.feasible)
        conflict = schedule.window_conflicts[0]
        self.assertEqual(conflict["resource"], "r")
        self.assertEqual(conflict["tasks"], ["a"])
        self.assertEqual(conflict["window"], [5, 10])
        self.assertEqual(conflict["available"], 5)
        self.assertEqual(conflict["required"], 6)

    def test_dependency_pushes_beyond_deadline(self):
        # a(3) -> b(3)，b deadline 5：E[b]=3，[3,5) 仅 2 < 3。
        result = solve(tasks=[
            {"task_id": "a", "duration": 3, "resource": "r"},
            {"task_id": "b", "duration": 3, "resource": "r",
             "deps": ["a"], "deadline": 5},
        ])
        schedule = result.schedule
        self.assertFalse(schedule.feasible)
        self.assertEqual(
            schedule.infeasibility_type, INFEASIBLE_WINDOW_OVERLOAD
        )
        conflict = schedule.window_conflicts[0]
        self.assertEqual(conflict["tasks"], ["b"])
        self.assertEqual(conflict["window"], [3, 5])

    def test_disjoint_resource_windows_insufficient(self):
        # 资源只在 [0,2) 和 [8,10) 可用，任务时长 5：任何连续段都 < 5。
        result = solve(
            tasks=[{"task_id": "a", "duration": 5, "resource": "r"}],
            resources=[{"resource": "r", "windows": [[0, 2], [8, 10]]}],
        )
        self.assertFalse(result.schedule.feasible)
        self.assertEqual(
            result.schedule.infeasibility_type, INFEASIBLE_WINDOW_OVERLOAD
        )
        # 可用时长总和虽为 4，但报告的连续可用段不超过 2。
        self.assertLessEqual(_conflict(result)["available"], 2)


class TestBoundaryFeasible(unittest.TestCase):
    def test_two_tasks_exactly_fill_window(self):
        # [0,10) 内两个时长 5 的任务恰好装满。
        result = solve(
            tasks=[
                {"task_id": "a", "duration": 5, "resource": "r"},
                {"task_id": "b", "duration": 5, "resource": "r"},
            ],
            resources=[{"resource": "r", "windows": [[0, 10]]}],
        )
        schedule = result.schedule
        self.assertTrue(schedule.feasible, schedule.reasons)
        self.assertEqual(schedule.assignments["a"], (0, 5))
        self.assertEqual(schedule.assignments["b"], (5, 10))
        self.assertEqual(schedule.makespan, 10)

    def test_release_deadline_tight_single_task(self):
        result = schedule_tasks([
            {"task_id": "a", "duration": 5, "resource": "r",
             "release": 5, "deadline": 10},
        ])
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments["a"], (5, 10))

    def test_deadline_equal_end_time(self):
        # duration 5, deadline 5：结束时刻恰为 5，半开区间合法。
        result = schedule_tasks([
            {"task_id": "a", "duration": 5, "resource": "r", "deadline": 5},
        ])
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments["a"], (0, 5))

    def test_exact_search_reorders_for_deadline(self):
        # 列表调度按 duration 降序会先排长任务，短任务错过 deadline 3；
        # 可行排法存在（short[0,2), long[2,10)），精确搜索必须找回。
        result = solve(tasks=[
            {"task_id": "long", "duration": 8, "resource": "r"},
            {"task_id": "short", "duration": 2, "resource": "r",
             "deadline": 3},
        ])
        schedule = result.schedule
        self.assertTrue(schedule.feasible, schedule.reasons)
        self.assertEqual(schedule.assignments["short"], (0, 2))
        self.assertEqual(schedule.assignments["long"], (2, 10))

    def test_split_across_resource_windows(self):
        # a,b 各 3，资源窗 [0,4)、[6,9)：分别落入两个窗。
        result = solve(
            tasks=[
                {"task_id": "a", "duration": 3, "resource": "r"},
                {"task_id": "b", "duration": 3, "resource": "r"},
            ],
            resources=[{"resource": "r", "windows": [[0, 4], [6, 9]]}],
        )
        schedule = result.schedule
        self.assertTrue(schedule.feasible, schedule.reasons)
        self.assertEqual(schedule.assignments["a"], (0, 3))
        self.assertEqual(schedule.assignments["b"], (6, 9))

    def test_legacy_behavior_without_windows(self):
        # 没有 deadline、没有资源窗时，release 再晚也总能排（旧行为）。
        result = solve(tasks=[
            {"task_id": "a", "duration": 5, "resource": "r"},
            {"task_id": "b", "duration": 5, "resource": "r", "release": 100},
        ])
        self.assertTrue(result.schedule.feasible)
        self.assertEqual(result.schedule.assignments["b"], (100, 105))
        self.assertIsNone(result.schedule.infeasibility_type)
        self.assertEqual(result.schedule.window_conflicts, [])


class TestCycleUnchanged(unittest.TestCase):
    def test_cycle_proof_format_unchanged(self):
        result = solve(tasks=[
            {"task_id": "a", "duration": 1, "resource": "r", "deps": ["b"]},
            {"task_id": "b", "duration": 1, "resource": "r", "deps": ["a"]},
        ])
        schedule = result.schedule
        self.assertFalse(schedule.feasible)
        self.assertEqual(schedule.infeasibility_type, INFEASIBLE_CYCLE)
        self.assertEqual(schedule.cycle, ["a", "b", "a"])
        self.assertEqual(schedule.window_conflicts, [])
        self.assertIn("环", schedule.reasons[0])

    def test_three_node_cycle(self):
        result = solve(tasks=[
            {"task_id": "x1", "duration": 2, "resource": "cpu", "deps": ["x3"]},
            {"task_id": "x2", "duration": 1, "resource": "cpu", "deps": ["x1"]},
            {"task_id": "x3", "duration": 3, "resource": "gpu", "deps": ["x2"]},
        ])
        schedule = result.schedule
        self.assertFalse(schedule.feasible)
        self.assertEqual(schedule.infeasibility_type, "cycle")
        self.assertEqual(schedule.cycle[0], schedule.cycle[-1])
        self.assertEqual(set(schedule.cycle[:-1]), {"x1", "x2", "x3"})


class TestWindowValidation(unittest.TestCase):
    def test_release_must_be_less_than_deadline(self):
        with self.assertRaises(InvalidInputError):
            solve(tasks=[{"task_id": "a", "duration": 1, "resource": "r",
                          "release": 5, "deadline": 5}])

    def test_deadline_must_be_positive(self):
        with self.assertRaises(InvalidInputError):
            solve(tasks=[{"task_id": "a", "duration": 1, "resource": "r",
                          "deadline": 0}])

    def test_deadline_must_be_integer(self):
        with self.assertRaises(InvalidInputError):
            solve(tasks=[{"task_id": "a", "duration": 1, "resource": "r",
                          "deadline": 2.5}])

    def test_bad_resource_window(self):
        with self.assertRaises(InvalidInputError):
            solve(
                tasks=[{"task_id": "a", "duration": 1, "resource": "r"}],
                resources=[{"resource": "r", "windows": [[5, 3]]}],
            )

    def test_window_must_be_pair(self):
        with self.assertRaises(InvalidInputError):
            solve(
                tasks=[{"task_id": "a", "duration": 1, "resource": "r"}],
                resources=[{"resource": "r", "windows": [[0]]}],
            )

    def test_dangling_dependency_still_covered(self):
        with self.assertRaises(InvalidInputError):
            solve(tasks=[{"task_id": "a", "duration": 1, "resource": "r",
                          "deps": ["ghost"]}])

    def test_find_window_overloads_helper(self):
        problem = Problem.from_raw(
            tasks=[
                {"task_id": "a", "duration": 5, "resource": "r"},
                {"task_id": "b", "duration": 5, "resource": "r",
                 "release": 100},
            ],
            resources=[{"resource": "r", "windows": [[0, 10]]}],
        )
        from optcore.scheduling import _earliest_starts, _topological_order, _build_adjacency
        deps_of, dependents = _build_adjacency(problem.tasks)
        topo = _topological_order(problem.tasks, deps_of, dependents)
        by_id = {t.task_id: t for t in problem.tasks}
        earliest = _earliest_starts(problem.tasks, topo, by_id)
        conflicts = find_window_overloads(
            problem.tasks, earliest, problem.resource_windows
        )
        self.assertTrue(conflicts)
        self.assertEqual(conflicts[0]["tasks"], ["b"])


class TestWindowPersistence(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()

    def _roundtrip(self, tasks, resources):
        result = solve(tasks=tasks, resources=resources)
        problem = Problem.from_raw(tasks=tasks, resources=resources)
        path = os.path.join(self.dir, "snap.json")
        save_problem(path, problem, result)
        snapshot = load_snapshot(path)
        return result, snapshot

    def test_feasible_window_roundtrip(self):
        result, snapshot = self._roundtrip(
            tasks=[
                {"task_id": "a", "duration": 5, "resource": "r"},
                {"task_id": "b", "duration": 5, "resource": "r"},
            ],
            resources=[{"resource": "r", "windows": [[0, 20]]}],
        )
        self.assertTrue(result.feasible)
        self.assertEqual(
            snapshot.problem.resource_windows, {"r": [(0, 20)]}
        )
        self.assertEqual(
            snapshot.result.schedule.assignments,
            result.schedule.assignments,
        )

    def test_deadline_roundtrip(self):
        result, snapshot = self._roundtrip(
            tasks=[{"task_id": "a", "duration": 3, "resource": "r",
                    "release": 1, "deadline": 8}],
            resources=[],
        )
        self.assertTrue(result.feasible)
        task = snapshot.problem.tasks[0]
        self.assertEqual(task.release, 1)
        self.assertEqual(task.deadline, 8)
        self.assertEqual(
            snapshot.result.schedule.assignments["a"], (1, 4)
        )

    def test_infeasible_proof_roundtrip(self):
        result, snapshot = self._roundtrip(
            tasks=[
                {"task_id": "a", "duration": 5, "resource": "r"},
                {"task_id": "b", "duration": 5, "resource": "r",
                 "release": 100},
            ],
            resources=[{"resource": "r", "windows": [[0, 10]]}],
        )
        self.assertFalse(result.feasible)
        schedule = snapshot.result.schedule
        self.assertFalse(schedule.feasible)
        self.assertEqual(
            schedule.infeasibility_type, INFEASIBLE_WINDOW_OVERLOAD
        )
        self.assertEqual(
            schedule.window_conflicts,
            result.schedule.window_conflicts,
        )

    def test_tampered_proof_rejected(self):
        result = solve(
            tasks=[{"task_id": "a", "duration": 9, "resource": "r",
                    "deadline": 5}],
        )
        problem = Problem.from_raw(
            tasks=[{"task_id": "a", "duration": 9, "resource": "r",
                    "deadline": 5}],
        )
        path = os.path.join(self.dir, "tamper.json")
        save_problem(path, problem, result)
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        # 伪造一个 required <= available 的“证明”，不构成不可行证据。
        payload["result"]["schedule"]["window_conflicts"][0]["required"] = 1
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        with self.assertRaises(PersistenceError):
            load_snapshot(path)

    def test_assignment_outside_window_rejected(self):
        result = solve(tasks=[
            {"task_id": "a", "duration": 3, "resource": "r"},
        ])
        problem = Problem.from_raw(
            tasks=[{"task_id": "a", "duration": 3, "resource": "r"}],
            resources=[{"resource": "r", "windows": [[0, 10]]}],
        )
        path = os.path.join(self.dir, "outside.json")
        save_problem(path, problem, result)
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
        # 把任务改到资源窗外 [20,23)。
        payload["result"]["schedule"]["assignments"]["a"] = [20, 23]
        payload["result"]["schedule"]["makespan"] = 23
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
        with self.assertRaises(PersistenceError):
            load_snapshot(path)


if __name__ == "__main__":
    unittest.main()
