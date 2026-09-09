"""数据模型：指标事件、时间序列查询点、告警记录。"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping


# --------------------------------------------------------------------------- #
# 时间戳工具
# --------------------------------------------------------------------------- #
def parse_timestamp(value: Any) -> datetime:
    """把 ISO 8601 字符串（或 ``datetime``）解析为带 UTC 时区的 ``datetime``。

    兼容尾部 ``Z`` 与秒以下精度；非法输入抛出 :class:`ValueError`。
    """
    if isinstance(value, datetime):
        dt = value
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError("timestamp 为空字符串")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"非法 ISO 8601 时间戳: {value!r}") from exc
    else:
        raise ValueError(f"timestamp 必须是字符串，实际类型 {type(value).__name__}")

    if dt.tzinfo is None:
        # 业务约定时间戳一律为 UTC，裸时间戳按 UTC 处理。
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    """UTC datetime -> 规范 ISO 8601 字符串（毫秒精度，Z 结尾）。"""
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


# --------------------------------------------------------------------------- #
# 指标事件
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class MetricEvent:
    """一条指标上报事件。

    :param metric_name: 指标名，如 ``cpu_usage``。
    :param value: 数值，必须是有限浮点数（非 NaN / Inf）。
    :param timestamp: 事件时间，UTC。
    :param tags: 维度标签，键值均为非空字符串。
    """

    metric_name: str
    value: float
    timestamp: datetime
    tags: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not isinstance(self.metric_name, str) or not self.metric_name.strip():
            raise ValueError("metric_name 必须是非空字符串")
        if not isinstance(self.value, (int, float)) or isinstance(self.value, bool):
            raise ValueError("value 必须是数值（int/float，不接受 bool）")
        value = float(self.value)
        if not math.isfinite(value):
            raise ValueError(f"value 必须是有限浮点数，实际 {self.value!r}")
        object.__setattr__(self, "value", value)
        if not isinstance(self.timestamp, datetime) or self.timestamp.tzinfo is None:
            raise ValueError("timestamp 必须是带时区信息的 datetime")
        tags = dict(self.tags)
        coerced: dict[str, str] = {}
        for k, v in tag_items(tags):
            if not isinstance(k, str) or not k.strip():
                raise ValueError("tags 的键必须是非空字符串")
            if not isinstance(v, str) or not v.strip():
                raise ValueError(f"tags[{k!r}] 的值必须是非空字符串")
            coerced[k] = v
        # 冻结后使用固定的普通 dict，数字标签值已归一化为字符串。
        object.__setattr__(self, "tags", coerced)

    # -- 序列化 ------------------------------------------------------------- #
    def to_dict(self) -> dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "value": self.value,
            "timestamp": iso(self.timestamp),
            "tags": dict(self.tags),
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "MetricEvent":
        """从普通 dict 构造事件；字段缺失或类型错误时抛 :class:`ValueError`。"""
        if not isinstance(data, Mapping):
            raise ValueError("事件必须是 JSON 对象")
        missing = [f for f in ("metric_name", "value", "timestamp") if f not in data]
        if missing:
            raise ValueError(f"事件缺少必填字段: {', '.join(missing)}")
        tags = data.get("tags", {})
        if tags is None:
            tags = {}
        if not isinstance(tags, Mapping):
            raise ValueError("tags 必须是对象 {键: 值}")
        return cls(
            metric_name=data["metric_name"],
            value=data["value"],
            timestamp=parse_timestamp(data["timestamp"]),
            tags=tags,
        )


def tag_items(tags: Mapping[str, Any]) -> list[tuple[str, str]]:
    """遍历标签，顺便把整型标签值归一化为字符串（JSON 里常见）。"""
    items: list[tuple[str, str]] = []
    for k, v in tags.items():
        if isinstance(v, bool):
            raise ValueError(f"tags[{k!r}] 的值不能是 bool")
        if isinstance(v, (int, float)):
            v = str(v)
        items.append((k, v))
    return items


# --------------------------------------------------------------------------- #
# 查询结果 / 告警
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class TimeSeriesPoint:
    """聚合查询返回的一个时间序列点。"""

    timestamp: datetime
    tags: Mapping[str, str]
    value: float | None
    metric_name: str
    func: str
    window_start: datetime
    window_end: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric_name": self.metric_name,
            "func": self.func,
            "timestamp": iso(self.timestamp),
            "window_start": iso(self.window_start),
            "window_end": iso(self.window_end),
            "key_tags": dict(self.tags),
            "value": round2(self.value),
        }


@dataclass(frozen=True, slots=True)
class Alert:
    """一条告警记录（触发或恢复）。

    ``status`` 取值 ``firing`` / ``resolved``；``alert_id`` 对同一条
    规则的同一标签组在整个生命周期内保持稳定，恢复记录复用该 ID。
    """

    alert_id: str
    rule_id: str
    metric_name: str
    window_start: datetime
    window_end: datetime
    value: float
    threshold: float
    channel: str
    status: str = "firing"
    tags: Mapping[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "alert_id": self.alert_id,
            "rule_id": self.rule_id,
            "metric_name": self.metric_name,
            "status": self.status,
            "window_start": iso(self.window_start),
            "window_end": iso(self.window_end),
            "value": round2(self.value),
            "threshold": self.threshold,
            "channel": self.channel,
            "tags": dict(self.tags),
        }


def round2(value: float | None) -> float | None:
    """输出时统一保留 6 位小数以内，避免二进制浮点尾差影响验收比对。"""
    if value is None:
        return None
    return round(value, 6)
