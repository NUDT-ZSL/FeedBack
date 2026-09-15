"""字段路径、字段名与规范化 JSON 等基础工具。

路径在内部使用序列表示（对象键为 ``str``，数组下标为 ``int``）；
对外展示时使用点号分隔，例如 ``address.city``、``tags[0]``。
规则路径（类型层面、不含具体下标）以 ``[]`` 结尾表示数组元素，例如 ``tags[]``。
"""

from __future__ import annotations

import json
from typing import Any, Iterable, List

from .errors import RuleDefinitionError

# 字段名中保留的字符：'.' 是路径分隔符，'[' ']' 用于数组下标展示。
_FORBIDDEN_CHARS = ".[]"

# 允许持久化 / 迁移的 JSON 标量类型。
_SCALAR_TYPES = (str, int, float, bool, type(None))



def validate_name(name: Any, location: str) -> str:
    """校验字段名：必须是非空字符串，且不含路径保留字符。"""
    if not isinstance(name, str) or isinstance(name, bool):
        raise RuleDefinitionError(f"字段名必须是非空字符串，实际为 {type(name).__name__}", location)
    if name == "":
        raise RuleDefinitionError("字段名不能为空字符串", location)
    bad = next((ch for ch in name if ch in _FORBIDDEN_CHARS or ch.isspace()), None)
    if bad is not None:
        raise RuleDefinitionError(
            f"字段名 {name!r} 非法：不能包含空白或 {'. [ ]'!r} 中的字符", location
        )
    return name


def display(parts: Iterable[Any]) -> str:
    """把路径序列转成展示字符串，例如 ('a', 0, 'b') -> 'a[0].b'。"""
    out: List[str] = []
    for p in parts:
        if isinstance(p, int) and not isinstance(p, bool):
            out.append(f"[{p}]")
        else:
            if out:
                out.append(".")
            out.append(str(p))
    return "".join(out)


def rule_path(parts: Sequence[str]) -> str:
    """规则路径（类型层面）：数组元素用 ``[]`` 后缀表示。

    调用方在进入数组元素规则时追加一个空字符串段，由本函数渲染为 ``[]``，
    例如 ``('tags', '', 'name')`` -> ``'tags[].name'``。
    """
    out: List[str] = []
    for p in parts:
        if p == "":
            out.append("[]")
        else:
            if out:
                out.append(".")
            out.append(p)
    return "".join(out)


def ensure_jsonable(value: Any, location: str) -> None:
    """递归确认值只包含 JSON 可表示的类型（dict/list/str/int/float/bool/None）。"""
    if isinstance(value, bool) or value is None or isinstance(value, (str, int, float)):
        if isinstance(value, float):
            # NaN / Infinity 不是合法 JSON，json.dumps 默认会放行，这里显式拒绝。
            if value != value or value in (float("inf"), float("-inf")):
                raise RuleDefinitionError(f"默认值含非有限浮点数 {value!r}", location)
        return
    if isinstance(value, list):
        for i, item in enumerate(value):
            ensure_jsonable(item, f"{location}[{i}]")
        return
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str):
                raise RuleDefinitionError(f"对象键必须是字符串，实际为 {type(k).__name__}", location)
            ensure_jsonable(v, f"{location}.{k}")
        return
    raise RuleDefinitionError(
        f"值 {value!r} 不是受支持的 JSON 类型（{type(value).__name__}）", location
    )


def canonical_bytes(value: Any) -> bytes:
    """把 JSON 值序列化为确定性字节串：键排序、无空白、不转义非 ASCII。

    同值必然产生同样字节，用于校验和、指纹与结果复现。
    """
    ensure_jsonable(value, "<root>")
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def json_dumps_pretty(value: Any) -> str:
    """导出包用的可读 JSON。"""
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
