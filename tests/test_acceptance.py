"""综合验收场景：对应用户验收时会构造的各类场景组合。"""

from __future__ import annotations

import unittest

from optcore import solve, pack_items, schedule_tasks


class TestAcceptanceScenarios(unittest.TestCase):
    def test_group_merge_exact_fill(self):
        # 三个组恰好装满两个箱子：A(4+2=6)+C(4)=10；B(5)+D(5)=10。
        items = [
            {"item_id": "a1", "size": 4, "group": "A"},
            {"item_id": "a2", "size": 2, "group": "A"},
            {"item_id": "b1", "size": 5, "group": "B"},
            {"item_id": "c1", "size": 4, "group": "C"},
            {"item_id": "d1", "size": 5, "group": "D"},
        ]
        bins = [{"bin_id": f"bin-{i}", "capacity": 10} for i in (1, 2, 3)]
        result = pack_items(items, bins)
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 2)
        self.assertEqual(result.lower_bound, 2)  # ceil(20/10)
        self.assertTrue(result.optimal)
        # A 组两件物品同箱。
        for item_ids in result.bins.values():
            if "a1" in item_ids:
                self.assertIn("a2", item_ids)
        # 容量约束。
        sizes = {i["item_id"]: i["size"] for i in items}
        caps = {b["bin_id"]: b["capacity"] for b in bins}
        for bin_id, item_ids in result.bins.items():
            self.assertLessEqual(sum(sizes[i] for i in item_ids), caps[bin_id])

    def test_dependency_cycle_proof(self):
        tasks = [
            {"task_id": "x1", "duration": 2, "resource": "cpu", "deps": ["x3"]},
            {"task_id": "x2", "duration": 1, "resource": "cpu", "deps": ["x1"]},
            {"task_id": "x3", "duration": 3, "resource": "gpu", "deps": ["x2"]},
        ]
        result = schedule_tasks(tasks)
        self.assertFalse(result.feasible)
        self.assertEqual(result.assignments, {})
        self.assertEqual(result.makespan, 0)
        self.assertEqual(set(result.cycle[:-1]), {"x1", "x2", "x3"})
        self.assertEqual(result.cycle[0], result.cycle[-1])
        self.assertTrue(result.reasons)

    def test_resource_conflict_serialized(self):
        # 三个同资源任务无依赖：列表调度必须串行，makespan=时长之和。
        tasks = [
            {"task_id": "p", "duration": 4, "resource": "gpu"},
            {"task_id": "q", "duration": 2, "resource": "gpu"},
            {"task_id": "r", "duration": 3, "resource": "gpu"},
        ]
        result = schedule_tasks(tasks)
        self.assertTrue(result.feasible)
        self.assertEqual(result.makespan, 9)
        # 任意两个任务时间窗不重叠。
        spans = sorted(result.assignments.values())
        for (s1, e1), (s2, e2) in zip(spans, spans[1:]):
            self.assertLessEqual(e1, s2)

    def test_release_constraint(self):
        tasks = [
            {"task_id": "early", "duration": 2, "resource": "r"},
            {"task_id": "late", "duration": 2, "resource": "r", "release": 10},
        ]
        result = schedule_tasks(tasks)
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments["early"], (0, 2))
        self.assertEqual(result.assignments["late"], (10, 12))
        self.assertEqual(result.makespan, 12)

    def test_release_and_deps_and_resources_combined(self):
        tasks = [
            {"task_id": "fetch", "duration": 2, "resource": "io", "release": 4},
            {"task_id": "build", "duration": 3, "resource": "cpu",
             "deps": ["fetch"]},
            {"task_id": "other_io", "duration": 5, "resource": "io"},
            {"task_id": "test", "duration": 2, "resource": "cpu",
             "deps": ["build"]},
        ]
        result = schedule_tasks(tasks)
        self.assertTrue(result.feasible)
        self.assertEqual(result.assignments["other_io"], (0, 5))
        # fetch 受 release 限制到 4 开始；io 上 other_io [0,5) 占用，故 fetch 顺延到 5。
        self.assertEqual(result.assignments["fetch"], (5, 7))
        self.assertEqual(result.assignments["build"], (7, 10))
        self.assertEqual(result.assignments["test"], (10, 12))
        self.assertEqual(result.makespan, 12)
        # 关键路径是纯依赖链 fetch->build->test，长度 2+3+2=7。
        self.assertEqual(result.critical_path, ["fetch", "build", "test"])

    def test_mixed_solve_one_side_infeasible(self):
        result = solve(
            items=[
                {"item_id": "g1", "size": 8, "group": "G"},
                {"item_id": "g2", "size": 8, "group": "G"},
            ],
            bins=[{"bin_id": "b", "capacity": 10}],  # 组总尺寸 16 > 10
            tasks=[
                {"task_id": "a", "duration": 1, "resource": "r"},
                {"task_id": "b", "duration": 1, "resource": "r"},
            ],
        )
        self.assertFalse(result.feasible)
        self.assertFalse(result.packing.feasible)
        self.assertEqual(result.packing.infeasible_groups, ["G"])
        self.assertTrue(result.schedule.feasible)
        self.assertEqual(result.schedule.makespan, 2)
        self.assertEqual(len(result.reasons), 1)

    def test_empty_inputs_everywhere(self):
        result = solve()
        self.assertTrue(result.feasible)
        self.assertEqual(result.reasons, [])
        self.assertIsNone(result.packing)
        self.assertIsNone(result.schedule)


if __name__ == "__main__":
    unittest.main()
