"""Regression tests for the fixed issues.

Covers:
1. resume after the server-side multipart session expired: the coordinator
   must create a NEW upload_id, keep the completed-part etag map, re-upload
   only what is missing and produce the same final etag.
2. A part's retries must never run concurrently with its previous attempt.
3. A half-written/truncated progress file raises a clear ProgressCorruptError
   naming the file and the parse position (writes are atomic).
4. Empty files: start -> complete -> resume with zero pending parts.
"""

from __future__ import annotations

import hashlib
import json
import threading
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List

from chunked_upload import (
    InMemoryBackend,
    ProgressCorruptError,
    StorageBackend,
    UploadConfig,
    UploadCoordinator,
    UploadFailedError,
    UploadNotFoundError,
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class RegressionBase(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.workdir = Path(self._dir.name)
        self.progress_path = self.workdir / "progress.json"
        self.sleeps: List[float] = []

    def write_file(self, name: str, data: bytes) -> Path:
        path = self.workdir / name
        path.write_bytes(data)
        return path

    def config(self, **overrides: object) -> UploadConfig:
        values: Dict[str, object] = dict(
            part_size=4,
            concurrency=4,
            max_retries=3,
            backoff_base=0.5,
            progress_path=self.progress_path,
            sleep=self.sleeps.append,
        )
        values.update(overrides)
        return UploadConfig(**values)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 1. Server-side session expiry -> resume rebuilds the multipart upload
# ---------------------------------------------------------------------------


class ExpiringBackend(InMemoryBackend):
    """InMemoryBackend that can forget open uploads and fail chosen parts."""

    def __init__(self) -> None:
        super().__init__()
        self.failing: set[int] = set()

    def expire_open_uploads(self) -> None:
        with self._lock:
            self._uploads.clear()

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        if part_number in self.failing:
            raise ConnectionError(f"part {part_number} failing")
        return super().upload_part(upload_id, part_number, data)


class ResumeSessionRebuildTests(RegressionBase):
    def _phase_one_failure(self, backend: ExpiringBackend, data: bytes) -> str:
        path = self.write_file("big.bin", data)
        backend.failing = {2, 6}  # parts 2 and 6 never succeed in process one
        coordinator = UploadCoordinator.begin(
            backend, path, "big", self.config(max_retries=1)
        )
        with self.assertRaises(UploadFailedError):
            coordinator.upload()
        return coordinator.upload_id

    def test_resume_rebuilds_expired_session_and_matches_one_shot(self) -> None:
        data = bytes(range(40))  # 10 parts of 4 bytes
        backend = ExpiringBackend()
        old_id = self._phase_one_failure(backend, data)

        # Track every part that lands after the session is rebuilt.
        received: Dict[str, List[int]] = {}
        healthy_upload_part = InMemoryBackend.upload_part

        def tracking(upload_id: str, part_number: int, payload: bytes) -> str:
            received.setdefault(upload_id, []).append(part_number)
            return healthy_upload_part(backend, upload_id, part_number, payload)

        # "Process restart": failures cleared; the server expired the
        # multipart upload while the client was down.
        self.assertTrue(backend.multipart_exists(old_id))
        backend.expire_open_uploads()
        self.assertFalse(backend.multipart_exists(old_id))
        backend.failing = set()
        backend.upload_part = tracking  # type: ignore[method-assign]

        coordinator = UploadCoordinator.resume(
            backend, self.workdir / "big.bin", "big", self.config()
        )
        # resume() itself must have noticed the dead session and replaced it,
        # while preserving the completed-part etag map from the record.
        self.assertNotEqual(coordinator.upload_id, old_id)
        self.assertTrue(backend.multipart_exists(coordinator.upload_id))
        preserved = coordinator.get_progress()["completed"]
        self.assertEqual(
            sorted(int(n) for n in preserved),
            [1, 3, 4, 5, 7, 8, 9, 10],
        )
        for number, etag in preserved.items():
            offset = (int(number) - 1) * 4
            self.assertEqual(etag, sha256(data[offset:offset + 4]))

        final_etag = coordinator.upload()
        self.assertEqual(final_etag, sha256(data))
        self.assertTrue(coordinator.get_status()["done"])
        # The new session received every part number, contiguously 1..10
        # (the previously "completed" parts were re-sent into it).
        self.assertEqual(
            sorted(received[coordinator.upload_id]), list(range(1, 11))
        )
        # Final assembled object is byte-identical to the source file.
        self.assertEqual(backend.get_object("big"), data)
        # The progress record now carries the new upload id.
        record = json.loads(self.progress_path.read_text(encoding="utf-8"))
        self.assertEqual(record["big"]["upload_id"], coordinator.upload_id)

    def test_resume_keeps_session_when_it_still_exists(self) -> None:
        data = b"abcdefgh"
        path = self.write_file("f.bin", data)
        backend = ExpiringBackend()
        first = UploadCoordinator.begin(backend, path, "obj", self.config())
        first_id = first.upload_id
        # Session still live server-side: resume must not create a new one.
        coordinator = UploadCoordinator.resume(
            backend, path, "obj", self.config()
        )
        self.assertEqual(coordinator.upload_id, first_id)

    def test_reactive_rebuild_when_probe_is_optimistic_but_call_404s(self) -> None:
        """A backend without a working probe still recovers via 404 errors."""
        data = bytes(range(20))
        path = self.write_file("f.bin", data)
        backend = ExpiringBackend()
        coordinator = UploadCoordinator.begin(
            backend, path, "obj", self.config()
        )
        old_id = coordinator.upload_id
        backend.expire_open_uploads()

        # Lie on the probe (default base-class behaviour) but have the real
        # calls reject the dead id: the worker path must still rebuild.
        original_exists = backend.multipart_exists
        backend.multipart_exists = lambda uid: True  # type: ignore[method-assign]
        try:
            etag = coordinator.upload()
        finally:
            backend.multipart_exists = original_exists  # type: ignore[method-assign]
        self.assertNotEqual(coordinator.upload_id, old_id)
        self.assertEqual(etag, sha256(data))

    def test_concurrent_404s_rebuild_exactly_one_session(self) -> None:
        """Eight workers hitting a dead id together create one replacement."""
        data = bytes(32)  # 8 parts of 4 bytes
        path = self.write_file("f.bin", data)
        backend = _Racy404Backend(dead_parts=8)
        coordinator = UploadCoordinator.begin(
            backend, path, "obj", self.config(concurrency=8)
        )
        initial_session = coordinator.upload_id
        backend.kill_session(initial_session)

        etag = coordinator.upload()

        self.assertEqual(etag, sha256(data))
        self.assertNotEqual(coordinator.upload_id, initial_session)
        # The initial create plus exactly one reactive rebuild – not eight.
        self.assertEqual(len(backend.create_calls), 2)
        self.assertEqual(backend.create_calls[0], initial_session)
        self.assertEqual(backend.create_calls[1], coordinator.upload_id)
        self.assertEqual(backend.max_inflight_404, 8)


# ---------------------------------------------------------------------------
# 2. Same-part retries are strictly serialized
# ---------------------------------------------------------------------------


class _Racy404Backend(StorageBackend):
    """Backend where all workers hit a dead upload id at the same instant.

    The first upload_part call against a killed session parks on a Barrier
    until every worker is inside it, then all raise UploadNotFoundError
    together. It asserts the coordinator rebuilds the session exactly once.
    """

    def __init__(self, dead_parts: int) -> None:
        self._inner = InMemoryBackend()
        self._lock = threading.Lock()
        self.create_calls: List[str] = []
        self._dead_sessions: set[str] = set()
        self._inflight = 0
        self.max_inflight_404 = 0
        self._barrier = threading.Barrier(dead_parts)

    def kill_session(self, upload_id: str) -> None:
        with self._lock:
            self._dead_sessions.add(upload_id)

    def create_multipart(self, object_name: str, total_size: int) -> str:
        uid = self._inner.create_multipart(object_name, total_size)
        with self._lock:
            self.create_calls.append(uid)
        return uid

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        with self._lock:
            dead = upload_id in self._dead_sessions
        if dead:
            with self._lock:
                self._inflight += 1
                self.max_inflight_404 = max(self.max_inflight_404, self._inflight)
            try:
                self._barrier.wait(timeout=5)
            finally:
                with self._lock:
                    self._inflight -= 1
            raise UploadNotFoundError(f"unknown upload_id: {upload_id}")
        return self._inner.upload_part(upload_id, part_number, data)

    def complete_multipart(self, upload_id: str, parts):
        return self._inner.complete_multipart(upload_id, parts)

    def abort_multipart(self, upload_id: str) -> None:
        self._inner.abort_multipart(upload_id)

    def multipart_exists(self, upload_id: str) -> bool:
        return self._inner.multipart_exists(upload_id)


class _SerializedRetryBackend(StorageBackend):
    """Backend that parks each attempt of part 1 on its own gate.

    Every enter/exit of upload_part for the watched part is appended to
    ``log``; the test releases attempts one at a time.  The active-counter
    assertion fires if two attempts of the same part ever overlap.
    """

    def __init__(self, part_to_watch: int, fail_attempts: int) -> None:
        self._inner = InMemoryBackend()
        self.watch = part_to_watch
        self.fail_attempts = fail_attempts
        self.gates: List[threading.Event] = []
        self.log: List[str] = []
        self._active = 0
        self._max_active = 0
        self._lock = threading.Lock()
        self.attempt = 0
        self.upload_id: str = ""

    def next_gate(self) -> threading.Event:
        event = threading.Event()
        self.gates.append(event)
        return event

    def create_multipart(self, object_name: str, total_size: int) -> str:
        self.upload_id = self._inner.create_multipart(object_name, total_size)
        return self.upload_id

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        if part_number != self.watch:
            return self._inner.upload_part(upload_id, part_number, data)

        with self._lock:
            self.attempt += 1
            attempt_no = self.attempt
            self._active += 1
            self._max_active = max(self._max_active, self._active)
            if self._active != 1:
                raise AssertionError(
                    f"part {part_number} had {self._active} concurrent attempts"
                )
            gate = self.next_gate()
            self.log.append(f"enter#{attempt_no}")
        gate.wait(timeout=10)
        try:
            if attempt_no <= self.fail_attempts:
                raise ConnectionError(f"attempt {attempt_no} fails")
            return self._inner.upload_part(upload_id, part_number, data)
        finally:
            with self._lock:
                self.log.append(f"exit#{attempt_no}")
                self._active -= 1

    def complete_multipart(self, upload_id: str, parts):
        return self._inner.complete_multipart(upload_id, parts)

    def abort_multipart(self, upload_id: str) -> None:
        self._inner.abort_multipart(upload_id)

    def multipart_exists(self, upload_id: str) -> bool:
        return self._inner.multipart_exists(upload_id)

    @property
    def max_active(self) -> int:
        with self._lock:
            return self._max_active


class RetrySerializationTests(RegressionBase):
    def test_retry_waits_for_previous_attempt_to_finish(self) -> None:
        data = bytes(12)  # parts 1,2,3 of 4 bytes
        path = self.write_file("f.bin", data)
        backend = _SerializedRetryBackend(part_to_watch=1, fail_attempts=2)
        coordinator = UploadCoordinator.begin(
            backend, path, "obj", self.config(max_retries=3, concurrency=1)
        )

        result: Dict[str, object] = {}

        def run() -> None:
            try:
                result["etag"] = coordinator.upload()
            except Exception as exc:  # pragma: no cover - surfaced via assertion
                result["error"] = exc

        worker = threading.Thread(target=run)
        worker.start()
        try:
            # Walk three attempts (fail, fail, success), releasing each only
            # after confirming the prior attempt fully exited.
            for attempt_no in (1, 2, 3):
                self._wait_for_log(backend, f"enter#{attempt_no}")
                self.assertEqual(backend.max_active, 1)
                self.assertNotIn(f"enter#{attempt_no + 1}", backend.log)
                backend.gates[attempt_no - 1].set()
                if attempt_no < 3:
                    self._wait_for_log(backend, f"exit#{attempt_no}")
                    # The next attempt must only enter AFTER this exit.
                    self.assertLess(
                        backend.log.index(f"exit#{attempt_no}"),
                        len(backend.log),
                    )
            worker.join(timeout=10)
        finally:
            for gate in backend.gates:
                gate.set()
            worker.join(timeout=5)

        self.assertNotIn("error", result)
        self.assertEqual(result["etag"], sha256(data))
        self.assertEqual(backend.attempt, 3)
        self.assertEqual(backend.max_active, 1)
        # Strict enter/exit alternation in the recorded order.
        self.assertEqual(
            backend.log,
            ["enter#1", "exit#1", "enter#2", "exit#2", "enter#3", "exit#3"],
        )
        # Backoff happened (injected, no real sleep) between the two failures.
        self.assertEqual(self.sleeps, [0.5, 1.0])

    def _wait_for_log(self, backend: _SerializedRetryBackend, marker: str) -> None:
        for _ in range(200):
            if marker in backend.log:
                return
            threading.Event().wait(0.01)
        self.fail(f"timed out waiting for log marker {marker!r}: {backend.log}")


# ---------------------------------------------------------------------------
# 3. Corrupt / truncated progress file -> clear error; writes are atomic
# ---------------------------------------------------------------------------


class ProgressIntegrityTests(RegressionBase):
    def _write_snapshot(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        coordinator = UploadCoordinator.begin(
            InMemoryBackend(), path, "obj", self.config()
        )
        coordinator.upload()

    def test_truncated_progress_file_reports_file_and_position(self) -> None:
        self._write_snapshot()
        raw = self.progress_path.read_text(encoding="utf-8")
        self.progress_path.write_text(raw[: len(raw) // 2], encoding="utf-8")

        with self.assertRaises(ProgressCorruptError) as ctx:
            UploadCoordinator.resume(
                InMemoryBackend(),
                self.workdir / "f.bin",
                "obj",
                self.config(),
            )
        message = str(ctx.exception)
        self.assertIn("progress.json", message)
        self.assertIn("not valid JSON", message)
        # The error pinpoints where parsing broke, never a bare JSONDecodeError.
        self.assertIn("line", message)

    def test_progress_write_is_atomic_no_tmp_files_left(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        coordinator = UploadCoordinator.begin(
            InMemoryBackend(), path, "obj", self.config()
        )
        coordinator.upload()
        leftovers = [
            p.name
            for p in self.workdir.iterdir()
            if p.name.startswith("progress.json.") and p.suffix == ".tmp"
        ]
        self.assertEqual(leftovers, [])

    def test_progress_file_missing_is_not_corruption(self) -> None:
        # A non-existent file simply means "nothing to resume" at store level.
        from chunked_upload import ProgressStore

        self.assertEqual(ProgressStore(self.progress_path).load_document(), {})


# ---------------------------------------------------------------------------
# 4. Empty file: start / complete / resume with zero pending parts
# ---------------------------------------------------------------------------


class EmptyFileRegressionTests(RegressionBase):
    def test_empty_file_start_complete_resume(self) -> None:
        path = self.write_file("empty.bin", b"")
        backend = InMemoryBackend()

        coordinator = UploadCoordinator.begin(
            backend, path, "empty", self.config()
        )
        self.assertEqual(coordinator.total_parts, 0)
        self.assertEqual(coordinator.part_sizes, [])
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(b""))
        self.assertTrue(coordinator.get_status()["done"])

        # Snapshot on disk must validate (total_parts == 0 is legal).
        record = json.loads(self.progress_path.read_text(encoding="utf-8"))
        self.assertEqual(record["empty"]["total_parts"], 0)
        self.assertEqual(record["empty"]["part_sizes"], [])
        self.assertEqual(record["empty"]["final_etag"], sha256(b""))

        # A brand-new process resumes: there is nothing left to upload and it
        # must complete (here it simply returns the cached final etag).
        again = UploadCoordinator.resume(
            backend, path, "empty", self.config()
        )
        self.assertEqual(again.total_parts, 0)
        self.assertEqual(again.upload(), sha256(b""))
        self.assertTrue(again.get_status()["done"])

    def test_empty_file_resume_finishes_without_pending_parts(self) -> None:
        # "Process died right after create_multipart": the snapshot exists
        # with zero parts and no final etag; resume must finish by completing
        # the live session with an empty part list, not fail validation.
        path = self.write_file("empty2.bin", b"")
        backend = InMemoryBackend()
        first = UploadCoordinator.begin(
            backend, path, "empty2", self.config()
        )
        self.assertIsNone(first.get_progress()["final_etag"])

        again = UploadCoordinator.resume(
            backend, path, "empty2", self.config()
        )
        self.assertEqual(again.total_parts, 0)
        self.assertEqual(len(backend.completed_objects()), 0)
        self.assertEqual(again.upload(), sha256(b""))
        self.assertTrue(again.get_status()["done"])

    def test_empty_file_resume_rebuilds_expired_session(self) -> None:
        # Zero parts plus a session that expired out of band: resume must
        # rebuild it and still complete with no bytes to upload.
        path = self.write_file("empty3.bin", b"")
        backend = ExpiringBackend()
        first = UploadCoordinator.begin(
            backend, path, "empty3", self.config()
        )
        dead_id = first.upload_id
        backend.expire_open_uploads()

        again = UploadCoordinator.resume(
            backend, path, "empty3", self.config()
        )
        self.assertNotEqual(again.upload_id, dead_id)
        self.assertEqual(again.upload(), sha256(b""))
        self.assertTrue(again.get_status()["done"])


if __name__ == "__main__":
    unittest.main()
