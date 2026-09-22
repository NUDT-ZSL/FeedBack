from __future__ import annotations

import unittest

from binary_codec.parser import parse_payload
from binary_codec.protocol import (
    TAG_EVENT,
    TAG_LEGACY_EVENT,
    VERSION_1,
    VERSION_2,
    build_frame,
    encode_logical,
    encode_tlv,
    logical_fields,
    uint,
)
from binary_codec.stream import decode_bytes


class PayloadCompatibilityTests(unittest.TestCase):
    def test_v1_and_v2_decode_to_same_logical_message(self) -> None:
        logical = {
            "message_id": 1,
            "sender": "shared",
            "event": "created",
            "timestamp_ms": 42,
        }
        old_decoded = decode_bytes(encode_logical(logical, VERSION_1))[0].decoded
        new_decoded = decode_bytes(encode_logical(logical, VERSION_2))[0].decoded
        assert old_decoded is not None
        assert new_decoded is not None
        self.assertEqual(old_decoded.message, new_decoded.message)

    def test_old_payload_uses_defaults_in_modern_path(self) -> None:
        frame = encode_logical(
            {
                "message_id": 10,
                "sender": "a",
                "event": "created",
                "timestamp_ms": 100,
            },
            VERSION_1,
        )
        decoded = decode_bytes(frame)[0].decoded
        assert decoded is not None
        self.assertEqual(decoded.source_version, 1)
        self.assertEqual((decoded.message.priority, decoded.message.retry_count), (0, 0))
        self.assertEqual(decoded.message.labels, ())
        self.assertEqual(decoded.message.trace_id, "")

    def test_new_native_fields_and_unknown_extension(self) -> None:
        fields = logical_fields(
            {
                "message_id": 20,
                "sender": "b",
                "event": "deleted",
                "timestamp_ms": 5_000_000_001,
                "priority": 5,
                "labels": ["x", "y"],
                "trace_id": "trace",
                "retry_count": 9,
            },
            VERSION_2,
        )
        frame = build_frame(VERSION_2, {**fields, 244: b"future"})
        decoded = decode_bytes(frame)[0].decoded
        assert decoded is not None
        self.assertEqual(decoded.message.timestamp_ms, 5_000_000_001)
        self.assertEqual(decoded.message.labels, ("x", "y"))
        self.assertEqual(decoded.extensions_ignored, (244,))

    def test_legacy_path_keeps_core_and_ignores_v2_fields(self) -> None:
        fields = logical_fields(
            {
                "message_id": 30,
                "sender": "c",
                "event": "updated",
                "timestamp_ms": 300,
            },
            VERSION_2,
        )
        payload = b"".join(encode_tlv(k, v) for k, v in fields.items())
        decoded = parse_payload(payload, VERSION_2, "legacy")
        self.assertEqual(decoded.message.message_id, 30)
        self.assertEqual(decoded.message.event, "updated")
        self.assertIn(TAG_EVENT, decoded.extensions_ignored)

    def test_v2_missing_modern_fields_is_rejected(self) -> None:
        fields = logical_fields(
            {
                "message_id": 40,
                "sender": "d",
                "event": "created",
                "timestamp_ms": 400,
            },
            VERSION_1,
        )
        frame = build_frame(VERSION_2, fields)
        events = decode_bytes(frame)
        diagnostic = events[0].diagnostic
        assert diagnostic is not None
        self.assertEqual(diagnostic.code, "MISSING_REQUIRED_FIELD")

    def test_event_mismatch_rejected(self) -> None:
        fields = logical_fields(
            {
                "message_id": 50,
                "sender": "e",
                "event": "created",
                "timestamp_ms": 500,
            },
            VERSION_2,
        )
        fields[TAG_LEGACY_EVENT] = uint(3, 1)
        frame = build_frame(VERSION_2, fields)
        diagnostic = decode_bytes(frame)[0].diagnostic
        assert diagnostic is not None
        self.assertEqual(diagnostic.code, "STRUCTURE_FIELD_MISMATCH")


if __name__ == "__main__":
    unittest.main()
