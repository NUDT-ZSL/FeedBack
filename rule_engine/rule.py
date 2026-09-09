"""
Rule model definition.
"""
from dataclasses import dataclass
from enum import Enum
from typing import Callable, Optional, Set
from .parser import parse_condition, ParserError


class Action(Enum):
    """Available actions when a rule matches."""
    FORWARD = "forward"
    ALERT = "alert"
    DROP = "drop"


@dataclass
class Rule:
    """
    Represents a processing rule for a tenant.

    Attributes:
        rule_id: Unique identifier for the rule
        tenant_id: The tenant that owns this rule
        priority: Execution priority (lower numbers executed first)
        condition_str: The original condition expression
        condition: The parsed AST of the condition expression
        evaluate: Precompiled callable that evaluates (metrics Dict) -> bool
        action: The action to take when the rule matches
        required_metrics: Set of metrics that this rule depends on
    """
    __slots__ = ('rule_id', 'tenant_id', 'priority', 'condition_str',
                'condition', 'evaluate', 'action', 'required_metrics')
    rule_id: str
    tenant_id: str
    priority: int
    condition_str: str
    condition: Optional[object]
    evaluate: Optional[Callable[[dict], bool]]
    action: Action
    required_metrics: Set[str]

    @classmethod
    def from_dict(cls, data: dict) -> 'Rule':
        """
        Create a Rule from a dictionary, with validation and parsing.

        Args:
            data: Dictionary containing the rule fields.

        Returns:
            A new Rule instance.

        Raises:
            ValueError: If validation fails.
            ParserError: If condition parsing fails.
        """
        rule_id = data.get('rule_id')
        tenant_id = data.get('tenant_id')
        priority = data.get('priority', 100)  # Default priority
        condition_str = data.get('condition')
        action_str = data.get('action')

        # Validation
        if not rule_id or not isinstance(rule_id, str):
            raise ValueError("rule_id must be a non-empty string")
        if not tenant_id or not isinstance(tenant_id, str):
            raise ValueError("tenant_id must be a non-empty string")
        if not isinstance(priority, int):
            raise ValueError("priority must be an integer")
        if not condition_str or not isinstance(condition_str, str):
            raise ValueError("condition must be a non-empty string")
        if not action_str or not isinstance(action_str, str):
            raise ValueError("action must be a non-empty string")

        # Parse action
        try:
            action = Action(action_str.lower())
        except ValueError:
            raise ValueError(f"Invalid action: {action_str}. Must be one of: {[a.value for a in Action]}")

        # Parse condition and collect required metrics
        try:
            condition = parse_condition(condition_str)
            # Collect required metrics by traversing AST
            required_metrics = cls._collect_metrics(condition)
            # Bind condition to evaluation function
            evaluate = lambda metrics: condition.evaluate(metrics)
        except ParserError as e:
            raise ValueError(f"Invalid condition: {e}") from e

        return cls(
            rule_id=str(rule_id),
            tenant_id=str(tenant_id),
            priority=int(priority),
            condition_str=str(condition_str),
            condition=condition,
            evaluate=evaluate,
            action=action,
            required_metrics=required_metrics
        )

    @staticmethod
    def _collect_metrics(node: object) -> Set[str]:
        """Recursively collect all required metrics from AST."""
        from .parser import ComparisonExpression, LogicalExpression
        metrics = set()
        if isinstance(node, ComparisonExpression):
            if isinstance(node.metric, str):
                metrics.add(node.metric)
            return metrics
        elif isinstance(node, LogicalExpression):
            metrics.update(Rule._collect_metrics(node.left))
            if node.right is not None:
                metrics.update(Rule._collect_metrics(node.right))
            return metrics
        return metrics

    def evaluate_condition(self, metrics: dict) -> bool:
        """
        Evaluate the condition against the provided metric values.

        Args:
            metrics: Dictionary of metric names to values.

        Returns:
            True if the condition matches, False otherwise.
        """
        if self.evaluate is None:
            return False
        try:
            return self.evaluate(metrics)
        except Exception:
            return False
