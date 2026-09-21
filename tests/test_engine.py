import copy
import time
import unittest

from latency_budget.engine import analyze_batch, analyze_request, load_json_file


SAMPLE = {
    "requests": [
        {"id": "sequential", "fragments": [
            {"stage": "a", "start": 0, "end": 10},
            {"stage": "b", "start": 10, "end": 30},
        ]},
        {"id": "overlap-gap", "fragments": [
            {"stage": "a", "start": 0, "end": 20},
            {"stage": "b", "start": 10, "end": 30},
            {"stage": "c", "start": 40, "end": 50},
        ]},
        {"id": "nested", "fragments": [
            {"stage": "outer", "start": 0, "end": 100},
            {"stage": "inner", "start": 10, "end": 20},
        ]},
        {"id": "inverted", "fragments": [{"stage": "a", "start": 9, "end": 2}]},
    ]
}


class EngineTests(unittest.TestCase):
    def test_sequential_attribution(self):
        result = analyze_request(SAMPLE["requests"][0], {"a": 8, "b": 30})
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["end_to_end_duration_ms"], 30)
        self.assertEqual(result["exclusive_duration_ms"], 30)
        self.assertEqual(result["idle_duration_ms"], 0)
        self.assertEqual(result["stage_attribution"]["a"]["exclusive_duration"], 10)
        self.assertEqual(result["stage_attribution"]["a"]["overrun_ms"], 2)
        self.assertEqual(result["budget_summary"]["overruns"][0]["stage"], "a")

    def test_overlap_is_counted_once_and_shared_equally(self):
        result = analyze_request(SAMPLE["requests"][1])
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["end_to_end_duration_ms"], 50)
        self.assertEqual(result["active_duration_ms"], 40)
        self.assertEqual(result["idle_duration_ms"], 10)
        self.assertEqual(result["exclusive_duration_ms"], 30)
        self.assertEqual(result["shared_wall_duration_ms"], 10)
        for stage in ("a", "b"):
            self.assertEqual(result["stage_attribution"][stage]["allocated_shared_duration"], 5)
            self.assertEqual(result["stage_attribution"][stage]["e2e_contribution_duration"], 15)
        total_contribution = sum(
            stat["e2e_contribution_duration"] for stat in result["stage_attribution"].values()
        )
        self.assertAlmostEqual(total_contribution + result["idle_duration_ms"], 50)

    def test_touching_intervals_are_not_shared(self):
        result = analyze_request({"id": "touch", "fragments": [
            {"stage": "a", "start": 0, "end": 10},
            {"stage": "b", "start": 10, "end": 20},
        ]})
        self.assertEqual(result["shared_wall_duration_ms"], 0)
        self.assertEqual(result["exclusive_duration_ms"], 20)

    def test_exact_overlap_is_common_occupancy_not_nesting(self):
        result = analyze_request({"id": "exact", "fragments": [
            {"stage": "a", "start": 0, "end": 10},
            {"stage": "b", "start": 0, "end": 10},
        ]})
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["shared_wall_duration_ms"], 10)

    def test_stale_short_interval_does_not_cause_false_nesting(self):
        result = analyze_request({"id": "stale", "fragments": [
            {"stage": "a", "start": 0, "end": 5},
            {"stage": "b", "start": 10, "end": 15},
            {"stage": "c", "start": 20, "end": 40},
        ]})
        self.assertEqual(result["status"], "valid")
        self.assertTrue(all(error["code"] != "NESTED_FRAGMENT" for error in result["errors"]))

    def test_nested_request_is_invalid_and_has_no_attribution(self):
        result = analyze_request(SAMPLE["requests"][2])
        self.assertEqual(result["status"], "invalid")
        self.assertTrue(any(item["code"] == "NESTED_FRAGMENT" for item in result["errors"]))
        self.assertNotIn("stage_attribution", result)
        self.assertNotIn("end_to_end_duration_ms", result)

    def test_time_inversion_is_invalid(self):
        result = analyze_request(SAMPLE["requests"][3])
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["errors"][0]["code"], "TIME_INVERSION")

    def test_iso_timestamps_are_supported(self):
        result = analyze_request({"id": "iso", "fragments": [
            {"stage": "a", "start": "2026-01-01T00:00:00Z", "end": "2026-01-01T00:00:00.020Z"},
            {"stage": "b", "start": "2026-01-01T00:00:00.010Z", "end": "2026-01-01T00:00:00.050Z"},
        ]})
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["end_to_end_duration_ms"], 50)

    def test_batch_shape_errors_are_reported(self):
        result = analyze_batch({"not_requests": []})
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["batch_errors"][0]["code"], "INVALID_BATCH")

    def test_empty_fragment_list_is_invalid(self):
        result = analyze_request({"id": "empty", "fragments": []})
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["errors"][0]["code"], "MISSING_FRAGMENTS")

    def test_same_stage_overlap_uses_union_and_warns(self):
        result = analyze_request({"id": "same", "fragments": [
            {"stage": "db", "start": 0, "end": 20},
            {"stage": "db", "start": 10, "end": 30},
        ]})
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["stage_attribution"]["db"]["actual_occupied_duration"], 30)
        self.assertEqual(result["stage_attribution"]["db"]["gross_fragment_duration"], 40)
        self.assertEqual(result["warnings"][0]["code"], "SAME_STAGE_OVERLAP")

    def test_repeated_analysis_is_input_deterministic_and_does_not_mutate(self):
        data = copy.deepcopy(SAMPLE)
        first = analyze_batch(data, {"a": 100, "b": 100, "c": 100})
        second = analyze_batch(copy.deepcopy(data), {"a": 1, "b": 100, "c": 100})
        third = analyze_batch(copy.deepcopy(data), {"a": 100, "b": 100, "c": 100})
        self.assertNotEqual(first["requests"][0]["stage_attribution"]["a"]["overrun_ms"],
                            second["requests"][0]["stage_attribution"]["a"]["overrun_ms"])
        self.assertEqual(first, third)
        self.assertEqual(data, SAMPLE)

    def test_sample_file_loads_and_flags_expected_records(self):
        sample = load_json_file("data/sample_requests.json")
        result = analyze_batch(sample, sample["default_budgets"], include_segments=True)
        statuses = {item["id"]: item["status"] for item in result["requests"]}
        self.assertEqual(statuses["req-sequential"], "valid")
        self.assertEqual(statuses["req-overlap-gap"], "valid")
        self.assertEqual(statuses["req-budget-overrun"], "valid")
        self.assertEqual(statuses["req-nested"], "invalid")
        self.assertEqual(statuses["req-inverted"], "invalid")
        self.assertEqual(statuses["req-same-stage-overlap"], "warning")
        overrun = next(item for item in result["requests"] if item["id"] == "req-budget-overrun")
        self.assertEqual(overrun["budget_summary"]["overruns"][0]["stage"], "database")

    def test_tens_of_thousands_scale(self):
        requests = []
        for i in range(30000):
            requests.append({"id": f"r{i}", "fragments": [
                {"stage": "a", "start": 0, "end": 10},
                {"stage": "b", "start": 8, "end": i % 20 + 10},
            ]})
        started = time.perf_counter()
        result = analyze_batch({"requests": requests}, {"a": 5, "b": 100})
        elapsed = time.perf_counter() - started
        self.assertEqual(result["request_count"], 30000)
        self.assertEqual(result["valid_count"] + result["warning_count"], 30000)
        self.assertLess(elapsed, 8.0)


if __name__ == "__main__":
    unittest.main()
