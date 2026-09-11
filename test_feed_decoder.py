"""Unit tests for feed_decoder: state machine, varint, CRC, resync,
chunk equivalence, memory limits, snapshot round-trip and CLI."""

from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from feed_decoder import (  # noqa: E402
    CRC_SIZE,
    MAGIC,
    MAX_VARINT_BYTES,
    PROTOCOL_VERSION,
    FeedDecoder,
    FinishResult,
    Frame,
    SnapshotError,
    State,
    encode_frame,
    encode_stream,
    encode_varint,
)

HERE = Path(__file__).resolve().parent
MAIN_PY = HERE / "main.py"


def corrupt_crc(frame_bytes: bytes) -> bytes:
    """Return a copy of an encoded frame with a broken CRC field."""
    bad = bytearray(frame_bytes)
    bad[-1] ^= 0xFF
    return bytes(bad)


def frame_with_length(declared_length: int, payload: bytes = b"",
                      frame_type: int = 1) -> bytes:
    """Hand-craft a frame whose length field is ``declared_length``,
    regardless of the actual payload (CRC computed over what is emitted)."""
    body = (bytes((PROTOCOL_VERSION, frame_type))
            + encode_varint(declared_length) + payload)
    crc = zlib.crc32(body) & 0xFFFFFFFF
    return MAGIC + body + crc.to_bytes(CRC_SIZE, "little")


def random_split(data: bytes, rng: random.Random, max_chunk: int = 17) -> list:
    """Split ``data`` into randomly sized non-empty chunks."""
    chunks = []
    i = 0
    while i < len(data):
        n = rng.randint(1, min(max_chunk, len(data) - i))
        chunks.append(data[i:i + n])
        i += n
    return chunks


def build_mixed_stream() -> bytes:
    """A stream combining valid frames, garbage, a CRC error and an
    oversized-length frame (for use with max_payload >= 256 the oversized
    part is only included by callers that want it)."""
    parts = [
        encode_stream([
            (1, b"hello"),
            (2, b""),                       # empty payload
            (3, bytes(range(256))),         # 256-byte payload, 2-byte varint
            (4, MAGIC + b"\xfe"),           # payload containing magic bytes
        ]),
        b"\x00\x11\x22",                    # garbage between frames
        corrupt_crc(encode_frame(7, b"crc will break")),
        b"\xfe",                            # lone partial magic in garbage
        encode_frame(9, b"x" * 1000),
    ]
    return b"".join(parts)


def run_decoder(chunks, **kwargs):
    """Feed chunks to a fresh decoder; return (frames, decoder, finish)."""
    dec = FeedDecoder(**kwargs)
    frames = []
    for chunk in chunks:
        frames.extend(dec.feed(chunk))
    fin = dec.finish()
    frames.extend(fin.frames)
    return frames, dec, fin


class TestVarint(unittest.TestCase):
    """Variable-length length-field encoding."""

    def test_known_vectors(self):
        self.assertEqual(encode_varint(0), b"\x00")
        self.assertEqual(encode_varint(1), b"\x01")
        self.assertEqual(encode_varint(127), b"\x7f")
        self.assertEqual(encode_varint(128), b"\x80\x01")
        self.assertEqual(encode_varint(300), b"\xac\x02")
        self.assertEqual(encode_varint(16384), b"\x80\x80\x01")

    def test_roundtrip_through_decoder(self):
        for value in (0, 1, 127, 128, 300, 16383, 16384, 65535, 1 << 20):
            payload = bytes(value % 256 for _ in range(min(value, 64)))
            # use a payload of exactly `value` bytes only for small values
            if value <= 2048:
                frame = encode_frame(1, bytes(value))
                dec = FeedDecoder()
                frames = dec.feed(frame)
                self.assertEqual(len(frames), 1)
                self.assertTrue(frames[0].ok)
                self.assertEqual(len(frames[0].payload), value)

    def test_rejects_negative_and_non_int(self):
        for bad in (-1, 1.5, "3", True):
            with self.assertRaises(ValueError):
                encode_varint(bad)

    def test_five_bytes_max(self):
        # 2**35 - 1 encodes in exactly 5 bytes and is accepted as a varint
        # (then rejected against max_payload, not as a varint error).
        data = MAGIC + bytes((PROTOCOL_VERSION, 1)) + b"\xff\xff\xff\xff\x7f"
        dec = FeedDecoder()
        frames = dec.feed(data)
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].error, "payload_too_large")

    def test_sixth_byte_is_invalid(self):
        data = MAGIC + bytes((PROTOCOL_VERSION, 1)) + b"\x80" * 5
        dec = FeedDecoder()
        frames = dec.feed(data)
        self.assertEqual(len(frames), 1)
        self.assertFalse(frames[0].ok)
        self.assertEqual(frames[0].error, "invalid_length_varint")
        self.assertEqual(dec.stats()["invalid_frames"], 1)


class TestEncodeDecode(unittest.TestCase):
    """encode_frame / encode_stream are the dual of the decoder."""

    def test_roundtrip_single(self):
        for frame_type, payload in ((0, b""), (1, b"a"), (255, bytes(range(256)))):
            frames, dec, fin = run_decoder([encode_frame(frame_type, payload)])
            self.assertEqual(len(frames), 1)
            self.assertTrue(frames[0].ok)
            self.assertEqual(frames[0].frame_type, frame_type)
            self.assertEqual(frames[0].payload, payload)
            self.assertFalse(fin.incomplete)

    def test_roundtrip_stream(self):
        spec = [(1, b"one"), (2, b""), (3, b"three" * 100)]
        frames, _, _ = run_decoder([encode_stream(spec)])
        self.assertEqual([(f.frame_type, f.payload) for f in frames], spec)

    def test_encode_stream_accepts_dicts(self):
        data = encode_stream([{"frame_type": 9, "payload": b"x"}])
        frames, _, _ = run_decoder([data])
        self.assertEqual(frames[0].frame_type, 9)
        self.assertEqual(frames[0].payload, b"x")

    def test_encode_validation(self):
        with self.assertRaises(ValueError):
            encode_frame(256, b"")
        with self.assertRaises(ValueError):
            encode_frame(-1, b"")
        with self.assertRaises(TypeError):
            encode_frame(1, "not bytes")


class TestStateMachine(unittest.TestCase):
    """Explicit state transitions, byte by byte."""

    def test_transition_sequence(self):
        payload = b"abc"
        wire = encode_frame(5, payload)
        dec = FeedDecoder()
        expected = [
            State.WAIT_MAGIC,    # after MAGIC[0] (partial magic)
            State.READ_VERSION,  # after MAGIC complete
            State.READ_TYPE,     # after version
            State.READ_LENGTH,   # after type
            State.READ_PAYLOAD,  # after length varint (len=3)
            State.READ_PAYLOAD,  # payload[0]
            State.READ_PAYLOAD,  # payload[1]
            State.READ_CRC,      # payload complete
            State.READ_CRC,      # crc[0]
            State.READ_CRC,      # crc[1]
            State.READ_CRC,      # crc[2]
            State.WAIT_MAGIC,    # crc complete -> frame emitted, resync
        ]
        frames = []
        for i, byte in enumerate(wire):
            frames.extend(dec.feed(bytes([byte])))
            self.assertEqual(dec.state, expected[i],
                             f"after byte {i} ({byte:#04x})")
        self.assertEqual(dec.state, State.WAIT_MAGIC)
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].payload, payload)

    def test_half_frame_survives_across_feeds(self):
        wire = encode_frame(1, b"payload-data")
        dec = FeedDecoder()
        self.assertEqual(dec.feed(wire[:5]), [])   # mid-varint/header
        self.assertEqual(dec.feed(wire[5:9]), [])  # mid-payload
        frames = dec.feed(wire[9:])
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].payload, b"payload-data")

    def test_varint_split_across_chunks(self):
        payload = bytes(300)  # length 300 -> varint ac 02 (2 bytes)
        wire = encode_frame(1, payload)
        header_len = len(MAGIC) + 2
        dec = FeedDecoder()
        dec.feed(wire[:header_len + 1])          # first varint byte only
        self.assertEqual(dec.state, State.READ_LENGTH)
        frames = dec.feed(wire[header_len + 1:])
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].payload, payload)

    def test_crc_split_across_chunks(self):
        wire = encode_frame(1, b"data")
        dec = FeedDecoder()
        dec.feed(wire[:-2])  # 2 of 4 CRC bytes
        self.assertEqual(dec.state, State.READ_CRC)
        frames = dec.feed(wire[-2:])
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)


class TestCRCErrors(unittest.TestCase):
    """CRC mismatch -> error record, then resync to the next magic."""

    def test_crc_mismatch_recorded_and_recovery(self):
        bad = corrupt_crc(encode_frame(7, b"broken"))
        good = encode_frame(8, b"fine")
        frames, dec, _ = run_decoder([bad + good])
        self.assertEqual(len(frames), 2)
        self.assertFalse(frames[0].ok)
        self.assertEqual(frames[0].error, "crc_mismatch")
        self.assertEqual(frames[0].frame_type, 7)
        self.assertEqual(frames[0].payload, b"broken")
        self.assertIsNotNone(frames[0].crc_expected)
        self.assertTrue(frames[1].ok)
        self.assertEqual(frames[1].payload, b"fine")
        self.assertEqual(dec.stats()["crc_errors"], 1)
        self.assertEqual(dec.stats()["frames_parsed"], 1)

    def test_consecutive_bad_frames(self):
        stream = b"".join(corrupt_crc(encode_frame(i, b"x"))
                          for i in range(3)) + encode_frame(9, b"ok")
        frames, dec, _ = run_decoder([stream])
        self.assertEqual([f.ok for f in frames], [False, False, False, True])
        self.assertEqual(dec.stats()["crc_errors"], 3)
        self.assertEqual(frames[-1].payload, b"ok")

    def test_resync_finds_magic_inside_bad_frame(self):
        # A corrupt outer frame whose payload *is* a valid inner frame:
        # after the CRC failure the resync scan must find the inner magic.
        inner = encode_frame(2, b"inner")
        outer = bytearray(encode_frame(1, inner))
        outer[-1] ^= 0xFF  # break outer CRC
        final = encode_frame(3, b"final")
        frames, dec, _ = run_decoder([bytes(outer) + final])
        oks = [(f.ok, f.frame_type) for f in frames]
        self.assertIn((False, 1), oks)   # outer CRC error
        self.assertIn((True, 2), oks)    # inner frame recovered
        self.assertIn((True, 3), oks)    # stream continues afterwards
        self.assertEqual(dec.stats()["frames_parsed"], 2)


class TestResync(unittest.TestCase):
    """Magic misalignment: byte-sliding resynchronisation."""

    def test_garbage_prefix(self):
        frames, dec, _ = run_decoder([b"\xde\xad\xbe\xef" + encode_frame(1, b"a")])
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)
        self.assertEqual(dec.stats()["magic_misalignments"], 1)

    def test_garbage_between_frames(self):
        stream = (encode_frame(1, b"a") + b"garbage!"
                  + encode_frame(2, b"b"))
        frames, dec, _ = run_decoder([stream])
        self.assertEqual([f.payload for f in frames], [b"a", b"b"])
        self.assertEqual(dec.stats()["magic_misalignments"], 1)

    def test_sliding_byte_by_byte(self):
        # b"\xfe" alone is a magic prefix; b"\xfe\xfe" + magic must slide
        # one byte at a time and still lock onto the real magic.
        stream = b"\xfe\xfe" + encode_frame(1, b"locked")
        frames, dec, _ = run_decoder([stream])
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].payload, b"locked")
        self.assertEqual(dec.stats()["magic_misalignments"], 1)

    def test_trailing_garbage_kept_pending(self):
        dec = FeedDecoder()
        dec.feed(encode_frame(1, b"a") + b"\x99\x98")
        fin = dec.finish()
        self.assertFalse(fin.incomplete)          # not mid-frame...
        self.assertEqual(fin.pending_bytes, 2)    # ...but garbage remains

    def test_magic_split_across_chunks(self):
        dec = FeedDecoder()
        dec.feed(MAGIC[:1])
        frames = dec.feed(MAGIC[1:] + encode_frame(1, b"")[len(MAGIC):])
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)


class TestInvalidLength(unittest.TestCase):
    """Oversized and malformed length fields."""

    def test_length_above_max_payload_rejected_before_payload(self):
        # Declare a huge payload but send only the header: the decoder must
        # reject immediately, without waiting for (or allocating) payload.
        header = (MAGIC + bytes((PROTOCOL_VERSION, 1))
                  + encode_varint(10 ** 9))
        dec = FeedDecoder()
        frames = dec.feed(header)
        self.assertEqual(len(frames), 1)
        self.assertFalse(frames[0].ok)
        self.assertEqual(frames[0].error, "payload_too_large")
        self.assertEqual(dec.stats()["invalid_frames"], 1)

    def test_recovery_after_oversized_length(self):
        big = frame_with_length(100, b"A" * 100)
        good = encode_frame(2, b"after")
        dec = FeedDecoder(max_payload=16)
        frames = []
        frames.extend(dec.feed(big + good))
        errors = [f for f in frames if not f.ok]
        oks = [f for f in frames if f.ok]
        self.assertEqual(len(errors), 1)
        self.assertEqual(errors[0].error, "payload_too_large")
        self.assertEqual(len(oks), 1)
        self.assertEqual(oks[0].payload, b"after")

    def test_max_payload_zero(self):
        dec = FeedDecoder(max_payload=0)
        frames = dec.feed(encode_frame(1, b""))
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)
        frames = dec.feed(encode_frame(1, b"x"))
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].error, "payload_too_large")

    def test_varint_too_long_then_recovery(self):
        bad = MAGIC + bytes((PROTOCOL_VERSION, 1)) + b"\x80" * 5
        good = encode_frame(1, b"next")
        frames, dec, _ = run_decoder([bad + good])
        self.assertEqual(frames[0].error, "invalid_length_varint")
        self.assertTrue(any(f.ok and f.payload == b"next" for f in frames))

    def test_unsupported_version(self):
        wire = bytearray(encode_frame(1, b"v"))
        wire[len(MAGIC)] = 99  # unknown version
        good = encode_frame(1, b"ok")
        frames, dec, _ = run_decoder([bytes(wire) + good])
        self.assertEqual(frames[0].error, "unsupported_version")
        self.assertTrue(any(f.ok and f.payload == b"ok" for f in frames))
        self.assertEqual(dec.stats()["invalid_frames"], 1)


class TestBufferLimit(unittest.TestCase):
    """max_buffer overflow policy."""

    def test_overflow_records_error_and_resyncs(self):
        dec = FeedDecoder(max_buffer=8)
        frames = dec.feed(b"\x00" * 10)  # garbage with no magic
        self.assertEqual(len(frames), 1)
        self.assertFalse(frames[0].ok)
        self.assertEqual(frames[0].error, "buffer_overflow")
        self.assertEqual(dec.stats()["buffer_overflows"], 1)
        self.assertEqual(dec.stats()["pending_bytes"], 0)
        # decoder keeps working afterwards
        frames = dec.feed(encode_frame(1, b"still alive"))
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)

    def test_no_overflow_when_frames_keep_completing(self):
        stream = encode_stream([(1, b"x" * 50)] * 5)
        dec = FeedDecoder(max_buffer=64)
        frames = dec.feed(stream)
        self.assertEqual(len(frames), 5)
        self.assertEqual(dec.stats()["buffer_overflows"], 0)

    def test_max_buffer_zero(self):
        # Any undecidable byte overflows immediately...
        dec = FeedDecoder(max_buffer=0)
        frames = dec.feed(b"\x00")
        self.assertEqual(len(frames), 1)
        self.assertEqual(frames[0].error, "buffer_overflow")
        # ...but a frame that completes within one feed never pends.
        dec2 = FeedDecoder(max_buffer=0)
        frames = dec2.feed(encode_frame(1, b""))
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)

    def test_overflow_counts_toward_stats(self):
        dec = FeedDecoder(max_buffer=4)
        dec.feed(b"\x01\x02\x03\x04\x05")
        dec.feed(b"\x06")
        stats = dec.stats()
        self.assertEqual(stats["buffer_overflows"], 1)


class TestChunkEquivalence(unittest.TestCase):
    """The acceptance criterion: one-shot feed == arbitrary chunked feed."""

    def assert_equivalent(self, stream: bytes, **kwargs):
        ref_frames, ref_dec, ref_fin = run_decoder([stream], **kwargs)
        # byte-by-byte
        splits = [[stream[i:i + 1] for i in range(len(stream))]]
        # random splits with several seeds
        rng = random.Random(1234)
        for _ in range(25):
            splits.append(random_split(stream, rng))
        # a few pathological splits: empty chunks interleaved
        splits.append([b"", stream[:1], b"", stream[1:], b""])
        for chunks in splits:
            frames, dec, fin = run_decoder(chunks, **kwargs)
            self.assertEqual([f.to_dict() for f in frames],
                             [f.to_dict() for f in ref_frames])
            self.assertEqual(dec.stats(), ref_dec.stats())
            self.assertEqual(dec.dump(), ref_dec.dump())
            self.assertEqual(fin.incomplete, ref_fin.incomplete)
            self.assertEqual(fin.pending_bytes, ref_fin.pending_bytes)

    def test_pure_valid_stream(self):
        self.assert_equivalent(encode_stream(
            [(i % 4, bytes(range(i % 7)) * 3) for i in range(10)]))

    def test_mixed_stream(self):
        self.assert_equivalent(build_mixed_stream())

    def test_mixed_stream_with_small_max_payload(self):
        stream = (build_mixed_stream()
                  + frame_with_length(5000, b"B" * 5000)
                  + encode_frame(10, b"tail"))
        self.assert_equivalent(stream, max_payload=2048)

    def test_truncated_tail(self):
        stream = build_mixed_stream() + encode_frame(11, b"cut off")[:7]
        self.assert_equivalent(stream)

    def test_unterminated_varint_tail(self):
        stream = encode_frame(1, b"a") + MAGIC + b"\x01\x02\xac"
        self.assert_equivalent(stream)


class TestEdgeCases(unittest.TestCase):
    def test_empty_input(self):
        dec = FeedDecoder()
        self.assertEqual(dec.feed(b""), [])
        fin = dec.finish()
        self.assertFalse(fin.incomplete)
        self.assertEqual(fin.frames, [])
        self.assertEqual(fin.pending_bytes, 0)

    def test_single_byte(self):
        dec = FeedDecoder()
        self.assertEqual(dec.feed(b"\xfe"), [])
        self.assertEqual(dec.state, State.WAIT_MAGIC)
        self.assertEqual(dec.stats()["pending_bytes"], 1)

    def test_magic_only(self):
        dec = FeedDecoder()
        dec.feed(MAGIC)
        self.assertEqual(dec.state, State.READ_VERSION)
        fin = dec.finish()
        self.assertTrue(fin.incomplete)

    def test_zero_length_payload(self):
        frames, _, _ = run_decoder([encode_frame(0, b"")])
        self.assertEqual(len(frames), 1)
        self.assertTrue(frames[0].ok)
        self.assertEqual(frames[0].payload, b"")

    def test_feed_after_finish_raises(self):
        dec = FeedDecoder()
        dec.finish()
        with self.assertRaises(RuntimeError):
            dec.feed(b"\x00")

    def test_finish_is_idempotent(self):
        dec = FeedDecoder()
        dec.feed(encode_frame(1, b"a")[:3])
        fin1 = dec.finish()
        fin2 = dec.finish()
        self.assertEqual(fin1.incomplete, fin2.incomplete)
        self.assertEqual(fin2.frames, [])

    def test_feed_rejects_non_bytes(self):
        dec = FeedDecoder()
        with self.assertRaises(TypeError):
            dec.feed("text")

    def test_decoder_config_validation(self):
        for bad in (-1, 1.5, "x", True):
            with self.assertRaises(ValueError):
                FeedDecoder(max_payload=bad)
            with self.assertRaises(ValueError):
                FeedDecoder(max_buffer=bad)


class TestStats(unittest.TestCase):
    def test_stats_contents(self):
        stream = (encode_frame(1, b"abcd")
                  + corrupt_crc(encode_frame(2, b"xy"))
                  + b"junk"
                  + encode_frame(3, b"hello!"))
        frames, dec, _ = run_decoder([stream])
        stats = dec.stats()
        self.assertEqual(stats["frames_parsed"], 2)
        self.assertEqual(stats["crc_errors"], 1)
        self.assertEqual(stats["magic_misalignments"], 1)
        self.assertEqual(stats["invalid_frames"], 0)
        self.assertEqual(stats["buffer_overflows"], 0)
        self.assertEqual(stats["max_payload_seen"], 6)
        expected_avg = (len(encode_frame(1, b"abcd"))
                        + len(encode_frame(3, b"hello!"))) / 2
        self.assertAlmostEqual(stats["avg_frame_length"], expected_avg)
        self.assertEqual(stats["pending_bytes"], 0)
        self.assertEqual(stats["state"], "WAIT_MAGIC")


class TestSnapshot(unittest.TestCase):
    """save/load round-trip and corrupt-file handling."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "snap.json"

    def test_roundtrip_mid_stream(self):
        stream = build_mixed_stream() + encode_frame(12, b"the end")
        cut = 37  # lands inside a frame
        ref_frames, ref_dec, _ = run_decoder([stream])

        dec1 = FeedDecoder()
        head_frames = dec1.feed(stream[:cut])
        dec1.save(self.path)

        dec2 = FeedDecoder.load(self.path)
        tail_frames = dec2.feed(stream[cut:])
        fin = dec2.finish()
        tail_frames += fin.frames

        self.assertEqual([f.to_dict() for f in head_frames + tail_frames],
                         [f.to_dict() for f in ref_frames])
        self.assertEqual(dec2.stats(), ref_dec.stats())
        self.assertEqual(dec2.dump(), ref_dec.dump())

    def test_roundtrip_at_every_byte_boundary(self):
        stream = encode_frame(1, b"snapshot me") + encode_frame(2, b"!")
        ref_frames, ref_dec, _ = run_decoder([stream])
        for cut in range(len(stream) + 1):
            dec1 = FeedDecoder()
            head = dec1.feed(stream[:cut])
            dec1.save(self.path)
            dec2 = FeedDecoder.load(self.path)
            tail = dec2.feed(stream[cut:])
            tail += dec2.finish().frames
            self.assertEqual([f.to_dict() for f in head + tail],
                             [f.to_dict() for f in ref_frames],
                             f"cut at {cut}")
            self.assertEqual(dec2.stats(), ref_dec.stats(), f"cut at {cut}")

    def test_dump_identical_after_load(self):
        dec = FeedDecoder(max_payload=128, max_buffer=512)
        dec.feed(build_mixed_stream()[:53])
        dec.save(self.path)
        dec2 = FeedDecoder.load(self.path)
        self.assertEqual(dec.dump(), dec2.dump())

    def _write(self, obj) -> None:
        self.path.write_text(obj if isinstance(obj, str)
                             else json.dumps(obj), encoding="utf-8")

    def _valid_snapshot(self) -> dict:
        dec = FeedDecoder()
        dec.feed(encode_frame(1, b"abc")[:6])
        return dec.dump()

    def test_load_not_json(self):
        self._write("{not json")
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("not valid JSON", str(ctx.exception))

    def test_load_missing_file(self):
        with self.assertRaises(OSError):
            FeedDecoder.load(Path(self.tmp.name) / "nope.json")

    def test_load_missing_field(self):
        snap = self._valid_snapshot()
        del snap["counters"]
        self._write(snap)
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("counters", str(ctx.exception))

    def test_load_negative_counter(self):
        snap = self._valid_snapshot()
        snap["counters"]["frames_parsed"] = -1
        self._write(snap)
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("frames_parsed", str(ctx.exception))

    def test_load_bad_hex(self):
        snap = self._valid_snapshot()
        snap["pending_buffer"] = "zz"
        self._write(snap)
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("pending_buffer", str(ctx.exception))

    def test_load_odd_hex(self):
        snap = self._valid_snapshot()
        snap["pending_buffer"] = "abc"
        self._write(snap)
        with self.assertRaises(SnapshotError):
            FeedDecoder.load(self.path)

    def test_load_bad_state(self):
        snap = self._valid_snapshot()
        snap["state"] = "NOPE"
        self._write(snap)
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("NOPE", str(ctx.exception))

    def test_load_transient_state_rejected(self):
        snap = self._valid_snapshot()
        snap["state"] = "COMPLETE"
        self._write(snap)
        with self.assertRaises(SnapshotError):
            FeedDecoder.load(self.path)

    def test_load_inconsistent_frame_state(self):
        snap = self._valid_snapshot()
        snap["state"] = "READ_PAYLOAD"
        # length varint says 3 but no payload bytes persisted -> consistent
        # would be 0 < 3, so make it inconsistent instead:
        snap["frame"]["payload"] = "aabbccdd"
        self._write(snap)
        with self.assertRaises(SnapshotError):
            FeedDecoder.load(self.path)

    def test_load_bad_config(self):
        snap = self._valid_snapshot()
        snap["config"]["max_payload"] = -5
        self._write(snap)
        with self.assertRaises(SnapshotError) as ctx:
            FeedDecoder.load(self.path)
        self.assertIn("max_payload", str(ctx.exception))

    def test_load_wrong_format(self):
        self._write({"format": "other", "format_version": 1})
        with self.assertRaises(SnapshotError):
            FeedDecoder.load(self.path)


class TestCLI(unittest.TestCase):
    """main.py JSON-lines interface, exercised as a subprocess."""

    def run_cli(self, lines, *args):
        proc = subprocess.run(
            [sys.executable, str(MAIN_PY), *args],
            input="\n".join(lines) + "\n",
            capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return [json.loads(line) for line in proc.stdout.splitlines()]

    def test_encode_feed_stats_finish(self):
        encoded = encode_frame(1, b"hi").hex()
        out = self.run_cli([
            json.dumps({"cmd": "encode", "frame_type": 1,
                        "payload": b"hi".hex()}),
            json.dumps({"cmd": "feed", "chunk": encoded}),
            json.dumps({"cmd": "stats"}),
            json.dumps({"cmd": "finish"}),
        ])
        self.assertTrue(out[0]["ok"])
        self.assertEqual(out[0]["chunk"], encoded)
        self.assertTrue(out[1]["ok"])
        self.assertEqual(out[1]["frames"][0]["payload"], b"hi".hex())
        self.assertTrue(out[1]["frames"][0]["ok"])
        self.assertEqual(out[2]["stats"]["frames_parsed"], 1)
        self.assertTrue(out[3]["ok"])
        self.assertFalse(out[3]["incomplete"])

    def test_encode_stream_command(self):
        out = self.run_cli([json.dumps({
            "cmd": "encode",
            "frames": [{"frame_type": 1, "payload": "aa"},
                       {"frame_type": 2, "payload": ""}]})])
        self.assertTrue(out[0]["ok"])
        self.assertEqual(out[0]["count"], 2)
        self.assertEqual(out[0]["chunk"],
                         encode_stream([(1, b"\xaa"), (2, b"")]).hex())

    def test_chunked_feed_through_cli(self):
        wire = encode_frame(1, b"cli").hex()
        out = self.run_cli([
            json.dumps({"cmd": "feed", "chunk": wire[:6]}),
            json.dumps({"cmd": "feed", "chunk": wire[6:]}),
            json.dumps({"cmd": "dump"}),
        ])
        self.assertEqual(out[0]["frames"], [])
        self.assertEqual(len(out[1]["frames"]), 1)
        self.assertEqual(out[2]["state"]["state"], "WAIT_MAGIC")

    def test_save_and_load_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "s.json")
            wire = encode_frame(1, b"persist")
            out = self.run_cli([
                json.dumps({"cmd": "feed", "chunk": wire[:5].hex()}),
                json.dumps({"cmd": "save", "path": path}),
                json.dumps({"cmd": "load", "path": path}),
                json.dumps({"cmd": "feed", "chunk": wire[5:].hex()}),
                json.dumps({"cmd": "stats"}),
            ])
            self.assertTrue(all(r["ok"] for r in out))
            self.assertEqual(out[3]["frames"][0]["payload"],
                             b"persist".hex())
            self.assertEqual(out[4]["stats"]["frames_parsed"], 1)

    def test_error_responses(self):
        out = self.run_cli([
            "this is not json",
            json.dumps({"cmd": "bogus"}),
            json.dumps({"cmd": "feed", "chunk": "zz"}),
            json.dumps({"cmd": "feed"}),
            json.dumps({"cmd": "load", "path": "no/such/file.json"}),
            json.dumps({"nope": 1}),
        ])
        for resp in out:
            self.assertFalse(resp["ok"])
            self.assertIn("error", resp)
        self.assertIn("unknown command", out[1]["error"])

    def test_config_command_and_limits(self):
        big = frame_with_length(100, b"A" * 100).hex()
        out = self.run_cli([
            json.dumps({"cmd": "config", "max_payload": 10,
                        "max_buffer": 64}),
            json.dumps({"cmd": "feed", "chunk": big}),
        ])
        self.assertTrue(out[0]["ok"])
        self.assertEqual(out[1]["frames"][0]["error"], "payload_too_large")

    def test_cli_max_payload_argument(self):
        big = frame_with_length(100, b"A" * 100).hex()
        out = self.run_cli([json.dumps({"cmd": "feed", "chunk": big})],
                           "--max-payload", "10")
        self.assertEqual(out[0]["frames"][0]["error"], "payload_too_large")


if __name__ == "__main__":
    unittest.main()
