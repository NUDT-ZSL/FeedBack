"""两个已确认缺陷的回归测试 + 本轮验收脚本。

缺陷1：堆叠累计层数必须统计投影柱/支撑链上的所有货物（含非直接相邻、
       含新货物塞入悬挑下方时其上方已有货物），报错指出层与货物。
缺陷2：清单/不可用区域变化后增量重排必须与从头全量重排“逐车厢”一致，
       且对同一批货物在不同到达顺序、不同变更顺序下都成立。
"""

import copy
import random
import unittest

from loading import Cargo, LoadingError, LoadingSystem, StackRuleError, Vehicle
from loading.geometry import Box
from loading.models import Placement
from loading.planner import VehicleState

from tests._helpers import assert_plan_valid, plan_snapshot


# --------------------------------------------------------------------- #
# 缺陷 1：堆叠累计层数
# --------------------------------------------------------------------- #
class CumulativeStackingTest(unittest.TestCase):
    def test_non_adjacent_layers_counted(self):
        # 3 层塔：底层 limit=1（只允许上方 1 层），中/上层 limit=2。
        # 放第 3 层时，底层上方“累计”已有 2 层（中间层非直接相邻），
        # 必须拒绝并指出第 3 层、超限货物是底层货物。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V", 2, 2, 8, 10000))
        s.add_cargo(Cargo("BASE", 2, 2, 2, weight=1, stack_limit=1))
        s.add_cargo(Cargo("MID", 2, 2, 2, weight=1, stack_limit=2))
        s.add_cargo(Cargo("TOP", 2, 2, 2, weight=1, stack_limit=2))
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        self.assertEqual(cm.exception.level, 3)
        self.assertIn("BASE", str(cm.exception))

    def test_two_layers_within_limit_ok(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V", 2, 2, 8, 10000))
        s.add_cargo(Cargo("BASE", 2, 2, 2, weight=1, stack_limit=1))
        s.add_cargo(Cargo("TOP", 2, 2, 2, weight=1, stack_limit=1))
        s.plan_all()
        self.assertEqual(len(s.plan.placements["V"]), 2)

    def test_spanning_slab_counts_projection_column(self):
        # 底层 A(limit0) 与 B 并放；一块大板横跨到 A 的投影柱上方，
        # 即使 A 不直接支撑大板（中间可隔空），也必须在第 2 层拒绝。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("V", 4, 2, 6, 10000))
        s.add_cargo(Cargo("A", 2, 2, 2, weight=1, stack_limit=0))
        s.add_cargo(Cargo("B", 2, 2, 2, weight=1, stack_limit=2))
        s.add_cargo(Cargo("P", 2, 2, 2, weight=1, stack_limit=2))
        s.add_cargo(Cargo("SLAB", 4, 2, 1, weight=1, stack_limit=2))
        with self.assertRaises(StackRuleError) as cm:
            s.plan_all()
        self.assertEqual(cm.exception.level, 2)
        self.assertIn("A", str(cm.exception))

    def test_upward_check_when_inserted_under_existing_overhang(self):
        # 增量重排可达的提交顺序：高层货物先保留，重决策货物塞入其下方。
        # 直接构造该 VehicleState 验证“向上”累计检查。
        v = Vehicle("V", 2, 2, 5, 10000)
        state = VehicleState(v)
        a = Cargo("A", 2, 2, 2, weight=1, stack_limit=2)
        slab = Cargo("S", 2, 2, 1, weight=1, stack_limit=2)
        p_a = Placement("A", "V", 0, 0, 1, 2, 2, 2, (0, 1, 2), 2)
        p_s = Placement("S", "V", 0, 0, 3, 2, 2, 1, (0, 1, 2), 3)
        state.items.append((p_a.box, "A", 2))
        state.items.append((p_s.box, "S", 3))
        state.stack_limits.update({"A": 2, "S": 2})

        # limit=0：上方已压 2 层 -> 拒绝，层号取上方货物层
        d0 = Cargo("D0", 2, 2, 1, weight=1, stack_limit=0)
        ok, reason, info = state.evaluate(d0, Box(0, 0, 0, 2, 2, 1))
        self.assertFalse(ok)
        self.assertEqual(reason, "stack")
        self.assertEqual(info[1], "D0")
        self.assertEqual(info[2], "above")
        self.assertEqual(info[0], 2)  # 紧邻上方货物在第 2 层

        # 易碎货物：上方压货即拒绝
        df = Cargo("DF", 2, 2, 1, weight=1, fragile=True)
        ok, reason, info = state.evaluate(df, Box(0, 0, 0, 2, 2, 1))
        self.assertFalse(ok)
        self.assertEqual(info[2], "above")

        # limit=2：上方恰好 2 层，放行
        d2 = Cargo("D2", 2, 2, 1, weight=1, stack_limit=2)
        ok, reason, info = state.evaluate(d2, Box(0, 0, 0, 2, 2, 1))
        self.assertTrue(ok)


# --------------------------------------------------------------------- #
# 缺陷 2：增量 == 全量（逐车厢），不同到达顺序与变更顺序
# --------------------------------------------------------------------- #
def per_vehicle_snapshot(system):
    """逐车厢的可比较快照。"""
    out = {}
    if system.plan is None:
        return out
    for vid in sorted(system.vehicles):
        out[vid] = sorted(
            (p.cargo_id, round(p.x, 9), round(p.y, 9), round(p.z, 9),
             tuple(p.orientation), p.level)
            for p in system.plan.placements.get(vid, [])
        )
    return out


def full_replan_system(system):
    f = LoadingSystem()
    for v in system.list_vehicles():
        f.add_vehicle(copy.deepcopy(v))
    for c in system.list_cargos():
        f.add_cargo(copy.deepcopy(c))
    f.plan_all()
    return f


class IncrementalVsFullAcceptanceTest(unittest.TestCase):
    def test_rerouted_cargo_pulled_back_after_capacity_freed(self):
        # 用户描述的精确触发：货物因前车空间不足改派后车；
        # 移除前车货物释放容量 -> 该货物必须回到前车（与全量一致）。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("VA", 6, 2, 2, 10000))
        s.add_vehicle(Vehicle("VB", 6, 2, 2, 10000))
        for i in range(6):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=100, stack_limit=0))
        s.plan_all()
        self.assertEqual(len(s.plan.placements["VA"]), 3)
        self.assertEqual(len(s.plan.placements["VB"]), 3)
        # 排序最后的 C5 原在 VB；删掉 VA 第一件后，释放出的容量会把
        # 排序最靠前的 VB 货物 C3 吸入 VA（与从头全量重排完全相同）。
        self.assertEqual(s.locate_cargo("C5")["vehicle_id"], "VB")
        s.remove_cargo("C0")
        self.assertEqual(s.locate_cargo("C3")["vehicle_id"], "VA")
        self.assertEqual(s.locate_cargo("C5")["vehicle_id"], "VB")
        self.assertEqual(per_vehicle_snapshot(s),
                         per_vehicle_snapshot(full_replan_system(s)))

    def test_unblock_pulls_rerouted_back(self):
        s = LoadingSystem()
        s.add_vehicle(Vehicle("VA", 8, 4, 2, 10000,
                              blocked=(Box(6, 0, 0, 2, 4, 2),)))
        s.add_vehicle(Vehicle("VB", 8, 4, 2, 10000))
        for i in range(8):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10, stack_limit=0))
        s.plan_all()
        self.assertEqual(len(s.plan.placements["VA"]), 6)
        self.assertEqual(len(s.plan.placements["VB"]), 2)
        s.update_vehicle(Vehicle("VA", 8, 4, 2, 10000))  # 解除障碍
        self.assertEqual(per_vehicle_snapshot(s),
                         per_vehicle_snapshot(full_replan_system(s)))
        self.assertEqual(len(s.plan.placements["VA"]), 8)
        self.assertEqual(len(s.plan.placements["VB"]), 0)

    def test_same_pool_different_arrival_orders_identical(self):
        # 同一批货物，多种到达顺序 -> 全量方案逐车厢完全一致
        rng = random.Random(2026)
        pool = [
            Cargo(f"C{i:02d}", rng.choice([1, 2, 3]), rng.choice([1, 2, 3]),
                  rng.choice([1, 2, 3]), weight=rng.choice([50, 200, 600]),
                  stack_limit=rng.choice([0, 1, 2]))
            for i in range(18)
        ]
        vehicles = [
            Vehicle("VA", 8, 6, 5, 3000),
            Vehicle("VB", 6, 6, 5, 2500),
            Vehicle("VC", 5, 5, 4, 2000),
        ]

        def build(order):
            sy = LoadingSystem()
            for v in vehicles:
                sy.add_vehicle(copy.deepcopy(v))
            for idx in order:
                sy.add_cargo(copy.deepcopy(pool[idx]))
            sy.plan_all()
            return sy

        base = per_vehicle_snapshot(build(list(range(18))))
        order_rng = random.Random(7)
        for _ in range(12):
            order = list(range(18))
            order_rng.shuffle(order)
            self.assertEqual(per_vehicle_snapshot(build(order)), base)

    def test_different_change_sequences_all_match_full(self):
        # 同一组变更操作，按不同顺序施加，每一步后增量方案都必须与
        # 从头全量重排“逐车厢”一致。
        def base_system():
            sy = LoadingSystem()
            sy.add_vehicle(Vehicle("VA", 10, 4, 3, 4000))
            sy.add_vehicle(Vehicle("VB", 8, 4, 3, 3000))
            sy.add_vehicle(Vehicle("VC", 6, 4, 3, 2500))
            rng = random.Random(99)
            for i in range(16):
                sy.add_cargo(Cargo(
                    f"C{i:02d}", rng.choice([1, 2, 3]),
                    rng.choice([1, 2, 3]), rng.choice([1, 2, 3]),
                    weight=rng.choice([50, 200, 500]),
                    stack_limit=rng.choice([0, 1, 2])))
            sy.plan_all()
            return sy

        # 变更操作（按当前状态惰性构造，保证幂等可重放）
        def add_n1(sy):
            if "N1" not in sy.cargos:
                sy.add_cargo(Cargo("N1", 2, 2, 2, weight=150, stack_limit=1))

        def add_n2(sy):
            if "N2" not in sy.cargos:
                sy.add_cargo(Cargo("N2", 3, 1, 2, weight=300, stack_limit=0))

        def add_n3(sy):
            if "N3" not in sy.cargos:
                sy.add_cargo(Cargo("N3", 1, 1, 1, weight=50))

        def remove_c03(sy):
            if "C03" in sy.cargos:
                sy.remove_cargo("C03")

        def remove_c10(sy):
            if "C10" in sy.cargos:
                sy.remove_cargo("C10")

        def block_vb(sy):
            v = sy.vehicles["VB"]
            sy.update_vehicle(Vehicle(
                "VB", v.length, v.width, v.height, v.max_weight,
                blocked=(Box(0, 0, 0, 2, 4, 3),)))

        def unblock_vb(sy):
            v = sy.vehicles["VB"]
            sy.update_vehicle(Vehicle("VB", v.length, v.width, v.height,
                                      v.max_weight, blocked=()))

        def shrink_va(sy):
            v = sy.vehicles["VA"]
            sy.update_vehicle(Vehicle("VA", v.length - 1, v.width, v.height,
                                      v.max_weight, blocked=v.blocked))

        ops = [add_n1, add_n2, add_n3, remove_c03, remove_c10,
               block_vb, unblock_vb, shrink_va]

        def run_sequence(seq, seed):
            sy = base_system()
            rng = random.Random(seed)
            for op in seq:
                before = per_vehicle_snapshot(sy)
                try:
                    op(sy)
                except LoadingError:
                    # 变更被拒必须整体回滚
                    self.assertEqual(per_vehicle_snapshot(sy), before)
                    continue
                # 关键断言：逐车厢增量 == 全量
                self.assertEqual(per_vehicle_snapshot(sy),
                                 per_vehicle_snapshot(full_replan_system(sy)))
                assert_plan_valid(self, sy)
            return sy

        orders = [
            ops,
            list(reversed(ops)),
            [ops[i] for i in [6, 0, 3, 5, 1, 7, 4, 2]],
        ]
        seq_rng = random.Random(31)
        for _ in range(6):
            o = ops[:]
            seq_rng.shuffle(o)
            orders.append(o)
        for k, order in enumerate(orders):
            run_sequence(order, 1000 + k)

    def test_failed_incremental_change_does_not_poisons_plan(self):
        # 不可行的变更必须回滚，随后系统仍与全量一致
        s = LoadingSystem()
        s.add_vehicle(Vehicle("VA", 4, 2, 2, 10000))
        s.add_vehicle(Vehicle("VB", 4, 2, 2, 10000))
        for i in range(4):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10, stack_limit=0))
        s.plan_all()
        before = plan_snapshot(s)
        with self.assertRaises(LoadingError):
            s.add_cargo(Cargo("HUGE", 100, 100, 100, weight=1))
        self.assertEqual(plan_snapshot(s), before)
        self.assertEqual(per_vehicle_snapshot(s),
                         per_vehicle_snapshot(full_replan_system(s)))


if __name__ == "__main__":
    unittest.main()
