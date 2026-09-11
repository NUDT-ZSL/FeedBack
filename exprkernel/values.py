"""带类型的运行时值与有限性/长度守卫。

类型系统只有三种：``NUMBER`` / ``STRING`` / ``BOOL``。
数值一律存为有限 ``float``；任何 inf/NaN 在入口处即被拒绝，
运算结果若产生 inf/NaN 也会立即报错，绝不静默传播。
"""

import math

NUMBER = "number"
STRING = "string"
BOOL = "bool"

ALL_TYPES = (NUMBER, STRING, BOOL)

# 字符串拼接的默认长度上限（字符数）
DEFAULT_MAX_STRING_LEN = 100_000
# 绑定/求值默认递归深度
DEFAULT_MAX_DEPTH = 64


class TypedValue:
    """求值结果：Python 原生值 + 内核类型标签。"""

    __slots__ = ("value", "type")

    def __init__(self, value, type_):
        self.value = value
        self.type = type_

    def __eq__(self, other):
        if not isinstance(other, TypedValue):
            return NotImplemented
        return self.type == other.type and self.value == other.value

    def __repr__(self):
        if self.type == STRING:
            return "TypedValue({!r}, {})".format(self.value, self.type)
        return "TypedValue({!r}, {})".format(self.value, self.type)

    def to_dict(self):
        return {"value": self.value, "type": self.type}


def number(value):
    value = float(value)
    if not math.isfinite(value):
        # 调用方负责给出带位置的错误；这里是无位置的底层守卫。
        raise ValueError("non-finite number: {!r}".format(value))
    return TypedValue(value, NUMBER)


def string(value, max_len=DEFAULT_MAX_STRING_LEN):
    value = str(value)
    if len(value) > max_len:
        raise ValueError("string length {} exceeds limit {}".format(len(value), max_len))
    return TypedValue(value, STRING)


def boolean(value):
    return TypedValue(bool(value), BOOL)


def infer_type(python_value):
    """把外部传入的 Python 绑定值推断为内核类型。

    ``bool`` 必须先于 ``int`` 判断（Python 里 bool 是 int 的子类）。
    所有数值统一转 float 并做有限性检查。
    """
    if isinstance(python_value, bool):
        return BOOL
    if isinstance(python_value, (int, float)):
        f = float(python_value)
        if not math.isfinite(f):
            raise ValueError("bind value must be finite, got {!r}".format(python_value))
        return NUMBER
    if isinstance(python_value, str):
        return STRING
    raise TypeError(
        "unsupported bind value type: {} ({!r})".format(
            type(python_value).__name__, python_value
        )
    )


TYPE_NAMES_CN = {NUMBER: "number", STRING: "string", BOOL: "bool"}


def type_name(t):
    return TYPE_NAMES_CN.get(t, t)
