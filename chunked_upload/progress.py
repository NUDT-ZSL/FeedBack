"""JSON-file persistence for upload progress snapshots.

The progress file is a single JSON document mapping an *upload key* (the
object name) to a snapshot.  Keeping every upload in one document makes
"``start`` the same object twice while an unfinished upload exists" easy to
detect and lets ``status`` enumerate uploads.

Writes are atomic (temp file + ``os.replace``) so a crash mid-write leaves
either the old or the new document, never a truncated one.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

PROGRESS_VERSION = 1
_REQUIRED_FIELDS = (
    "version",
    "upload_id",
    "object_name",
    "file_path",
    "file_size",
    "file_sha256",
    "part_size",
    "total_parts",
    "part_sizes",
    "completed",
    "final_etag",
)


class ProgressError(Exception):
    """Base class for progress-store errors."""


class ProgressCorruptError(ProgressError):
    """The progress file or a snapshot inside it cannot be parsed/validated."""


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string (injectable clock friendly)."""
    return datetime.now(timezone.utc).isoformat()


def validate_snapshot(raw: Any) -> Dict[str, Any]:
    """Validate a progress snapshot; return a normalized copy.

    Raises :class:`ProgressCorruptError` with a field-specific message on any
    structural problem, so callers never trust half-valid JSON.
    """
    if not isinstance(raw, dict):
        raise ProgressCorruptError("snapshot must be a JSON object")

    missing = [f for f in _REQUIRED_FIELDS if f not in raw]
    if missing:
        raise ProgressCorruptError(
            f"snapshot is missing fields: {', '.join(sorted(missing))}"
        )

    if raw["version"] != PROGRESS_VERSION:
        raise ProgressCorruptError(
            f"unsupported progress version: {raw['version']!r}"
        )

    def _require_str(field: str, *, nonempty: bool = True) -> str:
        value = raw[field]
        if not isinstance(value, str) or (nonempty and not value):
            raise ProgressCorruptError(f"field {field!r} must be a non-empty string")
        return value

    upload_id = _require_str("upload_id")
    object_name = _require_str("object_name")
    file_path = _require_str("file_path")

    def _require_nonnegative_int(field: str, minimum: int = 0) -> int:
        value = raw[field]
        # Reject bool, which is a subclass of int.
        if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
            raise ProgressCorruptError(
                f"field {field!r} must be an int >= {minimum}"
            )
        return value

    file_size = _require_nonnegative_int("file_size")
    part_size = _require_nonnegative_int("part_size", minimum=1)
    # Zero parts is legal: it is the empty-file case.
    total_parts = _require_nonnegative_int("total_parts")

    fingerprint = raw["file_sha256"]
    if (
        not isinstance(fingerprint, str)
        or len(fingerprint) != 64
        or any(c not in "0123456789abcdef" for c in fingerprint)
    ):
        raise ProgressCorruptError(
            "field 'file_sha256' must be a 64-char lowercase hex digest"
        )

    part_sizes = raw["part_sizes"]
    if (
        not isinstance(part_sizes, list)
        or len(part_sizes) != total_parts
        or any(
            isinstance(s, bool) or not isinstance(s, int) or s < 0
            for s in part_sizes
        )
    ):
        raise ProgressCorruptError(
            "field 'part_sizes' must be a list of non-negative ints "
            "with total_parts entries"
        )
    if sum(part_sizes) != file_size:
        raise ProgressCorruptError(
            "field 'part_sizes' is inconsistent: sizes do not sum to file_size"
        )

    completed_raw = raw["completed"]
    if not isinstance(completed_raw, dict):
        raise ProgressCorruptError("field 'completed' must be an object")
    completed: Dict[str, str] = {}
    for key, etag in completed_raw.items():
        if not isinstance(key, str) or not key.isdigit():
            raise ProgressCorruptError(
                f"completed-part key {key!r} must be a decimal part number"
            )
        number = int(key)
        if not 1 <= number <= total_parts:
            raise ProgressCorruptError(
                f"completed part {number} outside range 1..{total_parts}"
            )
        if not isinstance(etag, str) or len(etag) != 64:
            raise ProgressCorruptError(
                f"etag for part {number} must be a 64-char hex string"
            )
        completed[key] = etag

    final_etag = raw["final_etag"]
    if final_etag is not None and (
        not isinstance(final_etag, str) or len(final_etag) != 64
    ):
        raise ProgressCorruptError(
            "field 'final_etag' must be null or a 64-char hex string"
        )

    failed_raw = raw.get("failed_parts", [])
    if (
        not isinstance(failed_raw, list)
        or any(isinstance(n, bool) or not isinstance(n, int) for n in failed_raw)
        or any(not 1 <= n <= total_parts for n in failed_raw)
    ):
        raise ProgressCorruptError(
            "field 'failed_parts' must be a list of part numbers in "
            f"1..{total_parts}"
        )
    failed_parts = sorted(set(failed_raw))

    return {
        "version": PROGRESS_VERSION,
        "upload_id": upload_id,
        "object_name": object_name,
        "file_path": file_path,
        "file_size": file_size,
        "file_sha256": fingerprint,
        "part_size": part_size,
        "total_parts": total_parts,
        "part_sizes": part_sizes,
        "completed": completed,
        "failed_parts": failed_parts,
        "final_etag": final_etag,
        "created_at": raw.get("created_at"),
        "updated_at": raw.get("updated_at"),
    }


class ProgressStore:
    """Read/write progress snapshots in one JSON document."""

    def __init__(self, path: os.PathLike | str) -> None:
        self.path = Path(path)

    # -- reads -------------------------------------------------------------

    def load_document(self) -> Dict[str, Dict[str, Any]]:
        """Return the whole ``{object_name: snapshot}`` document.

        A missing file is treated as an empty document; unreadable or
        non-object JSON raises :class:`ProgressCorruptError`.
        """
        try:
            text = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except OSError as exc:
            raise ProgressCorruptError(
                f"cannot read progress file {self.path}: {exc}"
            ) from exc
        try:
            document = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ProgressCorruptError(
                f"progress file {self.path} is not valid JSON: {exc.msg} "
                f"(line {exc.lineno}, column {exc.colno})"
            ) from exc
        if not isinstance(document, dict):
            raise ProgressCorruptError(
                f"progress file {self.path} must contain a JSON object"
            )
        return document

    def load(self, key: str) -> Optional[Dict[str, Any]]:
        """Load and validate one snapshot; ``None`` if the key is absent."""
        document = self.load_document()
        raw = document.get(key)
        if raw is None:
            return None
        return validate_snapshot(raw)

    def keys(self) -> list[str]:
        """Return all object names that currently have a snapshot."""
        return list(self.load_document().keys())

    # -- writes ------------------------------------------------------------

    def save(self, key: str, snapshot: Dict[str, Any]) -> None:
        """Validate, stamp and persist one snapshot under ``key``."""
        normalized = validate_snapshot(snapshot)
        normalized["updated_at"] = utc_now_iso()
        if not normalized.get("created_at"):
            normalized["created_at"] = normalized["updated_at"]

        document = self._load_unvalidated_for_update()
        document[key] = normalized
        self._write_atomic(document)

    def delete(self, key: str) -> bool:
        """Remove one snapshot; return ``True`` if something was removed.

        When the removed snapshot was the last one the progress file itself
        is deleted, so a fresh ``start`` afterwards is unambiguously new.
        """
        document = self._load_unvalidated_for_update()
        if key not in document:
            return False
        del document[key]
        if document:
            self._write_atomic(document)
        else:
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
        return True

    # -- internals ---------------------------------------------------------

    def _load_unvalidated_for_update(self) -> Dict[str, Any]:
        """Like :meth:`load_document` but tolerate the file vanishing."""
        if not self.path.exists():
            return {}
        return self.load_document()

    def _write_atomic(self, document: Dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=self.path.name + ".", suffix=".tmp", dir=str(self.path.parent)
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(document, handle, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp_name, self.path)
        except BaseException:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise
