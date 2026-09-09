"""告警评估引擎。

状态机（每个 ``规则 × 标签组`` 一份）::

    ok ──连续 N 个窗口满足条件──▶ firing（产生 status=firing 记录）
    ▲                                   │
    └────────条件不满足（含无数据）──────┘（产生 status=resolved 记录）

* ``duration_windows`` 即连续满足阈值的窗口数 N，窗口内不满足会立即把计数清零。
* 同一规则同一标签组在 firing 状态下不会重复告警；条件恢复的下一个窗口产生
  一条 ``resolved`` 记录，``alert_id`` 在整个生命周期内保持稳定，便于关联。
* 规则可在运行中动态增删（:meth:`AlertEngine.load_rules`），无需重启。
"""

from __future__ import annotations

import hashlib
import operator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable, Mapping

from .models import Alert
from .rules import AlertRule, load_rules

_COMPARATORS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "!=": operator.ne,
}

GroupKey = tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class WindowEval:
    """一个已封口窗口内、某个指标某个标签组的评估输入。

    :param values: 各聚合函数在该窗口的值（``func -> value``）。
    """

    metric_name: str
    window_start: datetime
    window_end: datetime
    tags: Mapping[str, str]
    values: Mapping[str, float]


@dataclass(slots=True)
class _RuleState:
    streak: int = 0
    firing: bool = False
    alert_id: str = ""
    last_value: float | None = None


class AlertEngine:
    """告警规则评估器。线程模型：单线程驱动（与聚合器相同）。"""

    def __init__(self, rules: list[AlertRule] | AlertRule | None = None) -> None:
        self._rules: dict[str, AlertRule] = {}
        self._states: dict[tuple[str, GroupKey], _RuleState] = {}
        self._alerts: list[Alert] = []
        self._new_alert_cursor = 0
        self.rule_errors: list[str] = []
        if rules is not None:
            self.load_rules(rules)

    # ------------------------------------------------------------------ #
    # 规则管理（支持动态加载）
    # ------------------------------------------------------------------ #
    def load_rules(self, payload: Any) -> tuple[int, list[str]]:
        """加载/更新规则。

        接受规则列表、单条规则、``{"rules": [...]}`` 或 JSON 字符串。
        同 ID 规则被替换并重置其评估状态；非法规则收集到错误列表中跳过，
        不影响已有规则与其他新规则。

        :returns: ``(成功加载条数, 错误信息列表)``。
        """
        if isinstance(payload, AlertRule):
            candidates = [payload]
            errors: list[str] = []
        elif isinstance(payload, list) and all(isinstance(r, AlertRule) for r in payload):
            candidates = list(payload)
            errors = []
        else:
            candidates, errors = load_rules(payload)

        added = 0
        replaced = 0
        for rule in candidates:
            if rule.id in self._rules:
                replaced += 1
                # 阈值/窗口等定义变化，旧状态不再有意义。
                self._states = {
                    key: state for key, state in self._states.items() if key[0] != rule.id
                }
            self._rules[rule.id] = rule
            added += 1
        self.rule_errors.extend(errors)
        if replaced:
            errors = errors + [f"{replaced} 条同名规则被更新并重置状态"]
        return added, errors

    def remove_rule(self, rule_id: str) -> bool:
        """运行中删除一条规则；返回是否删除成功。"""
        existed = self._rules.pop(rule_id, None) is not None
        self._states = {key: state for key, state in self._states.items() if key[0] != rule_id}
        return existed

    @property
    def rules(self) -> list[AlertRule]:
        return list(self._rules.values())

    # ------------------------------------------------------------------ #
    # 评估
    # ------------------------------------------------------------------ #
    def evaluate_window(
        self,
        window_result: WindowEval | Iterable[WindowEval],
        *,
        tick_rules: list[AlertRule] | None = None,
        tick_window: tuple[datetime, datetime] | None = None,
    ) -> list[Alert]:
        """评估一个窗口时钟上的全部切片，返回本次新产生的告警记录。

        :param window_result: 单个 :class:`WindowEval` 或其可迭代对象（本窗口
            实际有数据的标签组）。
        :param tick_rules: 该窗口时钟上需要“空跳”的规则：对于此前出现过、
            但本窗口没有数据的标签组，按条件不满足处理（连续计数清零，
            必要时产生 resolved）。这样数据空洞不会被误判为持续满足。
        :param tick_window: 空跳时使用的 ``(start, end)``；默认取首个切片的窗口。
        """
        if isinstance(window_result, WindowEval):
            slices = [window_result]
        else:
            slices = list(window_result)

        produced: list[Alert] = []
        present: set[tuple[str, GroupKey]] = set()
        for slice_ in slices:
            for rule in self._rules_for(slice_.metric_name):
                group_key = self._group_key(rule, slice_.tags)
                if not rule.tag_filter.matches(slice_.tags):
                    # 标签不再匹配（动态标签集场景）：不评估也不恢复。
                    continue
                present.add((rule.id, group_key))
                produced.extend(self._evaluate_one(rule, group_key, slice_))

        if tick_rules:
            if tick_window is None:
                if not slices:
                    return self._record(produced)
                tick_window = (slices[0].window_start, slices[0].window_end)
            for rule in tick_rules:
                for (rule_id, group_key), state in self._states.items():
                    if rule_id != rule.id or (rule.id, group_key) in present:
                        continue
                    empty_slice = WindowEval(
                        metric_name=rule.metric_name,
                        window_start=tick_window[0],
                        window_end=tick_window[1],
                        tags=dict(group_key),
                        values={},
                    )
                    produced.extend(self._evaluate_one(rule, group_key, empty_slice))

        return self._record(produced)

    def _record(self, alerts: list[Alert]) -> list[Alert]:
        self._alerts.extend(alerts)
        return alerts

    def _rules_for(self, metric_name: str) -> list[AlertRule]:
        return [r for r in self._rules.values() if r.metric_name == metric_name]

    def _evaluate_one(
        self, rule: AlertRule, group_key: GroupKey, slice_: WindowEval
    ) -> list[Alert]:
        state = self._states.setdefault((rule.id, group_key), _RuleState())
        value = slice_.values.get(rule.agg_func)
        state.last_value = value if value is not None else state.last_value

        met = value is not None and _COMPARATORS[rule.operator](value, rule.threshold)
        if met:
            state.streak += 1
        else:
            state.streak = 0

        alerts: list[Alert] = []
        now_kwargs = dict(
            rule_id=rule.id,
            metric_name=rule.metric_name,
            window_start=slice_.window_start,
            window_end=slice_.window_end,
            threshold=rule.threshold,
            channel=rule.channel,
            tags=dict(slice_.tags),
        )

        if state.streak >= rule.duration_windows and not state.firing:
            if not state.alert_id:
                state.alert_id = self._make_alert_id(rule.id, group_key)
            state.firing = True
            alerts.append(
                Alert(
                    alert_id=state.alert_id,
                    value=value if value is not None else 0.0,
                    status="firing",
                    **now_kwargs,
                )
            )
        elif state.streak == 0 and state.firing:
            # 条件恢复：resolved 记录复用上一条告警的 id。
            state.firing = False
            alerts.append(
                Alert(
                    alert_id=state.alert_id,
                    value=value if value is not None else (state.last_value or 0.0),
                    status="resolved",
                    **now_kwargs,
                )
            )
        return alerts

    @staticmethod
    def _make_alert_id(rule_id: str, group_key: GroupKey) -> str:
        digest = hashlib.md5(
            ("\x1f".join(f"{k}={v}" for k, v in group_key)).encode("utf-8")
        ).hexdigest()[:12]
        suffix = f"-{digest}" if group_key else ""
        return f"{rule_id}{suffix}"

    @staticmethod
    def _group_key(rule: AlertRule, tags: Mapping[str, str]) -> GroupKey:
        # 按规则涉及的全部标签分组：过滤键相同、通配值不同的系列互不干扰。
        keys = set(rule.tags)
        return tuple(sorted((k, tags[k]) for k in keys if k in tags))

    # ------------------------------------------------------------------ #
    # 结果读取
    # ------------------------------------------------------------------ #
    def get_alerts(self) -> list[Alert]:
        """返回截至目前的全部告警记录。"""
        return list(self._alerts)

    def take_new_alerts(self) -> list[Alert]:
        """取出自上次调用以来新增的告警（交互模式增量输出用）。"""
        fresh = self._alerts[self._new_alert_cursor:]
        self._new_alert_cursor = len(self._alerts)
        return list(fresh)

    def active_alerts(self) -> list[dict[str, Any]]:
        """当前仍处于 firing 状态（尚未恢复）的告警摘要。"""
        active: list[dict[str, Any]] = []
        for (rule_id, _group), state in self._states.items():
            if state.firing:
                rule = self._rules.get(rule_id)
                if rule is not None:
                    active.append(
                        {
                            "alert_id": state.alert_id,
                            "rule_id": rule.id,
                            "metric_name": rule.metric_name,
                            "status": "firing",
                            "last_value": state.last_value,
                            "threshold": rule.threshold,
                            "channel": rule.channel,
                        }
                    )
        return active
