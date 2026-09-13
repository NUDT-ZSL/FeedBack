"""Command-line entry point for the log store.

Reads JSON commands from standard input, one per line, and writes one JSON
result per line to standard output. Errors are reported as JSON objects with
an ``error`` field.

Usage: python main.py [store_directory]   (default: ./logstore_data)

Commands (``cmd`` field):
    append    {"cmd":"append","records":[{record_id,ts,level,message,fields},...]}
    query     {"cmd":"query","start":0,"end":10,"level":"INFO","keyword":"x","limit":5}
    retention {"cmd":"retention","max_age":null,"max_segments":3,"max_bytes":null}
    enforce   {"cmd":"enforce"}
    compact   {"cmd":"compact","segment_ids":["seg-000001","seg-000002"]}
    state     {"cmd":"state"}
    segment   {"cmd":"segment","segment_id":"seg-000001"}
    list      {"cmd":"list"}
    save      {"cmd":"save","path":"snapshot.json"}
    load      {"cmd":"load","path":"snapshot.json"}
    dump      {"cmd":"dump"}
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from logstore import LogStore, LogStoreError, ValidationError


def handle(store: LogStore, command: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch one parsed command and return its result object."""
    op = command.get("cmd")
    if op == "append":
        appended = store.append(command.get("records") or [])
        return {"ok": True, "appended": appended}
    if op == "query":
        records = store.query(
            command.get("start"), command.get("end"),
            level=command.get("level"),
            keyword=command.get("keyword"),
            limit=command.get("limit"))
        return {"records": records}
    if op == "retention":
        store.register_retention(
            max_age=command.get("max_age"),
            max_segments=command.get("max_segments"),
            max_bytes=command.get("max_bytes"))
        return {"ok": True}
    if op == "enforce":
        return {"evicted": store.enforce_retention()}
    if op == "compact":
        return {"segment_id": store.compact(command.get("segment_ids") or [])}
    if op == "state":
        return store.get_state()
    if op == "segment":
        return store.get_segment(command.get("segment_id"))
    if op == "list":
        return {"segments": store.list_segments()}
    if op == "save":
        store.save(command.get("path"))
        return {"ok": True}
    if op == "load":
        store.load(command.get("path"))
        return {"ok": True}
    if op == "dump":
        return {"records": store.dump()}
    raise ValidationError(f"unknown command: {op!r}")


def main() -> int:
    """Run the REPL: one JSON command per stdin line, one JSON result per stdout line."""
    store_dir = sys.argv[1] if len(sys.argv) > 1 else "logstore_data"
    try:
        store = LogStore(store_dir)
    except LogStoreError as exc:
        print(json.dumps({"error": str(exc), "type": type(exc).__name__},
                         ensure_ascii=False), flush=True)
        return 1
    with store:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                command = json.loads(line)
                if not isinstance(command, dict):
                    raise ValidationError("command must be a JSON object")
                result = handle(store, command)
            except LogStoreError as exc:
                result = {"error": str(exc), "type": type(exc).__name__}
            except (KeyError, TypeError, ValueError) as exc:
                result = {"error": str(exc), "type": type(exc).__name__}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
