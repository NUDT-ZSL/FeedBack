"""回归测试：三条路径（局部重排/从头重排/导出载入）缺口原因一致；
非法请假时段被拒绝且状态不变。"""
import random
import tempfile
import unittest
from datetime import datetime, timedelta

from scheduler import (
    ManualClock,
    SchedulingEngine,
    TimeWindow,
    ValidationError,
)
from scheduler.models import subtract_window

BASE = datetime(2026, 9, 14)


def dt(day, hour):
    return BASE + timedelta(days=day, hours=hour)


class TestGapReasonConsistency(unittest.TestCase):
    def _build(self):
        eng = SchedulingEngine(clock=ManualClock(BASE))
        eng.add_store("st1")
        # 乱序添加；S1、S2 都与 S3 冲突，E1 承担 S1、S2
        eng.add_shift("S2", "st1", dt(0, 20), dt(1, 4), ["a"])
        eng.add_shift("S1", "st1", dt(0, 0), dt(0, 8), ["a"])
        eng.add_shift("S3", "st1", dt(0, 6), dt(0, 22), ["a"])
        eng.add_employee("E1", ["a"], [TimeWindow(dt(0, 0), dt(3, 0))], 40)
        eng.schedule()
        return eng

    def test_gap_reason_stable_across_save_load(self):
        eng = self._build()
        before = eng.get_shift_gap("S3")
        self.assertIsNotNone(before)
        with tempfile.TemporaryDirectory() as tmp:
            path = tmp + "/s.json"
            eng.save(path)
            loaded = SchedulingEngine.load(path)
        self.assertEqual(before, loaded.get_shift_gap("S3"))

    def test_gap_reason_stable_across_event_and_reload(self):
        eng = self._build()
        eng.add_employee("E2", ["a"], [TimeWindow(dt(0, 0), dt(3, 0))], 40)
        eng.schedule()
        eng.employee_leave("E2", dt(0, 0), dt(1, 0))
        with tempfile.TemporaryDirectory() as tmp:
            path = tmp + "/s.json"
            eng.save(path)
            loaded = SchedulingEngine.load(path)
        for sid in ("S1", "S2", "S3"):
            self.assertEqual(eng.get_shift_gap(sid), loaded.get_shift_gap(sid))


class TestInvalidLeaveRejected(unittest.TestCase):
    def _build(self):
        eng = SchedulingEngine(clock=ManualClock(BASE))
        eng.add_store("st1")
        eng.add_shift("S1", "st1", dt(0, 8), dt(0, 16), ["a"])
        eng.add_employee("E1", ["a"], [TimeWindow(dt(0, 0), dt(3, 0))], 40)
        eng.schedule()
        return eng

    def test_leave_end_not_after_start_rejected(self):
        eng = self._build()
        avail_before = list(eng.employees["E1"].availability)
        assignments_before = eng.assignments()
        fairness_before = eng.fairness_report()
        for bad_start, bad_end in [(dt(0, 10), dt(0, 8)), (dt(0, 10), dt(0, 10))]:
            with self.assertRaises(ValidationError) as cm:
                eng.employee_leave("E1", bad_start, bad_end)
            self.assertIn("请假", str(cm.exception))
        # 状态完全不变
        self.assertEqual(eng.employees["E1"].availability, avail_before)
        self.assertEqual(eng.assignments(), assignments_before)
        self.assertEqual(eng.fairness_report(), fairness_before)
        self.assertEqual(eng.get_shift_gap("S1"), None)
        self.assertEqual(len(eng.events), 0)

    def test_leave_non_datetime_rejected(self):
        eng = self._build()
        with self.assertRaises(ValidationError):
            eng.employee_leave("E1", "2026-09-14", "2026-09-15")
        self.assertEqual(len(eng.employees["E1"].availability), 1)

    def test_update_availability_rejects_non_window(self):
        eng = self._build()
        avail_before = list(eng.employees["E1"].availability)
        with self.assertRaises(ValidationError):
            eng.update_availability("E1", [(dt(0, 0), dt(1, 0))])
        self.assertEqual(eng.employees["E1"].availability, avail_before)

    def test_leave_then_not_assigned_to_covered_shifts(self):
        eng = self._build()
        eng.add_shift("S2", "st1", dt(1, 8), dt(1, 16), ["a"])
        eng.schedule()
        eng.employee_leave("E1", dt(0, 0), dt(2, 0))
        # 请假覆盖全部班次 -> 所有班次不得再排给 E1
        for row in eng.get_store_schedule("st1"):
            self.assertNotEqual(row["employee_id"], "E1")
        gaps = {sid: eng.get_shift_gap(sid) for sid in ("S1", "S2")}
        self.assertIsNotNone(gaps["S1"])
        self.assertEqual(gaps["S1"]["summary"], "no_available_employee")


class TestThreeWayConsistency(unittest.TestCase):
    """确定性压力回归：局部重排、从头重排、导出载入三方逐项一致。"""

    def _gen(self, seed):
        rng = random.Random(seed)
        skills = ["a", "b"]
        shifts = []
        for i in range(rng.randint(4, 8)):
            start_h = rng.choice([0, 6, 8, 14, 20, 22]) + rng.choice([0, 24, 48])
            shifts.append((f"S{i}", "st1", BASE + timedelta(hours=start_h),
                           BASE + timedelta(hours=start_h + rng.choice([4, 8])),
                           [rng.choice(skills)]))
        rng.shuffle(shifts)
        employees = []
        for j in range(rng.randint(2, 4)):
            eskills = [s for s in skills if rng.random() < 0.8] or ["a"]
            employees.append((f"E{j}", eskills,
                              [TimeWindow(BASE, BASE + timedelta(hours=96))],
                              rng.choice([12, 20, 40])))
        events = []
        eids = [e[0] for e in employees]
        for _ in range(rng.randint(1, 2)):
            eid = rng.choice(eids)
            if rng.random() < 0.5:
                s = rng.choice([8, 20, 30])
                events.append(("leave", eid,
                               BASE + timedelta(hours=s),
                               BASE + timedelta(hours=s + rng.choice([6, 18]))))
            else:
                events.append(("avail", eid,
                               [TimeWindow(BASE + timedelta(hours=rng.choice([0, 12])),
                                           BASE + timedelta(hours=rng.choice([60, 96])))]))
        return shifts, employees, events

    def _build_event_driven(self, shifts, employees, events):
        eng = SchedulingEngine(clock=ManualClock(BASE))
        eng.add_store("st1")
        for sid, st, s, e, req in shifts:
            eng.add_shift(sid, st, s, e, req)
        for eid, eskills, avail, maxh in employees:
            eng.add_employee(eid, eskills, avail, maxh)
        eng.schedule()
        for ev in events:
            if ev[0] == "leave":
                eng.employee_leave(ev[1], ev[2], ev[3])
            else:
                eng.update_availability(ev[1], ev[2])
        return eng

    def _build_from_scratch(self, shifts, employees, events):
        avail_map = {e[0]: list(e[2]) for e in employees}
        for ev in events:
            if ev[0] == "leave":
                avail_map[ev[1]] = subtract_window(avail_map[ev[1]], ev[2], ev[3])
            else:
                avail_map[ev[1]] = list(ev[2])
        eng = SchedulingEngine(clock=ManualClock(BASE))
        eng.add_store("st1")
        for sid, st, s, e, req in shifts:
            eng.add_shift(sid, st, s, e, req)
        for eid, eskills, _, maxh in employees:
            eng.add_employee(eid, eskills, avail_map[eid], maxh)
        eng.schedule()
        return eng

    def _observable(self, eng):
        return {
            "assignments": eng.assignments(),
            "store": eng.get_store_schedule("st1"),
            "employees": {eid: eng.get_employee_schedule(eid) for eid in sorted(eng.employees)},
            "gaps": {sid: eng.get_shift_gap(sid) for sid in sorted(eng.shifts)},
            "fairness": eng.fairness_report(),
        }

    def test_local_full_reload_consistent(self):
        for seed in range(60):
            shifts, employees, events = self._gen(seed)
            eng = self._build_event_driven(shifts, employees, events)
            ref = self._build_from_scratch(shifts, employees, events)
            with tempfile.TemporaryDirectory() as tmp:
                path = tmp + "/s.json"
                eng.save(path)
                loaded = SchedulingEngine.load(path)
            base = self._observable(eng)
            with self.subTest(seed=seed, path="from_scratch"):
                self.assertEqual(base, self._observable(ref))
            with self.subTest(seed=seed, path="save_load"):
                self.assertEqual(base, self._observable(loaded))


if __name__ == "__main__":
    unittest.main()
