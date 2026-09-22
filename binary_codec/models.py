"""Logical values emitted by both protocol versions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class Diagnostic:
    """A recoverable stream/frame diagnostic.

    ``stream_start`` and ``stream_end`` are zero-based half-open byte offsets
    in the complete logical byte stream.  ``frame_start`` is the offset of the
    frame header when a frame boundary is known.
    """

    code: str
    message: str
    stream_start: int
    stream_end: int
    frame_start: int | None = None
    field_start: int | None = None
    field_end: int | None = None
    severity: Literal["error", "warning"] = "error"

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "stream_start": self.stream_start,
            "stream_end": self.stream_end,
            "frame_start": self.frame_start,
            "field_start": self.field_start,
            "field_end": self.field_end,
        }


@dataclass(frozen=True, slots=True)
class LogicalMessage:
    """Version-independent representation of an application message."""

    message_id: int
    sender: str
    event: str
    timestamp_ms: int
    priority: int = 0
    labels: tuple[str, ...] = field(default_factory=tuple)
    trace_id: str = ""
    retry_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "sender": self.sender,
            "event": self.event,
            "timestamp_ms": self.timestamp_ms,
            "priority": self.priority,
            "labels": list(self.labels),
            "trace_id": self.trace_id,
            "retry_count": self.retry_count,
        }


@dataclass(frozen=True, slots=True)
class DecodedPayload:
    """A parsed frame plus its forward/backward compatibility notes."""

    message: LogicalMessage
    source_version: int
    parser_path: str
    compatibility_notes: tuple[str, ...] = field(default_factory=tuple)
    extensions_ignored: tuple[int, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "message": self.message.to_dict(),
            "source_version": self.source_version,
            "parser_path": self.parser_path,
            "compatibility_notes": list(self.compatibility_notes),
            "extensions_ignored": list(self.extensions_ignored),
        }


@dataclass(frozen=True, slots=True)
class StreamEvent:
    """One item emitted while consuming the stream.

    ``kind`` is ``message`` for a usable message, ``diagnostic`` for rejected
    bytes, or ``info`` for harmless stream events (currently EOF truncation).
    """

    kind: Literal["message", "diagnostic", "info"]
    stream_start: int
    stream_end: int
    decoded: DecodedPayload | None = None
    diagnostic: Diagnostic | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "kind": self.kind,
            "stream_start": self.stream_start,
            "stream_end": self.stream_end,
        }
        if self.decoded is not None:
            data["decoded"] = self.decoded.to_dict()
        if self.diagnostic is not None:
            data["diagnostic"] = self.diagnostic.to_dict()
        return data

