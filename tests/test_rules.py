"""AlertRule / load_rules 的解析与校验测试。"""

from __future__ import annotations

import json
import unittest

from monitoring.rules import AlertRule, RuleError, load_rules

VALID = {
    "id": "r1",
    "metric_name": "cpu",
    "agg_func": "avg",
    "window_seconds": 60,
    "operator": ">",
    "threshold": 80,
    "duration_windows": 2,
    "tags": {"service": "auth"},
    "channel": "email",
}


class RuleParsingTests(unittest.TestCase):
    def test_valid(self) -> None:
        rule = AlertRule.from_dict(VALID)
        self.assertEqual(rule.id, "r1")
        self.assertEqual(rule.slide_seconds, 60)
        self.assertEqual(rule.threshold, 80.0)
        self.assertTrue(rule.tag_filter.matches({"service": "auth"}))
        self.assertFalse(rule.tag_filter.matches({"service": "db"}))

    def test_sliding(self) -> None:
        data = dict(VALID, slide_seconds=30)
        rule = AlertRule.from_dict(data)
        self.assertEqual(rule.slide_seconds, 30)

    def test_defaults(self) -> None:
        minimal = {
            "id": "r", "metric_name": "m", "agg_func": "sum",
            "window_seconds": 60, "operator": ">", "threshold": 1,
        }
        rule = AlertRule.from_dict(minimal)
        self.assertEqual(rule.duration_windows, 1)
        self.assertEqual(rule.channel, "log")
        self.assertEqual(rule.tags, {})

    def test_invalid_rules(self) -> None:
        bad_cases = [
            {"metric_name": "m"},  # 无 id
            dict(VALID, id="x", agg_func="median"),
            dict(VALID, id="x", window_seconds=0),
            dict(VALID, id="x", slide_seconds=37),
            dict(VALID, id="x", operator="~"),
            dict(VALID, id="x", threshold="hot"),
            dict(VALID, id="x", threshold=float("inf")),
            dict(VALID, id="x", duration_windows=0),
            dict(VALID, id="x", tags={"k": 1}),
            dict(VALID, id="x", window_seconds=60.5),
        ]
        for case in bad_cases:
            with self.assertRaises(RuleError):
                AlertRule.from_dict(case)

    def test_load_rules_payload_shapes(self) -> None:
        rules, errors = load_rules({"rules": [VALID, dict(VALID, id="r2")]})
        self.assertEqual(len(rules), 2)
        self.assertEqual(errors, [])

        rules, errors = load_rules([VALID])
        self.assertEqual(len(rules), 1)

        rules, errors = load_rules(json.dumps([VALID]))
        self.assertEqual(len(rules), 1)

        rules, errors = load_rules("{not json")
        self.assertEqual(rules, [])
        self.assertEqual(len(errors), 1)

        rules, errors = load_rules(42)
        self.assertEqual(rules, [])
        self.assertTrue(errors)

    def test_bad_rules_skipped_not_fatal(self) -> None:
        payload = {"rules": [
            VALID,
            dict(VALID, id="bad", agg_func="p99"),
            dict(VALID, id="r1"),  # 重复 id
        ]}
        rules, errors = load_rules(payload)
        self.assertEqual([r.id for r in rules], ["r1"])
        self.assertEqual(len(errors), 2)

    def test_alias_fields(self) -> None:
        data = {
            "rule_id": "aliased", "metric": "cpu", "func": "max",
            "window": 120, "op": "<", "threshold": 10,
        }
        rule = AlertRule.from_dict(data)
        self.assertEqual(rule.id, "aliased")
        self.assertEqual(rule.metric_name, "cpu")
        self.assertEqual(rule.agg_func, "max")
        self.assertEqual(rule.window_seconds, 120)
        self.assertEqual(rule.operator, "<")


if __name__ == "__main__":
    unittest.main()
