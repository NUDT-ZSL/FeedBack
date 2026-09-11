"""radix_index 内核与 main.py 命令行入口的单元测试。

运行方式::

    python -m unittest discover -v
"""

from __future__ import annotations

import json
import os
import random
import string
import subprocess
import sys
import tempfile
import unittest

from radix_index import (
    MAX_KEY_BYTES,
    CapacityError,
    Entry,
    EntryValidationError,
    RadixIndex,
    SnapshotError,
)

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN_PY = os.path.join(HERE, "main.py")


# ---------------------------------------------------------------------------
# 参考实现：sorted(dict) + 线性扫描，用于对照
# ---------------------------------------------------------------------------


class ReferenceModel:
    """基于内置 dict + sorted 线性扫描的参考实现。"""

    def __init__(self) -> None:
        self.data = {}  # (key, owner) -> value

    def insert(self, key, value, owner):
        overwritten = (key, owner) in self.data
        previous = self.data.get((key, owner))
        self.data[(key, owner)] = value
        return overwritten, previous

    def remove(self, key, owner):
        return self.data.pop((key, owner), None)

    def scan(self, prefix):
        items = [
            (key, owner, value)
            for (key, owner), value in self.data.items()
            if key.startswith(prefix)
        ]
        items.sort(key=lambda t: (t[0].encode("utf-8"), t[1]))
        return items

    def common(self, prefix):
        items = self.scan(prefix)
        if not items:
            return {
                "prefix": prefix,
                "lcp": "",
                "lcp_length": 0,
                "count": 0,
                "distinct_keys": 0,
                "owners": {},
            }
        keys = sorted({k for k, _, _ in items}, key=lambda k: k.encode("utf-8"))
        lcp = _lcp(keys[0], keys[-1])
        owners = {}
        for _, owner, _ in items:
            owners[owner] = owners.get(owner, 0) + 1
        return {
            "prefix": prefix,
            "lcp": lcp,
            "lcp_length": len(lcp),
            "count": len(items),
            "distinct_keys": len(keys),
            "owners": dict(sorted(owners.items())),
        }


def _lcp(a: str, b: str) -> str:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return a[:i]


def scan_as_tuples(index: RadixIndex, prefix: str):
    return [(e.key, e.owner, e.value) for e in index.prefix_scan(prefix)]


# ---------------------------------------------------------------------------
# 条目校验
# ---------------------------------------------------------------------------


class TestEntryValidation(unittest.TestCase):
    def test_empty_key_rejected(self):
        with self.assertRaises(EntryValidationError):
            Entry(key="", value=1, owner="a")
        with self.assertRaises(EntryValidationError):
            RadixIndex().insert("", 1, "a")

    def test_non_string_key_rejected(self):
        with self.assertRaises(EntryValidationError):
            Entry(key=123, value=1, owner="a")

    def test_oversize_key_rejected(self):
        key = "x" * (MAX_KEY_BYTES + 1)
        with self.assertRaises(EntryValidationError) as ctx:
            Entry(key=key, value=1, owner="a")
        self.assertIn("256", str(ctx.exception))

    def test_oversize_multibyte_key_rejected(self):
        # 86 个三字节字符 = 258 字节 > 256
        with self.assertRaises(EntryValidationError):
            Entry(key="服" * 86, value=1, owner="a")
        # 85 个三字节字符 = 255 字节，合法
        Entry(key="服" * 85, value=1, owner="a")
        # 恰好 256 字节合法
        Entry(key="x" * MAX_KEY_BYTES, value=1, owner="a")

    def test_empty_owner_rejected(self):
        with self.assertRaises(EntryValidationError):
            Entry(key="k", value=1, owner="")
        with self.assertRaises(EntryValidationError):
            Entry(key="k", value=1, owner=None)

    def test_non_json_value_rejected(self):
        with self.assertRaises(EntryValidationError):
            Entry(key="k", value=object(), owner="a")
        with self.assertRaises(EntryValidationError):
            Entry(key="k", value={1, 2}, owner="a")

    def test_valid_entry_ok(self):
        e = Entry(key="svc/a", value={"port": 80}, owner="agent-1")
        self.assertEqual(e.key, "svc/a")


# ---------------------------------------------------------------------------
# 注册与覆盖策略
# ---------------------------------------------------------------------------


class TestInsertPolicy(unittest.TestCase):
    def test_same_key_same_owner_overwrites(self):
        idx = RadixIndex()
        r1 = idx.insert("svc/a", {"v": 1}, "agent-1")
        self.assertFalse(r1.overwritten)
        self.assertIsNone(r1.previous_owner)
        r2 = idx.insert("svc/a", {"v": 2}, "agent-1")
        self.assertTrue(r2.overwritten)
        self.assertEqual(r2.previous_owner, "agent-1")
        self.assertEqual(r2.previous_value, {"v": 1})
        self.assertEqual(len(idx), 1)
        entries = idx.prefix_scan("svc/a")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].value, {"v": 2})

    def test_same_key_multiple_owners_coexist(self):
        idx = RadixIndex()
        idx.insert("svc/a", 1, "agent-1")
        idx.insert("svc/a", 2, "agent-2")
        self.assertEqual(len(idx), 2)
        owners = [e.owner for e in idx.prefix_scan("svc/a")]
        self.assertEqual(owners, ["agent-1", "agent-2"])

    def test_different_keys_independent(self):
        idx = RadixIndex()
        idx.insert("svc/a", 1, "o1")
        idx.insert("svc/b", 2, "o1")
        idx.insert("db/a", 3, "o2")
        self.assertEqual(len(idx), 3)
        self.assertEqual(len(idx.prefix_scan("svc/")), 2)
        self.assertEqual(len(idx.prefix_scan("db/")), 1)

    def test_result_size_field(self):
        idx = RadixIndex()
        self.assertEqual(idx.insert("a", 1, "o").size, 1)
        self.assertEqual(idx.insert("b", 1, "o").size, 2)
        self.assertEqual(idx.insert("a", 2, "o").size, 2)  # 覆盖不增加


# ---------------------------------------------------------------------------
# 前缀查询
# ---------------------------------------------------------------------------


class TestPrefixScan(unittest.TestCase):
    def setUp(self):
        self.idx = RadixIndex()
        for key, owner in [
            ("svc/api/v1", "o1"),
            ("svc/api/v2", "o2"),
            ("svc/web", "o1"),
            ("db/main", "o3"),
            ("svc/api", "o4"),
        ]:
            self.idx.insert(key, {"k": key}, owner)

    def test_scan_subtree(self):
        keys = [e.key for e in self.idx.prefix_scan("svc/api")]
        self.assertEqual(keys, ["svc/api", "svc/api/v1", "svc/api/v2"])

    def test_empty_prefix_returns_all_sorted(self):
        keys = [e.key for e in self.idx.prefix_scan("")]
        self.assertEqual(keys, sorted(keys, key=lambda k: k.encode("utf-8")))
        self.assertEqual(len(keys), 5)

    def test_no_match_returns_empty(self):
        self.assertEqual(self.idx.prefix_scan("zzz"), [])
        self.assertEqual(self.idx.prefix_scan("svc/api/v3"), [])
        self.assertEqual(self.idx.prefix_scan("svc/apx"), [])

    def test_prefix_ending_mid_segment(self):
        # "svc/ap" 结束在某个压缩段中间
        keys = [e.key for e in self.idx.prefix_scan("svc/ap")]
        self.assertEqual(keys, ["svc/api", "svc/api/v1", "svc/api/v2"])

    def test_exact_key_is_own_prefix(self):
        keys = [e.key for e in self.idx.prefix_scan("svc/web")]
        self.assertEqual(keys, ["svc/web"])

    def test_byte_order_with_multibyte(self):
        idx = RadixIndex()
        for key in ["服务/b", "服务/a", "svc", "服", "🔧/x"]:
            idx.insert(key, 1, "o")
        keys = [e.key for e in idx.prefix_scan("")]
        self.assertEqual(keys, sorted(keys, key=lambda k: k.encode("utf-8")))
        self.assertEqual([e.key for e in idx.prefix_scan("服务")], ["服务/a", "服务/b"])

    def test_empty_tree(self):
        idx = RadixIndex()
        self.assertEqual(idx.prefix_scan(""), [])
        self.assertEqual(idx.prefix_scan("a"), [])

    def test_prefix_must_be_string(self):
        with self.assertRaises(EntryValidationError):
            self.idx.prefix_scan(None)


# ---------------------------------------------------------------------------
# 最长公共前缀统计
# ---------------------------------------------------------------------------


class TestCommonPrefixStats(unittest.TestCase):
    def test_basic(self):
        idx = RadixIndex()
        idx.insert("svc/api/v1", 1, "o1")
        idx.insert("svc/api/v2", 1, "o2")
        idx.insert("svc/api/v2", 2, "o3")  # 同 key 不同 owner
        idx.insert("svc/web", 1, "o1")
        stats = idx.common_prefix_stats("svc/api")
        self.assertEqual(stats["lcp"], "svc/api/v")
        self.assertEqual(stats["lcp_length"], len("svc/api/v"))
        self.assertEqual(stats["count"], 3)
        self.assertEqual(stats["distinct_keys"], 2)
        self.assertEqual(stats["owners"], {"o1": 1, "o2": 1, "o3": 1})

    def test_single_key_lcp_is_key(self):
        idx = RadixIndex()
        idx.insert("only/key", 1, "o")
        stats = idx.common_prefix_stats("")
        self.assertEqual(stats["lcp"], "only/key")
        self.assertEqual(stats["distinct_keys"], 1)

    def test_no_match_returns_zero_result(self):
        idx = RadixIndex()
        idx.insert("a", 1, "o")
        stats = idx.common_prefix_stats("zzz")
        self.assertEqual(
            stats,
            {"prefix": "zzz", "lcp": "", "lcp_length": 0,
             "count": 0, "distinct_keys": 0, "owners": {}},
        )

    def test_empty_tree(self):
        stats = RadixIndex().common_prefix_stats("")
        self.assertEqual(stats["count"], 0)
        self.assertEqual(stats["lcp"], "")

    def test_multibyte_lcp_counts_characters(self):
        idx = RadixIndex()
        idx.insert("服务/甲", 1, "o")
        idx.insert("服务/乙", 1, "o")
        stats = idx.common_prefix_stats("服务")
        self.assertEqual(stats["lcp"], "服务/")
        self.assertEqual(stats["lcp_length"], 3)


# ---------------------------------------------------------------------------
# 删除与路径压缩合并
# ---------------------------------------------------------------------------


class TestRemove(unittest.TestCase):
    def test_remove_existing(self):
        idx = RadixIndex()
        idx.insert("svc/a", {"v": 1}, "o1")
        res = idx.remove("svc/a", "o1")
        self.assertTrue(res.removed)
        self.assertEqual(res.entry.value, {"v": 1})
        self.assertIsNone(res.reason)
        self.assertEqual(len(idx), 0)
        self.assertEqual(idx.prefix_scan(""), [])
        idx.assert_invariants()

    def test_remove_missing_combinations(self):
        idx = RadixIndex()
        idx.insert("svc/a", 1, "o1")
        # 错误 owner
        res = idx.remove("svc/a", "o2")
        self.assertFalse(res.removed)
        self.assertIn("o2", res.reason)
        # 错误 key
        res = idx.remove("svc/b", "o1")
        self.assertFalse(res.removed)
        self.assertIn("未注册", res.reason)
        # 空树
        res = RadixIndex().remove("x", "o")
        self.assertFalse(res.removed)
        self.assertEqual(len(idx), 1)  # 原条目不受影响

    def test_remove_one_owner_keeps_others(self):
        idx = RadixIndex()
        idx.insert("k", 1, "o1")
        idx.insert("k", 2, "o2")
        idx.remove("k", "o1")
        entries = idx.prefix_scan("k")
        self.assertEqual([(e.owner, e.value) for e in entries], [("o2", 2)])

    def test_leaf_pruned_and_parent_merged(self):
        idx = RadixIndex()
        idx.insert("abc", 1, "o")
        idx.insert("abd", 1, "o")
        # 树形：root -"ab"-> [c, d]
        idx.remove("abc", "o")
        idx.assert_invariants()
        # "ab" 节点不再挂条目且只剩一个孩子，必须合并为 "abd"
        self.assertEqual(idx.stats()["nodes"], 2)  # root + "abd"
        self.assertEqual([e.key for e in idx.prefix_scan("")], ["abd"])

    def test_single_child_node_merged_in_place(self):
        idx = RadixIndex()
        idx.insert("abc", 1, "o")
        idx.insert("abcxyz", 1, "o")
        # 树形：root -"abc"(挂条目)-> "xyz"
        idx.remove("abc", "o")
        idx.assert_invariants()
        # "abc" 节点不再挂条目且只有一个孩子，合并为 "abcxyz"
        self.assertEqual(idx.stats()["nodes"], 2)
        self.assertEqual([e.key for e in idx.prefix_scan("")], ["abcxyz"])

    def test_remove_invalid_key_raises(self):
        idx = RadixIndex()
        with self.assertRaises(EntryValidationError):
            idx.remove("", "o")
        with self.assertRaises(EntryValidationError):
            idx.remove("k", "")


# ---------------------------------------------------------------------------
# 路径压缩不变量
# ---------------------------------------------------------------------------


class TestCompressionInvariant(unittest.TestCase):
    def test_split_creates_no_unary_nodes(self):
        idx = RadixIndex()
        for key in ["test", "testing", "tester", "tea", "toast"]:
            idx.insert(key, 1, "o")
            idx.assert_invariants()

    def test_key_ending_mid_segment(self):
        idx = RadixIndex()
        idx.insert("testing", 1, "o")
        idx.insert("test", 1, "o")  # 在 "testing" 段中间分裂
        idx.assert_invariants()
        self.assertEqual([e.key for e in idx.prefix_scan("test")],
                         ["test", "testing"])

    def test_invariant_after_mixed_operations(self):
        rng = random.Random(20260911)
        idx = RadixIndex()
        alphabet = "abcd"
        keys = set()
        for _ in range(3000):
            if keys and rng.random() < 0.4:
                key = rng.choice(sorted(keys))
                idx.remove(key, "o")
                keys.discard(key)
            else:
                key = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 10)))
                idx.insert(key, 1, "o")
                keys.add(key)
            idx.assert_invariants()
        self.assertEqual(scan_as_tuples(idx, ""),
                         [(k, "o", 1) for k in sorted(keys)])


# ---------------------------------------------------------------------------
# 内存上限
# ---------------------------------------------------------------------------


class TestMaxEntries(unittest.TestCase):
    def test_limit_enforced_with_clear_error(self):
        idx = RadixIndex(max_entries=2)
        idx.insert("a", 1, "o")
        idx.insert("b", 1, "o")
        with self.assertRaises(CapacityError) as ctx:
            idx.insert("c", 1, "o")
        self.assertIn("max_entries=2", str(ctx.exception))
        # 被拒绝的注册不生效
        self.assertEqual(len(idx), 2)
        self.assertEqual([e.key for e in idx.prefix_scan("")], ["a", "b"])

    def test_overwrite_allowed_at_limit(self):
        idx = RadixIndex(max_entries=1)
        idx.insert("a", 1, "o1")
        res = idx.insert("a", 2, "o1")  # 覆盖已有 (key, owner)，不受上限限制
        self.assertTrue(res.overwritten)
        # 同 key 新 owner 是新条目，被拒绝
        with self.assertRaises(CapacityError):
            idx.insert("a", 3, "o2")

    def test_slot_freed_after_remove(self):
        idx = RadixIndex(max_entries=1)
        idx.insert("a", 1, "o")
        idx.remove("a", "o")
        idx.insert("b", 1, "o")  # 腾出位置后可以再注册
        self.assertEqual([e.key for e in idx.prefix_scan("")], ["b"])

    def test_max_entries_zero_rejects_everything(self):
        idx = RadixIndex(max_entries=0)
        with self.assertRaises(CapacityError):
            idx.insert("a", 1, "o")
        self.assertEqual(len(idx), 0)

    def test_exact_mode_unlimited(self):
        idx = RadixIndex()  # max_entries=None
        for i in range(5000):
            idx.insert(f"key/{i}", i, "o")
        self.assertEqual(len(idx), 5000)

    def test_invalid_max_entries(self):
        with self.assertRaises(ValueError):
            RadixIndex(max_entries=-1)


# ---------------------------------------------------------------------------
# 快照持久化
# ---------------------------------------------------------------------------


class TestSnapshot(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "snap.json")

    def _build_index(self):
        idx = RadixIndex(max_entries=100)
        idx.insert("svc/api/v1", {"port": 8001}, "agent-1")
        idx.insert("svc/api/v2", [1, 2, 3], "agent-2")
        idx.insert("svc/api/v2", "x", "agent-3")
        idx.insert("服务/甲", None, "agent-1")
        idx.insert("db", 3.14, "agent-9")
        return idx

    def test_roundtrip_state_identical(self):
        idx = self._build_index()
        idx.save(self.path)
        loaded = RadixIndex.load(self.path)
        self.assertEqual(len(loaded), len(idx))
        self.assertEqual(loaded.max_entries, 100)
        self.assertEqual(scan_as_tuples(loaded, ""), scan_as_tuples(idx, ""))
        self.assertEqual(loaded.stats(), idx.stats())
        for prefix in ["", "svc", "svc/api/v2", "服务", "zzz"]:
            self.assertEqual(scan_as_tuples(loaded, prefix),
                             scan_as_tuples(idx, prefix))
            self.assertEqual(loaded.common_prefix_stats(prefix),
                             idx.common_prefix_stats(prefix))
        loaded.assert_invariants()

    def test_insert_after_load_consistent(self):
        idx = self._build_index()
        idx.save(self.path)
        loaded = RadixIndex.load(self.path)
        # 两边继续相同操作，结果必须一致
        for target in (idx, loaded):
            target.insert("svc/web", 1, "agent-5")
            target.insert("svc/api/v1", {"port": 9001}, "agent-1")  # 覆盖
            target.remove("db", "agent-9")
            target.assert_invariants()
        self.assertEqual(scan_as_tuples(loaded, ""), scan_as_tuples(idx, ""))

    def test_save_empty_tree(self):
        RadixIndex().save(self.path)
        loaded = RadixIndex.load(self.path)
        self.assertEqual(len(loaded), 0)
        self.assertEqual(loaded.prefix_scan(""), [])

    def test_missing_file(self):
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(os.path.join(self.tmp.name, "nope.json"))
        self.assertIn("不存在", str(ctx.exception))

    def test_corrupted_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("JSON", str(ctx.exception))

    def _write_snapshot(self, root, **overrides):
        data = {"format": "radix-index-snapshot", "version": 1,
                "max_entries": None, "root": root}
        data.update(overrides)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def test_missing_root_field(self):
        self._write_snapshot(None)
        os.remove(self.path)
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"format": "radix-index-snapshot", "version": 1}, fh)
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("root", str(ctx.exception))

    def test_bad_format_and_version(self):
        self._write_snapshot({"segment": "", "entries": [], "children": []},
                             format="other")
        with self.assertRaises(SnapshotError):
            RadixIndex.load(self.path)
        self._write_snapshot({"segment": "", "entries": [], "children": []},
                             version=999)
        with self.assertRaises(SnapshotError):
            RadixIndex.load(self.path)

    def test_empty_segment_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [{"segment": "", "entries": [], "children": []}],
        })
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("segment", str(ctx.exception))

    def test_overlapping_children_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [
                {"segment": "ab", "entries": [], "children": []},
                {"segment": "ac", "entries": [], "children": []},
            ],
        })
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("重叠", str(ctx.exception))

    def test_uncompressed_node_rejected(self):
        # 无条目且只有一个孩子 → 违反路径压缩不变量
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [{
                "segment": "ab", "entries": [],
                "children": [{"segment": "c", "entries": [
                    {"key": "abc", "owner": "o", "value": 1}], "children": []}],
            }],
        })
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("路径压缩", str(ctx.exception))

    def test_entry_key_mismatch_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [{"segment": "ab", "entries": [
                {"key": "xyz", "owner": "o", "value": 1}], "children": []}],
        })
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("不一致", str(ctx.exception))

    def test_empty_owner_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [{"segment": "ab", "entries": [
                {"key": "ab", "owner": "", "value": 1}], "children": []}],
        })
        with self.assertRaises(SnapshotError):
            RadixIndex.load(self.path)

    def test_missing_entry_field_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [{"segment": "ab", "entries": [
                {"key": "ab", "value": 1}], "children": []}],
        })
        with self.assertRaises(SnapshotError):
            RadixIndex.load(self.path)

    def test_snapshot_exceeding_max_entries_rejected(self):
        self._write_snapshot({
            "segment": "", "entries": [],
            "children": [
                {"segment": "a", "entries": [
                    {"key": "a", "owner": "o", "value": 1}], "children": []},
                {"segment": "b", "entries": [
                    {"key": "b", "owner": "o", "value": 1}], "children": []},
            ],
        }, max_entries=1)
        with self.assertRaises(SnapshotError) as ctx:
            RadixIndex.load(self.path)
        self.assertIn("max_entries", str(ctx.exception))


# ---------------------------------------------------------------------------
# 随机对照测试：内核 vs 参考实现
# ---------------------------------------------------------------------------


class TestFuzzAgainstReference(unittest.TestCase):
    def test_random_workload_matches_reference(self):
        rng = random.Random(42)
        idx = RadixIndex()
        ref = ReferenceModel()
        alphabet = string.ascii_lowercase + "服务🔧/._"
        owners = ["o1", "o2", "o3"]

        def rand_key():
            return "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 14)))

        live = set()
        for step in range(4000):
            action = rng.random()
            if action < 0.55 or not live:
                key, owner = rand_key(), rng.choice(owners)
                value = {"i": step}
                idx.insert(key, value, owner)
                ref.insert(key, value, owner)
                live.add((key, owner))
            else:
                key, owner = rng.choice(sorted(live))
                r1 = idx.remove(key, owner)
                removed = ref.remove(key, owner)
                self.assertTrue(r1.removed)
                self.assertIsNotNone(removed)
                live.discard((key, owner))
            idx.assert_invariants()
            if step % 200 == 0:
                for _ in range(5):
                    prefix = rand_key()[: rng.randint(0, 6)]
                    self.assertEqual(scan_as_tuples(idx, prefix), ref.scan(prefix))
                    self.assertEqual(idx.common_prefix_stats(prefix), ref.common(prefix))
                self.assertEqual(scan_as_tuples(idx, ""), ref.scan(""))
                self.assertEqual(idx.common_prefix_stats(""), ref.common(""))

        # 收尾全量比对
        self.assertEqual(scan_as_tuples(idx, ""), ref.scan(""))
        self.assertEqual(idx.common_prefix_stats(""), ref.common(""))
        idx.assert_invariants()

    def test_fuzz_snapshot_roundtrip_then_continue(self):
        rng = random.Random(7)
        idx = RadixIndex()
        ref = ReferenceModel()
        alphabet = "abc中"
        for _ in range(1500):
            key = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 8)))
            owner = rng.choice(["x", "y"])
            idx.insert(key, 1, owner)
            ref.insert(key, 1, owner)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snap.json")
            idx.save(path)
            idx = RadixIndex.load(path)
        # 恢复后继续插入删除，仍与参考实现一致
        for _ in range(1500):
            key = "".join(rng.choice(alphabet) for _ in range(rng.randint(1, 8)))
            owner = rng.choice(["x", "y"])
            if rng.random() < 0.5:
                idx.insert(key, 1, owner)
                ref.insert(key, 1, owner)
            else:
                idx.remove(key, owner)
                ref.remove(key, owner)
            idx.assert_invariants()
        self.assertEqual(scan_as_tuples(idx, ""), ref.scan(""))
        self.assertEqual(idx.common_prefix_stats(""), ref.common(""))


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------


class TestCLI(unittest.TestCase):
    def run_cli(self, lines, *args):
        proc = subprocess.run(
            [sys.executable, MAIN_PY, *args],
            input="\n".join(lines) + "\n",
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=HERE,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]

    def test_full_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = os.path.join(tmp, "snap.json")
            outs = self.run_cli([
                json.dumps({"op": "insert", "key": "svc/a", "value": 1, "owner": "o1"}),
                json.dumps({"op": "insert", "key": "svc/b", "value": 2, "owner": "o2"}),
                json.dumps({"op": "insert", "key": "svc/a", "value": 3, "owner": "o1"}),
                json.dumps({"op": "prefix", "prefix": "svc/"}),
                json.dumps({"op": "common", "prefix": "svc/"}),
                json.dumps({"op": "remove", "key": "svc/a", "owner": "o1"}),
                json.dumps({"op": "remove", "key": "svc/a", "owner": "o1"}),
                json.dumps({"op": "stats"}),
                json.dumps({"op": "save", "path": snap}),
                json.dumps({"op": "load", "path": snap}),
                json.dumps({"op": "dump"}),
            ])
        self.assertTrue(all(o["ok"] for o in outs))
        self.assertTrue(outs[2]["result"]["overwritten"])
        self.assertEqual(outs[2]["result"]["previous_owner"], "o1")
        self.assertEqual(outs[3]["result"]["count"], 2)
        self.assertEqual(outs[4]["result"]["lcp"], "svc/")
        self.assertTrue(outs[5]["result"]["removed"])
        self.assertFalse(outs[6]["result"]["removed"])
        self.assertIsNotNone(outs[6]["result"]["reason"])
        self.assertEqual(outs[7]["result"]["entries"], 1)
        self.assertEqual(outs[9]["result"]["entries"], 1)
        self.assertEqual(outs[10]["result"]["format"], "radix-index-snapshot")

    def test_errors_are_json_with_error_field(self):
        outs = self.run_cli([
            "this is not json",
            json.dumps({"op": "nope"}),
            json.dumps({"op": "insert", "key": "", "value": 1, "owner": "o"}),
            json.dumps({"op": "insert", "key": "k", "value": 1}),  # 缺 owner
            json.dumps({"op": "load", "path": "/nonexistent/x.json"}),
        ])
        for out in outs:
            self.assertFalse(out["ok"])
            self.assertIn("error", out)

    def test_max_entries_via_argv(self):
        outs = self.run_cli([
            json.dumps({"op": "insert", "key": "a", "value": 1, "owner": "o"}),
            json.dumps({"op": "insert", "key": "b", "value": 1, "owner": "o"}),
        ], "--max-entries", "1")
        self.assertTrue(outs[0]["ok"])
        self.assertFalse(outs[1]["ok"])
        self.assertEqual(outs[1]["error_type"], "CapacityError")


if __name__ == "__main__":
    unittest.main()
