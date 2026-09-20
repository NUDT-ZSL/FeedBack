"""Command-line entry point for completely local capacity analysis."""

import argparse
import json
import sys
from datetime import timedelta

from .engine import CapacityPlanner
from .io import records_from_csv_text, records_from_json_text
from .serialize import to_jsonable


def _parse_duration(text):
    unit = text[-1].lower()
    value = int(text[:-1])
    factors = {"h": timedelta(hours=1), "d": timedelta(days=1)}
    if unit not in factors or value <= 0:
        raise argparse.ArgumentTypeError("duration must be like 24h or 7d")
    return value * factors[unit]


def _load(path, input_format):
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if input_format == "auto":
        input_format = "csv" if path.lower().endswith(".csv") else "json"
    if input_format == "csv":
        return records_from_csv_text(text)
    return records_from_json_text(text)


def build_parser():
    parser = argparse.ArgumentParser(description="Analyze resource usage trends offline.")
    parser.add_argument("input", help="JSON or CSV file containing resource observations")
    parser.add_argument("--format", choices=("auto", "json", "csv"), default="auto")
    parser.add_argument("--resource", help="analyze only one resource id")
    parser.add_argument("--horizon", type=_parse_duration, help="forecast horizon, e.g. 30d or 24h")
    parser.add_argument("--step", type=_parse_duration, default=timedelta(hours=1), help="forecast step, e.g. 1h")
    parser.add_argument("--indent", type=int, default=2)
    return parser


def main(argv=None):
    args = build_parser().parse_args(argv)
    records = _load(args.input, args.format)
    planner = CapacityPlanner(
        default_horizon=args.horizon or timedelta(days=7),
        default_step=args.step,
    )
    planner.add_records(records)
    if args.resource:
        result = planner.analyze(args.resource)
        payload = to_jsonable(result)
    else:
        payload = {
            resource_id: to_jsonable(planner.analyze(resource_id))
            for resource_id in planner.resource_ids()
        }
    json.dump(payload, sys.stdout, ensure_ascii=False, indent=args.indent, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
