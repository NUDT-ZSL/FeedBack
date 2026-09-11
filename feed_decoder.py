"""Incremental decoder for a small binary frame protocol.

Wire format (all multi-byte fixed fields little-endian)::

    +---------+---------+------+----------+---------+--------+
    | MAGIC   | VERSION | TYPE | LENGTH   | PAYLOAD | CRC32  |
    | 2 bytes | 1 byte  | 1 B  | varint   | LENGTH  | 4 B LE |
    +---------+---------+------+----------+---------+--------+

* ``MAGIC``   = ``b"\\xfe\\xed"``
* ``VERSION`` = protocol version, currently ``1``
* ``LENGTH``  = unsigned varint (LEB128: low 7 bits per byte are data,
  the high bit signals a continuation byte, little-endian groups).
  A varint that does not terminate within 5 bytes is invalid.
* ``CRC32``   = CRC-32 (zlib) over ``VERSION | TYPE | LENGTH | PAYLOAD``.

The central guarantee of this module: decoding a byte stream in one
:meth:`FeedDecoder.feed` call produces exactly the same frames, the same
per-frame check results and the same final decoder state as feeding the
same bytes in arbitrarily sized chunks (provided the pending buffer never
exceeds ``max_buffer``; see README for the overflow policy).
"""

from __future__ import annotations

import json
import re
import zlib
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

__all__ = [
    "MAGIC",
    "PROTOCOL_VERSION",
    "MAX_VARINT_BYTES",
    "CRC_SIZE",
    "DEFAULT_MAX_PAYLOAD",
    "DEFAULT_MAX_BUFFER",
    "State",
    "Frame",
    "FinishResult",
    "SnapshotError",
    "FeedDecoder",
    "encode_varint",
    "encode_frame",
    "encode_stream",
]

#: Frame magic number (2 bytes).
MAGIC: bytes = b"\xfe\xed"
#: Only protocol version this decoder accepts.
PROTOCOL_VERSION: int = 1
#: A length varint longer than this many bytes is invalid.
MAX_VARINT_BYTES: int = 5
#: Size of the trailing CRC-32 field in bytes.
CRC_SIZE: int = 4
#: Default upper bound for a single frame's payload (1 MiB).
DEFAULT_MAX_PAYLOAD: int = 1 << 20
#: Default upper bound for the pending (not yet decidable) buffer (4 MiB).
DEFAULT_MAX_BUFFER: int = 4 << 20

SNAPSHOT_FORMAT = "feed-decoder-snapshot"
SNAPSHOT_VERSION = 1

BytesLike = Union[bytes, bytearray, memoryview]

_HEX_RE = re.compile(r"[0-9a-fA-F]*")


class State(Enum):
    """Explicit states of the decoder state machine."""

    WAIT_MAGIC = "WAIT_MAGIC"        # scanning for the magic number
    READ_VERSION = "READ_VERSION"    # expecting the version byte
    READ_TYPE = "READ_TYPE"          # expecting the frame type byte
    READ_LENGTH = "READ_LENGTH"      # accumulating the length varint
    READ_PAYLOAD = "READ_PAYLOAD"    # accumulating payload bytes
    READ_CRC = "READ_CRC"            # accumulating the 4 CRC bytes
    COMPLETE = "COMPLETE"            # transient: frame assembled, validating


class SnapshotError(Exception):
    """Raised when a snapshot file is corrupt, incomplete or inconsistent."""


@dataclass
class Frame:
    """One decoded frame, or an error record describing a bad frame.

    ``ok`` is ``True`` for a fully validated frame.  When ``ok`` is
    ``False``, ``error`` holds a machine-readable reason
    (``crc_mismatch``, ``unsupported_version``, ``invalid_length_varint``,
    ``payload_too_large`` or ``buffer_overflow``) and ``detail`` a
    human-readable explanation.
    """

    ok: bool
    frame_type: Optional[int] = None
    payload: Optional[bytes] = None
    error: Optional[str] = None
    detail: str = ""
    crc_expected: Optional[int] = None
    crc_actual: Optional[int] = None
    raw_length: int = 0  # wire bytes occupied by the (would-be) frame

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-serialisable view of this frame."""
        d: Dict[str, Any] = {"ok": self.ok}
        if self.frame_type is not None:
            d["frame_type"] = self.frame_type
        if self.payload is not None:
            d["payload"] = self.payload.hex()
            d["payload_length"] = len(self.payload)
        if self.error is not None:
            d["error"] = self.error
        if self.detail:
            d["detail"] = self.detail
        if self.crc_expected is not None:
            d["crc_expected"] = self.crc_expected
        if self.crc_actual is not None:
            d["crc_actual"] = self.crc_actual
        if self.raw_length:
            d["raw_length"] = self.raw_length
        return d


@dataclass
class FinishResult:
    """Result of :meth:`FeedDecoder.finish`."""

    frames: List[Frame]
    incomplete: bool   # True when the stream ends in the middle of a frame
    pending_bytes: int  # undecidable bytes still buffered (garbage / half frame)
    state: str          # state machine state at end of input

    def to_dict(self) -> Dict[str, Any]:
        """Return a JSON-serialisable view of this result."""
        return {
            "frames": [f.to_dict() for f in self.frames],
            "incomplete": self.incomplete,
            "pending_bytes": self.pending_bytes,
            "state": self.state,
        }


def encode_varint(value: int) -> bytes:
    """Encode a non-negative integer as an unsigned LEB128 varint."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"varint value must be a non-negative int, got {value!r}")
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def encode_frame(frame_type: int, payload: BytesLike,
                 version: int = PROTOCOL_VERSION) -> bytes:
    """Encode one frame; the exact dual of :meth:`FeedDecoder.feed`.

    The returned bytes, fed to a :class:`FeedDecoder`, decode back to a
    frame with the same ``frame_type`` and ``payload``.
    """
    if isinstance(frame_type, bool) or not isinstance(frame_type, int) \
            or not 0 <= frame_type <= 0xFF:
        raise ValueError(f"frame_type must be an int in 0..255, got {frame_type!r}")
    if not isinstance(payload, (bytes, bytearray, memoryview)):
        raise TypeError(f"payload must be bytes-like, got {type(payload).__name__}")
    if isinstance(version, bool) or not isinstance(version, int) \
            or not 0 <= version <= 0xFF:
        raise ValueError(f"version must be an int in 0..255, got {version!r}")
    payload = bytes(payload)
    body = bytes((version, frame_type)) + encode_varint(len(payload)) + payload
    crc = zlib.crc32(body) & 0xFFFFFFFF
    return MAGIC + body + crc.to_bytes(CRC_SIZE, "little")


def encode_stream(frames: Iterable[Union[Tuple[int, BytesLike],
                                         Dict[str, Any]]]) -> bytes:
    """Encode a sequence of frames into one concatenated byte stream.

    Each item is either a ``(frame_type, payload)`` pair or a mapping with
    ``frame_type`` and ``payload`` keys.
    """
    parts = []
    for item in frames:
        if isinstance(item, dict):
            frame_type, payload = item["frame_type"], item["payload"]
        else:
            frame_type, payload = item
        parts.append(encode_frame(frame_type, payload))
    return b"".join(parts)


class FeedDecoder:
    """Incremental, state-machine based frame decoder.

    :param max_payload: maximum allowed payload length of a single frame
        in bytes (default 1 MiB).  A frame declaring a larger length is
        rejected immediately, before any payload buffer is allocated.
    :param max_buffer: maximum number of undecidable (pending) bytes the
        decoder will hold.  When the pending buffer grows beyond this
        limit the decoder emits a ``buffer_overflow`` error record,
        discards the pending bytes and resynchronises at ``WAIT_MAGIC``
        (see README, "待定缓冲溢出策略").

    Usage::

        dec = FeedDecoder()
        frames = dec.feed(chunk)          # may be called any number of times
        result = dec.finish()             # flush end-of-input status
    """

    def __init__(self, max_payload: int = DEFAULT_MAX_PAYLOAD,
                 max_buffer: int = DEFAULT_MAX_BUFFER) -> None:
        for name, value in (("max_payload", max_payload),
                            ("max_buffer", max_buffer)):
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ValueError(f"{name} must be a non-negative int, got {value!r}")
        self._max_payload = max_payload
        self._max_buffer = max_buffer

        self._buf = bytearray()          # bytes not yet consumed by the machine
        self._state = State.WAIT_MAGIC
        self._reset_partials()

        # statistics counters
        self._frames_parsed = 0
        self._crc_errors = 0
        self._invalid_frames = 0
        self._magic_misalignments = 0
        self._buffer_overflows = 0
        self._max_payload_seen = 0
        self._total_frame_bytes = 0

        self._finished = False

    # ------------------------------------------------------------------ #
    # properties
    # ------------------------------------------------------------------ #

    @property
    def state(self) -> State:
        """Current state-machine state."""
        return self._state

    @property
    def max_payload(self) -> int:
        """Configured maximum payload length."""
        return self._max_payload

    @property
    def max_buffer(self) -> int:
        """Configured maximum pending-buffer size."""
        return self._max_buffer

    # ------------------------------------------------------------------ #
    # public API
    # ------------------------------------------------------------------ #

    def feed(self, chunk: BytesLike) -> List[Frame]:
        """Feed the next chunk of input; return frames decided by it.

        Frames and error records are returned in stream order.  The chunk
        may have any size (including 0); chunk boundaries never influence
        the result.
        """
        if self._finished:
            raise RuntimeError("feed() called after finish()")
        if not isinstance(chunk, (bytes, bytearray, memoryview)):
            raise TypeError(f"chunk must be bytes-like, got {type(chunk).__name__}")
        self._buf += bytes(chunk)
        out: List[Frame] = []
        self._parse(out)
        self._enforce_buffer_limit(out)
        return out

    def finish(self) -> FinishResult:
        """Signal end of input and report any leftover incomplete frame.

        Returns a :class:`FinishResult`; ``incomplete`` is True when the
        stream ends in the middle of a frame.  Trailing garbage that never
        formed a frame is reported via ``pending_bytes``.  After ``finish``
        the decoder refuses further :meth:`feed` calls.
        """
        out: List[Frame] = []
        if not self._finished:
            self._parse(out)
            self._enforce_buffer_limit(out)
            self._finished = True
        return FinishResult(
            frames=out,
            incomplete=self._state is not State.WAIT_MAGIC,
            pending_bytes=self._pending_bytes(),
            state=self._state.name,
        )

    def stats(self) -> Dict[str, Any]:
        """Return decoder health statistics.

        Keys: ``frames_parsed``, ``crc_errors``, ``invalid_frames``,
        ``magic_misalignments``, ``buffer_overflows``, ``pending_bytes``,
        ``max_payload_seen``, ``avg_frame_length`` (mean wire length of
        successfully parsed frames) and ``state``.
        """
        return {
            "frames_parsed": self._frames_parsed,
            "crc_errors": self._crc_errors,
            "invalid_frames": self._invalid_frames,
            "magic_misalignments": self._magic_misalignments,
            "buffer_overflows": self._buffer_overflows,
            "pending_bytes": self._pending_bytes(),
            "max_payload_seen": self._max_payload_seen,
            "avg_frame_length": (self._total_frame_bytes / self._frames_parsed
                                 if self._frames_parsed else 0.0),
            "state": self._state.name,
        }

    # ------------------------------------------------------------------ #
    # persistence
    # ------------------------------------------------------------------ #

    def dump(self) -> Dict[str, Any]:
        """Return a JSON-serialisable snapshot of the full decoder state."""
        return {
            "format": SNAPSHOT_FORMAT,
            "format_version": SNAPSHOT_VERSION,
            "config": {
                "max_payload": self._max_payload,
                "max_buffer": self._max_buffer,
            },
            "counters": {
                "frames_parsed": self._frames_parsed,
                "crc_errors": self._crc_errors,
                "invalid_frames": self._invalid_frames,
                "magic_misalignments": self._magic_misalignments,
                "buffer_overflows": self._buffer_overflows,
                "max_payload_seen": self._max_payload_seen,
                "total_frame_bytes": self._total_frame_bytes,
            },
            "state": self._state.name,
            "frame": {
                "version": self._version,
                "frame_type": self._frame_type,
                "length": self._length,
                "length_bytes": bytes(self._len_bytes).hex(),
                "payload": bytes(self._payload).hex(),
                "crc_bytes": bytes(self._crc_bytes).hex(),
            },
            "pending_buffer": bytes(self._buf).hex(),
            "finished": self._finished,
        }

    def save(self, path: Union[str, Path]) -> None:
        """Persist the decoder state (config, counters, pending buffer)
        as a JSON file.  Loading it back with :meth:`load` and continuing
        to feed produces exactly the same results as never snapshotting."""
        Path(path).write_text(json.dumps(self.dump(), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, path: Union[str, Path]) -> "FeedDecoder":
        """Rebuild a decoder from a snapshot written by :meth:`save`.

        :raises SnapshotError: if the file is not valid JSON, required
            fields are missing, counters are negative, hex fields are not
            valid hex, or the persisted partial-frame state is internally
            inconsistent.  Nothing is silently ignored.
        :raises OSError: if the file cannot be read at all.
        """
        source = str(path)
        text = Path(path).read_text(encoding="utf-8")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"{source}: not valid JSON ({exc})") from exc
        if not isinstance(data, dict):
            raise SnapshotError(f"{source}: snapshot must be a JSON object")

        def fail(msg: str) -> None:
            raise SnapshotError(f"{source}: {msg}")

        if data.get("format") != SNAPSHOT_FORMAT:
            fail(f"missing or unknown 'format' (expected {SNAPSHOT_FORMAT!r})")
        if data.get("format_version") != SNAPSHOT_VERSION:
            fail(f"unsupported format_version {data.get('format_version')!r}")
        for key in ("config", "counters", "state", "frame",
                    "pending_buffer", "finished"):
            if key not in data:
                fail(f"missing required field {key!r}")

        config = data["config"]
        if not isinstance(config, dict):
            fail("'config' must be an object")
        max_payload = _checked_non_neg_int(config, "max_payload", fail)
        max_buffer = _checked_non_neg_int(config, "max_buffer", fail)

        counters = data["counters"]
        if not isinstance(counters, dict):
            fail("'counters' must be an object")
        counter_values = {
            name: _checked_non_neg_int(counters, name, fail)
            for name in ("frames_parsed", "crc_errors", "invalid_frames",
                         "magic_misalignments", "buffer_overflows",
                         "max_payload_seen", "total_frame_bytes")
        }

        state_name = data["state"]
        if not isinstance(state_name, str) or state_name not in State.__members__:
            fail(f"unknown state {state_name!r}")
        state = State[state_name]
        if state is State.COMPLETE:
            fail("state COMPLETE is transient and cannot appear in a snapshot")

        frame = data["frame"]
        if not isinstance(frame, dict):
            fail("'frame' must be an object")
        for key in ("version", "frame_type", "length",
                    "length_bytes", "payload", "crc_bytes"):
            if key not in frame:
                fail(f"missing required field 'frame.{key}'")
        version = _checked_byte(frame, "version", fail)
        frame_type = _checked_byte(frame, "frame_type", fail)
        length = _checked_non_neg_int(frame, "length", fail)
        length_bytes = _checked_hex(frame, "length_bytes", fail)
        payload = _checked_hex(frame, "payload", fail)
        crc_bytes = _checked_hex(frame, "crc_bytes", fail)

        pending_buffer = _checked_hex(data, "pending_buffer", fail)
        finished = data["finished"]
        if not isinstance(finished, bool):
            fail("'finished' must be a boolean")

        _check_state_consistency(state, version, length, length_bytes,
                                 payload, crc_bytes, max_payload, fail)

        dec = cls(max_payload=max_payload, max_buffer=max_buffer)
        dec._frames_parsed = counter_values["frames_parsed"]
        dec._crc_errors = counter_values["crc_errors"]
        dec._invalid_frames = counter_values["invalid_frames"]
        dec._magic_misalignments = counter_values["magic_misalignments"]
        dec._buffer_overflows = counter_values["buffer_overflows"]
        dec._max_payload_seen = counter_values["max_payload_seen"]
        dec._total_frame_bytes = counter_values["total_frame_bytes"]
        dec._state = state
        dec._version = version
        dec._frame_type = frame_type
        dec._length = length
        dec._len_bytes = bytearray(length_bytes)
        dec._payload = bytearray(payload)
        dec._crc_bytes = bytearray(crc_bytes)
        dec._buf = bytearray(pending_buffer)
        dec._finished = finished
        dec._rebuild_consumed()
        return dec

    # ------------------------------------------------------------------ #
    # state machine
    # ------------------------------------------------------------------ #

    def _reset_partials(self) -> None:
        """Forget all half-consumed frame data (keeps ``self._buf``)."""
        self._version = 0
        self._frame_type = 0
        self._length = 0
        self._len_bytes = bytearray()
        self._payload = bytearray()
        self._crc_bytes = bytearray()
        # every byte consumed since the last magic, kept so an erroring
        # frame can be pushed back in front of the buffer for resync
        self._consumed = bytearray()

    def _rebuild_consumed(self) -> None:
        """Reconstruct ``_consumed`` from the persisted partial fields."""
        consumed = bytearray()
        if self._state in (State.READ_TYPE, State.READ_LENGTH,
                           State.READ_PAYLOAD, State.READ_CRC):
            consumed.append(self._version)
        if self._state in (State.READ_LENGTH, State.READ_PAYLOAD,
                           State.READ_CRC):
            consumed.append(self._frame_type)
            consumed += self._len_bytes
        if self._state in (State.READ_PAYLOAD, State.READ_CRC):
            consumed += self._payload
        if self._state is State.READ_CRC:
            consumed += self._crc_bytes
        self._consumed = consumed

    def _pending_bytes(self) -> int:
        """Bytes held that are not yet decidable (buffer + half frame)."""
        return len(self._buf) + len(self._consumed)

    def _consume(self, n: int) -> None:
        """Move ``n`` bytes from the buffer into the current frame."""
        self._consumed += self._buf[:n]
        del self._buf[:n]

    def _resync(self) -> None:
        """Abandon the current frame and slide back to WAIT_MAGIC.

        The bytes consumed since the last magic are pushed back in front
        of the buffer, so the byte-by-byte search for the next magic also
        covers the interior of the rejected frame.
        """
        self._buf[:0] = self._consumed
        self._reset_partials()
        self._state = State.WAIT_MAGIC

    def _parse(self, out: List[Frame]) -> None:
        """Run the state machine until it starves for input."""
        while True:
            if self._state is State.WAIT_MAGIC:
                idx = self._buf.find(MAGIC)
                if idx < 0:
                    return  # keep everything: tail may be a partial magic
                if idx > 0:
                    del self._buf[:idx]
                    self._magic_misalignments += 1
                del self._buf[:len(MAGIC)]
                self._state = State.READ_VERSION

            elif self._state is State.READ_VERSION:
                if not self._buf:
                    return
                self._version = self._buf[0]
                self._consume(1)
                if self._version != PROTOCOL_VERSION:
                    out.append(self._error(
                        "unsupported_version",
                        f"protocol version {self._version} is not supported "
                        f"(expected {PROTOCOL_VERSION})"))
                    self._invalid_frames += 1
                    self._resync()
                else:
                    self._state = State.READ_TYPE

            elif self._state is State.READ_TYPE:
                if not self._buf:
                    return
                self._frame_type = self._buf[0]
                self._consume(1)
                self._state = State.READ_LENGTH

            elif self._state is State.READ_LENGTH:
                if not self._buf:
                    return
                byte = self._buf[0]
                self._consume(1)
                self._len_bytes.append(byte)
                shift = 7 * (len(self._len_bytes) - 1)
                self._length |= (byte & 0x7F) << shift
                if byte & 0x80:
                    if len(self._len_bytes) >= MAX_VARINT_BYTES:
                        out.append(self._error(
                            "invalid_length_varint",
                            f"length varint did not terminate within "
                            f"{MAX_VARINT_BYTES} bytes"))
                        self._invalid_frames += 1
                        self._resync()
                    # otherwise stay in READ_LENGTH for the next byte
                elif self._length > self._max_payload:
                    out.append(self._error(
                        "payload_too_large",
                        f"declared payload length {self._length} exceeds "
                        f"max_payload={self._max_payload}"))
                    self._invalid_frames += 1
                    self._resync()
                elif self._length == 0:
                    self._state = State.READ_CRC
                else:
                    self._state = State.READ_PAYLOAD

            elif self._state is State.READ_PAYLOAD:
                need = self._length - len(self._payload)
                take = min(need, len(self._buf))
                if take:
                    self._payload += self._buf[:take]
                    self._consume(take)
                if len(self._payload) < self._length:
                    return
                self._state = State.READ_CRC

            elif self._state is State.READ_CRC:
                need = CRC_SIZE - len(self._crc_bytes)
                take = min(need, len(self._buf))
                if take:
                    self._crc_bytes += self._buf[:take]
                    self._consume(take)
                if len(self._crc_bytes) < CRC_SIZE:
                    return
                self._state = State.COMPLETE

            elif self._state is State.COMPLETE:
                self._complete_frame(out)

            else:  # pragma: no cover - defensive
                raise AssertionError(f"unhandled state {self._state!r}")

    def _complete_frame(self, out: List[Frame]) -> None:
        """Validate the assembled frame's CRC and emit the result."""
        body = (bytes((self._version, self._frame_type))
                + bytes(self._len_bytes) + bytes(self._payload))
        crc_expected = zlib.crc32(body) & 0xFFFFFFFF
        crc_actual = int.from_bytes(self._crc_bytes, "little")
        raw_length = len(MAGIC) + len(body) + CRC_SIZE
        if crc_actual == crc_expected:
            payload = bytes(self._payload)
            out.append(Frame(ok=True,
                             frame_type=self._frame_type,
                             payload=payload,
                             crc_expected=crc_expected,
                             crc_actual=crc_actual,
                             raw_length=raw_length))
            self._frames_parsed += 1
            self._total_frame_bytes += raw_length
            if len(payload) > self._max_payload_seen:
                self._max_payload_seen = len(payload)
            self._reset_partials()
            self._state = State.WAIT_MAGIC
        else:
            out.append(Frame(ok=False,
                             frame_type=self._frame_type,
                             payload=bytes(self._payload),
                             error="crc_mismatch",
                             detail=(f"frame CRC mismatch: expected "
                                     f"0x{crc_expected:08x}, got "
                                     f"0x{crc_actual:08x}"),
                             crc_expected=crc_expected,
                             crc_actual=crc_actual,
                             raw_length=raw_length))
            self._crc_errors += 1
            self._resync()

    def _error(self, error: str, detail: str) -> Frame:
        """Build an error record for the frame currently being abandoned."""
        return Frame(ok=False,
                     frame_type=self._frame_type,
                     error=error,
                     detail=detail,
                     raw_length=len(MAGIC) + len(self._consumed))

    def _enforce_buffer_limit(self, out: List[Frame]) -> None:
        """Apply the max_buffer policy: on overflow, record an error,
        drop the pending bytes and resynchronise at WAIT_MAGIC."""
        pending = self._pending_bytes()
        if pending > self._max_buffer:
            out.append(Frame(
                ok=False,
                error="buffer_overflow",
                detail=(f"pending buffer grew to {pending} bytes, exceeding "
                        f"max_buffer={self._max_buffer}; the stream is "
                        f"probably missing a magic number or contains an "
                        f"abnormal length field; pending bytes were "
                        f"discarded and the decoder resynchronised")))
            self._buffer_overflows += 1
            self._buf.clear()
            self._reset_partials()
            self._state = State.WAIT_MAGIC


# ---------------------------------------------------------------------- #
# snapshot validation helpers
# ---------------------------------------------------------------------- #

def _checked_non_neg_int(obj: Dict[str, Any], key: str, fail) -> int:
    """Validate that ``obj[key]`` exists and is a non-negative int."""
    if key not in obj:
        fail(f"missing required field {key!r}")
    value = obj[key]
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        fail(f"field {key!r} must be a non-negative integer, got {value!r}")
    return value


def _checked_byte(obj: Dict[str, Any], key: str, fail) -> int:
    """Validate that ``obj[key]`` exists and is an int in 0..255."""
    value = _checked_non_neg_int(obj, key, fail)
    if value > 0xFF:
        fail(f"field {key!r} must be in 0..255, got {value!r}")
    return value


def _checked_hex(obj: Dict[str, Any], key: str, fail) -> bytes:
    """Validate that ``obj[key]`` exists and is a valid hex string."""
    if key not in obj:
        fail(f"missing required field {key!r}")
    value = obj[key]
    if not isinstance(value, str) or len(value) % 2 != 0 \
            or not _HEX_RE.fullmatch(value):
        fail(f"field {key!r} must be an even-length hex string, got {value!r}")
    return bytes.fromhex(value)


def _check_state_consistency(state: State, version: int, length: int,
                             length_bytes: bytes, payload: bytes,
                             crc_bytes: bytes, max_payload: int, fail) -> None:
    """Validate that a persisted partial frame matches its state."""
    if len(length_bytes) > MAX_VARINT_BYTES:
        fail(f"'frame.length_bytes' is longer than {MAX_VARINT_BYTES} bytes")
    if len(crc_bytes) > CRC_SIZE:
        fail(f"'frame.crc_bytes' is longer than {CRC_SIZE} bytes")
    if len(payload) > length:
        fail(f"'frame.payload' ({len(payload)} bytes) is longer than "
             f"'frame.length' ({length})")
    if state in (State.WAIT_MAGIC, State.READ_VERSION):
        if length_bytes or payload or crc_bytes:
            fail(f"state {state.name} must not carry partial frame data")
    if state not in (State.WAIT_MAGIC, State.READ_VERSION):
        if version != PROTOCOL_VERSION:
            fail(f"state {state.name} implies version {PROTOCOL_VERSION}, "
                 f"got {version}")
    if state is State.READ_TYPE and (length_bytes or payload or crc_bytes):
        fail("state READ_TYPE must not carry length/payload/crc data")
    if state is State.READ_LENGTH:
        if payload or crc_bytes:
            fail("state READ_LENGTH must not carry payload/crc data")
        if not all(b & 0x80 for b in length_bytes):
            fail("state READ_LENGTH requires an unterminated varint")
    if state in (State.READ_PAYLOAD, State.READ_CRC):
        if not length_bytes:
            fail(f"state {state.name} requires a complete length varint")
        if encode_varint(length) != length_bytes:
            fail(f"'frame.length' ({length}) does not match "
                 f"'frame.length_bytes' ({length_bytes.hex()!r})")
        if length > max_payload:
            fail(f"'frame.length' ({length}) exceeds max_payload "
                 f"({max_payload})")
    if state is State.READ_PAYLOAD:
        if crc_bytes:
            fail("state READ_PAYLOAD must not carry crc data")
        if len(payload) >= length:
            fail(f"state READ_PAYLOAD requires payload shorter than "
                 f"length ({len(payload)} !< {length})")
    if state is State.READ_CRC:
        if len(payload) != length:
            fail(f"state READ_CRC requires a complete payload "
                 f"({len(payload)} != {length})")
        if len(crc_bytes) >= CRC_SIZE:
            fail("state READ_CRC requires an incomplete crc field")
