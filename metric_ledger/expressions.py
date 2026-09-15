"""指标口径公式解析。

公式只允许引用已声明的指标、原始数据字段和常量，运算符为 + - * / 与括号。
所有解析错误都携带出错位置，便于定位非法配置。
"""
from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction


class FormulaError(ValueError):
    """公式非法，错误信息中包含出错位置。"""


class Expr:
    """公式抽象语法树节点基类。"""

    __slots__ = ()


@dataclass(frozen=True)
class Const(Expr):
    value: Fraction


@dataclass(frozen=True)
class Ref(Expr):
    """对指标或原始数据字段的引用。"""

    name: str


@dataclass(frozen=True)
class BinOp(Expr):
    op: str  # '+' '-' '*' '/'
    left: Expr
    right: Expr


@dataclass(frozen=True)
class Neg(Expr):
    operand: Expr


_EOF = "<eof>"


def _tokenize(text: str):
    tokens = []
    i, n = 0, len(text)
    while i < n:
        ch = text[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "+-*/()":
            tokens.append((ch, ch, i))
            i += 1
            continue
        if ch.isdigit() or (ch == "." and i + 1 < n and text[i + 1].isdigit()):
            j = i
            seen_dot = False
            while j < n and (text[j].isdigit() or (text[j] == "." and not seen_dot)):
                if text[j] == ".":
                    seen_dot = True
                j += 1
            tokens.append(("num", text[i:j], i))
            i = j
            continue
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (text[j].isalnum() or text[j] == "_"):
                j += 1
            tokens.append(("ident", text[i:j], i))
            i = j
            continue
        raise FormulaError(f"公式中存在无法识别的字符 {ch!r}(位置 {i})")
    tokens.append((_EOF, "", n))
    return tokens


class _Parser:
    def __init__(self, text: str):
        self._tokens = _tokenize(text)
        self._pos = 0

    def _peek(self):
        return self._tokens[self._pos]

    def _next(self):
        tok = self._tokens[self._pos]
        self._pos += 1
        return tok

    def _expect(self, kind: str):
        tok = self._peek()
        if tok[0] != kind:
            raise FormulaError(
                f"公式在位置 {tok[2]} 处应为 {kind!r}，实际为 {tok[1]!r}"
            )
        return self._next()

    def parse(self) -> Expr:
        expr = self._expr()
        tok = self._peek()
        if tok[0] != _EOF:
            raise FormulaError(f"公式在位置 {tok[2]} 处存在多余内容 {tok[1]!r}")
        return expr

    def _expr(self) -> Expr:
        node = self._term()
        while self._peek()[0] in ("+", "-"):
            op = self._next()[0]
            node = BinOp(op, node, self._term())
        return node

    def _term(self) -> Expr:
        node = self._factor()
        while self._peek()[0] in ("*", "/"):
            op = self._next()[0]
            node = BinOp(op, node, self._factor())
        return node

    def _factor(self) -> Expr:
        tok = self._peek()
        if tok[0] == "-":
            self._next()
            return Neg(self._factor())
        if tok[0] == "num":
            self._next()
            try:
                return Const(Fraction(tok[1]))
            except ValueError as exc:
                raise FormulaError(f"非法数字 {tok[1]!r}(位置 {tok[2]})") from exc
        if tok[0] == "ident":
            self._next()
            return Ref(tok[1])
        if tok[0] == "(":
            self._next()
            node = self._expr()
            self._expect(")")
            return node
        raise FormulaError(f"公式在位置 {tok[2]} 处缺少操作数，实际为 {tok[1]!r}")


def parse(text: str) -> Expr:
    """把公式文本解析为 AST，非法公式抛出带位置的 FormulaError。"""
    if not isinstance(text, str) or not text.strip():
        raise FormulaError("公式不能为空")
    return _Parser(text).parse()


def refs(expr: Expr) -> list:
    """按公式中首次出现的从左到右顺序返回全部引用名(去重)，保证确定性。"""
    seen: list = []

    def walk(node: Expr) -> None:
        if isinstance(node, Ref):
            if node.name not in seen:
                seen.append(node.name)
        elif isinstance(node, BinOp):
            walk(node.left)
            walk(node.right)
        elif isinstance(node, Neg):
            walk(node.operand)

    walk(expr)
    return seen


def render(expr: Expr) -> str:
    """把 AST 渲染为规范形式的公式文本(全括号)，用于来源链展示。"""
    if isinstance(expr, Const):
        return str(expr.value)
    if isinstance(expr, Ref):
        return expr.name
    if isinstance(expr, Neg):
        return f"-{render(expr.operand)}"
    assert isinstance(expr, BinOp)
    return f"({render(expr.left)} {expr.op} {render(expr.right)})"
