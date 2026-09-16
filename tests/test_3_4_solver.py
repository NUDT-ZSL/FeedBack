"""需求 3 + 4：方案约束（上限/启动下限/前置门控）与取舍定序、可复现性。"""

import unittest
from decimal import Decimal

from fund_allocator import Engine, Project, Registry, Solver
from fund_allocator.errors import PlanError, ValidationError

D = Decimal


def reg_from(specs, deps=()):
    """specs: (id, priority, total, min_start, [phases], benefit?)"""
    reg = Registry()
    for s in specs:
        pid, pr, total, ms, phases = s[:5]
        benefit = s[5] if len(s) > 5 else None
        reg.add_project(Project.create(pid, pr, total, ms, phases, benefit=benefit))
    for a, b in deps:
        reg.add_dependency(a, b)
    return reg


class TestBasicAllocation(unittest.TestCase):
    def test_budget_covers_all(self):
        reg = reg_from([
            ("A", 1, "100.00", "40.00", ["40.00", "60.00"]),
            ("B", 2, "200.00", "50.00", ["50.00", "150.00"]),
        ])
        eng = Engine(reg)
        plan = eng.solve("1000.00")
        self.assertEqual(plan.total, D("300.00"))
        self.assertEqual(plan.amount_for("A"), D("100.00"))
        self.assertEqual(plan.amount_for("B"), D("200.00"))

    def test_total_never_exceeds_budget(self):
        reg = reg_from([
            ("A", 1, "100.00", "60.00", ["100.00"]),
            ("B", 1, "100.00", "60.00", ["100.00"]),
        ])
        plan = Engine(reg).solve("100.00")
        # A 以 60 启动，B 需 60 已无法启动；剩余 40 按排名继续补足 A
        self.assertLessEqual(plan.total, D("100.00"))
        self.assertEqual(plan.total, D("100.00"))
        self.assertEqual(plan.amount_for("A"), D("100.00"))
        self.assertEqual(plan.amount_for("B"), D("0.00"))

    def test_no_sub_min_start_funding(self):
        """预算低于最低启动额时，不允许出现 0 < 拨款 < min_start。"""
        reg = reg_from([("A", 1, "100.00", "60.00", ["100.00"])])
        plan = Engine(reg).solve("50.00")
        self.assertEqual(plan.amount_for("A"), D("0.00"))
        self.assertEqual(plan.total, D("0.00"))

    def test_dependency_gate(self):
        """下游高优先也不能在前置未达标时启动；前置自身仍可独立立项。"""
        reg = reg_from([
            ("UP", 5, "100.00", "40.00", ["100.00"]),    # 低优先的前置
            ("DOWN", 1, "100.00", "40.00", ["100.00"]),  # 高优先的下游
        ], deps=[("DOWN", "UP")])
        plan = Engine(reg).solve("60.00")
        # DOWN 启动需要 DOWN 40 + UP 40 = 80 > 60 => DOWN 绝不能启动
        self.assertEqual(plan.amount_for("DOWN"), D("0.00"))
        self.assertFalse(plan.is_started("DOWN"))
        # UP 没有前置，作为独立候选仍可合法拿到 60（门控只约束下游）
        self.assertTrue(plan.is_started("UP"))
        self.assertLessEqual(plan.total, D("60.00"))

    def test_dependency_chain_start(self):
        """预算刚好够下游+前置的最低启动额时，链式一起启动。"""
        reg = reg_from([
            ("UP", 5, "100.00", "40.00", ["100.00"]),
            ("DOWN", 1, "100.00", "40.00", ["100.00"]),
        ], deps=[("DOWN", "UP")])
        plan = Engine(reg).solve("80.00")
        self.assertEqual(plan.amount_for("UP"), D("40.00"))
        self.assertEqual(plan.amount_for("DOWN"), D("40.00"))
        self.assertTrue(plan.is_started("UP"))
        self.assertTrue(plan.is_started("DOWN"))

    def test_chain_start_then_fill_by_rank(self):
        """链式启动后，剩余预算按排名补足：DOWN 排名靠前先填满。"""
        reg = reg_from([
            ("UP", 5, "100.00", "40.00", ["100.00"]),
            ("DOWN", 1, "100.00", "40.00", ["100.00"]),
        ], deps=[("DOWN", "UP")])
        plan = Engine(reg).solve("140.00")
        self.assertEqual(plan.amount_for("DOWN"), D("100.00"))
        self.assertEqual(plan.amount_for("UP"), D("40.00"))
        self.assertEqual(plan.total, D("140.00"))

    def test_transitive_gate(self):
        reg = reg_from([
            ("A", 3, "100.00", "10.00", ["100.00"]),
            ("B", 2, "100.00", "10.00", ["100.00"]),
            ("C", 1, "100.00", "10.00", ["100.00"]),
        ], deps=[("B", "A"), ("C", "B")])
        # 预算 25：C 需 C+B+A=30 无法启动；但 B+A 只需 20，B 可独立启动
        plan = Engine(reg).solve("25.00")
        self.assertEqual(plan.amount_for("C"), D("0.00"))
        self.assertEqual(plan.amount_for("A"), D("10.00"))
        self.assertEqual(plan.amount_for("B"), D("15.00"))
        self.assertEqual(plan.total, D("25.00"))
        # 预算 30：整条链一起启动
        plan2 = Engine(reg).solve("30.00")
        self.assertEqual(plan2.total, D("30.00"))
        for pid in "ABC":
            self.assertEqual(plan2.amount_for(pid), D("10.00"))


class TestRanking(unittest.TestCase):
    def test_priority_order(self):
        reg = reg_from([
            ("LOW", 5, "100.00", "60.00", ["100.00"]),
            ("HIGH", 1, "100.00", "60.00", ["100.00"]),
        ])
        plan = Engine(reg).solve("60.00")
        self.assertEqual(plan.amount_for("HIGH"), D("60.00"))
        self.assertEqual(plan.amount_for("LOW"), D("0.00"))

    def test_roi_order_within_priority(self):
        reg = reg_from([
            # 同优先级：X 每元收益 2，Y 每元收益 1
            ("X", 1, "100.00", "80.00", ["100.00"], "200"),
            ("Y", 1, "100.00", "80.00", ["100.00"], "100"),
        ])
        plan = Engine(reg).solve("80.00")
        self.assertEqual(plan.amount_for("X"), D("80.00"))
        self.assertEqual(plan.amount_for("Y"), D("0.00"))

    def test_id_lexicographic_tiebreak(self):
        reg = reg_from([
            ("BETA", 1, "100.00", "60.00", ["100.00"]),
            ("ALPHA", 1, "100.00", "60.00", ["100.00"]),
        ])
        plan = Engine(reg).solve("60.00")
        self.assertEqual(plan.amount_for("ALPHA"), D("60.00"))
        self.assertEqual(plan.amount_for("BETA"), D("0.00"))

    def test_roi_compared_without_float(self):
        # 3/10 与 1/3 这类无法用二进制浮点精确区分的比率
        reg = reg_from([
            ("P", 1, "100.00", "1.00", ["100.00"], "300"),    # ROI 3
            ("Q", 1, "300.00", "1.00", ["300.00"], "1000"),   # ROI 3.333...
        ])
        ranking = Solver.rank_projects(reg.projects())
        self.assertEqual(ranking, ["Q", "P"])


class TestReproducibility(unittest.TestCase):
    def test_same_input_same_output(self):
        specs = [
            (pid, (i % 3) + 1, f"{100 + i * 37}.00", "25.00",
             [f"{100 + i * 37}.00"], str(200 + i * 50))
            for i, pid in enumerate(["P1", "P2", "P3", "P4", "P5", "P6"])
        ]
        results = []
        for _ in range(5):
            reg = reg_from(specs, deps=[("P3", "P1"), ("P4", "P2")])
            plan = Engine(reg).solve("400.00")
            results.append({k: str(v) for k, v in sorted(plan.allocations.items())})
        self.assertEqual(len(set(map(repr, results))), 1)
        self.assertEqual(results[0], dict(sorted(results[0].items())))

    def test_insertion_order_independent(self):
        def build(order):
            specs = {
                "A": ("A", 2, "100.00", "40.00", ["100.00"]),
                "B": ("B", 1, "100.00", "40.00", ["100.00"]),
                "C": ("C", 1, "100.00", "40.00", ["100.00"]),
            }
            return reg_from([specs[k] for k in order])
        p1 = Engine(build(["A", "B", "C"])).solve("90.00")
        p2 = Engine(build(["C", "A", "B"])).solve("90.00")
        self.assertEqual(dict(p1.allocations), dict(p2.allocations))


class TestPhasedFunding(unittest.TestCase):
    def test_phase_usage(self):
        reg = reg_from([
            ("A", 1, "300.00", "100.00", ["100.00", "200.00"]),
            ("B", 2, "200.00", "50.00", ["50.00", "150.00"]),
        ])
        plan = Engine(reg).solve("200.00")
        # 启动：A=100, B=50；剩余 50 按排名补给 A 的第二阶段
        self.assertEqual(plan.amount_for("A"), D("150.00"))
        self.assertEqual(plan.amount_for("B"), D("50.00"))
        usage = plan.phase_usage()
        # A: 阶段1=100 阶段2=50；B: 阶段1=50
        self.assertEqual(usage, [D("150.00"), D("50.00")])


class TestEdgeCases(unittest.TestCase):
    def test_zero_budget(self):
        reg = reg_from([("A", 1, "100.00", "10.00", ["100.00"])])
        plan = Engine(reg).solve("0")
        self.assertEqual(plan.total, D("0.00"))
        self.assertEqual(plan.amount_for("A"), D("0.00"))

    def test_diamond_chain_start(self):
        # D 依赖 B、C；B、C 都依赖 A：启动 D 必须原子拉起 A,B,C
        reg = Registry()
        for pid, ms in [("A", "10"), ("B", "20"), ("C", "30"), ("D", "40")]:
            reg.add_project(Project.create(pid, 1, "100.00", ms, ["100.00"]))
        for a, b in [("B", "A"), ("C", "A"), ("D", "B"), ("D", "C")]:
            reg.add_dependency(a, b)
        plan = Engine(reg).solve("100.00")
        self.assertEqual(
            {k: str(v) for k, v in plan.allocations.items()},
            {"A": "10.00", "B": "20.00", "C": "30.00", "D": "40.00"},
        )
        # 差 1 元链不完整：D 绝不启动；A,B,C 启动后剩余预算按排名补 A
        tight = Engine(reg).solve("99.00")
        self.assertEqual(tight.amount_for("D"), D("0.00"))
        self.assertEqual(tight.amount_for("A"), D("49.00"))
        self.assertEqual(tight.total, D("99.00"))


if __name__ == "__main__":
    unittest.main()
