"""导出 / 导入：内核状态的可往返序列化（格式版本 1）。

导出结果为纯 JSON 兼容字典（仅含 dict / list / str / int / float / bool），
覆盖：属性模式、内核级默认效果、全部访问请求、全部策略版本
（含各自默认效果与规则全字段）、归因配置（max_exhaustive_diffs）。

保证：
- 往返一致：export → import 后，重放、决策依据、规则命中、归因结果与导出前一致；
- 损坏或字段缺失的输入被清晰拒绝（ValidationError 带位置信息）；
- 导入失败不改动任何已有内核的内存状态（导入产出的是全新实例，
  校验与构造全部在局部完成，任何一步失败都只是丢弃半成品）。

注意：JSON 往返会把条件中 in 操作符的元组右值归一为列表（JSON 无元组），
语义不变；若需逐字节一致的对象比较，请使用字典往返（export/import_data）。
"""

from __future__ import annotations

import json
from typing import Any, Dict

from .errors import ValidationError
from .explain import MAX_EXHAUSTIVE_DIFFS
from .kernel import ImpactKernel
from .models import Clause, Condition, Effect, Rule

#: 导出格式版本。结构变更时递增，导入侧按版本拒绝不兼容数据。
FORMAT_VERSION = 1


# ----------------------------------------------------------------------
# 导出
# ----------------------------------------------------------------------
def export_kernel(kernel: ImpactKernel) -> Dict[str, Any]:
    return {
        "format_version": FORMAT_VERSION,
        "attribute_schema": kernel.attribute_schema,
        "default_effect": kernel.default_effect.value,
        "explain": {"max_exhaustive_diffs": kernel.max_exhaustive_diffs},
        "requests": [
            {"request_id": r.request_id, "attributes": dict(r.attributes)}
            for r in kernel.all_requests()
        ],
        "policies": {
            version: _export_policy(kernel.get_policy(version))
            for version in kernel.policy_versions()
        },
    }


def _export_policy(policy) -> Dict[str, Any]:
    return {
        "default_effect": policy.default_effect.value,
        "rules": [_export_rule(r) for r in policy.rules],
    }


def _export_rule(rule: Rule) -> Dict[str, Any]:
    return {
        "rule_id": rule.rule_id,
        "priority": rule.priority,
        "enabled": rule.enabled,
        "effect": rule.effect.value,
        "condition": [
            {"attribute": c.attribute, "op": c.op, "value": c.value}
            for c in rule.condition.clauses
        ],
    }


def kernel_to_json(kernel: ImpactKernel, **json_kwargs) -> str:
    """导出为 JSON 字符串。默认紧凑输出，可传 indent 等 json.dumps 参数。"""
    return json.dumps(export_kernel(kernel), **json_kwargs)


# ----------------------------------------------------------------------
# 导入
# ----------------------------------------------------------------------
def kernel_from_dict(data: Dict[str, Any]) -> ImpactKernel:
    loc = "导入数据"
    if not isinstance(data, dict):
        raise ValidationError(loc, f"顶层必须是字典，实际为 {type(data).__name__}")
    version = data.get("format_version")
    if version != FORMAT_VERSION:
        raise ValidationError(
            loc, f"不支持的格式版本 {version!r}，本内核支持 {FORMAT_VERSION}"
        )
    schema = _require(data, "attribute_schema", dict, loc)
    default_effect = Effect.parse(_require(data, "default_effect", str, loc))
    max_exhaustive = _parse_explain_config(data, loc)

    kernel = ImpactKernel(
        schema, default_effect=default_effect, max_exhaustive_diffs=max_exhaustive
    )

    for i, item in enumerate(_require(data, "requests", list, loc)):
        iloc = f"{loc} requests[{i}]"
        if not isinstance(item, dict):
            raise ValidationError(iloc, "请求必须是字典")
        rid = _require(item, "request_id", str, iloc)
        attrs = _require(item, "attributes", dict, iloc)
        kernel.add_request(rid, attrs)  # 缺失/类型非法属性在此被拒绝

    policies = _require(data, "policies", dict, loc)
    for ver, pdata in policies.items():
        ploc = f"{loc} policies[{ver!r}]"
        if not isinstance(pdata, dict):
            raise ValidationError(ploc, "策略必须是字典")
        raw_default = pdata.get("default_effect")
        pdefault = Effect.parse(raw_default) if raw_default is not None else None
        rules = [
            _parse_rule(raw, f"{ploc} rules[{j}]")
            for j, raw in enumerate(_require(pdata, "rules", list, ploc))
        ]
        kernel.load_policy(ver, rules, default_effect=pdefault)  # 规则校验在此进行
    return kernel


def kernel_from_json(text: str) -> ImpactKernel:
    if not isinstance(text, str):
        raise ValidationError("导入 JSON", f"输入必须是字符串，实际为 {type(text).__name__}")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationError("导入 JSON", f"JSON 解析失败: {exc}") from None
    return kernel_from_dict(data)


def _parse_explain_config(data: Dict[str, Any], loc: str) -> int:
    raw = data.get("explain", {})
    if not isinstance(raw, dict):
        raise ValidationError(f"{loc} explain", "归因配置必须是字典")
    return raw.get("max_exhaustive_diffs", MAX_EXHAUSTIVE_DIFFS)


def _parse_rule(raw: Any, loc: str) -> Rule:
    if not isinstance(raw, dict):
        raise ValidationError(loc, "规则必须是字典")
    rid = _require(raw, "rule_id", str, loc)
    priority = _require(raw, "priority", int, loc)
    enabled = _require(raw, "enabled", bool, loc)
    effect = Effect.parse(_require(raw, "effect", str, loc))
    clauses = []
    for j, craw in enumerate(_require(raw, "condition", list, loc)):
        cloc = f"{loc} condition[{j}]"
        if not isinstance(craw, dict):
            raise ValidationError(cloc, "条件子句必须是字典")
        attribute = _require(craw, "attribute", str, cloc)
        op = _require(craw, "op", str, cloc)
        if "value" not in craw:
            raise ValidationError(cloc, "缺少必需字段 'value'")
        clauses.append(Clause(attribute, op, craw["value"]))
    return Rule(rid, priority, Condition(tuple(clauses)), effect, enabled)


def _require(mapping: Dict[str, Any], key: str, typ: type, loc: str):
    """取必需字段并校验类型；缺失或类型非法时拒绝并指出位置。"""
    if key not in mapping:
        raise ValidationError(loc, f"缺少必需字段 {key!r}")
    value = mapping[key]
    if typ is int:
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif typ is bool:
        ok = isinstance(value, bool)
    else:
        ok = isinstance(value, typ)
    if not ok:
        raise ValidationError(
            loc, f"字段 {key!r} 类型非法: 期望 {typ.__name__}，实际为 {value!r}"
        )
    return value
