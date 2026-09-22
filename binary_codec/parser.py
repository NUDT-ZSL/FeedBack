"""Payload parsing for the two known wire-structure versions."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import (
    DuplicateFieldError,
    IllegalLengthError,
    StructureMismatchError,
    TruncatedFieldError,
)
from .models import DecodedPayload, LogicalMessage
from .protocol import (
    CODE_TO_EVENT,
    DEFAULT_LABELS,
    DEFAULT_PRIORITY,
    DEFAULT_RETRY_COUNT,
    DEFAULT_TRACE_ID,
    EVENT_TO_CODE,
    TAG_EVENT,
    TAG_LABELS,
    TAG_LEGACY_EVENT,
    TAG_LEGACY_TIMESTAMP,
    TAG_MESSAGE_ID,
    TAG_PRIORITY,
    TAG_RETRY_COUNT,
    TAG_SENDER,
    TAG_TIMESTAMP,
    TAG_TRACE_ID,
    VERSION_1,
    VERSION_2,
)


@dataclass(frozen=True, slots=True)
class _RawField:
    tag: int
    value: bytes
    start: int
    end: int
    value_start: int
    value_end: int


def _iter_tlvs(payload: bytes) -> list[_RawField]:
    """Validate TLV framing without applying version-specific semantics."""

    fields: list[_RawField] = []
    seen: set[int] = set()
    pos = 0
    payload_end = len(payload)

    while pos < payload_end:
        if payload_end - pos < 3:
            raise IllegalLengthError(
                "TRUNCATED_TLV_HEADER",
                "TLV header requires tag and two length bytes",
                pos,
                payload_end,
            )
        tag = payload[pos]
        length = int.from_bytes(payload[pos + 1 : pos + 3], "big")
        value_start = pos + 3
        value_end = value_start + length
        if value_end > payload_end:
            raise TruncatedFieldError(
                "TRUNCATED_FIELD",
                f"tag {tag} declares {length} byte(s), but only "
                f"{payload_end - value_start} byte(s) remain",
                pos,
                payload_end,
            )
        if tag in seen:
            raise DuplicateFieldError(
                "DUPLICATE_FIELD",
                f"tag {tag} appears more than once",
                pos,
                min(value_end, payload_end),
            )
        seen.add(tag)
        fields.append(
            _RawField(
                tag,
                payload[value_start:value_end],
                pos,
                value_end,
                value_start,
                value_end,
            )
        )
        pos = value_end
    return fields


def _uint(field: _RawField, size: int) -> int:
    if len(field.value) != size:
        raise IllegalLengthError(
            "INVALID_INTEGER_LENGTH",
            f"tag {field.tag} requires {size} byte(s), got {len(field.value)}",
            field.value_start,
            field.value_end,
        )
    return int.from_bytes(field.value, "big")


def _utf8(field: _RawField) -> str:
    try:
        return field.value.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise StructureMismatchError(
            "INVALID_UTF8",
            f"tag {field.tag} is not valid UTF-8: {exc.reason}",
            field.value_start + max(exc.start, 0),
            field.value_start + min(exc.end, len(field.value)),
        ) from exc


def _required_missing(tag: int, payload_len: int) -> StructureMismatchError:
    return StructureMismatchError(
        "MISSING_REQUIRED_FIELD",
        f"required tag {tag} is missing",
        0,
        payload_len,
        frame_relative=True,
    )


def _core_message(fields: dict[int, _RawField], payload_len: int) -> LogicalMessage:
    for tag in (TAG_MESSAGE_ID, TAG_SENDER, TAG_LEGACY_EVENT, TAG_LEGACY_TIMESTAMP):
        if tag not in fields:
            raise _required_missing(tag, payload_len)

    message_id = _uint(fields[TAG_MESSAGE_ID], 4)
    sender = _utf8(fields[TAG_SENDER])
    if not sender:
        raise StructureMismatchError(
            "INVALID_FIELD",
            "sender must not be empty",
            fields[TAG_SENDER].value_start,
            fields[TAG_SENDER].value_end,
        )

    event_code = _uint(fields[TAG_LEGACY_EVENT], 1)
    if event_code not in CODE_TO_EVENT:
        event_field = fields[TAG_LEGACY_EVENT]
        raise StructureMismatchError(
            "UNKNOWN_ENUM_VALUE",
            f"unknown legacy event code {event_code}",
            event_field.value_start,
            event_field.value_end,
        )
    timestamp = _uint(fields[TAG_LEGACY_TIMESTAMP], 4)
    return LogicalMessage(
        message_id=message_id,
        sender=sender,
        event=CODE_TO_EVENT[event_code],
        timestamp_ms=timestamp,
    )


def _labels(field: _RawField) -> tuple[str, ...]:
    raw = _utf8(field)
    labels = tuple(item for item in raw.split(","))
    if any(not item for item in labels):
        raise StructureMismatchError(
            "INVALID_FIELD",
            "labels must be non-empty comma-separated values",
            field.value_start,
            field.value_end,
        )
    return labels


_CORE_TAGS = {
    TAG_MESSAGE_ID,
    TAG_SENDER,
    TAG_LEGACY_EVENT,
    TAG_LEGACY_TIMESTAMP,
}
_MODERN_TAGS = {
    TAG_EVENT,
    TAG_TIMESTAMP,
    TAG_PRIORITY,
    TAG_LABELS,
    TAG_TRACE_ID,
    TAG_RETRY_COUNT,
}


def parse_payload(
    payload: bytes, version: int, parser_path: str = "modern"
) -> DecodedPayload:
    """Decode one payload using either the modern or legacy parser generation."""

    if parser_path not in {"modern", "legacy"}:
        raise ValueError("parser_path must be 'modern' or 'legacy'")
    if version != VERSION_1 and version != VERSION_2:
        raise StructureMismatchError(
            "UNKNOWN_STRUCTURE_VERSION",
            f"unsupported structure version {version}",
            0,
            len(payload),
            frame_relative=True,
        )

    records = _iter_tlvs(payload)
    fields = {field.tag: field for field in records}
    core = _core_message(fields, len(payload))
    extensions = tuple(field.tag for field in records if field.tag not in _CORE_TAGS)

    if parser_path == "legacy":
        notes = [
            "Legacy parser retained core tags 1-4 and ignored all higher tags.",
            "Version 2-only optional fields use default values.",
        ]
        if extensions:
            notes.append(f"Ignored extension tag(s): {list(extensions)}.")
        return DecodedPayload(
            message=core,
            source_version=version,
            parser_path="legacy",
            compatibility_notes=tuple(notes),
            extensions_ignored=extensions,
        )

    if version == VERSION_1:
        notes = [
            "Modern parser mapped legacy event code and 32-bit timestamp.",
            "Missing version 2-only fields use priority=0, labels=[], "
            "trace_id='', retry_count=0.",
        ]
        if extensions:
            notes.append(f"Unknown forward extension tag(s) ignored: {list(extensions)}.")
        return DecodedPayload(
            message=core,
            source_version=1,
            parser_path="modern",
            compatibility_notes=tuple(notes),
            extensions_ignored=extensions,
        )

    for tag in (TAG_EVENT, TAG_TIMESTAMP):
        if tag not in fields:
            raise _required_missing(tag, len(payload))

    event_field = fields[TAG_EVENT]
    event_name = _utf8(event_field)
    if event_name not in EVENT_TO_CODE:
        raise StructureMismatchError(
            "UNKNOWN_ENUM_VALUE",
            f"unknown event name {event_name!r}",
            event_field.value_start,
            event_field.value_end,
        )

    actual_code = _uint(fields[TAG_LEGACY_EVENT], 1)
    expected_code = EVENT_TO_CODE[event_name]
    if actual_code != expected_code:
        legacy = fields[TAG_LEGACY_EVENT]
        raise StructureMismatchError(
            "STRUCTURE_FIELD_MISMATCH",
            f"event {event_name!r} requires code {expected_code}, got {actual_code}",
            min(legacy.start, event_field.start),
            max(legacy.end, event_field.end),
        )

    timestamp64 = _uint(fields[TAG_TIMESTAMP], 8)
    legacy_timestamp = _uint(fields[TAG_LEGACY_TIMESTAMP], 4)
    if timestamp64 & 0xFFFFFFFF != legacy_timestamp:
        old_field = fields[TAG_LEGACY_TIMESTAMP]
        new_field = fields[TAG_TIMESTAMP]
        raise StructureMismatchError(
            "STRUCTURE_FIELD_MISMATCH",
            "64-bit timestamp and legacy 32-bit timestamp do not share low bits",
            min(old_field.start, new_field.start),
            max(old_field.end, new_field.end),
        )

    priority = (
        _uint(fields[TAG_PRIORITY], 1)
        if TAG_PRIORITY in fields
        else DEFAULT_PRIORITY
    )
    labels = _labels(fields[TAG_LABELS]) if TAG_LABELS in fields else DEFAULT_LABELS
    trace_id = (
        _utf8(fields[TAG_TRACE_ID])
        if TAG_TRACE_ID in fields
        else DEFAULT_TRACE_ID
    )
    retry_count = (
        _uint(fields[TAG_RETRY_COUNT], 2)
        if TAG_RETRY_COUNT in fields
        else DEFAULT_RETRY_COUNT
    )
    unknown = tuple(
        field.tag for field in records if field.tag not in _MODERN_TAGS | _CORE_TAGS
    )
    notes = ["Native version 2 payload parsed by the modern path."]
    if unknown:
        notes.append(f"Unknown future extension tag(s) ignored: {list(unknown)}.")

    return DecodedPayload(
        message=LogicalMessage(
            message_id=core.message_id,
            sender=core.sender,
            event=event_name,
            timestamp_ms=timestamp64,
            priority=priority,
            labels=labels,
            trace_id=trace_id,
            retry_count=retry_count,
        ),
        source_version=2,
        parser_path="modern",
        compatibility_notes=tuple(notes),
        extensions_ignored=unknown,
    )
