"""WindowAggregator / TagFilter / WindowConfig 的单元测试。"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone

from monitoring.aggregator import (
    TagFilter,
    TimeRange,
    WindowAggregator,
    WindowConfig,
)
from monitoring.models import MetricEvent, parse_timestamp


def ev(metric: str, value: float, ts: str, **tags) -> MetricEvent:
    return MetricEvent(metric_name=metric, value=value,
                       timestamp=parse_timestamp(ts), tags=tags)


def point_map(points, func="avg"):
    """把查询点转成 {(window_start, tags): value}。"""
    return {
        (p.timestamp.isoformat(), tuple(sorted(p.tags.items()))): p.value
        for p in points if p.func == func
    }


class WindowConfigTests(unittest.TestCase):
    def test_defaults_are_tumbling(self) -> None:
        cfg = WindowConfig(60)
        self.assertEqual(cfg.slide_seconds, 60)
        self.assertTrue(cfg.tumbling)

    def test_invalid(self) -> None:
        with self.assertRaises(ValueError):
            WindowConfig(0)
        with self.assertRaises(ValueError):
            WindowConfig(60, slide_seconds=70)
        with self.assertRaises(ValueError):
            WindowConfig(60, slide_seconds=37)  # 不整除
        with self.assertRaises(ValueError):
            WindowConfig(60, allowed_lateness_seconds=-1)


class TumblingAggregationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.agg = WindowAggregator(WindowConfig(60, group_by=("service",)))

    def test_all_functions(self) -> None:
        for i, v in enumerate([10.0, 20.0, 30.0]):
            self.agg.add_event(ev("cpu", v, f"2026-09-09T10:00:{i:02d}Z", service="auth"))
        for func, expected in [("sum", 60.0), ("avg", 20.0), ("min", 10.0),
                               ("max", 30.0), ("count", 3.0)]:
            points = self.agg.get_query_result(func)
            self.assertEqual(len(points), 1, func)
            self.assertEqual(points[0].value, expected, func)

    def test_window_boundaries(self) -> None:
        self.agg.add_event(ev("cpu", 1, "2026-09-09T10:00:59.999Z", service="a"))
        self.agg.add_event(ev("cpu", 2, "2026-09-09T10:01:00Z", service="a"))
        starts = sorted(p.timestamp for p in self.agg.get_query_result("sum"))
        self.assertEqual(starts, [
            datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc),
            datetime(2026, 9, 9, 10, 1, tzinfo=timezone.utc),
        ])

    def test_grouping_separates_tags(self) -> None:
        self.agg.add_event(ev("cpu", 10, "2026-09-09T10:00:01Z", service="a"))
        self.agg.add_event(ev("cpu", 20, "2026-09-09T10:00:02Z", service="b"))
        sums = point_map(self.agg.get_query_result("sum"), "sum")
        vals = {tags[0][1]: v for (_, tags), v in sums.items()}
        self.assertEqual(vals, {"a": 10.0, "b": 20.0})


class OutOfOrderTests(unittest.TestCase):
    """验收点：乱序不影响聚合结果。"""

    def _feed(self, order):
        agg = WindowAggregator(WindowConfig(60, group_by=("service",),
                                            allowed_lateness_seconds=3600))
        raw = [
            ev("cpu", 10, "2026-09-09T10:00:01Z", service="a"),
            ev("cpu", 20, "2026-09-09T10:00:02Z", service="a"),
            ev("cpu", 30, "2026-09-09T10:01:01Z", service="a"),
            ev("cpu", 40, "2026-09-09T10:01:02Z", service="a"),
            ev("cpu", 50, "2026-09-09T10:02:01Z", service="a"),
        ]
        for i in order:
            agg.add_event(raw[i])
        return agg

    def test_order_independence(self) -> None:
        baseline = self._feed(range(5)).get_query_result("sum")
        shuffled = self._feed([4, 0, 3, 1, 2]).get_query_result("sum")
        reverse = self._feed([4, 3, 2, 1, 0]).get_query_result("sum")
        for other in (shuffled, reverse):
            self.assertEqual(
                [(p.timestamp, p.value) for p in baseline],
                [(p.timestamp, p.value) for p in other],
            )

    def test_late_within_grace_accepted(self) -> None:
        agg = WindowAggregator(WindowConfig(60, allowed_lateness_seconds=300))
        agg.add_event(ev("cpu", 100, "2026-09-09T10:10:00Z"))
        agg.add_event(ev("cpu", 1, "2026-09-09T10:06:01Z"))  # 落后 ~4 分钟，窗口未封口
        sums = [p.value for p in agg.get_query_result("sum")]
        self.assertIn(1.0, sums)
        self.assertEqual(agg.dropped_late_events, 0)

    def test_late_beyond_grace_dropped(self) -> None:
        agg = WindowAggregator(WindowConfig(60, allowed_lateness_seconds=300))
        agg.add_event(ev("cpu", 100, "2026-09-09T10:10:00Z"))
        # 10:00 的窗口在 watermark=10:10、宽限 300s 时恰好封口（end+300<=watermark）。
        agg.add_event(ev("cpu", 1, "2026-09-09T10:00:30Z"))
        self.assertEqual(agg.dropped_late_events, 1)
        sums = [p.value for p in agg.get_query_result("sum")]
        self.assertNotIn(1.0, sums)


class SlidingWindowTests(unittest.TestCase):
    def test_sliding_counts_multiple_windows(self) -> None:
        agg = WindowAggregator(WindowConfig(120, slide_seconds=60,
                                            allowed_lateness_seconds=3600))
        agg.add_event(ev("cpu", 10, "2026-09-09T10:00:30Z"))
        agg.add_event(ev("cpu", 20, "2026-09-09T10:01:30Z"))
        # 窗口起点应为 09:59 / 10:00 / 10:01（120s 窗，60s 步长）。
        points = agg.get_query_result("sum")
        starts = sorted(p.timestamp for p in points)
        self.assertEqual(
            [s.strftime("%H:%M") for s in starts], ["09:59", "10:00", "10:01"]
        )
        values = {p.timestamp.strftime("%H:%M"): p.value for p in points}
        self.assertEqual(values["09:59"], 10.0)   # 仅 10:00:30
        self.assertEqual(values["10:00"], 30.0)   # 两个点都在 [10:00,10:02)
        self.assertEqual(values["10:01"], 20.0)   # 仅 10:01:30


class TagFilterTests(unittest.TestCase):
    def test_exact(self) -> None:
        f = TagFilter.from_mapping({"service": "auth", "region": "cn-east"})
        self.assertTrue(f.matches({"service": "auth", "region": "cn-east"}))
        self.assertFalse(f.matches({"service": "auth"}))
        self.assertFalse(f.matches({"service": "db", "region": "cn-east"}))

    def test_wildcard(self) -> None:
        f = TagFilter.from_mapping({"region": "cn-*"})
        self.assertTrue(f.matches({"region": "cn-east"}))
        self.assertTrue(f.matches({"region": "cn-north", "x": "y"}))
        self.assertFalse(f.matches({"region": "us-west"}))
        self.assertFalse(f.matches({"other": "cn-east"}))

    def test_query_filter_applied(self) -> None:
        agg = WindowAggregator(WindowConfig(60, group_by=("service", "region")))
        agg.add_event(ev("cpu", 1, "2026-09-09T10:00:01Z",
                         service="a", region="cn-east"))
        agg.add_event(ev("cpu", 2, "2026-09-09T10:00:02Z",
                         service="b", region="us-west"))
        points = agg.get_query_result(
            "sum", tag_filter=TagFilter.from_mapping({"region": "cn-*"})
        )
        self.assertEqual(len(points), 1)
        self.assertEqual(points[0].value, 1.0)

    def test_time_range_filter(self) -> None:
        agg = WindowAggregator(WindowConfig(60))
        for m in range(4):
            agg.add_event(ev("cpu", 1, f"2026-09-09T10:0{m}:00Z"))
        tr = TimeRange(
            start=parse_timestamp("2026-09-09T10:01:00Z"),
            end=parse_timestamp("2026-09-09T10:03:00Z"),
        )
        points = agg.get_query_result("count", time_range=tr)
        self.assertEqual([p.timestamp.minute for p in points], [1, 2])


class EmptyStreamTests(unittest.TestCase):
    def test_empty(self) -> None:
        agg = WindowAggregator(WindowConfig(60))
        self.assertEqual(agg.get_query_result("sum"), [])
        self.assertIsNone(agg.watermark)
        self.assertEqual(agg.sealed_window_ends(), [])
        agg.purge_expired_windows()  # 不应抛异常


if __name__ == "__main__":
    unittest.main()
