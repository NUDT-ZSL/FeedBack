"""金额工具：内部一律使用整数“分”，杜绝浮点误差。

对外接口接受 ``int / float / str / Decimal``（单位：元），
转换规则严格：非有限数、超过两位小数一律拒绝，不做静默四舍五入。
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Union

from .errors import ValidationError

MoneyInput = Union[int, float, str, Decimal]


def to_cents(value: MoneyInput, path: str | list[str] | None = None) -> int:
    """把以元为单位的金额转换成整数分。

    1_000_000.00 元是可表达金额的保守上限，主要用于拦截脏数据。
    """
    if isinstance(value, bool):
        raise ValidationError("金额不能是布尔值", path)
    if isinstance(value, int):
        yuan = Decimal(value)
    elif isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise ValidationError("金额必须是有限数", path)
        yuan = Decimal(str(value))
    elif isinstance(value, str):
        text = value.strip()
        if text == "":
            raise ValidationError("金额不能为空", path)
        try:
            yuan = Decimal(text)
        except InvalidOperation:
            raise ValidationError(f"金额格式非法: {value!r}", path)
    elif isinstance(value, Decimal):
        yuan = value
    else:
        raise ValidationError(f"金额类型不支持: {type(value).__name__}", path)

    if not yuan.is_finite():
        raise ValidationError("金额必须是有限数", path)

    # 量化到分；多于两位小数直接报错，不做静默舍入。
    cents = (yuan * 100).to_integral_value()
    if cents != yuan * 100:
        raise ValidationError(f"金额最多允许两位小数: {value!r}", path)
    result = int(cents)
    if result <= 0:
        raise ValidationError("金额必须为正数", path)
    if result > 100_000_000_00:
        raise ValidationError("金额超出允许上限（1,000,000.00 元）", path)
    return result


def format_yuan(cents: int) -> str:
    """把整数分格式化为两位小数字符串。"""
    sign = "-" if cents < 0 else ""
    v = abs(int(cents))
    return f"{sign}{v // 100}.{v % 100:02d}"
