#!/usr/bin/env python3
"""
Performance test: measure time to process 100k events.
"""
import time
import subprocess
import sys


def run_performance_test():
    # Generate 100k events
    print("Generating 100,000 test events...")
    result = subprocess.run([sys.executable, 'generate_test_events.py', '--count', '100000'],
                          capture_output=True, text=True)
    print(result.stdout)

    # Run processing and time it
    print("\nStarting processing...")
    start_time = time.time()

    result = subprocess.run([sys.executable, 'main.py', '--rules', 'examples/rules.json',
                           '--events', 'examples/events_100k.jsonl', '--output', '/tmp/performance_result.json'],
                          capture_output=True, text=True)

    end_time = time.time()
    elapsed = end_time - start_time

    print(result.stdout)
    if result.stderr:
        print("Stderr:", file=sys.stderr)
        print(result.stderr, file=sys.stderr)

    print(f"\nTotal time: {elapsed:.3f} seconds")

    if elapsed < 2.0:
        print("\nPerformance test PASSED: processed 100k events in under 2 seconds.")
    else:
        print("\nPerformance test: exceeded 2 seconds target.")

    return elapsed < 2.0


if __name__ == '__main__':
    success = run_performance_test()
    sys.exit(0 if success else 1)
