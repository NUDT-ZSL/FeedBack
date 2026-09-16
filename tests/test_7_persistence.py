"""需求 7：保存/载入往返、全量校验、损坏报错清晰、失败后状态不变。"""

import json
import os
import tempfile
import unittest
from decimal import Decimal

from fund_allocator import Engine, Project, Registry, persistence
from fund_allocator.errors import PersistenceError

D = Decimal


def build_engine(budget="500.00"):
    reg = Registry()
    specs = [
        ("A", 1, "100.00", "30.00", ["30.00", "70.00"]),
        ("B", 2, "200.00", "50.00", ["50.00", "150.00"]),
        ("C", 1, "100.00", "30.00", ["100.00"]),
    ]
    for s in specs:
        reg.add_project(Project.create(*s))
    reg.add_dependency("C", "A")
    eng = Engine(reg)
    eng.solve(budget)
    return eng


class TestRoundTrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "plan.json")

    def test_save_and_load_matches(self):
        eng = build_engine()
        persistence.save_to(self.path, eng)
        loaded = persistence.load_new(self.path)
        self.assertEqual(
            dict(loaded.plan.allocations), dict(eng.plan.allocations)
        )
        self.assertEqual(loaded.plan.budget, eng.plan.budget)
        self.assertEqual(loaded.registry.project_ids(), eng.registry.project_ids())
        self.assertEqual(loaded.query_plan(), eng.query_plan())

    def test_repeated_save_byte_identical(self):
        eng = build_engine()
        persistence.save_to(self.path, eng)
        with open(self.path, "rb") as f:
            first = f.read()
        persistence.save_to(self.path, build_engine())
        with open(self.path, "rb") as f:
            second = f.read()
        self.assertEqual(first, second)

    def test_load_scenario_without_plan(self):
        reg = Registry()
        reg.add_project(Project.create("A", 1, "100.00", "10.00", ["100.00"]))
        persistence.save_scenario(self.path, reg, "100.00")
        eng = persistence.load_new(self.path)
        self.assertIsNone(eng.plan)
        eng.solve("100.00")
        self.assertEqual(eng.plan.amount_for("A"), D("100.00"))


class TestLoadValidation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "bad.json")

    def _write(self, obj):
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False)

    def _base(self):
        eng = build_engine()
        return persistence.engine_to_dict(eng)

    def test_corrupt_json_reports_position(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write('{"budget": "100.00", "projects": [,]}')
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("JSON 损坏", str(cm.exception))

    def test_empty_file(self):
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("   \n ")
        with self.assertRaises(PersistenceError):
            persistence.load_new(self.path)

    def test_missing_top_level_field(self):
        data = self._base()
        del data["budget"]
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("budget", str(cm.exception))

    def test_missing_project_field(self):
        data = self._base()
        del data["projects"][0]["phases"]
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("phases", str(cm.exception))
        self.assertIn("projects[0]", str(cm.exception))

    def test_duplicate_id_rejected(self):
        data = self._base()
        data["projects"][1]["id"] = "A"
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("重复", str(cm.exception))

    def test_phase_sum_violation_rejected(self):
        data = self._base()
        data["projects"][0]["phases"] = ["30.00", "60.00"]  # 和 != 100
        self._write(data)
        with self.assertRaises(PersistenceError):
            persistence.load_new(self.path)

    def test_dangling_dependency_rejected_with_chain(self):
        data = self._base()
        data["dependencies"].append({"project": "A", "requires": "GHOST"})
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("GHOST", str(cm.exception))

    def test_cycle_rejected_with_chain(self):
        data = self._base()
        data["dependencies"].append({"project": "A", "requires": "C"})  # C->A 闭环
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("环", str(cm.exception))

    def test_allocation_over_budget_rejected(self):
        data = self._base()
        data["plan"]["allocations"] = [
            {"project_id": "A", "amount": "100.00"},
            {"project_id": "B", "amount": "200.00"},
            {"project_id": "C", "amount": "100.00"},
        ]  # 合计 400 > 上限... 把上限改小
        data["budget"] = "150.00"
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("超过资金上限", str(cm.exception))

    def test_gate_violation_rejected(self):
        data = self._base()
        # C 依赖 A，但只拨 C 不拨 A
        data["plan"]["allocations"] = [
            {"project_id": "C", "amount": "100.00"},
        ]
        self._write(data)
        with self.assertRaises(PersistenceError) as cm:
            persistence.load_new(self.path)
        self.assertIn("前置", str(cm.exception))

    def test_sub_minstart_allocation_rejected(self):
        data = self._base()
        data["plan"]["allocations"] = [
            {"project_id": "A", "amount": "10.00"},  # < min_start 30
        ]
        self._write(data)
        with self.assertRaises(PersistenceError):
            persistence.load_new(self.path)

    def test_unknown_project_allocation_rejected(self):
        data = self._base()
        data["plan"]["allocations"].append(
            {"project_id": "X", "amount": "1.00"}
        )
        self._write(data)
        with self.assertRaises(PersistenceError):
            persistence.load_new(self.path)


class TestStateUnchangedOnFailure(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()

    def test_load_into_failure_keeps_state(self):
        good_path = os.path.join(self.tmp, "good.json")
        bad_path = os.path.join(self.tmp, "bad.json")
        eng = build_engine()
        persistence.save_to(good_path, eng)
        before_reg = eng.registry.snapshot()
        before_alloc = dict(eng.plan.allocations)

        bad = persistence.engine_to_dict(build_engine())
        bad["projects"][0]["phases"] = ["1.00", "2.00"]  # 守恒被破坏
        with open(bad_path, "w", encoding="utf-8") as f:
            json.dump(bad, f)

        with self.assertRaises(PersistenceError):
            persistence.load_into(bad_path, eng)

        # 状态原样保留
        self.assertEqual(eng.registry.snapshot()[0].keys(), before_reg[0].keys())
        self.assertEqual(dict(eng.plan.allocations), before_alloc)

        # 载入好文件后状态正常更新
        persistence.load_into(good_path, eng)
        self.assertEqual(dict(eng.plan.allocations), before_alloc)

    def test_atomic_write_leaves_no_tempfile(self):
        path = os.path.join(self.tmp, "out.json")
        persistence.save_to(path, build_engine())
        leftovers = [n for n in os.listdir(self.tmp) if n.startswith(".fundplan-")]
        self.assertEqual(leftovers, [])
        self.assertTrue(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
