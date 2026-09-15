"""版本间 / 数据解析间的字段差异报告（需求 6）。

两种差异：

- :func:`version_diff`：同一条链上两个版本**规则**之间的差异——
  字段新增（added）、消失（removed）、类型变化（type_changed）、
  枚举变化（enum_changed，列出新增 / 删除的枚举值）、必填变化；
- :func:`data_diff`：同一份数据被两个版本规则解析后的差异——除规则
  差异外，还报告该数据上实际触发的默认值补齐、未知字段与校验错误。

所有条目都按字段路径稳定排序。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .parser import parse
from .paths import rule_path
from .versions import VersionRegistry, _index

#: 差异类型常量。
ADDED = "added"
REMOVED = "removed"
TYPE_CHANGED = "type_changed"
ENUM_CHANGED = "enum_changed"
REQUIRED_CHANGED = "required_changed"
DEFAULT_APPLIED = "default_applied"
UNKNOWN = "unknown"
PARSE_ERROR = "parse_error"

_DIFF_ORDER = (
    ADDED,
    REMOVED,
    TYPE_CHANGED,
    ENUM_CHANGED,
    REQUIRED_CHANGED,
    DEFAULT_APPLIED,
    UNKNOWN,
    PARSE_ERROR,
)


@dataclass
class FieldDiff:
    """单条字段差异（值对象，可序列化）。"""

    path: str
    kind: str
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {"path": self.path, "kind": self.kind, "detail": dict(self.detail)}


def _sort_key(d: FieldDict) -> Tuple[str, int]:
    return (d["path"], _DIFF_ORDER.index(d["kind"]))


# 类型别名仅用于内部注解。
FieldDict = Dict[str, Any]


def _enum_change(old: Optional[List[str]], new: Optional[List[str]]) -> Optional[FieldDict]:
    old_set = set(old or [])
    new_set = set(new or [])
    added_vals = sorted(new_set - old_set)
    removed_vals = sorted(old_set - new_set)
    if not added_vals and not removed_vals:
        return None
    return {
        "enum_values_added": added_vals,
        "enum_values_removed": removed_vals,
    }


def version_diff(
    registry: VersionRegistry,
    version_a: str,
    version_b: str,
) -> Dict[str, Any]:
    """报告两个版本规则的字段差异（必须位于同一条演进链上）。

    返回 ``{"from", "to", "diffs"}``，``diffs`` 为按路径稳定排序的
    :class:`FieldDiff` 字典列表。
    """
    # 同链校验（跨链直接报错）。
    registry.common_chain(version_a, version_b)

    a = registry.get(version_a)
    b = registry.get(version_b)
    a_idx = _index(a.fields)
    b_idx = _index(b.fields)
    diffs: List[FieldDict] = []

    for path_tuple, new_rule in sorted(
        ((p, r) for p, r in b_idx.items()), key=lambda kv: rule_path(kv[0])
    ):
        path = rule_path(path_tuple)
        old_rule = a_idx.get(path_tuple)
        if old_rule is None:
            diffs.append({"path": path, "kind": ADDED, "detail": {"type": new_rule.type}})
            continue
        if old_rule.type != new_rule.type:
            diffs.append(
                {
                    "path": path,
                    "kind": TYPE_CHANGED,
                    "detail": {"from_type": old_rule.type, "to_type": new_rule.type},
                }
            )
        if old_rule.enum != new_rule.enum and (old_rule.enum is not None or new_rule.enum is not None):
            change = _enum_change(old_rule.enum, new_rule.enum)
            if change is not None:
                diffs.append({"path": path, "kind": ENUM_CHANGED, "detail": change})
        if old_rule.required != new_rule.required:
            diffs.append(
                {
                    "path": path,
                    "kind": REQUIRED_CHANGED,
                    "detail": {"from_required": old_rule.required, "to_required": new_rule.required},
                }
            )

    for path_tuple in sorted(a_idx, key=rule_path):
        if path_tuple not in b_idx:
            diffs.append(
                {
                    "path": rule_path(path_tuple),
                    "kind": REMOVED,
                    "detail": {"type": a_idx[path_tuple].type},
                }
            )

    diffs.sort(key=_sort_key)
    return {"from": version_a, "to": version_b, "diffs": diffs}


def data_diff(
    registry: VersionRegistry,
    version_a: str,
    version_b: str,
    raw: Any,
) -> Dict[str, Any]:
    """报告同一份数据在两个版本规则下解析的差异。

    在 :func:`version_diff` 的基础上附加：

    - 每个版本解析时实际补齐的默认值（``default_applied``）；
    - 每个版本下的未知字段（``unknown``，含实际值）；
    - 每个版本下的校验错误（``parse_error``）。
    """
    base = version_diff(registry, version_a, version_b)
    res_a = parse(registry.get(version_a), raw)
    res_b = parse(registry.get(version_b), raw)

    extra: List[FieldDict] = []
    for p in res_a.defaults_applied:
        extra.append({"path": p, "kind": DEFAULT_APPLIED, "detail": {"version": version_a}})
    for p in res_b.defaults_applied:
        extra.append({"path": p, "kind": DEFAULT_APPLIED, "detail": {"version": version_b}})
    for p, v in res_a.unknown.items():
        extra.append({"path": p, "kind": UNKNOWN, "detail": {"version": version_a, "value": v}})
    for p, v in res_b.unknown.items():
        extra.append({"path": p, "kind": UNKNOWN, "detail": {"version": version_b, "value": v}})
    for e in res_a.errors:
        extra.append(
            {
                "path": e.path,
                "kind": PARSE_ERROR,
                "detail": {
                    "version": version_a,
                    "expected": e.expected,
                    "actual": e.actual,
                    "reason": e.reason,
                },
            }
        )
    for e in res_b.errors:
        extra.append(
            {
                "path": e.path,
                "kind": PARSE_ERROR,
                "detail": {
                    "version": version_b,
                    "expected": e.expected,
                    "actual": e.actual,
                    "reason": e.reason,
                },
            }
        )

    diffs = base["diffs"] + extra
    diffs.sort(key=_sort_key)
    return {
        "from": version_a,
        "to": version_b,
        "diffs": diffs,
        "parse_ok": {version_a: res_a.ok, version_b: res_b.ok},
    }
