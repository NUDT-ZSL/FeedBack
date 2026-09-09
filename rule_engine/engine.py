"""
Core Rule Engine implementation.
Handles rule management, event processing, and statistics.
"""
import json
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from threading import Lock
from .event import DeviceEvent
from .rule import Rule, Action
from .parser import ParserError


@dataclass
class ActionResult:
    """
    Result of processing an event.

    Attributes:
        event_id: ID of the processed event
        tenant_id: Tenant ID of the processed event
        action: The action that was decided
        matched_rule_id: ID of the matching rule, if any
    """
    event_id: str
    tenant_id: str
    action: Action
    matched_rule_id: Optional[str] = None


@dataclass
class AlertEntry:
    """Alert entry for storage."""
    event_id: str
    device_id: str
    metric: str
    value: float
    timestamp: str
    rule_id: str


@dataclass
class TenantStatistics:
    """Statistics for a single tenant."""
    total_events: int = 0
    action_counts: Dict[Action, int] = None
    alerts: List[AlertEntry] = None

    def __post_init__(self):
        if self.action_counts is None:
            self.action_counts = {
                Action.FORWARD: 0,
                Action.ALERT: 0,
                Action.DROP: 0,
            }
        if self.alerts is None:
            self.alerts = []


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
        # Rules stored as: tenant_id -> sorted list of rules (by priority ascending)
        self._rules: Dict[str, List[Rule]] = defaultdict(list)
        # Statistics stored by tenant
        self._statistics: Dict[str, TenantStatistics] = defaultdict(TenantStatistics)
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
                    # Remove existing rule with same ID if it exists
                    self._delete_rule_internal(rule.tenant_id, rule.rule_id)
                    # Add new rule
                    self._rules[rule.tenant_id].append(rule)
                    loaded_count += 1
                except (ValueError, ParserError) as e:
                    error_msg = f"Failed to load rule: {e}"
                    errors.append(error_msg)
                    self._errors.append(error_msg)

            # Sort rules for each tenant by priority (smaller first)
            for tenant_id in self._rules:
                self._rules[tenant_id].sort(key=lambda r: r.priority)

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
            return self._delete_rule_internal(tenant_id, rule_id)

    def _delete_rule_internal(self, tenant_id: str, rule_id: str) -> bool:
        """Internal method to delete a rule - NOT thread-safe."""
        if tenant_id not in self._rules:
            return False
        original_len = len(self._rules[tenant_id])
        self._rules[tenant_id] = [r for r in self._rules[tenant_id] if r.rule_id != rule_id]
        if len(self._rules[tenant_id]) == original_len:
            return False
        return True

    def process_event(self, event: DeviceEvent) -> ActionResult:
        """
        Process a single device event and get the resulting action.
        Thread-safe.

        Args:
            event: The device event to process.

        Returns:
            The ActionResult containing the decided action.
        """
        # Get copy of rules for this tenant to avoid holding lock during evaluation
        with self._lock:
            rules = self._rules.get(event.tenant_id, [])

        # Collect metrics from event
        metrics = {
            event.metric: event.value
        }

        # Evaluate rules in priority order
        matched_rule = None
        for rule in rules:
            if rule.evaluate(metrics):
                matched_rule = rule
                break

        # Determine action: if no match, default is forward
        action = Action.FORWARD
        if matched_rule:
            action = matched_rule.action

        # Update statistics (lock for statistics update)
        with self._lock:
            stats = self._statistics[event.tenant_id]
            stats.total_events += 1
            stats.action_counts[action] = stats.action_counts.get(action, 0) + 1

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
                # Trim to max size
                if len(stats.alerts) > self._max_alerts_per_tenant:
                    stats.alerts.pop(0)

            self._total_events += 1

        return ActionResult(
            event_id=event.event_id,
            tenant_id=event.tenant_id,
            action=action,
            matched_rule_id=matched_rule.rule_id if matched_rule else None
        )

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
            return list(self._rules.get(tenant_id, []))

    @property
    def errors(self) -> List[str]:
        """Get the list of all errors that have occurred."""
        return list(self._errors)

    def add_error(self, error_msg: str) -> None:
        """Add an error message to the engine."""
        with self._lock:
            self._errors.append(error_msg)
