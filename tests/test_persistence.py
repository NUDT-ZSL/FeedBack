"""持久化测试：JSON 导出/载入、载入校验、失败状态不变。"""
import json
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

from scheduler import (
    ManualClock,
    SchedulingEngine,
    TimeWindow,
    ValidationError,
    load_engine,
)

BASE = datetime(2026, 9, 14)


def dt(day, hour):
    return BASE + timedelta(days=day, hours=hour)


def build_engine():
    eng = SchedulingEngine(clock=ManualClock(dt(0, 0)))
    eng.add_store("st1", "一号店")
    eng.add_store("st2", "二号店")
    for i in range(3):
        eng.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
    eng.add_shift("N1", "st2", dt(0, 22), dt(1, 6), ["cashier"])
    eng.add_employee("E1", ["cashier"], [TimeWindow(dt(0, 0), dt(7, 0))], 40)
    eng.add_employee("E2", ["cashier"], [TimeWindow(dt(0, 0), dt(7, 0))], 40)
    eng.schedule()
    return eng


class TestRoundTrip(unittest.TestCase):
    def test_save_load_roundtrip(self):
        eng = build_engine()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schedule.json"
            eng.save(path)
            loaded = load_engine(path, clock=ManualClock(dt(0, 0)))
        self.assertEqual(loaded.assignments(), eng.assignments())
        self.assertEqual(loaded.fairness_report(), eng.fairness_report())
        self.assertEqual(loaded.summary(), eng.summary())
        self.assertEqual(set(loaded.stores), set(eng.stores))
        self.assertEqual(set(loaded.shifts), set(eng.shifts))
        self.assertEqual(set(loaded.employees), set(eng.employees))
        # 载入后仍可继续重排，结果与从头排一致
        loaded.employee_leave("E1", dt(0, 0), dt(2, 0))
        ref = SchedulingEngine(clock=ManualClock(dt(0, 0)))
        ref.add_store("st1", "一号店")
        ref.add_store("st2", "二号店")
        for i in range(3):
            ref.add_shift(f"S{i}", "st1", dt(i, 8), dt(i, 16), ["cashier"])
        ref.add_shift("N1", "st2", dt(0, 22), dt(1, 6), ["cashier"])
        ref.add_employee("E1", ["cashier"], [TimeWindow(dt(2, 0), dt(7, 0))], 40)
        ref.add_employee("E2", ["cashier"], [TimeWindow(dt(0, 0), dt(7, 0))], 40)
        ref.schedule()
        self.assertEqual(loaded.assignments(), ref.assignments())

    def test_saved_file_contains_fairness(self):
        eng = build_engine()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "schedule.json"
            eng.save(path)
            data = json.loads(path.read_text(encoding="utf-8"))
        self.assertIn("fairness", data)
        self.assertEqual(data["fairness"]["global"]["covered_shifts"], 4)
        self.assertEqual(data["config"]["min_rest_minutes"], 480)


class TestLoadValidation(unittest.TestCase):
    def _write(self, tmp, data):
        path = Path(tmp) / "data.json"
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return path

    def _base_data(self):
        return {
            "version": 1,
            "config": {"min_rest_minutes": 480, "night_start": "22:00", "night_end": "06:00"},
            "skills": ["cashier"],
            "stores": [{"id": "st1", "name": "一号店"}],
            "shifts": [
                {"id": "S1", "store_id": "st1", "start": "2026-09-14T08:00:00",
                 "end": "2026-09-14T16:00:00", "required_skills": ["cashier"]},
            ],
            "employees": [
                {"id": "E1", "skills": ["cashier"],
                 "availability": [{"start": "2026-09-14T00:00:00", "end": "2026-09-21T00:00:00"}],
                 "max_hours": 40},
            ],
            "assignments": [{"shift_id": "S1", "employee_id": "E1"}],
        }

    def test_corrupted_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(ValidationError) as cm:
                load_engine(path)
            self.assertIn("JSON", str(cm.exception))

    def test_missing_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            del data["employees"][0]["max_hours"]
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("max_hours", str(cm.exception))

    def test_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["stores"].append({"id": "st1", "name": "重复"})
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("重复", str(cm.exception))

    def test_unknown_skill_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["shifts"][0]["required_skills"] = ["wizard"]
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("wizard", str(cm.exception))

    def test_unknown_store_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["shifts"][0]["store_id"] = "nope"
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("nope", str(cm.exception))

    def test_invalid_shift_window(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["shifts"][0]["end"] = "2026-09-14T06:00:00"
            with self.assertRaises(ValidationError):
                load_engine(self._write(tmp, data))

    def test_overlapping_assignment_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["shifts"].append(
                {"id": "S2", "store_id": "st1", "start": "2026-09-14T10:00:00",
                 "end": "2026-09-14T18:00:00", "required_skills": ["cashier"]}
            )
            data["assignments"].append({"shift_id": "S2", "employee_id": "E1"})
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("重叠", str(cm.exception))

    def test_rest_violation_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["shifts"].append(
                {"id": "S2", "store_id": "st1", "start": "2026-09-14T17:00:00",
                 "end": "2026-09-14T21:00:00", "required_skills": ["cashier"]}
            )
            data["assignments"].append({"shift_id": "S2", "employee_id": "E1"})
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("休息", str(cm.exception))

    def test_assignment_unknown_shift(self):
        with tempfile.TemporaryDirectory() as tmp:
            data = self._base_data()
            data["assignments"].append({"shift_id": "ghost", "employee_id": "E1"})
            with self.assertRaises(ValidationError) as cm:
                load_engine(self._write(tmp, data))
            self.assertIn("ghost", str(cm.exception))

    def test_failed_import_leaves_state_unchanged(self):
        eng = build_engine()
        before = eng.assignments()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{broken", encoding="utf-8")
            with self.assertRaises(ValidationError):
                eng.import_file(path)
            # 校验失败（如重复标识）同样不改变状态
            data = self._base_data()
            data["employees"].append(dict(data["employees"][0]))
            bad2 = self._write(tmp, data)
            with self.assertRaises(ValidationError):
                eng.import_file(bad2)
        self.assertEqual(eng.assignments(), before)
        self.assertEqual(set(eng.stores), {"st1", "st2"})

    def test_import_replaces_state_on_success(self):
        eng = build_engine()
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, self._base_data())
            eng.import_file(path)
        self.assertEqual(set(eng.stores), {"st1"})
        self.assertEqual(eng.assignments(), {"S1": "E1"})


if __name__ == "__main__":
    unittest.main()
