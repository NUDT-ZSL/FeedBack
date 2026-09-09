#!/usr/bin/env python3
"""
Regression test for interactive mode command/event skipping bug.
This test verifies that after a command, subsequent events are not skipped.
"""
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rule_engine.engine import RuleEngine
from rule_engine.event import DeviceEvent
from rule_engine.event_source import StdinEventSource


def test_command_event_alternation():
    """Test that commands don't cause following events to be skipped."""

    # Create test input: command followed by multiple events, multiple times
    test_input = [
        # Command 1: load rules
        "load: examples/rules.json",
        # Event 1
        '{"event_id": "e1", "tenant_id": "factory_a", "device_id": "t1", "metric": "temperature", "value": 85, "timestamp": "2026-09-09T10:00:00Z"}',
        # Event 2
        '{"event_id": "e2", "tenant_id": "factory_b", "device_id": "h1", "metric": "humidity", "value": 15, "timestamp": "2026-09-09T10:01:00Z"}',
        # Command 2: stats
        "stats",
        # Event 3
        '{"event_id": "e3", "tenant_id": "factory_a", "device_id": "t2", "metric": "temperature", "value": 15, "timestamp": "2026-09-09T10:02:00Z"}',
        # Command 3: delete a rule
        "delete: factory_a_temp_gt_80",
        # Event 4
        '{"event_id": "e4", "tenant_id": "factory_a", "device_id": "t3", "metric": "temperature", "value": 85, "timestamp": "2026-09-09T10:03:00Z"}',
    ]

    # Expected results
    expected_processed_count = 4  # All 4 events should be processed
    expected_factory_a_events = 3  # e1, e3, e4
    expected_factory_b_events = 1  # e2

    # Override sys.stdin for testing
    original_stdin = sys.stdin
    sys.stdin = open('test_interactive_input.txt', 'w')
    for line in test_input:
        print(line, file=sys.stdin)
    sys.stdin.close()
    sys.stdin = open('test_interactive_input.txt', 'r')

    # Initialize engine
    engine = RuleEngine()
    # Load initial rules before processing
    engine.load_rules_from_file("examples/rules.json")

    processed_events = []

    # Process events and commands manually to capture results
    event_source = StdinEventSource()
    for item in event_source.events():
        if isinstance(item, str):
            # It's a command - handle it
            line = item
            if line.startswith('load:'):
                path = line[5:].strip()
                engine.load_rules_from_file(path)
            elif line.startswith('delete:'):
                rule_id = line[7:].strip()
                stats = engine.get_statistics()
                for tenant_id in stats['tenants']:
                    if engine.delete_rule(tenant_id, rule_id):
                        break
            # stats command does nothing in this test
            continue
        else:
            # It's an event
            result = engine.process_event(item)
            processed_events.append(result)

    # Clean up
    sys.stdin = original_stdin
    os.unlink('test_interactive_input.txt')

    # Check results
    stats = engine.get_statistics()
    total_processed = len(processed_events)
    print(f"Total events processed: {total_processed}, expected: {expected_processed_count}")
    print(f"Factory A total events: {stats['tenants']['factory_a']['total_events']}, expected: {expected_factory_a_events}")
    print(f"Factory B total events: {stats['tenants']['factory_b']['total_events']}, expected: {expected_factory_b_events}")

    # Check e4: after deleting factory_a_temp_gt_80, 85 should be forward
    e4_action = None
    for tenant_id, tenant_stats in stats['tenants'].items():
        if tenant_id == 'factory_a':
            for alert in tenant_stats['alerts']:
                if alert['event_id'] == 'e1':
                    pass # e1 should be alert
            break

    # Expected after delete:
    # e1: 85 matched before delete -> alert
    # e3: 15 matched -> alert
    # e4: 85 after delete, no matching rule -> forward
    # So factory_a action_counts: forward: 1, alert: 2
    expected_forward_count = 1  # only e4 should be forward
    expected_alert_count = 2    # e1 and e3 should be alert
    forward_count = stats['tenants']['factory_a']['action_counts']['forward']
    alert_count = stats['tenants']['factory_a']['action_counts']['alert']
    print(f"Factory A forward count: {forward_count}, expected: {expected_forward_count}")
    print(f"Factory A alert count: {alert_count}, expected: {expected_alert_count}")

    if (total_processed == expected_processed_count and
        stats['tenants']['factory_a']['total_events'] == expected_factory_a_events and
        stats['tenants']['factory_b']['total_events'] == expected_factory_b_events and
        forward_count == expected_forward_count and
        alert_count == expected_alert_count):
        print("\nTest PASSED: All events processed correctly, no skipping after commands.")
        return True
    else:
        print("\nTest FAILED: Some events were skipped or incorrectly matched.")
        print(json.dumps(stats, indent=2))
        return False


if __name__ == '__main__':
    success = test_command_event_alternation()
    sys.exit(0 if success else 1)
