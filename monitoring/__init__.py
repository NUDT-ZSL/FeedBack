"""监控引擎核心包。

模块划分::

    models      数据模型（MetricEvent / TimeSeriesPoint / Alert）
    aggregator  时间窗口聚合与多维标签索引
    rules       告警规则模型、解析与校验
    alerting    告警引擎（状态机、去抖、恢复通知）
    sources     可替换事件源（文件 / 标准输入 / 内存迭代）
    engine      编排层（事件源 -> 聚合器 -> 告警引擎，watermark 触发）
"""

from .models import Alert, MetricEvent, TimeSeriesPoint
from .aggregator import TagFilter, TimeRange, WindowAggregator, WindowConfig
from .rules import AlertRule, RuleError, load_rules
from .alerting import AlertEngine
from .sources import EventSource, FileEventSource, IterableEventSource, StdinEventSource
from .engine import MonitoringEngine

__all__ = [
    "Alert",
    "MetricEvent",
    "TimeSeriesPoint",
    "TagFilter",
    "TimeRange",
    "WindowAggregator",
    "WindowConfig",
    "AlertRule",
    "RuleError",
    "load_rules",
    "AlertEngine",
    "EventSource",
    "FileEventSource",
    "StdinEventSource",
    "IterableEventSource",
    "MonitoringEngine",
]
