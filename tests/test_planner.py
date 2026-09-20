from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from capacity_planner.forecast import forecast_resource
from capacity_planner.io import parse_csv, parse_json
from capacity_planner.models import Action, ActionType, PredictionWindow, Record
from capacity_planner.planner import CapacityPlanner
from capacity_planner.series import build_series


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def record(record_id: str, resource: str, time: str, usage: float, quota: float, action=None):
    return Record(record_id, resource, ts(time), usage, quota, action)


class PlannerTests(unittest.TestCase):
    def test_retains_duplicate_and_marks_conflict_without_choosing_value(self):
        records = [
            record("a1", "a", "2026-09-01T00:00:00Z", 10, 100),
            record("a2", "a", "2026-09-01T00:00:00Z", 20, 100),
            record("a3", "a", "2026-09-02T00:00:00Z", 30, 100),
        ]
        series = build_series("a", records)
        self.assertEqual(len(series.records), 3)
        self.assertEqual(series.conflicts[0].record_ids, ["a1", "a2"])
        self.assertEqual(series.conflicts[0].usage_values, {"a1": 10.0, "a2": 20.0})
        self.assertEqual(series.conflicts[0].conflicting_fields, ["usage"])
        self.assertEqual(series.conflicts[0].severity, "contradiction")

    def test_exact_duplicate_is_retained_and_flagged_as_duplicate(self):
        records = [
            record("a1", "a", "2026-09-01T00:00:00Z", 10, 100),
            record("a2", "a", "2026-09-01T00:00:00Z", 10, 100),
        ]
        series = build_series("a", records)
        self.assertEqual(len(series.records), 2)
        self.assertEqual(series.conflicts[0].conflicting_fields, [])
        self.assertEqual(series.conflicts[0].severity, "duplicate")

    def test_uneven_window_includes_regular_points_and_exact_horizon(self):
        window = PredictionWindow(timedelta(hours=5), timedelta(hours=2))
        points = window.points_from(ts("2026-09-01T00:00:00Z"))
        self.assertEqual(points, [
            ts("2026-09-01T02:00:00Z"),
            ts("2026-09-01T04:00:00Z"),
            ts("2026-09-01T05:00:00Z"),
        ])

    def test_forecast_intervals_always_contain_expected_value(self):
        planner = CapacityPlanner(PredictionWindow(timedelta(days=1), timedelta(days=1)))
        planner.add_records([
            record("a1", "a", "2026-09-01T00:00:00Z", 0, 100),
            record("a2", "a", "2026-09-02T00:00:00Z", 0, 100),
            record("a3", "a", "2026-09-03T00:00:00Z", 0, 100),
        ])
        point = planner.get_forecast("a").points[0]
        self.assertLessEqual(point.usage_low, point.expected_usage)
        self.assertLessEqual(point.expected_usage, point.usage_high)

    def test_marks_out_of_order_ingestion_and_predicts_gap_and_expansion(self):
        planner = CapacityPlanner(PredictionWindow(timedelta(days=8), timedelta(days=1)))
        planner.add_records([
            record("a1", "a", "2026-09-01T00:00:00Z", 10, 100),
            record("a3", "a", "2026-09-03T00:00:00Z", 30, 100),
            record("a2", "a", "2026-09-02T00:00:00Z", 20, 100),
        ])
        analysis = planner.analyze().resources[0]
        self.assertEqual(analysis.series.out_of_order_record_ids, ("a2",))
        self.assertTrue(analysis.forecast.has_out_of_order_records)
        # Linear fit is 10 units/day; after 8 days it exceeds the quota.
        self.assertEqual(len(analysis.forecast.points), 8)
        self.assertAlmostEqual(analysis.forecast.points[7].expected_usage, 110)
        self.assertEqual(analysis.forecast.recommendation.status, "expand_recommended")
        self.assertEqual(analysis.forecast.recommendation.recommended_action, "expand")
        self.assertEqual(analysis.forecast.recommendation.required_additional_capacity, 10)
        self.assertEqual(analysis.forecast.recommendation.recommended_quota, 110)
        self.assertIn("retained observations", analysis.forecast.recommendation.trend_source)

    def test_conflicting_quota_uses_conservative_low_value_and_envelope(self):
        records = [
            record("a1", "a", "2026-09-01T00:00:00Z", 98, 100),
            record("a2", "a", "2026-09-01T00:00:00Z", 102, 120),
        ]
        planner = CapacityPlanner(PredictionWindow(timedelta(days=1), timedelta(days=1)))
        planner.add_records(records)
        forecast = planner.get_forecast("a")
        self.assertEqual(forecast.quota, 100)
        self.assertEqual(forecast.quota_low, 100)
        self.assertEqual(forecast.quota_high, 120)
        self.assertEqual(forecast.recommendation.status, "at_risk")

    def test_current_overload_requires_expansion_without_requiring_future_growth(self):
        planner = CapacityPlanner(PredictionWindow(timedelta(days=1), timedelta(days=1)))
        planner.add_records([
            record("a1", "a", "2026-09-01T00:00:00Z", 105, 100),
            record("a2", "a", "2026-09-02T00:00:00Z", 105, 100),
        ])
        recommendation = planner.get_forecast("a").recommendation
        self.assertEqual(recommendation.status, "expand_recommended")
        self.assertEqual(recommendation.required_additional_capacity, 5)
        self.assertEqual(recommendation.first_breach_at, ts("2026-09-02T00:00:00Z"))

    def test_incremental_correction_matches_full_recomputation(self):
        source = [
            record("a1", "a", "2026-09-01T00:00:00Z", 10, 100),
            record("a2", "a", "2026-09-02T00:00:00Z", 20, 100),
            record("b1", "b", "2026-09-01T00:00:00Z", 5, 50),
            record("b2", "b", "2026-09-02T00:00:00Z", 6, 50),
        ]
        window = PredictionWindow(timedelta(days=2), timedelta(days=1))
        incremental = CapacityPlanner(window)
        incremental.add_records(source)
        before = incremental.analyze().to_dict()
        incremental.correct_record("a2", usage=24)

        full = CapacityPlanner(window)
        full.add_records([
            source[0], record("a2", "a", "2026-09-02T00:00:00Z", 24, 100),
            source[2], source[3],
        ])
        full_report = full.analyze(generated_at=ts("2026-09-03T00:00:00Z")).to_dict()
        incremental_report = incremental.analyze(generated_at=ts("2026-09-03T00:00:00Z")).to_dict()
        self.assertEqual(incremental_report, full_report)
        self.assertNotEqual(before["resources"][0], incremental_report["resources"][0])
        self.assertEqual(before["resources"][1], incremental_report["resources"][1])

    def test_window_change_only_invalidates_requested_resource_and_caches_trend(self):
        planner = CapacityPlanner(PredictionWindow(timedelta(days=1), timedelta(days=1)))
        planner.add_records([
            record("a1", "a", "2026-09-01T00:00:00Z", 10, 100),
            record("a2", "a", "2026-09-02T00:00:00Z", 20, 100),
        ])
        trend = planner.get_trend("a")
        planner.set_window("a", PredictionWindow(timedelta(days=2), timedelta(days=1)))
        self.assertIs(planner.get_trend("a"), trend)
        self.assertEqual(len(planner.get_forecast("a").points), 2)

    def test_actions_and_csv_json_loading(self):
        csv_records = parse_csv(
            "record_id,resource_id,timestamp,usage,quota,action_type,action_amount,action_unit,action_note\n"
            "x1,x,2026-09-01T00:00:00Z,1,10,扩容,4,,add nodes\n"
        )
        self.assertEqual(csv_records[0].action.type, ActionType.EXPAND)
        json_records = parse_json('{"records":[{"resource_id":"y","timestamp":"2026-09-01T00:00:00Z","usage":1,"quota":10}]}')
        self.assertEqual(json_records[0].record_id, "json-1")


if __name__ == "__main__":
    unittest.main()
