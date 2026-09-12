"""算术表达式内核：解析、求值、常量折叠与静态检查。

- ``parse(source)``：把表达式文本解析为 ``Node`` 树；
- ``evaluate(node, env)``：对树求值，变量从 ``env`` 取值；
- ``fold(node)``：常量折叠，返回新树，不修改入参；除零/溢出不折叠，
  在节点上记录 ``error`` 并保留原结构；
- ``check(node, defined=...)``：静态检查，返回 ``Diagnostic`` 列表
  （未定义变量 / 除零 / 数值溢出），按 path 字典序升序。

节点结构约定：
- num:   value=float，children=[]
- var:   value=变量名 str，children=[]
- binop: value=运算符（"+-*/"），children=[左, 右]
- unary: value=运算符（"-"），children=[操作数]
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Any

__all__ = ["Node", "Diagnostic", "parse", "evaluate", "fold", "check"]

#: 中间结果绝对值上限，超过即判定溢出
OVERFLOW_LIMIT = 1e308

_NODE_KINDS = ("num", "var", "binop", "unary")


@dataclass
class Node:
    kind: str
    value: Any = None
    children: list["Node"] = field(default_factory=list)
    # fold 标记的静态错误（如 "division_by_zero" / "overflow"），check 直接沿用
    error: str | None = None


@dataclass(frozen=True)
class Diagnostic:
    code: str
    message: str
    path: tuple[int, ...]  # 从根到出错节点的子节点下标路径，根为 ()


# --------------------------------------------------------------------- #
# 解析
# --------------------------------------------------------------------- #
_TOKEN_RE = re.compile(
    r"""
      (?P<num>(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)
    | (?P<ident>[A-Za-z_]\w*)
    | (?P<op>[+\-*/()])
    | (?P<ws>\s+)
    | (?P<bad>.)
    """,
    re.VERBOSE,
)


def _lex(source: str) -> list[tuple[str, str]]:
    tokens: list[tuple[str, str]] = []
    for m in _TOKEN_RE.finditer(source):
        kind = m.lastgroup
        text = m.group()
        if kind == "ws":
            continue
        if kind == "bad":
            raise ValueError(f"无法识别的字符: {text!r}")
        tokens.append((kind, text))
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, str]]) -> None:
        self._tokens = tokens
        self._pos = 0

    def _peek(self) -> tuple[str, str] | None:
        if self._pos < len(self._tokens):
            return self._tokens[self._pos]
        return None

    def _next(self) -> tuple[str, str]:
        tok = self._peek()
        if tok is None:
            raise ValueError("表达式意外结束")
        self._pos += 1
        return tok

    def _expect_op(self, op: str) -> None:
        kind, text = self._next()
        if kind != "op" or text != op:
            raise ValueError(f"期望 {op!r}，实际得到 {text!r}")

    # expr := term (('+'|'-') term)*
    def parse_expr(self) -> Node:
        node = self.parse_term()
        while self._peek() in (("op", "+"), ("op", "-")):
            _, op = self._next()
            rhs = self.parse_term()
            node = Node("binop", op, [node, rhs])
        return node

    # term := factor (('*'|'/') factor)*
    def parse_term(self) -> Node:
        node = self.parse_factor()
        while self._peek() in (("op", "*"), ("op", "/")):
            _, op = self._next()
            rhs = self.parse_factor()
            node = Node("binop", op, [node, rhs])
        return node

    # factor := '-' factor | '+' factor | atom
    def parse_factor(self) -> Node:
        tok = self._peek()
        if tok == ("op", "-"):
            self._next()
            return Node("unary", "-", [self.parse_factor()])
        if tok == ("op", "+"):
            self._next()
            return self.parse_factor()
        return self.parse_atom()

    # atom := NUMBER | IDENT | '(' expr ')'
    def parse_atom(self) -> Node:
        kind, text = self._next()
        if kind == "num":
            return Node("num", float(text), [])
        if kind == "ident":
            return Node("var", text, [])
        if kind == "op" and text == "(":
            node = self.parse_expr()
            self._expect_op(")")
            return node
        raise ValueError(f"此处不允许出现 {text!r}")


def parse(source: str) -> Node:
    """把表达式文本解析为 Node 树；空表达式抛 ValueError。"""
    tokens = _lex(source)
    if not tokens:
        raise ValueError("空表达式")
    parser = _Parser(tokens)
    node = parser.parse_expr()
    if parser._peek() is not None:
        raise ValueError(f"表达式末尾有多余内容: {parser._peek()[1]!r}")
    return node


# --------------------------------------------------------------------- #
# 求值
# --------------------------------------------------------------------- #
def evaluate(node: Node, env: dict | None = None) -> float:
    """对 Node 树求值；变量从 env 取值，未提供时视为空环境。"""
    env = env or {}
    if node.kind == "num":
        return float(node.value)
    if node.kind == "var":
        if node.value not in env:
            raise NameError(f"未定义变量: {node.value!r}")
        return float(env[node.value])
    if node.kind == "binop":
        left = evaluate(node.children[0], env)
        right = evaluate(node.children[1], env)
        if node.value == "+":
            return left + right
        if node.value == "-":
            return left - right
        if node.value == "*":
            return left * right
        if node.value == "/":
            return left / right
        raise ValueError(f"未知二元运算符: {node.value!r}")
    if node.kind == "unary":
        operand = evaluate(node.children[0], env)
        if node.value == "-":
            return -operand
        if node.value == "+":
            return operand
        raise ValueError(f"未知一元运算符: {node.value!r}")
    raise ValueError(f"未知节点 kind: {node.kind!r}")


# --------------------------------------------------------------------- #
# 常量折叠
# --------------------------------------------------------------------- #
def _apply_binop(op: str, left: float, right: float) -> float:
    if op == "+":
        return left + right
    if op == "-":
        return left - right
    if op == "*":
        return left * right
    if op == "/":
        return left / right
    raise ValueError(f"未知二元运算符: {op!r}")


def fold(node: Node) -> Node:
    """常量折叠：返回新树，不修改入参。

    - 子树全为常量的 binop/unary 就地算出数值，替换为 num 节点；
    - 含变量的分支原样保留（子树仍递归折叠）；
    - "/" 右子树折叠后值为 0：不折叠，记录 error="division_by_zero"；
    - 结果绝对值超过 1e308：不折叠，记录 error="overflow"；
    - 已带 error 的节点（重复 fold 时）原样深拷贝返回。
    """
    if node.kind in ("num", "var"):
        return replace(node, children=[])
    if node.error is not None:
        # 已标记错误的节点保持结构不变
        return Node(node.kind, node.value, [fold(c) for c in node.children], node.error)
    if node.kind == "unary":
        child = fold(node.children[0])
        if child.kind == "num":
            result = -child.value if node.value == "-" else child.value
            if abs(result) > OVERFLOW_LIMIT:
                return Node("unary", node.value, [child], error="overflow")
            return Node("num", result, [])
        return Node("unary", node.value, [child])
    if node.kind == "binop":
        left = fold(node.children[0])
        right = fold(node.children[1])
        if left.kind == "num" and right.kind == "num":
            if node.value == "/" and right.value == 0:
                return Node("binop", node.value, [left, right],
                            error="division_by_zero")
            result = _apply_binop(node.value, left.value, right.value)
            if abs(result) > OVERFLOW_LIMIT:
                return Node("binop", node.value, [left, right], error="overflow")
            return Node("num", result, [])
        return Node("binop", node.value, [left, right])
    raise ValueError(f"未知节点 kind: {node.kind!r}")


# --------------------------------------------------------------------- #
# 静态检查
# --------------------------------------------------------------------- #
def check(node: Node, *, defined: set[str] | None = None) -> list[Diagnostic]:
    """静态检查，返回按 path 字典序升序排列的 Diagnostic 列表。

    - undefined_var：变量不在 defined 中（defined=None 视为全部未定义）；
    - division_by_zero："/" 右子树为常量 0；
    - overflow：常量中间结果绝对值超过 1e308；
    - 节点已带 error 字段时直接沿用该 code，不再重新判定；
    - 未知 kind 抛 ValueError，消息带上该 kind。
    """
    diagnostics: list[Diagnostic] = []

    def walk(n: Node, path: tuple[int, ...]) -> float | None:
        """返回子树常量值（非常量返回 None），沿途收集诊断。"""
        if n.kind not in _NODE_KINDS:
            raise ValueError(f"未知节点 kind: {n.kind!r}")
        if n.error is not None:
            # fold 已下结论，直接沿用，不再重新判定
            diagnostics.append(Diagnostic(n.error, _message(n.error, n), path))
            for i, c in enumerate(n.children):
                walk(c, path + (i,))
            return None
        if n.kind == "num":
            return float(n.value)
        if n.kind == "var":
            if defined is None or n.value not in defined:
                diagnostics.append(
                    Diagnostic("undefined_var", f"未定义变量: {n.value!r}", path)
                )
            return None
        if n.kind == "unary":
            value = walk(n.children[0], path + (0,))
            if value is None:
                return None
            result = -value if n.value == "-" else value
            if abs(result) > OVERFLOW_LIMIT:
                diagnostics.append(
                    Diagnostic("overflow", "数值溢出: 中间结果超过 1e308", path)
                )
                return None
            return result
        # binop
        left = walk(n.children[0], path + (0,))
        right = walk(n.children[1], path + (1,))
        if left is None or right is None:
            return None
        if n.value == "/" and right == 0:
            diagnostics.append(
                Diagnostic("division_by_zero", "除零错误", path)
            )
            return None
        result = _apply_binop(n.value, left, right)
        if abs(result) > OVERFLOW_LIMIT:
            diagnostics.append(
                Diagnostic("overflow", "数值溢出: 中间结果超过 1e308", path)
            )
            return None
        return result

    walk(node, ())
    diagnostics.sort(key=lambda d: d.path)
    return diagnostics


def _message(code: str, node: Node) -> str:
    if code == "division_by_zero":
        return "除零错误"
    if code == "overflow":
        return "数值溢出: 中间结果超过 1e308"
    return f"静态错误: {code}"
