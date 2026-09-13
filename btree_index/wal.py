"""Write-ahead log (WAL) for the B+tree index.

The log is a sequence of independent JSON records, one record per line::

    {"op":"put","key":...,"value":...,"ts":...}\n
    {"op":"delete","key":...,"ts":...}\n

Durability contract
--------------------
``append`` flushes the record and ``fsync``s the file before returning, so
once a :meth:`BTreeIndex.put` / :meth:`BTreeIndex.delete` call returns the
operation survives a crash even if no checkpoint ever happened.

Partial / torn writes
---------------------
Each line is independently parsed.  A line that is truncated, contains
invalid UTF-8 or invalid JSON is treated as a *torn tail record*: recovery
stops replay at that point and skips the remainder of the file (a torn
record can only be the final record -- it is the last disk write that was
in flight when power was lost).  Earlier records are never affected because
records are fixed-delimiter framed.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Iterator, List, Optional

OP_PUT = "put"
OP_DELETE = "delete"
VALID_OPS = (OP_PUT, OP_DELETE)


@dataclass
class WALRecord:
    """One logical log entry."""

    op: str
    key: str
    value: Optional[str] = None
    ts: float = 0.0

    def to_dict(self) -> dict:
        doc = {"op": self.op, "key": self.key, "ts": self.ts}
        if self.op == OP_PUT:
            doc["value"] = self.value
        return doc

    @classmethod
    def from_dict(cls, doc: dict) -> "WALRecord":
        op = doc.get("op")
        if op not in VALID_OPS or not isinstance(doc.get("key"), str):
            raise ValueError("malformed WAL record")
        value = doc.get("value")
        if op == OP_PUT and not isinstance(value, str):
            raise ValueError("malformed WAL put record: missing string value")
        return cls(op=op, key=doc["key"], value=value, ts=float(doc.get("ts", 0.0)))


class WAL:
    """Append-only write-ahead log stored as newline-framed JSON."""

    def __init__(self, path: str):
        self.path = path
        self._fh = None  # type: ignore[assignment]
        self._open()

    # ----------------------------------------------------------------- open
    def _open(self) -> None:
        directory = os.path.dirname(os.path.abspath(self.path))
        os.makedirs(directory, exist_ok=True)
        # If a crash left a torn tail record, cut it off before appending so
        # that new records cannot end up stranded behind unparseable bytes.
        self._truncate_torn_tail(self.path)
        # Unbuffered binary append; we flush+fsync explicitly per record.
        self._fh = open(self.path, "ab", buffering=0)

    @staticmethod
    def _truncate_torn_tail(path: str) -> int:
        """Truncate the file at the start of its first unparseable line.

        Returns the number of intact records that remain.  This must run
        before any new record is appended.
        """
        if not os.path.exists(path):
            return 0
        with open(path, "rb") as fh:
            raw = fh.read()
        valid_end = 0
        count = 0
        pos = 0
        while pos < len(raw):
            nl = raw.find(b"\n", pos)
            line_end = len(raw) if nl == -1 else nl
            line = raw[pos:line_end]
            ok = False
            if line:
                try:
                    doc = json.loads(line.decode("utf-8"))
                    WALRecord.from_dict(doc)
                    ok = True
                except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError, TypeError):
                    ok = False
            if not ok:
                break
            count += 1
            valid_end = line_end + 1  # keep the newline too
            if nl == -1:
                break
            pos = line_end + 1
        if valid_end < len(raw):
            with open(path, "r+b") as fh:
                fh.truncate(valid_end)
                fh.flush()
                os.fsync(fh.fileno())
        elif raw and not raw.endswith(b"\n"):
            # A complete final record missing its newline: add it so the next
            # appended record does not fuse with it.
            with open(path, "ab") as fh:
                fh.write(b"\n")
                fh.flush()
                os.fsync(fh.fileno())
        return count

    # --------------------------------------------------------------- append
    def append(self, op: str, key: str, value: Optional[str] = None, ts: Optional[float] = None) -> WALRecord:
        """Append, flush and fsync one record; return the stored record."""
        if op not in VALID_OPS:
            raise ValueError(f"invalid WAL op {op!r}")
        if ts is None:
            ts = time.time()
        record = WALRecord(op=op, key=key, value=value, ts=ts)
        line = (json.dumps(record.to_dict(), ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        self._fh.write(line)
        self._fh.flush()
        os.fsync(self._fh.fileno())
        return record

    # --------------------------------------------------------------- replay
    @staticmethod
    def read_records(path: str) -> List[WALRecord]:
        """Parse all intact records from a WAL file.

        Returns:
            The list of records preceding the first torn/invalid line.

        A missing or empty file yields an empty list.  A truncated final
        line (a partial write from a crash) is skipped.
        """
        return list(WAL.iter_records(path))

    @staticmethod
    def iter_records(path: str) -> Iterator[WALRecord]:
        """Yield intact records from *path*, stopping at the first torn one."""
        if not os.path.exists(path):
            return
        with open(path, "rb") as fh:
            raw = fh.read()
        if not raw:
            return
        for line in raw.split(b"\n"):
            if not line:
                continue  # blank tail after final newline
            try:
                doc = json.loads(line.decode("utf-8"))
                yield WALRecord.from_dict(doc)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError, KeyError, TypeError):
                # Torn tail record (partial write) -- skip it and everything
                # after it; nothing later can be trusted as committed.
                return

    # ------------------------------------------------------------- truncate
    def truncate(self) -> None:
        """Remove every record (called after a successful checkpoint)."""
        self._fh.close()
        # Truncate by reopening in write mode, then fsync so the shrink is
        # durable before the checkpoint is declared complete.
        with open(self.path, "wb") as fh:
            fh.flush()
            os.fsync(fh.fileno())
        self._fh = open(self.path, "ab", buffering=0)

    # --------------------------------------------------------------- close
    def close(self) -> None:
        """Flush and release the log file handle."""
        if self._fh is not None and not self._fh.closed:
            self._fh.flush()
            os.fsync(self._fh.fileno())
            self._fh.close()

    def __enter__(self) -> "WAL":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()
