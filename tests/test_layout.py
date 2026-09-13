"""Tests for part-layout computation, config validation and progress files."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from chunked_upload import (
    InvalidConfigError,
    ProgressCorruptError,
    ProgressStore,
    UploadConfig,
    compute_part_sizes,
)
from chunked_upload.progress import PROGRESS_VERSION, validate_snapshot

MiB = 1024 * 1024


class PartLayoutTests(unittest.TestCase):
    def test_empty_file_has_no_parts(self) -> None:
        self.assertEqual(compute_part_sizes(0, 5 * MiB), [])

    def test_exact_multiple_has_no_short_tail(self) -> None:
        sizes = compute_part_sizes(4 * MiB, MiB)
        self.assertEqual(sizes, [MiB, MiB, MiB, MiB])

    def test_last_part_is_smaller(self) -> None:
        sizes = compute_part_sizes(2 * MiB + 7, MiB)
        self.assertEqual(sizes, [MiB, MiB, 7])
        self.assertEqual(sum(sizes), 2 * MiB + 7)

    def test_single_small_part(self) -> None:
        self.assertEqual(compute_part_sizes(1, 5 * MiB), [1])

    def test_default_part_size_is_five_mib(self) -> None:
        from chunked_upload import DEFAULT_PART_SIZE

        self.assertEqual(DEFAULT_PART_SIZE, 5 * MiB)
        sizes = compute_part_sizes(DEFAULT_PART_SIZE * 2 + 1, DEFAULT_PART_SIZE)
        self.assertEqual(len(sizes), 3)
        self.assertEqual(sizes[-1], 1)

    def test_invalid_part_sizes(self) -> None:
        for bad in (0, -1, -1024):
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidConfigError):
                    compute_part_sizes(100, bad)
        with self.assertRaises(InvalidConfigError):
            compute_part_sizes(100, True)  # type: ignore[arg-type]
        with self.assertRaises(InvalidConfigError):
            compute_part_sizes(-1, MiB)
        with self.assertRaises(InvalidConfigError):
            compute_part_sizes(100, 1.5)  # type: ignore[arg-type]


class ConfigValidationTests(unittest.TestCase):
    def test_defaults_are_valid(self) -> None:
        UploadConfig().validate()

    def test_bad_concurrency(self) -> None:
        for bad in (0, -1):
            with self.subTest(bad=bad):
                with self.assertRaises(InvalidConfigError):
                    UploadConfig(concurrency=bad).validate()

    def test_bad_retries_and_backoff(self) -> None:
        with self.assertRaises(InvalidConfigError):
            UploadConfig(max_retries=-1).validate()
        with self.assertRaises(InvalidConfigError):
            UploadConfig(backoff_base=-0.1).validate()
        with self.assertRaises(InvalidConfigError):
            UploadConfig(sleep="not callable").validate()  # type: ignore[arg-type]

    def test_injected_sleep_is_accepted(self) -> None:
        calls: list[float] = []
        cfg = UploadConfig(backoff_base=2.0, sleep=calls.append)
        cfg.sleep(0.25)
        self.assertEqual(calls, [0.25])


def _good_snapshot(**overrides: object) -> dict:
    snapshot = {
        "version": PROGRESS_VERSION,
        "upload_id": "upload-00000001",
        "object_name": "obj",
        "file_path": "/tmp/file.bin",
        "file_size": 30,
        "file_sha256": "a" * 64,
        "part_size": 10,
        "total_parts": 3,
        "part_sizes": [10, 10, 10],
        "completed": {"1": "b" * 64},
        "failed_parts": [],
        "final_etag": None,
    }
    snapshot.update(overrides)
    return snapshot


class SnapshotValidationTests(unittest.TestCase):
    def test_good_snapshot_round_trips(self) -> None:
        normalized = validate_snapshot(_good_snapshot())
        self.assertEqual(normalized["completed"], {"1": "b" * 64})
        self.assertEqual(normalized["failed_parts"], [])

    def test_empty_file_snapshot_is_valid(self) -> None:
        snapshot = _good_snapshot(
            file_size=0, total_parts=0, part_sizes=[], completed={}
        )
        normalized = validate_snapshot(snapshot)
        self.assertEqual(normalized["total_parts"], 0)

    def test_missing_field_is_rejected(self) -> None:
        raw = _good_snapshot()
        del raw["upload_id"]
        with self.assertRaises(ProgressCorruptError) as ctx:
            validate_snapshot(raw)
        self.assertIn("missing fields", str(ctx.exception))
        self.assertIn("upload_id", str(ctx.exception))

    def test_bad_fingerprint_is_rejected(self) -> None:
        with self.assertRaises(ProgressCorruptError):
            validate_snapshot(_good_snapshot(file_sha256="abc"))

    def test_part_sizes_must_sum_to_file_size(self) -> None:
        with self.assertRaises(ProgressCorruptError):
            validate_snapshot(_good_snapshot(part_sizes=[10, 10, 9]))

    def test_completed_part_out_of_range_is_rejected(self) -> None:
        with self.assertRaises(ProgressCorruptError):
            validate_snapshot(
                _good_snapshot(completed={"4": "b" * 64})
            )

    def test_unknown_version_is_rejected(self) -> None:
        with self.assertRaises(ProgressCorruptError):
            validate_snapshot(_good_snapshot(version=999))


class ProgressStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.path = Path(self._dir.name) / "progress.json"
        self.store = ProgressStore(self.path)

    def test_missing_file_loads_as_empty(self) -> None:
        self.assertEqual(self.store.load_document(), {})
        self.assertIsNone(self.store.load("anything"))

    def test_save_load_delete_round_trip(self) -> None:
        self.store.save("obj", _good_snapshot())
        loaded = self.store.load("obj")
        self.assertIsNotNone(loaded)
        assert loaded is not None
        self.assertEqual(loaded["upload_id"], "upload-00000001")
        self.assertIn("updated_at", loaded)

        self.assertTrue(self.store.delete("obj"))
        self.assertIsNone(self.store.load("obj"))
        self.assertFalse(self.store.delete("obj"))

    def test_multiple_keys_coexist(self) -> None:
        self.store.save("a", _good_snapshot())
        self.store.save(
            "b",
            _good_snapshot(
                upload_id="upload-00000002",
                object_name="b",
                file_sha256="c" * 64,
            ),
        )
        self.assertEqual(sorted(self.store.keys()), ["a", "b"])

    def test_corrupt_json_is_detected(self) -> None:
        self.path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(ProgressCorruptError):
            self.store.load("obj")

    def test_non_object_document_is_detected(self) -> None:
        self.path.write_text(json.dumps([1, 2, 3]), encoding="utf-8")
        with self.assertRaises(ProgressCorruptError):
            self.store.load_document()

    def test_corrupt_snapshot_under_key_is_detected(self) -> None:
        self.store.save("good", _good_snapshot())
        document = json.loads(self.path.read_text(encoding="utf-8"))
        document["bad"] = {"version": PROGRESS_VERSION}  # almost everything missing
        self.path.write_text(json.dumps(document), encoding="utf-8")
        self.assertIsNotNone(self.store.load("good"))
        with self.assertRaises(ProgressCorruptError):
            self.store.load("bad")


if __name__ == "__main__":
    unittest.main()
