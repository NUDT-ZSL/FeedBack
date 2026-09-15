"""引擎核心测试：数据维护、硬约束、缺口报告、事件重排、公平性、查询。"""
import unittest
from datetime import datetime, timedelta

from scheduler import (
    ManualClock,
    NotFoundError,
    ScheduleError,
    SchedulingEngine,
    TimeWindow,
    ValidationError,
)

BASE = datetime(2026, 9, 14)  # 周一


def dt(day, hour, minute=0):
    return BASE + timedelta(days=day, hours=hour, minutes=minute)


def make_engine(**kwargs):
    eng = SchedulingEngine(clock=ManualClock(dt(0, 0)), **kwargs)
    eng.add_store("st1", "一号店")
    return eng


def full_week():
    return [TimeWindow(dt(0, 0), dt(7, 0))]


class TestDataMaintenance(unittest.TestCase):
    def test_add_and_query_entities(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        self.assertIn("S1", eng.shifts)
        self.assertIn("E1", eng.employees)
        self.assertIn("cashier", eng.skills)

    def test_duplicate_ids_rejected(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16))
        with self.assertRaises(ValidationError):
            eng.add_shift("S1", "st1", dt(1, 8), dt(1, 16))
        eng.add_employee("E1", [], full_week(), 40)
        with self.assertRaises(ValidationError):
            eng.add_employee("E1", [], full_week(), 40)
        with self.assertRaises(ValidationError):
            eng.add_store("st1")

    def test_shift_requires_existing_store(self):
        eng = make_engine()
        with self.assertRaises(NotFoundError):
            eng.add_shift("S1", "no-such-store", dt(0, 8), dt(0, 16))

    def test_invalid_time_window_rejected(self):
        eng = make_engine()
        with self.assertRaises(ValidationError):
            eng.add_shift("S1", "st1", dt(0, 16), dt(0, 8))
        with self.assertRaises(ValidationError):
            eng.add_employee("E1", [], [TimeWindow(dt(0, 8), dt(0, 16))], -1)


class TestHardConstraints(unittest.TestCase):
    def test_skill_mismatch_not_assigned(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("E1", ["stocker"], full_week(), 40)
        eng.add_employee("E2", ["cashier"], full_week(), 40)
        eng.schedule()
        self.assertEqual(eng.assignments(), {"S1": "E2"})

    def test_availability_must_contain_shift(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], [TimeWindow(dt(0, 9), dt(0, 17))], 40)
        eng.schedule()
        self.assertEqual(eng.assignments(), {})
        gap = eng.get_shift_gap("S1")
        self.assertEqual(gap["summary"], "no_available_employee")

    def test_no_overlapping_shifts_for_same_employee(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 12), ["cashier"])
        eng.add_shift("S2", "st1", dt(0, 10), dt(0, 14), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.schedule()
        self.assertEqual(eng.assignments(), {"S1": "E1"})
        gap = eng.get_shift_gap("S2")
        self.assertEqual(gap["reasons"][0]["code"], "overlap")
        self.assertEqual(gap["reasons"][0]["with_shift"], "S1")

    def test_min_rest_between_shifts(self):
        eng = make_engine()  # 默认最短休息 8 小时
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 12), ["cashier"])
        eng.add_shift("S2", "st1", dt(0, 13), dt(0, 17), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.schedule()
        self.assertEqual(eng.assignments(), {"S1": "E1"})
        gap = eng.get_shift_gap("S2")
        self.assertEqual(gap["reasons"][0]["code"], "insufficient_rest")

    def test_max_hours_cap(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_shift("S2", "st1", dt(1, 8), dt(1, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 8)
        eng.schedule()
        self.assertEqual(eng.assignments(), {"S1": "E1"})
        gap = eng.get_shift_gap("S2")
        self.assertEqual(gap["reasons"][0]["code"], "exceeds_max_hours")


class TestGapReporting(unittest.TestCase):
    def test_missing_skill_gap_and_other_shifts_unaffected(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["pharmacist"])
        eng.add_shift("S2", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        result = eng.schedule()
        self.assertEqual(result["uncovered_shift_ids"], ["S1"])
        self.assertEqual(eng.assignments(), {"S2": "E1"})
        gap = eng.get_shift_gap("S1")
        self.assertEqual(gap["summary"], "no_employee_with_required_skills")
        self.assertEqual(gap["reasons"][0]["missing"], ["pharmacist"])
        self.assertIsNone(eng.get_shift_gap("S2"))


class TestFairness(unittest.TestCase):
    def test_hours_range_minimized(self):
        eng = make_engine()
        for i in range(4):
            eng.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.add_employee("E2", ["cashier"], full_week(), 40)
        eng.schedule()
        report = eng.fairness_report()
        self.assertEqual(report["global"]["hours_range"], 0.0)
        hours = {e["employee_id"]: e["hours"] for e in report["employees"]}
        self.assertEqual(hours, {"E1": 16.0, "E2": 16.0})

    def test_night_range_minimized(self):
        eng = make_engine()
        eng.add_shift("N1", "st1", dt(0, 22), dt(1, 6), ["cashier"])
        eng.add_shift("N2", "st1", dt(1, 22), dt(2, 6), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.add_employee("E2", ["cashier"], full_week(), 40)
        eng.schedule()
        report = eng.fairness_report()
        self.assertEqual(report["global"]["night_shift_range"], 0)
        nights = {e["employee_id"]: e["night_shifts"] for e in report["employees"]}
        self.assertEqual(nights, {"E1": 1, "E2": 1})

    def test_coverage_beats_fairness(self):
        # E2 上限 8h，三个 8h 班次必须 E1 承担两个才能全覆盖
        eng = make_engine()
        for i in range(3):
            eng.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 24)
        eng.add_employee("E2", ["cashier"], full_week(), 8)
        result = eng.schedule()
        self.assertEqual(result["uncovered_shifts"], 0)
        self.assertEqual(eng.assignments(), {"S0": "E1", "S1": "E1", "S2": "E2"})
        report = eng.fairness_report()
        self.assertEqual(report["global"]["hours_range"], 8.0)

    def test_tie_break_by_employee_id(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("emp_b", ["cashier"], full_week(), 40)
        eng.add_employee("emp_a", ["cashier"], full_week(), 40)
        eng.schedule()
        self.assertEqual(eng.assignments(), {"S1": "emp_a"})

    def test_deterministic_across_runs(self):
        def build():
            eng = make_engine()
            for i in range(5):
                eng.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
            for eid in ("E1", "E2", "E3"):
                eng.add_employee(eid, ["cashier"], full_week(), 40)
            eng.schedule()
            return eng.assignments()

        self.assertEqual(build(), build())

    def test_fairness_report_deviations(self):
        eng = make_engine()
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.add_employee("E2", ["cashier"], full_week(), 40)
        eng.schedule()
        report = eng.fairness_report()
        devs = {e["employee_id"]: e["hours_deviation"] for e in report["employees"]}
        self.assertEqual(devs, {"E1": 4.0, "E2": -4.0})
        self.assertEqual(report["global"]["mean_hours"], 4.0)


class TestEventsAndReschedule(unittest.TestCase):
    def _build(self, e1_availability=None):
        eng = make_engine()
        for i in range(3):
            eng.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], e1_availability or full_week(), 40)
        eng.add_employee("E2", ["cashier"], full_week(), 40)
        eng.schedule()
        return eng

    def test_leave_reschedule_equals_full_reschedule(self):
        eng = self._build()
        before = eng.assignments()
        self.assertEqual(before, {"S0": "E1", "S1": "E1", "S2": "E2"})
        info = eng.employee_leave("E1", dt(0, 0), dt(2, 0))
        # 参照：从头就按请假后的可用时段排班
        ref = self._build(e1_availability=[TimeWindow(dt(2, 0), dt(7, 0))])
        self.assertEqual(eng.assignments(), ref.assignments())
        # 公平性会把 S2 分给还有余力的 E1，S0/S1 由 E2 承接
        self.assertEqual(eng.assignments(), {"S0": "E2", "S1": "E2", "S2": "E1"})
        self.assertEqual(sorted(info["changed_shifts"]), ["S0", "S1", "S2"])

    def test_availability_change_reschedule_equals_full(self):
        eng = self._build()
        eng.update_availability("E2", [TimeWindow(dt(0, 0), dt(2, 0))])
        ref = make_engine()
        for i in range(3):
            ref.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
        ref.add_employee("E1", ["cashier"], full_week(), 40)
        ref.add_employee("E2", ["cashier"], [TimeWindow(dt(0, 0), dt(2, 0))], 40)
        ref.schedule()
        self.assertEqual(eng.assignments(), ref.assignments())

    def test_clock_advances_and_events_are_ordered(self):
        eng = self._build()
        eng.advance_time(timedelta(hours=3))
        eng.employee_leave("E1", dt(0, 0), dt(1, 0))
        self.assertEqual(eng.now(), dt(0, 3))
        self.assertEqual(len(eng.events), 1)
        # 时钟回退后的事件被拒绝
        eng.clock.set(dt(0, 0))
        with self.assertRaises(ScheduleError):
            eng.employee_leave("E2", dt(0, 0), dt(1, 0))


class TestQueries(unittest.TestCase):
    def test_store_and_employee_queries_stable_order(self):
        eng = make_engine()
        eng.add_store("st2", "二号店")
        eng.add_shift("S2", "st1", dt(1, 8), dt(1, 16), ["cashier"])
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["cashier"])
        eng.add_shift("S3", "st2", dt(2, 8), dt(2, 16), ["cashier"])
        eng.add_employee("E1", ["cashier"], full_week(), 40)
        eng.schedule()
        rows = eng.get_store_schedule("st1")
        self.assertEqual([r["shift_id"] for r in rows], ["S1", "S2"])  # 按开始时刻排序
        self.assertEqual(rows[0]["employee_id"], "E1")
        emp = eng.get_employee_schedule("E1")
        self.assertEqual(emp["total_hours"], 24.0)
        self.assertEqual([s["shift_id"] for s in emp["shifts"]], ["S1", "S2", "S3"])
        with self.assertRaises(NotFoundError):
            eng.get_store_schedule("nope")
        with self.assertRaises(NotFoundError):
            eng.get_employee_schedule("nope")
        with self.assertRaises(NotFoundError):
            eng.get_shift_gap("nope")


if __name__ == "__main__":
    unittest.main()
