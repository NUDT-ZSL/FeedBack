#!/usr/bin/env python3
"""Command-line interface for the hotspot kernel.

Every command prints exactly one JSON line on stdout. Errors are reported
as a JSON object with an "error" field and a non-zero exit code.

State is kept in a JSON file (default ./hotspot_state.json, override with
--state) so the kernel persists across invocations:

    python main.py --state s.json init --decay 0.9 --capacity 3
    python main.py --state s.json add mykey --weight 2 --ts 10
    python main.py --state s.json score mykey --now 12
    python main.py --state s.json evict --n 5 --now 12
    python main.py --state s.json admit mykey --now 12
    python main.py --state s.json burst mykey --now 12
    python main.py --state s.json bursts --now 12
    python main.py --state s.json status
    python main.py --state s.json save --path backup.json
    python main.py --state s.json load --path backup.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from hotspot import Access, HotspotKernel

DEFAULT_STATE = "hotspot_state.json"


class Parser(argparse.ArgumentParser):
    """ArgumentParser that raises instead of exiting, so main() can emit JSON."""

    def error(self, message: str) -> None:
        raise ValueError(message)


def build_parser() -> Parser:
    parser = Parser(
        prog="main.py",
        description="Streaming hotspot detection and eviction-decision kernel CLI",
    )
    parser.add_argument(
        "--state",
        default=DEFAULT_STATE,
        help=f"state file path (default: {DEFAULT_STATE})",
    )
    sub = parser.add_subparsers(dest="cmd")

    p = sub.add_parser("init", help="create a fresh kernel state")
    p.add_argument("--decay", type=float, default=None, help="decay factor in (0,1]")
    p.add_argument("--min-score", type=float, default=None)
    p.add_argument("--capacity", type=int, default=None)
    p.add_argument("--max-keys", type=int, default=None,
                   help="bound tracked keys (omit for exact mode)")
    p.add_argument("--window", type=int, default=None, help="burst window size")
    p.add_argument("--burst-factor", type=float, default=None)
    p.add_argument("--overflow", choices=sorted(HotspotKernel.OVERFLOW_POLICIES),
                   default=None, help="max_keys overflow policy")

    p = sub.add_parser("add", help="record one access")
    p.add_argument("key")
    p.add_argument("--weight", type=int, default=1)
    p.add_argument("--ts", type=int, required=True)

    p = sub.add_parser("score", help="decayed hotness of a key")
    p.add_argument("key")
    p.add_argument("--now", type=int, default=None)

    p = sub.add_parser("evict", help="list eviction candidates")
    p.add_argument("--n", type=int, default=1)
    p.add_argument("--now", type=int, default=None)

    p = sub.add_parser("admit", help="admit a key into the cache if worthy")
    p.add_argument("key")
    p.add_argument("--now", type=int, default=None)

    p = sub.add_parser("burst", help="is a key suddenly hot?")
    p.add_argument("key")
    p.add_argument("--now", type=int, default=None)

    p = sub.add_parser("bursts", help="list all currently bursting keys")
    p.add_argument("--now", type=int, default=None)

    sub.add_parser("status", help="kernel summary")

    p = sub.add_parser("save", help="write state to a file")
    p.add_argument("--path", required=True)

    p = sub.add_parser("load", help="replace state from a file")
    p.add_argument("--path", required=True)

    return parser


def load_kernel(state_path: str) -> HotspotKernel:
    if not Path(state_path).exists():
        raise ValueError(
            f"state file {state_path!r} not found; run 'init' first"
        )
    return HotspotKernel.load(state_path)


def run(args: argparse.Namespace) -> dict:
    if args.cmd == "init":
        config = {
            key: value
            for key, value in {
                "decay": args.decay,
                "min_score": args.min_score,
                "capacity": args.capacity,
                "max_keys": args.max_keys,
                "window": args.window,
                "burst_factor": args.burst_factor,
                "overflow": args.overflow,
            }.items()
            if value is not None
        }
        kernel = HotspotKernel(**config)
        kernel.save(args.state)
        return {"ok": True, "state": args.state, "config": kernel.config()}

    kernel = load_kernel(args.state)

    if args.cmd == "add":
        score = kernel.add(Access(key=args.key, weight=args.weight, ts=args.ts))
        kernel.save(args.state)
        return {"ok": True, "key": args.key, "score": score}

    if args.cmd == "score":
        return {"key": args.key, "score": kernel.score(args.key, args.now)}

    if args.cmd == "evict":
        candidates = kernel.evict_candidates(args.n, args.now)
        return {
            "candidates": [
                {"key": key, "score": kernel.score(key, args.now)}
                for key in candidates
            ]
        }

    if args.cmd == "admit":
        admitted = kernel.admit(args.key, args.now)
        kernel.save(args.state)
        return {
            "key": args.key,
            "admitted": admitted,
            "cache": kernel.cache,
        }

    if args.cmd == "burst":
        cur, prev = kernel.window_counts(args.key, args.now)
        return {
            "key": args.key,
            "burst": kernel.is_burst(args.key, args.now),
            "current": cur,
            "previous": prev,
        }

    if args.cmd == "bursts":
        return {"bursts": kernel.burst_keys(args.now)}

    if args.cmd == "status":
        return {
            "keys": len(kernel),
            "cache": kernel.cache,
            "now": kernel.now,
            "config": kernel.config(),
        }

    if args.cmd == "save":
        kernel.save(args.path)
        return {"ok": True, "path": args.path}

    if args.cmd == "load":
        loaded = HotspotKernel.load(args.path)
        loaded.save(args.state)
        return {"ok": True, "path": args.path, "state": args.state}

    raise ValueError(f"unknown command {args.cmd!r}")


def main(argv=None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
        if args.cmd is None:
            raise ValueError(
                "no command given; expected one of: init, add, score, evict, "
                "admit, burst, bursts, status, save, load"
            )
        result = run(args)
    except Exception as exc:  # every failure becomes one JSON error line
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
