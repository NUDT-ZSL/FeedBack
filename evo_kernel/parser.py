"""按版本规则解析数据。

解析做四件事：

1. **校验**：逐字段检查类型、必填、枚举，收集全部错误（不提前中断），
   错误带字段路径、期望值与实际值；
2. **补齐**：缺失的可选字段按默认值补齐（默认值同样经过类型规整与嵌套
   校验，例如 ``integer`` 给的 ``1`` 在 ``number`` 字段中规整为 ``1.0``），
   记录在 ``defaults_applied`` 中；
3. **标记未知字段**：规则之外的键不会被静默丢弃，原样收集到
   ``unknown`` 中并按路径报告；解析结果的 ``data`` 只包含规则内字段，
   未知字段与之分开存放；
4. **规范化**：深拷贝输入、布尔不被当作整数、number 统一为 float，
   使“同样输入永远得到同样输出”。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .errors import ParseError
from .rules import FieldRule
from .versions import Version


@dataclass
class FieldError:
    """单条字段校验错误（值对象，可序列化）。"""

    path: str
    expected: str
    actual: Any
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "path": self.path,
            "expected": self.expected,
            "actual": self.actual,
            "reason": self.reason,
        }


@dataclass
class ParseResult:
    """一次解析的完整结果。"""

    version_id: str
    data: Dict[str, Any]
    unknown: Dict[str, Any] = field(default_factory=dict)
    defaults_applied: List[str] = field(default_factory=list)
    errors: List[FieldError] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def require_ok(self) -> "ParseResult":
        if self.errors:
            raise ParseError(self.version_id, self.errors)
        return self

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version_id": self.version_id,
            "ok": self.ok,
            "data": copy.deepcopy(self.data),
            "unknown": copy.deepcopy(self.unknown),
            "defaults_applied": list(self.defaults_applied),
            "errors": [e.to_dict() for e in self.errors],
        }


# ---- 类型判定与展示 -------------------------------------------------------

def expected_text(rule: FieldRule) -> str:
    if rule.enum is not None:
        vals = ", ".join(rule.enum)
        return f"string（枚举取值之一: {vals}）"
    return {
        "string": "string",
        "integer": "integer（非布尔整数）",
        "number": "number（整数或浮点数，非布尔）",
        "boolean": "boolean",
        "object": "object",
        "array": "array",
    }[rule.type]


def _check_scalar(rule: FieldRule, value: Any) -> Optional[str]:
    """标量类型/枚举检查，返回错误原因，None 表示通过。"""
    t = rule.type
    if t == "string":
        if not isinstance(value, str):
            return "类型不匹配"
        if rule.enum is not None and value not in rule.enum:
            return "枚举取值非法"
        return None
    if t == "integer":
        return None if (isinstance(value, int) and not isinstance(value, bool)) else "类型不匹配"
    if t == "number":
        return None if (isinstance(value, (int, float)) and not isinstance(value, bool)) else "类型不匹配"
    if t == "boolean":
        return None if isinstance(value, bool) else "类型不匹配"
    return None


def show_path(parts: Tuple[Any, ...]) -> str:
    """路径展示：int 段渲染为 ``[i]``，数组元素占位段 ``''`` 渲染为 ``[]``。"""
    out: List[str] = []
    for p in parts:
        if isinstance(p, int) and not isinstance(p, bool):
            out.append(f"[{p}]")
        elif p == "":
            out.append("[]")
        else:
            if out:
                out.append(".")
            out.append(str(p))
    return "".join(out)


def validate_value(rule: FieldRule, value: Any, prefix: Tuple[Any, ...] = ()) -> List[FieldError]:
    """对任意值（如规则默认值）做完整规则校验，返回错误列表。"""
    reason = _check_scalar(rule, value)
    if rule.type in ("string", "integer", "number", "boolean"):
        if reason is not None:
            return [FieldError(show_path(prefix), expected_text(rule), value, reason)]
        return []
    if rule.type == "object":
        if not isinstance(value, dict):
            return [FieldError(show_path(prefix), "object", value, "类型不匹配")]
        errors: List[FieldError] = []
        for child in rule.children:
            cpath = prefix + (child.name,)
            if child.name in value:
                errors.extend(validate_value(child, value[child.name], cpath))
            elif child.required:
                errors.append(FieldError(show_path(cpath), expected_text(child), None, "缺少必填字段"))
            elif child.default is not ...:
                errors.extend(validate_value(child, child.default, cpath))
        return errors
    # array
    if not isinstance(value, list):
        return [FieldError(show_path(prefix), "array", value, "类型不匹配")]
    errors = []
    if rule.item is not None:
        for i, item in enumerate(value):
            errors.extend(validate_value(rule.item, item, prefix + (i,)))
    return errors


# ---- 解析（单一递归） -----------------------------------------------------

@dataclass
class _Node:
    value: Any                              # 规整后的值；致命错误时为 None
    errors: List[FieldError]
    defaults: List[str]                     # 本次补齐的字段展示路径
    unknown: List[Tuple[str, Any]]          # (路径, 原值)


def _parse_node(rule: FieldRule, raw: Any, path: Tuple[Any, ...]) -> _Node:
    """按单条规则解析一个值。raw 已被上层深拷贝，可原地补默认值。"""
    shown = show_path(path)

    if rule.type in ("string", "integer", "number", "boolean"):
        reason = _check_scalar(rule, raw)
        if reason is not None:
            return _Node(None, [FieldError(shown, expected_text(rule), raw, reason)], [], [])
        value = float(raw) if rule.type == "number" and isinstance(raw, int) else raw
        return _Node(value, [], [], [])

    if rule.type == "object":
        if not isinstance(raw, dict):
            return _Node(None, [FieldError(shown, "object", raw, "类型不匹配")], [], [])
        obj, errors, defaults, unknown = _parse_object(rule.children, raw, path)
        return _Node(obj, errors, defaults, unknown)

    # array
    if not isinstance(raw, list):
        return _Node(None, [FieldError(shown, "array", raw, "类型不匹配")], [], [])
    errors: List[FieldError] = []
    defaults: List[str] = []
    unknown: List[Tuple[str, Any]] = []
    items: List[Any] = []
    if rule.item is not None:
        for i, raw_item in enumerate(raw):
            node = _parse_node(rule.item, raw_item, path + (i,))
            errors.extend(node.errors)
            defaults.extend(node.defaults)
            unknown.extend(node.unknown)
            if not node.errors:
                items.append(node.value)
    return _Node(items, errors, defaults, unknown)


def _parse_object(
    rules: List[FieldRule], source: Dict[str, Any], prefix: Tuple[Any, ...]
) -> Tuple[Dict[str, Any], List[FieldError], List[str], List[Tuple[str, Any]]]:
    """按 rules 解析一个对象层级，返回 (规整后对象, 错误, 补齐路径, 未知字段)。"""
    out: Dict[str, Any] = {}
    errors: List[FieldError] = []
    defaults: List[str] = []
    unknown: List[Tuple[str, Any]] = []

    for rule in rules:
        path = prefix + (rule.name,)
        shown = show_path(path)
        if rule.name not in source:
            if rule.required:
                errors.append(FieldError(shown, expected_text(rule), None, "缺少必填字段"))
                continue
            if rule.default is ...:
                continue
            # 深拷贝默认值并按规则解析（嵌套默认值也会被补齐与规整）。
            node = _parse_node(rule, copy.deepcopy(rule.default), path)
            errors.extend(node.errors)
            defaults.extend(node.defaults)
            unknown.extend(node.unknown)
            if not node.errors:
                out[rule.name] = node.value
                defaults.append(shown)
            continue

        node = _parse_node(rule, source[rule.name], path)
        errors.extend(node.errors)
        defaults.extend(node.defaults)
        unknown.extend(node.unknown)
        if not node.errors:
            out[rule.name] = node.value

    known = {r.name for r in rules}
    for key in sorted(source):
        if key not in known:
            unknown.append((show_path(prefix + (key,)), copy.deepcopy(source[key])))

    return out, errors, defaults, unknown


def parse(version: Version, raw: Any) -> ParseResult:
    """按 ``version`` 的规则解析 ``raw``，始终返回 :class:`ParseResult`。

    调用方可读 ``result.ok`` 决定成败，或调用 ``result.require_ok()`` 在
    失败时抛出聚合了全部字段错误的 :class:`ParseError`。
    """
    if not isinstance(raw, dict):
        error = FieldError(
            "<root>", "object（记录顶层必须是对象）", raw, "类型不匹配"
        )
        return ParseResult(
            version_id=version.version_id,
            data={},
            unknown={},
            defaults_applied=[],
            errors=[error],
        )

    out, errors, defaults, unknown_pairs = _parse_object(
        version.fields, copy.deepcopy(raw), ()
    )
    return ParseResult(
        version_id=version.version_id,
        data=out,
        unknown={p: v for p, v in sorted(unknown_pairs)},
        defaults_applied=sorted(set(defaults)),
        errors=sorted(errors, key=lambda e: (e.path, e.reason, repr(e.actual))),
    )
