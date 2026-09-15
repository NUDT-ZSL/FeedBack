"""翻转归因：为每条翻转的请求找出能解释翻转的最小规则差异集合。

算法：
1. 计算新旧策略的规则级差异集合 D（diff_policies）。
2. 若 D 为空但决策仍翻转 → UNATTRIBUTABLE（无法归因，说明存在外部状态
   或非确定性，绝不随便挑一条规则充当解释）。
3. 按子集大小从小到大枚举 D 的子集，把子集应用到旧策略上重放该请求；
   若重放结果等于新决策，则该子集是一个"最小解释"。第一层的所有命中
   子集即为全部最小解释（更小的子集都不足以复现新决策，保证极小性）。
4. 最小解释唯一 → ATTRIBUTED；存在多个互斥的最小解释 → AMBIGUOUS，
   列出全部候选并明确报告无法唯一归因。
5. 差异集合超过 MAX_EXHAUSTIVE_DIFFS 时枚举代价过高，退化为贪心约简，
   给出一个极小解释但标注 unique=False（未验证唯一性）。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from itertools import combinations
from typing import Optional, Tuple

from .diff import RuleDiff, apply_diffs, diff_policies
from .engine import Decision, DecisionTrace, evaluate
from .models import AccessRequest, Policy

#: 差异集合不超过该规模时穷举全部子集，保证归因结论经过完备验证
MAX_EXHAUSTIVE_DIFFS = 12


class ExplainStatus(Enum):
    ATTRIBUTED = "attributed"        # 已找到唯一最小差异集合
    AMBIGUOUS = "ambiguous"          # 存在多个互斥的最小解释，无法唯一归因
    UNATTRIBUTABLE = "unattributable"  # 差异集合为空等原因，无法归因
    NOT_FLIPPED = "not_flipped"      # 该请求决策未翻转，无需归因


@dataclass(frozen=True)
class Explanation:
    """一条翻转请求的归因结论。"""

    request_id: str
    status: ExplainStatus
    old_decision: Decision
    new_decision: Decision
    minimal_diffs: Tuple[RuleDiff, ...]          # ATTRIBUTED 时的最小差异集合
    candidates: Tuple[Tuple[RuleDiff, ...], ...]  # AMBIGUOUS 时的全部候选
    unique: bool
    reason: str

    def describe(self) -> str:
        header = f"请求 '{self.request_id}' 归因结果: {self.status.value}"
        return f"{header}\n{self.reason}"


def explain_flip(
    old_policy: Policy,
    new_policy: Policy,
    request: AccessRequest,
    diffs: Optional[Tuple[RuleDiff, ...]] = None,
) -> Explanation:
    """解释单条请求的决策翻转。diffs 可显式传入（默认自动计算）。"""
    old_trace = evaluate(old_policy, request)
    new_trace = evaluate(new_policy, request)
    old_dec, new_dec = old_trace.decision, new_trace.decision

    if old_dec == new_dec:
        return Explanation(
            request_id=request.request_id,
            status=ExplainStatus.NOT_FLIPPED,
            old_decision=old_dec,
            new_decision=new_dec,
            minimal_diffs=(),
            candidates=(),
            unique=True,
            reason=f"决策未翻转（{old_dec.describe()}），无需归因。",
        )

    if diffs is None:
        diffs = diff_policies(old_policy, new_policy)

    if not diffs:
        return Explanation(
            request_id=request.request_id,
            status=ExplainStatus.UNATTRIBUTABLE,
            old_decision=old_dec,
            new_decision=new_dec,
            minimal_diffs=(),
            candidates=(),
            unique=False,
            reason=(
                "规则差异集合为空：两套策略在规则与默认效果上完全一致，"
                "但同一请求的决策不同。评估器是确定性的，因此该不一致只能来自"
                "外部状态或调用方构造错误，无法归因到任何规则差异。"
            ),
        )

    def reproduces_new_decision(subset) -> bool:
        """子集应用到旧策略后，是否复现新决策。"""
        trial = apply_diffs(old_policy, subset)
        return evaluate(trial, request).decision == new_dec

    if len(diffs) <= MAX_EXHAUSTIVE_DIFFS:
        hitting = []
        for size in range(1, len(diffs) + 1):
            hitting = [s for s in combinations(diffs, size) if reproduces_new_decision(s)]
            if hitting:
                break
        # 全集必然复现新决策（apply_diffs(old, 全集) == new），hitting 不会为空
        if len(hitting) == 1:
            minimal = hitting[0]
            return Explanation(
                request_id=request.request_id,
                status=ExplainStatus.ATTRIBUTED,
                old_decision=old_dec,
                new_decision=new_dec,
                minimal_diffs=minimal,
                candidates=(minimal,),
                unique=True,
                reason=_build_reason(old_trace, new_trace, minimal),
            )
        return Explanation(
            request_id=request.request_id,
            status=ExplainStatus.AMBIGUOUS,
            old_decision=old_dec,
            new_decision=new_dec,
            minimal_diffs=(),
            candidates=tuple(hitting),
            unique=False,
            reason=_build_ambiguous_reason(old_trace, new_trace, hitting),
        )

    # 差异集合过大：贪心约简出一个极小解释，但不声称唯一
    minimal = _greedy_reduce(diffs, reproduces_new_decision)
    return Explanation(
        request_id=request.request_id,
        status=ExplainStatus.ATTRIBUTED,
        old_decision=old_dec,
        new_decision=new_dec,
        minimal_diffs=minimal,
        candidates=(minimal,),
        unique=False,
        reason=(
            _build_reason(old_trace, new_trace, minimal)
            + f"\n注意：差异集合共 {len(diffs)} 条，超过穷举上限 "
            f"{MAX_EXHAUSTIVE_DIFFS}，以上解释为贪心约简得到的极小集合，"
            "未验证唯一性。"
        ),
    )


def _greedy_reduce(diffs, reproduces) -> Tuple[RuleDiff, ...]:
    """贪心删除冗余差异，得到 1-极小集合（去掉任一元素都不再复现新决策）。"""
    current = list(diffs)
    changed = True
    while changed:
        changed = False
        for d in list(current):
            trial = [x for x in current if x is not d]
            if reproduces(trial):
                current = trial
                changed = True
    return tuple(current)


def _effective_change_sentence(old_trace: DecisionTrace, new_trace: DecisionTrace) -> str:
    old_eff = old_trace.decision.effective_rule_id
    new_eff = new_trace.decision.effective_rule_id
    if old_eff is None and new_eff is None:
        # 两侧都无规则命中：翻转只能来自默认效果差异
        return (
            f"两套策略下均无规则命中，请求始终走默认效果："
            f"{old_trace.decision.effect.value} → {new_trace.decision.effect.value}。"
        )
    old_part = (
        f"规则 '{old_eff}'" if old_eff is not None else "默认效果（无规则命中）"
    )
    new_part = (
        f"规则 '{new_eff}'" if new_eff is not None else "默认效果（无规则命中）"
    )
    if old_eff == new_eff:
        return f"生效规则仍为 '{old_eff}'，但其效果被差异直接修改。"
    return f"生效规则由 {old_part} 变为 {new_part}。"


def _build_reason(
    old_trace: DecisionTrace, new_trace: DecisionTrace, subset
) -> str:
    lines = [
        f"旧决策: {old_trace.decision.describe()}",
        f"新决策: {new_trace.decision.describe()}",
        _effective_change_sentence(old_trace, new_trace),
        "最小规则差异集合:",
    ]
    for d in subset:
        lines.append(f"  - {d.describe()}")
    return "\n".join(lines)


def _build_ambiguous_reason(old_trace, new_trace, hitting) -> str:
    lines = [
        f"旧决策: {old_trace.decision.describe()}",
        f"新决策: {new_trace.decision.describe()}",
        f"存在 {len(hitting)} 组互斥的最小差异集合，每组都能独立复现新决策，"
        "仅凭重放结果无法唯一归因。候选集合:",
    ]
    for i, subset in enumerate(hitting, 1):
        lines.append(f"  候选 {i}:")
        for d in subset:
            lines.append(f"    - {d.describe()}")
    return "\n".join(lines)
