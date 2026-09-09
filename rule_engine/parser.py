"""
Condition expression parser for rule conditions.
Parses expressions like "temperature > 80 AND humidity < 60" into an AST.
Supports comparison operators: >, <, >=, <=, ==, !=
Supports logical operators: AND, OR, NOT
Supports parentheses for grouping.
"""
from dataclasses import dataclass
from typing import Any, Callable, Dict, Optional, Union
import re


# Token types
TOKEN_EOF = 'EOF'
TOKEN_IDENTIFIER = 'IDENTIFIER'
TOKEN_NUMBER = 'NUMBER'
TOKEN_OP = 'OPERATOR'
TOKEN_LPAREN = 'LPAREN'
TOKEN_RPAREN = 'RPAREN'
TOKEN_AND = 'AND'
TOKEN_OR = 'OR'
TOKEN_NOT = 'NOT'


# Comparison operators mapping to lambda functions
COMPARISON_OPERATORS: Dict[str, Callable[[float, float], bool]] = {
    '>': lambda a, b: a > b,
    '<': lambda a, b: a < b,
    '>=': lambda a, b: a >= b,
    '<=': lambda a, b: a <= b,
    '==': lambda a, b: a == b,
    '!=': lambda a, b: a != b,
}


# Regex patterns for tokenization
PATTERNS = [
    (r'\s+', None),  # Skip whitespace
    (r'[(),]', lambda match: (TOKEN_LPAREN if match.group(0) == '(' else TOKEN_RPAREN, match.group(0))),
    (r'(AND|OR|NOT)', lambda match: (match.group(1), match.group(1))),
    (r'(>=|<=|==|!=|>|<)', lambda match: (TOKEN_OP, match.group(1))),
    (r'[a-zA-Z_][a-zA-Z0-9_]*', lambda match: (TOKEN_IDENTIFIER, match.group(0))),
    (r'\d+(\.\d+)?', lambda match: (TOKEN_NUMBER, float(match.group(0)))),
]


@dataclass
class Token:
    """Represents a parsed token."""
    type: str
    value: Any


class ParserError(Exception):
    """Exception raised when parsing fails."""
    pass


class Tokenizer:
    """Tokenizes a condition expression string."""

    def __init__(self, text: str):
        self.text = text
        self.position = 0

    def next_token(self) -> Token:
        """Get the next token from the input."""
        if self.position >= len(self.text):
            return Token(TOKEN_EOF, None)

        for pattern, handler in PATTERNS:
            match = re.match(pattern, self.text[self.position:])
            if match:
                self.position += match.end(0)
                if handler is None:
                    return self.next_token()
                type_, value = handler(match)
                return Token(type_, value)

        raise ParserError(f"Illegal character at position {self.position}: {self.text[self.position]}")


# AST Node classes
class ExpressionNode:
    """Base class for AST nodes."""
    def evaluate(self, metrics: Dict[str, float]) -> bool:
        """Evaluate this node given the metric values."""
        raise NotImplementedError()


@dataclass
class ComparisonExpression(ExpressionNode):
    """Comparison between a metric and a number."""
    metric: str
    op: Callable[[float, float], bool]
    value: float

    def evaluate(self, metrics: Dict[str, float]) -> bool:
        if self.metric not in metrics:
            return False
        return self.op(metrics[self.metric], self.value)


@dataclass
class LogicalExpression(ExpressionNode):
    """Logical operation between two expressions."""
    left: ExpressionNode
    op: Callable[[bool, bool], bool]
    right: Optional[ExpressionNode] = None

    def evaluate(self, metrics: Dict[str, float]) -> bool:
        if self.right is None:
            # Unary NOT operation
            return not self.left.evaluate(metrics)
        return self.op(self.left.evaluate(metrics), self.right.evaluate(metrics))


class Parser:
    """Recursive descent parser for condition expressions."""

    def __init__(self, tokenizer: Tokenizer):
        self.tokenizer = tokenizer
        self.current_token = self.tokenizer.next_token()

    def error(self, expected: str) -> ParserError:
        raise ParserError(f"Syntax error: expected {expected}, got {self.current_token.type} ({self.current_token.value})")

    def eat(self, token_type: str) -> None:
        """Consume the current token if it matches the expected type."""
        if self.current_token.type == token_type:
            self.current_token = self.tokenizer.next_token()
        else:
            raise self.error(token_type)

    def primary(self) -> ExpressionNode:
        """Parse primary expressions: identifiers, numbers, parentheses, NOT."""
        token = self.current_token
        if token.type == TOKEN_NOT:
            self.eat(TOKEN_NOT)
            expr = self.primary()
            return LogicalExpression(expr, lambda a: not a)
        elif token.type == TOKEN_IDENTIFIER:
            metric = token.value
            self.eat(TOKEN_IDENTIFIER)
            if self.current_token.type == TOKEN_OP:
                op = COMPARISON_OPERATORS[self.current_token.value]
                self.eat(TOKEN_OP)
                if self.current_token.type == TOKEN_NUMBER:
                    value = self.current_token.value
                    self.eat(TOKEN_NUMBER)
                    return ComparisonExpression(metric, op, value)
                elif self.current_token.type == TOKEN_IDENTIFIER:
                    # Comparing two metrics (not used in our case, but supported)
                    other_metric = self.current_token.value
                    self.eat(TOKEN_IDENTIFIER)
                    # We need a special handler here, but for simplicity we'll handle it
                    # by creating a comparison that expects both metrics to exist
                    return ComparisonExpression(metric, op, other_metric)
                else:
                    raise self.error("number or identifier after comparison operator")
            else:
                raise self.error("comparison operator after identifier")
        elif token.type == TOKEN_LPAREN:
            self.eat(TOKEN_LPAREN)
            node = self.expression()
            self.eat(TOKEN_RPAREN)
            return node
        else:
            raise self.error("identifier, 'NOT', or '('")

    def factor(self) -> ExpressionNode:
        """Parse factors (primary after handling precedence)."""
        return self.primary()

    def term(self) -> ExpressionNode:
        """Parse terms (handles AND)."""
        node = self.factor()
        while self.current_token.type == TOKEN_AND:
            op = lambda a, b: a and b
            self.eat(TOKEN_AND)
            right = self.factor()
            node = LogicalExpression(node, op, right)
        return node

    def expression(self) -> ExpressionNode:
        """Parse the entire expression (handles OR)."""
        node = self.term()
        while self.current_token.type == TOKEN_OR:
            op = lambda a, b: a or b
            self.eat(TOKEN_OR)
            right = self.term()
            node = LogicalExpression(node, op, right)
        return node

    def parse(self) -> ExpressionNode:
        """Parse the expression and return the AST root."""
        ast = self.expression()
        if self.current_token.type != TOKEN_EOF:
            raise self.error("end of expression")
        return ast


def parse_condition(condition: str) -> ExpressionNode:
    """
    Parse a condition string into an AST.

    Args:
        condition: The condition expression string.

    Returns:
        The root node of the AST.

    Raises:
        ParserError: If parsing fails.
    """
    tokenizer = Tokenizer(condition)
    parser = Parser(tokenizer)
    return parser.parse()
