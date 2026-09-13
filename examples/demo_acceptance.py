#!/usr/bin/env python3
"""Offline acceptance-style demo: failures, restart, wrong etag, bad resume.

Run with no arguments::

    python examples/demo_acceptance.py

Uses only the standard library and a temporary directory – no network.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from chunked_upload import (  # noqa: E402
    FingerprintMismatchError,
    InMemoryBackend,
    UploadConfig,
    UploadCoordinator,
    UploadFailedError,
)

PART_SIZE = 3 * 1024 * 1024


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    workdir = Path(tempfile.mkdtemp(prefix="chunked-demo-"))
    progress = workdir / "progress.json"
    print(f"workdir: {workdir}")

    # ~20 MiB random file.
    size = 20 * 1024 * 1024 + 12345
    data = os.urandom(size)
    source = workdir / "big.bin"
    source.write_bytes(data)
    expected_etag = hashlib.sha256(data).hexdigest()

    def config(**overrides):
        values = dict(
            part_size=PART_SIZE,
            concurrency=4,
            max_retries=1,
            backoff_base=0.0,
            progress_path=progress,
        )
        values.update(overrides)
        return UploadConfig(**values)

    # 1) Reference: one clean upload to a fresh backend/object.
    section("1. one-shot upload (reference)")
    clean = InMemoryBackend()
    ref_etag = UploadCoordinator.begin(
        clean, source, "ref", config()
    ).upload()
    assert ref_etag == expected_etag
    print(f"final etag: {ref_etag}")

    # 2) Flaky backend: parts 2 and 6 always fail in "process one".
    section("2. interrupted upload (parts 2 and 6 fail every attempt)")
    backend = _FlakyBackend(failing={2, 6})
    phase_one = UploadCoordinator.begin(backend, source, "big", config())
    print(f"total parts: {phase_one.total_parts}")
    try:
        phase_one.upload()
    except UploadFailedError as exc:
        print(f"upload stopped: {exc}")
    status = phase_one.get_status()
    print(
        f"completed {status['completed_parts']}/{status['total_parts']} parts, "
        f"failed={status['failed_parts']}, "
        f"uploaded={status['uploaded_bytes']} bytes"
    )

    # 3) "Process restart": new backend session-like object with parts intact,
    #    failures cleared; resume uploads only the two missing parts.
    section("3. resume after restart")
    sent_before = dict(backend.sent_counts)
    backend.failing.clear()
    phase_two = UploadCoordinator.resume(backend, source, "big", config())
    final_etag = phase_two.upload()
    newly_sent = {
        n: backend.sent_counts[n] - sent_before.get(n, 0)
        for n in backend.sent_counts
        if backend.sent_counts[n] - sent_before.get(n, 0)
    }
    print(f"parts uploaded during resume: {sorted(newly_sent)}")
    print(f"final etag: {final_etag}")
    assert final_etag == expected_etag == ref_etag
    print("etag matches the one-shot upload: OK")
    assert list(newly_sent) == [2, 6]

    # 4) Wrong etag from the backend: coordinator retries, then fails loudly.
    section("4. backend returns wrong etag")
    bad_backend = InMemoryBackend(etag_func=lambda _b: "0" * 64)
    bad_progress = workdir / "bad-progress.json"
    small = workdir / "small.bin"
    small.write_bytes(b"x" * 10)
    coordinator = UploadCoordinator.begin(
        bad_backend,
        small,
        "bad",
        UploadConfig(
            part_size=4, max_retries=1, backoff_base=0.0,
            progress_path=bad_progress,
        ),
    )
    try:
        coordinator.upload()
    except UploadFailedError as exc:
        print(f"upload failed as expected: {exc.failed_parts}")

    # 5) File content changed before resume -> fingerprint guard.
    section("5. resume refuses a changed file")
    guarded = workdir / "g.bin"
    guarded.write_bytes(b"abcdefgh")
    guarded_progress = workdir / "g-progress.json"
    flaky = _FlakyBackend(failing={2})
    first = UploadCoordinator.begin(
        flaky,
        guarded,
        "g",
        UploadConfig(
            part_size=4, max_retries=0, backoff_base=0.0,
            progress_path=guarded_progress,
        ),
    )
    try:
        first.upload()
    except UploadFailedError:
        pass
    guarded.write_bytes(b"abXdefgh")  # same length, different content
    try:
        UploadCoordinator.resume(
            flaky,
            guarded,
            "g",
            UploadConfig(progress_path=guarded_progress),
        )
    except FingerprintMismatchError as exc:
        print(f"resume refused: {exc}")

    # 6) Corrupt progress file -> clear error.
    section("6. corrupt progress file")
    progress.write_text("{oops", encoding="utf-8")
    from chunked_upload import ProgressCorruptError

    try:
        UploadCoordinator.resume(backend, source, "big", config())
    except ProgressCorruptError as exc:
        print(f"resume refused: {exc}")

    print("\nAll demo checks passed.")
    return 0


class _FlakyBackend(InMemoryBackend):
    """InMemoryBackend that raises for configured part numbers."""

    def __init__(self, failing: set[int]) -> None:
        super().__init__()
        self.failing = set(failing)
        self.sent_counts: dict[int, int] = {}

    def upload_part(self, upload_id: str, part_number: int, data: bytes) -> str:
        self.sent_counts[part_number] = self.sent_counts.get(part_number, 0) + 1
        if part_number in self.failing:
            raise ConnectionError(f"simulated network failure on part {part_number}")
        return super().upload_part(upload_id, part_number, data)


if __name__ == "__main__":
    raise SystemExit(main())
