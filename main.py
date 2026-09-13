"""Command line entry point for the persistent B+tree index.

Usage::

    python main.py --dir ./data [--page-size 4096]

Commands are read from standard input, one JSON object per line.  Every
command produces exactly one JSON object on standard output; failures are
reported as JSON objects containing an ``error`` field (plus ``error_type``
and, when relevant, ``page_id``).

Supported commands::

    {"op": "put", "key": "k", "value": "v"}
    {"op": "get", "key": "k"}
    {"op": "delete", "key": "k"}
    {"op": "scan", "start": "a", "end": "z"}     # start/end optional, half-open
    {"op": "stats"}
    {"op": "dump"}
    {"op": "checkpoint"}
    {"op": "save"}                               # flush pages + manifest
    {"op": "load"}                               # close and reopen from disk
    {"op": "recover"}                            # reopen + replay WAL

The process exits with status 0 after EOF.  A per-command error never
terminates the loop.
"""
from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, Optional

from btree_index import (
    BTreeIndex,
    BTreeIndexError,
    ChecksumMismatchError,
    DEFAULT_PAGE_SIZE,
)


class IndexSession:
    """Lazily opened B+tree handle shared by all commands."""

    def __init__(self, directory: str, page_size: int):
        self.directory = directory
        self.page_size = page_size
        self.index: Optional[BTreeIndex] = None
        self.replayed = 0

    def open(self) -> BTreeIndex:
        """Open (or reopen) the index, recording how many records replayed."""
        if self.index is not None:
            self.index.close()
        self.index = BTreeIndex(self.directory, page_size=self.page_size)
        # ``_recover_from_wal`` ran inside __init__; read its bookkeeping.
        self.replayed = getattr(self.index, "_last_replay_count", 0)
        return self.index

    def get(self) -> BTreeIndex:
        if self.index is None:
            return self.open()
        return self.index

    def close(self) -> None:
        if self.index is not None:
            self.index.close()
            self.index = None


def _error(exc: BaseException) -> Dict[str, Any]:
    doc = {"error": str(exc), "error_type": type(exc).__name__}
    if isinstance(exc, ChecksumMismatchError):
        doc["page_id"] = exc.page_id
        doc["path"] = exc.path
    return doc


def handle_command(cmd: Dict[str, Any], session: IndexSession) -> Dict[str, Any]:
    """Dispatch one decoded command and return its JSON-serialisable result."""
    if not isinstance(cmd, dict) or "op" not in cmd:
        return {"error": "command must be a JSON object with an 'op' field",
                "error_type": "InvalidCommand"}
    op = cmd["op"]

    if op in ("load", "recover"):
        idx = session.open()
        return {"ok": True, "replayed": session.replayed, "root_id": idx.root_id}

    idx = session.get()

    if op == "put":
        idx.put(cmd["key"], cmd.get("value", ""))
        return {"ok": True}
    if op == "get":
        value = idx.get(cmd["key"])
        return {"key": cmd["key"], "found": value is not None, "value": value}
    if op == "delete":
        deleted = idx.delete(cmd["key"])
        return {"key": cmd["key"], "deleted": deleted}
    if op == "scan":
        start = cmd.get("start")
        end = cmd.get("end")
        pairs = idx.scan(start, end)
        return {"pairs": [[k, v] for k, v in pairs], "count": len(pairs)}
    if op == "stats":
        return idx.stats()
    if op == "dump":
        return idx.dump()
    if op == "checkpoint":
        idx.checkpoint()
        return {"ok": True}
    if op == "save":
        idx.save()
        return {"ok": True}
    return {"error": f"unknown op {op!r}; expected one of put/get/delete/scan/"
                     "stats/dump/checkpoint/save/load/recover",
            "error_type": "InvalidCommand"}


def run(argv: Optional[list[str]] = None,
        stdin=None,
        stdout=None) -> int:
    """Read JSON commands, write JSON results.  Always returns 0."""
    parser = argparse.ArgumentParser(description="Persistent B+tree index REPL")
    parser.add_argument("--dir", required=True, help="data directory for the index")
    parser.add_argument("--page-size", type=int, default=DEFAULT_PAGE_SIZE,
                        help=f"page size in bytes (default {DEFAULT_PAGE_SIZE})")
    args = parser.parse_args(argv)

    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    session = IndexSession(args.dir, args.page_size)
    try:
        for line in stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as exc:
                result = {"error": f"invalid JSON: {exc}", "error_type": "JSONDecodeError"}
            else:
                try:
                    result = handle_command(cmd, session)
                except BTreeIndexError as exc:
                    result = _error(exc)
                except KeyError as exc:
                    result = {"error": f"missing required field: {exc.args[0]!r}",
                              "error_type": "MissingField"}
                except (TypeError, ValueError) as exc:
                    result = {"error": str(exc), "error_type": type(exc).__name__}
            stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
            stdout.flush()
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
