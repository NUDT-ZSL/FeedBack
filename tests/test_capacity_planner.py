import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

from capacity_planner import CapacityPlanner, ForecastWindow, Record, ScaleAction
from capacity_planner.cli import main
from capacity_planner.io import records_from_csv_text, records_from_json_text


class CapacityPlannerTests(unittest.TestCase):
    def setUp(self):
        self.t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def hour(self, h):
        return self.t0 + timedelta(hours=h)

    def make_planner(self, rows=3, quota=100, resource="r1"):
        planner = CapacityPlanner()
        planner.add_records([
            Record(resource, self.hour(i), 10.0 + i, quota, None, "%s-%d" % (resource, i), i)
            for i in range(rows)
        ])
        return planner

    def test_import_identifies_resource_and_linear_trend(self):
        planner = self.make_planner()
        window = ForecastWindow.horizon(self.hour(3), 2, timedelta(hours=1))
        analysis = planner.analyze("r1", window)
        self.assertAlmostEqual(analysis.trend.slope_per_hour, 1.0)
        self.assertEqual([p.expected for p in analysis.forecast], [13.0, 14.0])
        self.assertFalse(analysis.observations[0].has_earlier_observation)
        self.assertTrue(analysis.observations[1].has_earlier_observation)
        self.assertEqual(analysis.recommendation.status, "ok")

    def test_json_and_csv_import_accept_aliases(self):
        payload = json.dumps({"records": [
            {"resource": "cpu", "timestamp": "2026-01-01T00:00:00Z", "used": 1, "limit": 10},
        ]})
        csv_text = "resource,timestamp,usage,quota\nmem,2026-01-01T00:00:00Z,2,20\n"
        records = records_from_json_text(payload) + records_from_csv_text(csv_text)
        self.assertEqual([r.resource_id for r in records], ["cpu", "mem"])

    def test_conflicting_duplicate_usage_is_retained_not_silently_chosen(self):
        planner = self.make_planner()
        planner.add_record(Record("r1", self.hour(1), 99.0, 100, None, "conflict", 3))
        analysis = planner.analyze("r1")
        self.assertEqual(len(analysis.observations), 4)
        types = {c.conflict_type for c in analysis.conflicts}
        self.assertIn("duplicate_timestamp_usage", types)
        self.assertIn("out_of_order", types)
        self.assertTrue(analysis.trend.uses_conflicting_values)
        conflicting = next(o for o in analysis.observations if o.record_id == "conflict")
        self.assertEqual(conflicting.conflicts_with, ("r1-1",))
        self.assertTrue(conflicting.out_of_order)

    def test_forecast_gap_and_expansion_recommendation(self):
        planner = self.make_planner(rows=3, quota=11)
        window = ForecastWindow.horizon(self.hour(3), 2, timedelta(hours=1))
        analysis = planner.analyze("r1", window)
        self.assertEqual(analysis.recommendation.status, "expand")
        self.assertEqual(analysis.recommendation.first_exceeds_at, self.hour(3))
        self.assertGreaterEqual(analysis.recommendation.target_quota,
                                analysis.recommendation.evidence_usage.high)
        self.assertEqual(
            analysis.recommendation.target_quota,
            analysis.recommendation.evidence_usage.high,
        )

    def test_scale_action_starts_new_trend_segment(self):
        planner = self.make_planner(rows=4)
        planner.add_record(Record("r1", self.hour(3), 13, 200,
                                  ScaleAction("expand", 100, 200), "expand", 4))
        planner.add_records([
            Record("r1", self.hour(4), 14, 200, None, "after-1", 5),
            Record("r1", self.hour(5), 15, 200, None, "after-2", 6),
        ])
        analysis = planner.analyze("r1")
        self.assertEqual(analysis.trend.source, "observations_after_latest_action")
        self.assertEqual(analysis.trend.source_record_count, 2)
        self.assertEqual(analysis.trend.source_group_count, 2)

    def test_correction_incremental_result_equals_full_recompute(self):
        planner = self.make_planner(resource="a")
        planner.add_records([
            Record("b", self.hour(i), 50 + i, 100, None, "b-%d" % i, 10 + i)
            for i in range(3)
        ])
        window = ForecastWindow.horizon(self.hour(3), 4, timedelta(hours=1))
        cached_b = planner.analyze("b", window)
        cached_a = planner.analyze("a", window)
        planner.correct_record("a-1", {"usage": 50.0})
        self.assertEqual(planner.analyze("b", window), cached_b)
        self.assertNotEqual(planner.analyze("a", window), cached_a)

        fresh = CapacityPlanner()
        fresh.add_records([planner.get_record(i) for i in planner.record_ids()])
        self.assertEqual(fresh.analyze("a", window), planner.analyze("a", window))

    def test_record_identity_is_immutable_when_correcting(self):
        planner = self.make_planner()
        with self.assertRaises(ValueError):
            planner.correct_record("r1-1", {"record_id": "changed"})

    def test_quota_conflict_is_reported_with_scaled_recommendation(self):
        planner = self.make_planner(rows=3, quota=11)
        planner.add_record(Record("r1", self.hour(2), 12, 50, None, "quota-conflict", 3))
        analysis = planner.analyze("r1", ForecastWindow.horizon(self.hour(3), 1, timedelta(hours=1)))
        self.assertTrue(analysis.has_quota_conflict)
        self.assertEqual(analysis.recommendation.status, "conflict_review")
        self.assertIn("conflicting effective quota", analysis.recommendation.rationale[-1])

    def test_window_change_invalidates_only_changed_resource(self):
        planner = self.make_planner(resource="a")
        planner.add_records([
            Record("b", self.hour(i), 50 + i, 100, None, "b-%d" % i, 10 + i)
            for i in range(3)
        ])
        short = ForecastWindow.horizon(self.hour(3), 1, timedelta(hours=1))
        long = ForecastWindow.horizon(self.hour(3), 2, timedelta(hours=1))
        cached_a = planner.analyze("a", short)
        cached_b = planner.analyze("b", short)
        planner.set_forecast_window("a", long)
        self.assertEqual(planner.analyze("b", short), cached_b)
        self.assertEqual(len(planner.analyze("a").forecast), 2)
        self.assertNotEqual(planner.analyze("a"), cached_a)

    def test_exact_duplicate_is_not_a_conflict_but_is_retained(self):
        planner = self.make_planner()
        original = planner.get_record("r1-1")
        planner.add_record(Record(
            original.resource_id, original.observed_at, original.usage,
            original.quota, None, "exact-duplicate", 3
        ))
        analysis = planner.analyze("r1")
        self.assertEqual(len(analysis.observations), 4)
        duplicate = next(o for o in analysis.observations if o.record_id == "exact-duplicate")
        self.assertTrue(duplicate.repeated_timestamp)
        self.assertTrue(any(c.conflict_type == "out_of_order" for c in analysis.conflicts))
        self.assertTrue(any(c.conflict_type == "duplicate_timestamp" for c in analysis.conflicts))
        self.assertFalse(any(c.conflict_type in (
            "duplicate_timestamp_usage", "duplicate_timestamp_quota", "duplicate_timestamp_action"
        ) for c in analysis.conflicts))


class CliTests(unittest.TestCase):
    def test_cli_json_output(self):
        payload = json.dumps({"records": [
            {"resource_id": "a", "observed_at": "2026-01-01T00:00:00Z", "usage": 1, "quota": 10},
            {"resource_id": "a", "observed_at": "2026-01-01T01:00:00Z", "usage": 2, "quota": 10},
        ]})
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(payload)
            output = io.StringIO()
            with redirect_stdout(output):
                main([path, "--horizon", "2h", "--step", "1h"])
            self.assertIn("a", json.loads(output.getvalue()))
        finally:
            os.remove(path)
