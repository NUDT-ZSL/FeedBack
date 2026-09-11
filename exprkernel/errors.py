"""错误码、告警码与诊断对象。

所有面向调用方的错误都收敛为 :class:`Diagnostic`，携带行列位置
（行列均从 1 开始计数），求值器绝不向调用方抛出未捕获异常。
"""

from enum import Enum


class ErrorCode(Enum):
    # ---- 词法阶段 ----
    LEX_UNTERMINATED_STRING = "LEX_UNTERMINATED_STRING"
    LEX_INVALID_CHAR = "LEX_INVALID_CHAR"
    LEX_INVALID_NUMBER = "LEX_INVALID_NUMBER"

    # ---- 语法阶段 ----
    PARSE_EMPTY = "PARSE_EMPTY"
    PARSE_UNEXPECTED_TOKEN = "PARSE_UNEXPECTED_TOKEN"
    PARSE_UNCLOSED_PAREN = "PARSE_UNCLOSED_PAREN"
    PARSE_TRAILING_TOKEN = "PARSE_TRAILING_TOKEN"
    PARSE_DEPTH_EXCEEDED = "PARSE_DEPTH_EXCEEDED"

    # ---- 静态检查阶段 ----
    STATIC_UNDEFINED_VAR = "STATIC_UNDEFINED_VAR"
    STATIC_TYPE_MISMATCH = "STATIC_TYPE_MISMATCH"
    STATIC_ARITY_MISMATCH = "STATIC_ARITY_MISMATCH"
    STATIC_BRANCH_TYPE = "STATIC_BRANCH_TYPE"
    STATIC_NOT_CALLABLE = "STATIC_NOT_CALLABLE"

    # ---- 绑定注册阶段 ----
    BIND_DUPLICATE = "BIND_DUPLICATE"
    BIND_INVALID_NAME = "BIND_INVALID_NAME"
    BIND_CYCLE = "BIND_CYCLE"
    BIND_DEPTH_EXCEEDED = "BIND_DEPTH_EXCEEDED"
    BIND_EXPRESSION_ERROR = "BIND_EXPRESSION_ERROR"

    # ---- 求值阶段（运行时不应在静态检查通过后出现，作为兜底） ----
    EVAL_DIV_ZERO = "EVAL_DIV_ZERO"
    EVAL_MOD_ZERO = "EVAL_MOD_ZERO"
    EVAL_STRING_TOO_LONG = "EVAL_STRING_TOO_LONG"
    EVAL_DEPTH_EXCEEDED = "EVAL_DEPTH_EXCEEDED"
    EVAL_NON_FINITE = "EVAL_NON_FINITE"
    EVAL_UNDEFINED_VAR = "EVAL_UNDEFINED_VAR"
    EVAL_TYPE = "EVAL_TYPE"
    EVAL_INTERNAL = "EVAL_INTERNAL"


class WarningCode(Enum):
    WARN_DIV_ZERO_LITERAL = "WARN_DIV_ZERO_LITERAL"


class KernelError(Exception):
    """内核内部使用的异常，携带一个 :class:`Diagnostic`。

    各阶段内部用它快速退出；门面层负责捕获并转换为结果对象，
    因此调用方永远不会直接看到这个异常。
    """

    def __init__(self, diagnostic):
        super().__init__(diagnostic.message)
        self.diagnostic = diagnostic


class Diagnostic:
    """一条错误或告警。

    :param code: 错误码或告警码
    :param message: 人类可读信息
    :param line: 行号（从 1 开始）
    :param column: 列号（从 1 开始）
    :param extra: 附加上下文（如环上的变量名序列、冲突名等）
    """

    __slots__ = ("code", "message", "line", "column", "extra")

    def __init__(self, code, message, line=0, column=0, extra=None):
        self.code = code
        self.message = message
        self.line = line
        self.column = column
        self.extra = extra if extra is not None else {}

    def __repr__(self):
        pos = ""
        if self.line:
            pos = " [{}:{}]".format(self.line, self.column)
        return "Diagnostic({}, {!r}{})".format(self.code.value, self.message, pos)

    def __str__(self):
        if self.line:
            return "{}: {} (line {}, col {})".format(
                self.code.value, self.message, self.line, self.column
            )
        return "{}: {}".format(self.code.value, self.message)

    def to_dict(self):
        return {
            "code": self.code.value,
            "message": self.message,
            "line": self.line,
            "column": self.column,
            "extra": self.extra,
        }


def error(code, message, line=0, column=0, extra=None):
    """构造诊断并抛出 :class:`KernelError` 的快捷函数。"""
    raise KernelError(Diagnostic(code, message, line, column, extra))
