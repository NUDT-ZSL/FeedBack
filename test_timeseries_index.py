"""TimeSeriesIndex 的单元测试。

直接运行：``python -m unittest -v`` 或 ``python test_timeseries_index.py``。
覆盖：点校验、插入、范围查询、范围删除、批量原子性、快照/回滚
（含交错删插与嵌套回滚）、save/load 往返、坏文件错误处理、
CLI 协议，以及几万点规模下的正确性与树高平衡性。
"""

from __future__ import annotations

import io
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import unittest

from timeseries_index import (
    DuplicatePointError,
    IndexFormatError,
    InvalidPointError,
    InvalidRangeError,
    Point,
    SnapshotError,
    SnapshotExistsError,
    SnapshotNotFoundError,
    TimeSeriesIndex,
)

import main as cli

HERE = os.path.dirname(os.path.abspath(__file__))


def make_points(specs):
    """用 (point_id, series, ts, value) 元组列表快速造点。"""
    return [Point(pid, s, ts, v) for pid, s, ts, v in specs]


class PointValidationTest(unittest.TestCase):
    def test_valid_point_normalizes_int_value_to_float(self):
        p = Point("p1", "s1", 10, 3)
        self.assertEqual(p.value, 3.0)
        self.assertIsInstance(p.value, float)
        self.assertIsInstance(p, Point)

    def test_empty_id_and_series_rejected(self):
        with self.assertRaises(InvalidPointError):
            Point("", "s", 1, 1.0)
        with self.assertRaises(InvalidPointError):
            Point("p", "", 1, 1.0)

    def test_ts_must_be_real_integer(self):
        Point("p", "s", 0, 1.0)  # 0 可以
        Point("p", "s", -5, 1.0)  # 负数可以
        with self.assertRaises(InvalidPointError):
            Point("p", "s", 1.5, 1.0)  # float 不行
        with self.assertRaises(InvalidPointError):
            Point("p", "s", True, 1.0)  # bool 虽是 int 子类也不行
        with self.assertRaises(InvalidPointError):
            Point("p", "s", "1", 1.0)

    def test_value_must_be_finite_number(self):
        for bad in (float("nan"), float("inf"), float("-inf"), "1.0", None, True):
            with self.assertRaises(InvalidPointError):
                Point("p", "s", 1, bad)

    def test_from_dict_missing_and_extra_fields(self):
        with self.assertRaises(InvalidPointError):
            Point.from_dict({"point_id": "p", "series": "s", "ts": 1})
        with self.assertRaises(InvalidPointError):
            Point.from_dict(
                {"point_id": "p", "series": "s", "ts": 1, "value": 1.0, "x": 2}
            )
        with self.assertRaises(InvalidPointError):
            Point.from_dict(["not", "a", "mapping"])

    def test_frozen(self):
        p = Point("p", "s", 1, 1.0)
        with self.assertRaises(Exception):
            p.ts = 2  # type: ignore[misc]


class InsertAndBasicQueryTest(unittest.TestCase):
    def test_insert_and_get(self):
        idx = TimeSeriesIndex()
        idx.insert(Point("p1", "cpu", 5, 0.5))
        idx.insert({"point_id": "p2", "series": "cpu", "ts": 6, "value": 0.7})
        self.assertEqual(idx.get_point("p1").value, 0.5)
        self.assertIsNone(idx.get_point("nope"))
        self.assertEqual(len(idx), 2)
        self.assertEqual(idx.list_series(), ["cpu"])

    def test_duplicate_point_id_rejected(self):
        idx = TimeSeriesIndex()
        idx.insert(Point("p1", "cpu", 5, 0.5))
        with self.assertRaises(DuplicatePointError):
            idx.insert(Point("p1", "mem", 9, 1.0))
        # 不同 series 同 ts 允许；同 series 靠 point_id 区分
        idx.insert(Point("p2", "cpu", 5, 0.6))
        idx.insert(Point("p3", "cpu", 5, 0.7))
        self.assertEqual(idx.series_count("cpu"), 3)

    def test_list_series_sorted_and_drops_empty_buckets(self):
        idx = TimeSeriesIndex()
        idx.insert_many(
            [
                Point("a", "zeta", 1, 1.0),
                Point("b", "alpha", 1, 1.0),
                Point("c", "mid", 1, 1.0),
            ]
        )
        self.assertEqual(idx.list_series(), ["alpha", "mid", "zeta"])
        idx.range_delete("alpha", 0, 100)
        self.assertEqual(idx.list_series(), ["mid", "zeta"])
        self.assertEqual(idx.series_count("alpha"), 0)


class RangeQueryTest(unittest.TestCase):
    def setUp(self):
        self.idx = TimeSeriesIndex()
        # 同 ts 多点、ts 乱序插入
        self.idx.insert_many(
            make_points(
                [
                    ("a", "s", 10, 1.0),
                    ("b", "s", 5, 2.0),
                    ("c", "s", 10, 3.0),
                    ("d", "s", 10, 0.5),
                    ("e", "s", 7, 4.0),
                    ("f", "s", 15, 5.0),
                    ("g", "other", 10, 9.0),
                ]
            )
        )

    def test_empty_index_and_missing_series(self):
        empty = TimeSeriesIndex()
        self.assertEqual(empty.range_query("x", 0, 100), [])
        self.assertEqual(self.idx.range_query("nope", 0, 100), [])

    def test_half_open_ordering(self):
        ids = [p.point_id for p in self.idx.range_query("s", 5, 11)]
        # ts=5 的 b；ts=7 的 e；ts=10 的按 point_id：a, c, d；ts=15 不含
        self.assertEqual(ids, ["b", "e", "a", "c", "d"])

        only_five = [p.point_id for p in self.idx.range_query("s", 5, 7)]
        self.assertEqual(only_five, ["b"])

        hit_ten = [p.point_id for p in self.idx.range_query("s", 10, 11)]
        self.assertEqual(hit_ten, ["a", "c", "d"])

    def test_start_equals_end_is_empty(self):
        self.assertEqual(self.idx.range_query("s", 10, 10), [])

    def test_start_greater_than_end_rejected(self):
        with self.assertRaises(InvalidRangeError):
            self.idx.range_query("s", 10, 5)
        with self.assertRaises(InvalidRangeError):
            self.idx.range_query("s", 1.5, 10)

    def test_series_isolation(self):
        self.assertEqual(
            [p.point_id for p in self.idx.range_query("other", 0, 100)],
            ["g"],
        )

    def test_negative_and_wide_ranges(self):
        self.assertEqual(
            [p.point_id for p in self.idx.range_query("s", -100, 100)],
            ["b", "e", "a", "c", "d", "f"],
        )
        self.assertEqual(self.idx.range_query("s", 100, 200), [])


class RangeDeleteTest(unittest.TestCase):
    def setUp(self):
        self.idx = TimeSeriesIndex()
        self.idx.insert_many(
            make_points(
                [
                    ("a", "s", 1, 1.0),
                    ("b", "s", 2, 1.0),
                    ("c", "s", 2, 2.0),
                    ("d", "s", 3, 1.0),
                ]
            )
        )

    def test_missing_series_and_empty_range(self):
        self.assertEqual(self.idx.range_delete("nope", 0, 10), 0)
        self.assertEqual(self.idx.range_delete("s", 2, 2), 0)
        self.assertEqual(self.idx.total_points, 4)

    def test_start_greater_than_end_rejected(self):
        before = self.idx.get_state()
        with self.assertRaises(InvalidRangeError):
            self.idx.range_delete("s", 3, 2)
        # 报错不能有任何副作用：整桶仍在、点数不变
        self.assertEqual(self.idx.get_state(), before)
        self.assertEqual(self.idx.total_points, 4)
        self.assertEqual(
            [p.point_id for p in self.idx.range_query("s", 0, 100)],
            ["a", "b", "c", "d"],
        )

    def test_non_integer_bounds_rejected_without_side_effects(self):
        for bad_start, bad_end in ((1.5, 3), (1, "3"), (True, 3)):
            with self.assertRaises(InvalidRangeError):
                self.idx.range_delete("s", bad_start, bad_end)
        self.assertEqual(self.idx.total_points, 4)

    def test_delete_half_open_and_query_afterwards(self):
        deleted = self.idx.range_delete("s", 2, 3)
        self.assertEqual(deleted, 2)
        self.assertEqual(
            [p.point_id for p in self.idx.range_query("s", 0, 100)],
            ["a", "d"],
        )
        # 全局点表同步删除
        self.assertIsNone(self.idx.get_point("b"))
        self.assertIsNone(self.idx.get_point("c"))
        self.assertIsNotNone(self.idx.get_point("a"))
        self.assertEqual(self.idx.series_count("s"), 2)

    def test_delete_whole_bucket_removes_series(self):
        self.assertEqual(self.idx.range_delete("s", 0, 100), 4)
        self.assertEqual(self.idx.list_series(), [])
        self.assertEqual(self.idx.range_query("s", 0, 100), [])
        # 清空后可以重新插入同名 series
        self.idx.insert(Point("x", "s", 1, 1.0))
        self.assertEqual(self.idx.series_count("s"), 1)

    def test_delete_then_reinsert_same_ts(self):
        self.idx.range_delete("s", 2, 3)
        self.idx.insert(Point("b2", "s", 2, 9.0))
        self.assertEqual(
            [p.point_id for p in self.idx.range_query("s", 2, 3)], ["b2"]
        )


class InsertManyAtomicityTest(unittest.TestCase):
    def test_all_or_nothing_on_existing_duplicate(self):
        idx = TimeSeriesIndex()
        idx.insert(Point("old", "s", 0, 1.0))
        with self.assertRaises(DuplicatePointError):
            idx.insert_many(
                [
                    Point("n1", "s", 1, 1.0),
                    Point("n2", "s", 2, 2.0),
                    Point("old", "s2", 3, 3.0),  # 与已有冲突
                    Point("n3", "s", 4, 4.0),
                ]
            )
        self.assertEqual(idx.total_points, 1)
        self.assertEqual(idx.list_series(), ["s"])
        self.assertIsNone(idx.get_point("n1"))
        self.assertEqual(idx.get_state()["series_points"], {"s": 1})

    def test_all_or_nothing_on_duplicate_within_batch(self):
        idx = TimeSeriesIndex()
        with self.assertRaises(DuplicatePointError):
            idx.insert_many(
                [
                    {"point_id": "x", "series": "s", "ts": 1, "value": 1.0},
                    {"point_id": "x", "series": "s", "ts": 2, "value": 2.0},
                ]
            )
        self.assertEqual(idx.total_points, 0)

    def test_all_or_nothing_on_invalid_point(self):
        idx = TimeSeriesIndex()
        with self.assertRaises(InvalidPointError):
            idx.insert_many(
                [
                    Point("ok", "s", 1, 1.0),
                    Point("bad", "s", 2, float("nan")),
                ]
            )
        self.assertEqual(idx.total_points, 0)

    def test_accepts_iterator_and_empty(self):
        idx = TimeSeriesIndex()
        idx.insert_many(Point(f"p{i}", "s", i, float(i)) for i in range(5))
        self.assertEqual(idx.total_points, 5)
        idx.insert_many([])  # 空批次无副作用
        self.assertEqual(idx.total_points, 5)

    def test_rejects_non_iterable_and_string(self):
        idx = TimeSeriesIndex()
        with self.assertRaises(InvalidPointError):
            idx.insert_many("not-a-list")
        with self.assertRaises(InvalidPointError):
            idx.insert_many(123)


class SnapshotRollbackTest(unittest.TestCase):
    def test_interleaved_delete_insert_after_rollback(self):
        """题目第 7 条：快照点 A、B；之后删 A 插 C；回滚后 A、B 在，C 不在。"""
        idx = TimeSeriesIndex()
        idx.insert_many(
            [Point("A", "s", 1, 1.0), Point("B", "s", 2, 2.0)]
        )
        idx.snapshot("snap1")

        idx.range_delete("s", 1, 2)  # 删 A
        idx.insert(Point("C", "s", 3, 3.0))
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["B", "C"]
        )

        idx.rollback("snap1")
        ids = [p.point_id for p in idx.range_query("s", 0, 100)]
        self.assertEqual(ids, ["A", "B"])
        self.assertIsNotNone(idx.get_point("A"))
        self.assertIsNone(idx.get_point("C"))
        self.assertEqual(idx.total_points, 2)

    def test_insert_after_rollback_works(self):
        idx = TimeSeriesIndex()
        idx.insert(Point("A", "s", 1, 1.0))
        idx.snapshot("base")
        idx.insert(Point("B", "s", 2, 2.0))
        idx.rollback("base")
        idx.insert(Point("B2", "s", 2, 2.0))
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A", "B2"]
        )

    def test_rollback_missing_snapshot(self):
        idx = TimeSeriesIndex()
        with self.assertRaises(SnapshotNotFoundError):
            idx.rollback("ghost")

    def test_snapshot_name_validation(self):
        idx = TimeSeriesIndex()
        idx.snapshot("s")
        with self.assertRaises(SnapshotExistsError):
            idx.snapshot("s")
        with self.assertRaises(SnapshotError):
            idx.snapshot("")

    def test_nested_rollbacks_and_later_snapshots_survive(self):
        """s1 -> s2 -> 回滚 s1 -> s3 -> 回滚 s2（更晚快照仍可用）。"""
        idx = TimeSeriesIndex()
        idx.insert(Point("A", "s", 1, 1.0))
        idx.snapshot("s1")
        idx.insert(Point("B", "s", 2, 2.0))
        idx.snapshot("s2")
        idx.insert(Point("C", "s", 3, 3.0))
        self.assertEqual(idx.total_points, 3)

        idx.rollback("s1")
        self.assertEqual(idx.total_points, 1)
        self.assertEqual(idx.list_snapshots(), ["s1", "s2"])

        idx.insert(Point("D", "s", 4, 4.0))
        idx.snapshot("s3")
        # 回滚到“更早创建但比当前状态晚”的 s2：题目要求仍可用且状态精确
        idx.rollback("s2")
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A", "B"]
        )
        self.assertEqual(sorted(idx.list_snapshots()), ["s1", "s2", "s3"])

        # 再跳回 s3，确认来回切换不互相破坏
        idx.rollback("s3")
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A", "D"]
        )
        idx.rollback("s1")
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A"]
        )

    def test_rollback_restores_deleted_series(self):
        idx = TimeSeriesIndex()
        idx.insert_many(
            [Point("a", "s1", 1, 1.0), Point("b", "s2", 1, 1.0)]
        )
        idx.snapshot("both")
        idx.range_delete("s2", 0, 100)
        self.assertEqual(idx.list_series(), ["s1"])
        idx.rollback("both")
        self.assertEqual(idx.list_series(), ["s1", "s2"])
        self.assertEqual(idx.series_count("s2"), 1)

    def test_empty_index_snapshot(self):
        idx = TimeSeriesIndex()
        idx.snapshot("empty")
        idx.insert(Point("a", "s", 1, 1.0))
        idx.rollback("empty")
        self.assertEqual(idx.total_points, 0)
        self.assertEqual(idx.list_series(), [])

    def test_delete_snapshot(self):
        idx = TimeSeriesIndex()
        idx.snapshot("s")
        idx.delete_snapshot("s")
        with self.assertRaises(SnapshotNotFoundError):
            idx.rollback("s")
        with self.assertRaises(SnapshotNotFoundError):
            idx.delete_snapshot("s")

    def test_rollback_does_not_mutate_snapshot_on_later_edits(self):
        idx = TimeSeriesIndex()
        for i in range(20):
            idx.insert(Point(f"p{i}", "s", i, float(i)))
        idx.snapshot("base")
        idx.range_delete("s", 0, 10)
        idx.rollback("base")
        idx.range_delete("s", 10, 20)
        idx.rollback("base")  # 第二次回滚仍应拿到完整 20 点
        self.assertEqual(idx.total_points, 20)
        self.assertEqual(len(idx.range_query("s", 0, 20)), 20)


class PersistentSnapshotTest(unittest.TestCase):
    """结构共享快照：O(1) 开销、分支隔离、根引用共享。"""

    @staticmethod
    def _build(n):
        idx = TimeSeriesIndex()
        idx.insert_many(
            Point(f"p{i:06d}", f"s{i % 4}", i % 500, float(i))
            for i in range(n)
        )
        return idx

    def test_snapshot_cost_does_not_scale_with_total_points(self):
        """1 万 / 5 万两档：单次 snapshot 耗时不随总点数线性增长。"""
        results = {}
        build_seconds = {}
        for n in (10_000, 50_000):
            start = time.perf_counter()
            idx = self._build(n)
            build_seconds[n] = time.perf_counter() - start

            # 预热，避免首次计时包含一次性开销
            idx.snapshot("warmup")
            idx.delete_snapshot("warmup")

            start = time.perf_counter()
            for k in range(20):
                idx.snapshot(f"s{k}")
            elapsed = time.perf_counter() - start
            results[n] = elapsed / 20

        t10k, t50k = results[10_000], results[50_000]
        # O(1) 操作：5 倍数据量下单次快照耗时不应同比例增长
        self.assertLess(
            t50k / max(t10k, 1e-9), 3.0,
            f"snapshot 耗时疑似随点数线性增长: 10k={t10k*1e6:.1f}us, "
            f"50k={t50k*1e6:.1f}us",
        )
        # 绝对上限也远低于建索引耗时（旧实现整树拷贝会到秒级）
        self.assertLess(results[50_000] * 20, build_seconds[50_000])
        self.assertLess(results[50_000], 0.005)

    def test_snapshots_share_root_references(self):
        """快照不复制数据：保存的根与当前根是同一对象。"""
        idx = self._build(1000)
        idx.snapshot("a")
        idx.snapshot("b")  # 无变更时连打两次
        root_a = idx._snapshots["a"]  # noqa: SLF001
        root_b = idx._snapshots["b"]  # noqa: SLF001
        self.assertIs(root_a[0], root_b[0])
        self.assertIs(root_a[1], root_b[1])
        self.assertIs(root_a[0], idx._series_root)  # noqa: SLF001

        idx.insert(Point("new", "s0", 999_999, 1.0))
        # 修改后当前根换了，但快照根仍是旧对象、旧状态
        self.assertIsNot(root_a[0], idx._series_root)  # noqa: SLF001
        self.assertEqual(root_a[2], 1000)
        self.assertEqual(idx.total_points, 1001)
        idx.rollback("a")
        self.assertEqual(idx.total_points, 1000)
        self.assertIsNone(idx.get_point("new"))

    def test_branch_isolation_after_rollback(self):
        """题目第 2 条场景：A 快照 -> 插 C 打 B -> 回滚 A -> 开新分支 ->
        回滚 B 必须是 A+C，不能带入回滚期间新插的点。"""
        idx = TimeSeriesIndex()
        idx.insert(Point("A", "s", 1, 1.0))
        idx.snapshot("snapA")

        idx.insert(Point("C", "s", 3, 3.0))
        idx.snapshot("snapB")

        # 回到 A，随后在 A 这条分支上又删又插
        idx.rollback("snapA")
        idx.insert(Point("D", "s", 4, 4.0))
        idx.insert(Point("E", "s", 5, 5.0))
        idx.snapshot("snapBranch")
        idx.range_delete("s", 0, 2)  # 删掉 A
        self.assertEqual(idx.total_points, 2)

        # 跳回 B：世界应为 A+C，与新分支完全无关
        idx.rollback("snapB")
        ids = [p.point_id for p in idx.range_query("s", 0, 100)]
        self.assertEqual(ids, ["A", "C"])
        self.assertIsNone(idx.get_point("D"))
        self.assertIsNone(idx.get_point("E"))

        # 再跳回新分支，然后跳回 A，反复来回都精确
        idx.rollback("snapBranch")
        self.assertEqual(
            sorted(p.point_id for p in idx.range_query("s", 0, 100)),
            ["A", "D", "E"],
        )
        idx.rollback("snapA")
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A"]
        )
        idx.rollback("snapB")
        self.assertEqual(
            [p.point_id for p in idx.range_query("s", 0, 100)], ["A", "C"]
        )

    def test_many_snapshots_with_edits_rollback_each_exact(self):
        """连打 20 个快照、每个之间都有删插，逐个回滚状态必须精确。"""
        idx = TimeSeriesIndex()
        idx.insert_many(
            Point(f"base{i}", "s", i, 1.0) for i in range(100)
        )
        expected = {}
        for k in range(20):
            idx.snapshot(f"snap{k}")
            expected[f"snap{k}"] = (
                idx.total_points,
                sorted(
                    (p.ts, p.point_id)
                    for p in idx.range_query("s", -10**9, 10**9)
                ),
            )
            # 每个快照后删一批、插一批
            idx.range_delete("s", 5 * k, 5 * k + 5)
            idx.insert(Point(f"new{k}", "s2", k, float(k)))

        for k in reversed(range(20)):
            idx.rollback(f"snap{k}")
            total, keys = expected[f"snap{k}"]
            self.assertEqual(idx.total_points, total)
            self.assertEqual(
                sorted(
                    (p.ts, p.point_id)
                    for p in idx.range_query("s", -10**9, 10**9)
                ),
                keys,
            )


class PersistenceTest(unittest.TestCase):
    def _build_index(self):
        idx = TimeSeriesIndex()
        idx.insert_many(
            make_points(
                [
                    ("a", "s1", 1, 1.5),
                    ("b", "s1", 1, 2.5),
                    ("c", "s2", -3, -0.25),
                    ("d", "s1", 10, 4.0),
                ]
            )
        )
        idx.snapshot("snap_with_all")
        idx.range_delete("s1", 1, 2)  # 删 a
        idx.insert(Point("e", "s2", 7, 7.0))
        idx.snapshot("snap_after_changes")
        return idx

    def _assert_indexes_equal(self, a, b):
        self.assertEqual(a.get_state(), b.get_state())
        for series in a.list_series():
            pa = a.range_query(series, -10**18, 10**18)
            pb = b.range_query(series, -10**18, 10**18)
            self.assertEqual([p.to_dict() for p in pa], [p.to_dict() for p in pb])

    def test_save_load_roundtrip(self):
        idx = self._build_index()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "idx.json")
            idx.save(path)
            loaded = TimeSeriesIndex.load(path)

        self._assert_indexes_equal(idx, loaded)
        self.assertEqual(loaded.list_snapshots(), ["snap_after_changes", "snap_with_all"])

        # 快照在新进程对象上同样可回滚，且状态精确
        loaded.rollback("snap_with_all")
        self.assertEqual(loaded.total_points, 4)
        self.assertEqual(
            sorted(p.point_id for p in loaded.range_query("s1", -10**9, 10**9)),
            ["a", "b", "d"],
        )
        loaded.rollback("snap_after_changes")
        # 删的是 s1 的 [1,2)，ts=1 的 a、b 都被删，只剩 d；s2 有 c、e
        self.assertEqual(loaded.total_points, 3)
        self.assertIsNotNone(loaded.get_point("e"))
        self.assertIsNone(loaded.get_point("a"))
        self.assertIsNone(loaded.get_point("b"))

    def test_save_overwrite_and_resave(self):
        idx = TimeSeriesIndex()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "idx.json")
            idx.save(path)  # 空索引
            idx.insert(Point("a", "s", 1, 1.0))
            idx.save(path)  # 覆盖已有文件
            loaded = TimeSeriesIndex.load(path)
            self.assertEqual(loaded.total_points, 1)
            # 再次保存/加载，验证重建后的索引可继续持久化
            loaded.save(os.path.join(tmp, "idx2.json"))
            again = TimeSeriesIndex.load(os.path.join(tmp, "idx2.json"))
            self.assertEqual(again.get_point("a").ts, 1)

    def test_corrupt_files_raise_clear_errors(self):
        with tempfile.TemporaryDirectory() as tmp:

            def write(name, text):
                path = os.path.join(tmp, name)
                with open(path, "w", encoding="utf-8") as f:
                    f.write(text)
                return path

            with self.assertRaisesRegex(IndexFormatError, "读取文件"):
                TimeSeriesIndex.load(os.path.join(tmp, "missing.json"))

            p = write("syntax.json", "{not json")
            with self.assertRaisesRegex(IndexFormatError, "JSON 解析失败"):
                TimeSeriesIndex.load(p)

            good = self._build_index().to_dict()

            bad_top = dict(good)
            del bad_top["snapshots"]
            p = write("missing_field.json", json.dumps(bad_top))
            with self.assertRaisesRegex(IndexFormatError, "缺少顶层字段"):
                TimeSeriesIndex.load(p)

            bad_fmt = dict(good)
            bad_fmt["format"] = "wrong"
            p = write("bad_format.json", json.dumps(bad_fmt))
            with self.assertRaisesRegex(IndexFormatError, "format"):
                TimeSeriesIndex.load(p)

            # schema_version 不支持 / 类型错误
            bad_ver = dict(good)
            bad_ver["schema_version"] = 99
            p = write("bad_version.json", json.dumps(bad_ver))
            with self.assertRaisesRegex(IndexFormatError, "schema_version=99"):
                TimeSeriesIndex.load(p)

            bad_ver_type = dict(good)
            bad_ver_type["schema_version"] = "1"
            p = write("bad_version_type.json", json.dumps(bad_ver_type))
            with self.assertRaisesRegex(IndexFormatError, "schema_version 必须是整数"):
                TimeSeriesIndex.load(p)

            # 缺少 schema_version（包括只有旧版 version 字段的旧文件）
            for name_, payload in (
                ("missing_version.json", {k: v for k, v in good.items()
                                          if k != "schema_version"}),
                ("legacy_version.json", {**{k: v for k, v in good.items()
                                            if k != "schema_version"},
                                         "version": 1}),
            ):
                p = write(name_, json.dumps(payload))
                with self.assertRaisesRegex(
                    IndexFormatError, "缺少顶层字段: schema_version"
                ):
                    TimeSeriesIndex.load(p)

            # 其它必填顶层字段缺失时也要点名缺了哪个
            for missing_key in ("format", "series", "snapshots"):
                p = write(
                    f"missing_{missing_key}.json",
                    json.dumps({k: v for k, v in good.items() if k != missing_key}),
                )
                with self.assertRaisesRegex(
                    IndexFormatError, f"缺少顶层字段: {missing_key}"
                ):
                    TimeSeriesIndex.load(p)

            bad_points = json.loads(json.dumps(good))
            bad_points["series"]["s1"][0]["ts"] = 1.5
            p = write("bad_ts.json", json.dumps(dict(bad_points)))
            with self.assertRaisesRegex(IndexFormatError, "ts 必须是整数"):
                TimeSeriesIndex.load(p)

            # live、每个快照是各自独立的世界；重复检测针对同一个世界内部。
            # 在 live 的 s2 中再放一个已存在于 live 的 d -> 必须报错。
            dup = json.loads(json.dumps(good))
            dup["series"]["s2"].append(
                {"point_id": "d", "series": "s2", "ts": 9, "value": 1.0}
            )
            p = write("dup_id.json", json.dumps(dup))
            with self.assertRaisesRegex(IndexFormatError, "全局唯一"):
                TimeSeriesIndex.load(p)

            # 同一快照世界内部重复也要报错
            dup_in_snap = json.loads(json.dumps(good))
            first_snap_series = dup_in_snap["snapshots"][0]["series"]
            first_snap_series["s2"].append(
                {"point_id": "e", "series": "s2", "ts": 99, "value": 1.0}
            )
            p = write("dup_id_in_snapshot.json", json.dumps(dup_in_snap))
            with self.assertRaisesRegex(IndexFormatError, "全局唯一"):
                TimeSeriesIndex.load(p)

            # 快照中的点引用了与所在桶不一致的 series
            bad_snap = json.loads(json.dumps(good))
            bad_snap["snapshots"][0]["series"]["s1"][0]["series"] = "ghost"
            p = write("bad_snapshot_ref.json", json.dumps(bad_snap))
            with self.assertRaisesRegex(IndexFormatError, "series 字段"):
                TimeSeriesIndex.load(p)

            dup_snap = json.loads(json.dumps(good))
            dup_snap["snapshots"][1]["name"] = dup_snap["snapshots"][0]["name"]
            p = write("dup_snapshot.json", json.dumps(dup_snap))
            with self.assertRaisesRegex(IndexFormatError, "快照名称重复"):
                TimeSeriesIndex.load(p)

            p = write("nan.json", '{"format": "timeseries-index", "version": 1,'
                      ' "series": {"s": [{"point_id": "x", "series": "s",'
                      ' "ts": 1, "value": NaN}]}, "snapshots": []}')
            with self.assertRaisesRegex(IndexFormatError, "非法 JSON 常量"):
                TimeSeriesIndex.load(p)

            p = write("not_object.json", "[1, 2, 3]")
            with self.assertRaisesRegex(IndexFormatError, "顶层结构"):
                TimeSeriesIndex.load(p)

    def test_dump_is_json_serializable(self):
        idx = self._build_index()
        payload = json.dumps(idx.to_dict(), allow_nan=False)
        self.assertIn("timeseries-index", payload)


class ScaleTest(unittest.TestCase):
    """几万点：与暴力实现对照，验证查询/删除正确性与树平衡。"""

    SERIES = 5
    PER_SERIES = 6000
    TS_SPAN = 500

    def setUp(self):
        rng = random.Random(20260913)
        self.idx = TimeSeriesIndex()
        # ground truth: series -> {point_id: (ts, value)}
        self.truth = {f"s{i}": {} for i in range(self.SERIES)}
        batch = []
        pid_counter = 0
        for si in range(self.SERIES):
            s = f"s{si}"
            for _ in range(self.PER_SERIES):
                ts = rng.randrange(self.TS_SPAN)
                pid = f"p{pid_counter:06d}"
                pid_counter += 1
                value = rng.random()
                batch.append(Point(pid, s, ts, value))
                self.truth[s][pid] = (ts, value)
        rng.shuffle(batch)
        self.idx.insert_many(batch)
        self.rng = rng

    def _brute(self, series, start, end):
        return sorted(
            (
                (ts, pid, value)
                for pid, (ts, value) in self.truth[series].items()
                if start <= ts < end
            )
        )

    def test_counts_and_scale_queries(self):
        self.assertEqual(
            self.idx.total_points, self.SERIES * self.PER_SERIES
        )
        state = self.idx.get_state()
        self.assertEqual(state["series_count"], self.SERIES)
        for si in range(self.SERIES):
            self.assertEqual(state["series_points"][f"s{si}"], self.PER_SERIES)

        for _ in range(20):
            s = f"s{self.rng.randrange(self.SERIES)}"
            start = self.rng.randrange(-50, self.TS_SPAN)
            end = self.rng.randrange(start, self.TS_SPAN + 50)
            got = [
                (p.ts, p.point_id, p.value)
                for p in self.idx.range_query(s, start, end)
            ]
            self.assertEqual(got, self._brute(s, start, end))

    def test_scale_deletes(self):
        total_deleted = 0
        for _ in range(10):
            si = self.rng.randrange(self.SERIES)
            s = f"s{si}"
            start = self.rng.randrange(0, self.TS_SPAN)
            end = self.rng.randrange(start, self.TS_SPAN + 1)
            expected = self._brute(s, start, end)
            got = self.idx.range_delete(s, start, end)
            self.assertEqual(got, len(expected))
            for _, pid, _ in expected:
                del self.truth[s][pid]
            total_deleted += got
            self.assertEqual(self.idx.range_query(s, start, end), [])

        for si in range(self.SERIES):
            s = f"s{si}"
            self.assertEqual(
                self.idx.range_query(s, -10**9, 10**9),
                [
                    Point(pid, s, ts, value)
                    for ts, pid, value in self._brute(s, -10**9, 10**9)
                ],
            )
            self.assertEqual(self.idx.series_count(s), len(self.truth[s]))
        self.assertEqual(
            self.idx.total_points,
            self.SERIES * self.PER_SERIES - total_deleted,
        )
        self.assertEqual(
            self.idx.get_state()["total_points"], self.idx.total_points
        )

    def test_treap_stays_balanced(self):
        idx = TimeSeriesIndex()
        n = 20000
        # 顺序键是对朴素 BST 最坏的情况，Treap 应仍保持对数高度
        for i in range(n):
            idx.insert(Point(f"p{i:06d}", "s", i, 1.0))

        # 新结构：series Treap 的键为 s，值为 (数据树根, 点数)
        series_entry = None
        cur = idx._series_root  # noqa: SLF001
        while cur is not None:
            if cur.key == "s":
                series_entry = cur.value
                break
            cur = cur.left if "s" < cur.key else cur.right
        root = series_entry[0]
        max_depth = 0
        stack = [(root, 1)]
        while stack:
            node, depth = stack.pop()
            if node is None:
                continue
            max_depth = max(max_depth, depth)
            stack.append((node.left, depth + 1))
            stack.append((node.right, depth + 1))
        self.assertLess(max_depth, 80, f"Treap 高度异常: {max_depth}")


class CliTest(unittest.TestCase):
    def run_cli(self, lines):
        buf_in = io.StringIO("\n".join(lines) + ("\n" if lines else ""))
        buf_out = io.StringIO()
        old_in, old_out = sys.stdin, sys.stdout
        sys.stdin, sys.stdout = buf_in, buf_out
        try:
            rc = cli.main([])
        finally:
            sys.stdin, sys.stdout = old_in, old_out
        out = [json.loads(line) for line in buf_out.getvalue().splitlines()]
        return rc, out

    def test_basic_command_flow(self):
        lines = [
            json.dumps({"cmd": "state"}),
            json.dumps(
                {
                    "cmd": "insert",
                    "point": {"point_id": "a", "series": "cpu", "ts": 1, "value": 0.1},
                }
            ),
            json.dumps({"cmd": "list"}),
            json.dumps({"cmd": "get", "point_id": "a"}),
            json.dumps({"cmd": "get", "point_id": "missing"}),
            json.dumps({"cmd": "query", "series": "cpu", "start": 0, "end": 2}),
            json.dumps({"cmd": "query", "series": "cpu", "start": 2, "end": 1}),
            json.dumps(
                {
                    "cmd": "insert",
                    "point": {"point_id": "a", "series": "cpu", "ts": 2, "value": 0.2},
                }
            ),
            json.dumps({"cmd": "bogus"}),
            "{broken json",
            json.dumps({"cmd": "delete", "series": "cpu", "start": 1, "end": 2}),
        ]
        rc, out = self.run_cli(lines)
        self.assertEqual(rc, 0)
        self.assertEqual(out[0]["total_points"], 0)
        self.assertTrue(out[1]["ok"])
        self.assertEqual(out[2]["series"], ["cpu"])
        self.assertEqual(out[3]["point"]["point_id"], "a")
        self.assertIsNone(out[4]["point"])
        self.assertEqual([p["point_id"] for p in out[5]["points"]], ["a"])
        self.assertIn("error", out[6])
        self.assertEqual(out[6]["cmd"], "query")
        self.assertIn("error", out[7])  # 重复 ID
        self.assertIn("error", out[8])  # 未知命令
        self.assertIn("error", out[9])  # 坏 JSON
        self.assertEqual(out[10]["deleted"], 1)

    def test_snapshot_rollback_and_persistence(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "idx.json")
            lines = [
                json.dumps({"cmd": "insert_many", "points": [
                    {"point_id": "A", "series": "s", "ts": 1, "value": 1.0},
                    {"point_id": "B", "series": "s", "ts": 2, "value": 2.0},
                ]}),
                json.dumps({"cmd": "snapshot", "name": "base"}),
                json.dumps({"cmd": "delete", "series": "s", "start": 1, "end": 2}),
                json.dumps({"cmd": "insert", "point": {
                    "point_id": "C", "series": "s", "ts": 3, "value": 3.0}}),
                json.dumps({"cmd": "rollback", "name": "base"}),
                json.dumps({"cmd": "state"}),
                json.dumps({"cmd": "save", "path": path}),
                json.dumps({"cmd": "load", "path": os.path.join(tmp, "nope.json")}),
                json.dumps({"cmd": "load", "path": path}),
                json.dumps({"cmd": "dump"}),
            ]
            rc, out = self.run_cli(lines)
            self.assertEqual(rc, 0)
            self.assertTrue(out[0]["ok"])
            self.assertEqual(out[0]["inserted"], 2)
            self.assertEqual(out[5]["total_points"], 2)
            self.assertTrue(out[6]["ok"])
            self.assertIn("error", out[7])  # load 不存在的文件
            self.assertTrue(out[8]["ok"])
            self.assertEqual(out[8]["state"]["total_points"], 2)
            self.assertEqual(out[9]["format"], "timeseries-index")

    def test_command_alias_and_blank_lines(self):
        # 支持 command 字段；空行跳过
        rc, out = self.run_cli(
            ["", json.dumps({"command": "list"}), "  "]
        )
        self.assertEqual(rc, 0)
        self.assertEqual(out, [{"series": []}])

    def test_utf8_bom_first_line_via_subprocess(self):
        """Windows 管道下首行可能带 UTF-8 BOM：必须按 utf-8-sig 解码。"""
        lines = "\n".join(
            [
                json.dumps({"cmd": "insert", "point": {
                    "point_id": "a", "series": "s", "ts": 1, "value": 1.0}}),
                json.dumps({"cmd": "state"}),
            ]
        )
        # 模拟 PowerShell/记事本写出的带 BOM 输入
        payload = b"\xef\xbb\xbf" + lines.encode("utf-8")
        proc = subprocess.run(
            [sys.executable, os.path.join(HERE, "main.py")],
            input=payload,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr.decode("utf-8", "replace"))
        out = [
            json.loads(line)
            for line in proc.stdout.decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertTrue(out[0]["ok"])
        self.assertEqual(out[1]["total_points"], 1)
        self.assertNotIn("error", out[0])


if __name__ == "__main__":
    unittest.main(verbosity=2)
