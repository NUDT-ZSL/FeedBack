"""需求 5：削减/取消后只重算下游，且与带同约束从头求解完全一致。"""

import unittest
from decimal import Decimal

from fund_allocator import Engine, Project, Registry, Solver, SolveRequest

D = Decimal


def build_engine():
    #   A(优先级1)        B(优先级2, 独立)
    #    \
    #     C(优先级1, 依赖A)      D(优先级1, 依赖C)      E(优先级3, 独立)
    reg = Registry()
    specs = [
        ("A", 1, "100.00", "30.00", ["100.00"]),
        ("B", 2, "100.00", "40.00", ["100.00"]),
        ("C", 1, "100.00", "30.00", ["100.00"]),
        ("D", 1, "200.00", "50.00", ["200.00"]),
        ("E", 3, "100.00", "20.00", ["100.00"]),
    ]
    for s in specs:
        reg.add_project(Project.create(*s))
    reg.add_dependency("C", "A")
    reg.add_dependency("D", "C")
    eng = Engine(reg)
    eng.solve("400.00")
    return eng


class TestAffectedRegion(unittest.TestCase):
    def test_region_is_self_plus_downstream(self):
        eng = build_engine()
        self.assertEqual(eng.affected_region("A"), ["A", "C", "D"])
        self.assertEqual(eng.affected_region("B"), ["B"])
        self.assertEqual(eng.affected_region("C"), ["C", "D"])


class TestIncrementalReduction(unittest.TestCase):
    def setUp(self):
        self.eng = build_engine()

    def _fixed_for_reduction(self, pid, target):
        reg = self.eng.registry
        region = {pid} | reg.downstream_closure([pid])
        fixed = {
            p: self.eng.plan.amount_for(p)
            for p in reg.project_ids()
            if p not in region
        }
        fixed[pid] = D(target)
        return fixed

    def test_cancel_stops_downstream_only(self):
        before = dict(self.eng.plan.allocations)
        plan, affected = self.eng.reduce("A", "0")
        self.assertEqual(affected, ["A", "C", "D"])
        # A 被取消，C、D 因前置门控停止
        self.assertEqual(plan.amount_for("A"), D("0.00"))
        self.assertEqual(plan.amount_for("C"), D("0.00"))
        self.assertEqual(plan.amount_for("D"), D("0.00"))
        # 无关项目分文不动
        for pid in ("B", "E"):
            self.assertEqual(plan.amount_for(pid), before[pid], f"{pid} 不应变化")

    def test_incremental_equals_full_resolve_with_same_constraints(self):
        """核心不变量：增量结果 == 把削减当硬约束从头全量求解。"""
        pid, target = "A", D("30.00")
        fixed = self._fixed_for_reduction(pid, target)
        full = Solver.solve(SolveRequest(
            registry=self.eng.registry,
            budget=self.eng.plan.budget,
            preallocated=fixed,
        ))
        new_plan, _ = self.eng.reduce(pid, target, _check_equivalence=True)
        self.assertEqual(dict(new_plan.allocations), dict(full.allocations))

    def test_unaffected_never_change_across_scenarios(self):
        """多组随机式场景下：削减任意项目，区域外拨款与全量约束解逐项一致。"""
        scenarios = [
            ("A", "0"), ("A", "30.00"), ("C", "0"), ("C", "30.00"),
            ("D", "0"), ("B", "0"), ("E", "0"),
        ]
        for pid, amt in scenarios:
            eng = build_engine()
            before = dict(eng.plan.allocations)
            fixed = {
                p: (D(amt) if p == pid else before.get(p, D("0.00")))
                for p in eng.registry.project_ids()
                if p == pid or p not in {pid} | eng.registry.downstream_closure([pid])
            }
            full = Solver.solve(SolveRequest(
                registry=eng.registry, budget=D("400.00"), preallocated=fixed
            ))
            new_plan, affected = eng.reduce(pid, amt, _check_equivalence=True)
            self.assertEqual(
                dict(new_plan.allocations), dict(full.allocations),
                msg=f"场景 {pid}->{amt} 增量与全量不一致",
            )
            region = set(affected)
            for other in eng.registry.project_ids():
                if other not in region:
                    self.assertEqual(
                        new_plan.amount_for(other), before.get(other, D("0.00")),
                        msg=f"场景 {pid}->{amt}: 无关项目 {other} 拨款改变",
                    )

    def test_partial_cut_still_gates_when_below_min(self):
        eng = build_engine()
        # A 的最低启动额是 30；削减到 29 属于非法区间
        from fund_allocator.errors import ValidationError
        with self.assertRaises(ValidationError):
            eng.reduce("A", "29.00")

    def test_cannot_increase_via_reduce(self):
        from fund_allocator.errors import ValidationError
        # A 当前足额 100，不能借“削减”提高金额
        with self.assertRaises(ValidationError):
            self.eng.reduce("A", "150.00")

    def test_freed_budget_stays_in_region_consistently(self):
        """释放出的预算可被下游使用，但增量/全量仍逐项相同。"""
        eng = build_engine()
        plan, _ = eng.reduce("D", "50.00", _check_equivalence=True)  # D 从足额降到启动额
        self.assertEqual(plan.amount_for("D"), D("50.00"))
        self.assertLessEqual(plan.total, D("400.00"))

    def test_cancel_leaf_freed_budget_not_moved_outside_region(self):
        """取消叶子 D：区域只有 {D}；释放的预算不得挪给区域外的 A/B/C。"""
        reg = Registry()
        for pid, ms in [("A", "10"), ("B", "20"), ("C", "30"), ("D", "40")]:
            reg.add_project(Project.create(pid, 1, "100.00", ms, ["100.00"]))
        for a, b in [("B", "A"), ("C", "A"), ("D", "B"), ("D", "C")]:
            reg.add_dependency(a, b)
        eng = Engine(reg)
        eng.solve("100.00")
        new_plan, affected = eng.reduce("D", "0", _check_equivalence=True)
        self.assertEqual(set(affected), {"D"})
        self.assertEqual(new_plan.amount_for("D"), D("0.00"))
        # 区域外项目分文不动，释放的 40 留在预算里
        self.assertEqual(new_plan.amount_for("A"), D("10.00"))
        self.assertEqual(new_plan.amount_for("B"), D("20.00"))
        self.assertEqual(new_plan.amount_for("C"), D("30.00"))
        self.assertEqual(new_plan.total, D("60.00"))

    def test_reduce_without_plan_fails(self):
        reg = Registry()
        reg.add_project(Project.create("A", 1, "100.00", "10.00", ["100.00"]))
        from fund_allocator.errors import PlanError
        with self.assertRaises(PlanError):
            Engine(reg).reduce("A", "0")


if __name__ == "__main__":
    unittest.main()
