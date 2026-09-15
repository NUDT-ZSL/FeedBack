"""影响评估内核门面：维护请求与两套策略，提供评估、重放、归因与查询。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Optional, Tuple

from .diff import diff_policies
from .engine import DecisionTrace, evaluate
from .errors import ValidationError
from .explain import MAX_EXHAUSTIVE_DIFFS, Explanation, explain_flip
from .models import AccessRequest, Effect, Policy
from .replay import FlipStats, ReplayResult, replay
from .schema import SUPPORTED_TYPES, check_value_type


@dataclass(frozen=True)
class RuleHit:
    """规则命中记录：某请求被该规则命中，以及该规则是否为生效规则。"""

    request_id: str
    is_effective: bool


class ImpactKernel:
    """影响评估内核。

    用法：
        kernel = ImpactKernel({"user": "str", "age": "int"})
        kernel.add_request("req-1", {"user": "alice", "age": 30})
        kernel.load_policy("old", old_rules)
        kernel.load_policy("new", new_rules)
        result = kernel.replay()
        explanation = kernel.explain_flip("req-1")
    """

    def __init__(self, attribute_schema: Dict[str, str],
                 default_effect: Effect = Effect.DENY,
                 max_exhaustive_diffs: int = MAX_EXHAUSTIVE_DIFFS):
        if not attribute_schema:
            raise ValidationError("属性模式", "至少声明一个属性")
        for name, type_name in attribute_schema.items():
            if type_name not in SUPPORTED_TYPES:
                raise ValidationError(
                    f"属性模式 属性 {name!r}",
                    f"不支持的类型 {type_name!r}，可选: {SUPPORTED_TYPES}",
                )
        if (not isinstance(max_exhaustive_diffs, int)
                or isinstance(max_exhaustive_diffs, bool)
                or max_exhaustive_diffs < 1):
            raise ValidationError(
                "归因配置", f"max_exhaustive_diffs 必须是正整数，实际为 {max_exhaustive_diffs!r}"
            )
        self._schema = dict(attribute_schema)
        self._default_effect = default_effect
        self._max_exhaustive_diffs = max_exhaustive_diffs
        self._requests: Dict[str, AccessRequest] = {}
        self._policies: Dict[str, Policy] = {}

    # ------------------------------------------------------------------
    # 只读访问器（公开接口，供查询与导出使用）
    # ------------------------------------------------------------------
    @property
    def attribute_schema(self) -> Dict[str, str]:
        return dict(self._schema)

    @property
    def default_effect(self) -> Effect:
        return self._default_effect

    @property
    def max_exhaustive_diffs(self) -> int:
        return self._max_exhaustive_diffs

    def get_request(self, request_id: str) -> AccessRequest:
        """按标识取请求；不存在时拒绝并指出位置。"""
        if request_id not in self._requests:
            raise ValidationError(
                "请求查询", f"请求 {request_id!r} 不存在，已有: {self.request_ids()}"
            )
        return self._requests[request_id]

    def get_policy(self, version: str) -> Policy:
        """按版本名取策略；未装载时拒绝并指出位置。"""
        if version not in self._policies:
            raise ValidationError(
                "策略查询", f"策略版本 {version!r} 未装载，已有: {sorted(self._policies)}"
            )
        return self._policies[version]

    def policy_versions(self) -> Tuple[str, ...]:
        return tuple(sorted(self._policies))

    def all_requests(self) -> Tuple[AccessRequest, ...]:
        return tuple(self._requests[rid] for rid in self.request_ids())

    # ------------------------------------------------------------------
    # 请求维护
    # ------------------------------------------------------------------
    def add_request(self, request_id: str, attributes: Dict) -> AccessRequest:
        """登记一条访问请求。属性缺失、类型非法、含未知属性都会被拒绝。"""
        loc = f"请求 {request_id!r}"
        if not isinstance(request_id, str) or not request_id:
            raise ValidationError("请求登记", "请求标识必须是非空字符串")
        if request_id in self._requests:
            raise ValidationError(loc, "请求标识重复")
        if not isinstance(attributes, dict):
            raise ValidationError(loc, "属性必须是字典")
        for name in self._schema:
            if name not in attributes:
                raise ValidationError(loc, f"缺少必需属性 {name!r}")
        for name, value in attributes.items():
            if name not in self._schema:
                raise ValidationError(loc, f"未知属性 {name!r}（属性模式中未声明）")
            expected = self._schema[name]
            if not check_value_type(value, expected):
                raise ValidationError(
                    loc,
                    f"属性 {name!r} 类型非法: 期望 {expected}，"
                    f"实际为 {type(value).__name__} 值 {value!r}",
                )
        request = AccessRequest(request_id=request_id, attributes=dict(attributes))
        self._requests[request_id] = request
        return request

    def add_requests(self, items: Iterable) -> Tuple[AccessRequest, ...]:
        return tuple(self.add_request(rid, attrs) for rid, attrs in items)

    def request_ids(self) -> Tuple[str, ...]:
        return tuple(sorted(self._requests))

    # ------------------------------------------------------------------
    # 策略维护
    # ------------------------------------------------------------------
    def load_policy(self, version: str, rules,
                    default_effect: Optional[Effect] = None) -> Policy:
        """装载一套策略。version 通常为 "old" / "new"，可任意命名。"""
        policy = Policy(
            list(rules),
            schema=self._schema,
            default_effect=default_effect or self._default_effect,
            name=version,
        )
        self._policies[version] = policy
        return policy

    # ------------------------------------------------------------------
    # 评估与重放
    # ------------------------------------------------------------------
    def decision_basis(self, request_id: str, version: str = "new") -> DecisionTrace:
        """查询任意请求在指定策略下的决策依据。"""
        return evaluate(self.get_policy(version), self.get_request(request_id))

    def replay(self, old_version: str = "old", new_version: str = "new") -> ReplayResult:
        """对全部请求分别用两套策略重放，结果按请求标识字典序返回。"""
        return replay(
            self.get_policy(old_version),
            self.get_policy(new_version),
            [self._requests[rid] for rid in self.request_ids()],
        )

    def explain_flip(self, request_id: str, old_version: str = "old",
                     new_version: str = "new") -> Explanation:
        """解释单条请求的决策翻转（最小规则差异集合归因）。"""
        return explain_flip(
            self.get_policy(old_version),
            self.get_policy(new_version),
            self.get_request(request_id),
            max_exhaustive=self._max_exhaustive_diffs,
        )

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------
    def rule_hits(self, rule_id: str, version: str = "new") -> Tuple[RuleHit, ...]:
        """查询任意规则命中的请求列表，按请求标识字典序返回。"""
        policy = self.get_policy(version)
        if policy.get(rule_id) is None:
            raise ValidationError(
                "规则查询", f"规则 {rule_id!r} 在策略 {version!r} 中不存在"
            )
        hits = []
        for rid in self.request_ids():
            trace = evaluate(policy, self._requests[rid])
            if rule_id in trace.matched_rule_ids:
                hits.append(
                    RuleHit(
                        request_id=rid,
                        is_effective=(trace.decision.effective_rule_id == rule_id),
                    )
                )
        return tuple(hits)

    def flip_stats(self, old_version: str = "old",
                   new_version: str = "new") -> FlipStats:
        """查询某次调整的整体翻转统计。"""
        return self.replay(old_version, new_version).stats

    def policy_diff(self, old_version: str = "old",
                    new_version: str = "new"):
        """查询两套策略的规则级差异，按稳定顺序返回。"""
        return diff_policies(self.get_policy(old_version), self.get_policy(new_version))

    # ------------------------------------------------------------------
    # 导出 / 导入（可往返序列化，详见 serde 模块）
    # ------------------------------------------------------------------
    def export(self) -> Dict:
        """把内核完整状态（模式、请求、策略、默认效果、归因配置）导出为字典。"""
        from .serde import export_kernel
        return export_kernel(self)

    @classmethod
    def import_data(cls, data: Dict) -> "ImpactKernel":
        """从导出的字典重建内核。损坏或字段缺失的输入会被拒绝，
        且失败不会改动任何已有内核的内存状态（导入产出的是新实例）。"""
        from .serde import kernel_from_dict
        return kernel_from_dict(data)
