"""Tests for the in-memory backend, its etag rules and fault injection."""

from __future__ import annotations

import hashlib
import unittest

from chunked_upload import (
    InMemoryBackend,
    PartEtagConflictError,
    PartLostError,
    PartsMissingError,
    PartSpec,
    StorageError,
    UploadAbortedError,
    UploadNotFoundError,
)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class InMemoryBackendHappyPathTests(unittest.TestCase):
    def test_create_uploads_get_distinct_ids(self) -> None:
        backend = InMemoryBackend()
        first = backend.create_multipart("a", 10)
        second = backend.create_multipart("b", 10)
        self.assertNotEqual(first, second)
        self.assertTrue(backend.has_upload(first))

    def test_part_etag_is_sha256_of_bytes(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 5)
        data = b"hello"
        self.assertEqual(backend.upload_part(upload_id, 1, data), sha(data))

    def test_complete_concatenates_parts_in_order(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 11)
        chunks = [b"hello ", b"world", b"!"]
        parts: list[PartSpec] = []
        for number, chunk in enumerate(chunks, start=1):
            parts.append(PartSpec(number, backend.upload_part(upload_id, number, chunk)))
        final = backend.complete_multipart(upload_id, parts)
        self.assertEqual(final, sha(b"".join(chunks)))
        self.assertEqual(backend.completed_objects(), {"obj": final})

    def test_abort_removes_upload(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 5)
        backend.abort_multipart(upload_id)
        self.assertFalse(backend.has_upload(upload_id))

    def test_operations_on_unknown_upload_fail(self) -> None:
        backend = InMemoryBackend()
        with self.assertRaises(UploadNotFoundError):
            backend.upload_part("nope", 1, b"x")
        with self.assertRaises(UploadNotFoundError):
            backend.complete_multipart("nope", [])
        with self.assertRaises(UploadNotFoundError):
            backend.abort_multipart("nope")

    def test_cannot_complete_twice_or_abort_completed(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 1)
        etag = backend.upload_part(upload_id, 1, b"x")
        backend.complete_multipart(upload_id, [PartSpec(1, etag)])
        with self.assertRaises(UploadAbortedError):
            backend.upload_part(upload_id, 1, b"x")
        with self.assertRaises(UploadAbortedError):
            backend.abort_multipart(upload_id)


class InMemoryBackendCompletionValidationTests(unittest.TestCase):
    def _upload(self, backend: InMemoryBackend, parts: list[bytes]) -> tuple[str, list[PartSpec]]:
        upload_id = backend.create_multipart("obj", sum(map(len, parts)))
        specs: list[PartSpec] = []
        for number, data in enumerate(parts, start=1):
            specs.append(
                PartSpec(number, backend.upload_part(upload_id, number, data))
            )
        return upload_id, specs

    def test_missing_part_is_reported_with_numbers(self) -> None:
        backend = InMemoryBackend()
        upload_id, specs = self._upload(backend, [b"a", b"b", b"c"])
        # Reference parts 1 and 3 only: both bytes are stored, but the number
        # range 1..3 has a gap at 2.
        with self.assertRaises(PartsMissingError) as ctx:
            backend.complete_multipart(upload_id, [specs[0], specs[2]])
        self.assertEqual(ctx.exception.part_numbers, [2])

    def test_unstored_part_is_reported_with_number(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 6)
        e1 = backend.upload_part(upload_id, 1, b"a")
        backend.upload_part(upload_id, 2, b"b")
        # Claim part 3 with an etag the backend has never stored.
        with self.assertRaises(PartsMissingError) as ctx:
            backend.complete_multipart(
                upload_id, [PartSpec(1, e1), PartSpec(3, sha(b"c"))]
            )
        self.assertEqual(ctx.exception.part_numbers, [3])

    def test_gap_in_part_numbers_is_rejected(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 2)
        e1 = backend.upload_part(upload_id, 1, b"a")
        e3 = backend.upload_part(upload_id, 3, b"c")
        with self.assertRaises(PartsMissingError) as ctx:
            backend.complete_multipart(
                upload_id, [PartSpec(1, e1), PartSpec(3, e3)]
            )
        self.assertEqual(ctx.exception.part_numbers, [2])

    def test_wrong_etag_on_complete_is_rejected(self) -> None:
        backend = InMemoryBackend()
        upload_id, _ = self._upload(backend, [b"a"])
        with self.assertRaises(PartEtagConflictError):
            backend.complete_multipart(
                upload_id, [PartSpec(1, "0" * 64)]
            )

    def test_empty_parts_list_completes_empty_object(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 0)
        final = backend.complete_multipart(upload_id, [])
        self.assertEqual(final, sha(b""))


class FaultInjectionTests(unittest.TestCase):
    def test_exception_fault_is_one_shot(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 3)
        backend.queue_exception(1, RuntimeError("network down"))
        with self.assertRaises(RuntimeError):
            backend.upload_part(upload_id, 1, b"abc")
        # Second attempt succeeds – the fault was consumed.
        self.assertEqual(backend.upload_part(upload_id, 1, b"abc"), sha(b"abc"))

    def test_wrong_etag_fault(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 3)
        backend.queue_wrong_etag(1)
        self.assertEqual(
            backend.upload_part(upload_id, 1, b"abc"), "deadbeef" * 8
        )

    def test_wrong_etag_fault_with_custom_value(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 3)
        backend.queue_wrong_etag(1, "1" * 64)
        self.assertEqual(backend.upload_part(upload_id, 1, b"abc"), "1" * 64)

    def test_lost_part_surfaces_at_complete_time(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 3)
        backend.queue_lost_part(1)
        plausible_etag = backend.upload_part(upload_id, 1, b"abc")
        self.assertEqual(plausible_etag, sha(b"abc"))
        with self.assertRaises(PartsMissingError) as ctx:
            backend.complete_multipart(
                upload_id, [PartSpec(1, plausible_etag)]
            )
        self.assertEqual(ctx.exception.part_numbers, [1])

    def test_lost_part_can_recover_on_reupload(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 3)
        backend.queue_lost_part(1)
        backend.upload_part(upload_id, 1, b"abc")
        # Re-upload after the fault queue drained persists the part.
        etag = backend.upload_part(upload_id, 1, b"abc")
        final = backend.complete_multipart(upload_id, [PartSpec(1, etag)])
        self.assertEqual(final, sha(b"abc"))

    def test_exception_fault_accepts_storage_error_subclasses(self) -> None:
        backend = InMemoryBackend()
        upload_id = backend.create_multipart("obj", 1)
        backend.queue_exception(1, PartLostError("simulated"))
        with self.assertRaises(StorageError):
            backend.upload_part(upload_id, 1, b"x")


class DuplicatePolicyTests(unittest.TestCase):
    def test_overwrite_policy_replaces_part(self) -> None:
        backend = InMemoryBackend(duplicate_policy="overwrite")
        upload_id = backend.create_multipart("obj", 3)
        backend.upload_part(upload_id, 1, b"abc")
        new_etag = backend.upload_part(upload_id, 1, b"abd")
        self.assertEqual(new_etag, sha(b"abd"))

    def test_ignore_policy_keeps_first(self) -> None:
        backend = InMemoryBackend(duplicate_policy="ignore")
        upload_id = backend.create_multipart("obj", 3)
        first = backend.upload_part(upload_id, 1, b"abc")
        second = backend.upload_part(upload_id, 1, b"abd")
        self.assertEqual(first, second)
        self.assertEqual(second, sha(b"abc"))

    def test_reject_policy_raises_on_any_duplicate(self) -> None:
        backend = InMemoryBackend(duplicate_policy="reject")
        upload_id = backend.create_multipart("obj", 3)
        backend.upload_part(upload_id, 1, b"abc")
        with self.assertRaises(PartEtagConflictError):
            backend.upload_part(upload_id, 1, b"abc")

    def test_reject_same_policy_allows_identical_reupload(self) -> None:
        backend = InMemoryBackend(duplicate_policy="reject_same")
        upload_id = backend.create_multipart("obj", 3)
        etag = backend.upload_part(upload_id, 1, b"abc")
        self.assertEqual(backend.upload_part(upload_id, 1, b"abc"), etag)
        with self.assertRaises(PartEtagConflictError):
            backend.upload_part(upload_id, 1, b"abd")

    def test_invalid_policy_rejected(self) -> None:
        with self.assertRaises(ValueError):
            InMemoryBackend(duplicate_policy="bogus")


if __name__ == "__main__":
    unittest.main()
