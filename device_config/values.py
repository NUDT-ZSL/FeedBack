"""字段取值的严格类型校验与迁移时类型转换。

支持四种标量类型：``int``、``float``、``bool``、``string``。

校验是严格的：JSON 里的布尔值不会被当成整数（``true`` 不接受为 ``int``），
字符串也必须显式声明才能接受。转换只允许安全、无信息歧义的方向：

* ``int -> float``：数值提升，永不失败；
* ``float -> int``：仅允许本身为整数值的浮点数（``3.0`` 可以，``3.5`` 拒绝）；
* ``int -> string``：十进制整数字符串；
* ``string -> int`` / ``string -> float``：字符串必须严格是十进制整数/有限小数；
  不接受空白、十六进制、``NaN``/``Infinity`` 等；
* 同类型转换恒等；其余方向一律拒绝。
"""

from __future__ import annotations

from .errors import ValidationError

VALUE_TYPES = ("int", "float", "bool", "string")


def check_value_type(value, expected_type, *, where="取值"):
    """严格校验 ``value`` 是否符合 ``expected_type``，不符则抛 :class:`ValidationError`。"""
    if expected_type == "int":
        # 必须排除 bool：Python 中 True/False 也是 int
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValidationError(f"{where}类型应为 int，实际为 {_describe(value)}")
    elif expected_type == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValidationError(f"{where}类型应为 float，实际为 {_describe(value)}")
    elif expected_type == "bool":
        if not isinstance(value, bool):
            raise ValidationError(f"{where}类型应为 bool，实际为 {_describe(value)}")
    elif expected_type == "string":
        if not isinstance(value, str):
            raise ValidationError(f"{where}类型应为 string，实际为 {_describe(value)}")
    else:  # pragma: no cover - 登记阶段已挡住非法类型
        raise ValidationError(f"未知类型 {expected_type!r}")


def convert_value(value, from_type, to_type, *, where="迁移"):
    """把 ``value`` 按迁移规则从 ``from_type`` 转换为 ``to_type``。

    :raises ValidationError: 转换方向不支持或具体值无法无损转换。
    """
    if to_type not in VALUE_TYPES:
        raise ValidationError(f"{where}的目标类型非法：{to_type!r}")
    if from_type == to_type:
        return value
    key = (from_type, to_type)
    converter = _CONVERTERS.get(key)
    if converter is None:
        raise ValidationError(
            f"{where}不支持的类型转换：{from_type} -> {to_type}"
        )
    try:
        return converter(value)
    except (ValueError, OverflowError) as exc:
        raise ValidationError(
            f"{where}无法把值 {value!r} 从 {from_type} 转换为 {to_type}：{exc}"
        ) from exc


def _describe(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int):
        return "int"
    if isinstance(value, float):
        return "float"
    if isinstance(value, str):
        return "string"
    return type(value).__name__


def _as_int(value):
    if isinstance(value, bool):
        raise ValueError("bool 不能当作 int")
    return int(value)


def _int_to_float(value):
    return float(value)


def _float_to_int(value):
    if isinstance(value, bool):
        raise ValueError("bool 不能当作 int")
    if not float(value).is_integer():
        raise ValueError("浮点数存在小数部分，拒绝隐式截断")
    return int(value)


def _int_to_string(value):
    return str(int(value))


def _string_to_int(value):
    # 显式拒绝符号位、空白与任何非纯数字写法
    if value and value[0] in "+-":
        raise ValueError("带符号的字符串不是十进制整数")
    if not value.isdigit():
        raise ValueError("不是纯十进制整数字符串")
    return int(value)


def _string_to_float(value):
    s = value
    if not s:
        raise ValueError("空字符串不是数字")
    lowered = s.lower()
    for bad in ("nan", "inf"):
        if bad in lowered:
            raise ValueError("拒绝 NaN/Infinity")
    if s[0] in "+-":
        raise ValueError("不接受显式符号位")
    if not _is_plain_number(s):
        raise ValueError("不是普通十进制小数字符串")
    num = float(s)
    return num


def _is_plain_number(s):
    seen_digit = False
    seen_dot = False
    for ch in s:
        if ch.isdigit():
            seen_digit = True
        elif ch == "." and not seen_dot:
            seen_dot = True
        else:
            return False
    return seen_digit


_CONVERTERS = {
    ("int", "float"): _int_to_float,
    ("float", "int"): _float_to_int,
    ("int", "string"): _int_to_string,
    ("string", "int"): _string_to_int,
    ("string", "float"): _string_to_float,
}
