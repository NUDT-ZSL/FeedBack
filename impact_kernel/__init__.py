"""影响评估内核：策略调整对历史访问请求的影响分析。

纯标准库实现，可完全离线运行。
"""

from .diff import DiffKind, RuleDiff, apply_diffs, diff_policies
from .engine import Decision, DecisionTrace, evaluate
from .errors import ValidationError
from .explain import Explanation, ExplainStatus, explain_flip
from .kernel import ImpactKernel, RuleHit
from .models import AccessRequest, Clause, Condition, Effect, Policy, Rule
from .replay import (
    FlipStats,
    FlipType,
    ReplayResult,
    RequestComparison,
    classify_flip,
    replay,
)
from .serde import (
    FORMAT_VERSION,
    export_kernel,
    kernel_from_dict,
    kernel_from_json,
    kernel_to_json,
)

__all__ = [
    "AccessRequest",
    "Clause",
    "Condition",
    "Decision",
    "DecisionTrace",
    "DiffKind",
    "Effect",
    "Explanation",
    "ExplainStatus",
    "FORMAT_VERSION",
    "FlipStats",
    "FlipType",
    "ImpactKernel",
    "Policy",
    "ReplayResult",
    "RequestComparison",
    "Rule",
    "RuleDiff",
    "RuleHit",
    "ValidationError",
    "apply_diffs",
    "classify_flip",
    "diff_policies",
    "evaluate",
    "explain_flip",
    "export_kernel",
    "kernel_from_dict",
    "kernel_from_json",
    "kernel_to_json",
    "replay",
]
