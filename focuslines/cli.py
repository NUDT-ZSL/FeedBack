"""Command line interface for the focus tracker.

State is persisted as JSON between invocations (default: focus_state.json
in the current directory; override with --state or FOCUS_STATE).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from .model import FocusError, FocusTracker


def _fmt_duration(seconds: float) -> str:
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(round(seconds)))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{sign}{h:02d}:{m:02d}:{s:02d}"


def _load(path: str) -> FocusTracker:
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as fh:
            return FocusTracker.from_dict(json.load(fh))
    return FocusTracker()


def _save(tracker: FocusTracker, path: str) -> None:
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(tracker.to_dict(), fh, ensure_ascii=False, indent=2)


def _resolve_line(tracker: FocusTracker, ref: str):
    if ref in tracker.lines:
        return tracker.lines[ref]
    for line in tracker.lines.values():
        if line.name == ref:
            return line
    raise FocusError(f"unknown work line: {ref!r}")


def _resolve_stage(line, ref: str):
    for stage in line.stages:
        if ref in (stage.stage_id, stage.name):
            return stage
    raise FocusError(f"unknown stage {ref!r} in line {line.line_id}")


def _print_focus(tracker: FocusTracker) -> None:
    focus = tracker.current_focus()
    if focus is None:
        print("idle: no active focus session")
        return
    print(f"line:      {focus['line_name']} ({focus['line_id']})")
    print(f"stage:     {focus['stage_name']} ({focus['stage_id']})")
    print(f"state:     {focus['state']}")
    print(f"invested:  {_fmt_duration(focus['invested_seconds'])}")
    print(f"remaining: {_fmt_duration(focus['remaining_seconds'])}")


def _print_summary(summary: dict) -> None:
    print(f"line {summary['line_id']}  {summary['name']}  [{summary['status']}]")
    print(f"stages completed: {summary['completed_stages']}/{len(summary['stages'])}")
    print(f"estimated: {_fmt_duration(summary['total_estimated_seconds'])}  "
          f"invested: {_fmt_duration(summary['total_invested_seconds'])}  "
          f"interruptions: {summary['total_interruptions']}")
    for st in summary["stages"]:
        print(f"  {st['stage_id']:>4} {st['name']:<20} {st['status']:<10} "
              f"est {_fmt_duration(st['estimated_seconds'])} "
              f"invested {_fmt_duration(st['invested_seconds'])} "
              f"remaining {_fmt_duration(st['remaining_seconds'])}")
        for intr in st["interruptions"]:
            print(f"        interrupted: {intr['reason'] or '(no reason)'}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="focuslines")
    parser.add_argument("--state", default=os.environ.get(
        "FOCUS_STATE", "focus_state.json"), help="state file path")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add-line", help="create a work line with stages")
    p.add_argument("name")
    p.add_argument("--stage", action="append", required=True,
                   metavar="NAME:MINUTES", help="repeatable, in order")

    sub.add_parser("lines", help="list work lines")

    p = sub.add_parser("start", help="start focusing on a stage")
    p.add_argument("line")
    p.add_argument("stage")

    p = sub.add_parser("interrupt", help="pause the current focus")
    p.add_argument("--reason", default="")

    sub.add_parser("resume", help="resume the interrupted stage")

    p = sub.add_parser("switch", help="switch to another stage")
    p.add_argument("line")
    p.add_argument("stage")

    sub.add_parser("done", help="complete the current stage")

    p = sub.add_parser("abandon", help="abandon a whole work line")
    p.add_argument("line")

    sub.add_parser("status", help="show the current focus session")

    p = sub.add_parser("summary", help="show a line's rollup")
    p.add_argument("line")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    tracker = _load(args.state)
    try:
        if args.cmd == "add-line":
            stages = []
            for spec in args.stage:
                name, _, minutes = spec.rpartition(":")
                if not name or not minutes:
                    raise FocusError(f"bad --stage spec: {spec!r}")
                stages.append((name, float(minutes)))
            line = tracker.add_line(args.name, stages)
            print(f"created line {line.line_id} with "
                  f"{len(line.stages)} stages")
        elif args.cmd == "lines":
            for line in tracker.lines.values():
                done = sum(1 for s in line.stages
                           if s.status.value == "completed")
                print(f"{line.line_id:>4} {line.name:<24} "
                      f"[{line.status.value}] {done}/{len(line.stages)} done")
        elif args.cmd == "start":
            line = _resolve_line(tracker, args.line)
            stage = _resolve_stage(line, args.stage)
            tracker.start_focus(line.line_id, stage.stage_id)
            _print_focus(tracker)
        elif args.cmd == "interrupt":
            tracker.interrupt(reason=args.reason)
            _print_focus(tracker)
        elif args.cmd == "resume":
            tracker.resume()
            _print_focus(tracker)
        elif args.cmd == "switch":
            line = _resolve_line(tracker, args.line)
            stage = _resolve_stage(line, args.stage)
            tracker.switch_stage(line.line_id, stage.stage_id)
            _print_focus(tracker)
        elif args.cmd == "done":
            tracker.complete_stage()
            print("stage completed")
        elif args.cmd == "abandon":
            line = _resolve_line(tracker, args.line)
            tracker.abandon_line(line.line_id)
            _print_summary(tracker.summary(line.line_id))
        elif args.cmd == "status":
            _print_focus(tracker)
        elif args.cmd == "summary":
            line = _resolve_line(tracker, args.line)
            _print_summary(tracker.summary(line.line_id))
    except FocusError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    _save(tracker, args.state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
