"""Deterministic mixed-version sample stream for offline acceptance tests."""

from __future__ import annotations

from .protocol import (
    crc8,
    crc16,
    TAG_LABELS,
    TAG_LEGACY_EVENT,
    TAG_MESSAGE_ID,
    TAG_SENDER,
    TAG_TRACE_ID,
    VERSION_1,
    VERSION_2,
    build_frame,
    encode_logical,
    encode_tlv,
    logical_fields,
    text,
    uint,
)


def _truncated_tlv_frame() -> bytes:
    payload = (
        encode_tlv(TAG_MESSAGE_ID, uint(9001, 4))
        + encode_tlv(TAG_SENDER, b"bad-sender")
        + bytes([TAG_LEGACY_EVENT, 0, 20])
    )
    return _raw_frame(VERSION_1, payload)


def _duplicate_frame() -> bytes:
    fields = logical_fields(
        {
            "message_id": 9002,
            "sender": "dup",
            "event": "created",
            "timestamp_ms": 1400,
        },
        VERSION_1,
    )
    payload = b"".join(encode_tlv(tag, value) for tag, value in fields.items())
    payload += encode_tlv(TAG_SENDER, text("dup-again"))
    return _raw_frame(VERSION_1, payload)


def _raw_frame(version: int, payload: bytes, *, corrupt_crc: bool = False) -> bytes:
    header = b"BM2" + bytes(
        [version, 0, len(payload) >> 8, len(payload) & 0xFF]
    )
    header_with_crc = header + bytes([crc8(header)])
    checksum = crc16(payload) ^ (0xFFFF if corrupt_crc else 0)
    return header_with_crc + payload + checksum.to_bytes(2, "big")


def sample_stream() -> bytes:
    """Return a representative stream with successes, corruption and recovery."""

    old = encode_logical(
        {
            "message_id": 1001,
            "sender": "legacy-a",
            "event": "created",
            "timestamp_ms": 1_700_000_001,
        },
        VERSION_1,
    )
    new_minimal = encode_logical(
        {
            "message_id": 2001,
            "sender": "new-a",
            "event": "updated",
            "timestamp_ms": 1_700_000_002,
        },
        VERSION_2,
    )
    new_extended_fields = logical_fields(
        {
            "message_id": 2002,
            "sender": "new-b",
            "event": "deleted",
            "timestamp_ms": 5_000_000_000_003,
            "priority": 7,
            "labels": ["alpha", "beta"],
            "trace_id": "trace-2002",
            "retry_count": 3,
        },
        VERSION_2,
    )
    new_extended = build_frame(
        VERSION_2,
        {
            **new_extended_fields,
            200: b"future-extension",
            201: b"another-extension",
        },
    )

    old_with_extra_fields = logical_fields(
        {
            "message_id": 1002,
            "sender": "legacy-b",
            "event": "deleted",
            "timestamp_ms": 1_700_000_004,
        },
        VERSION_1,
    )
    old_with_extra = build_frame(
        VERSION_1,
        {
            **old_with_extra_fields,
            TAG_TRACE_ID: b"forward-extension",
            TAG_LABELS: b"also-forward",
        },
    )
    unknown_version = _raw_frame(99, b"\x01\x00\x00")
    truncated = _truncated_tlv_frame()
    duplicate = _duplicate_frame()
    recovered = encode_logical(
        {
            "message_id": 3001,
            "sender": "recovered",
            "event": "created",
            "timestamp_ms": 1_700_000_005,
        },
        VERSION_2,
    )

    return b"".join(
        [
            b"\x00garbage\x99",
            old,
            new_minimal,
            new_extended,
            old_with_extra,
            unknown_version,
            truncated,
            duplicate,
            recovered,
        ]
    )
