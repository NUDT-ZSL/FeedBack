"""MetricEvent / 时间戳解析 / 序列化的单元测试。"""

from __future__ import annotations

import math
import unittest
from datetime import datetime, timezone

from monitoring.models import Alert, MetricEvent, TimeSeriesPoint, iso, parse_timestamp


def event(value=1.0, ts="2026-09-09T10:00:00Z", **tags) -> MetricEvent:
    return MetricEvent(
        metric_name="cpu", value=value,
        timestamp=parse_timestamp(ts), tags=tags,
    )


class TimestampTests(unittest.TestCase):
    def test_z_and_offset_and_naive(self) -> None:
        self.assertEqual(
            parse_timestamp("2026-09-09T10:00:00Z"),
            datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(
            parse_timestamp("2026-09-09T18:00:00+08:00"),
            datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc),
        )
        self.assertEqual(
            parse_timestamp("2026-09-09T10:00:00"),
            datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc),
        )

    def test_bad_timestamp(self) -> None:
        for bad in ("", "not-a-time", "2026-13-99", 12345):
            with self.assertRaises(ValueError):
                parse_timestamp(bad)

    def test_iso_roundtrip(self) -> None:
        dt = parse_timestamp("2026-09-09T10:00:00.123456Z")
        self.assertTrue(iso(dt).endswith("Z"))


class MetricEventTests(unittest.TestCase):
    def test_valid(self) -> None:
        e = event(service="auth", region="cn-east")
        self.assertEqual(e.value, 1.0)
        self.assertEqual(e.tags["service"], "auth")

    def test_int_value_accepted_bool_rejected(self) -> None:
        e = event(value=5)
        self.assertEqual(e.value, 5.0)
        with self.assertRaises(ValueError):
            event(value=True)

    def test_non_finite_rejected(self) -> None:
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValueError):
                event(value=bad)

    def test_bad_name(self) -> None:
        with self.assertRaises(ValueError):
            MetricEvent(metric_name="", value=1.0,
                        timestamp=parse_timestamp("2026-09-09T10:00:00Z"))

    def test_bad_tags(self) -> None:
        with self.assertRaises(ValueError):
            MetricEvent(metric_name="m", value=1.0,
                        timestamp=parse_timestamp("2026-09-09T10:00:00Z"),
                        tags={"": "x"})
        with self.assertRaises(ValueError):
            MetricEvent(metric_name="m", value=1.0,
                        timestamp=parse_timestamp("2026-09-09T10:00:00Z"),
                        tags={"k": ""})

    def test_from_dict_missing_fields(self) -> None:
        with self.assertRaises(ValueError):
            MetricEvent.from_dict({"metric_name": "m", "value": 1})
        with self.assertRaises(ValueError):
            MetricEvent.from_dict("not-a-dict")  # type: ignore[arg-type]
        with self.assertRaises(ValueError):
            MetricEvent.from_dict({"metric_name": "m", "value": "x",
                                   "timestamp": "2026-09-09T10:00:00Z"})

    def test_numeric_tag_value_coerced(self) -> None:
        # JSON 里标签值偶尔是数字，统一转成字符串。
        e = MetricEvent.from_dict({
            "metric_name": "m", "value": 1,
            "timestamp": "2026-09-09T10:00:00Z", "tags": {"port": 8080},
        })
        self.assertEqual(e.tags["port"], "8080")

    def test_roundtrip_dict(self) -> None:
        e = event(1.5, service="auth")
        d = e.to_dict()
        self.assertEqual(d["metric_name"], "cpu")
        self.assertEqual(d["value"], 1.5)
        self.assertEqual(d["timestamp"], "2026-09-09T10:00:00.000Z")
        e2 = MetricEvent.from_dict(d)
        self.assertEqual(e2, e)


class SerializationShapeTests(unittest.TestCase):
    """锁定 to_dict 的字段集合（验收点：无多余/缺失字段）。"""

    def test_alert_fields(self) -> None:
        a = Alert(
            alert_id="x", rule_id="r", metric_name="m",
            window_start=parse_timestamp("2026-09-09T10:00:00Z"),
            window_end=parse_timestamp("2026-09-09T10:01:00Z"),
            value=1.0, threshold=2.0, channel="email",
        )
        self.assertEqual(
            set(a.to_dict()),
            {"alert_id", "rule_id", "metric_name", "status", "window_start",
             "window_end", "value", "threshold", "channel", "tags"},
        )
        self.assertEqual(a.to_dict()["status"], "firing")
        self.assertNotIn("condition", a.to_dict())

    def test_point_fields(self) -> None:
        p = TimeSeriesPoint(
            timestamp=parse_timestamp("2026-09-09T10:00:00Z"),
            tags={"service": "auth"}, value=1.0, metric_name="m", func="avg",
            window_start=parse_timestamp("2026-09-09T10:00:00Z"),
            window_end=parse_timestamp("2026-09-09T10:01:00Z"),
        )
        self.assertEqual(
            set(p.to_dict()),
            {"metric_name", "func", "timestamp", "window_start", "window_end",
             "key_tags", "value"},
        )


if __name__ == "__main__":
    unittest.main()
