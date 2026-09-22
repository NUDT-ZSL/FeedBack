"""Wire format constants, checksums, and deterministic test encoders."""

from __future__ import annotations

from collections.abc import Mapping

MAGIC = b"BM2"
VERSION_1 = 1
VERSION_2 = 2
KNOWN_VERSIONS = frozenset({VERSION_1, VERSION_2})

HEADER_SIZE = 8
MAX_PAYLOAD_SIZE = 65_535

# TLV tags shared by both versions.
TAG_MESSAGE_ID = 1       # uint32, required
TAG_SENDER = 2          # UTF-8, required
TAG_LEGACY_EVENT = 3    # uint8 enum, v1 required, v2 compatibility mirror
TAG_LEGACY_TIMESTAMP = 4  # uint32 ms, v1 required, v2 compatibility mirror
TAG_EVENT = 5           # UTF-8 enum, v2 required
TAG_TIMESTAMP = 6       # uint64 ms, v2 required
TAG_PRIORITY = 7        # uint8, optional in v2
TAG_LABELS = 8          # UTF-8 comma-separated list, optional in v2
TAG_TRACE_ID = 9        # UTF-8, optional in v2
TAG_RETRY_COUNT = 10    # uint16, optional in v2

EVENT_NAMES = ("created", "updated", "deleted")
EVENT_TO_CODE = {"created": 1, "updated": 2, "deleted": 3}
CODE_TO_EVENT = {1: "created", 2: "updated", 3: "deleted"}

DEFAULT_PRIORITY = 0
DEFAULT_LABELS: tuple[str, ...] = ()
DEFAULT_TRACE_ID = ""
DEFAULT_RETRY_COUNT = 0


def crc8(data: bytes | bytearray | memoryview) -> int:
    """CRC-8/CDMA2000 used to protect the fixed header."""

    value = 0
    for byte in data:
        value ^= byte
        for _ in range(8):
            if value & 0x80:
                value = ((value << 1) ^ 0x31) & 0xFF
            else:
                value = (value << 1) & 0xFF
    return value


def crc16(data: bytes | bytearray | memoryview) -> int:
    """CRC-16/CCITT-FALSE used to detect payload corruption."""

    value = 0xFFFF
    for byte in data:
        value ^= byte << 8
        for _ in range(8):
            if value & 0x8000:
                value = ((value << 1) ^ 0x1021) & 0xFFFF
            else:
                value = (value << 1) & 0xFFFF
    return value


def encode_tlv(tag: int, value: bytes) -> bytes:
    if not 1 <= tag <= 255:
        raise ValueError("TLV tag must fit in one byte")
    if len(value) > MAX_PAYLOAD_SIZE:
        raise ValueError("TLV value is too large")
    return bytes([tag, len(value) >> 8, len(value) & 0xFF]) + value


def uint(value: int, size: int) -> bytes:
    if not 0 <= value < (1 << (8 * size)):
        raise ValueError(f"uint{8 * size} value out of range: {value}")
    return value.to_bytes(size, "big")


def text(value: str) -> bytes:
    encoded = value.encode("utf-8")
    if len(encoded) > MAX_PAYLOAD_SIZE:
        raise ValueError("text value is too large")
    return encoded


def logical_fields(message: Mapping[str, object], version: int) -> dict[int, bytes]:
    """Convert logical values to TLV values for a specified wire version."""

    event = str(message["event"])
    if event not in EVENT_TO_CODE:
        raise ValueError(f"unknown logical event: {event}")
    timestamp = int(message["timestamp_ms"])
    if version == VERSION_1 and timestamp > 0xFFFFFFFF:
        raise ValueError("version 1 timestamps must fit in uint32")

    fields: dict[int, bytes] = {
        TAG_MESSAGE_ID: uint(int(message["message_id"]), 4),
        TAG_SENDER: text(str(message["sender"])),
        TAG_LEGACY_EVENT: uint(EVENT_TO_CODE[event], 1),
        TAG_LEGACY_TIMESTAMP: uint(timestamp & 0xFFFFFFFF, 4),
    }
    if version == VERSION_2:
        fields[TAG_EVENT] = text(event)
        fields[TAG_TIMESTAMP] = uint(timestamp, 8)
        priority = int(message.get("priority", DEFAULT_PRIORITY))
        if priority != DEFAULT_PRIORITY:
            fields[TAG_PRIORITY] = uint(priority, 1)
        labels_value = message.get("labels", DEFAULT_LABELS)
        if isinstance(labels_value, (list, tuple)):
            labels = ",".join(str(item) for item in labels_value)
        else:
            labels = str(labels_value)
        if labels:
            fields[TAG_LABELS] = text(labels)
        trace_id = str(message.get("trace_id", DEFAULT_TRACE_ID))
        if trace_id:
            fields[TAG_TRACE_ID] = text(trace_id)
        retry_count = int(message.get("retry_count", DEFAULT_RETRY_COUNT))
        if retry_count != DEFAULT_RETRY_COUNT:
            fields[TAG_RETRY_COUNT] = uint(retry_count, 2)
    return fields


def build_frame(version: int, fields: Mapping[int, bytes], *, flags: int = 0) -> bytes:
    """Build a complete frame from ordered/mapped TLV values."""

    if version not in KNOWN_VERSIONS:
        raise ValueError(f"unknown version: {version}")
    if not 0 <= flags <= 255:
        raise ValueError("flags must fit in one byte")

    payload = b"".join(encode_tlv(tag, value) for tag, value in fields.items())
    if len(payload) > MAX_PAYLOAD_SIZE:
        raise ValueError("payload is too large")

    # Checksum bytes are zero while the header checksum is calculated.
    header_before_crc = MAGIC + bytes(
        [version, flags, len(payload) >> 8, len(payload) & 0xFF]
    )
    header = header_before_crc + bytes([crc8(header_before_crc)])
    checksum = crc16(payload)
    return header + payload + checksum.to_bytes(2, "big")


def encode_logical(message: Mapping[str, object], version: int) -> bytes:
    return build_frame(version, logical_fields(message, version))
