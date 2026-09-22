"""Offline acceptance tests: run with `python -m unittest discover -s tests -v`."""
import random
import struct
import unittest

from msgstream import DecodedMessage, Diagnostic, StreamDecoder
from msgstream import protocol as p


def decode_all(stream: bytes, chunk_sizes=None):
    dec = StreamDecoder()
    events = []
    if chunk_sizes is None:
        events.extend(dec.feed(stream))
    else:
        pos = 0
        for n in chunk_sizes:
            events.extend(dec.feed(stream[pos:pos + n]))
            pos += n
        events.extend(dec.feed(stream[pos:]))
    events.extend(dec.finish())
    return events


def messages(events):
    return [e for e in events if isinstance(e, DecodedMessage)]


def diags(events):
    return [e for e in events if isinstance(e, Diagnostic)]


class FramingTests(unittest.TestCase):
    def test_arbitrary_splits_match_single_feed(self):
        stream = (p.build_v1(1, "a", "x") + p.build_v2(2, "b", "y", priority=3)
                  + p.build_v2(3, "c", "z"))
        whole = decode_all(stream)
        for seed in range(20):
            rng = random.Random(seed)
            sizes = []
            left = len(stream)
            while left > 0:
                n = rng.randint(1, left)
                sizes.append(n)
                left -= n
            chunked = decode_all(stream, sizes)
            self.assertEqual([m.message for m in messages(whole)],
                             [m.message for m in messages(chunked)])
            self.assertEqual([m.offset for m in messages(whole)],
                             [m.offset for m in messages(chunked)])

    def test_byte_by_byte_feed(self):
        stream = p.build_v1(1, "alice", "hi") + p.build_v2(2, "bob", "yo")
        events = decode_all(stream, [1] * len(stream))
        self.assertEqual(len(messages(events)), 2)

    def test_offsets_are_absolute(self):
        s1, s2 = p.build_v1(1, "a", "x"), p.build_v1(2, "b", "y")
        events = decode_all(s1 + s2)
        self.assertEqual([m.offset for m in messages(events)], [0, len(s1)])


class CompatTests(unittest.TestCase):
    def test_v1_and_v2_unify(self):
        events = decode_all(p.build_v1(1, "a", "hello")
                            + p.build_v2(1, "a", "hello"))
        m1, m2 = [m.message for m in messages(events)]
        self.assertEqual((m1.msg_id, m1.sender, m1.body), (1, "a", "hello"))
        self.assertEqual((m2.msg_id, m2.sender, m2.body), (1, "a", "hello"))
        self.assertEqual((m1.priority, m1.sent_at), (0, 0))
        self.assertEqual((m2.priority, m2.sent_at), (0, 0))

    def test_v2_missing_optionals_get_defaults(self):
        events = decode_all(p.build_v2(1, "a", "x"))
        (msg,) = messages(events)
        self.assertEqual((msg.message.priority, msg.message.sent_at), (0, 0))
        self.assertTrue(any("default" in n for n in msg.notes))

    def test_unknown_extension_ignored_with_note(self):
        events = decode_all(p.build_v2(1, "a", "x", extra=p.field_bytes(0x80, b"zz")))
        (msg,) = messages(events)
        self.assertEqual(msg.message.msg_id, 1)
        self.assertTrue(any("unknown extension field 128" in n for n in msg.notes))

    def test_v1_path_ignores_v2_fields_and_warns(self):
        events = decode_all(p.build_v1(1, "a", "x", extra=p.field_u32(p.F_PRIORITY, 7)))
        (msg,) = messages(events)
        self.assertEqual(msg.message.priority, 0)  # v1 path does not surface it
        self.assertTrue(any(d.code == "STRUCTURE_MISMATCH" for d in diags(events)))


class DiagnosticTests(unittest.TestCase):
    def test_unknown_version_located_and_skipped(self):
        good = p.build_v1(1, "a", "x")
        bad = p.frame(0x09, p.field_u32(p.F_MSG_ID, 2))
        events = decode_all(good + bad + good)
        self.assertEqual(len(messages(events)), 2)
        (d,) = [d for d in diags(events) if d.code == "UNKNOWN_VERSION"]
        self.assertEqual(d.offset, len(good))

    def test_duplicate_field_discards_message_stream_continues(self):
        dup = p.frame(p.V1, p.field_u32(1, 5) + p.field_u32(1, 5)
                      + p.field_str(2, "a") + p.field_str(3, "b"))
        events = decode_all(dup + p.build_v1(9, "ok", "fine"))
        self.assertEqual([m.message.msg_id for m in messages(events)], [9])
        self.assertTrue(any(d.code == "DUPLICATE_FIELD" for d in diags(events)))

    def test_truncated_field_discards_message(self):
        bad = p.frame(p.V1, p.field_u32(1, 1)
                      + struct.pack(">BBH", 2, p.T_STR, 50) + b"short")
        events = decode_all(bad + p.build_v2(2, "b", "ok"))
        self.assertEqual([m.message.msg_id for m in messages(events)], [2])
        self.assertTrue(any(d.code == "TRUNCATED_FIELD" for d in diags(events)))

    def test_illegal_length_resyncs(self):
        junk = p.MAGIC + struct.pack(">BI", p.V1, p.MAX_PAYLOAD + 1) + b"junk"
        events = decode_all(junk + p.build_v1(3, "c", "recovered"))
        self.assertEqual([m.message.msg_id for m in messages(events)], [3])
        self.assertTrue(any(d.code == "BAD_LENGTH" for d in diags(events)))

    def test_garbage_between_frames(self):
        events = decode_all(p.build_v1(1, "a", "x") + b"\x01\x02noise"
                            + p.build_v1(2, "b", "y"))
        self.assertEqual(len(messages(events)), 2)
        self.assertTrue(any(d.code == "RESYNC" for d in diags(events)))

    def test_truncated_stream_tail_reported_on_finish(self):
        dec = StreamDecoder()
        dec.feed(p.build_v1(1, "a", "x") + p.MAGIC + b"\x01")
        events = dec.finish()
        self.assertTrue(any(isinstance(e, Diagnostic) and e.code == "TRUNCATED_FRAME"
                            for e in events))

    def test_missing_required_field(self):
        bad = p.frame(p.V2, p.field_u32(1, 1) + p.field_str(2, "a"))  # no body
        events = decode_all(bad)
        self.assertEqual(messages(events), [])
        self.assertTrue(any(d.code == "MISSING_FIELD" for d in diags(events)))

    def test_type_mismatch(self):
        bad = p.frame(p.V1, p.field_str(1, "not-a-u32")
                      + p.field_str(2, "a") + p.field_str(3, "b"))
        events = decode_all(bad)
        self.assertEqual(messages(events), [])
        self.assertTrue(any(d.code == "TYPE_MISMATCH" for d in diags(events)))


if __name__ == "__main__":
    unittest.main()
