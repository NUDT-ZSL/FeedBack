"""告警规则模型、JSON 解析与校验。

规则 JSON 示例::

    {
      "id": "cpu_high",
      "metric_name": "cpu_usage",
      "agg_func": "avg",
      "window_seconds": 60,
      "slide_seconds": 60,
      "operator": ">",
      "threshold": 80.0,
      "duration_windows": 2,
      "tags": {"service": "auth", "region": "cn-*"},
      "channel": "email:ops@example.com"
    }
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Mapping

from .aggregator import AGG_FUNCS, TagFilter

OPERATORS: frozenset[str] = frozenset({">", ">=", "<", "<=", "==", "!="})


class RuleError(ValueError):
    """规则定义非法（缺字段、类型错误、取值越界等）。"""


@dataclass(frozen=True, slots=True)
class AlertRule:
    """一条告警规则。

    :param id: 规则唯一 ID。
    :param metric_name: 监控的指标名。
    :param agg_func: 聚合函数 sum/avg/min/max/count。
    :param window_seconds: 评估窗口长度（秒）。
    :param slide_seconds: 滑动步长（秒），默认等于窗口长度（固定窗口）。
    :param operator: 比较运算符 > >= < <= == !=。
    :param threshold: 阈值（有限数值）。
    :param duration_windows: 连续多少个窗口满足条件才触发；恢复同理。
    :param tags: 标签过滤器，支持精确匹配与 ``*``/``?`` 通配符。
    :param channel: 通知渠道，仅记录（如 ``email:x``、``webhook:http://...``）。
    """

    id: str
    metric_name: str
    agg_func: str
    window_seconds: int
    slide_seconds: int
    operator: str
    threshold: float
    duration_windows: int
    tags: Mapping[str, str] = field(default_factory=dict)
    channel: str = "log"

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id.strip():
            raise RuleError("规则 id 必须是非空字符串")
        if not isinstance(self.metric_name, str) or not self.metric_name.strip():
            raise RuleError(f"规则 {self.id!r}: metric_name 必须是非空字符串")
        if self.agg_func not in AGG_FUNCS:
            raise RuleError(f"规则 {self.id!r}: agg_func 必须是 {AGG_FUNCS} 之一")
        if not isinstance(self.window_seconds, int) or self.window_seconds <= 0:
            raise RuleError(f"规则 {self.id!r}: window_seconds 必须是正整数")
        if not isinstance(self.slide_seconds, int) or self.slide_seconds <= 0:
            raise RuleError(f"规则 {self.id!r}: slide_seconds 必须是正整数")
        if self.slide_seconds > self.window_seconds or self.window_seconds % self.slide_seconds != 0:
            raise RuleError(
                f"规则 {self.id!r}: slide_seconds 必须整除 window_seconds 且不大于它"
            )
        if self.operator not in OPERATORS:
            raise RuleError(f"规则 {self.id!r}: operator 必须是 {sorted(OPERATORS)} 之一")
        if isinstance(self.threshold, bool) or not isinstance(self.threshold, (int, float)):
            raise RuleError(f"规则 {self.id!r}: threshold 必须是数值")
        if not math.isfinite(float(self.threshold)):
            raise RuleError(f"规则 {self.id!r}: threshold 必须是有限数值")
        if not isinstance(self.duration_windows, int) or self.duration_windows <= 0:
            raise RuleError(f"规则 {self.id!r}: duration_windows 必须是正整数")
        if not isinstance(self.channel, str) or not self.channel.strip():
            raise RuleError(f"规则 {self.id!r}: channel 必须是非空字符串")
        if not isinstance(self.tags, Mapping):
            raise RuleError(f"规则 {self.id!r}: tags 必须是对象")
        for k, v in self.tags.items():
            if not isinstance(k, str) or not isinstance(v, str):
                raise RuleError(f"规则 {self.id!r}: tags 的键值必须都是字符串")
        object.__setattr__(self, "threshold", float(self.threshold))

    @property
    def tag_filter(self) -> TagFilter:
        return TagFilter.from_mapping(self.tags)

    # ------------------------------------------------------------------ #
    # 解析
    # ------------------------------------------------------------------ #
    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "AlertRule":
        """从普通 dict（解析后的 JSON）构造规则，字段名同时兼容若干常见别名。"""
        if not isinstance(data, Mapping):
            raise RuleError("规则必须是 JSON 对象")
        ident = _first(data, ("id", "rule_id"))
        try:
            raw_window = _require_number_int(
                data, ("window_seconds", "window_size", "window"), ident
            )
            raw_slide = data.get("slide_seconds", raw_window)
            if "slide_seconds" not in data and "window_type" in data and data["window_type"] == "sliding":
                raw_slide = max(1, raw_window // 5)
            rule = cls(
                id=ident,
                metric_name=_first(data, ("metric_name", "metric")),
                agg_func=_first(data, ("agg_func", "function", "func")),
                window_seconds=raw_window,
                slide_seconds=_coerce_int(raw_slide, "slide_seconds", ident),
                operator=str(_first(data, ("operator", "op"))),
                threshold=data.get("threshold"),
                duration_windows=_coerce_int(
                    data.get("duration_windows", 1), "duration_windows", ident
                ),
                tags=dict(data.get("tags", {}) or {}),
                channel=str(data.get("channel", "log")),
            )
        except RuleError:
            raise
        except (TypeError, ValueError) as exc:
            raise RuleError(f"规则 {ident!r} 解析失败: {exc}") from exc
        return rule

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "metric_name": self.metric_name,
            "agg_func": self.agg_func,
            "window_seconds": self.window_seconds,
            "slide_seconds": self.slide_seconds,
            "operator": self.operator,
            "threshold": self.threshold,
            "duration_windows": self.duration_windows,
            "tags": dict(self.tags),
            "channel": self.channel,
        }


# --------------------------------------------------------------------------- #
# 批量加载
# --------------------------------------------------------------------------- #
def load_rules(payload: Any) -> tuple[list[AlertRule], list[str]]:
    """解析规则文件内容。

    :param payload: 已解析的 JSON（list 或 ``{"rules": [...]}``），也接受原始
        JSON 字符串。
    :returns: ``(rules, errors)``，非法规则收集到 errors 中跳过，不影响其它规则。
    """
    if isinstance(payload, str):
        import json

        try:
            payload = json.loads(payload)
        except json.JSONDecodeError as exc:
            return [], [f"规则 JSON 语法错误: {exc}"]

    raw_rules: list[Any]
    if isinstance(payload, Mapping) and "rules" in payload:
        raw_rules = list(payload["rules"])
    elif isinstance(payload, list):
        raw_rules = list(payload)
    else:
        return [], ["规则文件必须是规则数组或 {'rules': [...]} 对象"]

    rules: list[AlertRule] = []
    errors: list[str] = []
    seen: set[str] = set()
    for index, raw in enumerate(raw_rules):
        try:
            rule = AlertRule.from_dict(raw)
        except RuleError as exc:
            errors.append(f"第 {index} 条规则被跳过: {exc}")
            continue
        if rule.id in seen:
            errors.append(f"第 {index} 条规则被跳过: 规则 id 重复 {rule.id!r}")
            continue
        seen.add(rule.id)
        rules.append(rule)
    return rules, errors


# --------------------------------------------------------------------------- #
# 小工具
# --------------------------------------------------------------------------- #
def _first(data: Mapping[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        if key in data and data[key] is not None:
            return data[key]
    raise RuleError(f"缺少必填字段 {keys[0]!r}（规则数据: {dict(data)!r:.200}）")


def _require_number_int(data: Mapping[str, Any], keys: tuple[str, ...], ident: Any) -> int:
    value = _first(data, keys)
    return _coerce_int(value, keys[0], ident)


def _coerce_int(value: Any, field_name: str, ident: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        raise RuleError(f"规则 {ident!r}: {field_name} 必须是整数，实际 {value!r}")
    return value
