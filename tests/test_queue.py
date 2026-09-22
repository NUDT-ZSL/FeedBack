from __future__ import annotations

import unittest

from queueplanner.engine import QueueEngine
from queueplanner.loader import ManifestError, parse_manifest
from queueplanner.models import TaskStatus
from queueplanner.scheduler import schedule_manifest


def simple_manifest():
    return parse_manifest({
        "machines": [
            {"id": "M1", "availability": []},
            {"id": "M2", "availability": []},
        ],
        "materials": [
            {"id": "raw", "version": "v1"},
            {"id": "out_x", "version": "generated"},
            {"id": "out_y", "version": "generated"},
        ],
        "tasks": [
            {"id": "x", "name": "X", "duration": 2, "materials": ["raw"], "produces": "out_x", "machines": ["M1"]},
            {"id": "y", "name": "Y", "duration": 1, "machines": ["M2"]},
            {"id": "z", "name": "Z", "duration": 1, "materials": ["out_x"], "depends_on": ["y"], "machines": ["M2"]},
            {"id": "w", "name": "W", "duration": 1, "materials": ["out_x"], "machines": ["M1", "M2"]},
        ],
    })


class QueueTests(unittest.TestCase):
    def test_rejects_cycle(self):
        with self.assertRaises(ManifestError) as context:
            parse_manifest({
                "machines": [{"id": "M1"}],
                "materials": [{"id": "a"}, {"id": "b"}],
                "tasks": [
                    {"id": "t1", "duration": 1, "materials": ["a"], "produces": "b", "machines": ["M1"]},
                    {"id": "t2", "duration": 1, "materials": ["b"], "produces": "a", "machines": ["M1"]},
                ],
            })
        self.assertTrue(any(issue.code == "dependency.cycle" for issue in context.exception.issues))

    def test_failure_isolates_descendants_and_retry_restores_logical_order(self):
        engine = QueueEngine(simple_manifest())
        engine.run_until(1)
        self.assertEqual(engine.states["x"].status, TaskStatus.RUNNING)
        self.assertEqual(engine.states["y"].status, TaskStatus.RUNNING)
        engine.fail_task("x", "broken")
        self.assertEqual(engine.states["x"].status, TaskStatus.FAILED)
        self.assertEqual(engine.states["z"].status, TaskStatus.BLOCKED)
        self.assertEqual(engine.states["w"].status, TaskStatus.BLOCKED)
        engine.tick()
        self.assertEqual(engine.states["y"].status, TaskStatus.COMPLETED)
        engine.retry_task("x")
        while not engine.all_done():
            engine.tick()
        payload = engine.to_dict()
        self.assertTrue(payload["order_matches_baseline"])
        self.assertEqual(payload["baseline_logical_order"], payload["completed_logical_order"])

    def test_material_replacement_reports_closure_and_resets_selection(self):
        engine = QueueEngine(simple_manifest())
        while engine.states["x"].status != TaskStatus.COMPLETED:
            engine.tick()
        impact = engine.material_impact("raw", "v2")
        self.assertIn("x", impact["direct_consumers"])
        self.assertEqual(set(impact["affected_tasks"]), {"x", "z", "w"})
        engine.set_machine_paused("M1", True)
        result = engine.replace_material("raw", "v2", True, ["x"])
        self.assertEqual(set(result["rerun_tasks"]), {"x", "z", "w"})
        self.assertEqual(engine.states["x"].status, TaskStatus.WAITING)
        self.assertFalse(engine.states["x"].stale)

    def test_partial_material_rerun_requires_affected_ancestor(self):
        engine = QueueEngine(simple_manifest())
        engine.set_machine_paused("M1", True)
        with self.assertRaisesRegex(ValueError, "受影响上游"):
            engine.replace_material("raw", "v2", True, ["z"])

    def test_paused_machine_does_not_stop_unrelated_machine(self):
        engine = QueueEngine(simple_manifest())
        engine.set_machine_paused("M1", True)
        engine.run_until(2)
        self.assertEqual(engine.states["x"].status, TaskStatus.WAITING)
        self.assertEqual(engine.states["y"].status, TaskStatus.COMPLETED)

    def test_schedule_respects_windows(self):
        manifest = parse_manifest({
            "machines": [{"id": "M1", "availability": [{"start": "10:00", "end": "11:00"}]}],
            "materials": [{"id": "a"}],
            "tasks": [{"id": "t", "duration": 30, "materials": ["a"]}],
        })
        schedule = schedule_manifest(manifest)
        self.assertEqual(schedule.assignments["t"].start, 600)
        self.assertEqual(schedule.assignments["t"].end, 630)


if __name__ == "__main__":
    unittest.main()
