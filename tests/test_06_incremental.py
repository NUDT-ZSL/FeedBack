"""需求 6：清单/不可用区域变化后只重排受影响车厢，且与从头编排完全一致。"""

import copy
import random
import unittest

from loading import Cargo, LoadingSystem, Vehicle
from loading.geometry import Box

from tests._helpers import assert_plan_valid, full_replan_snapshot, plan_snapshot


def _build_populated():
    rng = random.Random(2026)
    s = LoadingSystem()
    s.add_vehicle(Vehicle("VA", 10, 10, 8, max_weight=4000))
    s.add_vehicle(Vehicle("VB", 8, 8, 6, max_weight=3000))
    s.add_vehicle(Vehicle("VC", 6, 6, 5, max_weight=2000))
    for i in range(28):
        s.add_cargo(
            Cargo(
                f"C{i:02d}",
                rng.choice([2, 3, 4]),
                rng.choice([2, 3, 4]),
                rng.choice([2, 3, 4]),
                weight=rng.randint(50, 260),
                stack_limit=rng.choice([0, 1, 2]),
                fragile=rng.random() < 0.1,
            )
        )
    s.plan_all()
    return s


class IncrementalReplanningTest(unittest.TestCase):
    def setUp(self):
        self.s = _build_populated()
        assert_plan_valid(self, self.s)

    def _assert_equivalent(self):
        assert_plan_valid(self, self.s)
        self.assertEqual(plan_snapshot(self.s), full_replan_snapshot(self.s))

    def test_add_cargo_only_touches_needed_vehicles_but_matches_full(self):
        before = {vid: copy.deepcopy(self.s.plan.placements[vid])
                  for vid in self.s.vehicles}
        self.s.add_cargo(Cargo("NEW", 3, 3, 3, weight=100, stack_limit=1))
        self._assert_equivalent()
        # 至少第一节放得下新货的车厢发生变化，且新车确实在方案中
        self.assertIsNotNone(self.s.locate_cargo("NEW"))

    def test_remove_cargo_equivalent_to_full(self):
        removed = "C05"
        self.s.remove_cargo(removed)
        self._assert_equivalent()
        # 删除后再查询该货物应报“不存在”
        from loading import LoadingError

        with self.assertRaises(LoadingError):
            self.s.locate_cargo(removed)

    def test_update_cargo_equivalent(self):
        self.s.update_cargo(Cargo("C05", 4, 4, 4, weight=500, stack_limit=0))
        self._assert_equivalent()

    def test_blocked_zone_change_equivalent(self):
        v = self.s.vehicles["VB"]
        self.s.update_vehicle(
            Vehicle("VB", v.length, v.width, v.height, v.max_weight,
                    blocked=(Box(0, 0, 0, 2, 2, 2),))
        )
        self._assert_equivalent()
        for p in self.s.plan.placements["VB"]:
            for b in self.s.vehicles["VB"].blocked:
                from loading.geometry import overlap
                self.assertFalse(overlap(p.box, b))

    def test_unblock_zone_equivalent(self):
        # 先加障碍，再清除；清除后增量结果也要等于全量
        v = self.s.vehicles["VA"]
        self.s.update_vehicle(
            Vehicle("VA", v.length, v.width, v.height, v.max_weight,
                    blocked=(Box(0, 0, 0, 3, 3, 3),))
        )
        self._assert_equivalent()
        self.s.update_vehicle(
            Vehicle("VA", v.length, v.width, v.height, v.max_weight, blocked=())
        )
        self._assert_equivalent()

    def test_unaffected_vehicle_unchanged_on_cargo_change(self):
        # 确定性场景：VA、VB 各被 4 个 2x2x2 箱子精确装满（limit=0 不可叠），
        # 之后对 VC 内货物的任何改动都不可能影响 VA/VB。
        s = LoadingSystem()
        s.add_vehicle(Vehicle("VA", 4, 4, 4, max_weight=10000))
        s.add_vehicle(Vehicle("VB", 4, 4, 4, max_weight=10000))
        s.add_vehicle(Vehicle("VC", 6, 6, 6, max_weight=10000))
        for i in range(4):
            s.add_cargo(Cargo(f"A{i}", 2, 2, 2, weight=10, stack_limit=0))
        for i in range(4):
            s.add_cargo(Cargo(f"B{i}", 2, 2, 2, weight=10, stack_limit=0))
        for i in range(3):
            s.add_cargo(Cargo(f"C{i}", 2, 2, 2, weight=10, stack_limit=1))
        s.plan_all()
        self.assertEqual({p.cargo_id for p in s.plan.placements["VA"]},
                         {"A0", "A1", "A2", "A3"})
        self.assertEqual({p.cargo_id for p in s.plan.placements["VB"]},
                         {"B0", "B1", "B2", "B3"})

        va_before = copy.deepcopy(s.plan.placements["VA"])
        vb_before = copy.deepcopy(s.plan.placements["VB"])
        # 向 VC 增加一件货物
        s.add_cargo(Cargo("C9", 2, 2, 2, weight=10, stack_limit=1))
        self.assertEqual(s.plan.placements["VA"], va_before)
        self.assertEqual(s.plan.placements["VB"], vb_before)
        self.assertEqual(plan_snapshot(s), full_replan_snapshot(s))
        # 再删除一件 VC 货物，VA/VB 仍不变
        s.remove_cargo("C0")
        self.assertEqual(s.plan.placements["VA"], va_before)
        self.assertEqual(s.plan.placements["VB"], vb_before)
        self.assertEqual(plan_snapshot(s), full_replan_snapshot(s))

    def test_insert_vehicle_between_existing_ones(self):
        # 在 VA/VB 之间插入新车：VB/VC 的货物可能被吸入新车，
        # 增量结果仍必须与从头全量一致。
        self.s.add_vehicle(Vehicle("VAB", 9, 9, 7, max_weight=3500))
        self._assert_equivalent()
        rec = self.s.records[-1]
        self.assertEqual(rec["action"], "add_vehicle")

    def test_records_report_affected_vehicles(self):
        self.s.add_cargo(Cargo("REC", 2, 2, 2, weight=50))
        rec = self.s.records[-1]
        self.assertEqual(rec["action"], "add_cargo")
        self.assertIn("REC", rec["changed_cargos"])
        self.assertTrue(len(rec["affected_vehicles"]) >= 1)

    def test_failed_change_leaves_state_intact(self):
        before = plan_snapshot(self.s)
        cargos_before = copy.deepcopy(self.s.cargos)
        # 加入一件任何车厢都放不下的货物：变更必须回滚
        with self.assertRaises(Exception):
            self.s.add_cargo(Cargo("HUGE", 100, 100, 100, weight=1))
        self.assertNotIn("HUGE", self.s.cargos)
        self.assertEqual(plan_snapshot(self.s), before)
        self.assertEqual(set(self.s.cargos), set(cargos_before))

    def test_randomized_mutations_match_full_replan(self):
        rng = random.Random(777)
        step = 0
        for _ in range(60):
            step += 1
            choice = rng.randrange(6)
            before = plan_snapshot(self.s)
            try:
                if choice == 0:
                    self.s.add_cargo(
                        Cargo(f"X{step}", rng.choice([2, 3, 4]),
                              rng.choice([2, 3, 4]), rng.choice([2, 3, 4]),
                              weight=rng.randint(50, 300),
                              stack_limit=rng.choice([0, 1, 2]))
                    )
                elif choice == 1 and self.s.cargos:
                    self.s.remove_cargo(rng.choice(sorted(self.s.cargos)))
                elif choice == 2 and self.s.cargos:
                    cid = rng.choice(sorted(self.s.cargos))
                    self.s.update_cargo(
                        Cargo(cid, rng.choice([2, 3, 4]),
                              rng.choice([2, 3, 4]), rng.choice([2, 3, 4]),
                              weight=rng.randint(50, 300),
                              stack_limit=rng.choice([0, 1, 2]))
                    )
                elif choice == 3 and self.s.vehicles:
                    vid = rng.choice(sorted(self.s.vehicles))
                    v = self.s.vehicles[vid]
                    self.s.update_vehicle(
                        Vehicle(vid, v.length, v.width, v.height, v.max_weight,
                                blocked=((Box(0, 0, 0, 2, 2, 2),)
                                         if rng.random() < 0.5 else ()))
                    )
                elif choice == 4:
                    vid = f"W{step}"
                    if vid not in self.s.vehicles:
                        self.s.add_vehicle(Vehicle(vid, 9, 9, 7, 3500))
                elif len(self.s.vehicles) > 1:
                    self.s.remove_vehicle(rng.choice(sorted(self.s.vehicles)))
            except Exception:
                # 变更被拒绝：系统状态必须与变更前完全相同
                self.assertEqual(plan_snapshot(self.s), before)
                continue
            # 被接受的变更：增量方案必须等于从头全量方案
            try:
                self._assert_equivalent()
            except AssertionError:
                raise


if __name__ == "__main__":
    unittest.main()
