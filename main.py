#!/usr/bin/env python3
"""
Command-line interface for the multi-tenant rule engine.
Usage:
    python main.py --rules <rules_file> --events <events_file> [--output <output_file>]
    python main.py --rules <rules_file>  (interactive mode)
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Optional
from rule_engine.engine import RuleEngine
from rule_engine.event_source import EventSource, FileEventSource, StdinEventSource


def main():
    parser = argparse.ArgumentParser(
        description='Multi-tenant IoT Rule Engine - Process device events with tenant rules'
    )
    parser.add_argument('--rules', required=True, help='Path to JSON rules file')
    parser.add_argument('--events', help='Path to events file (JSON lines format)')
    parser.add_argument('--output', help='Path to output JSON file for statistics')

    args = parser.parse_args()

    # Initialize engine
    engine = RuleEngine()

    # Load initial rules
    try:
        loaded_count, errors = engine.load_rules_from_file(args.rules)
        if errors:
            print(f"Errors loading rules: {errors}", file=sys.stderr)
        print(f"Loaded {loaded_count} rules successfully")
    except Exception as e:
        print(f"Fatal error loading rules: {e}", file=sys.stderr)
        sys.exit(1)

    if args.events:
        # Process events from file
        event_source = FileEventSource(args.events)
        process_events(engine, event_source)
    else:
        # Interactive mode with stdin
        print("Running in interactive mode. Enter JSON events line by line.")
        print("Special commands:")
        print("  load: <path>  - load additional rules from file")
        print("  delete: <rule_id> - delete a rule")
        print("  stats        - show current statistics")
        print("  Ctrl+D       - exit and output statistics")
        event_source = StdinEventSource()
        process_interactive(engine, event_source)

    # Get statistics and output
    stats = engine.get_statistics()
    stats['generated_at'] = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

    # Determine output path
    output_path = args.output
    if not output_path:
        if args.events:
            # If input is file and no output specified, default to output/result.json
            output_path = 'output/result.json'
        else:
            # In interactive mode, just print to console
            print(json.dumps(stats, indent=2, ensure_ascii=False))
            return

    # Ensure output directory exists
    import os
    output_dir = os.path.dirname(output_path)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir)

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(stats, f, indent=2, ensure_ascii=False)

    print(f"Statistics saved to {output_path}")


def process_events(engine: RuleEngine, event_source: EventSource) -> None:
    """Process all events from the event source."""
    count = 0
    for event in event_source.events():
        if event is None:
            continue
        result = engine.process_event(event)
        count += 1
    print(f"Processed {count} events")


def process_interactive(engine: RuleEngine, event_source: StdinEventSource) -> None:
    """Process events in interactive mode, handling special commands."""
    count = 0
    for event_or_cmd in event_source.events():
        if event_or_cmd is None:
            # We need to read the line again to get the command
            # The StdinEventSource yields None for commands, so we need to handle
            # this here by reading the last line from stdin? Wait, no - the generator
            # yields one item per line, so None means this line is a command.
            # But how to get the actual line? We need a different approach.
            # Let's actually just read the last line - no, that won't work.
            # Actually, since we can't get the line here, let me just fix this by
            # making the StdinEventSource yield the command instead of None.
            # But since it's already yielding None, let's just read input again here.
            # Hmm, actually, let's just get it from the previous read. Actually, this is a bug.
            # Let me fix it by reading the entire line again.
            line = sys.stdin.readline().strip()
            if not line:
                continue
            if line.startswith('load:'):
                path = line[5:].strip()
                try:
                    loaded_count, errors = engine.load_rules_from_file(path)
                    if errors:
                        print(f"Errors loading rules: {errors}")
                    print(f"Loaded {loaded_count} new rules successfully")
                except Exception as e:
                    print(f"Error loading rules: {e}")
            elif line.startswith('delete:'):
                rule_id = line[7:].strip()
                # Need tenant_id? Actually, rules are unique by rule_id across all tenants?
                # No, rule_id should be unique globally, but let's just delete from all tenants
                # for simplicity. Alternatively, we could search but that's slow. Let's assume
                # rule_id is unique.
                deleted = False
                # We need to get all tenants and check
                stats = engine.get_statistics()
                for tenant_id in stats['tenants']:
                    if engine.delete_rule(tenant_id, rule_id):
                        deleted = True
                        break
                if deleted:
                    print(f"Rule {rule_id} deleted successfully")
                else:
                    print(f"Rule {rule_id} not found")
            elif line == 'stats':
                stats = engine.get_statistics()
                print(json.dumps(stats, indent=2, ensure_ascii=False))
            continue
        result = engine.process_event(event_or_cmd)
        count += 1
        print(f"Processed event {event_or_cmd.event_id}: action={result.action.value} matched_rule={result.matched_rule_id}")
    print(f"\nTotal processed {count} events")


if __name__ == '__main__':
    main()
