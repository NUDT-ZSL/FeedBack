"""变量取值类型：内置类型、规范化与校验、相等性与序列化。

为保证「同值不同写法」（如 ``"#ffffff"`` 与 ``"#FFF"``）在冲突检测时
被视为一致，每种类型都提供 :meth:`ValueType.normalize`。校验失败抛出
带 detail 的 ``ValueError``，由上层包装为 :class:`InvalidValueError`。
"""

from .errors import InvalidValueError


class ValueType:
    """取值类型基类。子类实现 :meth:`validate` 与 :meth:`normalize`。"""

    name = "unknown"

    # 允许的 JSON/Python 原生形态（用于在拿到包装对象之前快速判断）
    _raw_types = ()

    def validate(self, value, variable_id, location):
        """校验并返回规范化后的值；不符则抛 :class:`InvalidValueError`。"""
        raise NotImplementedError

    def normalize(self, value):
        """把外部可能传入的多种写法归一成可比较、可序列化的规范形态。"""
        raise NotImplementedError

    def to_json(self, value):
        """规范值 -> JSON 可存储形态。"""
        return value

    def from_json(self, raw):
        """JSON 形态 -> 规范值（不做额外校验，载入时统一再 validate）。"""
        return raw

    def __repr__(self):
        return f"<ValueType {self.name}>"


class StringType(ValueType):
    name = "string"
    _raw_types = (str,)

    def validate(self, value, variable_id, location):
        if isinstance(value, bool) or not isinstance(value, str):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="需要字符串",
            )
        return self.normalize(value)

    def normalize(self, value):
        return value if isinstance(value, str) else value


class IntegerType(ValueType):
    name = "integer"
    _raw_types = (int,)

    def validate(self, value, variable_id, location):
        # 注意 bool 是 int 的子类，显式排除
        if isinstance(value, bool) or not isinstance(value, int):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="需要整数（不接受布尔值或小数）",
            )
        return int(value)

    def normalize(self, value):
        return int(value)


class NumberType(ValueType):
    name = "number"
    _raw_types = (int, float)

    def validate(self, value, variable_id, location):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="需要数字",
            )
        normalized = float(value)
        if normalized != normalized or normalized in (float("inf"), float("-inf")):
            raise InvalidValueError(
                variable_id, self.name, value, location,
                detail="不允许 NaN 或无穷大",
            )
        return normalized

    def normalize(self, value):
        return float(value)


class BooleanType(ValueType):
    name = "boolean"
    _raw_types = (bool,)

    def validate(self, value, variable_id, location):
        if not isinstance(value, bool):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="需要布尔值 true/false",
            )
        return bool(value)

    def normalize(self, value):
        return bool(value)


class Color:
    """规范化后的颜色：内部存 8 位十六进制 ``#rrggbb`` / ``#rrggbbaa``。

    支持的写法（大小写、空格不敏感）：
      * ``#rgb`` / ``#rgba``
      * ``#rrggbb`` / ``#rrggbbaa``
      * ``rgb(r, g, b)`` / ``rgba(r, g, b, a)``（a 为 0-1 或 0-255 按是否为整数推断，
        为避免歧义，alpha > 1 且非整数将被拒绝）
    """

    __slots__ = ("hex",)

    def __init__(self, normalized_hex):
        self.hex = normalized_hex

    @classmethod
    def parse(cls, text):
        if not isinstance(text, str):
            raise ValueError("颜色必须是字符串")
        s = text.strip().lower()
        if s.startswith("#"):
            body = s[1:]
            if not all(c in "0123456789abcdef" for c in body):
                raise ValueError(f"颜色含非法字符：{text!r}")
            if len(body) == 3:
                body = "".join(c * 2 for c in body)
            elif len(body) == 4:
                body = "".join(c * 2 for c in body)
            elif len(body) in (6, 8):
                pass
            else:
                raise ValueError(f"十六进制颜色长度应为 3/4/6/8 位：{text!r}")
            return cls("#" + body)
        if s.startswith("rgb"):
            lparen = s.find("(")
            if lparen == -1 or not s.endswith(")"):
                raise ValueError(f"rgb 颜色缺少括号：{text!r}")
            func = s[:lparen]
            parts = [p.strip() for p in s[lparen + 1:-1].split(",")]
            if func == "rgb" and len(parts) == 3:
                r, g, b = (cls._parse_channel(p, text) for p in parts)
                return cls(f"#{r:02x}{g:02x}{b:02x}")
            if func == "rgba" and len(parts) == 4:
                r, g, b = (cls._parse_channel(p, text) for p in parts[:3])
                a = cls._parse_alpha(parts[3], text)
                if a == 255:
                    return cls(f"#{r:02x}{g:02x}{b:02x}")
                return cls(f"#{r:02x}{g:02x}{b:02x}{a:02x}")
            raise ValueError(f"无法识别的 rgb 形式：{text!r}")
        raise ValueError(f"无法识别的颜色写法：{text!r}")

    @staticmethod
    def _parse_channel(part, original):
        try:
            v = int(part)
        except ValueError:
            raise ValueError(f"颜色通道必须是 0-255 的整数：{original!r}")
        if not 0 <= v <= 255:
            raise ValueError(f"颜色通道超出 0-255：{original!r}")
        return v

    @staticmethod
    def _parse_alpha(part, original):
        try:
            if "." in part:
                v = float(part)
                if not 0.0 <= v <= 1.0:
                    raise ValueError
                return round(v * 255)
            v = int(part)
            if not 0 <= v <= 255:
                raise ValueError
            return v
        except ValueError:
            raise ValueError(f"alpha 必须是 0-1 的小数或 0-255 的整数：{original!r}")

    @property
    def alpha(self):
        if len(self.hex) == 9:
            return int(self.hex[7:9], 16)
        return 255

    def __eq__(self, other):
        return isinstance(other, Color) and other.hex == self.hex

    def __hash__(self):
        return hash(self.hex)

    def __repr__(self):
        return f"Color({self.hex!r})"

    def __str__(self):
        return self.hex


class ColorType(ValueType):
    name = "color"
    _raw_types = (str, Color)

    def validate(self, value, variable_id, location):
        if isinstance(value, Color):
            return value
        if not isinstance(value, str):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="颜色需要字符串，如 '#3366ff' 或 'rgb(51,102,255)'",
            )
        try:
            return Color.parse(value)
        except ValueError as exc:
            raise InvalidValueError(
                variable_id, self.name, value, location, detail=str(exc)
            )

    def normalize(self, value):
        return value if isinstance(value, Color) else Color.parse(value)

    def to_json(self, value):
        return value.hex

    def from_json(self, raw):
        return Color.parse(raw)


class Length:
    """长度值：数值 + 单位（如 ``16px``、``1.5rem``、``0``）。

    单位相同才能比较；``0`` 允许不带单位，规范化为 ``0px``。
    """

    __slots__ = ("value", "unit")

    def __init__(self, value, unit):
        self.value = value
        self.unit = unit

    @classmethod
    def parse(cls, text):
        if not isinstance(text, str):
            raise ValueError("长度必须是字符串")
        s = text.strip().lower()
        if not s:
            raise ValueError("长度为空")
        cut = len(s)
        for i, ch in enumerate(s):
            if ch.isalpha() or ch == "%":
                cut = i
                break
        num_part, unit_part = s[:cut], s[cut:]
        try:
            v = float(num_part)
        except ValueError:
            raise ValueError(f"长度数值部分无法解析：{text!r}")
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError(f"长度不能为 NaN/无穷：{text!r}")
        if unit_part == "":
            if v != 0:
                raise ValueError(f"非零长度必须带单位（如 px/rem/em/%）：{text!r}")
            unit_part = "px"
        if not all(c.isalpha() or c == "%" for c in unit_part):
            raise ValueError(f"长度单位非法：{text!r}")
        if v.is_integer():
            v = int(v)
        return cls(v, unit_part)

    def format(self):
        return f"{self.value}{self.unit}"

    def __eq__(self, other):
        return (
            isinstance(other, Length)
            and other.value == self.value
            and other.unit == self.unit
        )

    def __hash__(self):
        return hash((self.value, self.unit))

    def __repr__(self):
        return f"Length({self.value!r}, {self.unit!r})"

    def __str__(self):
        return self.format()


class LengthType(ValueType):
    name = "length"
    _raw_types = (str, Length)

    def validate(self, value, variable_id, location):
        if isinstance(value, Length):
            return value
        if not isinstance(value, str):
            raise InvalidValueError(
                variable_id, self.name, type(value).__name__, location,
                detail="长度需要字符串，如 '16px'",
            )
        try:
            return Length.parse(value)
        except ValueError as exc:
            raise InvalidValueError(
                variable_id, self.name, value, location, detail=str(exc)
            )

    def normalize(self, value):
        return value if isinstance(value, Length) else Length.parse(value)

    def to_json(self, value):
        return value.format()

    def from_json(self, raw):
        return Length.parse(raw)


_REGISTRY = {
    t.name: t
    for t in (
        StringType(),
        IntegerType(),
        NumberType(),
        BooleanType(),
        ColorType(),
        LengthType(),
    )
}


def get_type(name):
    """按名称取得类型实例，未知类型抛 KeyError 由上层报告位置。"""
    try:
        return _REGISTRY[name]
    except KeyError:
        raise KeyError(name)


def known_type_names():
    return tuple(_REGISTRY)
