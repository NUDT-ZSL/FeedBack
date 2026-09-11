"""exprkernel: 可嵌入的表达式求值与静态检查内核。

只用 Python 标准库，不使用 eval/exec。典型用法::

    from exprkernel import Engine

    engine = Engine()
    engine.bind("tax_rate", 0.1, type_hint="number")
    engine.bind("price", "100 * (1 + tax_rate)")
    result = engine.evaluate("price * 2 > 200 and true")
    print(result.value, result.type, result.ok)
"""

from .errors import (
    ErrorCode,
    Diagnostic,
    WarningCode,
)
from .values import TypedValue
from .kernel import Engine, CheckResult, EvalResult, BindResult

__all__ = [
    "Engine",
    "CheckResult",
    "EvalResult",
    "BindResult",
    "TypedValue",
    "Diagnostic",
    "ErrorCode",
    "WarningCode",
]
