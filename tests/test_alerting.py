"""AlertEngine 状态机：去抖、去重、恢复、空跳、动态规则。"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from monitoring.alerting import AlertEngine, WindowEval
from monitoring.rules import AlertRule

T0 = datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc)


def rule(**overrides) -> AlertRule:
    base = dict(
        id="r", metric_name="cpu", agg_func="avg",
        window_seconds=60, slide_seconds=60,
        operator=">", threshold=80, duration_windows=2,
        tags={"service": "auth"}, channel="email",
    )
    base.update(overrides)
    return AlertRule(**base)


def slice_(value, index, tags=None, metric="cpu") -> WindowEval:
    tags = tags or {"service": "auth"}
    return WindowEval(
        metric_name=metric,
        window_start=T0 + timedelta(seconds=60 * index),
        window_end=T0 + timedelta(seconds=60 * (index + 1)),
        tags=tags,
        values={"avg": float(value)} if value is not None else {},
    )


class AlertStateMachineTests(unittest.TestCase):
    def test_fires_only_after_duration(self) -> None:
        r = rule(duration_windows=2)
        eng = AlertEngine([r])
        # 第 1 个窗口满足但未达持续时间。
        self.assertEqual(eng.evaluate_window(slice_(90, 0), tick_rules=[r]), [])
        # 连续第 2 个满足 -> firing。
        firing = eng.evaluate_window(slice_(90, 1), tick_rules=[r])
        self.assertEqual(len(firing), 1)
        self.assertEqual(firing[0].status, "firing")
        self.assertEqual(firing[0].value, 90.0)
        # 仍满足但已在 firing -> 不重复告警。
        self.assertEqual(eng.evaluate_window(slice_(90, 2), tick_rules=[r]), [])
        # 条件不满足 -> resolved，且 alert_id 相同。
        resolved = eng.evaluate_window(slice_(10, 3), tick_rules=[r])
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0].status, "resolved")
        self.assertEqual(resolved[0].alert_id, firing[0].alert_id)
        # 恢复后再次满足，需要重新连续 2 个窗口。
        self.assertEqual(eng.evaluate_window(slice_(90, 4), tick_rules=[r]), [])
        again = eng.evaluate_window(slice_(90, 5), tick_rules=[r])
        self.assertEqual(len(again), 1)
        self.assertEqual(again[0].status, "firing")
        self.assertEqual(again[0].alert_id, firing[0].alert_id)
        self.assertEqual(len(eng.get_alerts()), 3)

    def test_broken_streak_resets(self) -> None:
        r = rule(duration_windows=2)
        eng = AlertEngine([r])
        self.assertEqual(eng.evaluate_window(slice_(90, 0), tick_rules=[r]), [])
        # 中间一个窗口不满足，计数清零。
        self.assertEqual(eng.evaluate_window(slice_(10, 1), tick_rules=[r]), [])
        self.assertEqual(eng.evaluate_window(slice_(90, 2), tick_rules=[r]), [])
        self.assertEqual(len(eng.evaluate_window(slice_(90, 3), tick_rules=[r])), 1)

    def test_empty_window_breaks_streak(self) -> None:
        """数据空洞（无切片）也必须打断连续计数。"""
        r = rule(duration_windows=2)
        eng = AlertEngine([r])
        self.assertEqual(eng.evaluate_window(slice_(90, 0), tick_rules=[r]), [])
        # 第 1 窗口无任何数据：传空切片 + tick，计数归零。
        self.assertEqual(
            eng.evaluate_window([], tick_rules=[r],
                                tick_window=(slice_(None, 1).window_start,
                                             slice_(None, 1).window_end)),
            [],
        )
        self.assertEqual(eng.evaluate_window(slice_(90, 2), tick_rules=[r]), [])
        self.assertEqual(len(eng.evaluate_window(slice_(90, 3), tick_rules=[r])), 1)

    def test_empty_window_resolves_firing(self) -> None:
        r = rule(duration_windows=1)
        eng = AlertEngine([r])
        firing = eng.evaluate_window(slice_(90, 0), tick_rules=[r])
        self.assertEqual(len(firing), 1)
        gap = eng.evaluate_window(
            [], tick_rules=[r],
            tick_window=(slice_(None, 1).window_start, slice_(None, 1).window_end),
        )
        self.assertEqual(len(gap), 1)
        self.assertEqual(gap[0].status, "resolved")

    def test_separate_tag_groups_independent(self) -> None:
        r = rule(duration_windows=1, tags={"service": "*"})
        eng = AlertEngine([r])
        # 同一窗口的两个标签组放在一次评估里（与引擎实际调用方式一致）。
        fired = eng.evaluate_window(
            [slice_(90, 0, {"service": "a"}), slice_(90, 0, {"service": "b"})],
            tick_rules=[r],
        )
        self.assertEqual(len(fired), 2)
        a, b = (fired if fired[0].tags["service"] == "a"
                else (fired[1], fired[0]))
        self.assertNotEqual(a.alert_id, b.alert_id)
        # 下一个窗口只 a 恢复，b 仍 firing。
        resolved = eng.evaluate_window(
            [slice_(10, 1, {"service": "a"}), slice_(90, 1, {"service": "b"})],
            tick_rules=[r],
        )
        self.assertEqual(len(resolved), 1)
        self.assertEqual(resolved[0].status, "resolved")
        self.assertEqual(resolved[0].alert_id, a.alert_id)
        active = {x["alert_id"] for x in eng.active_alerts()}
        self.assertEqual(active, {b.alert_id})

    def test_all_operators(self) -> None:
        for op, true_value, false_value in [
            (">", 81, 80), (">=", 80, 79), ("<", 79, 80),
            ("<=", 80, 81), ("==", 80, 81), ("!=", 81, 80),
        ]:
            r = rule(operator=op, threshold=80, duration_windows=1)
            eng = AlertEngine([r])
            self.assertEqual(
                len(eng.evaluate_window(slice_(true_value, 0), tick_rules=[r])), 1, op
            )
            eng2 = AlertEngine([r])
            self.assertEqual(
                eng2.evaluate_window(slice_(false_value, 0), tick_rules=[r]), [], op
            )

    def test_dynamic_rule_load_and_remove(self) -> None:
        r = rule(duration_windows=1)
        eng = AlertEngine()
        self.assertEqual(eng.evaluate_window(slice_(90, 0), tick_rules=[]), [])
        added, errors = eng.load_rules([r])
        self.assertEqual(added, 1)
        self.assertEqual(errors, [])
        self.assertEqual(len(eng.evaluate_window(slice_(90, 1), tick_rules=[r])), 1)
        self.assertTrue(eng.remove_rule("r"))
        self.assertEqual(eng.evaluate_window(slice_(90, 2), tick_rules=[]), [])
        self.assertFalse(eng.remove_rule("r"))

    def test_invalid_rule_in_load_is_skipped(self) -> None:
        eng = AlertEngine()
        added, errors = eng.load_rules({"rules": [
            rule(duration_windows=1).to_dict(),
            {"id": "bad", "metric_name": "cpu", "agg_func": "p99",
             "window_seconds": 60, "operator": ">", "threshold": 1},
        ]})
        self.assertEqual(added, 1)
        self.assertEqual(len(errors), 1)

    def test_rule_replacement_resets_state(self) -> None:
        r = rule(duration_windows=1)
        eng = AlertEngine([r])
        self.assertEqual(len(eng.evaluate_window(slice_(90, 0), tick_rules=[r])), 1)
        # 用同 id 但阈值变化的规则替换。
        r2 = rule(threshold=99)
        added, _ = eng.load_rules([r2])
        self.assertEqual(added, 1)
        # 旧 firing 状态已清除：90 < 99 不应产生 resolved，且没有活动告警。
        self.assertEqual(eng.evaluate_window(slice_(90, 1), tick_rules=[r2]), [])
        self.assertEqual(eng.active_alerts(), [])


if __name__ == "__main__":
    unittest.main()
