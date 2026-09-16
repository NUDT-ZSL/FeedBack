"""需求 6：项目级与方案级查询，稳定顺序。"""

import unittest
from decimal import Decimal

from fund_allocator import Engine, Project, Registry

D = Decimal


def build():
    reg = Registry()
    specs = [
        ("A", 1, "100.00", "30.00", ["40.00", "60.00"]),
        ("B", 2, "200.00", "50.00", ["50.00", "150.00"]),
        ("C", 1, "100.00", "30.00", ["100.00"]),
    ]
    for s in specs:
        reg.add_project(Project.create(*s))
    reg.add_dependency("C", "A")
    eng = Engine(reg)
    # 预算 100：A、C 各 30 启动后只剩 40，不够 B 的最低启动额 50，B 不启动
    eng.solve("100.00")
    return eng


class TestProjectQuery(unittest.TestCase):
    def test_fields(self):
        eng = build()
        rep = eng.query_project("A")
        self.assertEqual(rep["id"], "A")
        self.assertEqual(rep["total_need"], D("100.00"))
        self.assertTrue(rep["started"])
        self.assertEqual(rep["funded"] + rep["gap"], rep["total_need"])
        self.assertEqual(rep["dependents"], ["C"])
        self.assertEqual(rep["all_dependents"], ["C"])
        self.assertEqual(rep["prerequisites"], [])

    def test_unstarted_project(self):
        # B 优先级最低；预算 200 时 A、C 启动并优先补足，B 未启动
        eng = build()
        rep = eng.query_project("B")
        self.assertFalse(rep["started"])
        self.assertEqual(rep["funded"], D("0.00"))
        self.assertEqual(rep["gap"], D("200.00"))

    def test_unknown_project(self):
        from fund_allocator.errors import ValidationError
        with self.assertRaises(ValidationError):
            build().query_project("NOPE")


class TestPlanQuery(unittest.TestCase):
    def test_summary_stable(self):
        eng = build()
        s1 = eng.query_plan()
        s2 = eng.query_plan()
        # 稳定顺序：funded 行按 id 排
        ids = [row["id"] for row in s1["funded"]]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(s1, s2)

    def test_totals_consistency(self):
        eng = build()
        s = eng.query_plan()
        self.assertEqual(
            s["total_allocated"],
            sum((row["amount"] for row in s["funded"]), D("0.00")),
        )
        self.assertEqual(
            s["remaining"], s["budget"] - s["total_allocated"]
        )
        self.assertLessEqual(s["total_allocated"], s["budget"])

    def test_phase_usage(self):
        eng = build()
        s = eng.query_plan()
        phase_sum = sum((row["amount"] for row in s["phase_usage"]), D("0.00"))
        self.assertEqual(phase_sum, s["total_allocated"])
        # 阶段编号从 1 开始且有序
        self.assertEqual([row["phase"] for row in s["phase_usage"]], [1, 2])

    def test_unmet_sorted(self):
        eng = build()
        s = eng.query_plan()
        ids = [row["id"] for row in s["unmet"]]
        self.assertEqual(ids, sorted(ids))
        for row in s["unmet"]:
            self.assertEqual(row["funded"] + row["gap"], row["total_need"])

    def test_started_list_sorted(self):
        eng = build()
        s = eng.query_plan()
        self.assertEqual(s["started"], sorted(s["started"]))


if __name__ == "__main__":
    unittest.main()
