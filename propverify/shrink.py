"""确定性反例收缩。

对违反不变量的输入，逐字段按取值域给出的固定候选序列尝试更小的值：
候选仍违反原不变量且满足全部约束时才被接受。整个过程只依赖
(输入, 不变量, 取值域, 约束)，不依赖任何随机源，因此结果必然可复现；
每一步都记录人类可读依据，最终收缩结果会被复验确实仍违反不变量。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional

from .gencfg import GenConfig


@dataclass
class ShrinkStep:
    field: str
    old: object
    new: object
    reason: str

    def describe(self) -> str:
        return f"字段 {self.field}: {self.old!r} -> {self.new!r}（{self.reason}）"


@dataclass
class ShrinkResult:
    original: dict
    shrunk: dict
    steps: List[ShrinkStep] = field(default_factory=list)
    verified: bool = False  # 收缩结果复验仍违反原不变量

    def trace(self) -> List[str]:
        lines = [f"原始反例: {self.original!r}"]
        lines += [f"  第{i+1}步 {s.describe()}" for i, s in enumerate(self.steps)]
        lines.append(f"最小反例: {self.shrunk!r}（复验仍违反: {'是' if self.verified else '否'}）")
        return lines


def shrink_input(
    cfg: GenConfig,
    target: str,
    values: dict,
    violates: Callable[[dict], bool],
    max_steps: int = 500,
) -> ShrinkResult:
    """把违反不变量的 values 收缩为更小的反例。

    violates: 返回 True 表示该输入仍违反不变量。
    """
    ocfg = cfg.object_config(target)
    current = dict(values)
    steps: List[ShrinkStep] = []

    def acceptable(candidate: dict) -> bool:
        # 收缩不能逃出约束：逃出约束的输入本应被跳过，不是有效反例。
        if cfg.constraints_ok(target, candidate) is not None:
            return False
        try:
            return bool(violates(candidate))
        except Exception:
            return False

    improved = True
    while improved and len(steps) < max_steps:
        improved = False
        for name in sorted(ocfg.fields):
            domain = ocfg.fields[name].domain
            for cand, why in domain.shrink(current[name]):
                if not domain.contains(cand):
                    continue
                trial = dict(current)
                trial[name] = cand
                if acceptable(trial):
                    steps.append(ShrinkStep(field=name, old=current[name], new=cand, reason=why))
                    current = trial
                    improved = True
                    break
            if improved:
                break

    verified = acceptable(current)
    return ShrinkResult(original=dict(values), shrunk=current, steps=steps, verified=verified)
