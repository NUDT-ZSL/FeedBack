import unittest

from dataio import load_sample
from scheduler import schedule


class SchedulerTests(unittest.TestCase):
    def test_sample_is_feasible_and_bills_energy(self):
        result = schedule(load_sample())
        self.assertTrue(result["feasible"], result["conflicts"])
        self.assertGreater(result["metrics"]["energy_kwh"], 0)
        self.assertGreater(result["metrics"]["total_cost"], 0)
        self.assertTrue(all(task["on_time"] for task in result["tasks"]))
        self.assertTrue(any(segment["kind"] == "transition" for segment in result["segments"]))

    def test_maintenance_forces_transfer_without_breaking_dependency(self):
        payload = load_sample()
        cnc1 = next(row for row in payload["devices"] if row["id"] == "CNC-01")
        # Only T1 is eligible for CNC machines; blocking CNC-01 forces the
        # whole first operation onto CNC-02. The narrow sample is designed to
        # remain deliverable before the dependent task starts.
        cnc1["maintenance_window"] = "06:00-18:00"
        t1 = next(row for row in payload["tasks"] if row["id"] == "T1")
        t1["quantity"] = 120
        t1["deadline"] = 168
        result = schedule(payload)
        scheduled_t1 = next(task for task in result["tasks"] if task["task_id"] == "T1")
        self.assertTrue(scheduled_t1["on_time"], result["conflicts"])
        cnc1_production = [s for s in result["segments"] if s["device_id"] == "CNC-01" and s["kind"] == "production"]
        self.assertEqual(cnc1_production, [])

    def test_bad_manual_edit_keeps_feasible_alternative(self):
        payload = load_sample()
        payload["overrides"] = [{
            "device_id": "CNC-02",
            "task_id": "T1",
            "mode": "LOW",
            "start": 132,
            "end": 150,
        }]
        result = schedule(payload)
        self.assertFalse(result["feasible"])
        self.assertTrue(result["alternative"]["feasible"])
        messages = " ".join(item["message"] for item in result["conflicts"])
        self.assertIn("T1", messages)
        self.assertIn("CNC-02", messages)


if __name__ == "__main__":
    unittest.main()
