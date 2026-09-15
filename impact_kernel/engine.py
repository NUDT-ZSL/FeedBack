"""评估引擎：对单条请求在给定策略下求出唯一决策。

评估规则（文档化语义）：
1. 仅考虑启用状态的规则；
2. 条件匹配的规则构成候选集，按 (优先级降序, 规则标识字典序升序) 排序；
3. 候选集首位即唯一生效规则，其效果为决策效果；
4. 候选集为空时，按策略声明的默认效果处理（used_default=True）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

from .models import AccessRequest, Effect, Policy


@dataclass(frozen=True)
class Decision:
    """一次判定的结果。两条 Decision 相等即视为决策未翻转。"""

    effect: Effect
    effective_rule_id: Optional[str]  # None 表示走了默认效果
    used_default: bool

    def describe(self) -> str:
        if self.used_default:
            return f"效果={self.effect.value}（无规则命中，按默认效果处理）"
        return f"效果={self.effect.value}（生效规则 '{self.effective_rule_id}'）"


@dataclass(frozen=True)
class DecisionTrace:
    """决策依据：最终决策 + 全部命中规则（按生效优先顺序）。"""

    request_id: str
    decision: Decision
    matched_rule_ids: Tuple[str, ...]

    @property
    def effect(self) -> Effect:
        return self.decision.effect

    @property
    def effective_rule_id(self) -> Optional[str]:
        return self.decision.effective_rule_id

    def describe(self) -> str:
        lines = [f"请求 '{self.request_id}' 决策依据:", f"  决策: {self.decision.describe()}"]
        if self.matched_rule_ids:
            lines.append("  命中规则（按生效优先顺序）: " + ", ".join(self.matched_rule_ids))
        else:
            lines.append("  命中规则: 无")
        return "\n".join(lines)


def evaluate(policy: Policy, request: AccessRequest) -> DecisionTrace:
    """对单条请求求值，返回完整决策依据。"""
    matched = [
        r
        for r in policy.rules
        if r.enabled and r.condition.matches(request.attributes)
    ]
    matched.sort(key=lambda r: (-r.priority, r.rule_id))
    if matched:
        effective = matched[0]
        decision = Decision(
            effect=effective.effect,
            effective_rule_id=effective.rule_id,
            used_default=False,
        )
    else:
        decision = Decision(
            effect=policy.default_effect,
            effective_rule_id=None,
            used_default=True,
        )
    return DecisionTrace(
        request_id=request.request_id,
        decision=decision,
        matched_rule_ids=tuple(r.rule_id for r in matched),
    )
