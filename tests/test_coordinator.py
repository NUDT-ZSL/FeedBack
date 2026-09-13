"""Tests for the upload coordinator.

Covers part layout end-to-end, concurrent scheduling, resume after failure,
etag verification, retry/backoff, progress snapshot round-trips and all the
required error branches.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from typing import Dict, List

from chunked_upload import (
    FingerprintMismatchError,
    InMemoryBackend,
    PartChecksumMismatchError,
    ProgressCorruptError,
    UploadConfig,
    UploadCoordinator,
    UploadExistsError,
    UploadFailedError,
    UploadStateError,
    part_etag,
)
from chunked_upload.backend import StorageBackend, UploadNotFoundError


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Test backends
# ---------------------------------------------------------------------------


class ScriptedBackend(StorageBackend):
    """Wraps InMemoryBackend with per-part scripting and call recording.

    * ``always_fail`` part numbers raise on every attempt while listed;
    * every ``upload_part`` call is counted per part number;
    * ``max_inflight`` records the peak concurrency; overlaps raise.
    """

    def __init__(self) -> None:
        self._inner = InMemoryBackend()
        self._lock = threading.Lock()
        self.call_counts: Dict[int, int] = {}
        self.always_fail: set[int] = set()
        self.inflight: set[int] = set()
        self.max_inflight = 0
        self.complete_calls = 0
        self.aborted: list[str] = []
        # Optional per-call hook, invoked once per upload_part while the
        # in-flight bookkeeping is active (used to force concurrency).
        self.enter_hook = None

    def create_multipart(self, object_name: str, total_size: int) -> str:
        return self._inner.create_multipart(object_name, total_size)

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        with self._lock:
            self.call_counts[part_number] = self.call_counts.get(part_number, 0) + 1
            if part_number in self.inflight:
                raise AssertionError(
                    f"part {part_number} had two concurrent uploads"
                )
            self.inflight.add(part_number)
            self.max_inflight = max(self.max_inflight, len(self.inflight))
            failing = part_number in self.always_fail
            hook = self.enter_hook
        try:
            if hook is not None:
                hook(part_number)
            if failing:
                raise RuntimeError(f"part {part_number} persistently failing")
            return self._inner.upload_part(upload_id, part_number, data)
        finally:
            with self._lock:
                self.inflight.discard(part_number)

    def complete_multipart(self, upload_id: str, parts):
        self.complete_calls += 1
        return self._inner.complete_multipart(upload_id, parts)

    def abort_multipart(self, upload_id: str) -> None:
        self.aborted.append(upload_id)
        self._inner.abort_multipart(upload_id)

    def multipart_exists(self, upload_id: str) -> bool:
        return self._inner.multipart_exists(upload_id)

    def forget_open_uploads(self) -> None:
        """Simulate server-side expiry: drop every open multipart session."""
        with self._inner._lock:
            self._inner._uploads.clear()

    def completed_objects(self) -> Dict[str, str]:
        return self._inner.completed_objects()

    def get_object(self, object_name: str):
        return self._inner.get_object(object_name)

    def stored_part_numbers(self, upload_id: str) -> List[int]:
        return self._inner.stored_part_numbers(upload_id)

    # Convenience pass-throughs for fault injection.
    def queue_exception(self, part_number: int, exc: Exception) -> None:
        self._inner.queue_exception(part_number, exc)

    def queue_wrong_etag(self, part_number: int, bogus: str | None = None) -> None:
        self._inner.queue_wrong_etag(part_number, bogus)

    def queue_lost_part(self, part_number: int) -> None:
        self._inner.queue_lost_part(part_number)


# ---------------------------------------------------------------------------
# Base test case with temp workspace helpers
# ---------------------------------------------------------------------------


class CoordinatorTestBase(unittest.TestCase):
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

    def begin(self, backend, path: Path, obj: str = "obj", **cfg: object):
        return UploadCoordinator.begin(backend, path, obj, self.config(**cfg))

    def resume(self, backend, path: Path, obj: str = "obj", **cfg: object):
        return UploadCoordinator.resume(backend, path, obj, self.config(**cfg))


# ---------------------------------------------------------------------------
# Happy path / layout
# ---------------------------------------------------------------------------


class UploadHappyPathTests(CoordinatorTestBase):
    def test_small_file_single_part(self) -> None:
        data = b"hello"
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        self.assertEqual(coordinator.total_parts, 2)
        self.assertEqual(coordinator.part_sizes, [4, 1])
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(data))
        status = coordinator.get_status()
        self.assertTrue(status["done"])
        self.assertEqual(status["completed_parts"], 2)
        self.assertEqual(status["total_parts"], 2)
        self.assertEqual(status["uploaded_bytes"], len(data))
        self.assertEqual(status["failed_parts"], [])
        self.assertEqual(status["final_etag"], sha256(data))

    def test_exact_multiple_of_part_size(self) -> None:
        data = b"abcdefgh"  # exactly 2 parts of 4
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        self.assertEqual(coordinator.part_sizes, [4, 4])
        self.assertEqual(coordinator.upload(), sha256(data))

    def test_empty_file_completes_with_zero_parts(self) -> None:
        path = self.write_file("empty.bin", b"")
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        self.assertEqual(coordinator.total_parts, 0)
        self.assertEqual(coordinator.part_sizes, [])
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(b""))
        self.assertTrue(coordinator.get_status()["done"])
        # Resuming a completed empty file is a no-op success.
        again = self.resume(backend, path)
        self.assertEqual(again.upload(), sha256(b""))

    def test_part_contents_match_file_regions(self) -> None:
        data = bytes(range(20))
        path = self.write_file("f.bin", data)
        backend = InMemoryBackend()
        coordinator = self.begin(backend, path, part_size=6)
        self.assertEqual(coordinator.part_sizes, [6, 6, 6, 2])
        coordinator.upload()
        # After completion the parts are assembled into the object, in order.
        self.assertEqual(backend.get_object("obj"), data)
        self.assertEqual(backend.completed_objects()["obj"], sha256(data))


class ConcurrencyTests(CoordinatorTestBase):
    def test_parts_run_concurrently_and_never_overlap(self) -> None:
        data = bytes(64)
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        # Force the first four workers to overlap at the backend boundary;
        # the duplicate-in-flight assertion above covers the negative case.
        barrier = threading.Barrier(4)

        def hook(part_number: int) -> None:
            if part_number <= 4:
                barrier.wait(timeout=5)

        backend.enter_hook = hook
        coordinator = self.begin(backend, path, part_size=4, concurrency=4)
        coordinator.upload()
        self.assertEqual(backend.max_inflight, 4)
        self.assertEqual(sum(backend.call_counts.values()), 16)

    def test_concurrency_one_serializes(self) -> None:
        data = bytes(32)
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path, part_size=4, concurrency=1)
        coordinator.upload()
        self.assertEqual(backend.max_inflight, 1)
        for number in range(1, 9):
            self.assertEqual(backend.call_counts[number], 1)

    def test_each_part_scheduled_once_on_success(self) -> None:
        data = bytes(40)
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        coordinator.upload()
        self.assertEqual(
            {n: backend.call_counts[n] for n in range(1, 11)},
            {n: 1 for n in range(1, 11)},
        )


# ---------------------------------------------------------------------------
# Retries, backoff and etag verification
# ---------------------------------------------------------------------------


class RetryTests(CoordinatorTestBase):
    def test_transient_exception_is_retried_and_succeeds(self) -> None:
        path = self.write_file("f.bin", bytes(12))
        backend = ScriptedBackend()
        backend.queue_exception(2, ConnectionError("boom"))
        coordinator = self.begin(backend, path, max_retries=3)
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(bytes(12)))
        self.assertEqual(backend.call_counts[2], 2)
        # One retry -> one backoff sleep of base * 2**0.
        self.assertEqual(self.sleeps, [0.5])

    def test_exponential_backoff_delays(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = ScriptedBackend()
        backend.always_fail.add(1)
        coordinator = self.begin(
            backend, path, max_retries=2, backoff_base=0.25
        )
        with self.assertRaises(UploadFailedError) as ctx:
            coordinator.upload()
        self.assertEqual(ctx.exception.failed_parts, [1])
        # 3 attempts, 2 sleeps: 0.25, 0.5.
        self.assertEqual(self.sleeps, [0.25, 0.5])
        self.assertEqual(backend.call_counts[1], 3)

    def test_wrong_etag_fails_checks_and_retries(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = ScriptedBackend()
        backend.queue_wrong_etag(1)  # one-shot: first attempt bogus etag
        coordinator = self.begin(backend, path, max_retries=2)
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(b"abcdefgh"))
        self.assertEqual(backend.call_counts[1], 2)
        self.assertEqual(self.sleeps, [0.5])

    def test_persistent_wrong_etag_exhausts_retries(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = InMemoryBackend(etag_func=lambda _b: "0" * 64)
        coordinator = self.begin(backend, path, max_retries=1)
        with self.assertRaises(UploadFailedError) as ctx:
            coordinator.upload()
        self.assertEqual(ctx.exception.failed_parts, [1, 2])
        self.assertIn("backend etag", ctx.exception.reasons[1])

    def test_completed_parts_survive_failed_upload(self) -> None:
        path = self.write_file("f.bin", bytes(20))
        backend = ScriptedBackend()
        backend.always_fail.add(3)
        coordinator = self.begin(backend, path, max_retries=1)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()

        snapshot = json.loads(self.progress_path.read_text(encoding="utf-8"))
        record = snapshot["obj"]
        self.assertEqual(set(record["completed"]), {"1", "2", "4", "5"})
        self.assertEqual(record["failed_parts"], [3])
        self.assertIsNone(record["final_etag"])
        status = coordinator.get_status()
        self.assertEqual(status["completed_parts"], 4)
        self.assertEqual(status["failed_parts"], [3])
        self.assertEqual(status["uploaded_bytes"], 16)

    def test_lost_part_is_re_uploaded_at_complete_time(self) -> None:
        path = self.write_file("f.bin", bytes(12))
        backend = ScriptedBackend()
        # Part 2 acks but vanishes server-side; the retry re-stores it.
        backend.queue_lost_part(2)
        coordinator = self.begin(backend, path, max_retries=2)
        etag = coordinator.upload()
        self.assertEqual(etag, sha256(bytes(12)))
        # Initial attempt + recovery upload.
        self.assertEqual(backend.call_counts[2], 2)

    def test_no_real_sleep_with_injected_function(self) -> None:
        # Sanity: the injected recorder must not be time.sleep itself.
        config = self.config()
        import time

        self.assertIsNot(config.sleep, time.sleep)


# ---------------------------------------------------------------------------
# Resume / fingerprint / progress integrity
# ---------------------------------------------------------------------------


class ResumeTests(CoordinatorTestBase):
    def _fail_phase_one(self, backend: ScriptedBackend, data: bytes) -> str:
        path = self.write_file("big.bin", data)
        backend.always_fail.add(3)
        coordinator = self.begin(backend, path, part_size=4, max_retries=1)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()
        return str(path)

    def test_resume_skips_completed_parts(self) -> None:
        data = bytes(range(40))  # 10 parts of 4 bytes
        backend = ScriptedBackend()
        path_str = self._fail_phase_one(backend, data)

        # "Process restart": new coordinator, same server-side backend.
        backend.always_fail.clear()
        backend.call_counts.clear()
        coordinator = self.resume(backend, Path(path_str))
        etag = coordinator.upload()

        self.assertEqual(etag, sha256(data))
        # Only the previously failed part was uploaded in this process.
        self.assertEqual(list(backend.call_counts), [3])
        self.assertEqual(backend.call_counts[3], 1)

    def test_resume_result_equals_one_shot_upload(self) -> None:
        data = bytes(range(40))
        one_shot = ScriptedBackend()
        one_shot_path = self.write_file("oneshot.bin", data)
        self.begin(one_shot, one_shot_path, "oneshot", part_size=4).upload()
        expected = one_shot.completed_objects()["oneshot"]

        backend = ScriptedBackend()
        path_str = self._fail_phase_one(backend, data)
        backend.always_fail.clear()
        etag = self.resume(backend, Path(path_str)).upload()
        self.assertEqual(etag, expected)

    def test_resume_without_record_is_error(self) -> None:
        path = self.write_file("f.bin", b"abc")
        with self.assertRaises(UploadStateError):
            self.resume(InMemoryBackend(), path)

    def test_resume_rejects_changed_file_content(self) -> None:
        data = b"abcdefgh"
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        backend.always_fail.add(2)
        coordinator = self.begin(backend, path, max_retries=0)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()

        # Same length, different bytes -> fingerprint must change.
        path.write_bytes(b"abXdefgh")
        backend.always_fail.clear()
        with self.assertRaises(FingerprintMismatchError) as ctx:
            self.resume(backend, path)
        self.assertIn("fingerprint mismatch", str(ctx.exception))

    def test_resume_rejects_changed_file_size(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = ScriptedBackend()
        backend.always_fail.add(2)
        coordinator = self.begin(backend, path, max_retries=0)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()
        path.write_bytes(b"abc")  # shrank
        with self.assertRaises(FingerprintMismatchError) as ctx:
            self.resume(backend, path)
        self.assertIn("file size changed", str(ctx.exception))

    def test_resume_after_completion_returns_cached_etag(self) -> None:
        data = b"abcdefgh"
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        self.begin(backend, path).upload()
        backend.call_counts.clear()
        again = self.resume(backend, path)
        self.assertEqual(again.upload(), sha256(data))
        self.assertEqual(backend.call_counts, {})

    def test_resume_progress_snapshot_round_trips(self) -> None:
        data = bytes(range(20))
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        live = coordinator.get_progress()
        resumed = self.resume(backend, path).get_progress()
        for field in (
            "upload_id", "object_name", "file_size", "file_sha256",
            "part_size", "total_parts", "part_sizes", "final_etag",
        ):
            self.assertEqual(live[field], resumed[field], field)
        self.assertEqual(resumed["part_sizes"], [4] * 5)
        self.assertEqual(resumed["file_sha256"], sha256(data))

    def test_corrupt_progress_file_blocks_resume(self) -> None:
        path = self.write_file("f.bin", b"abc")
        self.progress_path.write_text("{broken json", encoding="utf-8")
        with self.assertRaises(ProgressCorruptError):
            self.resume(InMemoryBackend(), path)

    def test_snapshot_missing_fields_blocks_resume(self) -> None:
        path = self.write_file("f.bin", b"abc")
        self.progress_path.write_text(
            json.dumps({"obj": {"version": 1, "upload_id": "x"}}),
            encoding="utf-8",
        )
        with self.assertRaises(ProgressCorruptError) as ctx:
            self.resume(InMemoryBackend(), path)
        self.assertIn("missing fields", str(ctx.exception))

    def test_resume_tolerates_unrelated_records(self) -> None:
        data = b"abcdefgh"
        path_a = self.write_file("a.bin", data)
        backend = ScriptedBackend()
        backend.always_fail.add(2)
        coordinator = self.begin(backend, path_a, "a", max_retries=0)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()

        # A second, intact upload for another object lives in the same file.
        path_b = self.write_file("b.bin", b"xyz")
        self.begin(InMemoryBackend(), path_b, "b").upload()

        backend.always_fail.clear()
        etag = self.resume(backend, path_a, "a").upload()
        self.assertEqual(etag, sha256(data))


class StartAndCancelTests(CoordinatorTestBase):
    def test_duplicate_start_unfinished_is_rejected(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = ScriptedBackend()
        backend.always_fail.add(1)
        coordinator = self.begin(backend, path, max_retries=0)
        with self.assertRaises(UploadFailedError):
            coordinator.upload()
        with self.assertRaises(UploadExistsError) as ctx:
            self.begin(InMemoryBackend(), path)
        self.assertIn("use resume", str(ctx.exception))

    def test_duplicate_start_completed_is_rejected(self) -> None:
        path = self.write_file("f.bin", b"abc")
        self.begin(InMemoryBackend(), path).upload()
        with self.assertRaises(UploadExistsError) as ctx:
            self.begin(InMemoryBackend(), path)
        self.assertIn("already completed", str(ctx.exception))

    def test_cancel_aborts_backend_and_deletes_progress(self) -> None:
        path = self.write_file("f.bin", b"abcdefgh")
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path)
        upload_id = coordinator.upload_id
        coordinator.cancel()
        self.assertEqual(backend.aborted, [upload_id])
        self.assertFalse(self.progress_path.exists())
        # Idempotent: cancelling again does nothing.
        coordinator.cancel()
        self.assertEqual(backend.aborted, [upload_id])

    def test_cancel_with_wrong_upload_id_is_error(self) -> None:
        path = self.write_file("f.bin", b"abc")
        coordinator = self.begin(InMemoryBackend(), path)
        with self.assertRaises(UploadNotFoundError):
            coordinator.cancel("does-not-exist")

    def test_cancel_completed_upload_is_error(self) -> None:
        path = self.write_file("f.bin", b"abc")
        coordinator = self.begin(InMemoryBackend(), path)
        coordinator.upload()
        with self.assertRaises(UploadStateError):
            coordinator.cancel()

    def test_missing_file_is_error(self) -> None:
        with self.assertRaises(FileNotFoundError):
            self.begin(InMemoryBackend(), self.workdir / "nope.bin")

    def test_cancel_during_running_upload_is_cooperative(self) -> None:
        from chunked_upload import UploadCancelledError

        data = bytes(64)
        path = self.write_file("f.bin", data)
        backend = ScriptedBackend()
        coordinator = self.begin(backend, path, part_size=4, concurrency=4)
        reached = threading.Barrier(4)
        cancelled = threading.Event()

        def hook(part_number: int) -> None:
            if part_number <= 4:
                reached.wait(timeout=5)
                # Cancel from the outside once four workers are parked.
                if not cancelled.is_set():
                    cancelled.set()
                    coordinator.cancel()

        backend.enter_hook = hook
        with self.assertRaises(UploadCancelledError):
            coordinator.upload()
        self.assertEqual(backend.aborted, [coordinator.upload_id])
        self.assertFalse(self.progress_path.exists())


class ConfigEdgeTests(CoordinatorTestBase):
    def test_bad_part_size(self) -> None:
        path = self.write_file("f.bin", b"abc")
        for bad in (0, -5):
            with self.assertRaises(ValueError):
                self.begin(InMemoryBackend(), path, part_size=bad)

    def test_bad_concurrency(self) -> None:
        path = self.write_file("f.bin", b"abc")
        with self.assertRaises(ValueError):
            self.begin(InMemoryBackend(), path, concurrency=0)


# ---------------------------------------------------------------------------
# Larger acceptance-style test: tens of MiB, failures, restart, parity
# ---------------------------------------------------------------------------


class LargeFileAcceptanceTests(CoordinatorTestBase):
    def test_tens_of_mib_with_failures_and_restart(self) -> None:
        size = 20 * 1024 * 1024 + 12345  # ~20 MiB
        data = os.urandom(size)
        path = self.write_file("large.bin", data)

        # Reference: one clean upload.
        clean_backend = InMemoryBackend()
        clean_path = self.write_file("large-ref.bin", data)
        expected = UploadCoordinator.begin(
            clean_backend,
            clean_path,
            "ref",
            UploadConfig(
                part_size=3 * 1024 * 1024,
                concurrency=4,
                progress_path=self.workdir / "ref-progress.json",
            ),
        ).upload()
        self.assertEqual(expected, sha256(data))

        # Interrupted upload: parts 2 and 6 never succeed in process one.
        backend = ScriptedBackend()
        backend.always_fail.update({2, 6})
        phase_one = UploadCoordinator.begin(
            backend,
            path,
            "large",
            UploadConfig(
                part_size=3 * 1024 * 1024,
                concurrency=4,
                max_retries=1,
                backoff_base=0.0,
                progress_path=self.progress_path,
                sleep=self.sleeps.append,
            ),
        )
        self.assertEqual(phase_one.total_parts, 7)
        self.assertEqual(phase_one.part_sizes[-1], 12345 + 2 * 1024 * 1024)
        with self.assertRaises(UploadFailedError) as ctx:
            phase_one.upload()
        self.assertEqual(ctx.exception.failed_parts, [2, 6])

        record = json.loads(self.progress_path.read_text(encoding="utf-8"))
        completed_numbers = sorted(int(n) for n in record["large"]["completed"])
        self.assertEqual(completed_numbers, [1, 3, 4, 5, 7])

        # Restart: only parts 2 and 6 move over the wire.
        backend.always_fail.clear()
        backend.call_counts.clear()
        phase_two = UploadCoordinator.resume(
            backend,
            path,
            "large",
            UploadConfig(
                part_size=3 * 1024 * 1024,
                concurrency=2,
                progress_path=self.progress_path,
            ),
        )
        final_etag = phase_two.upload()
        self.assertEqual(final_etag, expected)
        self.assertEqual(
            {n: c for n, c in backend.call_counts.items() if c},
            {2: 1, 6: 1},
        )
        final_record = json.loads(self.progress_path.read_text(encoding="utf-8"))
        self.assertEqual(
            sorted(int(n) for n in final_record["large"]["completed"]),
            [1, 2, 3, 4, 5, 6, 7],
        )
        self.assertEqual(final_record["large"]["final_etag"], expected)


if __name__ == "__main__":
    unittest.main()
