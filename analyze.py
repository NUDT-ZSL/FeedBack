"""Command-line batch entry point for offline latency budget attribution."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from latency_budget.analyzer import AnalysisError, analyze_batch, load_budgets, load_records  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze request traces without calling any external service.")
    parser.add_argument("--input", "-i", default="sample/sample_requests.json", help="JSON request file")
    parser.add_argument("--budgets", "-b", default="sample/sample_budgets.json", help="Optional stage budget JSON")
    parser.add_argument("--output", "-o", help="Write full JSON analysis to this path")
    parser.add_argument("--timeline", action="store_true", help="Include full timeline slices for every request")
    args = parser.parse_args()

    try:
        records = load_records(args.input)
        budgets = load_budgets(args.budgets) if args.budgets else None
        result = analyze_batch(records, budgets, include_timeline=args.timeline)
    except (OSError, AnalysisError) as exc:
        print(f"Analysis failed: {exc}", file=sys.stderr)
        return 2

    if args.output:
        Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = result["summary"]
    print("Latency budget analysis complete")
    print(f"  requests: {summary['request_count']}")
    print(f"  valid:    {summary['valid_count']}")
    print(f"  warnings: {summary['warning_count']}")
    print(f"  invalid:  {summary['invalid_count']}")
    print(f"  e2e:      {summary['total_end_to_end_ms']} ms")
    print(f"  gaps:     {summary['total_unattributed_gap_ms']} ms")
    if args.output:
        print(f"  output:   {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
