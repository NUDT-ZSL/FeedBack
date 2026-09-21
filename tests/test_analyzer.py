import unittest

from latency_budget.analyzer import AnalysisError, analyze_batch, analyze_request


class AnalyzerTests(unittest.TestCase):
    def stage(self, result, name):
        return next(item for item in result["stages"] if item["stage"] == name)

    def test_sequential_segments_reconcile_to_end_to_end(self):
        result = analyze_request(
            {
                "id": "a",
                "segments": [
                    {"id": "1", "name": "one", "start_ms": 0, "end_ms": 10},
                    {"id": "2", "name": "two", "start_ms": 10, "end_ms": 30},
                ],
            },
            {"one": 8, "two": 100},
        )
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["end_to_end_ms"], 30)
        self.assertEqual(result["attributed_ms"], 30)
        self.assertEqual(self.stage(result, "one")["allocated_ms"], 10)
        self.assertEqual(self.stage(result, "one")["overage_ms"], 2)
        self.assertEqual(self.stage(result, "one")["e2e_overrun_contribution_ms"], 2)

    def test_partial_overlap_is_split_and_gap_is_unattributed(self):
        result = analyze_request(
            {
                "id": "b",
                "segments": [
                    {"id": "1", "name": "a", "start_ms": 0, "end_ms": 20},
                    {"id": "2", "name": "b", "start_ms": 10, "end_ms": 30},
                    {"id": "3", "name": "c", "start_ms": 40, "end_ms": 50},
                ],
            },
            {"a": 100, "b": 5, "c": 100},
        )
        self.assertEqual(result["end_to_end_ms"], 50)
        self.assertAlmostEqual(result["attributed_ms"], 40)
        self.assertEqual(result["unattributed_gap_ms"], 10)
        self.assertEqual(self.stage(result, "a")["exclusive_ms"], 10)
        self.assertEqual(self.stage(result, "a")["shared_wall_ms"], 10)
        self.assertAlmostEqual(self.stage(result, "a")["allocated_ms"], 15)
        self.assertAlmostEqual(self.stage(result, "b")["allocated_ms"], 15)
        overrun = self.stage(result, "b")
        # b uses 10 exclusive units of its 5-unit budget, then 10 of the 15
        # overrun units are exclusive and five are shared at 50%.
        self.assertEqual(overrun["overage_ms"], 15)
        self.assertAlmostEqual(overrun["e2e_overrun_contribution_ms"], 12.5)
        self.assertAlmostEqual(overrun["overrun_hidden_by_overlap_ms"], 2.5)

    def test_nested_segments_are_invalid_without_attribution(self):
        result = analyze_request(
            {
                "id": "c",
                "segments": [
                    {"id": "outer", "name": "a", "start_ms": 0, "end_ms": 100},
                    {"id": "inner", "name": "b", "start_ms": 10, "end_ms": 20},
                ],
            }
        )
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["stages"], [])
        self.assertEqual(result["end_to_end_ms"], None)
        self.assertIn("nested_segment", [item["code"] for item in result["anomalies"]])
        self.assertEqual(result["input_segments"][1]["id"], "inner")

    def test_time_inversion_is_invalid(self):
        result = analyze_request(
            {
                "id": "d",
                "segments": [{"id": "bad", "name": "a", "start_ms": 30, "end_ms": 10}],
            }
        )
        self.assertEqual(result["status"], "invalid")
        self.assertIn("time_inversion", [item["code"] for item in result["anomalies"]])

    def test_zero_duration_is_warning_but_remains_attributable(self):
        result = analyze_request(
            {
                "id": "e",
                "segments": [
                    {"id": "1", "name": "a", "start_ms": 0, "end_ms": 10},
                    {"id": "2", "name": "marker", "start_ms": 10, "end_ms": 10},
                ],
            }
        )
        self.assertEqual(result["status"], "warning")
        self.assertEqual(result["end_to_end_ms"], 10)
        self.assertEqual(self.stage(result, "marker")["gross_duration_ms"], 0)

    def test_zero_duration_inside_interval_is_nested(self):
        result = analyze_request(
            {
                "id": "point-nested",
                "segments": [
                    {"id": "outer", "name": "a", "start_ms": 0, "end_ms": 20},
                    {"id": "point", "name": "marker", "start_ms": 10, "end_ms": 10},
                ],
            }
        )
        self.assertEqual(result["status"], "invalid")
        self.assertIn("nested_point", [item["code"] for item in result["anomalies"]])

    def test_repeated_analysis_is_stateless(self):
        record = {
            "id": "f",
            "segments": [{"id": "1", "name": "a", "start_ms": 0, "end_ms": 30}],
        }
        first = analyze_request(record, {"a": 10})
        second = analyze_request(record, {"a": 40})
        third = analyze_request(record, {"a": 10})
        self.assertEqual(self.stage(first, "a")["overage_ms"], 20)
        self.assertEqual(self.stage(second, "a")["overage_ms"], 0)
        self.assertEqual(third, first)
        self.assertEqual(record, {"id": "f", "segments": [{"id": "1", "name": "a", "start_ms": 0, "end_ms": 30}]})

    def test_batch_reports_invalid_records(self):
        batch = analyze_batch(
            [
                {"id": "ok", "segments": [{"name": "a", "start_ms": 0, "end_ms": 5}]},
                {"id": "bad", "segments": [{"name": "a", "start_ms": 9, "end_ms": 1}]},
            ]
        )
        self.assertEqual(batch["summary"]["request_count"], 2)
        self.assertEqual(batch["summary"]["valid_count"], 1)
        self.assertEqual(batch["summary"]["invalid_count"], 1)

    def test_bad_budget_is_rejected(self):
        with self.assertRaises(AnalysisError):
            analyze_request({"segments": [{"name": "a", "start_ms": 0, "end_ms": 1}]}, {"a": -1})


if __name__ == "__main__":
    unittest.main()
