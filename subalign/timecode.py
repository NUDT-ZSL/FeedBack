"""时间码工具：毫秒整数与 ``HH:MM:SS.mmm`` 字符串互转。

包内统一用**整数毫秒**表示时刻，避免二进制浮点导致重复计算不一致。
"""

from __future__ import annotations

import re
from fractions import Fraction
from typing import Union

from .errors import ValidationError

_TC_RE = re.compile(
    r"^(?P<neg>-)?(?:(?P<h>\d+):)?(?P<m>\d{1,2}):(?P<s>\d{1,2})(?:[.,](?P<ms>\d{1,3}))?$"
)

Number = Union[int, float, Fraction, str]


def to_millis(value: Number, location: tuple | None = None) -> int:
    """把多种时刻表示统一为整数毫秒。

    接受：

    * ``int``（视为毫秒）
    * ``float``（毫秒，四舍五入到整毫秒）
    * :class:`~fractions.Fraction`（毫秒）
    * ``"HH:MM:SS.mmm"`` / ``"MM:SS.mmm"`` 时间码字符串
    * 数字字符串（视为毫秒）
    """
    if isinstance(value, bool):
        raise ValidationError(f"时刻不能是布尔值：{value!r}", location)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, Fraction):
        # 银行家舍入会造成往返不稳定，这里用“最近整数、半数远离零”。
        return _round_fraction(value)
    if isinstance(value, float):
        return int(_round_fraction(Fraction(value).limit_denominator(10**12)))
    if isinstance(value, str):
        return _parse_string(value, location)
    raise ValidationError(f"无法识别的时刻类型 {type(value).__name__}：{value!r}", location)


def _round_fraction(value: Fraction) -> int:
    """四舍五入到最近整数，0.5 向远离零方向取整（确定、对称）。"""
    q, r = divmod(abs(value).numerator, value.denominator)
    if r * 2 >= value.denominator:
        q += 1
    return q if value >= 0 else -q


def _parse_string(text: str, location: tuple | None) -> int:
    s = text.strip()
    if not s:
        raise ValidationError("时刻字符串为空", location)
    # 纯数字按毫秒处理（含小数毫秒、分数形式 "1/2"）。
    if re.fullmatch(r"-?\d+(?:\.\d+)?", s):
        return to_millis(Fraction(s), location)
    if "/" in s and re.fullmatch(r"-?\d+/\d+", s):
        return to_millis(Fraction(s), location)
    m = _TC_RE.match(s)
    if not m:
        raise ValidationError(f"非法时间码：{text!r}，应为 HH:MM:SS.mmm", location)
    hours = int(m.group("h")) if m.group("h") is not None else 0
    minutes = int(m.group("m"))
    seconds = int(m.group("s"))
    if minutes >= 60 or seconds >= 60:
        raise ValidationError(f"非法时间码（分/秒越界）：{text!r}", location)
    ms_text = m.group("ms")
    millis = int(ms_text.ljust(3, "0")) if ms_text else 0
    total = ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
    return -total if m.group("neg") else total


def format_millis(millis: int) -> str:
    """格式化为 ``HH:MM:SS.mmm``（负值加前导 ``-``）。"""
    if millis < 0:
        return "-" + format_millis(-millis)
    h, rem = divmod(int(millis), 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
