"""排程模块测试：拓扑列表调度、优先级平局、资源冲突回避、release、
关键路径与依赖成环的不可行证明。"""

from __future__ import annotations
import unittest

from optcore import Task, schedule_tasks, solve
from optcore.errors import InvalidInputError
from optcore.scheduling import find_cycle, find_resource_overlaps


def t(task_id, duration, resource="r", deps=(), release=0):
    """构造任务的简写。"""
    return Task(task_id, duration, resource, frozenset(deps), release)


class TestTopologicalScheduling(unittest.TestCase):
    def test_simple_chain(self):
        result = schedule_tasks([
            t("a", 2, deps=()),
            t("b", 3, deps=("a",)),
            t("c", 1, deps=("b",)),
        ])
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments, {"a": (0, 2), "b": (2, 5), "c": (5, 6)})
        self.assertEqual(result.makespan, 6)
        self.assertEqual(result.critical_path, ["a", "b", "c"])

    def test_priority_duration_desc(self):
        # 同时就绪：duration 降序优先；同 duration 按 task_id 字典序。
        result = schedule_tasks([
            t("z", 5), t("a", 5), t("m", 8),
        ])
        self.assertEqual(result.assignments["m"], (0, 8))
        self.assertEqual(result.assignments["a"], (8, 13))
        self.assertEqual(result.assignments["z"], (13, 18))
        self.assertEqual(result.makespan, 18)

    def test_different_resources_run_parallel(self):
        result = schedule_tasks([
            t("a", 5, "r1"), t("b", 4, "r2"),
        ])
        self.assertEqual(result.assignments["a"], (0, 5))
        self.assertEqual(result.assignments["b"], (0, 4))
        self.assertEqual(result.makespan, 5)
        self.assertEqual(result.critical_path, ["a"])  # 最长单任务

    def test_resource_serialized(self):
        # 无依赖、同资源的两个任务必须串行。
        result = schedule_tasks([t("a", 3, "r"), t("b", 2, "r")])
        self.assertEqual(result.assignments["a"], (0, 3))
        self.assertEqual(result.assignments["b"], (3, 5))
        self.assertEqual(result.makespan, 5)

    def test_release_delays_start(self):
        result = schedule_tasks([
            t("a", 2, "r", release=5), t("b", 3, "r"),
        ])
        self.assertEqual(result.assignments["b"], (0, 3))
        self.assertEqual(result.assignments["a"], (5, 7))
        self.assertEqual(result.makespan, 7)

    def test_release_plus_dependency(self):
        result = schedule_tasks([
            t("a", 3, "r", release=10),
            t("b", 2, "r", deps=("a",)),
        ])
        self.assertEqual(result.assignments["a"], (10, 13))
        self.assertEqual(result.assignments["b"], (13, 15))

    def test_gap_filling_after_delayed_task(self):
        # 长任务被 release 推走后，短任务应填进资源时间线前面的空隙。
        result = schedule_tasks([
            t("long", 4, "r", release=10),
            t("short1", 3, "r"),
            t("short2", 2, "r"),
        ])
        self.assertEqual(result.assignments["short1"], (0, 3))
        self.assertEqual(result.assignments["short2"], (3, 5))
        self.assertEqual(result.assignments["long"], (10, 14))
        self.assertEqual(result.makespan, 14)

    def test_diamond_dag(self):
        # start -> (a,b) -> end；a、b 同资源须串行。就绪规则按 duration
        # 降序，故 b(5) 先于 a(3) 拿到资源 r。
        result = schedule_tasks([
            t("start", 1, "r0"),
            t("a", 3, "r", deps=("start",)),
            t("b", 5, "r", deps=("start",)),
            t("end", 2, "r0", deps=("a", "b")),
        ])
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments["b"], (1, 6))
        self.assertEqual(result.assignments["a"], (6, 9))  # 资源串行
        self.assertEqual(result.assignments["end"], (9, 11))
        self.assertEqual(result.makespan, 11)
        # 最长依赖链 start(1)+b(5)+end(2)=8
        self.assertEqual(result.critical_path, ["start", "b", "end"])

    def test_critical_path_independent_of_resource_wait(self):
        # 资源等待会推高 makespan，但关键路径只反映依赖链。
        result = schedule_tasks([
            t("a", 3, "r"),
            t("b", 2, "r"),
            t("c", 1, "q", deps=("a",)),
        ])
        self.assertEqual(result.makespan, 5)
        self.assertEqual(result.critical_path, ["a", "c"])

    def test_empty(self):
        result = schedule_tasks([])
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments, {})
        self.assertEqual(result.makespan, 0)
        self.assertEqual(result.critical_path, [])


class TestCycleDetection(unittest.TestCase):
    def test_self_dependency_is_input_error(self):
        with self.assertRaises(InvalidInputError):
            schedule_tasks([t("a", 1, deps=("a",))])

    def test_two_node_cycle(self):
        result = schedule_tasks([
            t("a", 1, deps=("b",)), t("b", 1, deps=("a",)),
        ])
        self.assertFalse(result.feasible)
        self.assertIsNotNone(result.cycle)
        self.assertEqual(result.cycle[0], result.cycle[-1])
        self.assertEqual(set(result.cycle[:-1]), {"a", "b"})
        self.assertTrue(result.reasons)

    def test_three_node_cycle_with_tail(self):
        result = schedule_tasks([
            t("a", 1, deps=("b",)),
            t("b", 1, deps=("c",)),
            t("c", 1, deps=("a",)),
            t("d", 1, deps=("a",)),
        ])
        self.assertFalse(result.feasible)
        self.assertEqual(set(result.cycle[:-1]), {"a", "b", "c"})
        for i in range(len(result.cycle) - 1):
            self.assertIn(result.cycle[i + 1],
                          {"a": {"b"}, "b": {"c"}, "c": {"a"}}[result.cycle[i]])

    def test_find_cycle_none_for_dag(self):
        self.assertIsNone(find_cycle([t("a", 1), t("b", 1, deps=("a",))]))

    def test_dangling_dependency(self):
        with self.assertRaises(InvalidInputError):
            schedule_tasks([t("a", 1, deps=("ghost",))])

    def test_duplicate_dependency_rejected(self):
        with self.assertRaises(InvalidInputError):
            schedule_tasks([
                {"task_id": "a", "duration": 1, "resource": "r", "deps": ["b", "b"]},
                {"task_id": "b", "duration": 1, "resource": "r"},
            ])

    def test_non_integer_duration_rejected(self):
        with self.assertRaises(InvalidInputError):
            schedule_tasks([{"task_id": "a", "duration": 1.5, "resource": "r"}])


class TestResourceValidation(unittest.TestCase):
    def test_find_overlaps_detects_conflict(self):
        tasks = [t("a", 3, "r"), t("b", 2, "r")]
        conflicts = find_resource_overlaps({"a": (0, 3), "b": (2, 4)}, tasks)
        self.assertEqual(len(conflicts), 1)
        resource, start, end, tids = conflicts[0]
        self.assertEqual(resource, "r")
        self.assertEqual(tids, ["a", "b"])

    def test_find_overlaps_clean(self):
        tasks = [t("a", 3, "r"), t("b", 2, "r")]
        self.assertEqual(
            find_resource_overlaps({"a": (0, 3), "b": (3, 5)}, tasks), []
        )

    def test_schedule_independent_from_packing_infeasibility(self):
        result = solve(
            items=[{"item_id": "x", "size": 99, "group": "G"}],
            bins=[{"bin_id": "b", "capacity": 1}],
            tasks=[t("a", 2)],
        )
        self.assertFalse(result.feasible)
        self.assertTrue(result.schedule.feasible)
        self.assertFalse(result.packing.feasible)
        self.assertTrue(any("packing" in r for r in result.reasons))


if __name__ == "__main__":
    unittest.main()
