"""The upload coordinator – the "brain" of an upload client.

Given a file path and an object name it:

1. computes a whole-file SHA-256 fingerprint and the fixed part layout,
2. opens a multipart upload on the pluggable backend,
3. uploads parts concurrently with a thread pool (each part is scheduled
   exactly once; retries happen inside that one worker),
4. verifies every returned etag against a locally computed part hash,
5. persists progress after every completed part, so :meth:`resume` skips
   everything already done,
6. assembles the object and returns the final etag.

Nothing here depends on a real object store – any :class:`StorageBackend`
implementation works.
"""

from __future__ import annotations

import hashlib
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from .backend import (
    PartsMissingError,
    StorageBackend,
    UploadNotFoundError,
)
from .progress import PROGRESS_VERSION, ProgressStore

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_PART_SIZE = 5 * 1024 * 1024  # 5 MiB
DEFAULT_CONCURRENCY = 4
DEFAULT_MAX_RETRIES = 3
DEFAULT_BACKOFF_BASE = 1.0  # seconds; waits are base * 2**attempt
DEFAULT_PROGRESS_PATH = "upload_progress.json"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CoordinatorError(Exception):
    """Base class for every coordinator-level error."""


class InvalidConfigError(CoordinatorError, ValueError):
    """An invalid tunable (part size, concurrency, retry count, ...)."""


class UploadExistsError(CoordinatorError):
    """A snapshot for this object name already exists."""


class FingerprintMismatchError(CoordinatorError):
    """The file presented at resume time is not the one originally uploaded."""


class PartChecksumMismatchError(CoordinatorError):
    """The backend-reported etag does not match the local part hash."""


class UploadCancelledError(CoordinatorError):
    """The upload was cancelled by the caller."""


class UploadStateError(CoordinatorError):
    """An operation is invalid for the coordinator's current state."""


class UploadFailedError(CoordinatorError):
    """One or more parts exhausted their retry budget.

    Completed parts are deliberately kept in the progress file so the caller
    can fix the backend and :meth:`UploadCoordinator.resume`.
    """

    def __init__(self, failed_parts: Sequence[int], reasons: Dict[int, str]):
        self.failed_parts = sorted(failed_parts)
        self.reasons = dict(reasons)
        detail = ", ".join(
            f"part {pn}: {self.reasons.get(pn, 'unknown error')}"
            for pn in self.failed_parts
        )
        super().__init__(f"upload failed after retries ({detail})")


# ---------------------------------------------------------------------------
# Layout / hashing helpers
# ---------------------------------------------------------------------------


def compute_part_sizes(total_size: int, part_size: int) -> List[int]:
    """Return the byte length of every part.

    Parts are ``part_size`` bytes except the last one which may be shorter.
    An empty file produces zero parts.  Part numbers are 1-based indices
    into the returned list.

    :raises InvalidConfigError: if ``part_size`` is not a positive int or
        ``total_size`` is negative.
    """
    if isinstance(part_size, bool) or not isinstance(part_size, int):
        raise InvalidConfigError("part_size must be an int")
    if part_size <= 0:
        raise InvalidConfigError(f"part_size must be > 0, got {part_size}")
    if isinstance(total_size, bool) or not isinstance(total_size, int):
        raise InvalidConfigError("total_size must be an int")
    if total_size < 0:
        raise InvalidConfigError(f"total_size must be >= 0, got {total_size}")
    if total_size == 0:
        return []
    full, remainder = divmod(total_size, part_size)
    sizes = [part_size] * full
    if remainder:
        sizes.append(remainder)
    return sizes


def part_etag(data: bytes) -> str:
    """Etag rule shared by client and :class:`InMemoryBackend`: SHA-256 hex."""
    return hashlib.sha256(data).hexdigest()


def hash_file(path: Path, read_size: int = 1024 * 1024) -> Tuple[int, str]:
    """Return ``(size, sha256_hex)`` of ``path`` using a streaming read."""
    digest = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(read_size)
            if not chunk:
                break
            digest.update(chunk)
            total += len(chunk)
    return total, digest.hexdigest()


def status_from_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Project a persisted snapshot into the ``get_status()`` shape."""
    completed = snapshot.get("completed", {})
    part_sizes = snapshot.get("part_sizes", [])
    completed_numbers = sorted(int(n) for n in completed)
    uploaded_bytes = sum(part_sizes[n - 1] for n in completed_numbers)
    final_etag = snapshot.get("final_etag")
    return {
        "upload_id": snapshot["upload_id"],
        "object_name": snapshot["object_name"],
        "completed_parts": len(completed),
        "total_parts": snapshot["total_parts"],
        "failed_parts": sorted(snapshot.get("failed_parts", [])),
        "uploaded_bytes": uploaded_bytes,
        "file_size": snapshot["file_size"],
        "done": final_etag is not None,
        "final_etag": final_etag,
    }


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UploadConfig:
    """Tunables for an upload.

    :param part_size: part size in bytes (default 5 MiB)
    :param concurrency: worker-thread count (>= 1)
    :param max_retries: retries *after the first attempt* for a single part,
        so each part gets ``max_retries + 1`` attempts in total
    :param backoff_base: seconds before retry ``k`` are
        ``backoff_base * 2 ** (k - 1)`` (1x, 2x, 4x, ...)
    :param progress_path: JSON file used for progress snapshots
    :param sleep: injected sleep function – tests pass a recorder so nothing
        really sleeps
    """

    part_size: int = DEFAULT_PART_SIZE
    concurrency: int = DEFAULT_CONCURRENCY
    max_retries: int = DEFAULT_MAX_RETRIES
    backoff_base: float = DEFAULT_BACKOFF_BASE
    progress_path: "str | Path" = DEFAULT_PROGRESS_PATH
    sleep: Callable[[float], None] = time.sleep

    def validate(self) -> None:
        if isinstance(self.part_size, bool) or not isinstance(self.part_size, int):
            raise InvalidConfigError("part_size must be an int")
        if self.part_size <= 0:
            raise InvalidConfigError(
                f"part_size must be > 0, got {self.part_size}"
            )
        if (
            isinstance(self.concurrency, bool)
            or not isinstance(self.concurrency, int)
            or self.concurrency < 1
        ):
            raise InvalidConfigError(
                f"concurrency must be an int >= 1, got {self.concurrency}"
            )
        if (
            isinstance(self.max_retries, bool)
            or not isinstance(self.max_retries, int)
            or self.max_retries < 0
        ):
            raise InvalidConfigError(
                f"max_retries must be an int >= 0, got {self.max_retries}"
            )
        if (
            isinstance(self.backoff_base, bool)
            or not isinstance(self.backoff_base, (int, float))
            or self.backoff_base < 0
        ):
            raise InvalidConfigError(
                f"backoff_base must be a non-negative number, "
                f"got {self.backoff_base!r}"
            )
        if not callable(self.sleep):
            raise InvalidConfigError("sleep must be callable")


# ---------------------------------------------------------------------------
# Coordinator
# ---------------------------------------------------------------------------


class UploadCoordinator:
    """Orchestrates one multipart upload, resumable across processes."""

    def __init__(
        self,
        backend: StorageBackend,
        *,
        upload_id: str,
        object_name: str,
        file_path: Path,
        file_size: int,
        file_sha256: str,
        part_size: int,
        part_sizes: Sequence[int],
        config: UploadConfig,
        completed: Optional[Dict[str, str]] = None,
        failed: Optional[Sequence[int]] = None,
        final_etag: Optional[str] = None,
    ) -> None:
        """Prefer the :meth:`begin` / :meth:`resume` factories over this."""
        config.validate()
        self.backend = backend
        self.config = config
        self.store = ProgressStore(config.progress_path)

        self.upload_id = upload_id
        self.object_name = object_name
        self.file_path = Path(file_path)
        self.file_size = file_size
        self.file_sha256 = file_sha256
        self.part_size = part_size
        self.part_sizes: List[int] = list(part_sizes)
        self.total_parts = len(self.part_sizes)

        self._completed: Dict[int, str] = {
            int(n): etag for n, etag in (completed or {}).items()
        }
        self._failed: List[int] = [
            n for n in (failed or []) if n not in self._completed
        ]
        self._fail_reasons: Dict[int, str] = {}
        self._final_etag: Optional[str] = final_etag

        self._lock = threading.RLock()
        self._cancel_event = threading.Event()
        # One lock per part number – the hard guarantee that a part can
        # never have two in-flight attempts even if this class is extended.
        self._part_locks: Dict[int, threading.Lock] = {
            n: threading.Lock() for n in range(1, self.total_parts + 1)
        }
        # Serializes "the backend says our upload_id is unknown" handling:
        # exactly one loser calls create_multipart, the others wait for the
        # new id to be published instead of racing (and duplicating work).
        self._session_lock = threading.Lock()
        self._session_recreations = 0
        # upload() must not run twice concurrently on one coordinator.
        self._run_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Factories
    # ------------------------------------------------------------------

    @classmethod
    def begin(
        cls,
        backend: StorageBackend,
        file_path: "str | Path",
        object_name: str,
        config: Optional[UploadConfig] = None,
    ) -> "UploadCoordinator":
        """Validate everything, fingerprint the file and open the upload.

        The progress file is written before this returns, so a crash
        immediately afterwards is still resumable.

        :raises UploadExistsError: a snapshot for ``object_name`` already
            exists (finished or not).
        """
        config = config or UploadConfig()
        config.validate()
        path = Path(file_path)
        cls._require_object_name(object_name)
        cls._require_readable_file(path)

        store = ProgressStore(config.progress_path)
        existing = store.load(object_name)
        if existing is not None:
            if existing.get("final_etag"):
                raise UploadExistsError(
                    f"object {object_name!r} already completed "
                    f"(final etag {existing['final_etag']}); choose another name"
                )
            raise UploadExistsError(
                f"an unfinished upload for {object_name!r} already exists "
                f"(upload_id={existing['upload_id']}); use resume() instead"
            )

        file_size, fingerprint = hash_file(path)
        sizes = compute_part_sizes(file_size, config.part_size)
        upload_id = backend.create_multipart(object_name, file_size)

        coordinator = cls(
            backend,
            upload_id=upload_id,
            object_name=object_name,
            file_path=path,
            file_size=file_size,
            file_sha256=fingerprint,
            part_size=config.part_size,
            part_sizes=sizes,
            config=config,
        )
        coordinator._persist_locked()
        return coordinator

    @classmethod
    def resume(
        cls,
        backend: StorageBackend,
        file_path: "str | Path",
        object_name: str,
        config: Optional[UploadConfig] = None,
    ) -> "UploadCoordinator":
        """Rebuild a coordinator from its persisted snapshot.

        The file is re-fingerprinted and must match byte-for-byte; otherwise
        :class:`FingerprintMismatchError` is raised and nothing is uploaded.
        Tunables (concurrency, retries, ...) may differ from the original
        run; the part layout is always taken from the snapshot.
        """
        config = config or UploadConfig()
        config.validate()
        path = Path(file_path)
        cls._require_object_name(object_name)
        cls._require_readable_file(path)

        store = ProgressStore(config.progress_path)
        snapshot = store.load(object_name)
        if snapshot is None:
            raise UploadStateError(
                f"no progress record found for object {object_name!r}"
            )

        current_size, current_hash = hash_file(path)
        if current_size != snapshot["file_size"]:
            raise FingerprintMismatchError(
                f"file size changed for {object_name!r}: recorded "
                f"{snapshot['file_size']} bytes, now {current_size}"
            )
        if current_hash != snapshot["file_sha256"]:
            raise FingerprintMismatchError(
                f"file fingerprint mismatch for {object_name!r}: recorded "
                f"sha256 {snapshot['file_sha256']}, current {current_hash} "
                f"– refusing to resume a different file"
            )

        coordinator = cls(
            backend,
            upload_id=snapshot["upload_id"],
            object_name=snapshot["object_name"],
            file_path=path,
            file_size=snapshot["file_size"],
            file_sha256=snapshot["file_sha256"],
            part_size=snapshot["part_size"],
            part_sizes=snapshot["part_sizes"],
            config=config,
            completed=snapshot["completed"],
            failed=snapshot.get("failed_parts", []),
            final_etag=snapshot.get("final_etag"),
        )
        # The progress file only proves what the client saw last time; the
        # backend may have expired/aborted the multipart upload meanwhile.
        # Completed uploads need no backend session (the result is cached).
        if coordinator._final_etag is None:
            coordinator.ensure_backend_session()
        return coordinator

    # ------------------------------------------------------------------
    # Main entry points
    # ------------------------------------------------------------------

    def upload(self) -> str:
        """Upload all remaining parts, complete multipart, return final etag.

        Already-completed parts are skipped.  On failure the progress file is
        kept; build a new coordinator with :meth:`resume` and call
        :meth:`upload` again.

        :raises UploadStateError: if another thread is already running
            :meth:`upload` on this coordinator.
        """
        if self._final_etag is not None:
            return self._final_etag
        if self._cancel_event.is_set():
            raise UploadCancelledError("upload has been cancelled")
        if not self._run_lock.acquire(blocking=False):
            raise UploadStateError("upload() is already running")

        try:
            remaining = [
                n
                for n in range(1, self.total_parts + 1)
                if n not in self._completed
            ]

            if remaining:
                # Each remaining part is submitted exactly once. Retries for
                # a part happen *inside* its single worker, so the scheduler
                # can never race itself by re-queueing a part whose previous
                # attempt has not returned; the per-part locks below make the
                # guarantee structural even for future callers.
                max_workers = min(self.config.concurrency, len(remaining))
                with ThreadPoolExecutor(
                    max_workers=max_workers,
                    thread_name_prefix=f"upload-{self.upload_id}",
                ) as pool:
                    futures = {
                        pool.submit(self._upload_part_with_retries, n): n
                        for n in remaining
                    }
                    for future in as_completed(futures):
                        future.result()  # workers never raise; surface bugs only
                        part_number = futures[future]
                        with self._lock:
                            if part_number in self._completed:
                                if part_number in self._failed:
                                    self._failed.remove(part_number)
                                    self._fail_reasons.pop(part_number, None)
                                    self._persist_locked()

            if self._cancel_event.is_set():
                raise UploadCancelledError("upload cancelled by caller")
            if self._failed:
                self._raise_failed()

            final_etag = self._complete_with_recovery()

            with self._lock:
                self._final_etag = final_etag
                self._failed = []
                self._fail_reasons.clear()
                self._persist_locked()
            return final_etag
        finally:
            self._run_lock.release()

    def ensure_backend_session(self) -> str:
        """Make sure the backend still knows ``self.upload_id``.

        Multipart sessions can expire server-side or be aborted out of band
        while the progress record survives. If probing shows the session is
        gone, open a new multipart upload, publish the fresh ``upload_id`` and
        persist it. The completed-part etag map is deliberately preserved:
        parts already stored on the dead session are rediscovered and
        re-uploaded at complete time, so only missing bytes move again.

        Serialized by ``_session_lock``: when several worker threads discover
        the dead session at once, exactly one of them creates the replacement
        and the rest observe it instead of racing create_multipart.
        """
        with self._session_lock:
            if self.backend.multipart_exists(self.upload_id):
                return self.upload_id
            return self._create_replacement_session_locked()

    def _rebuild_session_if_current(self, stale_id: str) -> str:
        """Replace the backend session only if ``stale_id`` is still current.

        Called by workers that got an authoritative "unknown upload" error.
        An explicit :class:`UploadNotFoundError` from upload/complete is
        definitive (the multipart upload is gone server-side); unlike the
        best-effort :meth:`ensure_backend_session` probe it is not second-
        guessed. Holding ``_session_lock`` means that when several workers
        404 on the same dead session, only the first creates a replacement;
        the others see the id moved and adopt it.
        """
        with self._session_lock:
            if self.upload_id != stale_id:
                # Another worker already rebuilt it.
                return self.upload_id
            return self._create_replacement_session_locked()

    def _create_replacement_session_locked(self) -> str:
        """Create + publish a new multipart session. Caller holds session lock."""
        if self._cancel_event.is_set():
            raise UploadCancelledError("upload has been cancelled")
        new_id = self.backend.create_multipart(
            self.object_name, self.file_size
        )
        with self._lock:
            self.upload_id = new_id
            self._session_recreations += 1
            self._persist_locked()
        return new_id

    def cancel(self, upload_id: Optional[str] = None) -> None:
        """Abort the multipart upload and delete its progress record.

        Cooperative when an :meth:`upload` is running in another thread:
        workers stop after their current attempt.  Idempotent.

        :raises UploadNotFoundError: if ``upload_id`` is given and does not
            identify this coordinator's upload.
        :raises UploadStateError: if the upload already completed.
        """
        with self._lock:
            if upload_id is not None and upload_id != self.upload_id:
                raise UploadNotFoundError(
                    f"unknown upload_id: {upload_id!r} "
                    f"(this coordinator manages {self.upload_id!r})"
                )
            if self._final_etag is not None:
                raise UploadStateError(
                    f"upload {self.upload_id} already completed; cannot cancel"
                )
            if self._cancel_event.is_set():
                return
            self._cancel_event.set()

        # The session may already have expired server-side; aborting an
        # unknown id is still a successful cancellation of local state.
        try:
            self.backend.abort_multipart(self.upload_id)
        except UploadNotFoundError:
            pass
        self.store.delete(self.object_name)

    # ------------------------------------------------------------------
    # Status / progress
    # ------------------------------------------------------------------

    def get_status(self) -> Dict[str, Any]:
        """Current status: counts, failed parts, bytes, completion flag."""
        with self._lock:
            completed_numbers = sorted(self._completed)
            uploaded_bytes = sum(
                self.part_sizes[n - 1] for n in completed_numbers
            )
            return {
                "upload_id": self.upload_id,
                "object_name": self.object_name,
                "completed_parts": len(completed_numbers),
                "total_parts": self.total_parts,
                "failed_parts": sorted(self._failed),
                "uploaded_bytes": uploaded_bytes,
                "file_size": self.file_size,
                "done": self._final_etag is not None,
                "final_etag": self._final_etag,
            }

    def get_progress(self) -> Dict[str, Any]:
        """Return a deep copy of the persisted progress snapshot."""
        import json

        with self._lock:
            snapshot = self._snapshot_locked()
        return json.loads(json.dumps(snapshot))

    # ------------------------------------------------------------------
    # Part upload / retry machinery
    # ------------------------------------------------------------------

    def _upload_part_with_retries(self, part_number: int) -> None:
        """Worker body: bounded attempts for one part.

        The whole attempt loop for this part runs in exactly one thread
        (this one) and holds the part lock for its duration, so a retry can
        never overlap the previous attempt of the same part. A retry is only
        scheduled from right here, after ``backend.upload_part`` has fully
        returned (or raised) and any backoff sleep has finished.
        """
        lock = self._part_locks[part_number]
        if not lock.acquire(blocking=False):
            # Structural guard: the scheduler submits each part once, so
            # this should be unreachable.
            raise UploadStateError(f"part {part_number} is already in flight")
        try:
            data = self._read_part(part_number)
            expected_etag = part_etag(data)
            last_error: Optional[BaseException] = None

            attempt = 0
            session_rebuilds = 0
            while attempt <= self.config.max_retries:
                if self._cancel_event.is_set():
                    return
                # Snapshot the id: a 404 only obliges us to rebuild if no
                # other worker has already replaced this exact session.
                session_id = self.upload_id
                try:
                    etag = self.backend.upload_part(
                        session_id, part_number, data
                    )
                    if not isinstance(etag, str) or etag != expected_etag:
                        raise PartChecksumMismatchError(
                            f"part {part_number}: backend etag {etag!r} != "
                            f"local sha256 {expected_etag}"
                        )
                    with self._lock:
                        self._completed[part_number] = etag
                        self._fail_reasons.pop(part_number, None)
                        self._persist_locked()
                    return
                except UploadNotFoundError as exc:
                    # Authoritative signal: the multipart session expired
                    # server-side. Rebuild (serialized; one loser rebuilds,
                    # the rest adopt the fresh id) and retry this attempt
                    # WITHOUT spending the part's failure/backoff budget –
                    # the bytes never reached a live session.
                    last_error = exc
                    try:
                        self._rebuild_session_if_current(session_id)
                    except UploadCancelledError:
                        return
                    session_rebuilds += 1
                    if session_rebuilds > self.config.max_retries + 1:
                        self._record_failure(part_number, last_error)
                        return
                    continue
                except Exception as exc:  # backend + checksum failures
                    last_error = exc
                    if self._cancel_event.is_set():
                        return
                    if attempt < self.config.max_retries:
                        delay = self.config.backoff_base * (2 ** attempt)
                        self.config.sleep(delay)
                    attempt += 1
                    continue

            self._record_failure(part_number, last_error)
        finally:
            lock.release()

    def _complete_with_recovery(self) -> str:
        """Call complete_multipart, re-uploading parts the server lacks.

        Two gaps are healed here:

        * a flaky backend acknowledged a part but dropped it
          (:meth:`InMemoryBackend.queue_lost_part`), or
        * the whole multipart session was rebuilt after server-side expiry,
          so every previously "completed" part is missing from the new
          session – their etags are retained in the progress record and the
          bytes are simply re-sent (etag check guarantees identity).

        Both surface as :class:`PartsMissingError` carrying the numbers.
        """
        for round_no in range(self.config.max_retries + 1):
            if self._cancel_event.is_set():
                raise UploadCancelledError("upload cancelled by caller")
            try:
                self.ensure_backend_session()
                session_id = self.upload_id
                parts_spec = self._parts_spec()
                return self.backend.complete_multipart(
                    session_id, parts_spec
                )
            except UploadNotFoundError:
                # Authoritative: the session vanished between probe and
                # complete. Rebuild once; the next round's PartsMissingError
                # drives the re-upload of every part into the fresh session.
                self._rebuild_session_if_current(session_id)
                continue
            except PartsMissingError as exc:
                missing = sorted(set(exc.part_numbers))
                if not missing or round_no == self.config.max_retries:
                    raise UploadFailedError(
                        missing or list(range(1, self.total_parts + 1)),
                        {
                            n: f"server missing part and recovery exhausted: {exc}"
                            for n in (
                                missing or range(1, self.total_parts + 1)
                            )
                        },
                    ) from exc
                for part_number in missing:
                    # Re-send; the worker overwrites the stale map entry.
                    self._upload_part_with_retries(part_number)
                    if part_number not in self._completed:
                        self._raise_failed()
        # Unreachable: the loop either returns or raises.
        raise CoordinatorError("complete retry loop exited unexpectedly")

    # ------------------------------------------------------------------
    # Small helpers
    # ------------------------------------------------------------------

    def _read_part(self, part_number: int) -> bytes:
        start = sum(self.part_sizes[: part_number - 1])
        length = self.part_sizes[part_number - 1]
        with self.file_path.open("rb") as handle:
            handle.seek(start)
            data = handle.read(length)
        if len(data) != length:
            raise CoordinatorError(
                f"file changed while uploading: part {part_number} needed "
                f"{length} bytes at offset {start}, got {len(data)}"
            )
        return data

    def _parts_spec(self) -> List[Tuple[int, str]]:
        with self._lock:
            return [(n, self._completed[n]) for n in sorted(self._completed)]

    def _record_failure(
        self, part_number: int, error: Optional[BaseException]
    ) -> None:
        reason = repr(error) if error is not None else "unknown error"
        with self._lock:
            if part_number not in self._failed:
                self._failed.append(part_number)
            self._fail_reasons[part_number] = reason
            self._persist_locked()

    def _raise_failed(self) -> None:
        with self._lock:
            raise UploadFailedError(sorted(self._failed), dict(self._fail_reasons))

    def _persist_locked(self) -> None:
        # After a cancel the record has been deleted – never resurrect it.
        if self._cancel_event.is_set():
            return
        self.store.save(self.object_name, self._snapshot_locked())

    def _snapshot_locked(self) -> Dict[str, Any]:
        return {
            "version": PROGRESS_VERSION,
            "upload_id": self.upload_id,
            "object_name": self.object_name,
            "file_path": str(self.file_path),
            "file_size": self.file_size,
            "file_sha256": self.file_sha256,
            "part_size": self.part_size,
            "total_parts": self.total_parts,
            "part_sizes": list(self.part_sizes),
            "completed": {
                str(n): self._completed[n] for n in sorted(self._completed)
            },
            "failed_parts": sorted(self._failed),
            "final_etag": self._final_etag,
        }

    @staticmethod
    def _require_object_name(object_name: str) -> None:
        if not isinstance(object_name, str) or not object_name:
            raise InvalidConfigError("object_name must be a non-empty string")

    @staticmethod
    def _require_readable_file(path: Path) -> None:
        if not path.exists():
            raise FileNotFoundError(f"file not found: {path}")
        if not path.is_file():
            raise CoordinatorError(f"not a regular file: {path}")
