"""Command-line entry point for independent validation of attribution results."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .engine import analyze_batch, load_json_file


def main() -> None:
    parser = argparse.ArgumentParser(description="Analyze request traces and attribute latency budgets.")
    parser.add_argument("input", nargs="?", default="data/sample_requests.json", help="JSON trace file")
    parser.add_argument("--budgets", help="Optional JSON object containing stage budgets in milliseconds")
    parser.add_argument("--segments", action="store_true", help="Include normalized timeline segments in output")
    parser.add_argument("--output", help="Write JSON result to this path instead of stdout")
    args = parser.parse_args()

    data = load_json_file(Path(args.input))
    if args.budgets:
        budgets = load_json_file(Path(args.budgets))
        if isinstance(budgets, dict) and "default_budgets" in budgets:
            budgets = budgets["default_budgets"]
    elif isinstance(data, dict) and isinstance(data.get("default_budgets"), dict):
        budgets = data["default_budgets"]
    else:
        budgets = None

    result = analyze_batch(data, budgets, include_segments=args.segments)
    encoded = json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        Path(args.output).write_text(encoded + "\n", encoding="utf-8")
        print(f"Wrote {args.output}")
    else:
        print(encoded)


if __name__ == "__main__":
    main()
