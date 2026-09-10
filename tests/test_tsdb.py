"""列式时序存储引擎的单元测试（纯标准库 unittest）。

覆盖：
* 时间戳差分/zigzag/varint 与浮点列的编码解码；
* 列块二进制格式、CRC 损坏检测；
* series_id 稳定性；
* 乱序回填多列块合并、同 ts 后写覆盖（LWW）；
* 标签精确/通配符过滤、fields 裁剪、聚合与区间聚合；
* delete_series / delete_range 与 compact 物理清理（前后查询一致）；
* save/load 快照往返与各类损坏/缺字段的错误信息；
* 边界：空存储、单点、start>=end、不存在 metric/field/series；
* CLI main.py 的 JSON 行协议；
* 10 万点写入 + 聚合查询的性能基线。
"""

from __future__ import annotations

import io
import json
import os
import random
import shutil
import struct
import sys
import tempfile
import time
import unittest
import zlib
from contextlib import redirect_stdout, redirect_stderr

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main as cli_main  # noqa: E402
from tsdb import ColumnarTSDB, CorruptionError, Point, ValidationError  # noqa: E402
from tsdb import encoding as enc  # noqa: E402
from tsdb.block import (  # noqa: E402
    MAGIC,
    VERSION,
    ColumnBlock,
    merge_block_series,
)


def make_points(metric, tags, ts_values, field="v", value_fn=float):
    return [Point(metric, dict(tags), ts, {field: value_fn(ts)}) for ts in ts_values]


class TestEncoding(unittest.TestCase):
    def test_zigzag_roundtrip(self):
        cases = [0, 1, -1, 2, -2, 63, 64, -64, 2**31, -(2**31), 2**63, -(2**63)]
        for value in cases:
            encoded = enc.zigzag_encode(value)
            self.assertGreaterEqual(encoded, 0)
            self.assertEqual(enc.zigzag_decode(encoded), value)

    def test_varint_roundtrip(self):
        for value in [0, 1, 127, 128, 16383, 16384, 2**32, 2**64 - 1]:
            raw = enc.encode_varint(value)
            decoded, pos = enc.decode_varint(raw, 0)
            self.assertEqual(decoded, value)
            self.assertEqual(pos, len(raw))

    def test_varint_negative_rejected(self):
        with self.assertRaises(ValueError):
            enc.encode_varint(-1)

    def test_varint_truncated(self):
        raw = enc.encode_varint(300)
        with self.assertRaises(ValueError):
            enc.decode_varint(raw[:-1], 0)

    def test_varint_list_and_signed_list(self):
        values = [0, 5, -3, 100, -7]
        raw = enc.encode_signed_varint_list(values)
        decoded, pos = enc.decode_signed_varint_list(raw, 0, len(values))
        self.assertEqual(decoded, values)
        self.assertEqual(pos, len(raw))

    def test_delta_roundtrip(self):
        # 含乱序差值（负差分），验证差分思想与 zigzag 共同生效。
        timestamps = [10, 20, 15, 40, 100, 99]
        raw = enc.encode_deltas(timestamps)
        decoded, _ = enc.decode_deltas(raw, 0, len(timestamps))
        self.assertEqual(decoded, timestamps)

    def test_delta_empty(self):
        self.assertEqual(enc.encode_deltas([]), b"")
        decoded, pos = enc.decode_deltas(b"", 0, 0)
        self.assertEqual(decoded, [])
        self.assertEqual(pos, 0)

    def test_delta_compression_on_regular_series(self):
        # 每秒一个点：差分编码平均约 2 字节/点，远低于裸 i64 的 8 字节。
        timestamps = list(range(1_000_000, 1_001_000))
        raw = enc.encode_deltas(timestamps)
        self.assertLess(len(raw) / len(timestamps), 2.1)
        decoded, _ = enc.decode_deltas(raw, 0, len(timestamps))
        self.assertEqual(decoded, timestamps)

    def test_doubles_roundtrip(self):
        values = [0.0, -1.5, 3.14159, 1e100, -1e-100]
        raw = enc.doubles_to_bytes(values)
        self.assertEqual(len(raw), 8 * len(values))
        decoded, _ = enc.bytes_to_doubles(raw, 0, len(values))
        self.assertEqual(decoded, values)

    def test_doubles_truncated(self):
        raw = enc.doubles_to_bytes([1.0, 2.0])
        with self.assertRaises(ValueError):
            enc.bytes_to_doubles(raw, 0, 3)


class TestColumnBlock(unittest.TestCase):
    def test_block_roundtrip(self):
        ts = [1, 2, 3, 100]
        vals = [1.5, 2.5, -3.0, 4.0]
        block = ColumnBlock.from_points("sid", "temp", ts, vals)
        raw = block.to_bytes()
        restored = ColumnBlock.from_bytes("sid", "temp", raw)
        self.assertEqual(restored.min_ts, 1)
        self.assertEqual(restored.max_ts, 100)
        self.assertEqual(restored.count, 4)
        self.assertEqual(restored.timestamps, ts)
        self.assertEqual(restored.values, vals)
        self.assertEqual(restored.size_bytes(), len(raw))

    def test_empty_block_rejected(self):
        with self.assertRaises(Exception):
            ColumnBlock.from_points("sid", "v", [], [])

    def test_length_mismatch_rejected(self):
        with self.assertRaises(Exception):
            ColumnBlock.from_points("sid", "v", [1, 2], [1.0])

    def test_read_range(self):
        ts = list(range(0, 100, 2))
        block = ColumnBlock.from_points("sid", "v", ts, [float(t) for t in ts])
        out_ts, out_vals = block.read_range(10, 20)  # 左闭右开
        self.assertEqual(out_ts, [10, 12, 14, 16, 18])
        self.assertEqual(out_vals, [10.0, 12.0, 14.0, 16.0, 18.0])
        self.assertEqual(block.read_range(1000, 2000), ([], []))

    def test_overlaps(self):
        block = ColumnBlock.from_points("sid", "v", [10, 20], [1.0, 2.0])
        self.assertTrue(block.overlaps(0, 11))
        self.assertTrue(block.overlaps(20, 30))
        self.assertFalse(block.overlaps(21, 30))
        self.assertFalse(block.overlaps(0, 10))

    def test_bad_magic(self):
        block = ColumnBlock.from_points("sid", "v", [1], [1.0])
        raw = b"XXXX" + block.to_bytes()[4:]
        with self.assertRaisesRegex(Exception, "魔数"):
            ColumnBlock.from_bytes("sid", "v", raw)

    def test_bad_version(self):
        block = ColumnBlock.from_points("sid", "v", [1], [1.0])
        raw = block.to_bytes()
        raw = raw[:4] + bytes([VERSION + 1]) + raw[5:]
        with self.assertRaisesRegex(Exception, "版本"):
            ColumnBlock.from_bytes("sid", "v", raw)

    def test_crc_corruption_detected(self):
        block = ColumnBlock.from_points("sid", "v", [1, 2], [1.0, 2.0])
        raw = bytearray(block.to_bytes())
        # 翻转 payload 中间一个字节（避开头部与 CRC）
        idx = len(raw) // 2
        raw[idx] ^= 0xFF
        with self.assertRaisesRegex(Exception, "CRC"):
            ColumnBlock.from_bytes("sid", "v", bytes(raw))

    def test_truncated_block(self):
        block = ColumnBlock.from_points("sid", "v", [1, 2], [1.0, 2.0])
        with self.assertRaises(Exception):
            ColumnBlock.from_bytes("sid", "v", block.to_bytes()[:10])

    def test_length_field_mismatch(self):
        block = ColumnBlock.from_points("sid", "v", [1, 2], [1.0, 2.0])
        raw = bytearray(block.to_bytes())
        # 篡改头部 count（u32，位于偏移 31..34）
        struct.pack_into(">I", raw, 31, 99)
        # 重新计算 CRC 让长度检查先触发
        crc = zlib.crc32(bytes(raw[:-4])) & 0xFFFFFFFF
        struct.pack_into(">I", raw, len(raw) - 4, crc)
        with self.assertRaisesRegex(Exception, "长度"):
            ColumnBlock.from_bytes("sid", "v", bytes(raw))


class TestSeriesIdentity(unittest.TestCase):
    def test_series_id_independent_of_tag_order(self):
        p1 = Point("cpu", {"host": "a", "region": "cn"}, 1, {"v": 1.0})
        p2 = Point("cpu", {"region": "cn", "host": "a"}, 2, {"v": 2.0})
        self.assertEqual(p1.series_id, p2.series_id)

    def test_series_id_differs(self):
        p1 = Point("cpu", {"host": "a"}, 1, {"v": 1.0})
        p2 = Point("cpu", {"host": "b"}, 1, {"v": 1.0})
        p3 = Point("mem", {"host": "a"}, 1, {"v": 1.0})
        self.assertNotEqual(p1.series_id, p2.series_id)
        self.assertNotEqual(p1.series_id, p3.series_id)


class TestPointValidation(unittest.TestCase):
    def test_valid_empty_tags(self):
        p = Point("cpu", {}, 0, {"v": 1.0})
        self.assertEqual(p.tags, {})

    def test_int_field_becomes_float(self):
        p = Point("cpu", {"h": "a"}, 1, {"v": 2})
        self.assertEqual(p.fields["v"], 2.0)

    def test_bad_metric(self):
        with self.assertRaises(ValidationError):
            Point("", {"h": "a"}, 1, {"v": 1.0})

    def test_bad_tag_key_or_value(self):
        with self.assertRaises(ValidationError):
            Point("cpu", {"": "a"}, 1, {"v": 1.0})
        with self.assertRaises(ValidationError):
            Point("cpu", {"h": ""}, 1, {"v": 1.0})
        with self.assertRaises(ValidationError):
            Point("cpu", "not-a-dict", 1, {"v": 1.0})

    def test_bad_timestamp(self):
        with self.assertRaises(ValidationError):
            Point("cpu", {"h": "a"}, 1.5, {"v": 1.0})

    def test_fields_constraints(self):
        with self.assertRaises(ValidationError):
            Point("cpu", {"h": "a"}, 1, {})
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.assertRaises(ValidationError):
                Point("cpu", {"h": "a"}, 1, {"v": bad})
        with self.assertRaises(ValidationError):
            Point("cpu", {"h": "a"}, 1, {"v": "x"})

    def test_from_dict_missing_key(self):
        with self.assertRaises(ValidationError):
            Point.from_dict({"metric": "cpu", "tags": {}, "ts": 1})


class TestMergeAndOverwrite(unittest.TestCase):
    def _blocks(self, sid, field, batches, seqs=None):
        blocks = [
            ColumnBlock.from_points(sid, field, list(b[0]), list(b[1]))
            for b in batches
        ]
        if seqs is None:
            seqs = list(range(1, len(blocks) + 1))
        return list(zip(blocks, seqs))

    def test_disjoint_out_of_order_blocks_merge_sorted(self):
        # 先写 100..200，再回填 50..80，两段不重叠。
        blocks = self._blocks("s", "v", [
            ([100, 150, 200], [1.0, 1.5, 2.0]),
            ([50, 80], [0.5, 0.8]),
        ])
        ts, vals = merge_block_series(blocks, 0, 1000)
        self.assertEqual(ts, [50, 80, 100, 150, 200])
        self.assertEqual(vals, [0.5, 0.8, 1.0, 1.5, 2.0])

    def test_last_write_wins_on_same_ts(self):
        blocks = self._blocks("s", "v", [
            ([1, 2, 3], [10.0, 20.0, 30.0]),
            ([2, 3, 4], [22.0, 33.0, 44.0]),   # 后写，覆盖 ts=2,3
            ([3], [333.0]),                     # 再次覆盖 ts=3
        ])
        ts, vals = merge_block_series(blocks, 0, 1000)
        self.assertEqual(ts, [1, 2, 3, 4])
        self.assertEqual(vals, [10.0, 22.0, 333.0, 44.0])
        self.assertEqual(len(ts), len(set(ts)))  # ts 必须唯一

    def test_lww_uses_block_seq_not_argument_order(self):
        # 故意把列块以“新块在前、旧块在后”的乱序传入，seq 小的仍是旧值。
        blocks = self._blocks("s", "v", [
            ([1, 2], [10.0, 20.0]),
            ([2, 3], [22.0, 33.0]),
        ], seqs=[10, 3])  # 第一个传入的块反而是后写入的
        ts, vals = merge_block_series(blocks, 0, 1000)
        self.assertEqual(ts, [1, 2, 3])
        self.assertEqual(vals, [10.0, 20.0, 33.0])  # ts=2 取 seq=10 的值

    def test_merge_respects_range(self):
        blocks = self._blocks("s", "v", [
            ([0, 10, 20], [1.0, 2.0, 3.0]),
            ([5, 15, 25], [9.0, 9.0, 9.0]),
        ])
        ts, vals = merge_block_series(blocks, 10, 20)
        self.assertEqual(ts, [10, 15])
        self.assertEqual(vals, [2.0, 9.0])


class TestEngineAppendQuery(unittest.TestCase):
    def setUp(self):
        self.db = ColumnarTSDB(shard_span=100, block_size=4)

    def test_empty_storage_queries(self):
        self.assertEqual(self.db.query("cpu", {}, 0, 100), [])
        self.assertEqual(self.db.stats()["total_points"], 0)

    def test_single_point(self):
        self.db.append([Point("cpu", {"host": "a"}, 5, {"v": 1.0})])
        results = self.db.query("cpu", {}, 0, 100)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].timestamps, [5])
        self.assertEqual(results[0].columns, {"v": [1.0]})

    def test_append_empty_batch(self):
        self.assertEqual(self.db.append([]), 0)

    def test_start_ge_end_returns_empty(self):
        self.db.append(make_points("cpu", {"host": "a"}, [1, 2]))
        self.assertEqual(self.db.query("cpu", {}, 5, 5), [])
        self.assertEqual(self.db.query("cpu", {}, 6, 5), [])

    def test_missing_metric_returns_empty(self):
        self.db.append(make_points("cpu", {"host": "a"}, [1]))
        self.assertEqual(self.db.query("nope", {}, 0, 100), [])

    def test_missing_field_returns_empty(self):
        self.db.append([Point("cpu", {"host": "a"}, 1, {"v": 1.0})])
        self.assertEqual(self.db.query("cpu", {}, 0, 100, fields=["nope"]), [])

    def test_fields_projection_only_reads_selected(self):
        self.db.append([Point("cpu", {"host": "a"}, 1, {"v": 1.0, "w": 2.0})])
        results = self.db.query("cpu", {}, 0, 100, fields=["w"])
        self.assertEqual(results[0].columns, {"w": [2.0]})

    def test_shard_pruning(self):
        self.db.append(make_points("cpu", {"host": "a"}, [0, 150, 250]))
        r = self.db.query("cpu", {}, 140, 160)
        self.assertEqual(r[0].timestamps, [150])

    def test_tag_exact_and_wildcard_filter(self):
        self.db.append([
            Point("cpu", {"host": "a", "iface": "eth0"}, 1, {"v": 1.0}),
            Point("cpu", {"host": "b", "iface": "eth1"}, 1, {"v": 2.0}),
            Point("cpu", {"host": "a", "iface": "eth1"}, 1, {"v": 3.0}),
        ])
        hosts = {
            tuple(sorted(r.tags.items())): r.columns["v"][0]
            for r in self.db.query("cpu", {"host": "*"}, 0, 10)
        }
        self.assertEqual(len(hosts), 3)  # 通配符：host 存在即可
        exact = self.db.query("cpu", {"host": "a", "iface": "eth0"}, 0, 10)
        self.assertEqual(len(exact), 1)
        self.assertEqual(exact[0].columns["v"], [1.0])
        wildcard_value = self.db.query("cpu", {"host": "a", "iface": "*"}, 0, 10)
        self.assertEqual(len(wildcard_value), 2)
        # 过滤不存在的标签键
        self.assertEqual(self.db.query("cpu", {"rack": "*"}, 0, 10), [])

    def test_same_ts_overwrite_within_and_across_batches(self):
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 1.0})])
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 2.0})])
        r = self.db.query("cpu", {}, 0, 10)
        self.assertEqual(r[0].columns["v"], [2.0])
        # 同一批次内后者覆盖前者
        self.db.append([
            Point("cpu", {"h": "b"}, 1, {"v": 1.0}),
            Point("cpu", {"h": "b"}, 1, {"v": 9.0}),
        ])
        r = self.db.query("cpu", {"h": "b"}, 0, 10)
        self.assertEqual(r[0].columns["v"], [9.0])

    def test_out_of_order_backfill_merge(self):
        self.db.append(make_points("cpu", {"h": "a"}, range(100, 200, 10)))
        self.db.append(make_points("cpu", {"h": "a"}, range(50, 80, 10)))
        r = self.db.query("cpu", {}, 0, 300)[0]
        self.assertEqual(r.timestamps, list(range(50, 80, 10)) + list(range(100, 200, 10)))

    def test_overlapping_backfill_lww_unique_ts(self):
        # 用户报告场景：先 100..200，再回填 150..179，t=160 两边都有且值不同。
        self.db.append([Point("cpu", {"h": "a"}, t, {"v": float(t)})
                        for t in range(100, 201)])
        self.db.append([Point("cpu", {"h": "a"}, t, {"v": -1.0})
                        for t in range(150, 180)])
        r = self.db.query("cpu", {}, 100, 201)[0]
        # ts 严格升序且唯一，绝不重复
        self.assertEqual(r.timestamps, sorted(set(r.timestamps)))
        self.assertEqual(len(r.timestamps), 101)
        by_ts = dict(zip(r.timestamps, r.columns["v"]))
        self.assertEqual(by_ts[160], -1.0)    # 后写入的回填值覆盖
        self.assertEqual(by_ts[149], 149.0)  # 回填区间外保持原值
        self.assertEqual(by_ts[180], 180.0)  # 右边界外保持原值
        agg = self.db.query("cpu", {}, 150, 180, agg="sum")[0]
        self.assertEqual(agg.columns["v"], [-30.0])  # 30 个 -1.0

    def test_block_size_splits_and_merges(self):
        db = ColumnarTSDB(shard_span=1000, block_size=3)
        db.append(make_points("cpu", {"h": "a"}, range(10)))
        self.assertGreaterEqual(db.stats()["blocks"], 3)
        r = db.query("cpu", {}, 0, 1000)
        self.assertEqual(r[0].timestamps, list(range(10)))

    def test_aggregations(self):
        self.db.append(make_points("cpu", {"h": "a"}, [1, 2, 3, 4]))
        for agg, expected in [
            ("sum", 10.0), ("avg", 2.5), ("min", 1.0),
            ("max", 4.0), ("count", 4.0),
        ]:
            r = self.db.query("cpu", {}, 0, 100, agg=agg)
            self.assertEqual(r[0].columns["v"], [expected], agg)
            self.assertEqual(r[0].timestamps, [0])

    def test_step_aggregation_buckets(self):
        self.db.append(make_points("cpu", {"h": "a"}, range(0, 10)))
        r = self.db.query("cpu", {}, 0, 10, agg="sum", step=3)[0]
        # 桶: [0,3) [3,6) [6,9) [9,12)∩end
        self.assertEqual(r.timestamps, [0, 3, 6, 9])
        self.assertEqual(r.columns["v"], [3.0, 12.0, 21.0, 9.0])

    def test_step_aggregation_skips_empty_buckets(self):
        self.db.append(make_points("cpu", {"h": "a"}, [0, 8]))
        r = self.db.query("cpu", {}, 0, 10, agg="count", step=4)[0]
        self.assertEqual(list(zip(r.timestamps, r.columns["v"])), [(0, 1.0), (8, 1.0)])

    def test_step_requires_agg(self):
        with self.assertRaises(ValidationError):
            self.db.query("cpu", {}, 0, 10, step=5)

    def test_invalid_agg(self):
        with self.assertRaises(ValidationError):
            self.db.query("cpu", {}, 0, 10, agg="median")

    def test_multi_series_multi_metric_result_order(self):
        self.db.append([
            Point("cpu", {"h": "a"}, 1, {"v": 1.0}),
            Point("cpu", {"h": "b"}, 1, {"v": 2.0}),
            Point("mem", {"h": "a"}, 1, {"v": 3.0}),
        ])
        r = self.db.query("cpu", {"h": "*"}, 0, 10)
        self.assertEqual(len(r), 2)
        self.assertEqual({x.tags["h"] for x in r}, {"a", "b"})
        self.assertEqual(len(self.db.query("mem", {}, 0, 10)), 1)

    def test_dict_points_accepted(self):
        self.db.append([{"metric": "cpu", "tags": {"h": "a"}, "ts": 1, "fields": {"v": 5.0}}])
        r = self.db.query("cpu", {}, 0, 10)
        self.assertEqual(r[0].columns["v"], [5.0])

    def test_append_requires_list(self):
        with self.assertRaises(ValidationError):
            self.db.append(Point("cpu", {}, 1, {"v": 1.0}))

    def test_sparse_fields_across_blocks(self):
        # 第一批只有 v，第二批有 v 和 w；raw 查询按 ts 并集对齐，缺失为 None。
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 1.0})])
        self.db.append([Point("cpu", {"h": "a"}, 2, {"v": 2.0, "w": 20.0})])
        r = self.db.query("cpu", {}, 0, 10)[0]
        self.assertEqual(r.timestamps, [1, 2])
        self.assertEqual(r.columns["v"], [1.0, 2.0])
        self.assertEqual(r.columns["w"], [None, 20.0])


class TestDeletionAndCompact(unittest.TestCase):
    def setUp(self):
        self.db = ColumnarTSDB(shard_span=100, block_size=4)

    def _seed(self):
        self.db.append(make_points("cpu", {"h": "a"}, range(0, 100, 10)))
        self.db.append(make_points("cpu", {"h": "b"}, range(0, 100, 10)))
        self.db.append(make_points("mem", {"h": "a"}, range(0, 100, 10)))

    def test_delete_nonexistent_series_noop(self):
        self._seed()
        self.assertFalse(self.db.delete_series("cpu", {"h": "zzz"}))

    def test_delete_series_hides_data(self):
        self._seed()
        self.assertTrue(self.db.delete_series("cpu", {"h": "a"}))
        r = self.db.query("cpu", {"h": "*"}, 0, 100)
        self.assertEqual([x.tags["h"] for x in r], ["b"])
        self.assertEqual(self.db.stats()["dead_series"], 1)
        self.assertGreater(self.db.stats()["dead_blocks"], 0)

    def test_delete_series_then_reappend_revives(self):
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 1.0})])
        self.db.delete_series("cpu", {"h": "a"})
        self.assertEqual(self.db.query("cpu", {}, 0, 10), [])
        self.db.append([Point("cpu", {"h": "a"}, 2, {"v": 2.0})])
        r = self.db.query("cpu", {}, 0, 10)
        self.assertEqual(r[0].columns["v"], [2.0])

    def test_delete_range_right_open_boundary(self):
        # 用户报告场景：删除 [150,180)，t=180 必须保留（end 右开）。
        self.db.append([Point("cpu", {"h": "a"}, t, {"v": float(t)})
                         for t in range(100, 201)])
        self.db.delete_range("cpu", {"h": "a"}, 150, 180)
        r = self.db.query("cpu", {"h": "a"}, 100, 201)[0]
        by_ts = dict(zip(r.timestamps, r.columns["v"]))
        self.assertNotIn(150, by_ts)
        self.assertNotIn(179, by_ts)
        self.assertIn(180, by_ts)       # 右开边界保留
        self.assertEqual(by_ts[180], 180.0)
        self.assertEqual(by_ts[149], 149.0)

    def test_delete_range_fragmented_tombstones_keep_intermediate_writes(self):
        # 两个重叠但不同时刻的删除区间之间写入的新点不能被后一次删除误杀：
        # 删 [13,27) -> 写 t=14 的新点 -> 再删 [18,20)，t=14 必须存活。
        self.db = ColumnarTSDB(shard_span=100, block_size=8)
        self.db.append(make_points("cpu", {"h": "a"}, range(10, 30)))
        self.db.delete_range("cpu", {"h": "a"}, 13, 27)
        self.db.append([Point("cpu", {"h": "a"}, 14, {"v": 77.0})])
        self.db.delete_range("cpu", {"h": "a"}, 18, 20)
        expected_ts = [10, 11, 12, 14, 27, 28, 29]
        for label, snap in [("before compact", lambda: None),
                            ("after compact", self.db.compact)]:
            snap()
            r = self.db.query("cpu", {"h": "a"}, 0, 100)[0]
            self.assertEqual(r.timestamps, expected_ts, label)
            self.assertEqual(dict(zip(r.timestamps, r.columns["v"]))[14], 77.0, label)

    def test_delete_range_hides_points(self):
        self._seed()
        self.db.delete_range("cpu", {"h": "a"}, 20, 50)
        r = self.db.query("cpu", {"h": "a"}, 0, 100)
        self.assertEqual(r[0].timestamps, [0, 10, 50, 60, 70, 80, 90])

    def test_delete_range_does_not_affect_new_writes(self):
        # 先删除 [10, 20)，再向同一范围写入：新点 seq 更大，必须可见。
        self.db.append(make_points("cpu", {"h": "a"}, [10, 15]))
        self.db.delete_range("cpu", {"h": "a"}, 10, 20)
        self.assertEqual(self.db.query("cpu", {}, 0, 100), [])
        self.db.append([Point("cpu", {"h": "a"}, 15, {"v": 99.0})])
        r = self.db.query("cpu", {}, 0, 100)
        self.assertEqual(r[0].timestamps, [15])
        self.assertEqual(r[0].columns["v"], [99.0])

    def test_delete_range_nonexistent_series(self):
        self.assertFalse(self.db.delete_range("nope", {}, 0, 10))

    def test_delete_range_start_ge_end_noop(self):
        self._seed()
        self.assertFalse(self.db.delete_range("cpu", {"h": "a"}, 50, 50))
        r = self.db.query("cpu", {"h": "a"}, 0, 100)
        self.assertEqual(len(r[0].timestamps), 10)

    def test_snapshot_queries_before_and_after_compact(self):
        self.db.append(make_points("cpu", {"h": "a"}, range(0, 300, 7)))
        # 乱序回填 + 覆盖
        self.db.append(make_points("cpu", {"h": "a"}, range(50, 90, 3),
                                  value_fn=lambda t: -1.0))
        self.db.append(make_points("cpu", {"h": "b"}, range(0, 300, 11)))
        expected = [
            (r.series_id, r.timestamps, r.columns)
            for r in self.db.query("cpu", {"h": "*"}, 0, 300)
        ]
        before = self.db.stats()
        self.db.delete_range("cpu", {"h": "a"}, 100, 200)
        self.db.delete_series("cpu", {"h": "b"})
        expected_after_del = [
            (r.series_id, r.timestamps, r.columns)
            for r in self.db.query("cpu", {"h": "*"}, 0, 300)
        ]
        info = self.db.compact()
        self.assertGreaterEqual(info["reclaimed_bytes"], 0)
        after = self.db.stats()
        # compact 后查询结果必须完全一致
        compacted = [
            (r.series_id, r.timestamps, r.columns)
            for r in self.db.query("cpu", {"h": "*"}, 0, 300)
        ]
        self.assertEqual(compacted, expected_after_del)
        self.assertEqual(after["dead_blocks"], 0)
        self.assertEqual(after["dead_series"], 0)
        self.assertLess(after["compressed_bytes"], before["compressed_bytes"])
        # 聚合结果也一致
        for agg in ("sum", "avg", "min", "max", "count"):
            r1 = self.db.query("cpu", {"h": "a"}, 0, 300, agg=agg)
            r2 = self.db.query("cpu", {"h": "a"}, 0, 300, agg=agg)
            self.assertEqual(r1, r2)

    def test_compact_empty_storage(self):
        info = self.db.compact()
        self.assertEqual(info["reclaimed_bytes"], 0)
        self.assertEqual(self.db.stats()["shards"], 0)

    def test_compact_collapses_blocks_and_preserves_overwrite(self):
        # 用户报告场景：乱序回填 + 区间删除后 compact，结果不变、块数明显下降。
        self.db = ColumnarTSDB(shard_span=3600, block_size=4)
        self.db.append([Point("m", {}, t, {"v": float(t)}) for t in range(100, 201)])
        self.db.append([Point("m", {}, t, {"v": -9.0}) for t in range(150, 180)])
        self.db.delete_range("m", {}, 120, 130)
        expected_ts, expected_vals = None, None
        r0 = self.db.query("m", {}, 100, 201)[0]
        expected_ts, expected_vals = r0.timestamps, r0.columns["v"]
        before = self.db.stats()
        self.assertGreaterEqual(before["blocks"], 13)  # 26 个点/块 * 两批
        info = self.db.compact()
        after = self.db.stats()
        r1 = self.db.query("m", {}, 100, 201)[0]
        self.assertEqual(r1.timestamps, expected_ts)
        self.assertEqual(r1.columns["v"], expected_vals)
        self.assertLess(after["blocks"], before["blocks"])
        self.assertLess(after["compressed_bytes"], before["compressed_bytes"])
        self.assertEqual(after["blocks"], 23)  # 91 点 // 4 -> 23 块
        self.assertEqual(info["reclaimed_bytes"],
                         before["compressed_bytes"] - after["compressed_bytes"])
        # 覆盖值在 compact 后仍然生效
        by_ts = dict(zip(r1.timestamps, r1.columns["v"]))
        self.assertEqual(by_ts[160], -9.0)
        self.assertNotIn(120, by_ts)
        self.assertIn(130, by_ts)  # 删除区间右开

    def test_compact_merges_backfilled_blocks(self):
        self.db.append(make_points("cpu", {"h": "a"}, range(100, 200, 10)))
        self.db.append(make_points("cpu", {"h": "a"}, range(0, 80, 10)))
        self.assertGreaterEqual(self.db.stats()["blocks"], 2)
        self.db.compact()
        # 合并后一个 shard 内每字段只剩少量列块（block_size=4 => 5 块）
        self.assertEqual(self.db.stats()["blocks"], 5)
        r = self.db.query("cpu", {}, 0, 200)
        self.assertEqual(r[0].timestamps,
                         list(range(0, 80, 10)) + list(range(100, 200, 10)))

    def test_compact_preserves_lww(self):
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 1.0})])
        self.db.append([Point("cpu", {"h": "a"}, 1, {"v": 2.0})])
        self.db.compact()
        r = self.db.query("cpu", {}, 0, 10)
        self.assertEqual(r[0].columns["v"], [2.0])
        # compact 自身应幂等
        self.db.compact()
        r = self.db.query("cpu", {}, 0, 10)
        self.assertEqual(r[0].columns["v"], [2.0])


class TestPersistence(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="tsdb-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _build_db(self):
        db = ColumnarTSDB(shard_span=100, block_size=7)
        db.append(make_points("cpu", {"h": "a", "rack": "r1"}, range(0, 250, 5)))
        db.append(make_points("cpu", {"h": "b"}, range(0, 250, 9),
                              value_fn=lambda t: t * 0.1))
        db.append([Point("cpu", {"h": "a", "rack": "r1"}, t, {"v": -7.0, "w": 3.0})
                   for t in range(30, 60, 10)])
        db.append(make_points("mem", {"h": "a"}, range(0, 120, 6)))
        return db

    def _assert_same_query(self, db1, db2, **kwargs):
        q1 = [r.to_dict() for r in db1.query(**kwargs)]
        q2 = [r.to_dict() for r in db2.query(**kwargs)]
        self.assertEqual(q1, q2)

    def test_save_load_roundtrip(self):
        db = self._build_db()
        db.delete_range("cpu", {"h": "a", "rack": "r1"}, 50, 80)
        path = os.path.join(self.tmp, "snap1")
        db.save(path)
        self.assertTrue(os.path.isfile(os.path.join(path, "manifest.json")))

        loaded = ColumnarTSDB()
        loaded.load(path)
        self.assertEqual(loaded.stats(), db.stats())
        for kwargs in [
            dict(metric="cpu", tags_filter={"h": "*"}, start=0, end=250),
            dict(metric="cpu", tags_filter={"h": "a", "rack": "r1"}, start=0, end=250),
            dict(metric="cpu", tags_filter={}, start=40, end=120,
                 fields=["v", "w"], agg="sum", step=25),
            dict(metric="mem", tags_filter={}, start=0, end=120, agg="avg"),
            dict(metric="cpu", tags_filter={"h": "b"}, start=0, end=250,
                 fields=["v"], agg="min"),
        ]:
            self._assert_same_query(db, loaded, **kwargs)

    def test_roundtrip_after_compact(self):
        db = self._build_db()
        db.delete_series("mem", {"h": "a"})
        db.compact()
        path = os.path.join(self.tmp, "snap2")
        db.save(path)
        loaded = ColumnarTSDB()
        loaded.load(path)
        self._assert_same_query(
            db, loaded, metric="cpu", tags_filter={"h": "*"}, start=0, end=250
        )
        self.assertEqual(loaded.stats(), db.stats())

    def test_save_creates_dir_and_overwrites(self):
        db = ColumnarTSDB()
        db.append(make_points("cpu", {"h": "a"}, [1, 2]))
        path = os.path.join(self.tmp, "nested", "deep", "snap")
        db.save(path)
        db.append(make_points("cpu", {"h": "a"}, [3]))
        db.save(path)  # 再次保存：旧列块文件应被清理
        loaded = ColumnarTSDB()
        loaded.load(path)
        r = loaded.query("cpu", {}, 0, 100)
        self.assertEqual(r[0].timestamps, [1, 2, 3])

    def test_load_missing_manifest(self):
        path = os.path.join(self.tmp, "empty")
        os.makedirs(path)
        db = ColumnarTSDB()
        with self.assertRaisesRegex(CorruptionError, "清单文件不存在"):
            db.load(path)

    def test_load_bad_json(self):
        path = os.path.join(self.tmp, "badjson")
        os.makedirs(path)
        with open(os.path.join(path, "manifest.json"), "w") as f:
            f.write("{not json")
        with self.assertRaisesRegex(CorruptionError, "JSON"):
            ColumnarTSDB().load(path)

    def test_load_missing_manifest_key(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "missingkey")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        del manifest["shards"]
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "缺少必需字段"):
            ColumnarTSDB().load(path)

    def test_load_missing_block_file(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "missingblock")
        db.save(path)
        os.remove(os.path.join(path, "blocks", os.listdir(os.path.join(path, "blocks"))[0]))
        with self.assertRaisesRegex(CorruptionError, "不存在"):
            ColumnarTSDB().load(path)

    def test_load_corrupted_block_file(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "corruptblock")
        db.save(path)
        block_file = os.path.join(path, "blocks",
                                  os.listdir(os.path.join(path, "blocks"))[0])
        with open(block_file, "r+b") as f:
            f.seek(40)
            f.write(b"\xff\xff\xff\xff")
        with self.assertRaisesRegex(CorruptionError, "CRC|长度"):
            ColumnarTSDB().load(path)

    def test_load_series_id_mismatch(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "sidmismatch")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        manifest["series"][0]["tags"]["h"] = "tampered"
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "series_id"):
            ColumnarTSDB().load(path)

    def test_load_unknown_format_version(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "badver")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        manifest["version"] = 999
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "版本"):
            ColumnarTSDB().load(path)

    def test_load_duplicate_series_id(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "dupsid")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        manifest["series"].append(dict(manifest["series"][0]))
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "重复"):
            ColumnarTSDB().load(path)

    def test_load_shard_index_references_unknown_series(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "badindex")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        some_shard = next(iter(manifest["shard_series"]))
        manifest["shard_series"][some_shard].append("deadbeef" * 4)
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "未登记"):
            ColumnarTSDB().load(path)

    def test_load_manifest_min_ts_greater_than_max_ts(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "badminmax")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        shard = next(iter(manifest["shards"].values()))
        record = next(iter(next(iter(shard.values())).values()))[0]
        record["min_ts"], record["max_ts"] = record["max_ts"], record["min_ts"]
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "min_ts"):
            ColumnarTSDB().load(path)

    def test_load_duplicate_block_seq(self):
        db = self._build_db()
        path = os.path.join(self.tmp, "dupseq")
        db.save(path)
        with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
            manifest = json.load(f)
        records = []
        for by_sid in manifest["shards"].values():
            for by_field in by_sid.values():
                for entries in by_field.values():
                    records.extend(entries)
        self.assertGreaterEqual(len(records), 2)
        records[1]["seq"] = records[0]["seq"]
        with open(os.path.join(path, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f)
        with self.assertRaisesRegex(CorruptionError, "block_seq"):
            ColumnarTSDB().load(path)

    def test_revive_series_after_load_then_queryable(self):
        # 删除 series -> save -> load -> append 复活：复活后必须能按 metric 查到。
        db = ColumnarTSDB(shard_span=100, block_size=8)
        db.append(make_points("cpu", {"h": "a"}, [1, 2, 3]))
        db.delete_series("cpu", {"h": "a"})
        path = os.path.join(self.tmp, "revive")
        db.save(path)
        loaded = ColumnarTSDB()
        loaded.load(path)
        self.assertEqual(loaded.query("cpu", {}, 0, 100), [])
        loaded.append([Point("cpu", {"h": "a"}, 4, {"v": 4.0})])
        r = loaded.query("cpu", {"h": "*"}, 0, 100)
        self.assertEqual(len(r), 1)
        self.assertEqual(r[0].timestamps, [4])
        self.assertEqual(r[0].columns["v"], [4.0])


class TestCLI(unittest.TestCase):
    def _run(self, commands):
        stdin = io.StringIO("\n".join(json.dumps(c) for c in commands))
        stdout = io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(io.StringIO()):
            old_stdin = sys.stdin
            old_argv = sys.argv
            sys.stdin = stdin
            sys.argv = ["main.py"]
            try:
                cli_main.main()
            finally:
                sys.stdin = old_stdin
                sys.argv = old_argv
        return [json.loads(line) for line in stdout.getvalue().splitlines() if line]

    def test_full_command_stream(self):
        tmp = tempfile.mkdtemp(prefix="tsdb-cli-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        replies = self._run([
            {"op": "append", "points": [
                {"metric": "cpu", "tags": {"h": "a"}, "ts": t, "fields": {"v": float(t)}}
                for t in range(10)]},
            {"op": "query", "metric": "cpu", "tags_filter": {"h": "*"},
             "start": 0, "end": 10, "agg": "sum", "step": 5},
            {"op": "stats"},
            {"op": "delete_range", "metric": "cpu", "tags": {"h": "a"},
             "start": 0, "end": 5},
            {"op": "query", "metric": "cpu", "tags_filter": {}, "start": 0, "end": 10},
            {"op": "compact"},
            {"op": "save", "dir": os.path.join(tmp, "snap")},
            {"op": "load", "dir": os.path.join(tmp, "snap")},
            {"op": "dump"},
        ])
        self.assertTrue(all(r["ok"] for r in replies), replies)
        self.assertEqual(replies[0]["written"], 10)
        self.assertEqual(replies[1]["results"][0]["columns"]["v"], [10.0, 35.0])
        self.assertEqual(replies[4]["results"][0]["timestamps"], [5, 6, 7, 8, 9])
        self.assertIn("shards", replies[8]["layout"])

    def test_error_is_json_with_error_field(self):
        replies = self._run([
            {"op": "append", "points": [{"metric": "", "tags": {}, "ts": 1,
                                         "fields": {"v": 1.0}}]},
            {"op": "query", "metric": "cpu"},  # 缺参数
            {"op": "frobnicate"},
            {"op": "stats"},
        ])
        self.assertFalse(replies[0]["ok"])
        self.assertIn("error", replies[0])
        self.assertFalse(replies[1]["ok"])
        self.assertIn("error", replies[1])
        self.assertFalse(replies[2]["ok"])
        # 出错不影响后续命令
        self.assertTrue(replies[3]["ok"])

    def test_malformed_json_line(self):
        stdin = io.StringIO('{"op": "stats"}\nnot-json\n{"op": "stats"}\n')
        stdout = io.StringIO()
        old_stdin = sys.stdin
        sys.stdin = stdin
        try:
            with redirect_stdout(stdout):
                cli_main.main()
        finally:
            sys.stdin = old_stdin
        replies = [json.loads(line) for line in stdout.getvalue().splitlines()]
        self.assertTrue(replies[0]["ok"])
        self.assertFalse(replies[1]["ok"])
        self.assertIn("error", replies[1])
        self.assertTrue(replies[2]["ok"])


class TestPerformance(unittest.TestCase):
    """10 万点写入与范围聚合的性能基线（普通机器秒级）。"""

    def test_100k_points_seconds_level(self):
        db = ColumnarTSDB(shard_span=3600, block_size=1024)
        rng = random.Random(42)
        points = []
        # 10 个 series * 10000 点，时间在 ~3 个小时内，少量乱序回填
        for sid in range(10):
            base = sid
            for i in range(10000):
                # 奇数噪声保证与偶数基准时间戳不碰撞，也不会跨噪声点碰撞
                noise = rng.choice([-5, -3, -1, 1, 3, 5]) if i % 50 == 0 else 0
                ts = i * 2 + noise
                points.append(Point("cpu", {"host": f"h{sid}"}, ts,
                                    {"v": float(i % 100), "w": float(sid) + i * 0.001}))
        rng.shuffle(points)
        start = time.perf_counter()
        db.append(points)
        append_elapsed = time.perf_counter() - start
        self.assertLess(append_elapsed, 10.0)

        start = time.perf_counter()
        results = db.query("cpu", {"host": "*"}, 1000, 5000,
                           fields=["v"], agg="sum", step=500)
        query_elapsed = time.perf_counter() - start
        self.assertLess(query_elapsed, 5.0)
        self.assertTrue(results)
        self.assertEqual(db.stats()["total_points"], 200000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
