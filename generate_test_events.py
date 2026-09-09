#!/usr/bin/env python3
"""
Generate a large test file with 100,000 events for performance testing.
Uses the existing rules from examples/rules.json with 3 tenants, random metrics.
"""
import json
import random
import argparse


def generate_events(num_events: int, output_path: str):
    """Generate random events for testing."""
    tenants = ['factory_a', 'factory_b', 'factory_c']
    metrics = ['temperature', 'humidity', 'pressure']

    with open(output_path, 'w', encoding='utf-8') as f:
        for i in range(num_events):
            tenant = random.choice(tenants)
            metric = random.choice(metrics)
            value = random.uniform(-10, 120)
            event = {
                "event_id": f"e{i}",
                "tenant_id": tenant,
                "device_id": f"dev_{random.randint(1, 100)}",
                "metric": metric,
                "value": value,
                "timestamp": "2026-09-09T10:00:00Z"
            }
            f.write(json.dumps(event) + '\n')

    print(f"Generated {num_events} events in {output_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--count', type=int, default=100000, help='Number of events to generate')
    parser.add_argument('--output', default='examples/events_100k.jsonl', help='Output file path')
    args = parser.parse_args()
    generate_events(args.count, args.output)
