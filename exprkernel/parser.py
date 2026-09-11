"""递归下降解析器：Token 流 -> AST。

优先级从低到高::

    or
    and
    not
    比较       < <= > >= == !=
    加减       + -
    乘除模     * / %
    一元负号   -
    原子       数字 / 字符串 / true / false / 变量 / 函数调用 / ( expr )

``and or not true false`` 都是词法层的普通标识符，由本解析器在
相应位置解释为关键字或布尔字面量，因此它们不能作为变量名使用。
"""

from . import ast_nodes as ast
from .errors import ErrorCode, error
from .lexer import TokenType, tokenize
from .values import DEFAULT_MAX_DEPTH

_COMPARE_OPS = {"<", "<=", ">", ">=", "==", "!="}
_TERM_OPS = {"+", "-"}
_FACTOR_OPS = {"*", "/", "%"}
_RESERVED = {"and", "or", "not", "true", "false"}
# 内置函数名表（参数规则由静态检查器掌握）
KNOWN_FUNCTIONS = {"min", "max", "abs", "round", "if"}


class Parser:
    def __init__(self, tokens, max_depth=DEFAULT_MAX_DEPTH):
        self.tokens = tokens
        self.pos = 0
        self.max_depth = max_depth
        self.paren_depth = 0

    # ---- token 游标 ----
    def _cur(self):
        return self.tokens[self.pos]

    def _advance(self):
        tok = self.tokens[self.pos]
        if tok.type != TokenType.EOF:
            self.pos += 1
        return tok

    def _is_op(self, value):
        tok = self._cur()
        return tok.type == TokenType.OP and tok.value == value

    def _is_name(self, value):
        tok = self._cur()
        return tok.type == TokenType.NAME and tok.value == value

    def _expect_op(self, value):
        tok = self._cur()
        if tok.type != TokenType.OP or tok.value != value:
            error(
                ErrorCode.PARSE_UNEXPECTED_TOKEN,
                "期望运算符 {!r}，但遇到 {}".format(value, self._describe(tok)),
                tok.line,
                tok.column,
            )
        return self._advance()

    @staticmethod
    def _describe(tok):
        if tok.type == TokenType.EOF:
            return "表达式结尾"
        if tok.type == TokenType.NAME:
            return "标识符 {!r}".format(tok.value)
        return "运算符 {!r}".format(tok.value)

    # ---- 入口 ----
    def parse(self):
        if self._cur().type == TokenType.EOF:
            error(ErrorCode.PARSE_EMPTY, "表达式为空", 1, 1)
        expr = self._parse_or()
        tok = self._cur()
        if tok.type != TokenType.EOF:
            error(
                ErrorCode.PARSE_TRAILING_TOKEN,
                "表达式解析完成后存在多余的 {}".format(self._describe(tok)),
                tok.line,
                tok.column,
            )
        return expr

    # ---- 优先级各层 ----
    def _parse_or(self):
        left = self._parse_and()
        while self._is_name("or"):
            tok = self._advance()
            right = self._parse_and()
            left = ast.Logical("or", left, right, tok.line, tok.column)
        return left

    def _parse_and(self):
        left = self._parse_not()
        while self._is_name("and"):
            tok = self._advance()
            right = self._parse_not()
            left = ast.Logical("and", left, right, tok.line, tok.column)
        return left

    def _parse_not(self):
        if self._is_name("not"):
            tok = self._advance()
            operand = self._parse_not()
            return ast.Unary("not", operand, tok.line, tok.column)
        return self._parse_comparison()

    def _parse_comparison(self):
        left = self._parse_additive()
        while self._cur().type == TokenType.OP and self._cur().value in _COMPARE_OPS:
            tok = self._advance()
            right = self._parse_additive()
            left = ast.Binary(tok.value, left, right, tok.line, tok.column)
        return left

    def _parse_additive(self):
        left = self._parse_factor()
        while self._cur().type == TokenType.OP and self._cur().value in _TERM_OPS:
            tok = self._advance()
            right = self._parse_factor()
            left = ast.Binary(tok.value, left, right, tok.line, tok.column)
        return left

    def _parse_factor(self):
        left = self._parse_unary()
        while self._cur().type == TokenType.OP and self._cur().value in _FACTOR_OPS:
            tok = self._advance()
            right = self._parse_unary()
            left = ast.Binary(tok.value, left, right, tok.line, tok.column)
        return left

    def _parse_unary(self):
        if self._is_op("-"):
            tok = self._advance()
            operand = self._parse_unary()
            return ast.Unary("-", operand, tok.line, tok.column)
        # 形如 +x 的正号不支持，避免用户误以为存在该语法
        if self._is_op("+"):
            tok = self._cur()
            error(
                ErrorCode.PARSE_UNEXPECTED_TOKEN,
                "不支持一元正号 '+'",
                tok.line,
                tok.column,
            )
        return self._parse_primary()

    def _parse_primary(self):
        tok = self._cur()

        if tok.type == TokenType.NUMBER:
            self._advance()
            return ast.NumberLit(tok.value, tok.line, tok.column)

        if tok.type == TokenType.STRING:
            self._advance()
            return ast.StringLit(tok.value, tok.line, tok.column)

        if tok.type == TokenType.OP and tok.value == "(":
            if self.paren_depth >= self.max_depth:
                error(
                    ErrorCode.PARSE_DEPTH_EXCEEDED,
                    "括号嵌套深度超过上限 {}".format(self.max_depth),
                    tok.line,
                    tok.column,
                )
            self._advance()
            self.paren_depth += 1
            if self._is_op(")"):
                t = self._cur()
                error(
                    ErrorCode.PARSE_UNEXPECTED_TOKEN,
                    "空括号 () 内缺少表达式",
                    t.line,
                    t.column,
                )
            expr = self._parse_or()
            close = self._cur()
            if not self._is_op(")"):
                error(
                    ErrorCode.PARSE_UNCLOSED_PAREN,
                    "缺少右括号，当前遇到 {}".format(self._describe(close)),
                    close.line,
                    close.column,
                )
            self._expect_op(")")
            self.paren_depth -= 1
            return expr

        if tok.type == TokenType.NAME:
            if tok.value in ("true", "false"):
                self._advance()
                return ast.BoolLit(tok.value == "true", tok.line, tok.column)
            if tok.value in ("and", "or", "not"):
                error(
                    ErrorCode.PARSE_UNEXPECTED_TOKEN,
                    "关键字 {!r} 不能作为变量名".format(tok.value),
                    tok.line,
                    tok.column,
                )
            self._advance()
            # 函数调用
            if self._is_op("("):
                if tok.value not in KNOWN_FUNCTIONS:
                    # 未知函数在静态检查阶段同样会被拦，这里提前给出
                    # 更准确的位置（函数名处）。
                    error(
                        ErrorCode.STATIC_NOT_CALLABLE,
                        "{!r} 不是可调用函数（可用：{}）".format(
                            tok.value, ", ".join(sorted(KNOWN_FUNCTIONS))
                        ),
                        tok.line,
                        tok.column,
                    )
                self._advance()  # (
                args = []
                if not self._is_op(")"):
                    args.append(self._parse_or())
                    while self._is_op(","):
                        self._advance()
                        args.append(self._parse_or())
                close = self._cur()
                if not self._is_op(")"):
                    error(
                        ErrorCode.PARSE_UNCLOSED_PAREN,
                        "函数调用缺少右括号，当前遇到 {}".format(self._describe(close)),
                        close.line,
                        close.column,
                    )
                self._expect_op(")")
                return ast.Call(tok.value, args, tok.line, tok.column)
            return ast.Var(tok.value, tok.line, tok.column)

        if tok.type == TokenType.OP and tok.value == ")":
            error(
                ErrorCode.PARSE_UNEXPECTED_TOKEN,
                "多余的右括号 ')'",
                tok.line,
                tok.column,
            )

        error(
            ErrorCode.PARSE_UNEXPECTED_TOKEN,
            "此处不应出现 {}".format(self._describe(tok)),
            tok.line,
            tok.column,
        )


def parse(text, max_depth=DEFAULT_MAX_DEPTH):
    """词法 + 语法一把过，返回 AST 根节点。"""
    tokens = tokenize(text)
    return Parser(tokens, max_depth=max_depth).parse()
