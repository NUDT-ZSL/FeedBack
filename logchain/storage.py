# -*- coding: utf-8 -*-
"""Persistence: JSONL log files (one record per line, append order)."""
import json
from typing import List

from .model import LogRecord


def load_jsonl(path: str) -> List[LogRecord]:
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(LogRecord.from_dict(json.loads(line)))
            except (ValueError, KeyError) as exc:
                raise ValueError("line %d: invalid record (%s)" % (lineno, exc))
    return records


def save_jsonl(path: str, records: List[LogRecord]):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r.to_dict(), ensure_ascii=False) + "\n")
    import os
    os.replace(tmp, path)
