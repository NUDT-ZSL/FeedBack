"""编排层：事件源 -> 窗口聚合 -> 告警评估。

* 每种规则用到的窗口形状 ``(window_seconds, slide_seconds)`` 对应一个内部
  聚合器（按完整标签集分组），相同形状的规则共享一份计算；
* 另维护一个“查询聚合器”，按 CLI 指定的分组维度产出聚合报表；
* watermark（最大事件时间）推进、超过宽限期时封口窗口并驱动告警评估，
  评估沿密集的 slide 时钟推进（无数据的空窗口也占一拍），评估后的封口
  窗口被物理清理，长时间运行内存有界；
* 事件流结束时 :meth:`finalize` 冲刷所有现存窗口（含最后一个不完整窗口）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Sequence

from .aggregator import (
    AGG_FUNCS,
    TagFilter,
    TimeRange,
    WindowAggregator,
    WindowConfig,
)
from .alerting import AlertEngine, WindowEval
from .models import Alert, MetricEvent, TimeSeriesPoint
from .sources import EventSource

AggKey = tuple[int, int, frozenset[str]]  # (window_seconds, slide_seconds, 分组标签键集)


@dataclass(slots=True)
class EngineError:
    """一条被优雅跳过的坏数据记录。"""

    location: str
    raw: str | None
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {"location": self.location, "raw": self.raw, "error": self.message}


@dataclass(slots=True)
class EngineStats:
    events_received: int = 0
    events_accepted: int = 0
    late_dropped: int = 0
    parse_errors: int = 0


class _RuleAggMeta:
    """一个窗口形状的内部聚合器及其评估时钟状态。"""

    __slots__ = ("agg", "cursor", "min_start")

    def __init__(self, agg: WindowAggregator) -> None:
        self.agg = agg
        # 已评估到的窗口终点（None 表示尚未开始）。
        self.cursor: int | None = None
        # 见过的最早窗口起点（即使窗口后来被清理也保留）。
        self.min_start: int | None = None


class MonitoringEngine:
    """把事件源、聚合器、告警引擎串起来的门面。"""

    def __init__(
        self,
        rules: Sequence | None = None,
        *,
        window_size: int = 60,
        slide_seconds: int | None = None,
        group_by: Sequence[str] = (),
        allowed_lateness: int = 300,
    ) -> None:
        self.query_config = WindowConfig(
            size_seconds=window_size,
            slide_seconds=slide_seconds,
            group_by=tuple(group_by),
            allowed_lateness_seconds=allowed_lateness,
        )
        self.query_aggregator = WindowAggregator(self.query_config)
        self.alert_engine = AlertEngine()
        self._rule_aggs: dict[AggKey, _RuleAggMeta] = {}
        self.stats = EngineStats()
        self.errors: list[EngineError] = []
        if rules is not None:
            self.load_rules(rules)

    # ------------------------------------------------------------------ #
    # 规则（动态加载）
    # ------------------------------------------------------------------ #
    def load_rules(self, payload: Any) -> tuple[int, list[str]]:
        """运行中加载/替换规则。

        语义同 :meth:`AlertEngine.load_rules`；同名规则被替换并重置状态，
        非法规则进入错误列表被跳过。新窗口形状即时创建聚合器，对后续到达
        的事件生效，无需重启；历史窗口不回溯（可在交互模式先加载规则再喂数据）。
        """
        added, errors = self.alert_engine.load_rules(payload)
        for rule in self.alert_engine.rules:
            key = self._agg_key(rule)
            if key not in self._rule_aggs:
                self._rule_aggs[key] = _RuleAggMeta(
                    WindowAggregator(
                        WindowConfig(
                            size_seconds=rule.window_seconds,
                            slide_seconds=rule.slide_seconds,
                            # 按规则过滤涉及的标签键分组：同一过滤值的不同实例
                            # 才合并聚合；不同过滤值（含通配展开）各自独立。
                            group_by=tuple(sorted(rule.tags)),
                            allowed_lateness_seconds=self.query_config.allowed_lateness_seconds,
                        )
                    )
                )
        self._prune_rule_aggs()
        return added, errors

    def _prune_rule_aggs(self) -> None:
        """回收已无任何规则使用的窗口形状聚合器（规则删除/替换后）。"""
        live = {self._agg_key(rule) for rule in self.alert_engine.rules}
        for key in list(self._rule_aggs):
            if key not in live:
                del self._rule_aggs[key]

    @staticmethod
    def _agg_key(rule: AlertRule) -> AggKey:
        return (rule.window_seconds, rule.slide_seconds, frozenset(rule.tags))

    def remove_rule(self, rule_id: str) -> bool:
        existed = self.alert_engine.remove_rule(rule_id)
        if existed:
            self._prune_rule_aggs()
        return existed

    # ------------------------------------------------------------------ #
    # 事件处理
    # ------------------------------------------------------------------ #
    def process_source(self, source: EventSource) -> None:
        """消费整个事件源并在结束时冲刷窗口。"""

        def on_error(location: str, raw: str | None, message: str) -> None:
            self.stats.parse_errors += 1
            self.errors.append(EngineError(location, raw, message))

        source.on_error = on_error  # type: ignore[attr-defined]
        for event in source.events():
            self.stats.events_received += 1
            self.add_event(event)
        self.finalize()

    def add_event(self, event: MetricEvent) -> None:
        """处理单个事件并立即评估任何因此封口的窗口。"""
        self.stats.events_accepted += 1
        self.query_aggregator.add_event(event)
        for key, meta in self._rule_aggs.items():
            placed = meta.agg.add_event(event)
            if placed:
                earliest = min(start for start, _end in placed)
                if meta.min_start is None or earliest < meta.min_start:
                    meta.min_start = earliest
            self._pump(key, meta)
        # 统计超迟丢弃：以查询聚合器为准（同一 watermark 语义）。
        self.stats.late_dropped = self.query_aggregator.dropped_late_events

    def finalize(self) -> None:
        """事件流结束：强制评估所有尚未评估的现存窗口（含未封口窗口）。"""
        for key, meta in list(self._rule_aggs.items()):
            self._pump(key, meta, force_all=True)

    def _pump(self, key: AggKey, meta: _RuleAggMeta, *, force_all: bool = False) -> None:
        """沿密集 slide 时钟把某窗口形状推进到可评估边界。

        无数据的空窗口也占一拍：告警引擎据此把连续计数清零，保证“连续 N 个
        窗口”指时钟连续而非数据连续。

        乱序安全性：迟到事件能被接受的前提是
        ``window_end + allowed_lateness > watermark``，即其窗口终点必在封口
        边界 ``sealable_end`` 之后，因此一旦 ``cursor`` 已越过某窗口，该窗口
        不可能再收到可接受的迟到数据，时钟只能单调向前。
        """
        size, slide, _tag_keys = key
        agg = meta.agg

        if meta.min_start is None:
            return

        if force_all:
            # EOF：推进到现存最晚窗口（可能不完整，批处理验收需要末窗口结果）。
            max_start = max(
                (start for windows in agg._windows.values() for start in windows),  # noqa: SLF001
                default=meta.min_start,
            )
            last_end = max_start + size
        else:
            watermark = agg._max_event_time  # noqa: SLF001
            if watermark is None:
                return
            grace = agg.config.allowed_lateness_seconds
            # 已完整结束且超出宽限期的最后一个网格对齐窗口。
            sealable_end = int((watermark - grace - size) // slide) * slide + size
            last_end = sealable_end

        # cursor=None：首个待评估窗口是当前见过的最早窗口。
        # 已推进过：从下一拍继续（更早的可接受窗口必在 last_end 之后，不会遗漏）。
        first_end = (
            meta.min_start + size if meta.cursor is None else meta.cursor + slide
        )
        if last_end < first_end:
            return

        tick_rules = [
            rule
            for rule in self.alert_engine.rules
            if self._agg_key(rule) == key
        ]

        for end in range(first_end, last_end + 1, slide):
            start = end - size
            slices = []
            for metric, metric_windows in agg._windows.items():  # noqa: SLF001
                window = metric_windows.get(start)
                if window is None:
                    continue
                for group_key, stats in window.groups.items():
                    values = {func: stats.aggregate(func) for func in AGG_FUNCS}
                    slices.append(
                        WindowEval(
                            metric_name=metric,
                            window_start=datetime.fromtimestamp(start, tz=timezone.utc),
                            window_end=datetime.fromtimestamp(end, tz=timezone.utc),
                            tags=dict(group_key),
                            values=values,
                        )
                    )
            self.alert_engine.evaluate_window(
                slices,
                tick_rules=tick_rules,
                tick_window=(
                    datetime.fromtimestamp(start, tz=timezone.utc),
                    datetime.fromtimestamp(end, tz=timezone.utc),
                ),
            )
            meta.cursor = end

        if not force_all:
            # 清理已过保留期的封口窗口，保证长时间运行内存有界。
            agg.purge_expired_windows()

    # ------------------------------------------------------------------ #
    # 结果
    # ------------------------------------------------------------------ #
    def query(
        self,
        funcs: str | Sequence[str] | None = None,
        time_range: TimeRange | None = None,
        tag_filter: TagFilter | None = None,
        metric_name: str | None = None,
    ) -> list[TimeSeriesPoint]:
        """查询报表聚合器中的时间序列。"""
        return self.query_aggregator.get_query_result(
            funcs or list(AGG_FUNCS), time_range, tag_filter, metric_name
        )

    def get_alerts(self) -> list[Alert]:
        return self.alert_engine.get_alerts()

    def take_new_alerts(self) -> list[Alert]:
        return self.alert_engine.take_new_alerts()
