"""Pluggable object-storage backend abstraction.

The coordinator only depends on :class:`StorageBackend`.  A real
implementation would wrap S3-compatible multipart APIs; the offline
implementation :class:`InMemoryBackend` keeps uploaded data in memory and can
be scripted to inject the failure modes real networks produce:

* a part being lost after the server reports success (:class:`PartLostError`),
* the same part number being re-uploaded with different data
  (:class:`PartEtagConflictError`),
* a part upload simply raising an arbitrary exception,
* completion referencing parts the server never stored
  (:class:`PartsMissingError`),
* a wrong etag being returned (via
  :meth:`InMemoryBackend.queue_wrong_etag`), which the coordinator detects with
  its local checksum.
"""

from __future__ import annotations

import hashlib
import threading
from abc import ABC, abstractmethod
from typing import Callable, Dict, List, Optional, Sequence


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class StorageError(Exception):
    """Base class for every error raised by a storage backend."""


class UploadNotFoundError(StorageError):
    """The referenced ``upload_id`` is unknown to the backend."""


class UploadAbortedError(StorageError):
    """The multipart upload has already been aborted."""


class PartNotFoundError(StorageError):
    """The referenced part number was never uploaded."""


class PartEtagConflictError(StorageError):
    """A part number was re-uploaded with different content/etag."""


class PartLostError(StorageError):
    """The backend was configured to drop the uploaded part."""


class PartsMissingError(StorageError):
    """``complete_multipart`` referenced parts the backend does not have."""

    def __init__(self, message: str, part_numbers: Optional[List[int]] = None):
        super().__init__(message)
        self.part_numbers = sorted(part_numbers or [])


# ---------------------------------------------------------------------------
# Abstract backend
# ---------------------------------------------------------------------------


class StorageBackend(ABC):
    """Minimal S3-style multipart upload contract.

    Implementations must be safe to call from multiple worker threads.
    Part numbers are 1-based and contiguous.
    """

    @abstractmethod
    def create_multipart(self, object_name: str, total_size: int) -> str:
        """Open a multipart upload and return its server-assigned id."""

    @abstractmethod
    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        """Upload one part; return the server-side etag for it."""

    @abstractmethod
    def complete_multipart(
        self, upload_id: str, parts: Sequence["PartSpec"]
    ) -> str:
        """Assemble the object from ``parts`` and return the final etag.

        ``parts`` is an ordered sequence of ``(part_number, etag)`` pairs.
        """

    @abstractmethod
    def abort_multipart(self, upload_id: str) -> None:
        """Discard the multipart upload and all of its stored parts."""

    def multipart_exists(self, upload_id: str) -> bool:
        """Return whether an *open* multipart upload with this id exists.

        Used by the coordinator to detect server-side session expiry on
        resume. The default implementation is optimistic (``True``) so
        minimal backends keep working; they should override this with a
        cheap probe (e.g. a list-parts/head request). Independently of this
        probe, the coordinator recovers reactively when
        :meth:`upload_part` / :meth:`complete_multipart` raise
        :class:`UploadNotFoundError`.
        """
        return True


# Lightweight value type used in complete_multipart signatures.
class PartSpec(tuple):
    """``(part_number, etag)`` pair handed to ``complete_multipart``."""

    def __new__(cls, part_number: int, etag: str) -> "PartSpec":
        return super().__new__(cls, (part_number, etag))

    @property
    def part_number(self) -> int:
        return self[0]

    @property
    def etag(self) -> str:
        return self[1]


# ---------------------------------------------------------------------------
# In-memory reference backend with fault injection
# ---------------------------------------------------------------------------


# Fault script entries are tuples (part_number, action, argument).
FaultEntry = tuple  # (int, str, Optional[str])


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class InMemoryBackend(StorageBackend):
    """Offline backend that stores parts in memory.

    The "etag" of a part is the SHA-256 hex digest of its raw bytes, which
    matches the coordinator's local checksum rule.  The final object etag is
    the SHA-256 of the concatenation of all parts in part-number order.

    Faults can be injected per part number:

    * ``queue_exception(part_number, exc)`` – the next upload attempt of that
      part raises ``exc`` instead of storing anything;
    * ``queue_wrong_etag(part_number, bogus=None)`` – the next upload attempt
      stores the part but returns a bogus etag;
    * ``queue_lost_part(part_number)`` – the next attempt reports success but
      silently drops the part (and returns a plausible-looking etag, so the
      loss surfaces at complete time);
    * ``duplicate_policy`` controls what happens when a part number is
      uploaded again: ``"overwrite"`` (default), ``"ignore"`` (keep first),
      ``"reject_same"`` or ``"reject"`` (raise on any duplicate).
    """

    def __init__(
        self,
        *,
        duplicate_policy: str = "overwrite",
        etag_func: Optional[Callable[[bytes], str]] = None,
    ) -> None:
        if duplicate_policy not in ("overwrite", "ignore", "reject_same", "reject"):
            raise ValueError(f"invalid duplicate_policy: {duplicate_policy!r}")
        self._duplicate_policy = duplicate_policy
        self._etag_func = etag_func or _sha256_hex
        self._lock = threading.RLock()
        self._uploads: Dict[str, "_Upload"] = {}
        # object_name -> final etag (a second upload overwrites the entry).
        self._completed: Dict[str, str] = {}
        # object_name -> assembled object bytes, retained after completion.
        self._objects: Dict[str, bytes] = {}
        # Upload ids that reached complete_multipart successfully.
        self._completed_ids: set[str] = set()
        self._next_id = 0
        # One-shot fault queues, consumed in order per part number.
        self._faults: Dict[int, List[FaultEntry]] = {}

    # -- fault injection ---------------------------------------------------

    def queue_exception(self, part_number: int, exc: Exception) -> None:
        """Make the next upload of ``part_number`` raise ``exc``."""
        with self._lock:
            self._faults.setdefault(part_number, []).append(
                (part_number, "exception", exc)
            )

    def queue_wrong_etag(
        self, part_number: int, bogus: Optional[str] = None
    ) -> None:
        """Store the next upload of ``part_number`` but return a bogus etag."""
        with self._lock:
            self._faults.setdefault(part_number, []).append(
                (part_number, "wrong_etag", bogus)
            )

    def queue_lost_part(self, part_number: int) -> None:
        """Report success for the next upload but drop the bytes."""
        with self._lock:
            self._faults.setdefault(part_number, []).append(
                (part_number, "lost", None)
            )

    # -- introspection (test helpers) -------------------------------------

    def has_upload(self, upload_id: str) -> bool:
        with self._lock:
            return upload_id in self._uploads

    def multipart_exists(self, upload_id: str) -> bool:
        """True only for an *open* multipart session (not completed/aborted)."""
        with self._lock:
            return upload_id in self._uploads

    def is_aborted(self, upload_id: str) -> bool:
        with self._lock:
            return (
                upload_id not in self._uploads
                and upload_id not in self._completed_ids
            )

    def stored_part_numbers(self, upload_id: str) -> List[int]:
        with self._lock:
            upload = self._uploads.get(upload_id)
            if upload is None:
                raise UploadNotFoundError(upload_id)
            return sorted(upload.parts)

    def completed_objects(self) -> Dict[str, str]:
        """Return a copy of ``{object_name: final_etag}`` for completed uploads."""
        with self._lock:
            return dict(self._completed)

    # -- StorageBackend ----------------------------------------------------

    def create_multipart(self, object_name: str, total_size: int) -> str:
        if total_size < 0:
            raise ValueError("total_size must be >= 0")
        with self._lock:
            self._next_id += 1
            upload_id = f"upload-{self._next_id:08d}"
            self._uploads[upload_id] = _Upload(object_name, total_size)
            return upload_id

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        if not isinstance(data, (bytes, bytearray, memoryview)):
            raise TypeError("part data must be bytes-like")
        data = bytes(data)
        with self._lock:
            upload = self._uploads.get(upload_id)
            if upload is None:
                if upload_id in self._completed_ids:
                    raise UploadAbortedError(
                        f"upload {upload_id} already completed"
                    )
                raise UploadNotFoundError(f"unknown upload_id: {upload_id}")

            fault = self._pop_fault(part_number)
            if fault is not None:
                _, action, argument = fault
                if action == "exception":
                    raise argument  # type: ignore[misc]
                if action == "lost":
                    # Pretend success but do not retain the part.
                    return self._etag_func(data)
                if action == "wrong_etag":
                    etag = self._store(upload, part_number, data)
                    return argument or "deadbeef" * 8
                raise StorageError(f"unknown fault action: {action}")

            return self._store(upload, part_number, data)

    def complete_multipart(
        self, upload_id: str, parts: Sequence[PartSpec]
    ) -> str:
        with self._lock:
            upload = self._uploads.get(upload_id)
            if upload is None:
                if upload_id in self._completed_ids:
                    raise UploadAbortedError(
                        f"upload {upload_id} already completed"
                    )
                raise UploadNotFoundError(f"unknown upload_id: {upload_id}")

            normalized = [PartSpec(int(pn), str(etag)) for pn, etag in parts]
            present = {pn for pn, _ in normalized}
            missing = sorted(pn for pn in present if pn not in upload.parts)
            if missing:
                raise PartsMissingError(
                    f"upload {upload_id} is missing parts: {missing}",
                    missing,
                )
            mismatched = [
                pn
                for pn, etag in normalized
                if upload.parts[pn].etag != etag
            ]
            if mismatched:
                raise PartEtagConflictError(
                    f"etag mismatch on parts: {mismatched}"
                )

            ordered = sorted(normalized, key=lambda p: p.part_number)
            if ordered:
                expected = list(range(1, ordered[-1].part_number + 1))
            else:
                expected = []
            actual = [pn for pn, _ in ordered]
            absent = sorted(set(expected) - set(actual))
            if absent:
                raise PartsMissingError(
                    f"part numbers must be 1-based and contiguous; "
                    f"missing {absent} (got {actual})",
                    absent,
                )
            if any(n < 1 for n in actual):
                raise PartsMissingError(
                    f"part numbers must start at 1, got {actual}",
                    [n for n in actual if n < 1],
                )

            digest = hashlib.sha256()
            assembled = bytearray()
            for pn, _ in ordered:
                part_bytes = upload.parts[pn].data
                digest.update(part_bytes)
                assembled.extend(part_bytes)
            final_etag = digest.hexdigest()
            del self._uploads[upload_id]
            self._completed[upload.object_name] = final_etag
            self._objects[upload.object_name] = bytes(assembled)
            self._completed_ids.add(upload_id)
            return final_etag

    def abort_multipart(self, upload_id: str) -> None:
        with self._lock:
            if upload_id in self._uploads:
                del self._uploads[upload_id]
                return
            if upload_id in self._completed_ids:
                raise UploadAbortedError(
                    f"upload {upload_id} already completed; cannot abort"
                )
            # Unknown id: signal it so callers (and CLI cancel) can tell
            # "nothing to abort" apart from a live upload.
            raise UploadNotFoundError(f"unknown upload_id: {upload_id}")

    def get_object(self, object_name: str) -> Optional[bytes]:
        """Return the assembled bytes of a completed object, if present."""
        with self._lock:
            return self._objects.get(object_name)

    # -- internals ---------------------------------------------------------

    def _pop_fault(self, part_number: int) -> Optional[FaultEntry]:
        queue = self._faults.get(part_number)
        if queue:
            entry = queue.pop(0)
            if not queue:
                del self._faults[part_number]
            return entry
        return None

    def _store(self, upload: "_Upload", part_number: int, data: bytes) -> str:
        etag = self._etag_func(data)
        existing = upload.parts.get(part_number)
        if existing is not None:
            policy = self._duplicate_policy
            if policy == "reject":
                raise PartEtagConflictError(
                    f"part {part_number} already uploaded"
                )
            if policy == "reject_same" and existing.etag != etag:
                raise PartEtagConflictError(
                    f"part {part_number} re-uploaded with different data"
                )
            if policy == "ignore":
                return existing.etag
        upload.parts[part_number] = _StoredPart(data, etag)
        upload.upload_count[part_number] = upload.upload_count.get(part_number, 0) + 1
        return etag


class _StoredPart:
    __slots__ = ("data", "etag")

    def __init__(self, data: bytes, etag: str) -> None:
        self.data = data
        self.etag = etag


class _Upload:
    def __init__(self, object_name: str, total_size: int) -> None:
        self.object_name = object_name
        self.total_size = total_size
        self.parts: Dict[int, _StoredPart] = {}
        self.upload_count: Dict[int, int] = {}
