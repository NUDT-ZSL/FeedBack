"""词法分析器：表达式文本 -> Token 流。

支持的词法：
  * 数字字面量：整数 / 小数 / 科学计数法，统一产出 float，非有限值报错
  * 字符串字面量：单引号或双引号，支持 \\n \\t \\\\ \\' \\" 转义
  * 标识符：``[A-Za-z_][A-Za-z0-9_]*``（true/false/函数名都是标识符，
    由语法层解释含义）
  * 运算符：+ - * / % ( ) , < <= > >= == !=
  * 逻辑关键字：and or not
  * 空白与换行被跳过，但行列位置被精确维护（行列均从 1 开始）
"""

import math

from .errors import ErrorCode, error


class TokenType:
    NUMBER = "NUMBER"
    STRING = "STRING"
    NAME = "NAME"
    OP = "OP"
    EOF = "EOF"


class Token:
    __slots__ = ("type", "value", "line", "column")

    def __init__(self, type_, value, line, column):
        self.type = type_
        self.value = value
        self.line = line
        self.column = column

    def __repr__(self):
        return "Token({}, {!r}, line={}, col={})".format(
            self.type, self.value, self.line, self.column
        )


_TWO_CHAR_OPS = {"<=", ">=", "==", "!="}
_ONE_CHAR_OPS = set("+-*/%(),<>")


def tokenize(text):
    """把表达式文本切分为 token 列表，末尾追加一个 EOF token。

    词法错误直接以带位置的 Diagnostic 抛出（由门面层兜底为结果）。
    """
    if not isinstance(text, str):
        error(ErrorCode.LEX_INVALID_CHAR, "表达式必须是字符串", 1, 1)

    tokens = []
    i = 0
    line = 1
    col = 1
    n = len(text)

    def advance(count=1):
        nonlocal i, line, col
        for _ in range(count):
            if i < n and text[i] == "\n":
                line += 1
                col = 1
            else:
                col += 1
            i += 1

    while i < n:
        ch = text[i]

        # 空白（含换行，换行本身会更新行号）
        if ch in " \t\r\n":
            advance()
            continue

        start_line, start_col = line, col

        # 字符串字面量
        if ch in ("'", '"'):
            quote = ch
            advance()  # 吃掉开引号
            chars = []
            closed = False
            while i < n:
                c = text[i]
                if c == quote:
                    advance()  # 吃掉闭引号
                    closed = True
                    break
                if c == "\\":
                    advance()  # 吃掉反斜杠
                    if i >= n:
                        break
                    esc = text[i]
                    mapping = {"n": "\n", "t": "\t", "r": "\r",
                               "\\": "\\", "'": "'", '"': '"'}
                    if esc in mapping:
                        chars.append(mapping[esc])
                        advance()
                    else:
                        error(
                            ErrorCode.LEX_INVALID_CHAR,
                            "无效的字符串转义序列 \\{}".format(esc),
                            line,
                            col,
                        )
                else:
                    if c == "\n":
                        error(
                            ErrorCode.LEX_UNTERMINATED_STRING,
                            "字符串字面量未闭合（字符串内不能出现裸换行）",
                            start_line,
                            start_col,
                        )
                    chars.append(c)
                    advance()
            if not closed:
                error(
                    ErrorCode.LEX_UNTERMINATED_STRING,
                    "字符串字面量未闭合，缺少 {} 引号".format(quote),
                    start_line,
                    start_col,
                )
            tokens.append(Token(TokenType.STRING, "".join(chars), start_line, start_col))
            continue

        # 数字字面量
        if ch.isdigit() or (ch == "." and i + 1 < n and text[i + 1].isdigit()):
            j = i
            saw_dot = False
            saw_exp = False
            # 整数/小数主体
            while j < n and (text[j].isdigit() or text[j] == "."):
                if text[j] == ".":
                    if saw_dot or saw_exp:
                        error(
                            ErrorCode.LEX_INVALID_NUMBER,
                            "数字字面量格式错误：多余的小数点",
                            line,
                            col + (j - i),
                        )
                    saw_dot = True
                j += 1
            # 科学计数法指数
            if j < n and text[j] in "eE":
                saw_exp = True
                k = j + 1
                if k < n and text[k] in "+-":
                    k += 1
                if k >= n or not text[k].isdigit():
                    error(
                        ErrorCode.LEX_INVALID_NUMBER,
                        "数字字面量的科学计数法指数缺失",
                        line,
                        col + (j - i),
                    )
                while k < n and text[k].isdigit():
                    k += 1
                j = k
            literal = text[i:j]
            try:
                value = float(literal)
            except ValueError:
                error(
                    ErrorCode.LEX_INVALID_NUMBER,
                    "无法解析的数字字面量 {!r}".format(literal),
                    start_line,
                    start_col,
                )
            if not math.isfinite(value):
                error(
                    ErrorCode.LEX_INVALID_NUMBER,
                    "数字字面量 {!r} 不是有限浮点数（溢出为 inf/NaN）".format(literal),
                    start_line,
                    start_col,
                )
            tokens.append(Token(TokenType.NUMBER, value, start_line, start_col))
            advance(j - i)
            continue

        # 标识符
        if ch.isalpha() or ch == "_":
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            name = text[i:j]
            tokens.append(Token(TokenType.NAME, name, start_line, start_col))
            advance(j - i)
            continue

        # 双字符运算符
        two = text[i:i + 2]
        if two in _TWO_CHAR_OPS:
            tokens.append(Token(TokenType.OP, two, start_line, start_col))
            advance(2)
            continue

        # 单字符运算符
        if ch in _ONE_CHAR_OPS:
            tokens.append(Token(TokenType.OP, ch, start_line, start_col))
            advance()
            continue

        error(
            ErrorCode.LEX_INVALID_CHAR,
            "非法字符 {!r}".format(ch),
            start_line,
            start_col,
        )

    tokens.append(Token(TokenType.EOF, None, line, col))
    return tokens
