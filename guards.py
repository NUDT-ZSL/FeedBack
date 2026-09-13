"""Guard expression parsing and evaluation for the workflow kernel.

A guard is a small boolean expression over instance variables.  Supported
syntax (keywords are case-insensitive)::

    expr        := or_expr
    or_expr     := and_expr (OR and_expr)*
    and_expr    := not_expr (AND not_expr)*
    not_expr    := NOT not_expr | primary
    primary     := '(' expr ')' | comparison
    comparison  := operand (comp_op operand)?
    comp_op     := '==' | '!=' | '<' | '<=' | '>' | '>='
    operand     := IDENT | INT | STRING

A bare operand (no comparison operator) is tested for truthiness: integers
are true when non-zero, strings when non-empty.  Only the standard library
is used; no ``eval`` is ever invoked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

__all__ = [
    "GuardSyntaxError",
    "GuardEvaluationError",
    "parse_guard",
    "evaluate_guard",
    "check_guard",
]

# AST node representation (plain tuples, easy to inspect in tests):
#   ("or", left, right) / ("and", left, right) / ("not", child)
#   ("truthy", operand)
#   ("cmp", left_operand, op_string, right_operand)
# operand:
#   ("var", name) / ("lit", value)   where value is int or str
Node = Tuple[Any, ...]


class GuardSyntaxError(Exception):
    """Raised when a guard expression cannot be tokenized or parsed."""


class GuardEvaluationError(Exception):
    """Raised when a parsed guard cannot be evaluated (unknown variable,
    incomparable operand types, ...)."""


@dataclass(frozen=True)
class _Token:
    kind: str  # "(", ")", "OP", "INT", "STRING", "IDENT", "AND", "OR", "NOT", "EOF"
    text: str
    pos: int


_OPERATORS = ("==", "!=", "<=", ">=", "<", ">")
_KEYWORDS = {"and": "AND", "or": "OR", "not": "NOT"}


def _tokenize(source: str) -> List[_Token]:
    """Split *source* into tokens, raising :class:`GuardSyntaxError` on bad input."""
    tokens: List[_Token] = []
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if ch.isspace():
            i += 1
            continue
        if ch in "()":
            tokens.append(_Token(ch, ch, i))
            i += 1
            continue
        if ch in "=!<>":
            two = source[i : i + 2]
            if two in _OPERATORS:
                tokens.append(_Token("OP", two, i))
                i += 2
                continue
            if ch in "<>":
                tokens.append(_Token("OP", ch, i))
                i += 1
                continue
            raise GuardSyntaxError(f"unexpected character {ch!r} at position {i}")
        if ch in "'\"":
            j = i + 1
            buf: List[str] = []
            while j < n and source[j] != ch:
                if source[j] == "\\" and j + 1 < n:
                    buf.append(source[j + 1])
                    j += 2
                    continue
                buf.append(source[j])
                j += 1
            if j >= n:
                raise GuardSyntaxError(f"unterminated string literal at position {i}")
            tokens.append(_Token("STRING", "".join(buf), i))
            i = j + 1
            continue
        if ch.isdigit() or (ch == "-" and i + 1 < n and source[i + 1].isdigit()):
            j = i + 1 if ch == "-" else i
            while j < n and source[j].isdigit():
                j += 1
            tokens.append(_Token("INT", source[i:j], i))
            i = j
            continue
        if ch.isalpha() or ch == "_":
            j = i
            while j < n and (source[j].isalnum() or source[j] == "_"):
                j += 1
            word = source[i:j]
            kind = _KEYWORDS.get(word.lower(), "IDENT")
            tokens.append(_Token(kind, word, i))
            i = j
            continue
        raise GuardSyntaxError(f"unexpected character {ch!r} at position {i}")
    tokens.append(_Token("EOF", "", n))
    return tokens


class _Parser:
    """Recursive-descent parser over the token stream."""

    def __init__(self, tokens: List[_Token]) -> None:
        self._tokens = tokens
        self._pos = 0

    def peek(self) -> _Token:
        return self._tokens[self._pos]

    def advance(self) -> _Token:
        token = self._tokens[self._pos]
        self._pos += 1
        return token

    def error(self, message: str) -> GuardSyntaxError:
        token = self.peek()
        return GuardSyntaxError(f"{message} at position {token.pos} (got {token.text!r})")


def _parse_operand(parser: _Parser) -> Node:
    token = parser.peek()
    if token.kind == "INT":
        parser.advance()
        return ("lit", int(token.text))
    if token.kind == "STRING":
        parser.advance()
        return ("lit", token.text)
    if token.kind == "IDENT":
        parser.advance()
        return ("var", token.text)
    raise parser.error("expected a variable, number or string")


def _parse_comparison(parser: _Parser) -> Node:
    left = _parse_operand(parser)
    if parser.peek().kind == "OP":
        op = parser.advance().text
        right = _parse_operand(parser)
        return ("cmp", left, op, right)
    return ("truthy", left)


def _parse_primary(parser: _Parser) -> Node:
    if parser.peek().kind == "(":
        parser.advance()
        node = _parse_or(parser)
        if parser.peek().kind != ")":
            raise parser.error("expected ')'")
        parser.advance()
        return node
    return _parse_comparison(parser)


def _parse_not(parser: _Parser) -> Node:
    if parser.peek().kind == "NOT":
        parser.advance()
        return ("not", _parse_not(parser))
    return _parse_primary(parser)


def _parse_and(parser: _Parser) -> Node:
    node = _parse_not(parser)
    while parser.peek().kind == "AND":
        parser.advance()
        node = ("and", node, _parse_not(parser))
    return node


def _parse_or(parser: _Parser) -> Node:
    node = _parse_and(parser)
    while parser.peek().kind == "OR":
        parser.advance()
        node = ("or", node, _parse_and(parser))
    return node


def parse_guard(source: str) -> Node:
    """Parse *source* into an AST.

    :raises GuardSyntaxError: if the expression is empty or malformed.
    """
    if not isinstance(source, str) or not source.strip():
        raise GuardSyntaxError("guard must be a non-empty string")
    parser = _Parser(_tokenize(source))
    node = _parse_or(parser)
    if parser.peek().kind != "EOF":
        raise parser.error("unexpected trailing token")
    return node


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):  # variables never hold bools, but be safe
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        return value != ""
    raise GuardEvaluationError(f"cannot test truthiness of {value!r}")


def _eval_operand(node: Node, variables: Dict[str, Any]) -> Any:
    if node[0] == "lit":
        return node[1]
    name = node[1]
    if name not in variables:
        raise GuardEvaluationError(f"unknown variable {name!r}")
    return variables[name]


def _compare(left: Any, op: str, right: Any) -> bool:
    same_type = isinstance(left, str) == isinstance(right, str)
    if not same_type:
        if op == "==":
            return False
        if op == "!=":
            return True
        raise GuardEvaluationError(
            f"cannot compare {left!r} ({type(left).__name__}) with "
            f"{right!r} ({type(right).__name__}) using {op!r}"
        )
    if op == "==":
        return left == right
    if op == "!=":
        return left != right
    if op == "<":
        return left < right
    if op == "<=":
        return left <= right
    if op == ">":
        return left > right
    if op == ">=":
        return left >= right
    raise GuardEvaluationError(f"unknown comparison operator {op!r}")


def evaluate_guard(node: Node, variables: Dict[str, Any]) -> bool:
    """Evaluate a parsed guard *node* against *variables*.

    :raises GuardEvaluationError: on unknown variables or bad comparisons.
    """
    kind = node[0]
    if kind == "or":
        return evaluate_guard(node[1], variables) or evaluate_guard(node[2], variables)
    if kind == "and":
        return evaluate_guard(node[1], variables) and evaluate_guard(node[2], variables)
    if kind == "not":
        return not evaluate_guard(node[1], variables)
    if kind == "truthy":
        return _truthy(_eval_operand(node[1], variables))
    if kind == "cmp":
        left = _eval_operand(node[1], variables)
        right = _eval_operand(node[3], variables)
        return _compare(left, node[2], right)
    raise GuardEvaluationError(f"corrupt guard node: {node!r}")


def check_guard(source: str, variables: Dict[str, Any]) -> bool:
    """Convenience helper: parse *source* and evaluate it in one call."""
    return evaluate_guard(parse_guard(source), variables)
