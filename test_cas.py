"""cas 内核与 main.py CLI 的单元测试（标准库 unittest）。

运行::

    python -m unittest -v
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import random
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from typing import Any, Dict, List

import cas
import main as cli
from cas import (
    DEFAULT_BLOCK_SIZE,
    BlockHashMismatchError,
    BlockNotFoundError,
    BlockSizeMismatchError,
    CasError,
    ContentHashMismatchError,
    ContentStore,
    Manifest,
    ManifestValidationError,
    MissingBlockError,
    StorageLimitError,
    StoreCorruptionError,
    SyncPlan,
    chunk_data,
    diff,
    hash_block_ids,
    hash_bytes,
)

# --------------------------------------------------------------------------- #
# 参考实现：不做任何分块优化的整文件 SHA-256，用于独立校验。
# --------------------------------------------------------------------------- #
def reference_file_hash(data: bytes) -> str:
    """验收用参考实现：直接对完整文件内容做 SHA-256。"""
    return hashlib.sha256(data).hexdigest()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


# --------------------------------------------------------------------------- #
# 1. 切块与块 ID 计算
# --------------------------------------------------------------------------- #
class ChunkingTests(unittest.TestCase):
    def test_default_block_size_constant(self) -> None:
        self.assertEqual(DEFAULT_BLOCK_SIZE, 4096)

    def test_empty_data_produces_no_chunks(self) -> None:
        self.assertEqual(chunk_data(b""), [])
        self.assertEqual(chunk_data(b"", 1024), [])

    def test_single_small_chunk(self) -> None:
        data = b"hello"
        self.assertEqual(chunk_data(data, 4096), [b"hello"])

    def test_exact_multiple_block_sizes(self) -> None:
        data = bytes(range(256)) * 8  # 2048 字节
        chunks = chunk_data(data, 512)
        self.assertEqual([len(c) for c in chunks], [512] * 4)
        self.assertEqual(b"".join(chunks), data)

    def test_partial_final_chunk(self) -> None:
        data = b"x" * (1000 + 37)
        chunks = chunk_data(data, 1000)
        self.assertEqual([len(c) for c in chunks], [1000, 37])
        self.assertEqual(b"".join(chunks), data)

    def test_invalid_block_size(self) -> None:
        for bad in (0, -1, 1.5, "4"):
            with self.assertRaises(ValueError):
                chunk_data(b"abc", bad)  # type: ignore[arg-type]

    def test_block_id_is_sha256_hex(self) -> None:
        data = os.urandom(2048)
        block_id = hash_bytes(data)
        self.assertEqual(block_id, hashlib.sha256(data).hexdigest())
        self.assertEqual(len(block_id), 64)
        int(block_id, 16)  # 必须是合法十六进制

    def test_empty_block_has_well_known_hash(self) -> None:
        # 空字节串的 SHA-256，空块在存储中是合法块。
        self.assertEqual(
            hash_bytes(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        )

    def test_content_hash_is_hash_of_concatenated_ids(self) -> None:
        ids = ["aa" * 32, "bb" * 32, "cc" * 32]
        expected = hashlib.sha256("".join(ids).encode()).hexdigest()
        self.assertEqual(hash_block_ids(ids), expected)

    def test_manifest_from_data_boundaries(self) -> None:
        for data, bs in [
            (b"", 16),
            (b"a", 16),
            (b"a" * 16, 16),
            (b"a" * 17, 16),
            (b"\x00" * 4097, 4096),
        ]:
            with self.subTest(length=len(data), bs=bs):
                m = Manifest.from_data("p", data, bs)
                self.assertEqual(m.length, len(data))
                self.assertEqual(
                    len(m.block_ids),
                    0 if not data else (len(data) + bs - 1) // bs,
                )
                self.assertEqual(
                    m.content_hash, hash_block_ids(m.block_ids)
                )
                self.assertEqual(sum(1 for _ in chunk_data(data, bs)),
                                 len(m.block_ids))


# --------------------------------------------------------------------------- #
# 2. 清单 JSON 往返
# --------------------------------------------------------------------------- #
class ManifestSerializationTests(unittest.TestCase):
    def _round_trip(self, manifest: Manifest) -> Manifest:
        restored = Manifest.from_json(manifest.to_json(), validate=True)
        self.assertEqual(restored.to_dict(), manifest.to_dict())
        return restored

    def test_round_trip_empty_file_manifest(self) -> None:
        self._round_trip(Manifest.from_data("dir/empty.txt", b"", 512))

    def test_round_trip_populated_manifest(self) -> None:
        data = bytes(range(256)) * 30
        self._round_trip(Manifest.from_data("a/b.bin", data, 1024))

    def test_unicode_path_preserved(self) -> None:
        m = Manifest.from_data("目录/文件 ✗.dat", b"payload", 8)
        restored = self._round_trip(m)
        self.assertEqual(restored.path, "目录/文件 ✗.dat")

    def test_missing_field_rejected(self) -> None:
        m = Manifest.from_data("p", b"abcdef", 4).to_dict()
        for key in m:
            broken = {k: v for k, v in m.items() if k != key}
            with self.subTest(missing=key):
                with self.assertRaises(ManifestValidationError):
                    Manifest.from_dict(broken)

    def test_wrong_content_hash_rejected_in_validate(self) -> None:
        m = Manifest.from_data("p", b"abcdef", 4).to_dict()
        m["content_hash"] = "0" * 64
        with self.assertRaises(ManifestValidationError):
            Manifest.from_dict(m, validate=True)
        # 不校验时允许载入（load 快照时会统一校验）。
        restored = Manifest.from_dict(m, validate=False)
        self.assertEqual(restored.content_hash, "0" * 64)

    def test_bad_json_rejected(self) -> None:
        with self.assertRaises(ManifestValidationError):
            Manifest.from_json("{not json")

    def test_sync_plan_json_round_trip(self) -> None:
        plan = SyncPlan(
            block_size=128,
            local_path="l",
            remote_path="r",
            fetch_ids=["a" * 64],
            delete_ids=["b" * 64],
            rebuild_ids=["a" * 64, "c" * 64],
            remote_length=256,
            content_hash="d" * 64,
        )
        restored = SyncPlan.from_json(plan.to_json())
        self.assertEqual(restored.to_dict(), plan.to_dict())


# --------------------------------------------------------------------------- #
# 3. 去重与引用计数
# --------------------------------------------------------------------------- #
class StoreBasicTests(unittest.TestCase):
    def test_put_returns_id_and_get_round_trips(self) -> None:
        store = ContentStore()
        data = os.urandom(5000)
        bid = store.put_block(data)
        self.assertEqual(bid, hash_bytes(data))
        self.assertTrue(store.has_block(bid))
        self.assertEqual(store.get_block(bid), data)

    def test_duplicate_put_is_idempotent_and_refcounted(self) -> None:
        store = ContentStore()
        data = b"shared block content"
        first = store.put_block(data)
        self.assertEqual(store.ref_count(first), 1)
        second = store.put_block(data)
        self.assertEqual(first, second)
        self.assertEqual(store.stats()["block_count"], 1)
        self.assertEqual(store.ref_count(first), 2)
        # 再写一块不同内容 -> 物理块数变为 2。
        store.put_block(b"different")
        self.assertEqual(store.stats()["block_count"], 2)

    def test_get_missing_block_raises(self) -> None:
        store = ContentStore()
        with self.assertRaises(BlockNotFoundError):
            store.get_block("0" * 64)
        with self.assertRaises(BlockNotFoundError):
            store.add_ref("0" * 64)
        with self.assertRaises(BlockNotFoundError):
            store.release_ref("0" * 64)
        self.assertFalse(store.has_block("0" * 64))

    def test_refcount_lifecycle(self) -> None:
        store = ContentStore()
        bid = store.put_block(b"x")
        self.assertEqual(store.add_ref(bid), 2)
        self.assertEqual(store.add_ref(bid), 3)
        self.assertEqual(store.release_ref(bid), 2)
        self.assertEqual(store.release_ref(bid), 1)
        self.assertEqual(store.release_ref(bid), 0)
        # 计数 0 的块仍在，直到 gc。
        self.assertTrue(store.has_block(bid))
        # 不允许减到负数。
        with self.assertRaises(CasError):
            store.release_ref(bid)
        self.assertEqual(store.gc(), 1)
        self.assertFalse(store.has_block(bid))
        # gc 再跑一次是 0。
        self.assertEqual(store.gc(), 0)

    def test_gc_keeps_shared_blocks(self) -> None:
        store = ContentStore()
        a = store.add_file("a", b"AAAA" * 200, block_size=256)
        b = store.add_file("b", b"AAAA" * 200, block_size=256)
        self.assertEqual(a.block_ids, b.block_ids)
        store.remove_manifest("a")
        self.assertEqual(store.gc(), 0)  # b 仍引用，块不能删
        store.remove_manifest("b")
        # 两个文件内容完全相同：4 个块位置全是同一个物理块，去重后只清 1 块。
        self.assertEqual(store.gc(), len(set(b.block_ids)))

    def test_stats_dedup_savings(self) -> None:
        store = ContentStore(block_size=4)
        chunk = b"ABCD"  # 4 字节块
        # 同一物理块引用 4 次。
        for _ in range(4):
            store.put_block(chunk)
        other = store.put_block(b"WXYZ")
        store.release_ref(other)  # 计数 0 的块仍占物理字节，等待 gc
        stats = store.stats()
        self.assertEqual(stats["block_count"], 2)
        self.assertEqual(stats["total_bytes"], 8)
        self.assertEqual(stats["logical_bytes"], 4 * 4 + 0)
        self.assertEqual(stats["saved_bytes"], 16 - 8)
        self.assertEqual(stats["ref_distribution"], {"4": 1, "0": 1})

    def test_add_file_with_repeated_internal_blocks(self) -> None:
        store = ContentStore(block_size=4)
        data = b"ABCD" * 10  # 同一 4 字节块在一个文件内出现 10 次
        m = store.add_file("f", data)
        self.assertEqual(len(set(m.block_ids)), 1)
        self.assertEqual(store.ref_count(m.block_ids[0]), 10)
        self.assertEqual(store.stats()["block_count"], 1)
        self.assertEqual(store.stats()["saved_bytes"], 40 - 4)

    def test_add_file_replacement_releases_old_refs(self) -> None:
        store = ContentStore(block_size=4)
        m1 = store.add_file("f", b"AAAA" * 8)
        self.assertEqual(store.ref_count(m1.block_ids[0]), 8)
        m2 = store.add_file("f", b"BBBB" * 8)
        # 替换路径会立即安全回收归零的旧独占块（共享块不受影响）。
        self.assertFalse(store.has_block(m1.block_ids[0]))
        self.assertEqual(store.ref_count(m2.block_ids[0]), 8)
        self.assertEqual(len(store.manifests), 1)

    def test_add_file_replacement_keeps_shared_blocks(self) -> None:
        store = ContentStore(block_size=4)
        m1 = store.add_file("f", b"AAAA" * 4 + b"BBBB" * 4)
        m2 = store.add_file("g", b"AAAA" * 4 + b"CCCC" * 4)
        a_id = m1.block_ids[0]
        self.assertEqual(store.ref_count(a_id), 8)  # f 与 g 各含 4 个 A 块
        # 替换 f：A 块仍被 g 引用必须保留，B 块归零被回收，D 块新增。
        m3 = store.add_file("f", b"AAAA" * 4 + b"DDDD" * 4)
        self.assertTrue(store.has_block(a_id))
        self.assertEqual(store.ref_count(a_id), 8)  # f 与 g 各出现 4 次
        self.assertFalse(store.has_block(m1.block_ids[-1]))  # 旧 B 块
        self.assertTrue(store.has_block(m3.block_ids[-1]))   # 新 D 块

    def test_empty_file_manifest_uses_no_blocks(self) -> None:
        store = ContentStore(block_size=8)
        m = store.add_file("empty", b"")
        self.assertEqual(m.block_ids, [])
        self.assertEqual(m.length, 0)
        self.assertEqual(store.stats()["block_count"], 0)

    def test_empty_block_is_stored_once(self) -> None:
        store = ContentStore(block_size=4)
        # 切不出空块；直接写空块验证空块合法且可去重。
        b1 = store.put_block(b"")
        b2 = store.put_block(b"")
        self.assertEqual(b1, b2)
        self.assertEqual(store.get_block(b1), b"")
        self.assertEqual(store.stats()["total_bytes"], 0)


# --------------------------------------------------------------------------- #
# 4. 差分计划
# --------------------------------------------------------------------------- #
def make_file_store(files: Dict[str, bytes], block_size: int = 64,
                    max_bytes=None) -> ContentStore:
    store = ContentStore(block_size=block_size, max_bytes=max_bytes)
    for path, data in files.items():
        store.add_file(path, data, block_size)
    return store


class DiffTests(unittest.TestCase):
    def setUp(self) -> None:
        rng = random.Random(20260911)
        # 8 个满块 + 1 个尾块（37 字节）。
        self.chunks = [bytes(rng.getrandbits(8) for _ in range(64))
                       for _ in range(8)]
        self.tail = bytes(rng.getrandbits(8) for _ in range(37))
        self.base = b"".join(self.chunks) + self.tail
        self.block_size = 64

    def _manifest(self, store: ContentStore, path: str) -> Manifest:
        return store.manifests[path]

    def test_identical_files_fetch_nothing(self) -> None:
        local = make_file_store({"f": self.base}, self.block_size)
        remote = make_file_store({"f": self.base}, self.block_size)
        plan = diff(self._manifest(local, "f"), self._manifest(remote, "f"))
        self.assertEqual(plan.fetch_ids, [])
        self.assertEqual(plan.delete_ids, [])
        self.assertEqual(plan.rebuild_ids, self._manifest(remote, "f").block_ids)

    def test_one_changed_block_fetches_exactly_one(self) -> None:
        changed = bytearray(self.base)
        changed[10:14] = b"DIFF"  # 仅改动第一个块内的 4 字节
        remote_data = bytes(changed)
        local = make_file_store({"f": self.base}, self.block_size)
        remote = make_file_store({"f": remote_data}, self.block_size)

        lm = self._manifest(local, "f")
        rm = self._manifest(remote, "f")
        local_differing = {a for a, b in zip(lm.block_ids, rm.block_ids) if a != b}
        remote_differing = {b for a, b in zip(lm.block_ids, rm.block_ids) if a != b}
        self.assertEqual(len(remote_differing), 1)

        plan = diff(lm, rm)
        # fetch 恰好包含远端那个变化后的新块（集合相等，顺序按远端首次出现）。
        self.assertEqual(set(plan.fetch_ids), remote_differing)
        self.assertEqual(set(plan.delete_ids), local_differing)
        self.assertEqual(len(plan.fetch_ids), 1)
        # rebuild 序列即远端块序列。
        self.assertEqual(plan.rebuild_ids, rm.block_ids)

    def test_fetch_list_minimal_with_counter_verifier(self) -> None:
        """验收重点：用计数器包装远端 get_block，未变化块绝不传输。"""

        class CountingStore(ContentStore):
            def __init__(self, *args, **kwargs) -> None:
                super().__init__(*args, **kwargs)
                self.get_calls = 0

            def get_block(self, block_id: str) -> bytes:
                self.get_calls += 1
                return super().get_block(block_id)

        # 修改第 3 块和第 7 块。
        changed = bytearray(self.base)
        changed[2 * 64 + 1] ^= 0xFF
        changed[6 * 64 + 10] ^= 0x0F
        remote_data = bytes(changed)

        local = make_file_store({"f": self.base}, self.block_size)
        remote = CountingStore(block_size=self.block_size)
        remote.add_file("f", remote_data, self.block_size)

        lm, rm = self._manifest(local, "f"), self._manifest(remote, "f")
        changed_positions = [
            i for i, (a, b) in enumerate(zip(lm.block_ids, rm.block_ids))
            if a != b
        ]
        self.assertEqual(changed_positions, [2, 6])

        plan = diff(lm, rm)
        # 拉取集合恰好是发生变化的块，最小性：
        changed_ids = {rm.block_ids[i] for i in changed_positions}
        self.assertEqual(set(plan.fetch_ids), changed_ids)
        self.assertEqual(len(plan.fetch_ids), 2)

        before_calls = remote.get_calls
        rebuilt = local.apply_diff(plan, remote)
        # 计数器：只对 2 个缺失块各取一次，未变化的 7 块零传输。
        self.assertEqual(remote.get_calls - before_calls, 2)
        self.assertEqual(rebuilt, remote_data)
        # 整文件哈希与参考实现一致。
        self.assertEqual(
            hash_bytes(rebuilt), reference_file_hash(remote_data)
        )
        self.assertEqual(hash_bytes(rebuilt), hash_bytes(remote_data))

    def test_inserted_and_removed_blocks(self) -> None:
        local = make_file_store({"f": b"".join(self.chunks[:5])}, self.block_size)
        # 远端在中间插入一个新块。
        new_chunk = b"\x7f" * 64
        remote_data = b"".join(self.chunks[:2] + [new_chunk] + self.chunks[2:5])
        remote = make_file_store({"f": remote_data}, self.block_size)
        plan = diff(self._manifest(local, "f"), self._manifest(remote, "f"))
        self.assertEqual(plan.fetch_ids, [hash_bytes(new_chunk)])
        self.assertEqual(plan.delete_ids, [])
        rebuilt = local.apply_diff(plan, remote)
        self.assertEqual(rebuilt, remote_data)

    def test_diff_block_size_mismatch_rejected(self) -> None:
        local = ContentStore(block_size=64)
        remote = ContentStore(block_size=128)
        lm = local.add_file("f", b"x" * 200)
        rm = remote.add_file("f", b"x" * 200)
        with self.assertRaises(BlockSizeMismatchError) as ctx:
            diff(lm, rm)
        self.assertEqual(ctx.exception.local_size, 64)
        self.assertEqual(ctx.exception.remote_size, 128)

    def test_diff_empty_to_nonempty_and_back(self) -> None:
        local = make_file_store({"f": b""}, self.block_size)
        remote = make_file_store({"f": self.base}, self.block_size)
        plan = diff(self._manifest(local, "f"), self._manifest(remote, "f"))
        # 空 -> 有内容：远端所有块都要拉；apply 后逐字节一致。
        self.assertEqual(
            set(plan.fetch_ids), set(remote.manifests["f"].block_ids)
        )
        self.assertEqual(local.apply_diff(plan, remote), self.base)

        # 反方向：有内容 -> 空，rebuild 序列为空，apply 得到空字节。
        plan_back = diff(
            self._manifest(remote, "f"), self._manifest(local, "f")
        )
        self.assertEqual(plan_back.fetch_ids, [])
        self.assertEqual(
            set(plan_back.delete_ids),
            set(remote.manifests["f"].block_ids),
        )
        self.assertEqual(remote.apply_diff(plan_back, local), b"")
        self.assertEqual(plan_back.content_hash, hash_block_ids([]))

    def test_diff_fetch_ids_dedup_when_same_new_block_repeats(self) -> None:
        # 远端文件里同一个新块出现多次，fetch 列表只列一次。
        shared = b"Q" * 64
        local = make_file_store({"f": b"".join(self.chunks[:3])}, self.block_size)
        remote_data = shared + b"".join(self.chunks[:3]) + shared
        remote = make_file_store({"f": remote_data}, self.block_size)
        plan = diff(self._manifest(local, "f"), self._manifest(remote, "f"))
        self.assertEqual(plan.fetch_ids, [hash_bytes(shared)])
        # 但重建序列里出现两次。
        self.assertEqual(plan.rebuild_ids.count(hash_bytes(shared)), 2)


# --------------------------------------------------------------------------- #
# 5. apply 重建与缺块 / 哈希错误
# --------------------------------------------------------------------------- #
class ApplyTests(unittest.TestCase):
    def test_apply_rebuilds_remote_file_byte_for_byte(self) -> None:
        data = bytes((i * 37) % 256 for i in range(10_000))
        local = ContentStore(block_size=256)
        remote = make_file_store({"f": data}, 256)
        plan = diff(Manifest.from_data("f", b"", 256),
                    remote.manifests["f"])
        result = local.apply_diff(plan, remote)
        self.assertEqual(result, data)
        self.assertEqual(hash_bytes(result), hash_bytes(data))
        self.assertEqual(hash_bytes(result), reference_file_hash(data))

    def test_apply_remote_missing_block_reports_ids(self) -> None:
        remote = make_file_store({"f": b"abcdefgh" * 20}, block_size=8)
        rm = remote.manifests["f"]
        # 构造一个引用了远端也没有的块的计划。
        phantom = hash_bytes(b"ghost block!!")
        plan = SyncPlan(
            block_size=8,
            local_path="f",
            remote_path="f",
            fetch_ids=[phantom],
            delete_ids=[],
            rebuild_ids=[phantom] + rm.block_ids[1:],
            remote_length=rm.length,
            content_hash=hash_block_ids([phantom] + rm.block_ids[1:]),
        )
        local = ContentStore(block_size=8)
        with self.assertRaises(MissingBlockError) as ctx:
            local.apply_diff(plan, remote)
        self.assertIn(phantom, ctx.exception.missing)

    def test_apply_rebuild_missing_block_detected(self) -> None:
        # fetch 列表与 rebuild 列表不一致：rebuild 里有一个谁都没有的块。
        remote = make_file_store({"f": b"abcdefgh" * 4}, block_size=8)
        rm = remote.manifests["f"]
        phantom = hash_bytes(b"no such data!!")
        plan = SyncPlan(
            block_size=8, local_path="f", remote_path="f",
            fetch_ids=rm.block_ids[:1],
            delete_ids=[], rebuild_ids=[phantom] + rm.block_ids[1:],
            remote_length=rm.length,
            content_hash="0" * 64,
        )
        local = ContentStore(block_size=8)
        with self.assertRaises(MissingBlockError):
            local.apply_diff(plan, remote)

    def test_apply_block_size_mismatch_rejected(self) -> None:
        remote = make_file_store({"f": b"x" * 32}, block_size=16)
        plan = diff(Manifest.from_data("f", b"", 16), remote.manifests["f"])
        local = ContentStore(block_size=32)
        with self.assertRaises(BlockSizeMismatchError):
            local.apply_diff(plan, remote)

    def test_apply_detects_corrupt_remote_payload(self) -> None:
        # 远端块内容与块 ID 不匹配（篡改），apply 必须报错而非静默拼接。
        remote = ContentStore(block_size=8)
        data = b"abcdefgh"
        bid = remote.put_block(data)
        remote._blocks[bid] = b"XXXXXXXX"  # 人为损坏：内容与 ID 不符
        plan = SyncPlan(
            block_size=8, local_path="f", remote_path="f",
            fetch_ids=[bid], delete_ids=[], rebuild_ids=[bid],
            remote_length=8, content_hash=hash_block_ids([bid]),
        )
        local = ContentStore(block_size=8)
        with self.assertRaises(BlockHashMismatchError):
            local.apply_diff(plan, remote)

    def test_apply_failure_leaves_store_untouched(self) -> None:
        # 损坏 payload 导致校验失败时，本地存储不得留下任何半成品块。
        remote = ContentStore(block_size=8)
        data = b"abcdefgh"
        bid = remote.put_block(data)
        remote._blocks[bid] = b"XXXXXXXX"
        plan = SyncPlan(
            block_size=8, local_path="f", remote_path="f",
            fetch_ids=[bid], delete_ids=[], rebuild_ids=[bid],
            remote_length=8, content_hash=hash_block_ids([bid]),
        )
        local = ContentStore(block_size=8)
        with self.assertRaises(BlockHashMismatchError):
            local.apply_diff(plan, remote)
        self.assertEqual(local.stats()["block_count"], 0)
        self.assertFalse(local.has_block(bid))

    def test_apply_rejects_bad_overall_content_hash(self) -> None:
        # 块都真实存在、哈希正确，但计划声称的整体哈希是错的 -> 拒绝。
        remote = make_file_store({"f": b"abcdefgh" * 4}, block_size=8)
        rm = remote.manifests["f"]
        plan = SyncPlan(
            block_size=8, local_path="f", remote_path="f",
            fetch_ids=rm.block_ids,
            delete_ids=[], rebuild_ids=rm.block_ids,
            remote_length=rm.length,
            content_hash="0" * 64,
        )
        local = ContentStore(block_size=8)
        with self.assertRaises(ContentHashMismatchError):
            local.apply_diff(plan, remote)
        self.assertEqual(local.stats()["block_count"], 0)

    def test_adopt_remote_manifest_switches_file_and_gc_works(self) -> None:
        local = make_file_store({"f": b"A" * 200}, block_size=64)
        remote = make_file_store({"f": b"B" * 200}, block_size=64)
        old_ids = set(local.manifests["f"].block_ids)
        plan = diff(local.manifests["f"], remote.manifests["f"])
        local.apply_diff(plan, remote)
        # adopt 之前：拉来的新块引用计数为 0，gc 会把它们清掉。
        self.assertEqual(local.gc(), len(set(plan.rebuild_ids)))
        # 重新拉取并 adopt：替换会回收旧 A 块、为新 B 块建立引用。
        local.apply_diff(plan, remote)
        new_manifest = local.adopt_remote_manifest(plan)
        for old_id in old_ids:
            self.assertFalse(local.has_block(old_id))  # 旧独占块已回收
        removed = local.gc()
        self.assertEqual(removed, 0)  # 新块全部被清单引用
        # 再重建：所有引用块仍在，内容与远端一致。
        content = b"".join(local.get_block(b) for b in new_manifest.block_ids)
        self.assertEqual(content, b"B" * 200)


# --------------------------------------------------------------------------- #
# 6. max_bytes 内存上限
# --------------------------------------------------------------------------- #
class LimitTests(unittest.TestCase):
    def test_unlimited_mode_accepts_large_write(self) -> None:
        store = ContentStore(block_size=64, max_bytes=None)
        data = os.urandom(50_000)  # 随机内容，块几乎全不同，物理占用即文件大小
        store.add_file("f", data)
        self.assertIsNone(store.max_bytes)
        self.assertGreater(store.stats()["total_bytes"], 4096)

    def test_zero_limit_rejects_nonempty_block(self) -> None:
        store = ContentStore(max_bytes=0)
        with self.assertRaises(StorageLimitError) as ctx:
            store.put_block(b"x")
        self.assertEqual(ctx.exception.need, 1)
        self.assertEqual(ctx.exception.limit, 0)
        self.assertEqual(store.stats()["block_count"], 0)
        # 空块 0 字节，在 0 上限下仍可写入。
        bid = store.put_block(b"")
        self.assertTrue(store.has_block(bid))

    def test_limit_rejection_is_atomic_add_file(self) -> None:
        store = ContentStore(block_size=4, max_bytes=8)
        with self.assertRaises(StorageLimitError):
            store.add_file("f", b"ABCDEFGHIJKL")  # 3 个不同 4 字节块 = 12 字节
        stats = store.stats()
        self.assertEqual(stats["block_count"], 0)
        self.assertEqual(stats["total_bytes"], 0)
        self.assertEqual(len(store.manifests), 0)

    def test_limit_counts_dedup_only_once(self) -> None:
        # 10 字节上限：同一 4 字节块写多少次都只算 4 字节物理占用。
        store = ContentStore(block_size=4, max_bytes=10)
        for _ in range(5):
            store.put_block(b"ABCD")
        self.assertEqual(store.stats()["total_bytes"], 4)
        store.put_block(b"WXYZ")  # 累计 8 字节，仍在上限内
        with self.assertRaises(StorageLimitError):
            store.put_block(b"1234")  # 第 3 个新块 -> 12 > 10
        self.assertEqual(store.stats()["block_count"], 2)

    def test_limit_replace_can_reclaim_old_exclusive_blocks(self) -> None:
        # 旧独占块 4 字节先释放回收，新数据 8 字节恰好等于上限，可以替换。
        store = ContentStore(block_size=4, max_bytes=8)
        store.add_file("f", b"AAAA")
        manifest = store.add_file("f", b"BBBBCCCC")
        self.assertEqual(store.stats()["total_bytes"], 8)
        self.assertEqual(
            b"".join(store.get_block(b) for b in manifest.block_ids),
            b"BBBBCCCC",
        )

    def test_limit_replace_rejected_when_still_over_after_reclaim(self) -> None:
        # 即使回收旧的 4 字节，12 字节新数据仍超过 8 字节上限：拒绝且旧文件不变。
        store = ContentStore(block_size=4, max_bytes=8)
        store.add_file("f", b"AAAA")
        with self.assertRaises(StorageLimitError):
            store.add_file("f", b"BBBBCCCCDDDD")
        self.assertIn("f", store.manifests)
        self.assertEqual(store.stats()["total_bytes"], 4)
        self.assertEqual(
            b"".join(store.get_block(b)
                     for b in store.manifests["f"].block_ids),
            b"AAAA",
        )

    def test_apply_respects_limit_atomically(self) -> None:
        local = ContentStore(block_size=4, max_bytes=4)
        remote = make_file_store({"f": b"ABCDEFGH"}, block_size=4)
        plan = diff(Manifest.from_data("f", b"", 4), remote.manifests["f"])
        with self.assertRaises(StorageLimitError):
            local.apply_diff(plan, remote)
        self.assertEqual(local.stats()["block_count"], 0)

    def test_invalid_max_bytes(self) -> None:
        with self.assertRaises(ValueError):
            ContentStore(max_bytes=-1)


# --------------------------------------------------------------------------- #
# 7. save/load 快照往返
# --------------------------------------------------------------------------- #
class PersistenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir_path = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _populate(self) -> ContentStore:
        store = ContentStore(block_size=32, max_bytes=100_000)
        store.add_file("common.bin", b"shared" * 50, block_size=32)
        store.add_file("other.txt", b"shared" * 50 + b"!!tail", block_size=32)
        store.add_file("empty", b"", block_size=32)
        # 一个计数为 0、等待 gc 的块也要能往返。
        floating = store.put_block(b"floating block!!")
        store.release_ref(floating)
        return store

    def test_save_load_round_trip_state(self) -> None:
        store = self._populate()
        stats_before = store.stats()
        store.save(self.dir_path)

        # 块内容确实按 ID 落盘为独立文件。
        data_dir = os.path.join(self.dir_path, "blocks", "data")
        files = os.listdir(data_dir)
        self.assertEqual(len(files), stats_before["block_count"])
        self.assertTrue(all(len(f) == 64 for f in files))

        restored = ContentStore.load(self.dir_path)
        self.assertEqual(restored.block_size, 32)
        self.assertEqual(restored.max_bytes, 100_000)
        self.assertEqual(restored.stats(), stats_before)
        for path, m in store.manifests.items():
            self.assertEqual(restored.manifests[path].to_dict(), m.to_dict())
        for bid in store.block_ids():
            self.assertEqual(restored.get_block(bid), store.get_block(bid))
            self.assertEqual(restored.ref_count(bid), store.ref_count(bid))

    def test_continue_operations_after_load(self) -> None:
        store = self._populate()
        store.save(self.dir_path)
        restored = ContentStore.load(self.dir_path)

        # 继续 add_file / gc / diff / apply 结果应与未重启一致。
        removed = restored.gc()
        self.assertEqual(removed, 1)  # 唯一的 floating 块
        new_data = b"shared" * 50 + b"??new tail!!"
        m = restored.add_file("other.txt", new_data, block_size=32)
        rebuilt = b"".join(restored.get_block(b) for b in m.block_ids)
        self.assertEqual(rebuilt, new_data)

        d2 = os.path.join(self.dir_path, "second")
        restored.save(d2)
        again = ContentStore.load(d2)
        self.assertEqual(
            again.manifests["other.txt"].to_dict(),
            restored.manifests["other.txt"].to_dict(),
        )
        self.assertEqual(again.stats(), restored.stats())

    def test_save_creates_nested_directory(self) -> None:
        target = os.path.join(self.dir_path, "nested", "snapshot")
        store = ContentStore()
        store.put_block(b"hi")
        store.save(target)
        loaded = ContentStore.load(target)
        self.assertEqual(loaded.get_block(loaded.block_ids()[0]), b"hi")

    def _corrupt_case(self, name: str, mutate) -> None:
        store = self._populate()
        store.gc()  # 去掉 0 计数块，保证干净快照
        store.save(self.dir_path)
        mutate(self.dir_path)
        with self.assertRaises(StoreCorruptionError) as ctx:
            ContentStore.load(self.dir_path)
        self.assertTrue(str(ctx.exception), f"{name}: 错误信息不能为空")

    def test_corrupt_missing_index_file(self) -> None:
        def mutate(d: str) -> None:
            os.remove(os.path.join(d, "blocks", "index.json"))
        self._corrupt_case("缺 index.json", mutate)

    def test_corrupt_bad_json(self) -> None:
        def mutate(d: str) -> None:
            with open(os.path.join(d, "refs.json"), "w", encoding="utf-8") as fh:
                fh.write("{ this is not valid json")
        self._corrupt_case("refs.json 损坏", mutate)

    def test_corrupt_missing_field(self) -> None:
        def mutate(d: str) -> None:
            with open(os.path.join(d, "meta.json"), encoding="utf-8") as fh:
                doc = json.load(fh)
            del doc["block_size"]
            with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        self._corrupt_case("meta 缺字段", mutate)

    def test_corrupt_block_content_hash_mismatch(self) -> None:
        def mutate(d: str) -> None:
            data_dir = os.path.join(d, "blocks", "data")
            name = os.listdir(data_dir)[0]
            with open(os.path.join(data_dir, name), "rb") as fh:
                blob = bytearray(fh.read())
            blob[0] ^= 0xFF
            with open(os.path.join(data_dir, name), "wb") as fh:
                fh.write(blob)
        self._corrupt_case("块内容被篡改", mutate)

    def test_corrupt_missing_block_file(self) -> None:
        def mutate(d: str) -> None:
            data_dir = os.path.join(d, "blocks", "data")
            os.remove(os.path.join(data_dir, os.listdir(data_dir)[0]))
        self._corrupt_case("块文件缺失", mutate)

    def test_corrupt_negative_refcount(self) -> None:
        def mutate(d: str) -> None:
            path = os.path.join(d, "refs.json")
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            key = next(iter(doc["refs"]))
            doc["refs"][key] = -1
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        self._corrupt_case("负引用计数", mutate)

    def test_corrupt_manifest_content_hash(self) -> None:
        def mutate(d: str) -> None:
            path = os.path.join(d, "manifests.json")
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            doc["manifests"][0]["content_hash"] = "f" * 64
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        self._corrupt_case("清单整体哈希错误", mutate)

    def test_corrupt_manifest_points_missing_block(self) -> None:
        def mutate(d: str) -> None:
            path = os.path.join(d, "manifests.json")
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            doc["manifests"][0]["block_ids"][0] = "a" * 64
            doc["manifests"][0]["content_hash"] = hash_block_ids(
                doc["manifests"][0]["block_ids"]
            )
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        self._corrupt_case("清单引用不存在块", mutate)

    def test_corrupt_unsupported_version(self) -> None:
        def mutate(d: str) -> None:
            path = os.path.join(d, "meta.json")
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
            doc["version"] = 999
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(doc, fh)
        self._corrupt_case("版本号不支持", mutate)

    def test_load_missing_directory(self) -> None:
        with self.assertRaises(StoreCorruptionError):
            ContentStore.load(os.path.join(self.dir_path, "does-not-exist"))


# --------------------------------------------------------------------------- #
# 8. 多文件 + 参考实现综合验收
# --------------------------------------------------------------------------- #
class ReferenceAcceptanceTests(unittest.TestCase):
    def test_multi_file_dedup_diff_apply_reference_hashes(self) -> None:
        rng = random.Random(42)
        block_size = 128
        block_a = bytes(rng.getrandbits(8) for _ in range(block_size))
        block_b = bytes(rng.getrandbits(8) for _ in range(block_size))
        block_c = bytes(rng.getrandbits(8) for _ in range(block_size))

        files_v1 = {
            "f1": block_a * 3 + block_b,
            "f2": block_b * 2 + block_c,
            "f3": block_a + block_c,
        }
        # f1 末尾一个块变化，f2 不变，f3 增加一个块。
        block_d = bytes(rng.getrandbits(8) for _ in range(block_size))
        files_v2 = {
            "f1": block_a * 3 + block_d,
            "f2": block_b * 2 + block_c,
            "f3": block_a + block_c + block_d,
        }

        local = make_file_store(files_v1, block_size)
        remote = make_file_store(files_v2, block_size)

        # 去重节省：v1 中 block_a 4 次、block_b 3 次、block_c 2 次，
        # 物理 3 块 = 384 字节，逻辑 9 块 = 1152 字节。
        stats = local.stats()
        self.assertEqual(stats["block_count"], 3)
        self.assertEqual(stats["saved_bytes"], 1152 - 384)

        for path in files_v2:
            with self.subTest(path=path):
                plan = diff(local.manifests[path], remote.manifests[path])
                # 最小性：fetch 集合 == 远端块集合 - 本地块集合。
                expected_fetch = (
                    set(remote.manifests[path].block_ids)
                    - set(local.manifests[path].block_ids)
                )
                self.assertEqual(set(plan.fetch_ids), expected_fetch)
                rebuilt = local.apply_diff(plan, remote)
                self.assertEqual(rebuilt, files_v2[path])
                self.assertEqual(
                    hash_bytes(rebuilt), reference_file_hash(files_v2[path])
                )
                # 计划自带的整体哈希 == 块 ID 序列哈希。
                self.assertEqual(
                    plan.content_hash,
                    hash_block_ids(remote.manifests[path].block_ids),
                )

    def test_refcount_lifecycle_across_manifests(self) -> None:
        store = ContentStore(block_size=16)
        m1 = store.add_file("a", b"same" * 16)
        m2 = store.add_file("b", b"same" * 16 + b"other!!")
        shared = m1.block_ids[0]
        self.assertEqual(store.ref_count(shared), 8)  # 4 + 4
        store.remove_manifest("a")
        self.assertEqual(store.ref_count(shared), 4)
        self.assertEqual(store.gc(), 0)
        store.remove_manifest("b")
        self.assertEqual(store.gc(), 2)  # shared 与 other 各一块
        with self.assertRaises(BlockNotFoundError):
            store.ref_count(shared)


# --------------------------------------------------------------------------- #
# 9. CLI（main.py）行式 JSON 协议
# --------------------------------------------------------------------------- #
class CliTests(unittest.TestCase):
    def _run_session(self, commands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        stdin = io.StringIO(
            "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in commands)
        )
        out = io.StringIO()
        with redirect_stdin_compat(stdin), redirect_stdout(out):
            rc = cli.main()
        self.assertEqual(rc, 0)
        lines = [ln for ln in out.getvalue().splitlines() if ln.strip()]
        self.assertEqual(len(lines), len(commands))
        return [json.loads(ln) for ln in lines]

    def test_full_cli_workflow(self) -> None:
        # 块对齐数据：前两个 64 字节块不变，只有最后一块 B->C。
        data_v1 = b"A" * 128 + b"B" * 64
        data_v2 = b"A" * 128 + b"C" * 64
        results = self._run_session([
            {"cmd": "new_store", "block_size": 64, "max_bytes": 100_000},
            {"cmd": "add_file", "path": "f", "data_b64": b64(data_v1)},
            {"cmd": "stats"},
            {"cmd": "put_block", "data_b64": b64(b"loose")},
            {"cmd": "gc"},
            {"cmd": "dump"},
        ])
        self.assertNotIn("error", results[0])
        self.assertNotIn("error", results[1])
        self.assertGreaterEqual(results[2]["block_count"], 2)
        # loose 块计数 1，gc 不会清。
        self.assertEqual(results[4]["removed"], 0)
        self.assertIn("refs", results[5])

        # 用两个真实进程模拟两端：本地快照 + 远端快照，diff/apply。
        with tempfile.TemporaryDirectory() as tmp:
            local_dir = os.path.join(tmp, "local")
            remote_dir = os.path.join(tmp, "remote")

            def feed(commands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
                proc = subprocess.run(
                    [sys.executable, os.path.join(_HERE, "main.py")],
                    input="".join(
                        json.dumps(c) + "\n" for c in commands
                    ),
                    capture_output=True, text=True, check=True,
                )
                return [json.loads(ln) for ln in proc.stdout.splitlines() if ln.strip()]

            remote_res = feed([
                {"cmd": "new_store", "block_size": 64},
                {"cmd": "add_file", "path": "f", "data_b64": b64(data_v2)},
                {"cmd": "save", "dir": remote_dir},
            ])
            self.assertNotIn("error", remote_res[-1])

            local_res = feed([
                {"cmd": "new_store", "block_size": 64},
                {"cmd": "add_file", "path": "f", "data_b64": b64(data_v1)},
                {"cmd": "save", "dir": local_dir},
                {"cmd": "load", "dir": local_dir},
                {
                    "cmd": "diff",
                    "local_path": "f",
                    "remote_manifest": _remote_manifest(remote_dir),
                },
            ])
            plan = local_res[-1]["plan"]
            # 只有最后一个变化块需要拉取（100 字节 A 不变，尾块 B->C）。
            self.assertEqual(len(plan["fetch_ids"]), 1)

            apply_res = feed([
                {"cmd": "load", "dir": local_dir},
                {"cmd": "apply", "plan": plan, "remote_dir": remote_dir},
            ])
            applied = apply_res[-1]
            self.assertNotIn("error", applied)
            self.assertEqual(
                base64.b64decode(applied["content_b64"]), data_v2
            )
            self.assertEqual(
                applied["bytes_sha256"], reference_file_hash(data_v2)
            )
            self.assertEqual(applied["length"], len(data_v2))

    def test_cli_errors_are_json_with_error_field(self) -> None:
        results = self._run_session([
            {"cmd": "get_block", "block_id": "0" * 64},
            {"cmd": "no_such_command"},
            {"cmd": "put_block", "data_b64": "@@@not-base64@@@"},
            "not even json",
            {"cmd": "diff",
             "local_manifest": Manifest.from_data("f", b"x" * 8, 8).to_dict(),
             "remote_manifest": Manifest.from_data("f", b"x" * 8, 16).to_dict()},
        ])
        for res in results:
            self.assertIn("error", res)
        self.assertEqual(results[4]["error_type"], "BlockSizeMismatchError")
        self.assertEqual(results[4]["local_size"], 8)
        self.assertEqual(results[4]["remote_size"], 16)

    def test_cli_apply_missing_remote_block_reports_id(self) -> None:
        phantom = hash_bytes(b"missing!!!")
        plan = SyncPlan(
            block_size=8, local_path="f", remote_path="f",
            fetch_ids=[phantom], delete_ids=[], rebuild_ids=[phantom],
            remote_length=8, content_hash=hash_block_ids([phantom]),
        ).to_dict()
        with tempfile.TemporaryDirectory() as tmp:
            empty_remote = os.path.join(tmp, "remote")
            ContentStore(block_size=8).save(empty_remote)
            results = self._run_session([
                {"cmd": "new_store", "block_size": 8},
                {"cmd": "apply", "plan": plan, "remote_dir": empty_remote},
            ])
            self.assertEqual(results[1]["error_type"], "MissingBlockError")
            self.assertEqual(results[1]["missing"], [phantom])


_HERE = os.path.dirname(os.path.abspath(__file__))


def _remote_manifest(remote_dir: str) -> Dict[str, Any]:
    with open(os.path.join(remote_dir, "manifests.json"), encoding="utf-8") as fh:
        return json.load(fh)["manifests"][0]


# stdin 重定向在不同环境下的小兼容垫片。
class redirect_stdin_compat:
    def __init__(self, stream: io.StringIO) -> None:
        self.stream = stream
        self._old = None

    def __enter__(self):
        self._old = sys.stdin
        sys.stdin = self.stream
        return self

    def __exit__(self, *exc) -> None:
        sys.stdin = self._old


if __name__ == "__main__":
    unittest.main(verbosity=2)
