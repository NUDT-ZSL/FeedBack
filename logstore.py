"""Embeddable append-only log storage with segments, sparse indexes and retention.

Pure standard library. Records are appended to an *active* segment; when the
segment grows past a configurable byte limit it is sealed (made read-only), a
sparse index is built for it, and a new active segment is rolled out.

On-disk layout under the store directory::

    manifest.json           -- segments, retention policy, active segment state
    segments/<id>.log       -- one JSON record per line
    index/<id>.idx          -- sparse index (JSON lines of [ts, offset]), sealed segments only

The manifest is the source of truth. It is rewritten atomically (temp file +
``os.replace``) after every roll, eviction or compaction. Files not referenced
by the manifest are treated as leftovers of a crashed write and discarded on
open; an active segment longer than the manifest records is truncated back to
the committed length, which makes ``append`` all-or-nothing.
"""

from __future__ import annotations

import bisect
import json
import os
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

__all__ = [
    "LogStore",
    "LogStoreError",
    "ValidationError",
    "ManifestError",
    "IntegrityError",
    "SegmentNotFoundError",
]

DEFAULT_MAX_SEGMENT_BYTES = 16 * 1024 * 1024
DEFAULT_INDEX_INTERVAL = 128

_RECORD_KEYS = ("record_id", "ts", "level", "message", "fields")


class LogStoreError(Exception):
    """Base class for all log store errors."""


class ValidationError(LogStoreError):
    """A record or argument failed validation."""


class ManifestError(LogStoreError):
    """The manifest is missing or corrupt."""


class IntegrityError(LogStoreError):
    """A segment or index file does not match the manifest."""


class SegmentNotFoundError(LogStoreError):
    """The requested segment does not exist."""


def _validate_record(record: Any) -> Dict[str, Any]:
    """Validate a single record, returning a normalized dict.

    Raises:
        ValidationError: if any field is missing or malformed.
    """
    if not isinstance(record, dict):
        raise ValidationError("record must be a JSON object")
    record_id = record.get("record_id")
    if not isinstance(record_id, str) or not record_id:
        raise ValidationError("record_id must be a non-empty string")
    ts = record.get("ts")
    if not isinstance(ts, int) or isinstance(ts, bool):
        raise ValidationError("ts must be an integer")
    level = record.get("level")
    if not isinstance(level, str) or not level:
        raise ValidationError("level must be a non-empty string")
    message = record.get("message")
    if not isinstance(message, str) or not message:
        raise ValidationError("message must be a non-empty string")
    fields = record.get("fields")
    if not isinstance(fields, dict):
        raise ValidationError("fields must be a dict of string to string")
    for key, value in fields.items():
        if not isinstance(key, str) or not key:
            raise ValidationError("fields keys must be non-empty strings")
        if not isinstance(value, str) or not value:
            raise ValidationError("fields values must be non-empty strings")
    return {
        "record_id": record_id,
        "ts": ts,
        "level": level,
        "message": message,
        "fields": dict(fields),
    }


def _encode_record(record: Dict[str, Any]) -> bytes:
    """Encode a record as one UTF-8 JSON line (newline terminated)."""
    return (json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


class _SegmentMeta:
    """In-memory mirror of one segment's manifest entry."""

    __slots__ = ("segment_id", "start_ts", "end_ts", "record_count",
                 "byte_size", "sealed", "index_interval", "ts_sorted",
                 "last_ts")

    def __init__(self, segment_id: str, index_interval: int, sealed: bool = False) -> None:
        self.segment_id = segment_id
        self.start_ts: Optional[int] = None
        self.end_ts: Optional[int] = None
        self.record_count = 0
        self.byte_size = 0
        self.sealed = sealed
        self.index_interval = index_interval
        # Whether record ts values are monotonic non-decreasing within the
        # segment. Only then may the sparse index be used to skip records.
        self.ts_sorted = True
        # Transient (never persisted): ts of the most recently appended record,
        # used to keep ts_sorted up to date while the segment is active.
        self.last_ts: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "segment_id": self.segment_id,
            "start_ts": self.start_ts,
            "end_ts": self.end_ts,
            "record_count": self.record_count,
            "byte_size": self.byte_size,
            "sealed": self.sealed,
            "index_interval": self.index_interval,
            "ts_sorted": self.ts_sorted,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "_SegmentMeta":
        meta = cls(data["segment_id"], int(data["index_interval"]), bool(data["sealed"]))
        meta.start_ts = data["start_ts"]
        meta.end_ts = data["end_ts"]
        meta.record_count = int(data["record_count"])
        meta.byte_size = int(data["byte_size"])
        meta.ts_sorted = bool(data.get("ts_sorted", True))
        return meta


class LogStore:
    """Segmented append-only log store rooted at a directory."""

    def __init__(self, directory: str, max_segment_bytes: int = DEFAULT_MAX_SEGMENT_BYTES,
                 index_interval: int = DEFAULT_INDEX_INTERVAL) -> None:
        """Open (or create) a store.

        Args:
            directory: store directory; created if missing.
            max_segment_bytes: roll the active segment once it would exceed this
                many bytes. Ignored if the directory already holds a store (the
                persisted config wins). Must be positive.
            index_interval: build the sparse index with one entry per this many
                records. Must be positive.

        Raises:
            ManifestError: the manifest is missing/corrupt while data exists.
            IntegrityError: a segment or index file disagrees with the manifest.
        """
        if max_segment_bytes <= 0:
            raise ValidationError("max_segment_bytes must be positive")
        if index_interval <= 0:
            raise ValidationError("index_interval must be positive")
        self._dir = os.path.abspath(directory)
        self._segments_dir = os.path.join(self._dir, "segments")
        self._index_dir = os.path.join(self._dir, "index")
        self._manifest_path = os.path.join(self._dir, "manifest.json")
        self._max_segment_bytes = max_segment_bytes
        self._index_interval = index_interval
        self._segments: Dict[str, _SegmentMeta] = {}
        self._active_id: Optional[str] = None
        self._retention: Optional[Dict[str, Optional[int]]] = None
        self._evicted_count = 0
        self._next_seq = 1
        self._record_ids: set = set()
        self._index_cache: Dict[str, List[Tuple[int, int]]] = {}
        self._active_fp: Optional[Any] = None

        os.makedirs(self._segments_dir, exist_ok=True)
        os.makedirs(self._index_dir, exist_ok=True)
        if os.path.exists(self._manifest_path):
            self._recover()
        else:
            leftovers = self._list_segment_files()
            if leftovers:
                raise ManifestError(
                    "manifest.json is missing but segment files exist: "
                    + ", ".join(sorted(leftovers)))

    # ------------------------------------------------------------------ paths

    def _seg_path(self, segment_id: str) -> str:
        return os.path.join(self._segments_dir, segment_id + ".log")

    def _idx_path(self, segment_id: str) -> str:
        return os.path.join(self._index_dir, segment_id + ".idx")

    def _list_segment_files(self) -> List[str]:
        names = []
        for base in (self._segments_dir, self._index_dir):
            if os.path.isdir(base):
                names.extend(os.path.join(base, n) for n in os.listdir(base))
        return names

    # --------------------------------------------------------------- manifest

    def _save_manifest(self) -> None:
        """Atomically rewrite manifest.json."""
        data = {
            "version": 1,
            "config": {
                "max_segment_bytes": self._max_segment_bytes,
                "index_interval": self._index_interval,
            },
            "retention": self._retention,
            "active_segment_id": self._active_id,
            "evicted_count": self._evicted_count,
            "next_segment_seq": self._next_seq,
            "segments": [m.to_dict() for m in self._sorted_segments()],
        }
        tmp = self._manifest_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(data, fp, ensure_ascii=False, indent=1)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp, self._manifest_path)

    def _load_manifest(self) -> Dict[str, Any]:
        try:
            with open(self._manifest_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
        except (OSError, json.JSONDecodeError) as exc:
            raise ManifestError(f"manifest is corrupt: {exc}") from exc
        if not isinstance(data, dict) or "segments" not in data or "config" not in data:
            raise ManifestError("manifest is corrupt: missing required keys")
        return data

    # --------------------------------------------------------------- recovery

    def _recover(self) -> None:
        """Validate on-disk state against the manifest and repair crash damage.

        Two crash half-states are recognized and healed silently:

        * a manifest entry whose segment file is already gone is the debris of
          an eviction that crashed between deleting the files and updating the
          manifest — the eviction is completed (entry dropped, counted);
        * files the manifest does not reference are the debris of a crashed
          roll/append/compact/eviction and are discarded.

        Genuine corruption (size/count/ts-range/index mismatches in files that
        *are* present) still raises :class:`IntegrityError`.
        """
        data = self._load_manifest()
        config = data["config"]
        self._max_segment_bytes = int(config["max_segment_bytes"])
        self._index_interval = int(config["index_interval"])
        retention = data.get("retention")
        self._retention = dict(retention) if retention else None
        self._evicted_count = int(data.get("evicted_count", 0))
        self._next_seq = int(data.get("next_segment_seq", 1))
        self._active_id = data.get("active_segment_id")

        known_files = set()
        healed = False
        for entry in data["segments"]:
            meta = _SegmentMeta.from_dict(entry)
            if not os.path.exists(self._seg_path(meta.segment_id)):
                if meta.sealed:
                    # Crashed eviction: the data file is gone but the manifest
                    # still referenced the segment. Complete the eviction.
                    self._evicted_count += 1
                    leftover = self._idx_path(meta.segment_id)
                    if os.path.exists(leftover):
                        os.remove(leftover)
                    healed = True
                    continue
                if meta.record_count > 0:
                    raise IntegrityError(
                        f"segment {meta.segment_id}: data file is missing")
                # An empty active segment lost its file: recreate it.
                open(self._seg_path(meta.segment_id), "wb").close()
                healed = True
            self._segments[meta.segment_id] = meta
            known_files.add(self._seg_path(meta.segment_id))
            if meta.sealed:
                known_files.add(self._idx_path(meta.segment_id))
            self._validate_segment_on_disk(meta)

        if self._active_id is not None and self._active_id not in self._segments:
            raise ManifestError(f"manifest names unknown active segment {self._active_id}")

        # Anything on disk that the manifest does not reference is the debris
        # of a crashed roll/append/compact: identify and discard it.
        for path in self._list_segment_files():
            if path not in known_files:
                os.remove(path)

        if healed:
            self._save_manifest()

    def _validate_segment_on_disk(self, meta: _SegmentMeta) -> None:
        """Check one segment file (and its index) against manifest metadata."""
        path = self._seg_path(meta.segment_id)
        sid = meta.segment_id
        if not os.path.exists(path):
            raise IntegrityError(f"segment {sid}: data file is missing")
        actual_size = os.path.getsize(path)
        if meta.sealed:
            if actual_size != meta.byte_size:
                raise IntegrityError(
                    f"segment {sid}: byte size mismatch "
                    f"(manifest {meta.byte_size}, disk {actual_size})")
        else:
            if actual_size < meta.byte_size:
                raise IntegrityError(
                    f"segment {sid}: data file shorter than manifest records "
                    f"(manifest {meta.byte_size}, disk {actual_size})")
            if actual_size > meta.byte_size:
                # Crash between writing records and updating the manifest:
                # drop the uncommitted tail so the append stays atomic.
                with open(path, "r+b") as fp:
                    fp.truncate(meta.byte_size)

        count = 0
        min_ts: Optional[int] = None
        max_ts: Optional[int] = None
        prev_ts: Optional[int] = None
        ts_sorted = True
        offsets: List[Tuple[int, int]] = []  # (ts, offset) for index checks
        with open(path, "rb") as fp:
            offset = 0
            for line in fp:
                try:
                    record = json.loads(line)
                    record = _validate_record(record)
                except (json.JSONDecodeError, ValidationError) as exc:
                    raise IntegrityError(f"segment {sid}: unparsable record at "
                                         f"offset {offset}: {exc}") from exc
                if record["record_id"] in self._record_ids:
                    raise IntegrityError(
                        f"segment {sid}: duplicate record_id {record['record_id']!r}")
                self._record_ids.add(record["record_id"])
                ts = record["ts"]
                min_ts = ts if min_ts is None else min(min_ts, ts)
                max_ts = ts if max_ts is None else max(max_ts, ts)
                if prev_ts is not None and ts < prev_ts:
                    ts_sorted = False
                prev_ts = ts
                if count % meta.index_interval == 0:
                    offsets.append((ts, offset))
                offset += len(line)
                count += 1

        if count != meta.record_count:
            raise IntegrityError(
                f"segment {sid}: record count mismatch "
                f"(manifest {meta.record_count}, disk {count})")
        if min_ts != meta.start_ts or max_ts != meta.end_ts:
            raise IntegrityError(
                f"segment {sid}: ts range mismatch "
                f"(manifest [{meta.start_ts}, {meta.end_ts}], "
                f"disk [{min_ts}, {max_ts}])")
        if ts_sorted != meta.ts_sorted:
            raise IntegrityError(
                f"segment {sid}: ts_sorted flag mismatch "
                f"(manifest {meta.ts_sorted}, disk {ts_sorted})")
        meta.last_ts = prev_ts

        if meta.sealed:
            if os.path.exists(self._idx_path(sid)):
                index = self._read_index_file(meta)
                if len(index) != len(offsets):
                    raise IntegrityError(
                        f"segment {sid}: index entry count mismatch "
                        f"(index {len(index)}, expected {len(offsets)} for "
                        f"{meta.record_count} records)")
                if index != offsets:
                    raise IntegrityError(
                        f"segment {sid}: index entries do not match segment records")
            else:
                # The index is fully derivable from the segment file (e.g. a
                # crash deleted it after the manifest committed): rebuild it.
                index = offsets
                self._write_index_file(sid, offsets)
            self._index_cache[sid] = index

    def _read_index_file(self, meta: _SegmentMeta) -> List[Tuple[int, int]]:
        path = self._idx_path(meta.segment_id)
        if not os.path.exists(path):
            raise IntegrityError(f"segment {meta.segment_id}: index file is missing")
        entries: List[Tuple[int, int]] = []
        try:
            with open(path, "r", encoding="utf-8") as fp:
                for line in fp:
                    line = line.strip()
                    if not line:
                        continue
                    ts, offset = json.loads(line)
                    entries.append((int(ts), int(offset)))
        except (OSError, json.JSONDecodeError, ValueError, TypeError) as exc:
            raise IntegrityError(
                f"segment {meta.segment_id}: index file is corrupt: {exc}") from exc
        return entries

    # ---------------------------------------------------------------- segments

    def _sorted_segments(self) -> List[_SegmentMeta]:
        """All segments ordered by (start_ts, segment_id); empty ones last."""
        return sorted(
            self._segments.values(),
            key=lambda m: (m.start_ts is None, m.start_ts if m.start_ts is not None else 0,
                           m.segment_id))

    def _new_segment_id(self) -> str:
        segment_id = f"seg-{self._next_seq:06d}"
        self._next_seq += 1
        return segment_id

    def _ensure_active(self) -> _SegmentMeta:
        if self._active_id is not None:
            return self._segments[self._active_id]
        meta = _SegmentMeta(self._new_segment_id(), self._index_interval, sealed=False)
        # Create the (empty) file; it becomes committed at the next manifest save.
        open(self._seg_path(meta.segment_id), "wb").close()
        self._segments[meta.segment_id] = meta
        self._active_id = meta.segment_id
        return meta

    def _write_index_file(self, segment_id: str,
                          entries: List[Tuple[int, int]]) -> None:
        """Atomically write a sparse index file (temp file + rename)."""
        tmp = self._idx_path(segment_id) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fp:
            for ts, offset in entries:
                fp.write(json.dumps([ts, offset]) + "\n")
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp, self._idx_path(segment_id))

    def _seal(self, meta: _SegmentMeta) -> None:
        """Seal the active segment: build its sparse index and mark read-only."""
        entries: List[Tuple[int, int]] = []
        count = 0
        prev_ts: Optional[int] = None
        with open(self._seg_path(meta.segment_id), "rb") as fp:
            offset = 0
            for line in fp:
                ts = json.loads(line)["ts"]
                if count % meta.index_interval == 0:
                    entries.append((ts, offset))
                if prev_ts is not None and ts < prev_ts:
                    meta.ts_sorted = False
                prev_ts = ts
                offset += len(line)
                count += 1
        self._write_index_file(meta.segment_id, entries)
        meta.sealed = True
        self._index_cache[meta.segment_id] = entries

    def _roll(self, active: _SegmentMeta) -> _SegmentMeta:
        """Seal the current active segment and open a fresh one."""
        if self._active_fp is not None:
            # The seal below re-reads the file from disk, so the write buffer
            # must be flushed first or the index would miss buffered records.
            self._active_fp.flush()
            os.fsync(self._active_fp.fileno())
        self._seal(active)
        self._active_id = None
        return self._ensure_active()

    # ------------------------------------------------------------------ append

    def append(self, records: Sequence[Dict[str, Any]]) -> int:
        """Append a batch of records atomically.

        Either every record is appended or none is: the whole batch is
        validated before anything is written, and a crash mid-write is rolled
        back on the next open by truncating the uncommitted tail.

        Returns:
            Number of records appended.

        Raises:
            ValidationError: any record is malformed or its record_id already
                exists (in the store or earlier in the same batch).
        """
        batch: List[Tuple[Dict[str, Any], bytes]] = []
        seen = set()
        for raw in records:
            record = _validate_record(raw)
            rid = record["record_id"]
            if rid in self._record_ids or rid in seen:
                raise ValidationError(f"duplicate record_id: {rid!r}")
            seen.add(rid)
            batch.append((record, _encode_record(record)))
        if not batch:
            return 0

        active = self._ensure_active()
        fp = self._open_active_fp()
        for record, line in batch:
            if active.record_count > 0 and \
                    active.byte_size + len(line) > self._max_segment_bytes:
                active = self._roll(active)
                fp = self._open_active_fp()
            fp.write(line)
            active.byte_size += len(line)
            active.record_count += 1
            ts = record["ts"]
            active.start_ts = ts if active.start_ts is None else min(active.start_ts, ts)
            active.end_ts = ts if active.end_ts is None else max(active.end_ts, ts)
            if active.last_ts is not None and ts < active.last_ts:
                active.ts_sorted = False
            active.last_ts = ts
        fp.flush()
        os.fsync(fp.fileno())
        self._record_ids.update(seen)
        self._save_manifest()
        if self._retention is not None:
            self.enforce_retention()
        return len(batch)

    def _open_active_fp(self) -> Any:
        if self._active_fp is not None:
            self._active_fp.close()
        self._active_fp = open(self._seg_path(self._active_id), "ab")
        return self._active_fp

    # ------------------------------------------------------------------- query

    def query(self, start: int, end: int, level: Optional[str] = None,
              keyword: Optional[str] = None,
              limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Query records with ``start <= ts < end``.

        Args:
            start: inclusive lower bound of the logical time range.
            end: exclusive upper bound. ``start >= end`` yields no results.
            level: exact level filter; ``None`` disables it.
            keyword: case-sensitive substring filter on ``message``; ``None``
                or the empty string disables it.
            limit: maximum number of results. ``0`` yields no results.

        Returns:
            Records sorted by ``(ts, record_id)`` ascending, truncated to
            ``limit`` if given.

        Raises:
            ValidationError: on non-integer bounds or a negative limit.
        """
        for name, value in (("start", start), ("end", end)):
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValidationError(f"{name} must be an integer")
        if limit is not None:
            if not isinstance(limit, int) or isinstance(limit, bool):
                raise ValidationError("limit must be an integer or None")
            if limit < 0:
                raise ValidationError("limit must be non-negative")
        if start >= end or limit == 0:
            return []
        if keyword == "":
            keyword = None

        matches: List[Dict[str, Any]] = []
        for meta in self._sorted_segments():
            if meta.record_count == 0:
                continue
            # Prune segments whose [start_ts, end_ts] cannot intersect [start, end).
            if meta.end_ts < start or meta.start_ts >= end:  # type: ignore[operator]
                continue
            for record in self._scan_segment(meta, start):
                ts = record["ts"]
                if not (start <= ts < end):
                    continue
                if level is not None and record["level"] != level:
                    continue
                if keyword is not None and keyword not in record["message"]:
                    continue
                matches.append(record)
        matches.sort(key=lambda r: (r["ts"], r["record_id"]))
        if limit is not None:
            matches = matches[:limit]
        return matches

    def _scan_segment(self, meta: _SegmentMeta,
                      start: Optional[int] = None) -> Iterator[Dict[str, Any]]:
        """Yield records of a segment, using the sparse index when possible.

        The index maps every Nth record's ts to its byte offset. It is only
        used to skip ahead when ``start`` is a real query lower bound *and*
        the whole segment's ts sequence is monotonic (``meta.ts_sorted``).
        Callers that need every record (compaction, dump) must pass
        ``start=None``: ts may be any integer including negatives, so no
        numeric bound is a safe "read everything" sentinel. Per-record
        filtering happens either way, so query results are always exact.
        """
        offset = 0
        if start is not None and meta.sealed and meta.ts_sorted:
            index = self._index_cache.get(meta.segment_id)
            if index is None:
                index = self._read_index_file(meta)
                self._index_cache[meta.segment_id] = index
            ts_list = [entry[0] for entry in index]
            pos = bisect.bisect_left(ts_list, start)
            if pos > 0:
                offset = index[pos - 1][1]
        if meta.segment_id == self._active_id and self._active_fp is not None:
            # The read below opens the file anew; flush buffered writes first.
            self._active_fp.flush()
        with open(self._seg_path(meta.segment_id), "rb") as fp:
            fp.seek(offset)
            for line in fp:
                yield json.loads(line)

    # --------------------------------------------------------------- retention

    def register_retention(self, max_age: Optional[int] = None,
                           max_segments: Optional[int] = None,
                           max_bytes: Optional[int] = None) -> None:
        """Register a retention policy; any exceeded condition evicts the
        oldest read-only segments. ``None`` disables a condition.

        Args:
            max_age: evict a sealed segment when the newest stored ts minus the
                segment's end ts exceeds this many logical time units.
            max_segments: keep at most this many sealed segments.
            max_bytes: keep sealed segments' total size at or under this.

        Raises:
            ValidationError: a provided value is negative or not an integer.
        """
        for name, value in (("max_age", max_age), ("max_segments", max_segments),
                            ("max_bytes", max_bytes)):
            if value is None:
                continue
            if not isinstance(value, int) or isinstance(value, bool):
                raise ValidationError(f"{name} must be an integer or None")
            if value < 0:
                raise ValidationError(f"{name} must be non-negative")
        self._retention = {
            "max_age": max_age,
            "max_segments": max_segments,
            "max_bytes": max_bytes,
        }
        self._save_manifest()

    def enforce_retention(self) -> List[str]:
        """Evict oldest read-only segments until the policy is satisfied.

        Returns:
            Ids of the evicted segments, oldest first.
        """
        evicted: List[str] = []
        if self._retention is None:
            return evicted
        while True:
            victim = self._pick_eviction_candidate()
            if victim is None:
                break
            self._evict(victim)
            evicted.append(victim.segment_id)
        return evicted

    def _pick_eviction_candidate(self) -> Optional[_SegmentMeta]:
        policy = self._retention
        assert policy is not None
        sealed = [m for m in self._sorted_segments() if m.sealed]
        if not sealed:
            return None
        max_age = policy.get("max_age")
        if max_age is not None:
            newest = max((m.end_ts for m in self._segments.values()
                          if m.end_ts is not None), default=None)
            if newest is not None:
                for meta in sealed:
                    if newest - meta.end_ts > max_age:  # type: ignore[operator]
                        return meta
        max_segments = policy.get("max_segments")
        if max_segments is not None and len(sealed) > max_segments:
            return sealed[0]
        max_bytes = policy.get("max_bytes")
        if max_bytes is not None and sum(m.byte_size for m in sealed) > max_bytes:
            return sealed[0]
        return None

    def _evict(self, meta: _SegmentMeta) -> None:
        """Atomically drop a sealed segment: manifest first, then files.

        A crash between the two leaves orphan files, which recovery discards;
        it can never leave a manifest entry pointing at deleted files.
        """
        del self._segments[meta.segment_id]
        self._index_cache.pop(meta.segment_id, None)
        self._evicted_count += 1
        self._save_manifest()
        for path in (self._seg_path(meta.segment_id), self._idx_path(meta.segment_id)):
            if os.path.exists(path):
                os.remove(path)

    # -------------------------------------------------------------- compaction

    def compact(self, segment_ids: Sequence[str]) -> str:
        """Merge several read-only segments into one new sealed segment.

        Records keep their original order (segments are merged in
        ``(start_ts, segment_id)`` order, records in append order within each
        segment), so query results are identical before and after. A fresh
        sparse index is written for the merged segment and the old segments
        are deleted.

        Returns:
            The new segment's id.

        Raises:
            SegmentNotFoundError: an id does not exist.
            LogStoreError: an id names the active (writable) segment.
            ValidationError: the id list is empty.
        """
        ids = list(segment_ids)
        if not ids:
            raise ValidationError("compact requires at least one segment id")
        metas = []
        for sid in ids:
            meta = self._segments.get(sid)
            if meta is None:
                raise SegmentNotFoundError(f"unknown segment: {sid}")
            if not meta.sealed:
                raise LogStoreError(f"cannot compact active segment: {sid}")
            metas.append(meta)
        metas.sort(key=lambda m: (m.start_ts if m.start_ts is not None else 0,
                                  m.segment_id))

        new_id = self._new_segment_id()
        new_meta = _SegmentMeta(new_id, self._index_interval, sealed=True)
        index: List[Tuple[int, int]] = []
        tmp_log = self._seg_path(new_id) + ".tmp"
        prev_ts: Optional[int] = None
        with open(tmp_log, "wb") as out:
            for meta in metas:
                # Full scan: start=None, never skip via the sparse index.
                for record in self._scan_segment(meta):
                    line = _encode_record(record)
                    if new_meta.record_count % new_meta.index_interval == 0:
                        index.append((record["ts"], new_meta.byte_size))
                    out.write(line)
                    new_meta.byte_size += len(line)
                    new_meta.record_count += 1
                    ts = record["ts"]
                    new_meta.start_ts = ts if new_meta.start_ts is None \
                        else min(new_meta.start_ts, ts)
                    new_meta.end_ts = ts if new_meta.end_ts is None \
                        else max(new_meta.end_ts, ts)
                    if prev_ts is not None and ts < prev_ts:
                        new_meta.ts_sorted = False
                    prev_ts = ts
            out.flush()
            os.fsync(out.fileno())
        self._write_index_file(new_id, index)
        os.replace(tmp_log, self._seg_path(new_id))

        for meta in metas:
            del self._segments[meta.segment_id]
            self._index_cache.pop(meta.segment_id, None)
        self._segments[new_id] = new_meta
        self._index_cache[new_id] = index
        self._save_manifest()
        for meta in metas:
            for path in (self._seg_path(meta.segment_id), self._idx_path(meta.segment_id)):
                if os.path.exists(path):
                    os.remove(path)
        return new_id

    # ------------------------------------------------------------------- state

    def get_state(self) -> Dict[str, Any]:
        """Return aggregate store state."""
        return {
            "segment_count": len(self._segments),
            "active_segment_id": self._active_id,
            "total_records": sum(m.record_count for m in self._segments.values()),
            "total_bytes": sum(m.byte_size for m in self._segments.values()),
            "retention": dict(self._retention) if self._retention else None,
            "evicted_count": self._evicted_count,
        }

    def get_segment(self, segment_id: str) -> Dict[str, Any]:
        """Return details of one segment.

        Raises:
            SegmentNotFoundError: the id does not exist.
        """
        meta = self._segments.get(segment_id)
        if meta is None:
            raise SegmentNotFoundError(f"unknown segment: {segment_id}")
        return {
            "segment_id": meta.segment_id,
            "start_ts": meta.start_ts,
            "end_ts": meta.end_ts,
            "record_count": meta.record_count,
            "byte_size": meta.byte_size,
            "sealed": meta.sealed,
            "active": meta.segment_id == self._active_id,
            "index_entries": len(self._index_cache.get(meta.segment_id, []))
            if meta.sealed else 0,
        }

    def list_segments(self) -> List[Dict[str, Any]]:
        """Return all segments ordered by start ts ascending (empties last)."""
        return [self.get_segment(m.segment_id) for m in self._sorted_segments()]

    def dump(self) -> List[Dict[str, Any]]:
        """Return every stored record sorted by ``(ts, record_id)``."""
        records: List[Dict[str, Any]] = []
        for meta in self._sorted_segments():
            if meta.record_count:
                records.extend(self._scan_segment(meta))
        records.sort(key=lambda r: (r["ts"], r["record_id"]))
        return records

    # --------------------------------------------------------------- save/load

    def save(self, path: str) -> None:
        """Write a portable JSON snapshot (config, retention, all records)."""
        snapshot = {
            "version": 1,
            "config": {
                "max_segment_bytes": self._max_segment_bytes,
                "index_interval": self._index_interval,
            },
            "retention": self._retention,
            "evicted_count": self._evicted_count,
            "records": self.dump(),
        }
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fp:
            json.dump(snapshot, fp, ensure_ascii=False)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(tmp, path)

    def load(self, path: str) -> None:
        """Replace the store's contents with a snapshot written by :meth:`save`.

        Query results after a save/load round trip are identical to before.
        """
        try:
            with open(path, "r", encoding="utf-8") as fp:
                snapshot = json.load(fp)
        except (OSError, json.JSONDecodeError) as exc:
            raise LogStoreError(f"cannot load snapshot: {exc}") from exc
        if not isinstance(snapshot, dict) or "records" not in snapshot:
            raise LogStoreError("snapshot is corrupt: missing records")
        records = [_validate_record(r) for r in snapshot["records"]]

        self.close()
        for base in (self._segments_dir, self._index_dir):
            for name in os.listdir(base):
                os.remove(os.path.join(base, name))
        self._segments.clear()
        self._index_cache.clear()
        self._record_ids.clear()
        self._active_id = None
        config = snapshot.get("config") or {}
        self._max_segment_bytes = int(config.get("max_segment_bytes",
                                                 DEFAULT_MAX_SEGMENT_BYTES))
        self._index_interval = int(config.get("index_interval", DEFAULT_INDEX_INTERVAL))
        self._next_seq = 1
        self._evicted_count = int(snapshot.get("evicted_count", 0))
        retention = snapshot.get("retention")
        self._retention = dict(retention) if retention else None
        if records:
            self.append(records)
        else:
            self._save_manifest()

    # ------------------------------------------------------------------ close

    def close(self) -> None:
        """Flush and close the active segment file."""
        if self._active_fp is not None:
            self._active_fp.close()
            self._active_fp = None

    def __enter__(self) -> "LogStore":
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self.close()
