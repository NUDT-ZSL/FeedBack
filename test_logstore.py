"""Unit tests for logstore: rolling, sparse index, retention, compaction,
crash recovery, error handling and the CLI."""

import json
import os
import random
import subprocess
import sys
import tempfile
import unittest

from logstore import (IntegrityError, LogStore, LogStoreError, ManifestError,
                      SegmentNotFoundError, ValidationError)


def make_record(rid, ts, level="INFO", message=None, fields=None):
    return {
        "record_id": str(rid),
        "ts": ts,
        "level": level,
        "message": message if message is not None else f"message {rid}",
        "fields": fields if fields is not None else {"k": "v"},
    }


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = os.path.join(self.tmp.name, "store")

    def open_store(self, **kwargs):
        store = LogStore(self.dir, **kwargs)
        self.addCleanup(store.close)
        return store


class TestValidation(StoreTestCase):
    def test_rejects_bad_records(self):
        store = self.open_store()
        bad = [
            {},
            make_record("", 1),                                  # empty id
            make_record("a", 1.5),                               # non-int ts
            make_record("a", True),                              # bool ts
            make_record("a", 1, level=""),                       # empty level
            make_record("a", 1, message=""),                     # empty message
            make_record("a", 1, fields={"": "v"}),               # empty field key
            make_record("a", 1, fields={"k": ""}),               # empty field value
            make_record("a", 1, fields={"k": 1}),                # non-string value
        ]
        for record in bad:
            with self.assertRaises(ValidationError, msg=repr(record)):
                store.append([record])

    def test_batch_is_atomic(self):
        store = self.open_store()
        with self.assertRaises(ValidationError):
            store.append([make_record("ok", 1), make_record("", 2)])
        self.assertEqual(store.get_state()["total_records"], 0)

    def test_duplicate_record_id_rejected(self):
        store = self.open_store()
        store.append([make_record("a", 1)])
        with self.assertRaises(ValidationError):
            store.append([make_record("a", 2)])
        with self.assertRaises(ValidationError):
            store.append([make_record("b", 2), make_record("b", 3)])
        self.assertEqual(store.get_state()["total_records"], 1)

    def test_empty_append_is_noop(self):
        store = self.open_store()
        self.assertEqual(store.append([]), 0)
        self.assertEqual(store.get_state()["total_records"], 0)


class TestRolling(StoreTestCase):
    def test_rolls_when_full_and_seals_old_segments(self):
        store = self.open_store(max_segment_bytes=600, index_interval=2)
        for i in range(30):
            store.append([make_record(f"r{i}", i)])
        segments = store.list_segments()
        self.assertGreater(len(segments), 1)
        sealed = [s for s in segments if s["sealed"]]
        self.assertEqual(len(sealed), len(segments) - 1)
        active = [s for s in segments if s["active"]]
        self.assertEqual(len(active), 1)
        self.assertFalse(active[0]["sealed"])
        # Sealed segments have a separate index file; the active one does not.
        for seg in sealed:
            self.assertTrue(os.path.exists(
                os.path.join(self.dir, "index", seg["segment_id"] + ".idx")))
        self.assertFalse(os.path.exists(
            os.path.join(self.dir, "index", active[0]["segment_id"] + ".idx")))
        self.assertEqual(store.get_state()["total_records"], 30)

    def test_segment_limit_smaller_than_one_record(self):
        store = self.open_store(max_segment_bytes=1)
        store.append([make_record("a", 1), make_record("b", 2)])
        segments = [s for s in store.list_segments() if s["record_count"] > 0]
        self.assertEqual(len(segments), 2)  # each record gets its own segment
        self.assertEqual([r["record_id"] for r in store.query(0, 10)], ["a", "b"])

    def test_roll_persists_across_reopen(self):
        store = self.open_store(max_segment_bytes=600, index_interval=2)
        for i in range(20):
            store.append([make_record(f"r{i}", i)])
        store.close()
        store2 = self.open_store()
        self.assertEqual(store2.get_state()["total_records"], 20)
        self.assertEqual([r["record_id"] for r in store2.query(0, 100)],
                         [f"r{i}" for i in range(20)])


class TestQuery(StoreTestCase):
    def test_out_of_order_ts_sorted_results(self):
        store = self.open_store()
        ts_values = [5, 1, 9, 3, 7, 3, 1]
        store.append([make_record(f"r{i}", ts) for i, ts in enumerate(ts_values)])
        result = store.query(0, 100)
        keys = [(r["ts"], r["record_id"]) for r in result]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(result), len(ts_values))

    def test_range_is_half_open(self):
        store = self.open_store()
        store.append([make_record(f"r{i}", i) for i in range(10)])
        self.assertEqual([r["ts"] for r in store.query(3, 6)], [3, 4, 5])
        self.assertEqual(store.query(5, 5), [])
        self.assertEqual(store.query(8, 2), [])

    def test_level_and_keyword_filters(self):
        store = self.open_store()
        store.append([
            make_record("a", 1, level="INFO", message="hello world"),
            make_record("b", 2, level="ERROR", message="Hello again"),
            make_record("c", 3, level="INFO", message="goodbye"),
        ])
        self.assertEqual([r["record_id"] for r in store.query(0, 10, level="INFO")],
                         ["a", "c"])
        self.assertEqual(store.query(0, 10, level="DEBUG"), [])
        # keyword is case-sensitive substring on message
        self.assertEqual([r["record_id"] for r in store.query(0, 10, keyword="hello")],
                         ["a"])
        self.assertEqual([r["record_id"] for r in store.query(0, 10, keyword="Hello")],
                         ["b"])
        self.assertEqual(len(store.query(0, 10, keyword="")), 3)  # empty = no filter
        self.assertEqual([r["record_id"]
                          for r in store.query(0, 10, level="INFO", keyword="hello")],
                         ["a"])

    def test_limit(self):
        store = self.open_store()
        store.append([make_record(f"r{i}", i) for i in range(10)])
        self.assertEqual(len(store.query(0, 100, limit=4)), 4)
        self.assertEqual(store.query(0, 100, limit=0), [])
        with self.assertRaises(ValidationError):
            store.query(0, 100, limit=-1)

    def test_query_empty_store(self):
        store = self.open_store()
        self.assertEqual(store.query(0, 100), [])

    def test_sparse_index_matches_full_scan(self):
        # Force several sealed segments, then compare indexed queries against
        # a brute-force filter over dump() for many random ranges.
        store = self.open_store(max_segment_bytes=500, index_interval=3)
        rng = random.Random(42)
        records = [make_record(f"r{i:04d}", rng.randrange(0, 200),
                               level=rng.choice(["INFO", "ERROR"]),
                               message=f"payload {rng.randrange(50)}")
                   for i in range(300)]
        for i in range(0, len(records), 17):
            store.append(records[i:i + 17])
        self.assertGreater(len(store.list_segments()), 3)
        everything = store.dump()
        for _ in range(50):
            start = rng.randrange(0, 200)
            end = start + rng.randrange(0, 60)
            level = rng.choice([None, "INFO", "ERROR"])
            keyword = rng.choice([None, "payload 1", "payload 2", "zzz"])
            limit = rng.choice([None, 1, 7])
            expected = [r for r in everything
                        if start <= r["ts"] < end
                        and (level is None or r["level"] == level)
                        and (keyword is None or keyword in r["message"])]
            if limit is not None:
                expected = expected[:limit]
            self.assertEqual(store.query(start, end, level=level,
                                         keyword=keyword, limit=limit),
                             expected)


class TestRetention(StoreTestCase):
    def _filled_store(self, n=20, **kwargs):
        store = self.open_store(max_segment_bytes=400, index_interval=2, **kwargs)
        for i in range(n):
            store.append([make_record(f"r{i}", i)])
        return store

    def test_negative_policy_rejected(self):
        store = self.open_store()
        for kwargs in ({"max_age": -1}, {"max_segments": -2}, {"max_bytes": -5}):
            with self.assertRaises(ValidationError):
                store.register_retention(**kwargs)

    def test_max_segments_evicts_oldest_sealed(self):
        store = self._filled_store()
        store.register_retention(max_segments=2)
        evicted = store.enforce_retention()
        self.assertTrue(evicted)
        remaining = [s for s in store.list_segments() if s["sealed"]]
        self.assertEqual(len(remaining), 2)
        # Oldest segments (lowest start ts) were evicted.
        self.assertEqual([s["start_ts"] for s in remaining],
                         sorted(s["start_ts"] for s in remaining))
        for sid in evicted:
            self.assertFalse(os.path.exists(
                os.path.join(self.dir, "segments", sid + ".log")))
        self.assertEqual(store.get_state()["evicted_count"], len(evicted))

    def test_max_age_uses_logical_time(self):
        store = self._filled_store()
        store.register_retention(max_age=3)
        evicted = store.enforce_retention()
        self.assertTrue(evicted)
        for seg in store.list_segments():
            if seg["record_count"]:
                self.assertGreaterEqual(19 - seg["end_ts"], 0)
                self.assertLessEqual(19 - seg["end_ts"], 3)

    def test_max_bytes(self):
        store = self._filled_store()
        store.register_retention(max_bytes=1)
        evicted = store.enforce_retention()
        self.assertTrue(evicted)
        sealed_bytes = sum(s["byte_size"] for s in store.list_segments()
                           if s["sealed"])
        self.assertLessEqual(sealed_bytes, 1)

    def test_active_segment_never_evicted(self):
        store = self.open_store(max_segment_bytes=10**9)
        store.append([make_record(f"r{i}", i) for i in range(5)])
        store.register_retention(max_segments=0, max_bytes=0, max_age=0)
        evicted = store.enforce_retention()
        self.assertEqual(evicted, [])
        self.assertEqual(store.get_state()["total_records"], 5)

    def test_auto_enforce_on_append(self):
        store = self.open_store(max_segment_bytes=400, index_interval=2)
        store.register_retention(max_segments=1)
        for i in range(20):
            store.append([make_record(f"r{i}", i)])
        sealed = [s for s in store.list_segments() if s["sealed"]]
        self.assertLessEqual(len(sealed), 1)
        self.assertGreater(store.get_state()["evicted_count"], 0)

    def test_enforce_without_policy_is_noop(self):
        store = self._filled_store()
        self.assertEqual(store.enforce_retention(), [])


class TestCompaction(StoreTestCase):
    def test_compact_preserves_query_results(self):
        store = self.open_store(max_segment_bytes=500, index_interval=2)
        rng = random.Random(7)
        # Out-of-order ts so merged segments overlap in time.
        for i in range(60):
            store.append([make_record(f"r{i:03d}", rng.randrange(0, 40))])
        sealed = [s["segment_id"] for s in store.list_segments() if s["sealed"]]
        self.assertGreaterEqual(len(sealed), 2)
        before = store.dump()
        merged_count = sum(store.get_segment(s)["record_count"] for s in sealed[:2])
        new_id = store.compact(sealed[:2])
        self.assertEqual(store.dump(), before)
        self.assertEqual(store.query(0, 40), before)
        seg = store.get_segment(new_id)
        self.assertTrue(seg["sealed"])
        self.assertEqual(seg["record_count"], merged_count)
        for sid in sealed[:2]:
            with self.assertRaises(SegmentNotFoundError):
                store.get_segment(sid)

    def test_compact_rejects_active_and_unknown(self):
        store = self.open_store(max_segment_bytes=10**9)
        store.append([make_record("a", 1)])
        active = store.get_state()["active_segment_id"]
        with self.assertRaises(LogStoreError):
            store.compact([active])
        with self.assertRaises(SegmentNotFoundError):
            store.compact(["seg-999999"])
        with self.assertRaises(ValidationError):
            store.compact([])


class TestCrashRecovery(StoreTestCase):
    def _fill(self, n=25, **kwargs):
        store = self.open_store(max_segment_bytes=400, index_interval=2, **kwargs)
        for i in range(n):
            store.append([make_record(f"r{i}", i)])
        return store

    def test_reopen_validates_and_serves_queries(self):
        store = self._fill()
        before = store.dump()
        store.close()
        store2 = self.open_store()
        self.assertEqual(store2.dump(), before)

    def test_uncommitted_tail_truncated(self):
        store = self._fill()
        state = store.get_state()
        active = state["active_segment_id"]
        store.close()
        # Simulate a crash mid-append: garbage appended after the last commit.
        path = os.path.join(self.dir, "segments", active + ".log")
        with open(path, "ab") as fp:
            fp.write(b'{"record_id": "ghost", "ts": 999, "lev')  # partial line
        store2 = self.open_store()
        self.assertEqual(store2.get_state()["total_records"], state["total_records"])
        self.assertEqual(store2.query(900, 1000), [])

    def test_orphan_segment_file_discarded(self):
        store = self._fill()
        store.close()
        # Simulate a crash between creating a segment file and committing the
        # manifest: the file exists but the manifest does not know it.
        orphan = os.path.join(self.dir, "segments", "seg-999999.log")
        with open(orphan, "wb") as fp:
            fp.write(b'{"record_id":"x","ts":1,"level":"I","message":"m","fields":{}}\n')
        store2 = self.open_store()
        self.assertFalse(os.path.exists(orphan))
        self.assertEqual(store2.get_state()["total_records"], 25)

    def test_corrupt_manifest_raises(self):
        store = self._fill()
        store.close()
        with open(os.path.join(self.dir, "manifest.json"), "wb") as fp:
            fp.write(b"{not json")
        with self.assertRaises(ManifestError):
            LogStore(self.dir)

    def test_missing_manifest_with_data_raises(self):
        store = self._fill()
        store.close()
        os.remove(os.path.join(self.dir, "manifest.json"))
        with self.assertRaises(ManifestError):
            LogStore(self.dir)

    def test_tampered_segment_reports_segment_id(self):
        store = self._fill()
        sealed = [s["segment_id"] for s in store.list_segments() if s["sealed"]]
        store.close()
        path = os.path.join(self.dir, "segments", sealed[0] + ".log")
        with open(path, "ab") as fp:
            fp.write(b"x")  # change byte size of a sealed segment
        with self.assertRaises(IntegrityError) as ctx:
            LogStore(self.dir)
        self.assertIn(sealed[0], str(ctx.exception))

    def test_index_count_mismatch_raises(self):
        store = self._fill()
        sealed = [s["segment_id"] for s in store.list_segments() if s["sealed"]]
        store.close()
        path = os.path.join(self.dir, "index", sealed[0] + ".idx")
        with open(path, "a", encoding="utf-8") as fp:
            fp.write("[0, 0]\n")  # extra bogus entry
        with self.assertRaises(IntegrityError) as ctx:
            LogStore(self.dir)
        self.assertIn(sealed[0], str(ctx.exception))


class TestState(StoreTestCase):
    def test_state_and_listing(self):
        store = self.open_store(max_segment_bytes=500, index_interval=2)
        store.append([make_record(f"r{i}", i) for i in range(15)])
        store.register_retention(max_segments=100)
        state = store.get_state()
        self.assertEqual(state["total_records"], 15)
        self.assertEqual(state["segment_count"], len(store.list_segments()))
        self.assertIsNotNone(state["active_segment_id"])
        self.assertEqual(state["retention"]["max_segments"], 100)
        self.assertGreater(state["total_bytes"], 0)
        starts = [s["start_ts"] for s in store.list_segments()
                  if s["start_ts"] is not None]
        self.assertEqual(starts, sorted(starts))
        with self.assertRaises(SegmentNotFoundError):
            store.get_segment("nope")


class TestSaveLoad(StoreTestCase):
    def test_round_trip_preserves_queries(self):
        store = self.open_store(max_segment_bytes=500, index_interval=2)
        rng = random.Random(1)
        for i in range(50):
            store.append([make_record(f"r{i}", rng.randrange(0, 30))])
        store.register_retention(max_segments=50)
        before = store.dump()
        snapshot = os.path.join(self.tmp.name, "snap.json")
        store.save(snapshot)
        store.load(snapshot)
        self.assertEqual(store.dump(), before)
        self.assertEqual(store.query(0, 30), before)
        self.assertEqual(store.get_state()["retention"]["max_segments"], 50)
        # Store still works after load.
        store.append([make_record("new", 100)])
        self.assertEqual(store.query(100, 101)[0]["record_id"], "new")


class TestScale(StoreTestCase):
    def test_many_records_rolling_eviction_compaction(self):
        store = self.open_store(max_segment_bytes=8192, index_interval=16)
        rng = random.Random(2026)
        store.register_retention(max_segments=30)
        total = 0
        for batch in range(200):
            records = [make_record(f"id-{total + j}", rng.randrange(0, 100000))
                       for j in range(50)]
            total += len(records)
            store.append(records)
        state = store.get_state()
        self.assertGreater(state["evicted_count"], 0)
        live = store.dump()
        self.assertEqual(len(live), state["total_records"])
        # Compact half the sealed segments; results must not change.
        sealed = [s["segment_id"] for s in store.list_segments() if s["sealed"]]
        if len(sealed) >= 2:
            store.compact(sealed[: len(sealed) // 2])
        self.assertEqual(store.dump(), live)
        # Reopen and verify recovery agrees.
        store.close()
        store2 = self.open_store()
        self.assertEqual(store2.dump(), live)


class TestCli(unittest.TestCase):
    def test_cli_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            store_dir = os.path.join(tmp, "store")
            commands = [
                {"cmd": "append", "records": [make_record("a", 1),
                                              make_record("b", 2, level="ERROR")]},
                {"cmd": "query", "start": 0, "end": 10},
                {"cmd": "query", "start": 0, "end": 10, "level": "ERROR"},
                {"cmd": "state"},
                {"cmd": "list"},
                {"cmd": "dump"},
                {"cmd": "append", "records": [make_record("a", 5)]},  # duplicate
                {"cmd": "bogus"},
                {"cmd": "segment", "segment_id": "nope"},
            ]
            proc = subprocess.run(
                [sys.executable, os.path.join(os.path.dirname(__file__), "main.py"),
                 store_dir],
                input="\n".join(json.dumps(c) for c in commands),
                capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            lines = [json.loads(l) for l in proc.stdout.strip().splitlines()]
            self.assertEqual(len(lines), len(commands))
            self.assertTrue(lines[0]["ok"])
            self.assertEqual([r["record_id"] for r in lines[1]["records"]], ["a", "b"])
            self.assertEqual([r["record_id"] for r in lines[2]["records"]], ["b"])
            self.assertEqual(lines[3]["total_records"], 2)
            self.assertEqual(len(lines[4]["segments"]), 1)
            self.assertEqual(len(lines[5]["records"]), 2)
            self.assertIn("error", lines[6])
            self.assertIn("error", lines[7])
            self.assertIn("error", lines[8])


if __name__ == "__main__":
    unittest.main()
