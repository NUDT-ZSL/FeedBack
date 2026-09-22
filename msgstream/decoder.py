"""Incremental, fault-tolerant decoder for the versioned message stream.

Feed arbitrary byte chunks to :class:`StreamDecoder`; it emits one event per
frame: either a :class:`DecodedMessage` (with compatibility notes) or a
:class:`Diagnostic` carrying the absolute byte offset of the problem. Bad
frames are skipped and the stream position stays correct for later frames.
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

from .protocol import (
    DEFAULTS, HEADER_SIZE, KNOWN_VERSIONS, MAGIC, MAX_PAYLOAD, REQUIRED,
    T_BOOL, T_BYTES, T_STR, T_U32, V1, V1_FIELDS, V2, V2_FIELDS,
)


@dataclass
class Message:
    """Unified logical result, identical shape for v1 and v2 structures."""
    msg_id: int
    sender: str
    body: str
    priority: int = 0
    sent_at: int = 0
    structure_version: int = V1


@dataclass
class DecodedMessage:
    offset: int            # absolute stream offset of the frame's first byte
    version: int           # structure version found on the wire
    message: Message
    notes: list = field(default_factory=list)  # compatibility handling notes


@dataclass
class Diagnostic:
    offset: int            # absolute stream offset the diagnostic refers to
    code: str
    detail: str

    def __str__(self) -> str:
        return f"[{self.code}] @byte {self.offset}: {self.detail}"


def _decode_value(ftype: int, raw: bytes, expected: int):
    """Return (ok, value_or_error) for one known field."""
    if ftype != expected:
        return False, f"wire type {ftype} does not match expected type {expected}"
    if expected == T_U32:
        if len(raw) != 4:
            return False, f"u32 field must be 4 bytes, got {len(raw)}"
        return True, struct.unpack(">I", raw)[0]
    if expected == T_STR:
        try:
            return True, raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            return False, f"invalid utf-8: {exc}"
    if expected == T_BOOL:
        if len(raw) != 1:
            return False, f"bool field must be 1 byte, got {len(raw)}"
        return True, raw != b"\x00"
    if expected == T_BYTES:
        return True, raw
    return False, f"unsupported wire type {expected}"


class StreamDecoder:
    def __init__(self) -> None:
        self._buf = bytearray()
        self._base = 0  # absolute stream offset of self._buf[0]

    @property
    def buffered(self) -> int:
        return len(self._buf)

    def feed(self, data: bytes) -> list:
        if data:
            self._buf += data
        return self._drain(final=False)

    def finish(self) -> list:
        """Flush at end of stream; reports any truncated trailing bytes."""
        return self._drain(final=True)

    def _drop(self, n: int) -> None:
        del self._buf[:n]
        self._base += n

    def _drain(self, final: bool) -> list:
        events: list = []
        while True:
            idx = self._buf.find(MAGIC)
            if idx < 0:
                keep = 1 if self._buf.endswith(MAGIC[:1]) else 0
                drop = len(self._buf) - keep
                if drop > 0:
                    events.append(Diagnostic(
                        self._base, "RESYNC",
                        f"discarded {drop} byte(s) of garbage while seeking frame magic"))
                    self._drop(drop)
                if final and self._buf:
                    events.append(Diagnostic(
                        self._base, "TRUNCATED_TAIL",
                        f"{len(self._buf)} trailing byte(s) never formed a frame"))
                    self._drop(len(self._buf))
                break
            if idx > 0:
                events.append(Diagnostic(
                    self._base, "RESYNC",
                    f"discarded {idx} byte(s) of garbage before frame magic"))
                self._drop(idx)
            if len(self._buf) < HEADER_SIZE:
                if final and self._buf:
                    events.append(Diagnostic(
                        self._base, "TRUNCATED_FRAME",
                        f"incomplete frame header ({len(self._buf)} of {HEADER_SIZE} byte(s))"))
                    self._drop(len(self._buf))
                break
            version = self._buf[2]
            (length,) = struct.unpack_from(">I", self._buf, 3)
            if length > MAX_PAYLOAD:
                events.append(Diagnostic(
                    self._base, "BAD_LENGTH",
                    f"declared payload length {length} exceeds limit {MAX_PAYLOAD}; "
                    "frame rejected, resynchronizing"))
                self._drop(1)  # drop one magic byte, then rescan for the next frame
                continue
            total = HEADER_SIZE + length
            if len(self._buf) < total:
                if final:
                    events.append(Diagnostic(
                        self._base, "TRUNCATED_FRAME",
                        f"frame declares {length} payload byte(s) but stream ended "
                        f"with {len(self._buf) - HEADER_SIZE}"))
                    self._drop(len(self._buf))
                break
            offset = self._base
            payload = bytes(self._buf[HEADER_SIZE:total])
            self._drop(total)
            events.extend(self._handle_frame(offset, version, payload))
        return events

    def _handle_frame(self, offset: int, version: int, payload: bytes) -> list:
        if version not in KNOWN_VERSIONS:
            return [Diagnostic(
                offset, "UNKNOWN_VERSION",
                f"structure version 0x{version:02X} is not supported; frame skipped")]
        schema = V1_FIELDS if version == V1 else V2_FIELDS
        values: dict = {}
        notes: list = []
        v2_only_seen: list = []
        pos = 0
        while pos < len(payload):
            if len(payload) - pos < 4:
                return [Diagnostic(
                    offset, "TRUNCATED_FIELD",
                    f"field header at payload offset {pos} is cut off "
                    f"({len(payload) - pos} byte(s) left); message discarded")]
            fid, ftype, flen = struct.unpack_from(">BBH", payload, pos)
            pos += 4
            if len(payload) - pos < flen:
                return [Diagnostic(
                    offset, "TRUNCATED_FIELD",
                    f"field {fid} declares {flen} byte(s) but only "
                    f"{len(payload) - pos} remain; message discarded")]
            raw = payload[pos:pos + flen]
            pos += flen
            if fid in schema:
                if fid in values:
                    return [Diagnostic(
                        offset, "DUPLICATE_FIELD",
                        f"field {fid} appears more than once; message discarded")]
                ok, val = _decode_value(ftype, raw, schema[fid])
                if not ok:
                    return [Diagnostic(
                        offset, "TYPE_MISMATCH",
                        f"field {fid}: {val}; message discarded")]
                values[fid] = val
            elif fid in V2_FIELDS and version == V1:
                v2_only_seen.append(fid)
                notes.append(f"ignored v2-only field {fid} ({flen} byte(s)) under v1 structure")
            else:
                notes.append(f"ignored unknown extension field {fid} ({flen} byte(s))")

        events: list = []
        if version == V1 and v2_only_seen:
            events.append(Diagnostic(
                offset, "STRUCTURE_MISMATCH",
                f"frame declares v1 but carries v2-only field(s) {v2_only_seen}; "
                "decoded with the v1 path, extras ignored"))
        missing = [f for f in REQUIRED if f not in values]
        if missing:
            events.append(Diagnostic(
                offset, "MISSING_FIELD",
                f"required field(s) {missing} absent; message discarded"))
            return events
        if version == V2:
            filled = []
            for fid, dflt in DEFAULTS.items():
                if fid not in values:
                    values[fid] = dflt
                    filled.append(fid)
            if filled:
                notes.append(f"filled default value(s) for optional field(s) {filled}")
        msg = Message(
            msg_id=values[1], sender=values[2], body=values[3],
            priority=values.get(4, 0), sent_at=values.get(5, 0),
            structure_version=version)
        events.append(DecodedMessage(offset, version, msg, notes))
        return events
