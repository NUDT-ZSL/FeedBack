"""核心数据模型：效果、条件、规则、访问请求、策略。

语义约定（与 README 一致）：
- 效果 Effect 有三种：ALLOW 放行、DENY 拒绝、AUDIT 仅审计（放行但记录，
  不改变放行/拒绝结论，只影响审计口径）。
- 条件 Condition 是若干子句的合取（AND）；空条件匹配一切请求。
- 规则优先级为整数，数值越大优先级越高；同优先级按规则标识字典序，
  字典序较小者生效。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Optional, Tuple

from .errors import ValidationError
from .schema import SUPPORTED_TYPES, check_value_type


class Effect(Enum):
    """规则效果。AUDIT 视为放行类结果，但审计口径与 ALLOW 不同。"""

    ALLOW = "allow"
    DENY = "deny"
    AUDIT = "audit"

    @classmethod
    def parse(cls, raw: Any) -> "Effect":
        if isinstance(raw, cls):
            return raw
        try:
            return cls(str(raw).strip().lower())
        except ValueError:
            raise ValidationError(
                "effect", f"非法效果 {raw!r}，可选值: allow / deny / audit"
            ) from None


#: 条件子句支持的比较操作符
OPERATORS = ("eq", "ne", "lt", "le", "gt", "ge", "in")

#: 允许使用大小比较（lt/le/gt/ge）的属性类型
_ORDERABLE_TYPES = ("int", "float", "str")


@dataclass(frozen=True)
class Clause:
    """单个条件子句：attribute op value。"""

    attribute: str
    op: str
    value: Any

    def matches(self, attributes: Dict[str, Any]) -> bool:
        if self.attribute not in attributes:
            return False
        actual = attributes[self.attribute]
        op = self.op
        if op == "eq":
            return actual == self.value
        if op == "ne":
            return actual != self.value
        if op == "lt":
            return actual < self.value
        if op == "le":
            return actual <= self.value
        if op == "gt":
            return actual > self.value
        if op == "ge":
            return actual >= self.value
        if op == "in":
            return actual in self.value
        raise ValidationError("条件子句", f"不支持的操作符 {op!r}")  # 构造时已校验，防御性兜底

    def describe(self) -> str:
        return f"{self.attribute} {self.op} {self.value!r}"


@dataclass(frozen=True)
class Condition:
    """匹配条件：子句的合取。空条件匹配一切请求。"""

    clauses: Tuple[Clause, ...] = ()

    def matches(self, attributes: Dict[str, Any]) -> bool:
        return all(c.matches(attributes) for c in self.clauses)

    def describe(self) -> str:
        if not self.clauses:
            return "(恒真)"
        return " AND ".join(c.describe() for c in self.clauses)

    @staticmethod
    def always() -> "Condition":
        return Condition(())


@dataclass(frozen=True)
class Rule:
    """一条策略规则。"""

    rule_id: str
    priority: int
    condition: Condition
    effect: Effect
    enabled: bool = True

    def describe(self) -> str:
        state = "启用" if self.enabled else "停用"
        return (
            f"规则 '{self.rule_id}'(优先级={self.priority}, 效果={self.effect.value}, "
            f"{state}, 条件: {self.condition.describe()})"
        )


@dataclass(frozen=True)
class AccessRequest:
    """一条访问请求：唯一标识 + 属性集合。"""

    request_id: str
    attributes: Dict[str, Any] = field(default_factory=dict)


def validate_rule(rule: Rule, schema: Dict[str, str], location: str) -> None:
    """校验单条规则。条件引用不存在的属性、类型不符等都会在此被拒绝。"""
    loc = f"{location} 规则 {rule.rule_id!r}"
    if not isinstance(rule.rule_id, str) or not rule.rule_id:
        raise ValidationError(location, "规则标识必须是非空字符串")
    if not isinstance(rule.priority, int) or isinstance(rule.priority, bool):
        raise ValidationError(loc, f"优先级必须是整数，实际为 {rule.priority!r}")
    if not isinstance(rule.effect, Effect):
        raise ValidationError(loc, f"效果必须是 Effect 枚举，实际为 {rule.effect!r}")
    if not isinstance(rule.enabled, bool):
        raise ValidationError(loc, f"启用状态必须是布尔值，实际为 {rule.enabled!r}")
    if not isinstance(rule.condition, Condition):
        raise ValidationError(loc, "匹配条件必须是 Condition 对象")
    for clause in rule.condition.clauses:
        cloc = f"{loc} 条件子句 {clause.describe()!r}"
        if clause.op not in OPERATORS:
            raise ValidationError(cloc, f"不支持的操作符 {clause.op!r}，可选: {OPERATORS}")
        if clause.attribute not in schema:
            raise ValidationError(
                cloc, f"引用了不存在的属性 {clause.attribute!r}（属性模式中未声明）"
            )
        type_name = schema[clause.attribute]
        if clause.op in ("lt", "le", "gt", "ge") and type_name not in _ORDERABLE_TYPES:
            raise ValidationError(cloc, f"类型为 {type_name} 的属性不支持大小比较")
        if clause.op == "in":
            if not isinstance(clause.value, (list, tuple)):
                raise ValidationError(cloc, "in 操作符的右值必须是列表")
            for i, item in enumerate(clause.value):
                if not check_value_type(item, type_name):
                    raise ValidationError(
                        cloc,
                        f"in 列表第 {i} 项类型非法: 期望 {type_name}，实际 {item!r}",
                    )
        elif not check_value_type(clause.value, type_name):
            raise ValidationError(
                cloc,
                f"比较值类型非法: 属性 {clause.attribute!r} 声明为 {type_name}，"
                f"实际值为 {clause.value!r}",
            )


class Policy:
    """一套策略：有序规则集合 + 无匹配时的默认效果。

    rules 的传入顺序即运营维护顺序；评估时不依赖该顺序，
    严格按 (优先级降序, 规则标识字典序升序) 选取生效规则。
    """

    def __init__(
        self,
        rules,
        schema: Dict[str, str],
        default_effect: Effect = Effect.DENY,
        name: str = "policy",
    ):
        if not isinstance(default_effect, Effect):
            raise ValidationError(f"策略 {name!r}", "默认效果必须是 Effect 枚举")
        self.name = name
        self.schema = dict(schema)
        self.default_effect = default_effect
        self.rules: Tuple[Rule, ...] = tuple(rules)
        self._by_id: Dict[str, Rule] = {}
        for rule in self.rules:
            if rule.rule_id in self._by_id:
                raise ValidationError(
                    f"策略 {name!r}", f"规则标识 {rule.rule_id!r} 重复"
                )
            validate_rule(rule, self.schema, f"策略 {name!r}")
            self._by_id[rule.rule_id] = rule

    def get(self, rule_id: str) -> Optional[Rule]:
        return self._by_id.get(rule_id)

    def rule_ids(self) -> Tuple[str, ...]:
        return tuple(sorted(self._by_id))

    def __len__(self) -> int:
        return len(self.rules)
