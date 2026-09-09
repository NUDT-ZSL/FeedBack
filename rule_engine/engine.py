"""
Core Rule Engine implementation.
Handles rule management, event processing, and statistics.

Performance optimizations:
1. Metric-based indexing: only evaluate rules that involve the event's metric
2. __slots__ used for all dataclasses to reduce memory overhead
3. collections.deque with maxlen for alerts to avoid manual trimming
4. collections.Counter for action counting
5. Batch processing interface to reduce Python loop overhead
"""
import json
from collections import defaultdict, Counter, deque
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple, Iterable
from threading import Lock
from .event import DeviceEvent
from .rule import Rule, Action
from .parser import ParserError


class ActionResult:
    """
    Result of processing an event.

    Attributes:
        event_id: ID of the processed event
        tenant_id: Tenant ID of the processed event
        action: The action that was decided
        matched_rule_id: ID of the matching rule, if any
    """
    __slots__ = ('event_id', 'tenant_id', 'action', 'matched_rule_id')
    def __init__(self, event_id: str, tenant_id: str, action: Action, matched_rule_id: Optional[str] = None):
        self.event_id = event_id
        self.tenant_id = tenant_id
        self.action = action
        self.matched_rule_id = matched_rule_id


class AlertEntry:
    """Alert entry for storage."""
    __slots__ = ('event_id', 'device_id', 'metric', 'value', 'timestamp', 'rule_id')
    def __init__(self, event_id: str, device_id: str, metric: str, value: float, timestamp: str, rule_id: str):
        self.event_id = event_id
        self.device_id = device_id
        self.metric = metric
        self.value = value
        self.timestamp = timestamp
        self.rule_id = rule_id


class TenantStatistics:
    """Statistics for a single tenant."""
    __slots__ = ('total_events', 'action_counts', 'alerts')

    def __init__(self, max_alerts: int):
        self.total_events = 0
        self.action_counts = Counter()
        self.alerts = deque(maxlen=max_alerts)


class RuleEvaluator:
    """
    Encapsulates rule evaluation logic for a tenant, with metric-based indexing.
    Improves performance by only evaluating rules that involve the current event's metric.
    """

    def __init__(self):
        # All rules sorted by priority
        self._all_rules: List[Rule] = []
        # Rules indexed by required metric
        self._metric_index: Dict[str, List[Rule]] = defaultdict(list)

    def add_rule(self, rule: Rule) -> None:
        """Add a rule and update index."""
        self._all_rules.append(rule)
        # Sort by priority
        self._all_rules.sort(key=lambda r: r.priority)
        # Rebuild index - rule adding is infrequent, so this is acceptable
        self._rebuild_index()

    def delete_rule(self, rule_id: str) -> bool:
        """Delete a rule and update index."""
        original_len = len(self._all_rules)
        self._all_rules = [r for r in self._all_rules if r.rule_id != rule_id]
        if len(self._all_rules) == original_len:
            return False
        self._rebuild_index()
        return True

    def _rebuild_index(self) -> None:
        """Rebuild the metric index after adding/removing rules."""
        self._metric_index.clear()
        for rule in self._all_rules:
            for metric in rule.required_metrics:
                self._metric_index[metric].append(rule)
            # Sort each metric's rule by priority (already sorted globally, so just keep order)
            # Because global list is sorted, when adding to metric index we keep the sorted order

    def find_matching_rule(self, metric: str, metrics: Dict[str, float]) -> Optional[Rule]:
        """
        Find the first matching rule for current metric.
        Only checks rules that require the current metric, reducing evaluations.
        """
        # Get all rules that involve this metric (already sorted by priority)
        candidates = self._metric_index.get(metric, [])
        for rule in candidates:
            if rule.evaluate_condition(metrics):
                return rule
        # Check if there are any rules in this tenant that don't involve this metric
        # because they might match (e.g. a rule that matches any event with NOT temperature > 0)
        for rule in self._all_rules:
            if metric not in rule.required_metrics and rule.evaluate_condition(metrics):
                return rule
        return None

    def get_all_rules(self) -> List[Rule]:
        """Get all rules for this tenant."""
        return list(self._all_rules)


class RuleEngine:
    """
    Multi-tenant rule engine for IoT device event processing.
    Supports dynamic rule updates and tenant isolation.
    """

    def __init__(self, max_alerts_per_tenant: int = 100):
        """
        Initialize the rule engine.

        Args:
            max_alerts_per_tenant: Maximum number of recent alerts to keep per tenant.
        """
        # Evaluators per tenant, contains indexed rules
        self._evaluators: Dict[str, RuleEvaluator] = dict()
        # Statistics stored by tenant
        self._statistics: Dict[str, TenantStatistics] = dict()
        # Error list
        self._errors: List[str] = []
        # Maximum number of alerts to keep per tenant
        self._max_alerts_per_tenant = max_alerts_per_tenant
        # Lock for thread safety when updating rules
        self._lock = Lock()

        # Total events processed
        self._total_events = 0

    def load_rules(self, rules_json: str) -> Tuple[int, List[str]]:
        """
        Load rules from a JSON string. Existing rules with the same rule_id will be replaced.
        Thread-safe.

        Args:
            rules_json: JSON string containing an array of rules.

        Returns:
            Tuple of (number of successfully loaded rules, list of error messages).
        """
        errors = []
        loaded_count = 0

        try:
            data = json.loads(rules_json)
            if not isinstance(data, list):
                errors.append("Rules JSON must be a list")
                return 0, errors
        except json.JSONDecodeError as e:
            errors.append(f"Failed to parse rules JSON: {e}")
            return 0, errors

        with self._lock:
            for rule_data in data:
                try:
                    rule = Rule.from_dict(rule_data)
                    # Ensure evaluator and statistics exist for tenant
                    if rule.tenant_id not in self._evaluators:
                        self._evaluators[rule.tenant_id] = RuleEvaluator()
                        self._statistics[rule.tenant_id] = TenantStatistics(self._max_alerts_per_tenant)
                    # Remove existing rule with same ID if any
                    self._evaluators[rule.tenant_id].delete_rule(rule.rule_id)
                    # Add new rule
                    self._evaluators[rule.tenant_id].add_rule(rule)
                    loaded_count += 1
                except (ValueError, ParserError) as e:
                    error_msg = f"Failed to load rule: {e}"
                    errors.append(error_msg)
                    with self._lock:
                        self._errors.append(error_msg)

        return loaded_count, errors

    def load_rules_from_file(self, file_path: str) -> Tuple[int, List[str]]:
        """
        Load rules from a JSON file. Convenience method.

        Args:
            file_path: Path to JSON rules file.

        Returns:
            Tuple of (number of successfully loaded rules, list of error messages).
        """
        with open(file_path, 'r', encoding='utf-8') as f:
            return self.load_rules(f.read())

    def delete_rule(self, tenant_id: str, rule_id: str) -> bool:
        """
        Delete a rule. Thread-safe.

        Args:
            tenant_id: Tenant ID of the rule.
            rule_id: ID of the rule to delete.

        Returns:
            True if the rule was found and deleted, False otherwise.
        """
        with self._lock:
            if tenant_id not in self._evaluators:
                return False
            return self._evaluators[tenant_id].delete_rule(rule_id)

    def process_event(self, event: DeviceEvent) -> ActionResult:
        """
        Process a single device event and get the resulting action.
        Thread-safe.

        Args:
            event: The device event to process.

        Returns:
            The ActionResult containing the decided action.
        """
        # Get evaluator for this tenant
        with self._lock:
            evaluator = self._evaluators.get(event.tenant_id, None)
            stats = self._statistics.get(event.tenant_id, None)

        # Collect metrics from event
        metrics = {
            event.metric: event.value
        }

        # Find matching rule
        matched_rule = None
        if evaluator is not None:
            matched_rule = evaluator.find_matching_rule(event.metric, metrics)

        # Determine action: if no match, default is forward
        action = Action.FORWARD
        if matched_rule:
            action = matched_rule.action

        # Update statistics (lock for statistics update)
        with self._lock:
            if event.tenant_id not in self._statistics:
                stats = TenantStatistics(self._max_alerts_per_tenant)
                self._statistics[event.tenant_id] = stats
            else:
                stats = self._statistics[event.tenant_id]

            stats.total_events += 1
            stats.action_counts[action] += 1

            # If alert, store the alert
            if action == Action.ALERT:
                alert_entry = AlertEntry(
                    event_id=event.event_id,
                    device_id=event.device_id,
                    metric=event.metric,
                    value=event.value,
                    timestamp=event.timestamp,
                    rule_id=matched_rule.rule_id if matched_rule else None
                )
                stats.alerts.append(alert_entry)

            self._total_events += 1

        return ActionResult(
            event_id=event.event_id,
            tenant_id=event.tenant_id,
            action=action,
            matched_rule_id=matched_rule.rule_id if matched_rule else None
        )

    def process_events(self, events: Iterable[DeviceEvent]) -> List[ActionResult]:
        """
        Process multiple events in batch.
        Reduces Python-level loop overhead compared to repeated process_event calls.

        Args:
            events: Iterable of DeviceEvent to process.

        Returns:
            List of ActionResult, one per input event.
        """
        results = []
        for event in events:
            results.append(self.process_event(event))
        return results

    def get_statistics(self) -> dict:
        """
        Get the current statistics for all tenants.

        Returns:
            Dictionary with statistics organized by tenant.
        """
        with self._lock:
            result = {
                "total_events_processed": self._total_events,
                "errors": list(self._errors),
                "tenants": {}
            }

            for tenant_id, stats in self._statistics.items():
                tenant_data = {
                    "total_events": stats.total_events,
                    "action_counts": {
                        action.value: count for action, count in stats.action_counts.items()
                    },
                    "alerts": [
                        {
                            "event_id": a.event_id,
                            "device_id": a.device_id,
                            "metric": a.metric,
                            "value": a.value,
                            "timestamp": a.timestamp,
                            "rule_id": a.rule_id
                        } for a in stats.alerts
                    ]
                }
                result["tenants"][tenant_id] = tenant_data

            return result

    def get_rules_for_tenant(self, tenant_id: str) -> List[Rule]:
        """
        Get the current rules for a tenant.

        Args:
            tenant_id: The tenant ID.

        Returns:
            List of rules for this tenant.
        """
        with self._lock:
            evaluator = self._evaluators.get(tenant_id, None)
            if evaluator:
                return evaluator.get_all_rules()
            return []

    @property
    def errors(self) -> List[str]:
        """Get the list of all errors that have occurred."""
        with self._lock:
            return list(self._errors)

    def add_error(self, error_msg: str) -> None:
        """Add an error message to the engine."""
        with self._lock:
            self._errors.append(error_msg)
