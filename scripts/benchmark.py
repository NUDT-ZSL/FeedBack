#!/usr/bin/env python3
"""性能基准：生成 10 万条（默认）指标事件并跑完整聚合 + 告警流水线。

用法::

    python scripts/benchmark.py [事件数] [窗口秒数]

数据特征：时间戳跨足够多的窗口、约 400 个标签组（10 指标 × 10 服务 × 4 实例），
事件在 500 条的缓冲块内打乱以模拟有界乱序；watermark 推进后旧窗口被清理，
因此内存保持有界。仅使用标准库。
"""

from __future__ import annotations

import random
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from monitoring.engine import MonitoringEngine  # noqa: E402
from monitoring.models import MetricEvent  # noqa: E402

RULES = [
    {"id": "cpu_high", "metric_name": "cpu_usage", "agg_func": "avg",
     "window_seconds": 60, "operator": ">", "threshold": 80,
     "duration_windows": 2, "tags": {"service": "svc-7"}, "channel": "email"},
    {"id": "latency_spike", "metric_name": "latency", "agg_func": "max",
     "window_seconds": 300, "slide_seconds": 60, "operator": ">=", "threshold": 900,
     "duration_windows": 2, "tags": {}, "channel": "webhook"},
    {"id": "errors_burst", "metric_name": "errors", "agg_func": "sum",
     "window_seconds": 60, "operator": ">", "threshold": 50,
     "duration_windows": 1, "tags": {"service": "*"}, "channel": "log"},
]


def generate(n: int, window_seconds: int) -> list[MetricEvent]:
    base = datetime(2026, 9, 9, 10, 0, tzinfo=timezone.utc)
    metrics = ["cpu_usage", "latency", "errors", "qps", "memory"]
    events: list[MetricEvent] = []
    span_seconds = max(3600, n // 20)
    rng = random.Random(20260909)
    for i in range(n):
        ts = base + timedelta(seconds=rng.randrange(span_seconds),
                              microseconds=rng.randrange(1_000_000))
        metric = metrics[i % len(metrics)]
        if metric == "cpu_usage":
            value = rng.gauss(60, 25)
        elif metric == "latency":
            value = rng.gauss(200, 150)
        elif metric == "errors":
            value = float(rng.choice([0, 0, 0, 1, 5, 60]))
        elif metric == "qps":
            value = float(rng.randrange(1000))
        else:
            value = rng.gauss(55, 10)
        events.append(MetricEvent(
            metric_name=metric, value=value, timestamp=ts,
            tags={
                "service": f"svc-{i % 10}",
                "instance": f"i-{i % 4}",
                "region": "cn-east" if i % 2 else "us-west",
            },
        ))
    # 模拟有界乱序：按时间排序后只在 500 条块内洗牌。
    events.sort(key=lambda e: e.timestamp)
    for start in range(0, len(events), 500):
        chunk = events[start:start + 500]
        rng.shuffle(chunk)
        events[start:start + 500] = chunk
    return events


def main(argv: list[str]) -> int:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    n = int(argv[1]) if len(argv) > 1 else 100_000
    window_seconds = int(argv[2]) if len(argv) > 2 else 60

    events = generate(n, window_seconds)
    engine = MonitoringEngine(
        RULES, window_size=window_seconds,
        group_by=("service", "instance"), allowed_lateness=300,
    )

    started = time.perf_counter()
    for event in events:
        engine.add_event(event)
    engine.finalize()
    elapsed = time.perf_counter() - started

    points = engine.query(["avg"])
    alerts = engine.get_alerts()
    print(f"事件数:        {n}")
    print(f"耗时:          {elapsed:.3f} 秒")
    print(f"吞吐:          {n / elapsed:,.0f} 事件/秒")
    print(f"聚合点(avg):   {len(points)}")
    print(f"告警记录:      {len(alerts)}")
    print(f"超迟丢弃:      {engine.stats.late_dropped}")
    print(f"解析错误:      {engine.stats.parse_errors}")

    # 验收门槛：普通机器上 10 万事件数秒内完成。
    if n >= 100_000 and elapsed > 10:
        print("WARN: 超过 10 秒预算", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
