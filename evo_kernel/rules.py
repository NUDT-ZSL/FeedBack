"""字段规则定义与静态校验。

规则用普通字典描述，便于导入导出；:class:`FieldRule` 在登记时完成全部
静态合法性检查，非法规则抛出 :class:`RuleDefinitionError` 并带上定位。

支持的类型：

- ``string``  字符串（可配 ``enum``）
- ``integer`` 整数（Python 的 ``int``，``bool`` 不算整数）
- ``number``  数值（``int`` 或 ``float``，解析时统一规整为 ``float``）
- ``boolean`` 布尔
- ``object``  对象（配 ``fields`` 嵌套子字段）
- ``array``   数组（配 ``item`` 元素规则）

规则字典示例::

    {
        "name": "status",
        "type": "string",
        "required": true,
        "enum": ["draft", "published", "archived"],
    }

``required`` 与 ``default`` 互斥：必填字段不允许默认值（否则“必填”没有
意义）；可选字段缺省时用默认值补齐，既无默认值又非必填则允许缺省。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field as dc_field
from typing import Any, Dict, List, Optional, Tuple

from .errors import RuleDefinitionError
from .paths import ensure_jsonable, validate_name

#: 支持的全部标量 / 复合类型。
TYPES: Tuple[str, ...] = ("string", "integer", "number", "boolean", "object", "array")
SCALAR_TYPES: Tuple[str, ...] = ("string", "integer", "number", "boolean")


def _scalar_default_reason(rule: "FieldRule", value: Any) -> Optional[str]:
    """标量默认值的类型 / 枚举检查，返回错误原因（None 表示通过）。"""
    t = rule.type
    if t == "string":
        if not isinstance(value, str) or isinstance(value, bool):
            return "类型不匹配"
        if rule.enum is not None and value not in rule.enum:
            return f"枚举取值非法：{value!r} 不在 {rule.enum}"
        return None
    if t == "integer":
        return None if isinstance(value, int) and not isinstance(value, bool) else "类型不匹配"
    if t == "number":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
        if not ok:
            return "类型不匹配"
        if isinstance(value, float) and (value != value or value in (float("inf"), float("-inf"))):
            return f"必须是有限数值，实际为 {value!r}"
        return None
    if t == "boolean":
        return None if isinstance(value, bool) else "类型不匹配"
    return None


@dataclass
class FieldRule:
    """单个字段的规则。默认值在登记时由解析器规整后存于 :attr:`default`。"""

    name: str
    type: str
    required: bool = False
    default: Any = ...  # type: ignore[assignment]  # 哨兵 ... 表示未声明默认值
    enum: Optional[List[str]] = None
    children: List["FieldRule"] = dc_field(default_factory=list)
    item: Optional["FieldRule"] = None

    # ---- 构造与静态校验 -------------------------------------------------

    @classmethod
    def from_dict(cls, data: Any, location: str = "字段规则") -> "FieldRule":
        """从字典构造规则，非法时抛出带位置的 :class:`RuleDefinitionError`。"""
        if not isinstance(data, dict):
            raise RuleDefinitionError(f"字段规则必须是对象，实际为 {type(data).__name__}", location)

        allowed = {"name", "type", "required", "default", "enum", "fields", "item"}
        unknown = set(data) - allowed
        if unknown:
            raise RuleDefinitionError(f"存在未知键 {sorted(unknown)}", location)

        name = validate_name(data.get("name"), f"{location}/name")
        rtype = data.get("type")
        if not isinstance(rtype, str) or not rtype:
            raise RuleDefinitionError(
                f"type 必须是 {list(TYPES)} 之一，实际为 {rtype!r}", f"{location}/type"
            )
        if rtype not in TYPES:
            raise RuleDefinitionError(
                f"type {rtype!r} 不受支持，允许 {list(TYPES)}", f"{location}/type"
            )

        required = data.get("required", False)
        if not isinstance(required, bool):
            raise RuleDefinitionError("required 必须是布尔值", f"{location}/required")

        has_default = "default" in data
        default = data.get("default") if has_default else ...
        if has_default:
            if required:
                raise RuleDefinitionError(
                    "required 与 default 互斥：必填字段不能声明默认值",
                    f"{location}/default",
                )
            ensure_jsonable(default, f"{location}/default")

        rule = cls(name=name, type=rtype, required=required, default=default)

        enum = data.get("enum")
        if enum is not None:
            loc = f"{location}/enum"
            if not isinstance(enum, list) or not enum:
                raise RuleDefinitionError("enum 必须是非空数组", loc)
            if rtype != "string":
                raise RuleDefinitionError("enum 只能用于 string 类型字段", loc)
            if not all(isinstance(v, str) and not isinstance(v, bool) for v in enum):
                raise RuleDefinitionError("enum 的每个取值必须是字符串", loc)
            if len(set(enum)) != len(enum):
                dupes = sorted({v for v in enum if enum.count(v) > 1})
                raise RuleDefinitionError(f"enum 取值重复: {dupes}", loc)
            rule.enum = list(enum)

        children_data = data.get("fields")
        if children_data is not None:
            loc = f"{location}/fields"
            if rtype != "object":
                raise RuleDefinitionError("fields 只能用于 object 类型字段", loc)
            if not isinstance(children_data, list):
                raise RuleDefinitionError("fields 必须是数组", loc)
            seen: set = set()
            for i, child_data in enumerate(children_data):
                child = FieldRule.from_dict(child_data, f"{loc}[{i}]")
                if child.name in seen:
                    raise RuleDefinitionError(
                        f"子字段名 {child.name!r} 重复", f"{loc}[{i}]/name"
                    )
                seen.add(child.name)
                rule.children.append(child)

        item_data = data.get("item")
        if item_data is not None:
            loc = f"{location}/item"
            if rtype != "array":
                raise RuleDefinitionError("item 只能用于 array 类型字段", loc)
            rule.item = FieldRule.from_dict(item_data, loc)

        if rtype == "object" and not rule.children:
            raise RuleDefinitionError("object 类型字段必须声明非空 fields", f"{location}/fields")
        if rtype == "array" and rule.item is None:
            raise RuleDefinitionError("array 类型字段必须声明 item", f"{location}/item")

        if has_default and rule.type in SCALAR_TYPES:
            reason = _scalar_default_reason(rule, default)
            if reason is not None:
                raise RuleDefinitionError(
                    f"默认值不满足字段规则：{reason}", f"{location}/default"
                )

        return rule

    # ---- 序列化 ---------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """转回可 JSON 序列化的规则字典（键按稳定顺序输出）。"""
        out: Dict[str, Any] = {"name": self.name, "type": self.type}
        if self.required:
            out["required"] = True
        if self.enum is not None:
            out["enum"] = list(self.enum)
        if self.default is not ...:
            out["default"] = copy.deepcopy(self.default)
        if self.children:
            out["fields"] = [c.to_dict() for c in self.children]
        if self.item is not None:
            out["item"] = self.item.to_dict()
        return out

    def child(self, name: str) -> Optional["FieldRule"]:
        for c in self.children:
            if c.name == name:
                return c
        return None

    def __eq__(self, other: object) -> bool:
        return isinstance(other, FieldRule) and other.to_dict() == self.to_dict()

    def __hash__(self) -> int:  # pragma: no cover - 规则主要按路径存放
        return hash(self.name)
