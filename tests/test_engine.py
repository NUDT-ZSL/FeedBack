"""MonitoringEngine 端到端编排测试（含乱序、动态规则、滑动窗口、空流）。"""

from __future__ import annotations

import random
import unittest
from datetime import datetime, timezone

from monitoring.aggregator import TagFilter
from monitoring.engine import MonitoringEngine
from monitoring.models import MetricEvent, parse_timestamp
from monitoring.sources import IterableEventSource


def make_event(metric, value, ts, **tags) -> MetricEvent:
    return MetricEvent(metric_name=metric, value=value,
                       timestamp=parse_timestamp(ts), tags=tags)


def cpu_rule(**over):
    base = {
        "id": "cpu_high", "metric_name": "cpu", "agg_func": "avg",
        "window_seconds": 60, "operator": ">", "threshold": 80,
        "duration_windows": 2, "tags": {"service": "auth"}, "channel": "email",
    }
    base.update(over)
    return base


class EndToEndTests(unittest.TestCase):
    def test_shuffled_events_same_result(self) -> None:
        """同一批事件按不同顺序（含乱序）处理，聚合与告警完全一致。"""
        events = []
        plan = {0: [90, 90], 1: [85, 95], 2: [10, 20], 3: [90, 90]}
        for minute, values in plan.items():
            for i, v in enumerate(values):
                events.append(make_event(
                    "cpu", v, f"2026-09-09T10:{minute:02d}:{i:02d}Z",
                    service="auth", instance="a1",
                ))

        def run(order):
            eng = MonitoringEngine([cpu_rule()], window_size=60,
                                   group_by=("service",), allowed_lateness=3600)
            eng.process_source(IterableEventSource([events[i] for i in order]))
            agg = [(p.timestamp, p.tags, p.value) for p in eng.query("avg")]
            alerts = [(a.status, a.window_start.minute, a.value) for a in eng.get_alerts()]
            return agg, alerts

        ordered = list(range(len(events)))
        shuffled = ordered[:]
        random.seed(42)
        random.shuffle(shuffled)

        agg1, alerts1 = run(ordered)
        agg2, alerts2 = run(shuffled)
        agg3, alerts3 = run(list(reversed(ordered)))
        self.assertEqual(agg1, agg2)
        self.assertEqual(agg1, agg3)
        self.assertEqual(alerts1, alerts2)
        self.assertEqual(alerts1, alerts3)

        # 期望：w0 avg90 streak1、w1 avg90 fire、w2 avg15 resolve、w3 avg90 streak1（不足2窗不fire）。
        self.assertEqual(alerts1, [
            ("firing", 1, 90.0),
            ("resolved", 2, 15.0),
        ])

    def test_multi_instance_grouped_by_service(self) -> None:
        """规则按 service 聚合：两个实例一起算 avg，不应各自触发。"""
        eng = MonitoringEngine(
            [cpu_rule(duration_windows=1, threshold=80)],
            group_by=("service", "instance"),
        )
        # 单窗：100 与 0 平均 50，不触发。
        eng.process_source(IterableEventSource([
            make_event("cpu", 100, "2026-09-09T10:00:01Z", service="auth", instance="a"),
            make_event("cpu", 0, "2026-09-09T10:00:02Z", service="auth", instance="b"),
        ]))
        self.assertEqual(eng.get_alerts(), [])

        # 下一窗两个实例都高 -> 平均 100 触发。
        eng2 = MonitoringEngine(
            [cpu_rule(duration_windows=1, threshold=80)],
            group_by=("service",),
        )
        eng2.process_source(IterableEventSource([
            make_event("cpu", 100, "2026-09-09T10:00:01Z", service="auth", instance="a"),
            make_event("cpu", 100, "2026-09-09T10:00:02Z", service="auth", instance="b"),
        ]))
        self.assertEqual(len(eng2.get_alerts()), 1)

    def test_wildcard_rule_expands_groups(self) -> None:
        eng = MonitoringEngine(
            [cpu_rule(id="r", tags={"region": "us-*"}, duration_windows=1)],
            group_by=("region",),
        )
        eng.process_source(IterableEventSource([
            make_event("cpu", 90, "2026-09-09T10:00:01Z", region="us-east"),
            make_event("cpu", 90, "2026-09-09T10:00:02Z", region="us-west"),
            make_event("cpu", 10, "2026-09-09T10:00:03Z", region="cn-east"),
        ]))
        alerts = eng.get_alerts()
        regions = sorted(a.tags["region"] for a in alerts)
        self.assertEqual(regions, ["us-east", "us-west"])

    def test_sliding_window_rule(self) -> None:
        rule = cpu_rule(
            id="sliding", window_seconds=120, slide_seconds=60,
            agg_func="max", threshold=80, duration_windows=1, tags={},
        )
        eng = MonitoringEngine([rule], window_size=60, allowed_lateness=3600)
        events = [
            make_event("cpu", 90, "2026-09-09T10:00:30Z"),
            make_event("cpu", 10, "2026-09-09T10:01:30Z"),
        ]
        random.Random(7).shuffle(events)
        eng.process_source(IterableEventSource(events))
        alerts = eng.get_alerts()
        # 120s 滑动窗：
        # [09:59,10:01) max=90 -> firing；
        # [10:00,10:02) max=90 仍满足但已在 firing -> 不重复告警；
        # [10:01,10:03) max=10 -> resolved。
        fired = [(a.status, a.window_start.strftime("%H:%M"), a.value) for a in alerts]
        self.assertEqual(
            fired,
            [("firing", "09:59", 90.0), ("resolved", "10:01", 10.0)],
        )

    def test_dynamic_rule_mid_stream(self) -> None:
        """先喂事件再加载规则：只对加载后到达的事件生效。"""
        eng = MonitoringEngine(window_size=60, allowed_lateness=3600)
        eng.add_event(make_event("cpu", 95, "2026-09-09T10:00:01Z", service="auth"))
        added, errors = eng.load_rules([cpu_rule(duration_windows=1)])
        self.assertEqual(added, 1)
        self.assertEqual(errors, [])
        # 规则加载前的窗口不会追溯告警。
        self.assertEqual(eng.get_alerts(), [])
        # 加载后的事件立即生效。
        eng.add_event(make_event("cpu", 95, "2026-09-09T10:01:01Z", service="auth"))
        eng.finalize()
        self.assertEqual(len(eng.get_alerts()), 1)

    def test_invalid_dynamic_rule_reports_error(self) -> None:
        eng = MonitoringEngine()
        added, errors = eng.load_rules({"rules": [
            cpu_rule(id="good", duration_windows=1),
            {"id": "bad", "metric_name": "cpu", "agg_func": "p99",
             "window_seconds": 60, "operator": ">", "threshold": 1},
        ]})
        self.assertEqual(added, 1)
        self.assertEqual(len(errors), 1)

    def test_late_drop_counted(self) -> None:
        eng = MonitoringEngine(
            [cpu_rule(duration_windows=1)], allowed_lateness=300,
        )
        eng.process_source(IterableEventSource([
            make_event("cpu", 90, "2026-09-09T10:10:00Z", service="auth"),
            make_event("cpu", 90, "2026-09-09T10:00:30Z", service="auth"),  # 超宽限
        ]))
        self.assertEqual(eng.stats.late_dropped, 1)

    def test_empty_stream(self) -> None:
        eng = MonitoringEngine([cpu_rule()])
        eng.process_source(IterableEventSource([]))
        self.assertEqual(eng.query("avg"), [])
        self.assertEqual(eng.get_alerts(), [])
        self.assertEqual(eng.stats.events_accepted, 0)

    def test_query_with_filters(self) -> None:
        eng = MonitoringEngine(window_size=60, group_by=("service", "region"))
        eng.process_source(IterableEventSource([
            make_event("cpu", 1, "2026-09-09T10:00:01Z", service="a", region="cn-east"),
            make_event("cpu", 2, "2026-09-09T10:00:02Z", service="b", region="us-west"),
        ]))
        points = eng.query(
            "sum", tag_filter=TagFilter.from_mapping({"region": "cn-*"})
        )
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0].value, 1.0)

    def test_aggregation_functions_report(self) -> None:
        eng = MonitoringEngine(window_size=60)
        eng.process_source(IterableEventSource([
            make_event("cpu", v, f"2026-09-09T10:00:0{i}Z") for i, v in enumerate([10, 20, 30, 40], start=1)
        ]))
        values = {p.func: p.value for p in eng.query(["sum", "avg", "min", "max", "count"])}
        self.assertEqual(values, {"sum": 100.0, "avg": 25.0, "min": 10.0,
                                  "max": 40.0, "count": 4.0})


if __name__ == "__main__":
    unittest.main()
