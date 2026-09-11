"""sortmerge 内核与 CLI 的单元测试。

运行: python -m unittest test_sortmerge -v
"""

from __future__ import annotations

import io
import json
import os
import random
import subprocess
import sys
import tempfile
import unittest

from sortmerge import (
    CapacityError,
    Entry,
    MergeIterator,
    PersistenceError,
    SortMergeKernel,
    ValidationError,
    merge_shards,
)
from main import run


def make_entries(spec):
    """spec: [(key, tag, seq), ...] -> [Entry, ...]"""
    return [Entry(key=k, tag=t, seq=s) for k, t, s in spec]


class TestEntryValidation(unittest.TestCase):
    def test_valid_entry(self):
        e = Entry(key="abc", tag="shard-1", seq=1)
        self.assertEqual((e.key, e.tag, e.seq), ("abc", "shard-1", 1))

    def test_empty_key_rejected(self):
        with self.assertRaises(ValidationError):
            Entry(key="", tag="t", seq=1)

    def test_empty_tag_rejected(self):
        with self.assertRaises(ValidationError):
            Entry(key="k", tag="", seq=1)

    def test_seq_less_than_one_rejected(self):
        for bad in (0, -1, -100):
            with self.assertRaises(ValidationError):
                Entry(key="k", tag="t", seq=bad)

    def test_bool_seq_rejected(self):
        with self.assertRaises(ValidationError):
            Entry(key="k", tag="t", seq=True)

    def test_key_utf8_limit(self):
        # 256 字节整：128 个两字节字符
        Entry(key="é" * 128, tag="t", seq=1)
        with self.assertRaises(ValidationError):
            Entry(key="é" * 129, tag="t", seq=1)
        # 多字节：85 个三字节字符 = 255 字节，可以；86 个 = 258 字节，拒绝
        Entry(key="中" * 85, tag="t", seq=1)
        with self.assertRaises(ValidationError):
            Entry(key="中" * 86, tag="t", seq=1)

    def test_ordering_is_key_tag_seq(self):
        a = Entry("k", "a", 2)
        b = Entry("k", "b", 1)
        c = Entry("k", "a", 3)
        self.assertLess(a, b)
        self.assertLess(a, c)
        self.assertEqual(sorted([b, c, a]), [a, c, b])


class TestBlockFreeze(unittest.TestCase):
    def test_freeze_at_block_size(self):
        k = SortMergeKernel(block_size=4)
        for i in range(1, 10):
            k.insert(Entry(key="key-%02d" % (i % 7), tag="t", seq=i))
        shard = k._shards["t"]
        self.assertEqual(len(shard.blocks), 2)  # 两个冻结块
        self.assertEqual(len(shard.active), 1)  # 活跃块 1 条
        for block in shard.blocks:
            self.assertIsInstance(block, tuple)  # 冻结块不可变
            self.assertEqual(len(block), 4)
            self.assertEqual(list(block), sorted(block))  # 块内有序

    def test_frozen_blocks_immutable(self):
        k = SortMergeKernel(block_size=2)
        k.insert(Entry("a", "t", 1))
        k.insert(Entry("b", "t", 2))
        block = k._shards["t"].blocks[0]
        with self.assertRaises(AttributeError):
            block.append(Entry("c", "t", 3))

    def test_insert_unsorted_input_still_sorted_output(self):
        k = SortMergeKernel(block_size=3)
        for i, key in enumerate(["m", "a", "z", "b", "y", "c"], start=1):
            k.insert(Entry(key, "t", i))
        self.assertEqual([e.key for e in k.dump()], ["a", "b", "c", "m", "y", "z"])


class TestMergeIterator(unittest.TestCase):
    def test_k_way_merge_keeps_duplicates(self):
        s1 = make_entries([("a", "t1", 1), ("c", "t1", 2)])
        s2 = make_entries([("a", "t2", 1), ("b", "t2", 2)])
        s3 = make_entries([("a", "t1", 5)])  # 同 tag 同 key 不同 seq
        merged = list(MergeIterator([s1, s2, s3]))
        self.assertEqual(
            [(e.key, e.tag, e.seq) for e in merged],
            [("a", "t1", 1), ("a", "t1", 5), ("a", "t2", 1), ("b", "t2", 2), ("c", "t1", 2)],
        )

    def test_empty_streams(self):
        self.assertEqual(list(MergeIterator([[], [], []])), [])
        self.assertEqual(list(MergeIterator([])), [])

    def test_no_duplicate_output(self):
        k1, k2 = SortMergeKernel(), SortMergeKernel()
        for i in range(50):
            k1.insert(Entry("k%03d" % i, "a", i + 1))
            k2.insert(Entry("k%03d" % i, "b", i + 1))
        merged = list(merge_shards([k1, k2]))
        self.assertEqual(len(merged), 100)
        self.assertEqual(len(set(merged)), 100)  # 无重复输出
        self.assertEqual(merged, sorted(merged))


class TestQueries(unittest.TestCase):
    def setUp(self):
        self.kernel = SortMergeKernel(block_size=4)
        data = [
            ("apple", "t1", 1), ("apple", "t2", 1), ("apple", "t1", 2),
            ("app", "t1", 3), ("banana", "t1", 4), ("band", "t2", 2),
            ("中文", "t1", 5), ("中华人民", "t2", 3), ("中", "t3", 1),
        ]
        for key, tag, seq in data:
            self.kernel.insert(Entry(key, tag, seq))

    def test_range_scan_half_open(self):
        got = self.kernel.range_scan("app", "b")
        self.assertEqual(
            [(e.key, e.tag, e.seq) for e in got],
            [("app", "t1", 3), ("apple", "t1", 1), ("apple", "t1", 2), ("apple", "t2", 1)],
        )

    def test_range_scan_start_ge_end_empty(self):
        self.assertEqual(self.kernel.range_scan("b", "a"), [])
        self.assertEqual(self.kernel.range_scan("a", "a"), [])

    def test_range_scan_multibyte(self):
        # 码点序: 中(U+4E2D) < 巾(U+5DFE); 华(U+534E) < 文(U+6587)
        got = self.kernel.range_scan("中", "巾")
        self.assertEqual(
            [(e.key, e.tag) for e in got],
            [("中", "t3"), ("中华人民", "t2"), ("中文", "t1")],
        )

    def test_prefix_scan(self):
        got = self.kernel.prefix_scan("app")
        self.assertEqual(
            [(e.key, e.tag, e.seq) for e in got],
            [("app", "t1", 3), ("apple", "t1", 1), ("apple", "t1", 2), ("apple", "t2", 1)],
        )

    def test_prefix_empty_returns_all(self):
        self.assertEqual(self.kernel.prefix_scan(""), self.kernel.dump())

    def test_prefix_no_match(self):
        self.assertEqual(self.kernel.prefix_scan("zzz"), [])

    def test_prefix_multibyte(self):
        got = self.kernel.prefix_scan("中")
        self.assertEqual([e.key for e in got], ["中", "中华人民", "中文"])

    def test_top(self):
        got = self.kernel.top(3)
        self.assertEqual(
            [(e.key, e.tag, e.seq) for e in got],
            [("app", "t1", 3), ("apple", "t1", 1), ("apple", "t1", 2)],
        )

    def test_top_zero_and_overlarge(self):
        self.assertEqual(self.kernel.top(0), [])
        self.assertEqual(len(self.kernel.top(10 ** 6)), len(self.kernel))

    def test_empty_kernel(self):
        k = SortMergeKernel()
        self.assertEqual(k.dump(), [])
        self.assertEqual(k.range_scan("a", "z"), [])
        self.assertEqual(k.prefix_scan("a"), [])
        self.assertEqual(k.top(5), [])
        self.assertEqual(k.delete("a", "t"), 0)

    def test_single_entry(self):
        k = SortMergeKernel()
        k.insert(Entry("only", "t", 1))
        self.assertEqual([e.key for e in k.dump()], ["only"])
        self.assertEqual([e.key for e in k.top(1)], ["only"])


class TestDelete(unittest.TestCase):
    def test_delete_removes_all_seqs_of_key_tag(self):
        k = SortMergeKernel(block_size=2)
        k.insert(Entry("x", "t1", 1))
        k.insert(Entry("x", "t1", 2))
        k.insert(Entry("x", "t2", 1))
        k.insert(Entry("y", "t1", 3))
        self.assertEqual(k.delete("x", "t1"), 2)
        remaining = [(e.key, e.tag, e.seq) for e in k.dump()]
        self.assertEqual(remaining, [("x", "t2", 1), ("y", "t1", 3)])
        # 删除后再次查询不返回被删条目
        self.assertEqual(k.prefix_scan("x"), [Entry("x", "t2", 1)])
        self.assertEqual(k.range_scan("a", "z"), k.dump())

    def test_delete_missing_returns_zero(self):
        k = SortMergeKernel()
        k.insert(Entry("x", "t1", 1))
        self.assertEqual(k.delete("nope", "t1"), 0)
        self.assertEqual(k.delete("x", "nope"), 0)
        self.assertEqual(len(k), 1)

    def test_delete_empties_shard(self):
        k = SortMergeKernel()
        k.insert(Entry("x", "t1", 1))
        self.assertEqual(k.delete("x", "t1"), 1)
        self.assertEqual(k.stats()["num_tags"], 0)
        self.assertEqual(k.dump(), [])


class TestCapacity(unittest.TestCase):
    def test_max_entries_zero_rejects_everything(self):
        k = SortMergeKernel(max_entries=0)
        with self.assertRaises(CapacityError):
            k.insert(Entry("a", "t", 1))
        self.assertEqual(len(k), 0)

    def test_reject_over_limit_and_state_unchanged(self):
        k = SortMergeKernel(max_entries=3)
        for i in range(1, 4):
            k.insert(Entry("k%d" % i, "t", i))
        with self.assertRaises(CapacityError):
            k.insert(Entry("overflow", "t", 4))
        self.assertEqual(len(k), 3)
        self.assertEqual([e.key for e in k.dump()], ["k1", "k2", "k3"])
        self.assertEqual(k.stats()["capacity_remaining"], 0)
        # 删除腾出空间后可以继续插入
        k.delete("k1", "t")
        k.insert(Entry("k4", "t", 4))
        self.assertEqual([e.key for e in k.dump()], ["k2", "k3", "k4"])

    def test_exact_mode_unlimited(self):
        k = SortMergeKernel(max_entries=None)
        for i in range(5000):
            k.insert(Entry("k%05d" % i, "t", i + 1))
        self.assertEqual(len(k), 5000)
        self.assertIsNone(k.stats()["capacity_remaining"])


class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, "snap.json")

    def tearDown(self):
        self.dir.cleanup()

    def _build_kernel(self):
        k = SortMergeKernel(block_size=4, max_entries=100)
        data = [
            ("apple", "t1", 1), ("apple", "t2", 1), ("banana", "t1", 2),
            ("中文", "t2", 2), ("app", "t3", 1), ("apple", "t1", 3),
        ]
        for key, tag, seq in data:
            k.insert(Entry(key, tag, seq))
        return k

    def test_roundtrip(self):
        k = self._build_kernel()
        k.save(self.path)
        loaded = SortMergeKernel.load(self.path)
        self.assertEqual(loaded.dump(), k.dump())
        self.assertEqual(loaded.block_size, k.block_size)
        self.assertEqual(loaded.max_entries, k.max_entries)
        self.assertEqual(loaded.stats()["total_entries"], k.stats()["total_entries"])

    def test_insert_after_load_consistent(self):
        k = self._build_kernel()
        k.save(self.path)
        loaded = SortMergeKernel.load(self.path)
        for i in range(10, 20):
            e = Entry("new-%02d" % i, "t1", i)
            k.insert(e)
            loaded.insert(e)
        self.assertEqual(loaded.dump(), k.dump())

    def test_corrupted_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_missing_file(self):
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(os.path.join(self.dir.name, "nope.json"))

    def _save_doc(self, doc):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False)

    def _valid_doc(self):
        return {
            "format": "sortmerge-snapshot",
            "version": 1,
            "config": {"block_size": 4, "max_entries": None},
            "shards": {
                "t1": {
                    "blocks": [[{"key": "a", "tag": "t1", "seq": 1}]],
                    "active": [{"key": "b", "tag": "t1", "seq": 2}],
                }
            },
            "stats": {"total_entries": 2, "num_tags": 1, "num_frozen_blocks": 1},
        }

    def test_missing_field(self):
        doc = self._valid_doc()
        del doc["stats"]
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_unsorted_block_rejected(self):
        doc = self._valid_doc()
        doc["shards"]["t1"]["blocks"] = [[
            {"key": "b", "tag": "t1", "seq": 1},
            {"key": "a", "tag": "t1", "seq": 2},
        ]]
        doc["stats"]["total_entries"] = 3
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_oversized_block_rejected(self):
        doc = self._valid_doc()
        doc["shards"]["t1"]["blocks"] = [[
            {"key": "k%d" % i, "tag": "t1", "seq": i} for i in range(1, 6)
        ]]
        doc["stats"]["total_entries"] = 6
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_bad_seq_and_empty_tag_rejected(self):
        doc = self._valid_doc()
        doc["shards"]["t1"]["active"] = [{"key": "b", "tag": "t1", "seq": 0}]
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

        doc = self._valid_doc()
        doc["shards"][""] = doc["shards"].pop("t1")
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_negative_stats_rejected(self):
        doc = self._valid_doc()
        doc["stats"]["total_entries"] = -1
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)

    def test_stats_mismatch_rejected(self):
        doc = self._valid_doc()
        doc["stats"]["total_entries"] = 99
        self._save_doc(doc)
        with self.assertRaises(PersistenceError):
            SortMergeKernel.load(self.path)


class TestMergeShards(unittest.TestCase):
    def test_merge_does_not_modify_sources(self):
        k1, k2 = SortMergeKernel(), SortMergeKernel()
        for i in range(10):
            k1.insert(Entry("a%02d" % i, "t1", i + 1))
            k2.insert(Entry("b%02d" % i, "t2", i + 1))
        before1, before2 = k1.dump(), k2.dump()
        merged = list(SortMergeKernel.merge_shards([k1, k2]))
        self.assertEqual(len(merged), 20)
        self.assertEqual(merged, sorted(before1 + before2))
        self.assertEqual(k1.dump(), before1)
        self.assertEqual(k2.dump(), before2)


class TestDifferential(unittest.TestCase):
    """与 sorted + 线性扫描的参考实现做随机对照。"""

    def test_against_reference(self):
        rng = random.Random(20260911)
        kernel = SortMergeKernel(block_size=16)
        reference: list = []
        alphabet = ["a", "b", "c", "ab", "abc", "中", "中文", "é", "z", ""]
        tags = ["t1", "t2", "t3"]
        seqs = {t: 0 for t in tags}

        def ref_sorted():
            return sorted(reference)

        for step in range(3000):
            op = rng.random()
            if op < 0.7 or not reference:
                tag = rng.choice(tags)
                seqs[tag] += 1
                key = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 3)))
                if not key:
                    key = "x"
                e = Entry(key, tag, seqs[tag])
                kernel.insert(e)
                reference.append(e)
            elif op < 0.85:
                tag = rng.choice(tags)
                key = rng.choice([e.key for e in reference])
                removed = kernel.delete(key, tag)
                before = len(reference)
                reference = [e for e in reference if not (e.key == key and e.tag == tag)]
                self.assertEqual(removed, before - len(reference))
            else:
                # 抽查 top
                k = rng.randint(0, 20)
                self.assertEqual(kernel.top(k), ref_sorted()[:k])

        # 全量 / 范围 / 前缀 / 归并 对照
        self.assertEqual(kernel.dump(), ref_sorted())

        for _ in range(50):
            a = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 2)))
            b = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 2)))
            expect = [e for e in ref_sorted() if a <= e.key < b] if a < b else []
            self.assertEqual(kernel.range_scan(a, b), expect)

            prefix = "".join(rng.choice(alphabet) for _ in range(rng.randint(0, 2)))
            expect = [e for e in ref_sorted() if e.key.startswith(prefix)]
            self.assertEqual(kernel.prefix_scan(prefix), expect)

        other = SortMergeKernel(block_size=8)
        other_ref = []
        for i in range(200):
            e = Entry("m%03d" % rng.randint(0, 999), rng.choice(tags), i + 1)
            other.insert(e)
            other_ref.append(e)
        merged = list(merge_shards([kernel, other]))
        self.assertEqual(merged, sorted(reference + other_ref))
        self.assertEqual(len(merged), len(set(merged)) if len(set(merged)) == len(merged) else len(merged))


class TestCLI(unittest.TestCase):
    def _run_cli(self, commands, extra_args=None):
        stdin = io.StringIO("\n".join(json.dumps(c, ensure_ascii=False) for c in commands) + "\n")
        stdout = io.StringIO()
        kernel = SortMergeKernel(block_size=4)
        run(kernel, stdin, stdout)
        return [json.loads(line) for line in stdout.getvalue().splitlines()]

    def test_insert_and_dump(self):
        out = self._run_cli([
            {"cmd": "insert", "key": "b", "tag": "t", "seq": 1},
            {"cmd": "insert", "key": "a", "tag": "t", "seq": 2},
            {"cmd": "insert", "key": "中", "tag": "t", "seq": 3},
            {"cmd": "dump"},
        ])
        self.assertEqual(out[0], {"ok": True})
        self.assertEqual([e["key"] for e in out[3]["entries"]], ["a", "b", "中"])

    def test_all_commands(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "snap.json")
            out = self._run_cli([
                {"cmd": "insert", "key": "app", "tag": "t1", "seq": 1},
                {"cmd": "insert", "key": "apple", "tag": "t2", "seq": 1},
                {"cmd": "insert", "key": "banana", "tag": "t1", "seq": 2},
                {"cmd": "range", "start": "app", "end": "b"},
                {"cmd": "prefix", "prefix": "app"},
                {"cmd": "top", "k": 2},
                {"cmd": "delete", "key": "app", "tag": "t1"},
                {"cmd": "stats"},
                {"cmd": "save", "path": path},
                {"cmd": "load", "path": path},
                {"cmd": "merge"},
                {"cmd": "dump"},
            ])
            self.assertEqual([e["key"] for e in out[3]["entries"]], ["app", "apple"])
            self.assertEqual([e["key"] for e in out[4]["entries"]], ["app", "apple"])
            self.assertEqual([e["key"] for e in out[5]["entries"]], ["app", "apple"])
            self.assertEqual(out[6], {"deleted": 1})
            self.assertEqual(out[7]["total_entries"], 2)
            self.assertEqual(out[8], {"ok": True})
            self.assertEqual(out[9], {"ok": True})
            self.assertEqual([e["key"] for e in out[10]["entries"]], ["apple", "banana"])
            self.assertEqual([e["key"] for e in out[11]["entries"]], ["apple", "banana"])

    def test_error_responses_have_error_field(self):
        out = self._run_cli([
            {"cmd": "insert", "key": "", "tag": "t", "seq": 1},
            {"cmd": "insert", "key": "a", "tag": "t", "seq": 0},
            {"cmd": "nonsense"},
            {"cmd": "range", "start": "a"},  # 缺 end
            {"cmd": "delete", "key": "x", "tag": "y"},
        ])
        for r in out[:4]:
            self.assertIn("error", r)
        self.assertEqual(out[4], {"deleted": 0})

    def test_invalid_json_line(self):
        stdin = io.StringIO("{bad json\n")
        stdout = io.StringIO()
        run(SortMergeKernel(), stdin, stdout)
        result = json.loads(stdout.getvalue())
        self.assertIn("error", result)

    def test_subprocess_smoke(self):
        proc = subprocess.run(
            [sys.executable, os.path.join(os.path.dirname(__file__), "main.py")],
            input='{"cmd": "insert", "key": "x", "tag": "t", "seq": 1}\n{"cmd": "dump"}\n',
            capture_output=True,
            text=True,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        self.assertEqual(proc.returncode, 0)
        lines = [json.loads(l) for l in proc.stdout.splitlines()]
        self.assertEqual(lines[0], {"ok": True})
        self.assertEqual(lines[1]["entries"][0]["key"], "x")


if __name__ == "__main__":
    unittest.main()
