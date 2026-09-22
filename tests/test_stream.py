from __future__ import annotations

import random
import unittest

from binary_codec.protocol import (
    TAG_LEGACY_EVENT,
    TAG_MESSAGE_ID,
    TAG_SENDER,
    VERSION_1,
    VERSION_2,
    crc8,
    crc16,
    encode_logical,
    encode_tlv,
    logical_fields,
    uint,
)
from binary_codec.stream import FrameStreamDecoder, decode_bytes


def raw_frame(version: int, payload: bytes, *, corrupt_crc: bool = False) -> bytes:
    header = b"BM2" + bytes([version, 0, len(payload) >> 8, len(payload) & 0xFF])
    header += bytes([crc8(header)])
    checksum = crc16(payload) ^ (0xFFFF if corrupt_crc else 0)
    return header + payload + checksum.to_bytes(2, "big")


class StreamRecoveryTests(unittest.TestCase):
    def test_arbitrary_chunking(self) -> None:
        first = encode_logical(
            {"message_id": 1, "sender": "a", "event": "created", "timestamp_ms": 1},
            VERSION_1,
        )
        second = encode_logical(
            {
                "message_id": 2,
                "sender": "b",
                "event": "updated",
                "timestamp_ms": 2,
                "priority": 1,
            },
            VERSION_2,
        )
        data = first + second
        rng = random.Random(7)
        decoder = FrameStreamDecoder()
        events: list = []
        offset = 0
        while offset < len(data):
            step = rng.randint(1, 5)
            events.extend(decoder.feed(data[offset : offset + step]))
            offset += step
        events.extend(decoder.finish())
        self.assertEqual([event.kind for event in events], ["message", "message"])
        self.assertEqual((events[0].stream_start, events[0].stream_end), (0, len(first)))
        self.assertEqual(events[1].stream_start, len(first))

    def test_partial_input_waits_without_losing_frame(self) -> None:
        frame = encode_logical(
            {"message_id": 3, "sender": "a", "event": "created", "timestamp_ms": 3},
            VERSION_1,
        )
        decoder = FrameStreamDecoder()
        self.assertEqual(decoder.feed(frame[:3]), [])
        self.assertEqual(decoder.feed(frame[3:10]), [])
        events = decoder.feed(frame[10:]) + decoder.finish()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].kind, "message")

    def test_magic_prefix_suffix_is_retained(self) -> None:
        frame = encode_logical(
            {"message_id": 13, "sender": "a", "event": "created", "timestamp_ms": 13},
            VERSION_1,
        )
        decoder = FrameStreamDecoder()
        first_events = decoder.feed(b"junkB")
        self.assertEqual(first_events[0].kind, "diagnostic")
        self.assertEqual(bytes(decoder._buffer), b"B")
        self.assertEqual(decoder.feed(b"M2"), [])
        events = decoder.feed(frame[3:]) + decoder.finish()
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].kind, "message")
        self.assertEqual(events[0].stream_start, 4)

    def test_duplicate_field_rejected_then_next_frame_recovers(self) -> None:
        fields = logical_fields(
            {"message_id": 4, "sender": "bad", "event": "created", "timestamp_ms": 4},
            VERSION_1,
        )
        payload = b"".join(encode_tlv(k, v) for k, v in fields.items())
        payload += encode_tlv(TAG_SENDER, b"again")
        bad = raw_frame(VERSION_1, payload)
        good = encode_logical(
            {"message_id": 5, "sender": "ok", "event": "created", "timestamp_ms": 5},
            VERSION_2,
        )
        events = decode_bytes(bad + good)
        self.assertEqual([event.kind for event in events], ["diagnostic", "message"])
        self.assertEqual(events[0].diagnostic.code, "DUPLICATE_FIELD")
        self.assertEqual(events[1].stream_start, len(bad))

    def test_truncated_field_has_position(self) -> None:
        payload = (
            encode_tlv(TAG_MESSAGE_ID, uint(6, 4))
            + encode_tlv(TAG_SENDER, b"z")
            + bytes([TAG_LEGACY_EVENT, 0, 9])
        )
        bad = raw_frame(VERSION_1, payload)
        diagnostic = decode_bytes(bad)[0].diagnostic
        self.assertEqual(diagnostic.code, "TRUNCATED_FIELD")
        self.assertIsNotNone(diagnostic.field_start)

    def test_invalid_integer_length_rejected_and_recovers(self) -> None:
        payload = (
            encode_tlv(TAG_MESSAGE_ID, b"\x00\x01")
            + encode_tlv(TAG_SENDER, b"z")
            + encode_tlv(TAG_LEGACY_EVENT, uint(1, 1))
            + encode_tlv(4, b"\x00\x00\x00\x01")
        )
        bad = raw_frame(VERSION_1, payload)
        good = encode_logical(
            {"message_id": 11, "sender": "ok", "event": "created", "timestamp_ms": 11},
            VERSION_1,
        )
        events = decode_bytes(bad + good)
        self.assertEqual(events[0].diagnostic.code, "INVALID_INTEGER_LENGTH")
        self.assertEqual(events[1].kind, "message")
        self.assertEqual(events[1].stream_start, len(bad))

    def test_legacy_stream_path_ignores_v2_extensions(self) -> None:
        frame = encode_logical(
            {
                "message_id": 12,
                "sender": "old-app",
                "event": "updated",
                "timestamp_ms": 12,
                "priority": 8,
            },
            VERSION_2,
        )
        events = decode_bytes(frame, parser_path="legacy")
        decoded = events[0].decoded
        assert decoded is not None
        self.assertEqual(decoded.parser_path, "legacy")
        self.assertEqual(decoded.message.priority, 0)
        self.assertIn(5, decoded.extensions_ignored)

    def test_embedded_magic_in_bad_payload_does_not_shift_boundary(self) -> None:
        bad = raw_frame(
            VERSION_1,
            encode_tlv(TAG_SENDER, b"bad-BM2-content"),
        )
        good = encode_logical(
            {"message_id": 14, "sender": "ok", "event": "created", "timestamp_ms": 14},
            VERSION_1,
        )
        events = decode_bytes(bad + good)
        self.assertEqual(events[0].diagnostic.code, "MISSING_REQUIRED_FIELD")
        self.assertEqual(events[1].kind, "message")
        self.assertEqual(events[1].stream_start, len(bad))

    def test_unknown_version_skips_exact_frame_and_recovers(self) -> None:
        unknown = raw_frame(99, encode_tlv(TAG_MESSAGE_ID, uint(7, 4)))
        good = encode_logical(
            {"message_id": 7, "sender": "ok", "event": "created", "timestamp_ms": 7},
            VERSION_1,
        )
        events = decode_bytes(unknown + good)
        self.assertEqual(events[0].diagnostic.code, "UNKNOWN_STRUCTURE_VERSION")
        self.assertEqual(events[1].kind, "message")
        self.assertEqual(events[1].stream_start, len(unknown))

    def test_bad_header_and_payload_checksum(self) -> None:
        frame = bytearray(
            encode_logical(
                {
                    "message_id": 8,
                    "sender": "ok",
                    "event": "created",
                    "timestamp_ms": 8,
                },
                VERSION_1,
            )
        )
        frame[7] ^= 0xFF
        self.assertEqual(
            decode_bytes(bytes(frame))[0].diagnostic.code, "BAD_HEADER_CHECKSUM"
        )

        fields = logical_fields(
            {"message_id": 10, "sender": "ok", "event": "created", "timestamp_ms": 10},
            VERSION_1,
        )
        payload = b"".join(encode_tlv(k, v) for k, v in fields.items())
        bad_payload = raw_frame(VERSION_1, payload, corrupt_crc=True)
        good = encode_logical(
            {"message_id": 9, "sender": "ok", "event": "created", "timestamp_ms": 9},
            VERSION_1,
        )
        events = decode_bytes(bad_payload + good)
        self.assertEqual(events[0].diagnostic.code, "BAD_PAYLOAD_CHECKSUM")
        self.assertEqual(events[1].kind, "message")


if __name__ == "__main__":
    unittest.main()
