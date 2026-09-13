"""装箱模块测试：FFD 分组启发式、下界剪枝、分支定界最优性与不可行证明。"""

from __future__ import annotations

import itertools
import random
import unittest

from optcore import Item, BinSpec, pack_items, solve
from optcore.errors import InvalidInputError


def bins(n: int, capacity: float):
    """快速生成 n 个同容量箱子。"""
    return [BinSpec(bin_id=f"b{i}", capacity=capacity) for i in range(n)]


def group_items(groups):
    """``{group: [size, ...]}`` -> Item 列表。"""
    items = []
    counter = 0
    for group, sizes in groups.items():
        for size in sizes:
            items.append(Item(item_id=f"i{counter}", size=size, group=group))
            counter += 1
    return items


class TestFFDHeuristic(unittest.TestCase):
    def test_single_bin_exact_fill(self):
        # 容量刚好装满：6+4 == 10，一个箱子。
        result = pack_items(
            group_items({"A": [6], "B": [4]}), bins(3, 10)
        )
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 1)
        self.assertEqual(result.lower_bound, 1)
        self.assertTrue(result.optimal)
        self.assertEqual(len(result.bins), 1)
        only_bin = next(iter(result.bins.values()))
        self.assertEqual(sorted(only_bin), ["i0", "i1"])

    def test_group_merging(self):
        # A=7, B=5, C=2：A 独占一箱，B+C 合并一箱。
        result = pack_items(
            group_items({"A": [7], "B": [5], "C": [2]}), bins(3, 7)
        )
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 2)
        self.assertEqual(result.lower_bound, 2)  # ceil(14/7)
        self.assertTrue(result.optimal)
        all_items = sorted(
            item_id for ids in result.bins.values() for item_id in ids
        )
        self.assertEqual(all_items, ["i0", "i1", "i2"])

    def test_group_not_split(self):
        # 同组两件物品，单件可与别人合箱，但合起来 7 与另一组 4 无法同箱（容量 7）。
        result = pack_items(
            group_items({"A": [4, 3], "B": [4]}), bins(3, 7)
        )
        self.assertEqual(result.used_bins, 2)
        bin_of = {}
        for bin_id, item_ids in result.bins.items():
            for item_id in item_ids:
                bin_of[item_id] = bin_id
        self.assertEqual(bin_of["i0"], bin_of["i1"])  # A 组同箱
        self.assertNotEqual(bin_of["i0"], bin_of["i2"])

    def test_ffd_decreasing_order(self):
        # 经典 FFD：4,4,4,3,3,3 容量 6 → 4+? 不能配 3 吗？4+3>6，
        # 实际：4|4|4|3+3|3 = 5 箱；下界 ceil(21/6)=4，B&B 应找到 4 箱？
        # 4+? 只能配 2；3+3=6 → 两组 3+3 需要 4 个 3，这里只有 3 个 →
        # 最少 5 箱，B&B 应证明启发式最优。
        result = pack_items(
            group_items({f"G{k}": [s] for k, s in enumerate([4, 4, 4, 3, 3, 3])}),
            bins(6, 6),
        )
        self.assertEqual(result.used_bins, 5)
        self.assertEqual(result.lower_bound, 4)
        self.assertTrue(result.optimal)

    def test_many_small_items_share_bins(self):
        items = group_items({f"G{k}": [1] for k in range(10)})
        result = pack_items(items, bins(2, 5))
        self.assertEqual(result.used_bins, 2)
        self.assertEqual(result.lower_bound, 2)
        self.assertTrue(result.optimal)


class TestBranchAndBound(unittest.TestCase):
    def test_ffd_suboptimal_then_improved(self):
        # 经典反例 [4,4,3,3,2,2] 容量 6：FFD 给 4+2|4+2|3+3 = 3（最优），
        # 换一个 FFD 次优结构 [6,5,5,4,4,3] cap 8：
        # FFD: 6|5+3|5+4(不行)->5|4+4| ... 验证 B&B 至少不差于 FFD。
        sizes = [6, 5, 5, 4, 4, 3]
        result = pack_items(
            group_items({f"G{k}": [s] for k, s in enumerate(sizes)}),
            bins(6, 8),
        )
        self.assertTrue(result.feasible)
        self.assertLessEqual(result.used_bins, 4)
        self.assertGreaterEqual(result.used_bins, result.lower_bound)

    def test_lower_bound_gap_proven_optimal(self):
        # 体积下界 3（30/10），但两个 7 必须分箱，最优 4 箱。
        result = pack_items(
            group_items({f"G{k}": [s] for k, s in enumerate([7, 7, 4, 4, 4, 4])}),
            bins(6, 10),
        )
        self.assertEqual(result.lower_bound, 3)
        self.assertEqual(result.used_bins, 4)
        self.assertTrue(result.optimal, "分支定界应证明 4 箱为最优")

    def test_brute_force_random_crosscheck(self):
        """50 组随机小实例：用箱数必须与暴力枚举一致。"""
        rng = random.Random(1234)

        def brute(sizes, capacities):
            best = None
            for assignment in itertools.product(range(len(capacities)), repeat=len(sizes)):
                loads = [0.0] * len(capacities)
                for size, bi in zip(sizes, assignment):
                    loads[bi] += size
                if all(load <= cap + 1e-9 for load, cap in zip(loads, capacities)):
                    used = len(set(assignment))
                    best = used if best is None else min(best, used)
            return best

        for _ in range(50):
            n = rng.randint(1, 6)
            m = rng.randint(1, 4)
            sizes = [rng.randint(1, 6) for _ in range(n)]
            capacities = sorted(
                (rng.randint(4, 10) for _ in range(m)), reverse=True
            )
            result = pack_items(
                group_items({f"G{k}": [s] for k, s in enumerate(sizes)}),
                [BinSpec(f"b{j}", c) for j, c in enumerate(capacities)],
            )
            optimum = brute(sizes, capacities)
            if optimum is None:
                self.assertFalse(result.feasible, msg=f"sizes={sizes} caps={capacities}")
            else:
                self.assertTrue(result.feasible)
                self.assertEqual(
                    result.used_bins, optimum,
                    msg=f"sizes={sizes} caps={capacities}",
                )
                if result.used_bins == result.lower_bound:
                    self.assertTrue(result.optimal)

    def test_heterogeneous_bins(self):
        # 大组必须进大箱；小组进小箱即可。
        result = pack_items(
            group_items({"A": [7], "B": [5]}),
            [BinSpec("small", 5), BinSpec("big", 7)],
        )
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 2)
        self.assertEqual(result.bins["big"], ["i0"])
        self.assertEqual(result.bins["small"], ["i1"])

    def test_heterogeneous_bins_ffd_fail_exact_succeeds(self):
        # FFD 贪心选错箱（把小组塞进唯一大箱）会失败，B&B 应找到可行方案。
        # 大箱容量 8，两个小箱容量 5；组为 8, 5, 3, 2。
        # 可行：8 独占大箱，5 独占小箱，3+2 另一小箱。
        result = pack_items(
            group_items({"A": [8], "B": [5], "C": [3], "D": [2]}),
            [BinSpec("big", 8), BinSpec("s1", 5), BinSpec("s2", 5)],
        )
        self.assertTrue(result.feasible, result.reasons)
        self.assertEqual(result.used_bins, 3)
        self.assertEqual(result.bins["big"], ["i0"])

    def test_capacity_lower_bound(self):
        # 21 个单位组、5 个容量 5 的箱子：体积下界 5 且恰好装满。
        result = pack_items(group_items({f"G{k}": [1] for k in range(21)}), bins(5, 5))
        self.assertEqual(result.lower_bound, 5)  # ceil(21/5)
        self.assertEqual(result.used_bins, 5)
        self.assertTrue(result.optimal)

    def test_node_limit_abort_marks_not_optimal(self):
        # FFD 给 4 箱、下界 3 的实例；把节点上限压到 1 强制 B&B 中止，
        # 此时仍应返回启发式可行解，但不能声称最优。
        from optcore import packing
        old_limit = packing.NODE_LIMIT
        packing.NODE_LIMIT = 1
        try:
            result = pack_items(
                group_items({f"G{k}": [s]
                             for k, s in enumerate([7, 7, 4, 4, 4, 4])}),
                bins(6, 10),
            )
        finally:
            packing.NODE_LIMIT = old_limit
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 4)
        self.assertFalse(result.optimal)

    def test_multi_item_group_merging(self):
        # 组 A=2+2=4、组 B=3、组 C=3；容量 7：A+B 一箱、C 一箱。
        result = pack_items(
            group_items({"A": [2, 2], "B": [3], "C": [3]}), bins(3, 7)
        )
        self.assertEqual(result.used_bins, 2)
        # A 的两件物品必须在同一个箱子里。
        bins_by_item = {}
        for bin_id, item_ids in result.bins.items():
            for item_id in item_ids:
                bins_by_item[item_id] = bin_id
        self.assertEqual(bins_by_item["i0"], bins_by_item["i1"])


class TestPackingInfeasible(unittest.TestCase):
    def test_oversized_group_single_item(self):
        result = pack_items(
            group_items({"A": [6, 6], "B": [1]}), bins(3, 10)
        )
        self.assertFalse(result.feasible)
        self.assertEqual(result.used_bins, 0)
        self.assertEqual(result.infeasible_groups, ["A"])
        self.assertIn("A", result.reasons[0])

    def test_oversized_vs_all_heterogeneous_bins(self):
        result = pack_items(
            group_items({"A": [9]}),
            [BinSpec("s1", 5), BinSpec("s2", 8)],
        )
        self.assertFalse(result.feasible)
        self.assertEqual(result.infeasible_groups, ["A"])

    def test_total_volume_exceeds_capacity(self):
        result = pack_items(group_items({f"G{k}": [4] for k in range(3)}),
                            [BinSpec("only", 10)])
        self.assertFalse(result.feasible)
        self.assertIn("总容量", result.reasons[0])

    def test_no_bins(self):
        result = pack_items(group_items({"A": [1]}), [])
        self.assertFalse(result.feasible)

    def test_exhaustive_infeasible_with_fitting_groups(self):
        # 每组都能进单个箱子，但组合起来放不下：
        # 两个组各 6，只有一个容量 10 的箱子。
        result = pack_items(
            group_items({"A": [6], "B": [6]}), [BinSpec("only", 10)]
        )
        self.assertFalse(result.feasible)
        self.assertTrue(result.reasons)

    def test_infeasible_does_not_affect_schedule(self):
        result = solve(
            items=group_items({"A": [20]}),
            bins=bins(1, 10),
            tasks=[{"task_id": "t", "duration": 2, "resource": "r"}],
        )
        self.assertFalse(result.feasible)
        self.assertFalse(result.packing.feasible)
        self.assertTrue(result.schedule.feasible)
        self.assertEqual(result.schedule.makespan, 2)


class TestPackingValidation(unittest.TestCase):
    def test_empty_inputs(self):
        result = pack_items(None, None)
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 0)
        self.assertEqual(result.lower_bound, 0)
        self.assertTrue(result.optimal)

    def test_duplicate_item_id(self):
        with self.assertRaises(InvalidInputError):
            pack_items(
                [Item("x", 1, "A"), Item("x", 2, "B")], bins(2, 10)
            )

    def test_non_positive_size(self):
        with self.assertRaises(InvalidInputError):
            pack_items([{"item_id": "a", "size": 0, "group": "A"}], bins(1, 10))
        with self.assertRaises(InvalidInputError):
            pack_items([{"item_id": "a", "size": -3, "group": "A"}], bins(1, 10))

    def test_empty_group_rejected(self):
        with self.assertRaises(InvalidInputError):
            pack_items([{"item_id": "a", "size": 1, "group": ""}], bins(1, 10))

    def test_dict_input_with_default_group(self):
        result = pack_items(
            [{"item_id": "a", "size": 3}, {"item_id": "b", "size": 2}],
            bins(1, 5),
        )
        self.assertEqual(result.used_bins, 1)  # default 组保持在一起

    def test_float_sizes(self):
        result = pack_items(
            [Item("a", 0.1, "A"), Item("b", 0.2, "A")], bins(1, 0.3)
        )
        self.assertTrue(result.feasible)
        self.assertEqual(result.used_bins, 1)


if __name__ == "__main__":
    unittest.main()
