"""批量重放与翻转分类。

翻转判定：新旧决策（效果 + 生效规则）任一不同即为翻转。
翻转分类：
- NEW_DENY   新增拒绝：旧决策非拒绝，新决策为拒绝
- NEW_ALLOW  新增放行：旧决策为拒绝，新决策非拒绝
- AUDIT_ONLY 仅审计变化：放行/拒绝结论未变，仅审计口径或生效规则变化
  （典型场景：优先级互换或条件重叠导致生效规则被同效果规则替换，
  或 ALLOW ↔ AUDIT 之间切换）
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Tuple

from .engine import Decision, evaluate
from .models import AccessRequest, Effect, Policy


class FlipType(Enum):
    NONE = "none"
    NEW_DENY = "new_deny"
    NEW_ALLOW = "new_allow"
    AUDIT_ONLY = "audit_only"


def classify_flip(old: Decision, new: Decision) -> FlipType:
    if old == new:
        return FlipType.NONE
    old_deny = old.effect is Effect.DENY
    new_deny = new.effect is Effect.DENY
    if not old_deny and new_deny:
        return FlipType.NEW_DENY
    if old_deny and not new_deny:
        return FlipType.NEW_ALLOW
    return FlipType.AUDIT_ONLY


@dataclass(frozen=True)
class RequestComparison:
    """单条请求的重放对比结果。"""

    request_id: str
    old_decision: Decision
    new_decision: Decision
    flipped: bool
    flip_type: FlipType
    effective_rule_changed: bool  # 生效规则被替换（含从默认效果变为规则命中）


@dataclass(frozen=True)
class FlipStats:
    """一次调整的整体翻转统计。各请求列表均按请求标识字典序排列。"""

    total: int
    flipped: int
    new_deny: int
    new_allow: int
    audit_only: int
    new_deny_requests: Tuple[str, ...]
    new_allow_requests: Tuple[str, ...]
    audit_only_requests: Tuple[str, ...]

    def describe(self) -> str:
        return (
            f"共 {self.total} 条请求，翻转 {self.flipped} 条："
            f"新增拒绝 {self.new_deny}，新增放行 {self.new_allow}，"
            f"仅审计变化 {self.audit_only}"
        )


@dataclass(frozen=True)
class ReplayResult:
    """一批请求的重放结果。comparisons 按请求标识字典序排列。"""

    comparisons: Tuple[RequestComparison, ...]
    stats: FlipStats

    def flipped_comparisons(self) -> Tuple[RequestComparison, ...]:
        return tuple(c for c in self.comparisons if c.flipped)


def replay(old_policy: Policy, new_policy: Policy, requests) -> ReplayResult:
    """对同一批请求分别用新旧两套策略重放，输出逐条对比与整体统计。"""
    ordered = sorted(requests, key=lambda r: r.request_id)
    comparisons = []
    for req in ordered:
        old_trace = evaluate(old_policy, req)
        new_trace = evaluate(new_policy, req)
        old_dec, new_dec = old_trace.decision, new_trace.decision
        flip_type = classify_flip(old_dec, new_dec)
        comparisons.append(
            RequestComparison(
                request_id=req.request_id,
                old_decision=old_dec,
                new_decision=new_dec,
                flipped=flip_type is not FlipType.NONE,
                flip_type=flip_type,
                effective_rule_changed=(
                    old_dec.effective_rule_id != new_dec.effective_rule_id
                ),
            )
        )
    stats = _build_stats(comparisons)
    return ReplayResult(comparisons=tuple(comparisons), stats=stats)


def _build_stats(comparisons) -> FlipStats:
    by_type = {
        FlipType.NEW_DENY: [],
        FlipType.NEW_ALLOW: [],
        FlipType.AUDIT_ONLY: [],
    }
    for c in comparisons:
        if c.flip_type in by_type:
            by_type[c.flip_type].append(c.request_id)
    flipped = sum(len(v) for v in by_type.values())
    return FlipStats(
        total=len(comparisons),
        flipped=flipped,
        new_deny=len(by_type[FlipType.NEW_DENY]),
        new_allow=len(by_type[FlipType.NEW_ALLOW]),
        audit_only=len(by_type[FlipType.AUDIT_ONLY]),
        new_deny_requests=tuple(by_type[FlipType.NEW_DENY]),
        new_allow_requests=tuple(by_type[FlipType.NEW_ALLOW]),
        audit_only_requests=tuple(by_type[FlipType.AUDIT_ONLY]),
    )
