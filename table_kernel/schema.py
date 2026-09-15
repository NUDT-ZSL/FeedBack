"""模式与类型化字段校验。

支持四种字段类型：``int`` / ``float`` / ``str`` / ``bool``。
类型判定严格：

* ``bool`` 只接受真正的 ``bool``（``True``/``False``）；
* ``int`` 只接受 ``int``，拒绝 ``bool`` 和 ``float``（``1.0`` 不算整数）；
* ``float`` 接受 ``float`` 和 ``int``，拒绝 ``bool``；
* ``str`` 只接受 ``str``。
"""

from __future__ import annotations

import math
from typing import Any

from .errors import ValidationError

# 允许的字段类型 -> Python 运行时判定说明
FIELD_TYPES = ("int", "float", "str", "bool")


class FieldSpec:
    """单个字段的类型描述。"""

    __slots__ = ("name", "type")

    def __init__(self, name: str, type_: str):
        if not isinstance(name, str) or not name:
            raise ValidationError("字段名必须是非空字符串", path=name)
        if type_ not in FIELD_TYPES:
            raise ValidationError(
                f"字段 {name!r} 类型非法: {type_!r}，"
                f"只支持 {', '.join(FIELD_TYPES)}",
                path=name,
            )
        self.name = name
        self.type = type_

    def validate(self, value: Any, index: int | None = None) -> None:
        """校验值是否符合本字段类型，不合法时抛出带位置的 ValidationError。"""
        t = self.type
        ok = False
        if t == "int":
            # 注意 bool 是 int 的子类，这里必须显式排除
            ok = isinstance(value, int) and not isinstance(value, bool)
        elif t == "float":
            ok = (isinstance(value, (int, float))
                  and not isinstance(value, bool))
            # NaN/Inf 会破坏严格全序（BST 不变量），一律拒绝
            if ok and isinstance(value, float) and not math.isfinite(value):
                raise ValidationError(
                    f"字段 {self.name!r} 不接受 NaN 或无穷大，"
                    f"实际为 {value!r}",
                    index=index,
                    path=self.name,
                )
        elif t == "str":
            ok = isinstance(value, str)
        elif t == "bool":
            ok = isinstance(value, bool)
        if not ok:
            py_t = type(value).__name__
            raise ValidationError(
                f"字段 {self.name!r} 需要 {t} 类型，实际得到 {py_t}"
                f"（值: {value!r}）",
                index=index,
                path=self.name,
            )

    def __eq__(self, other: object) -> bool:
        return (isinstance(other, FieldSpec)
                and self.name == other.name and self.type == other.type)

    def __repr__(self) -> str:
        return f"FieldSpec({self.name!r}, {self.type!r})"


class Schema:
    """行模式：字段名唯一的一组 FieldSpec。"""

    __slots__ = ("fields", "_by_name")

    def __init__(self, fields: list[FieldSpec] | dict[str, str]):
        if isinstance(fields, dict):
            fields = [FieldSpec(n, t) for n, t in fields.items()]
        else:
            fields = list(fields)
        names: set[str] = set()
        for i, f in enumerate(fields):
            if not isinstance(f, FieldSpec):
                raise ValidationError(
                    "Schema 字段必须是 FieldSpec 或 (name, type) 映射",
                    index=i,
                )
            if f.name in names:
                raise ValidationError(
                    f"字段名重复: {f.name!r}", index=i, path=f.name
                )
            names.add(f.name)
        self.fields = tuple(fields)
        self._by_name = {f.name: f for f in self.fields}

    def field(self, name: str) -> FieldSpec:
        if name not in self._by_name:
            raise ValidationError(f"字段不存在: {name!r}", path=name)
        return self._by_name[name]

    def has(self, name: str) -> bool:
        return name in self._by_name

    def validate_row(self, values: dict[str, Any],
                     index: int | None = None) -> None:
        """校验整行：不允许缺字段，也不允许多余字段。"""
        if not isinstance(values, dict):
            raise ValidationError(
                f"行数据必须是字段名到值的映射，实际为 "
                f"{type(values).__name__}",
                index=index,
            )
        seen: set[str] = set()
        for f in self.fields:
            if f.name not in values:
                raise ValidationError(
                    f"缺少字段: {f.name!r}", index=index, path=f.name
                )
            f.validate(values[f.name], index=index)
            seen.add(f.name)
        extra = set(values) - seen
        if extra:
            name = sorted(extra)[0]
            raise ValidationError(
                f"存在模式之外的多余字段: {name!r}", index=index, path=name
            )

    def __len__(self) -> int:
        return len(self.fields)

    def __eq__(self, other: object) -> bool:
        return isinstance(other, Schema) and self.fields == other.fields

    def __repr__(self) -> str:
        return f"Schema({list(self.fields)!r})"
