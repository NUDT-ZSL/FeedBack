"""Incremental decoder for a binary stream split at arbitrary byte boundaries."""

from __future__ import annotations

from collections.abc import Iterable

from .errors import DecodeError
from .models import Diagnostic, StreamEvent
from .parser import parse_payload
from .protocol import (
    HEADER_SIZE,
    KNOWN_VERSIONS,
    MAGIC,
    MAX_PAYLOAD_SIZE,
    crc8,
    crc16,
)


class FrameStreamDecoder:
    """Stateful decoder that accepts arbitrary byte-sized ``feed`` chunks."""

    def __init__(self, parser_path: str = "modern") -> None:
        if parser_path not in {"modern", "legacy"}:
            raise ValueError("parser_path must be 'modern' or 'legacy'")
        self._parser_path = parser_path
        self._buffer = bytearray()
        self._stream_position = 0

    @property
    def stream_position(self) -> int:
        return self._stream_position

    def feed(self, chunk: bytes | bytearray | memoryview) -> list[StreamEvent]:
        self._buffer.extend(chunk)
        return self._drain(complete_only=True)

    def finish(self) -> list[StreamEvent]:
        events = self._drain(complete_only=False)
        if self._buffer:
            start = self._stream_position
            end = start + len(self._buffer)
            if bytes(self._buffer[: len(MAGIC)]) == MAGIC:
                code = "INCOMPLETE_TRAILING_FRAME"
                message = "stream ended in the middle of a frame"
                frame_start: int | None = start
                severity = "warning"
            else:
                code = "UNSYNCHRONIZED_BYTES"
                message = "stream ended with bytes outside a valid frame"
                frame_start = None
                severity = "error"
            diag = Diagnostic(
                code,
                message,
                start,
                end,
                frame_start=frame_start,
                severity=severity,
            )
            events.append(StreamEvent("diagnostic", start, end, diagnostic=diag))
            self._stream_position = end
            self._buffer.clear()
        return events

    def decode(self, stream: bytes | bytearray | memoryview) -> list[StreamEvent]:
        return self.feed(stream) + self.finish()

    def _drain(self, *, complete_only: bool) -> list[StreamEvent]:
        events: list[StreamEvent] = []
        pos = 0
        committed_end = 0
        view = bytes(self._buffer)

        def emit(event: StreamEvent, consume: int) -> None:
            nonlocal pos, committed_end
            events.append(event)
            pos = consume
            committed_end = consume

        while pos < len(view):
            magic_at = self._buffer.find(MAGIC, pos)
            if magic_at < 0:
                # Preserve suffixes such as B or BM that may become a magic.
                keep_start = len(view)
                for prefix_len in range(1, min(len(MAGIC), len(view) - pos) + 1):
                    if view[len(view) - prefix_len :] == MAGIC[:prefix_len]:
                        keep_start = len(view) - prefix_len
                junk_end = max(pos, keep_start)
                if junk_end > pos:
                    base = self._stream_position
                    diag = Diagnostic(
                        "UNSYNCHRONIZED_BYTES",
                        "bytes do not begin with frame magic; resynchronized",
                        base + pos,
                        base + junk_end,
                    )
                    emit(
                        StreamEvent(
                            "diagnostic",
                            base + pos,
                            base + junk_end,
                            diagnostic=diag,
                        ),
                        junk_end,
                    )
                break

            if magic_at > pos:
                base = self._stream_position
                diag = Diagnostic(
                    "UNSYNCHRONIZED_BYTES",
                    "discarded bytes until the next frame magic",
                    base + pos,
                    base + magic_at,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + magic_at,
                        diagnostic=diag,
                    ),
                    magic_at,
                )

            if len(view) - pos < HEADER_SIZE:
                break

            header = view[pos : pos + HEADER_SIZE]
            if crc8(header[:7]) != header[7]:
                base = self._stream_position
                diag = Diagnostic(
                    "BAD_HEADER_CHECKSUM",
                    "candidate frame header checksum is invalid",
                    base + pos,
                    base + pos + 1,
                    frame_start=base + pos,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + pos + 1,
                        diagnostic=diag,
                    ),
                    pos + 1,
                )
                continue

            version = header[3]
            flags = header[4]
            payload_length = int.from_bytes(header[5:7], "big")
            frame_end = pos + HEADER_SIZE + payload_length + 2
            base = self._stream_position

            if payload_length > MAX_PAYLOAD_SIZE:
                diag = Diagnostic(
                    "ILLEGAL_PAYLOAD_LENGTH",
                    f"payload length {payload_length} exceeds {MAX_PAYLOAD_SIZE}",
                    base + pos,
                    base + pos + HEADER_SIZE,
                    frame_start=base + pos,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + pos + HEADER_SIZE,
                        diagnostic=diag,
                    ),
                    pos + 1,
                )
                continue

            if len(view) < frame_end:
                if complete_only:
                    break
                diag = Diagnostic(
                    "TRUNCATED_FRAME",
                    f"frame declares {payload_length} payload bytes, but stream ended",
                    base + pos,
                    base + len(view),
                    frame_start=base + pos,
                    severity="warning",
                )
                events.append(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + len(view),
                        diagnostic=diag,
                    )
                )
                pos = committed_end = len(view)
                break

            payload = view[pos + HEADER_SIZE : pos + HEADER_SIZE + payload_length]
            actual_crc = int.from_bytes(view[frame_end - 2 : frame_end], "big")

            if version not in KNOWN_VERSIONS:
                diag = Diagnostic(
                    "UNKNOWN_STRUCTURE_VERSION",
                    f"structure version {version} is not supported; flags={flags}",
                    base + pos + 3,
                    base + pos + 4,
                    frame_start=base + pos,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + frame_end,
                        diagnostic=diag,
                    ),
                    frame_end,
                )
                continue

            if crc16(payload) != actual_crc:
                diag = Diagnostic(
                    "BAD_PAYLOAD_CHECKSUM",
                    "payload CRC-16 does not match the trailer",
                    base + pos,
                    base + frame_end,
                    frame_start=base + pos,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        base + pos,
                        base + frame_end,
                        diagnostic=diag,
                    ),
                    frame_end,
                )
                continue

            try:
                decoded = parse_payload(payload, version, self._parser_path)
            except DecodeError as error:
                frame_absolute = base + pos
                field_start = frame_absolute + HEADER_SIZE + error.start
                field_end = frame_absolute + HEADER_SIZE + error.end
                diag = Diagnostic(
                    error.code,
                    error.message,
                    frame_absolute,
                    frame_absolute + frame_end,
                    frame_start=frame_absolute,
                    field_start=field_start,
                    field_end=field_end,
                )
                emit(
                    StreamEvent(
                        "diagnostic",
                        frame_absolute,
                        frame_absolute + frame_end,
                        diagnostic=diag,
                    ),
                    frame_end,
                )
            else:
                emit(
                    StreamEvent(
                        "message",
                        base + pos,
                        base + frame_end,
                        decoded=decoded,
                    ),
                    frame_end,
                )

        del view
        del self._buffer[:committed_end]
        self._stream_position += committed_end
        return events


def decode_bytes(
    data: bytes | bytearray | memoryview, parser_path: str = "modern"
) -> list[StreamEvent]:
    return FrameStreamDecoder(parser_path).decode(data)


def decode_chunks(
    chunks: Iterable[bytes | bytearray | memoryview],
    parser_path: str = "modern",
) -> list[StreamEvent]:
    decoder = FrameStreamDecoder(parser_path)
    events: list[StreamEvent] = []
    for chunk in chunks:
        events.extend(decoder.feed(chunk))
    events.extend(decoder.finish())
    return events
