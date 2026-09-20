from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Sequence

from .io import load_records
from .models import PredictionWindow
from .planner import CapacityPlanner
from .timeutils import parse_duration


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Offline resource capacity trend analyzer")
    subparsers = parser.add_subparsers(dest="command", required=True)
    analyze = subparsers.add_parser("analyze", help="import records and print a capacity report")
    analyze.add_argument("input", help="JSON or CSV record file")
    analyze.add_argument("--format", choices=("json", "csv"), help="input format; defaults to file suffix")
    analyze.add_argument("--horizon", required=True, help="forecast horizon, such as 30d or P30D")
    analyze.add_argument("--interval", required=True, help="forecast interval, such as 6h or PT6H")
    analyze.add_argument("--resource", action="append", dest="resources", help="limit analysis to a resource_id")
    analyze.add_argument("--output", "-o", help="write JSON report to this path instead of stdout")
    analyze.add_argument("--summary", action="store_true", help="print a compact text summary instead of full JSON")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command != "analyze":
        return 2
    try:
        window = PredictionWindow(parse_duration(args.horizon), parse_duration(args.interval))
        planner = CapacityPlanner(window)
        planner.add_records(load_records(args.input, args.format))
        report = planner.analyze(resource_ids=args.resources)
    except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.summary:
        output = format_summary(report)
    else:
        output = json.dumps(report.to_dict(), ensure_ascii=False, indent=2, allow_nan=False)
    if args.output:
        Path(args.output).write_text(output + "\n", encoding="utf-8")
    else:
        print(output)
    return 0


def format_summary(report) -> str:
    lines = [
        f"generated_at: {report.generated_at.isoformat()}",
        f"resources: {len(report.resources)}",
    ]
    for analysis in report.resources:
        forecast = analysis.forecast
        recommendation = forecast.recommendation
        lines.append(
            f"- {forecast.resource_id}: {recommendation.status}, "
            f"add={recommendation.required_additional_capacity:.3g}, "
            f"quota={forecast.quota:.3g}, "
            f"peak=({recommendation.peak_usage_interval[0]:.3g}, "
            f"{recommendation.peak_usage_interval[1]:.3g}), "
            f"conflicts={forecast.conflict_count}, "
            f"out_of_order={forecast.has_out_of_order_records}"
        )
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
