"""Unit tests for the persistent B+tree index package.

Run with::

    python -m unittest -v test_btree_index

Coverage: split, merge, key borrowing/redistribution, range scans, page
checksums, manifest recovery, WAL replay (including torn tails), crash
recovery, input validation, the debug APIs and the command line entry point.
"""
from __future__ import annotations

import io
import json
import os
import random
import shutil
import tempfile
import unittest

from btree_index import (
    BTreeIndex,
    ChecksumMismatchError,
    InvalidKeyError,
    InvalidPageSizeError,
    InvalidValueError,
    MAX_KEY_BYTES,
    MAX_VALUE_BYTES,
    MIN_PAGE_SIZE,
    Page,
    RecoveryError,
    WAL,
    compute_checksum,
)
import main as cli

TINY_PAGE = 256


class _TempDirTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp(prefix="btree-test-")
        self.path = os.path.join(self.dir, "db")
        self._handles: list[BTreeIndex] = []

    def tearDown(self) -> None:
        for handle in self._handles:
            handle.close()
        shutil.rmtree(self.dir, ignore_errors=True)

    def open(self, page_size: int = TINY_PAGE) -> BTreeIndex:
        idx = BTreeIndex(self.path, page_size=page_size)
        self._handles.append(idx)
        return idx

    def reopen(self, page_size: int = TINY_PAGE) -> BTreeIndex:
        idx = BTreeIndex(self.path, page_size=page_size)
        self._handles.append(idx)
        return idx


# --------------------------------------------------------------------- basics
class TestBasicOperations(_TempDirTestCase):
    def test_empty_tree(self) -> None:
        idx = self.open()
        self.assertIsNone(idx.get("a"))
        self.assertEqual(idx.scan(), [])
        self.assertFalse(idx.delete("a"))
        stats = idx.stats()
        self.assertEqual(stats["leaf_pages"], 1)
        self.assertEqual(stats["inner_pages"], 0)
        self.assertEqual(stats["height"], 0)
        self.assertEqual(stats["page_count"], 1)

    def test_single_key_and_empty_value(self) -> None:
        idx = self.open()
        idx.put("k", "")
        self.assertEqual(idx.get("k"), "")
        self.assertEqual(idx.scan(), [("k", "")])
        self.assertTrue(idx.delete("k"))
        self.assertIsNone(idx.get("k"))

    def test_overwrite_returns_new_value(self) -> None:
        idx = self.open()
        idx.put("k", "v1")
        idx.put("k", "v2")
        self.assertEqual(idx.get("k"), "v2")
        self.assertEqual([k for k, _ in idx.scan()], ["k"])

    def test_delete_missing_is_noop(self) -> None:
        idx = self.open()
        idx.put("a", "1")
        self.assertFalse(idx.delete("b"))
        self.assertEqual(idx.scan(), [("a", "1")])

    def test_unicode_keys_and_values(self) -> None:
        idx = self.open(page_size=512)
        pairs = [("键" + str(i), "值" + str(i)) for i in range(50)]
        for k, v in pairs:
            idx.put(k, v)
        self.assertEqual(idx.scan(), sorted(pairs))

    def test_stats_and_dump_sorted(self) -> None:
        idx = self.open()
        for i in range(40):
            idx.put(f"k{i:03d}", "v")
        stats = idx.stats()
        self.assertGreater(stats["height"], 1)
        self.assertEqual(stats["leaf_pages"] + stats["inner_pages"], stats["page_count"])
        self.assertGreater(stats["used_bytes"], 0)
        dump = idx.dump()
        ids = [p["page_id"] for p in dump["pages"]]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(dump["root_id"], stats["root_id"])


# ----------------------------------------------------------------- validation
class TestValidation(_TempDirTestCase):
    def test_key_constraints(self) -> None:
        idx = self.open()
        with self.assertRaises(InvalidKeyError):
            idx.put("", "v")
        with self.assertRaises(InvalidKeyError):
            idx.put(b"bytes", "v")  # type: ignore[arg-type]
        with self.assertRaises(InvalidKeyError):
            idx.put("x" * (MAX_KEY_BYTES + 1), "v")
        with self.assertRaises(InvalidKeyError):
            idx.get("")
        # A 256-byte UTF-8 key is allowed.
        key = "é" * 128  # 2 bytes each
        idx.put(key, "ok")
        self.assertEqual(idx.get(key), "ok")

    def test_value_constraints(self) -> None:
        idx = self.open()
        idx.put("k", "x" * MAX_VALUE_BYTES)
        self.assertEqual(len(idx.get("k")), MAX_VALUE_BYTES)
        with self.assertRaises(InvalidValueError):
            idx.put("k", "x" * (MAX_VALUE_BYTES + 1))
        with self.assertRaises(InvalidValueError):
            idx.put("k", 123)  # type: ignore[arg-type]

    def test_page_size_limits(self) -> None:
        with self.assertRaises(InvalidPageSizeError):
            BTreeIndex(os.path.join(self.dir, "small"), page_size=MIN_PAGE_SIZE - 1)
        with self.assertRaises(InvalidPageSizeError):
            BTreeIndex(os.path.join(self.dir, "small"), page_size=10)


# ------------------------------------------------------------- structure/split
class TestSplitsAndStructure(_TempDirTestCase):
    def _seed(self, n: int, page_size: int = TINY_PAGE, val_len: int = 20):
        idx = self.open(page_size=page_size)
        keys = [f"key-{i:06d}" for i in range(n)]
        random.Random(1234).shuffle(keys)
        for k in keys:
            idx.put(k, "v" * val_len + k)
        return idx, keys

    def test_many_splits_stay_consistent(self) -> None:
        n = 1500
        idx, keys = self._seed(n)
        self.assertGreater(idx.stats()["height"], 2)
        expected = sorted(keys)
        self.assertEqual([k for k, _ in idx.scan()], expected)
        for k in expected:
            self.assertEqual(idx.get(k), "v" * 20 + k)
        for missing in ("key-999999", "aaa", "zzz"):
            self.assertIsNone(idx.get(missing))

    def test_leaf_chain_is_complete_and_sorted(self) -> None:
        idx, keys = self._seed(600)
        leaves = [p for p in idx.pages.values() if p.is_leaf]
        self.assertGreater(len(leaves), 2)
        # Walk the chain from the leftmost leaf.
        page = idx.root
        while not page.is_leaf:
            page = idx.pages[page.children[0]]
        seen = []
        while page is not None:
            seen.append(page.page_id)
            page = idx.pages[page.next_leaf] if page.next_leaf else None
        self.assertEqual(sorted(seen), sorted(p.page_id for p in leaves))
        chain_keys = [k for pid in seen for k, _ in idx.pages[pid].items]
        self.assertEqual(chain_keys, sorted(chain_keys))

    def test_parent_pointers_are_consistent(self) -> None:
        idx, _ = self._seed(800)
        for page in idx.pages.values():
            if page.page_id == idx.root_id:
                self.assertIsNone(page.parent)
            else:
                self.assertIsNotNone(page.parent)
                self.assertIn(page.page_id, idx.pages[page.parent].children)

    def test_persistence_and_reopen(self) -> None:
        idx, keys = self._seed(1000)
        idx.checkpoint()
        idx.close()
        idx2 = self.reopen()
        self.assertEqual([k for k, _ in idx2.scan()], sorted(keys))

    def test_default_page_size_scale(self) -> None:
        # A few thousand keys at the default 4 KiB page size exercises the
        # normal (non-tiny) fan-out path.
        idx = self.open(page_size=4096)
        keys = [f"item/{i:06d}" for i in range(4000)]
        random.Random(1).shuffle(keys)
        for k in keys:
            idx.put(k, "v" * 100)
        self.assertLessEqual(idx.stats()["height"], 3)
        self.assertEqual(len(idx.scan()), len(keys))
        for k in keys[::137]:
            self.assertEqual(idx.get(k), "v" * 100)

    def test_oversized_value_forces_multiway_split(self) -> None:
        # A value much larger than the page must still be storable.
        idx = self.open(page_size=256)
        idx.put("big", "X" * 5000)
        idx.put("a", "1")
        idx.put("z", "2")
        idx.put("m", "3")
        self.assertEqual(idx.get("big"), "X" * 5000)
        self.assertEqual([k for k, _ in idx.scan()], ["a", "big", "m", "z"])
        idx.checkpoint()
        idx.close()
        idx2 = self.reopen()
        self.assertEqual(idx2.get("big"), "X" * 5000)
        self.assertEqual([k for k, _ in idx2.scan()], ["a", "big", "m", "z"])


# ------------------------------------------------------------ scans / merging
class TestScanMergeBorrow(_TempDirTestCase):
    def _build(self, n: int = 900, page_size: int = TINY_PAGE):
        idx = self.open(page_size=page_size)
        keys = [f"k{i:05d}" for i in range(n)]
        random.Random(99).shuffle(keys)
        for k in keys:
            idx.put(k, "value-" + k)
        return idx, keys

    def test_range_scan_bounds(self) -> None:
        idx, _ = self._build(400)
        all_keys = [f"k{i:05d}" for i in range(400)]
        self.assertEqual([k for k, _ in idx.scan("k00010", "k00020")],
                         [f"k{i:05d}" for i in range(10, 20)])
        self.assertEqual(idx.scan("k00010", "k00010"), [])
        self.assertEqual([k for k, _ in idx.scan(end="k00003")], all_keys[:3])
        self.assertEqual([k for k, _ in idx.scan(start="k00397")], all_keys[397:])
        self.assertEqual([k for k, _ in idx.scan()], all_keys)
        self.assertEqual(idx.scan("z", "a"), [])

    def test_delete_most_triggers_merges_and_borrows(self) -> None:
        n = 1200
        idx, keys = self._build(n)
        tall_height = idx.stats()["height"]
        self.assertGreater(tall_height, 2)
        survivors = set(keys[::17])  # keep ~1/17 -> aggressive merging
        for k in keys:
            if k not in survivors:
                self.assertTrue(idx.delete(k))
        self.assertEqual([k for k, _ in idx.scan()], sorted(survivors))
        # Deleting again must be a no-op.
        for k in keys:
            if k not in survivors:
                self.assertFalse(idx.delete(k))
        self.assertLess(idx.stats()["height"], tall_height)
        # Tree must reopen cleanly after merges (structural validation runs).
        idx.checkpoint()
        idx.close()
        idx2 = self.reopen()
        self.assertEqual([k for k, _ in idx2.scan()], sorted(survivors))

    def test_delete_everything_collapses_to_empty_root(self) -> None:
        idx, keys = self._build(700)
        random.Random(5).shuffle(keys)
        for k in keys:
            self.assertTrue(idx.delete(k))
        self.assertEqual(idx.scan(), [])
        self.assertIsNone(idx.get(keys[0]))
        stats = idx.stats()
        self.assertEqual(stats["leaf_pages"], 1)
        self.assertEqual(stats["inner_pages"], 0)
        self.assertTrue(idx.root.is_leaf)
        idx.checkpoint()
        idx.close()
        idx2 = self.reopen()
        self.assertEqual(idx2.scan(), [])
        # Reuse the collapsed tree.
        for i in range(300):
            idx2.put(f"again-{i:04d}", "v")
        self.assertEqual(len(idx2.scan()), 300)

    def test_interleaved_updates_and_deletes(self) -> None:
        idx = self.open(page_size=256)
        ref = {}
        rng = random.Random(2024)
        keys = [f"item-{i:04d}" for i in range(250)]
        for step in range(3000):
            k = rng.choice(keys)
            if rng.random() < 0.65:
                v = "x" * rng.randint(0, 50)
                idx.put(k, v)
                ref[k] = v
            else:
                self.assertEqual(idx.delete(k), k in ref)
                ref.pop(k, None)
            if step % 300 == 0:
                self.assertEqual(idx.scan(), sorted(ref.items()))
        self.assertEqual(idx.scan(), sorted(ref.items()))


# ------------------------------------------------------------- checksum/page io
class TestChecksums(_TempDirTestCase):
    def test_page_round_trip(self) -> None:
        page = Page(page_id="p-1", is_leaf=False)
        page.keys = ["b"]
        page.children = ["p-0", "p-2"]
        data = page.to_bytes()
        parsed = Page.from_bytes(data)
        self.assertEqual(parsed.keys, ["b"])
        self.assertEqual(parsed.children, ["p-0", "p-2"])
        self.assertFalse(parsed.is_leaf)

    def test_short_image_raises(self) -> None:
        with self.assertRaises(ValueError):
            Page.from_bytes(b"short")

    def test_checksum_function_is_stable(self) -> None:
        self.assertEqual(len(compute_checksum(b"abc")), 8)
        self.assertEqual(compute_checksum(b"abc"), compute_checksum(b"abc"))
        self.assertNotEqual(compute_checksum(b"abc"), compute_checksum(b"abd"))

    def test_corrupted_page_raises_with_page_id(self) -> None:
        idx = self.open()
        for i in range(60):
            idx.put(f"k{i:03d}", "v" * 30)
        idx.checkpoint()
        idx.close()
        target = sorted(
            n for n in os.listdir(self.path) if n.startswith("p-")
        )[5]
        page_file = os.path.join(self.path, target)
        with open(page_file, "r+b") as fh:
            fh.seek(-5, os.SEEK_END)
            fh.write(b"\xff\xff\xff\xff\xff")
        with self.assertRaises(ChecksumMismatchError) as ctx:
            self.reopen()
        self.assertEqual(ctx.exception.page_id, target)
        self.assertIn(target, str(ctx.exception))

    def test_corrupted_manifest_raises(self) -> None:
        idx = self.open()
        idx.put("a", "b")
        idx.checkpoint()
        idx.close()
        manifest = os.path.join(self.path, "manifest.json")
        with open(manifest, "r+b") as fh:
            fh.seek(10)
            fh.write(b"@@@@")
        with self.assertRaises(ChecksumMismatchError) as ctx:
            self.reopen()
        self.assertEqual(ctx.exception.page_id, "manifest")


# ------------------------------------------------------------------ WAL tests
class TestWAL(_TempDirTestCase):
    wal_path = None  # type: ignore[assignment]

    def wal_file(self, name: str = "wal.log") -> str:
        return os.path.join(self.dir, name)

    def test_append_and_read(self) -> None:
        path = self.wal_file()
        wal = WAL(path)
        wal.append("put", "a", "1")
        wal.append("delete", "a")
        wal.close()
        records = WAL.read_records(path)
        self.assertEqual([(r.op, r.key) for r in records],
                         [("put", "a"), ("delete", "a")])
        self.assertEqual(records[0].value, "1")

    def test_torn_tail_is_skipped(self) -> None:
        path = self.wal_file()
        wal = WAL(path)
        wal.append("put", "a", "1")
        wal.append("put", "b", "2")
        wal.close()
        with open(path, "ab") as fh:
            fh.write(b'{"op": "put", "key": "c", "val')  # torn, no newline
        records = WAL.read_records(path)
        self.assertEqual([r.key for r in records], ["a", "b"])

    def test_garbage_line_stops_replay(self) -> None:
        path = self.wal_file()
        with open(path, "wb") as fh:
            fh.write(b'{"op":"put","key":"a","value":"1","ts":1}\n')
            fh.write(b"not json at all\n")
            fh.write(b'{"op":"put","key":"b","value":"2","ts":2}\n')
        records = WAL.read_records(path)
        self.assertEqual([r.key for r in records], ["a"])

    def test_open_truncates_torn_tail(self) -> None:
        path = self.wal_file()
        wal = WAL(path)
        wal.append("put", "a", "1")
        wal.close()
        with open(path, "ab") as fh:
            fh.write(b'{"op": "delete", "key": "par')
        wal = WAL(path)  # must trim the torn tail
        wal.append("put", "b", "2")
        wal.close()
        records = WAL.read_records(path)
        self.assertEqual([(r.op, r.key) for r in records],
                         [("put", "a"), ("put", "b")])

    def test_truncate_clears_log(self) -> None:
        path = self.wal_file()
        wal = WAL(path)
        wal.append("put", "a", "1")
        wal.truncate()
        wal.close()
        self.assertEqual(WAL.read_records(path), [])


# ------------------------------------------------------------- crash recovery
class TestCrashRecovery(_TempDirTestCase):
    def test_replay_without_checkpoint(self) -> None:
        idx = self.open()
        for i in range(200):
            idx.put(f"k{i:04d}", "v" * 20)
        idx.put("extra", "last")
        # Simulate a crash: close without save/checkpoint.
        idx.close()
        idx2 = self.reopen()
        self.assertEqual(idx2.get("extra"), "last")
        self.assertEqual(len(idx2.scan()), 201)

    def test_replay_delete(self) -> None:
        idx = self.open()
        for i in range(100):
            idx.put(f"k{i:05d}", "v")
        idx.checkpoint()
        for i in range(0, 100, 2):
            idx.delete(f"k{i:05d}")
        idx.close()
        idx2 = self.reopen()
        self.assertEqual(len(idx2.scan()), 50)
        self.assertIsNone(idx2.get("k00000"))
        self.assertEqual(idx2.get("k00001"), "v")

    def test_replay_is_idempotent(self) -> None:
        idx = self.open()
        idx.put("a", "1")
        idx.put("b", "2")
        idx.close()
        for _ in range(3):
            idx2 = self.reopen()
            self.assertEqual(idx2.scan(), [("a", "1"), ("b", "2")])
            idx2.close()

    def test_partial_wal_after_crash_is_ignored(self) -> None:
        idx = self.open()
        for i in range(120):
            idx.put(f"k{i:04d}", "v")
        idx.checkpoint()
        idx.put("committed", "yes")
        idx.close()
        # Append a torn record (simulating a crash mid-append).
        with open(os.path.join(self.path, "wal.log"), "ab") as fh:
            fh.write(b'{"op":"put","key":"los')
        idx2 = self.reopen()
        self.assertEqual(idx2.get("committed"), "yes")
        self.assertIsNone(idx2.get("lost"))

    def test_brand_new_tree_wal_only_crash(self) -> None:
        # Crash on the very first writes, before any checkpoint: pages never
        # existed, so replay on top of an empty root recreates everything.
        idx = self.open()
        idx.put("alpha", "1")
        idx.put("beta", "2")
        idx.close()
        # Remove page files/manifest but keep the WAL to emulate the window.
        for name in os.listdir(self.path):
            if name != "wal.log":
                os.remove(os.path.join(self.path, name))
        idx2 = self.reopen()
        self.assertEqual(idx2.get("alpha"), "1")
        self.assertEqual(idx2.get("beta"), "2")

    def test_manifest_missing_rebuilds_by_scanning(self) -> None:
        idx = self.open()
        for i in range(300):
            idx.put(f"k{i:05d}", "v" * 20)
        idx.checkpoint()
        idx.close()
        os.remove(os.path.join(self.path, "manifest.json"))
        idx2 = self.reopen()
        self.assertEqual(len(idx2.scan()), 300)
        self.assertEqual(idx2.get("k00123"), "v" * 20)
        idx2.checkpoint()  # a new manifest is written

    def test_missing_page_file_reported(self) -> None:
        idx = self.open()
        for i in range(60):
            idx.put(f"k{i:03d}", "v")
        idx.checkpoint()
        idx.close()
        victim = sorted(n for n in os.listdir(self.path) if n.startswith("p-"))[0]
        os.remove(os.path.join(self.path, victim))
        with self.assertRaises(RecoveryError):
            self.reopen()

    def test_repeated_crash_loops(self) -> None:
        idx = self.open(page_size=320)
        ref = {}
        rng = random.Random(77)
        keys = [f"k{i:04d}" for i in range(400)]
        for step in range(600):
            k = rng.choice(keys)
            if rng.random() < 0.7:
                v = "x" * rng.randint(0, 40)
                idx.put(k, v)
                ref[k] = v
            else:
                idx.delete(k)
                ref.pop(k, None)
            if step % 25 == 0:
                idx.close()  # crash: no checkpoint
                idx = self.reopen(page_size=320)
                self.assertEqual(idx.scan(), sorted(ref.items()))
        idx.close()

    def test_crash_during_checkpoint_rolls_back(self) -> None:
        idx = self.open(page_size=320)
        for i in range(500):
            idx.put(f"k{i:05d}", "v" * 30)
        idx.checkpoint()
        # New uncommitted batch, then a checkpoint that dies mid-write.
        for i in range(500, 700):
            idx.put(f"k{i:05d}", "w" * 30)
        for i in range(0, 100):
            idx.delete(f"k{i:05d}")

        calls = {"n": 0}
        real_write_page = BTreeIndex._write_page

        def failing_write(self, page):  # noqa: ANN001
            calls["n"] += 1
            if calls["n"] == 7:
                raise OSError("simulated crash during checkpoint")
            return real_write_page(self, page)

        BTreeIndex._write_page = failing_write  # type: ignore[assignment]
        try:
            with self.assertRaises(OSError):
                idx.checkpoint()
        finally:
            BTreeIndex._write_page = real_write_page  # type: ignore[assignment]
        idx.wal.close()

        # Reopen must roll the partial checkpoint back and replay the WAL,
        # recreating every committed put/delete.
        idx2 = self.reopen(page_size=320)
        expected = [(f"k{i:05d}", "v" * 30) for i in range(100, 500)]
        expected += [(f"k{i:05d}", "w" * 30) for i in range(500, 700)]
        self.assertEqual(idx2.scan(), sorted(expected))
        self.assertFalse(os.path.exists(os.path.join(self.path, "journal.dat")))

    def test_torn_journal_is_handled(self) -> None:
        idx = self.open()
        for i in range(80):
            idx.put(f"k{i:04d}", "v")
        idx.checkpoint()
        idx.close()
        # A zero-length or truncated journal looks like a crash mid-journal;
        # reopening must not raise and the committed state must survive.
        journal = os.path.join(self.path, "journal.dat")
        with open(journal, "wb") as fh:
            fh.write(b"BTJR")
            fh.write((5).to_bytes(4, "little"))
            fh.write(b"partial")
        idx2 = self.reopen()
        self.assertEqual(len(idx2.scan()), 80)


# ------------------------------------------------------------------ CLI tests
class TestCLI(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.mkdtemp(prefix="btree-cli-")
        self.path = os.path.join(self.dir, "db")

    def tearDown(self) -> None:
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_cli(self, commands: list[dict]) -> list[dict]:
        stdin = io.StringIO("\n".join(json.dumps(c) for c in commands) + "\n")
        stdout = io.StringIO()
        code = cli.run(["--dir", self.path, "--page-size", "256"],
                       stdin=stdin, stdout=stdout)
        self.assertEqual(code, 0)
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_command_round_trip(self) -> None:
        results = self.run_cli([
            {"op": "stats"},
            {"op": "put", "key": "a", "value": "1"},
            {"op": "put", "key": "b", "value": "2"},
            {"op": "put", "key": "a", "value": "3"},
            {"op": "get", "key": "a"},
            {"op": "get", "key": "missing"},
            {"op": "delete", "key": "b"},
            {"op": "delete", "key": "b"},
            {"op": "scan"},
            {"op": "checkpoint"},
            {"op": "stats"},
            {"op": "dump"},
        ])
        self.assertIn("height", results[0])
        self.assertTrue(all(r.get("ok") for r in results[1:3]))
        self.assertEqual(results[4], {"key": "a", "found": True, "value": "3"})
        self.assertEqual(results[5]["found"], False)
        self.assertTrue(results[6]["deleted"])
        self.assertFalse(results[7]["deleted"])
        self.assertEqual(results[8]["pairs"], [["a", "3"]])
        self.assertIn("pages", results[11])

    def test_errors_are_json(self) -> None:
        results = self.run_cli([
            {"op": "get"},  # missing key field
            {"op": "put", "key": "", "value": "x"},
            {"op": "frobnicate"},
            "this is not json",
        ])
        for result in results:
            self.assertIn("error", result)

    def test_load_recovers_wal(self) -> None:
        results = self.run_cli([
            {"op": "put", "key": "k", "value": "v"},
            {"op": "load"},
            {"op": "get", "key": "k"},
        ])
        self.assertTrue(results[1]["ok"])
        self.assertEqual(results[2]["value"], "v")


if __name__ == "__main__":
    unittest.main(verbosity=2)
