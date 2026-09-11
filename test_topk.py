"""test_topk.py — topk_kernel 与 main CLI 的单元测试（仅标准库 unittest）。

运行：
    python -m unittest -v test_topk
"""

from __future__ import annotations

import io
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import unittest
from collections import defaultdict

from topk_kernel import (
    AddResult,
    MemoryLimitError,
    Record,
    SnapshotError,
    TopKEntry,
    TopKError,
    TopKTracker,
    ValidationError,
    estimate_record_size,
)
import main as cli_main


# ---------------------------------------------------------------------------
# Record 校验
# ---------------------------------------------------------------------------


class RecordValidationTest(unittest.TestCase):
    def test_defaults(self):
        r = Record("a")
        self.assertEqual((r.key, r.weight, r.ts), ("a", 1, 0))

    def test_ok(self):
        r = Record("x", 5, 12)
        self.assertEqual((r.key, r.weight, r.ts), ("x", 5, 12))

    def test_empty_key(self):
        with self.assertRaisesRegex(ValidationError, "key"):
            Record("")

    def test_non_string_key(self):
        with self.assertRaises(ValidationError):
            Record(123)  # type: ignore[arg-type]

    def test_zero_and_negative_weight(self):
        with self.assertRaisesRegex(ValidationError, "weight"):
            Record("a", 0)
        with self.assertRaisesRegex(ValidationError, "weight"):
            Record("a", -3)

    def test_negative_ts(self):
        with self.assertRaisesRegex(ValidationError, "ts"):
            Record("a", 1, -1)

    def test_bool_rejected(self):
        # bool 是 int 子类，但语义上不应被当成计数/时间
        with self.assertRaises(ValidationError):
            Record("a", True)  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            Record("a", 1, True)  # type: ignore[arg-type]

    def test_float_rejected(self):
        with self.assertRaises(ValidationError):
            Record("a", 1.5)  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            Record("a", 1, 1.0)  # type: ignore[arg-type]

    def test_very_long_key(self):
        key = "k" * 1_000_000
        r = Record(key, 1, 0)
        t = TopKTracker(k=1, window_size=10)
        res = t.add(r)
        self.assertEqual(res.estimated_count, 1)
        self.assertEqual(t.top()[0].key, key)

    def test_record_size_monotonic_in_key_length(self):
        self.assertGreater(
            estimate_record_size(Record("zzzz")),
            estimate_record_size(Record("z")),
        )


# ---------------------------------------------------------------------------
# Space-Saving 淘汰
# ---------------------------------------------------------------------------


class SpaceSavingTest(unittest.TestCase):
    def test_empty_kernel(self):
        t = TopKTracker(k=3, window_size=5)
        self.assertEqual(t.top(), [])
        self.assertEqual(t.estimate("x"), (0, 0))
        self.assertEqual(t.heavy_hitters(1), [])
        self.assertEqual(t.burst_detect(1.0), [])
        self.assertEqual(t.stats()["total_processed"], 0)

    def test_single_record(self):
        t = TopKTracker(k=3, window_size=5)
        res = t.add(Record("a", 2, 0))
        self.assertIsInstance(res, AddResult)
        self.assertEqual(res.estimated_count, 2)
        self.assertEqual(res.error_bound, 0)
        self.assertTrue(res.is_new_slot)
        self.assertEqual(res.total_processed, 1)
        self.assertEqual(res.windowed, 2)
        self.assertTrue(res.in_window)
        self.assertEqual(t.estimate("a"), (2, 0))

    def test_basic_eviction(self):
        t = TopKTracker(k=2, window_size=100)
        t.add(Record("a", 1, 0))
        t.add(Record("b", 2, 0))
        # 表满，淘汰计数最小的 a(1)
        res = t.add(Record("c", 10, 0))
        self.assertTrue(res.is_new_slot)
        self.assertEqual(res.estimated_count, 11)  # 1 + 10
        self.assertEqual(res.error_bound, 1)       # 被淘汰槽计数
        self.assertEqual(t.estimate("a"), (0, 0))  # 被淘汰，无信息
        top = t.top()
        self.assertEqual([e.key for e in top], ["c", "b"])

    def test_weighted_eviction_order(self):
        t = TopKTracker(k=3, window_size=100)
        for key, w in [("a", 5), ("b", 3), ("c", 4)]:
            t.add(Record(key, w, 0))
        # 最小计数是 b=3，淘汰 b
        t.add(Record("d", 1, 0))
        self.assertEqual(t.estimate("d"), (4, 3))
        self.assertEqual(t.estimate("b"), (0, 0))

    def test_k_one(self):
        t = TopKTracker(k=1, window_size=100)
        t.add(Record("a", 1, 0))
        t.add(Record("b", 7, 0))
        top = t.top()
        self.assertEqual(len(top), 1)
        # 只剩 b：估算 = 1 + 7 = 8，误差 = 1
        self.assertEqual(top[0], TopKEntry("b", 8, 1))

    def test_k_larger_than_distinct_keys(self):
        t = TopKTracker(k=10, window_size=100)
        for key in "abc":
            t.add(Record(key, 1, 0))
        self.assertEqual(t.slot_count, 3)
        self.assertEqual(len(t.top(10)), 3)
        self.assertEqual(t.stats()["total_evicted"], 0)

    def test_tie_break_key_ascending(self):
        t = TopKTracker(k=3, window_size=100)
        for key in "cba":
            t.add(Record(key, 1, 0))
        # 三槽计数均为 1，平局淘汰键序最小的 a；d 顶替后 count=1+1=2
        t.add(Record("d", 1, 0))
        keys = {e.key for e in t.top()}
        self.assertEqual(keys, {"b", "c", "d"})
        # top 排序：d 计数 2 在最前；b、c 计数相同按 key 升序
        self.assertEqual([e.key for e in t.top()], ["d", "b", "c"])

    def test_counter_increment_after_eviction_round(self):
        # 经典序列：k=2，a,b,a,c,b
        t = TopKTracker(k=2, window_size=100)
        steps = [
            ("a", 1, 0),   # a=1,e=0
            ("b", 1, 0),   # b=1,e=0
            ("a", 1, 0),   # a=2
            ("c", 1, 0),   # 淘汰 b(1) -> c=2,e=1
            ("b", 1, 0),   # 淘汰 a(2) 或 c(2)（key 序 a 先被淘汰）
        ]
        for key, w, ts in steps:
            t.add(Record(key, w, ts))
        # 计数估计必须是正整数、误差 <= 计数
        for e in t.top():
            self.assertGreaterEqual(e.estimated_count, 1)
            self.assertGreaterEqual(e.error_bound, 0)
            self.assertLessEqual(e.error_bound, e.estimated_count)

    def test_error_bound_guarantee(self):
        # 与精确 dict 对照：对所有仍在表中的 key，true_count >= est - err
        random.seed(123)
        k = 8
        t = TopKTracker(k=k, window_size=1_000_000)
        truth: defaultdict[str, int] = defaultdict(int)
        for i in range(20_000):
            key = f"k{random.randrange(40)}"
            w = random.randint(1, 4)
            t.add(Record(key, w, i))
            truth[key] += w
        for e in t.top(k):
            self.assertGreaterEqual(truth[e.key], e.estimated_count - e.error_bound)
            self.assertGreaterEqual(e.estimated_count, truth[e.key])

    def test_default_k_is_100(self):
        t = TopKTracker(window_size=10)
        self.assertEqual(t.k, 100)
        for i in range(150):
            t.add(Record(f"k{i}", 1, 0))
        self.assertLessEqual(t.slot_count, 100)

    def test_invalid_k(self):
        for bad in (0, -1, 1.5, True, "3"):
            with self.assertRaises(ValidationError):
                TopKTracker(k=bad)  # type: ignore[arg-type]

    def test_add_wrong_type(self):
        t = TopKTracker()
        with self.assertRaises(ValidationError):
            t.add(("a", 1, 0))  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 滑动窗口与重频检测
# ---------------------------------------------------------------------------


class WindowTest(unittest.TestCase):
    def test_window_size_zero_rejected(self):
        with self.assertRaisesRegex(ValidationError, "window_size"):
            TopKTracker(k=5, window_size=0)
        with self.assertRaises(ValidationError):
            TopKTracker(k=5, window_size=-3)

    def test_window_is_half_open(self):
        t = TopKTracker(k=10, window_size=5)
        # [0,5) 收 4 条 a；ts=5 属于下一窗口
        for ts in (0, 1, 2, 4):
            t.add(Record("a", 1, ts))
        self.assertEqual(t.window_start, 0)
        self.assertEqual(t.heavy_hitters(1), [("a", 4)])
        t.add(Record("a", 1, 5))  # 边界点属于新窗口
        self.assertEqual(t.window_start, 5)
        self.assertEqual(t.heavy_hitters(1), [("a", 1)])

    def test_late_record_counts_global_but_not_window(self):
        t = TopKTracker(k=10, window_size=5)
        for ts in (0, 1):
            t.add(Record("a", 1, ts))
        t.add(Record("b", 1, 6))  # 窗口滑到 [5,10)
        late = t.add(Record("late", 3, 2))  # ts 落在上界之外（过期）
        self.assertFalse(late.in_window)
        self.assertEqual(late.windowed, 0)
        # 全量 Top-K 仍计入
        self.assertEqual(t.estimate("late"), (3, 0))
        # 窗口内没有 late
        self.assertNotIn("late", dict(t.heavy_hitters(1)))
        self.assertEqual(t.stats()["rejected_out_of_window"], 1)
        # 原有窗口统计不受影响
        self.assertEqual(dict(t.heavy_hitters(1)), {"b": 1})

    def test_window_slide_keeps_previous(self):
        t = TopKTracker(k=10, window_size=5)
        t.add(Record("a", 3, 0))
        t.add(Record("b", 1, 2))
        t.add(Record("a", 2, 6))
        self.assertEqual(t.window_start, 5)
        self.assertEqual(t._cur, {"a": 2})
        self.assertEqual(t._prev, {"a": 3, "b": 1})

    def test_window_jump_clears_both(self):
        t = TopKTracker(k=10, window_size=5)
        t.add(Record("a", 3, 0))
        t.add(Record("b", 2, 5))
        t.add(Record("c", 1, 30))  # 跳过多个网格
        self.assertEqual(t.window_start, 30)
        self.assertEqual(t._cur, {"c": 1})
        self.assertEqual(t._prev, {})

    def test_window_alignment(self):
        t = TopKTracker(k=10, window_size=5, start_ts=10)
        r = t.add(Record("a", 1, 13))
        self.assertTrue(r.in_window)
        self.assertEqual(t.window_start, 10)
        t.add(Record("b", 1, 15))
        self.assertEqual(t.window_start, 15)
        with self.assertRaises(ValidationError):
            TopKTracker(k=10, window_size=5, start_ts=3)

    def test_heavy_hitters_ordering_and_threshold(self):
        t = TopKTracker(k=10, window_size=10)
        # a=5, b=5, c=3
        for _ in range(5):
            t.add(Record("a", 1, 0))
        for _ in range(5):
            t.add(Record("b", 1, 0))
        for _ in range(3):
            t.add(Record("c", 1, 0))
        self.assertEqual(t.heavy_hitters(4), [("a", 5), ("b", 5)])  # 同计数 key 升序
        self.assertEqual(
            t.heavy_hitters(3), [("a", 5), ("b", 5), ("c", 3)]
        )
        self.assertEqual(t.heavy_hitters(6), [])

    def test_heavy_hitters_threshold_validation(self):
        t = TopKTracker(k=5, window_size=5)
        for bad in (0, -1, 1.5, True, "3"):
            with self.assertRaises(ValidationError):
                t.heavy_hitters(bad)  # type: ignore[arg-type]

    def test_window_weighted_counts(self):
        t = TopKTracker(k=10, window_size=10)
        t.add(Record("a", 4, 0))
        t.add(Record("a", 6, 1))
        t.add(Record("b", 2, 2))
        self.assertEqual(t.heavy_hitters(5), [("a", 10)])

    def test_heavy_hitters_no_miss_vs_exact(self):
        # 验收性质：窗口统计是精确的，任何真实重频项都不能漏
        random.seed(99)
        t = TopKTracker(k=4, window_size=100)
        truth: defaultdict[str, int] = defaultdict(int)
        for i in range(5_000):
            key = f"k{random.randrange(30)}"
            w = random.randint(1, 3)
            ts = 900 + (i % 100)  # 全部落在窗口 [900,1000) 内，允许 ts 回摆
            t.add(Record(key, w, ts))
            truth[key] += w
        threshold = 200
        got = dict(t.heavy_hitters(threshold))
        for key, cnt in truth.items():
            if cnt >= threshold:
                self.assertIn(key, got)
                self.assertEqual(got[key], cnt)


# ---------------------------------------------------------------------------
# 突增检测
# ---------------------------------------------------------------------------


class BurstTest(unittest.TestCase):
    def _build(self):
        t = TopKTracker(k=20, window_size=10)
        # prev 窗口 [0,10): a=10, b=100, flat=5
        for _ in range(10):
            t.add(Record("a", 1, 0))
        for _ in range(100):
            t.add(Record("b", 1, 1))
        for _ in range(5):
            t.add(Record("flat", 1, 2))
        # cur 窗口 [10,20): a=60 (+500%), b=110 (+10%), new=3 (从无到有)
        for _ in range(60):
            t.add(Record("a", 1, 10))
        for _ in range(110):
            t.add(Record("b", 1, 11))
        for _ in range(3):
            t.add(Record("new", 1, 12))
        return t

    def test_burst_ordering(self):
        t = self._build()
        res = t.burst_detect(0.05)
        keys = [k for k, *_ in res]
        # new 是 inf 排最前；然后 a(5.0)；b(0.1) 也满足 0.05
        self.assertEqual(keys[0], "new")
        self.assertEqual(keys[1], "a")
        self.assertIn("b", keys)
        self.assertEqual(keys, ["new", "a", "b"])
        # growth 降序
        growths = [g for _, g, *_ in res]
        self.assertEqual(growths[0], math.inf)
        self.assertTrue(all(growths[i] >= growths[i + 1] for i in range(1, len(growths) - 1)))

    def test_burst_threshold_filter(self):
        t = self._build()
        keys = [k for k, *_ in t.burst_detect(1.0)]
        self.assertEqual(keys, ["new", "a"])  # b 只涨 10%
        keys = [k for k, *_ in t.burst_detect(4.0)]
        self.assertEqual(keys, ["new", "a"])
        keys = [k for k, *_ in t.burst_detect(50.0)]
        self.assertEqual(keys, ["new"])

    def test_zero_previous_is_infinite_growth(self):
        t = TopKTracker(k=5, window_size=5)
        t.add(Record("a", 1, 0))   # prev
        t.add(Record("b", 1, 5))   # cur 新出现
        res = t.burst_detect(100.0)  # 任何有限 ratio 都应命中
        self.assertEqual(len(res), 1)
        self.assertEqual(res[0][0], "b")
        self.assertEqual(res[0][1], math.inf)
        self.assertEqual(res[0][3], 0)

    def test_decline_is_not_burst(self):
        t = TopKTracker(k=5, window_size=5)
        for _ in range(10):
            t.add(Record("a", 1, 0))
        for _ in range(2):
            t.add(Record("a", 1, 5))
        self.assertEqual(t.burst_detect(0.01), [])

    def test_no_previous_window(self):
        t = TopKTracker(k=5, window_size=5)
        t.add(Record("a", 1, 0))
        # 只有当前窗口：prev 为空，a 从 0 到 1 算突增
        res = t.burst_detect(1.0)
        self.assertEqual([k for k, *_ in res], ["a"])

    def test_ratio_validation(self):
        t = TopKTracker(k=5, window_size=5)
        for bad in (0, -1, -0.5, math.nan, math.inf):
            with self.assertRaises(ValidationError):
                t.burst_detect(bad)
        with self.assertRaises(ValidationError):
            t.burst_detect("1")  # type: ignore[arg-type]

    def test_constructed_burst_hits(self):
        # 验收点：构造的突增场景必须命中
        random.seed(2024)
        t = TopKTracker(k=50, window_size=200)
        # 平稳基线 400 条
        for i in range(400):
            t.add(Record(f"bg{random.randrange(20)}", 1, i // 4))
        # 突增：bg7 在下一窗口暴增
        for i in range(200):
            t.add(Record("bg7", 1, 100 + i // 20))
        hit = {k for k, *_ in t.burst_detect(2.0)}
        self.assertIn("bg7", hit)


# ---------------------------------------------------------------------------
# 精确模式
# ---------------------------------------------------------------------------


class ExactModeTest(unittest.TestCase):
    def test_exact_tracks_all_keys(self):
        t = TopKTracker(k=2, window_size=100, exact=True)
        for key, w in [("a", 1), ("b", 2), ("c", 3), ("a", 4), ("d", 5)]:
            t.add(Record(key, w, 0))
        self.assertEqual(t.slot_count, 4)  # 不淘汰，可以超过 K
        self.assertEqual(t.exact_count("a"), 5)
        self.assertEqual(t.exact_count("b"), 2)
        self.assertEqual(t.exact_count("c"), 3)
        self.assertEqual(t.exact_count("d"), 5)
        for e in t.top():
            self.assertEqual(e.error_bound, 0)
        # top(k) 仍然只截前 k；a 与 d 计数相同(5)，按 key 升序 a 在前
        self.assertEqual([e.key for e in t.top(2)], ["a", "d"])

    def test_exact_matches_reference(self):
        random.seed(55)
        t = TopKTracker(k=5, window_size=100_000, exact=True)
        truth: defaultdict[str, int] = defaultdict(int)
        for i in range(5_000):
            key = f"k{random.randrange(50)}"
            w = random.randint(1, 3)
            t.add(Record(key, w, i))
            truth[key] += w
        for key, cnt in truth.items():
            self.assertEqual(t.exact_count(key), cnt)
            est, err = t.estimate(key)
            self.assertEqual((est, err), (cnt, 0))

    def test_cross_mode_merge_rejected(self):
        a = TopKTracker(k=5, window_size=10, exact=True)
        b = TopKTracker(k=5, window_size=10, exact=False)
        with self.assertRaises(ValidationError):
            a.merge(b)


# ---------------------------------------------------------------------------
# 合并
# ---------------------------------------------------------------------------


class MergeTest(unittest.TestCase):
    def test_merge_empty_kernels(self):
        a = TopKTracker(k=3, window_size=10)
        b = TopKTracker(k=3, window_size=10)
        a.merge(b)
        self.assertEqual(a.top(), [])
        self.assertEqual(a.stats()["total_processed"], 0)

    def test_merge_empty_with_nonempty(self):
        a = TopKTracker(k=3, window_size=10)
        b = TopKTracker(k=3, window_size=10)
        b.add(Record("x", 4, 0))
        a.merge(b)
        self.assertEqual(a.estimate("x"), (4, 0))

    def test_merge_disjoint_summaries(self):
        a = TopKTracker(k=4, window_size=10)
        b = TopKTracker(k=4, window_size=10)
        for _ in range(5):
            a.add(Record("a", 1, 0))
        a.add(Record("x", 1, 0))            # a 共 6 条
        for _ in range(4):
            b.add(Record("b", 1, 0))
        b.add(Record("y", 1, 0))            # b 共 5 条
        a.merge(b)
        self.assertEqual(a.estimate("a"), (5, 0))
        self.assertEqual(a.estimate("b"), (4, 0))
        self.assertEqual(a.estimate("x"), (1, 0))
        self.assertEqual(a.estimate("y"), (1, 0))
        self.assertEqual(a.stats()["total_processed"], 11)

    def test_merge_overlapping_keys_adds(self):
        a = TopKTracker(k=4, window_size=10)
        b = TopKTracker(k=4, window_size=10)
        for _ in range(3):
            a.add(Record("a", 1, 0))
        for _ in range(7):
            b.add(Record("a", 1, 0))
        b.add(Record("b", 5, 0))
        a.merge(b)
        self.assertEqual(a.estimate("a"), (10, 0))
        self.assertEqual(a.estimate("b"), (5, 0))

    def test_merge_prunes_to_k(self):
        # 双方各占满 K，合并后 2K 个不重叠 key -> 裁回 K，保留计数最大的 K 个
        K = 5
        a = TopKTracker(k=K, window_size=10)
        b = TopKTracker(k=K, window_size=10)
        for i in range(K):
            a.add(Record(f"a{i}", 10 + i, 0))   # 10..14
        for i in range(K):
            b.add(Record(f"b{i}", 1 + i, 0))    # 1..5
        a.merge(b)
        self.assertLessEqual(a.slot_count, K)
        keys = {e.key for e in a.top()}
        self.assertEqual(keys, {f"a{i}" for i in range(K)})  # 计数大的一方全部留下

    def test_merge_topk_dominance_property(self):
        # 需求性质：“合并后 Top-K 不应低于两者各自 Top-K 的较大者”。
        # 严格表述为次序统计量支配：合并结果第 i 名的估算计数，不低于
        # 任一方第 i 名的估算计数（对每一个排名 i=1..K 成立）。
        random.seed(77)
        K = 10
        a = TopKTracker(k=K, window_size=100_000)
        b = TopKTracker(k=K, window_size=100_000)
        for i in range(8_000):
            a.add(Record(f"k{random.randrange(80)}", random.randint(1, 3), i))
        for i in range(8_000):
            # 两个分片处于同一时间窗口，窗口状态才可对齐合并
            b.add(Record(f"k{random.randrange(80)}", random.randint(1, 3), i))
        a_counts = [e.estimated_count for e in a.top(K)]
        b_counts = [e.estimated_count for e in b.top(K)]
        import copy
        merged = copy.deepcopy(a).merge(b)
        m_counts = [e.estimated_count for e in merged.top(K)]
        for i in range(K):
            self.assertGreaterEqual(
                m_counts[i], max(a_counts[i], b_counts[i]),
                f"第 {i + 1} 名不满足支配：merged={m_counts[i]} "
                f"a={a_counts[i]} b={b_counts[i]}",
            )

    def test_merge_same_object_is_noop(self):
        # 需求边界：合并同一个 tracker（t.merge(t)）不能翻倍
        t = TopKTracker(k=5, window_size=10)
        for _ in range(3):
            t.add(Record("a", 1, 0))
        t.add(Record("b", 2, 0))
        before = t.to_dict()
        t.merge(t)
        after = t.to_dict()
        self.assertEqual(before, after)
        self.assertEqual(t.estimate("a"), (3, 0))
        self.assertEqual(t.stats()["total_processed"], 4)

    def test_merge_two_identical_disjoint_copies(self):
        # 两个内容相同但相互独立、代表不相交分区的 tracker：按语义相加
        # （这是正确的摘要合并；“不翻倍”特指 t.merge(t)，见上一测试）
        a = TopKTracker(k=5, window_size=10)
        b = TopKTracker(k=5, window_size=10)
        for tr in (a, b):
            for _ in range(3):
                tr.add(Record("a", 1, 0))
        a.merge(b)
        self.assertEqual(a.estimate("a"), (6, 0))

    def test_merge_config_mismatch_rejected(self):
        a = TopKTracker(k=3, window_size=10)
        b1 = TopKTracker(k=4, window_size=10)
        with self.assertRaises(ValidationError):
            a.merge(b1)
        b2 = TopKTracker(k=3, window_size=11)
        with self.assertRaises(ValidationError):
            a.merge(b2)
        with self.assertRaises(ValidationError):
            a.merge("not a tracker")  # type: ignore[arg-type]

    def test_merge_window_mismatch_rejected(self):
        a = TopKTracker(k=5, window_size=5)
        b = TopKTracker(k=5, window_size=5)
        a.add(Record("a", 1, 0))
        b.add(Record("b", 1, 6))  # 分别处于窗口 0 和窗口 5
        with self.assertRaisesRegex(ValidationError, "窗口起点"):
            a.merge(b)

    def test_merge_windows_add(self):
        a = TopKTracker(k=10, window_size=5)
        b = TopKTracker(k=10, window_size=5)
        a.add(Record("a", 2, 0))
        a.add(Record("a", 3, 6))   # a: cur=3, prev=2
        b.add(Record("a", 4, 6))   # cur=4
        b.add(Record("b", 1, 7))
        a.merge(b)
        self.assertEqual(a._cur, {"a": 7, "b": 1})
        self.assertEqual(a._prev, {"a": 2})

    def test_merge_exact(self):
        a = TopKTracker(k=2, window_size=10, exact=True)
        b = TopKTracker(k=2, window_size=10, exact=True)
        a.add(Record("a", 3, 0))
        b.add(Record("a", 2, 0))
        b.add(Record("b", 5, 0))
        a.merge(b)
        self.assertEqual(a.exact_count("a"), 5)
        self.assertEqual(a.exact_count("b"), 5)

    def test_merge_over_memory_limit_is_atomic(self):
        # 单体内存各自不超限，但合并后的投影超限 -> 拒绝且 self 不变
        a = TopKTracker(k=100, window_size=10, max_memory_bytes=50_000)
        b = TopKTracker(k=100, window_size=10, max_memory_bytes=50_000)
        for i in range(20):
            a.add(Record(f"a{i:02d}", 1, 0))
        for i in range(60):
            b.add(Record(f"b{i:02d}", 1, 0))
        self.assertLessEqual(a.memory_used, 50_000)
        self.assertLessEqual(b.memory_used, 50_000)
        before = a.to_dict()
        with self.assertRaises(MemoryLimitError):
            a.merge(b)
        self.assertEqual(a.to_dict(), before)  # 失败后 self 完全不变
        self.assertEqual(a.slot_count, 20)


# ---------------------------------------------------------------------------
# 内存上限
# ---------------------------------------------------------------------------


class MemoryLimitTest(unittest.TestCase):
    def test_zero_budget_rejects_first_insert(self):
        t = TopKTracker(k=10, window_size=10, max_memory_bytes=0)
        with self.assertRaises(MemoryLimitError):
            t.add(Record("a", 1, 0))
        self.assertEqual(t.slot_count, 0)
        self.assertEqual(t.stats()["total_processed"], 0)
        self.assertEqual(t.stats()["rejected_memory"], 1)
        # 被拒绝后内核仍可正常使用其它查询
        self.assertEqual(t.top(), [])

    def test_rejected_insert_changes_nothing(self):
        budget = 8_000
        t = TopKTracker(k=100, window_size=10, max_memory_bytes=budget)
        inserted = 0
        for i in range(100):
            try:
                t.add(Record(f"key{i:03d}", 1, 0))
                inserted += 1
            except MemoryLimitError:
                pass
        self.assertGreater(inserted, 0)
        self.assertLess(inserted, 100)
        self.assertLessEqual(t.memory_used, budget)
        # 之后继续插入一个已存在的 key 必须成功（更新不占新内存）
        existing = t.top()[0].key
        before = t.memory_used
        t.add(Record(existing, 5, 0))
        self.assertEqual(t.memory_used, before)

    def test_eviction_respects_budget(self):
        # 表满淘汰换 key 时，长 key 换入可能突破预算，也必须被拒绝
        t = TopKTracker(k=2, window_size=10, max_memory_bytes=3_000)
        t.add(Record("aa", 1, 0))
        t.add(Record("bb", 1, 0))
        with self.assertRaises(MemoryLimitError):
            t.add(Record("x" * 2_000, 1, 0))
        # 状态不变：aa、bb 仍在
        self.assertEqual(t.estimate("aa"), (1, 0))
        self.assertEqual(t.estimate("bb"), (1, 0))
        self.assertEqual(t.stats()["total_processed"], 2)

    def test_memory_monotonic_and_bounded_long_run(self):
        random.seed(9)
        t = TopKTracker(k=32, window_size=100, max_memory_bytes=200_000)
        accepted = 0
        for i in range(200_000):
            key = f"k{random.randrange(500)}"  # 有限 universe，窗口键集有界
            try:
                t.add(Record(key, random.randint(1, 3), i))
                accepted += 1
            except MemoryLimitError:
                pass
            if i % 10_000 == 0:
                self.assertLessEqual(t.memory_used, 200_000)
        self.assertLessEqual(t.memory_used, 200_000)
        # 堆条目受懒删除压缩限制，不会随记录数增长
        self.assertLessEqual(t.stats()["heap_entries"], 4 * 32 + 64 + 1)
        self.assertEqual(t.stats()["total_processed"], accepted)

    def test_invalid_max_memory(self):
        with self.assertRaises(ValidationError):
            TopKTracker(max_memory_bytes="1000")  # type: ignore[arg-type]
        # 负数按"不限"处理
        tr = TopKTracker(max_memory_bytes=-1)
        self.assertIsNone(tr.max_memory_bytes)


# ---------------------------------------------------------------------------
# 快照往返与损坏校验
# ---------------------------------------------------------------------------


class SnapshotTest(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def _path(self, name):
        return os.path.join(self.tmpdir, name)

    def test_roundtrip_basic(self):
        t = TopKTracker(k=5, window_size=7)
        for key, w, ts in [
            ("a", 3, 1), ("b", 1, 2), ("a", 2, 6),
            ("c", 5, 8), ("b", 4, 13), ("late", 1, 0),
        ]:
            t.add(Record(key, w, ts))
        path = self._path("s.json")
        t.save(path)
        loaded = TopKTracker.load(path)
        self.assertEqual(loaded.to_dict(), t.to_dict())

    def test_roundtrip_continue_add(self):
        t = TopKTracker(k=5, window_size=7)
        for key, w, ts in [("a", 3, 1), ("b", 1, 2), ("a", 2, 6), ("c", 5, 8)]:
            t.add(Record(key, w, ts))
        t.save(self._path("s.json"))
        loaded = TopKTracker.load(self._path("s.json"))
        for key, w, ts in [("z", 2, 14), ("a", 1, 15), ("z", 3, 16)]:
            r1 = t.add(Record(key, w, ts))
            r2 = loaded.add(Record(key, w, ts))
            self.assertEqual(r1, r2)
        self.assertEqual(t.to_dict(), loaded.to_dict())

    def test_roundtrip_exact(self):
        t = TopKTracker(k=2, window_size=5, exact=True)
        for key, w, ts in [("a", 1, 0), ("b", 1, 0), ("c", 3, 0), ("a", 2, 1)]:
            t.add(Record(key, w, ts))
        t.save(self._path("e.json"))
        loaded = TopKTracker.load(self._path("e.json"))
        self.assertEqual(loaded.to_dict(), t.to_dict())
        self.assertEqual(loaded.exact_count("a"), 3)

    def test_save_is_atomic_no_tmp_left(self):
        t = TopKTracker(k=3, window_size=5)
        t.add(Record("a", 1, 0))
        path = self._path("s.json")
        t.save(path)
        leftovers = [f for f in os.listdir(self.tmpdir) if f.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    def test_corrupt_not_json(self):
        path = self._path("bad.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaisesRegex(SnapshotError, "JSON"):
            TopKTracker.load(path)

    def test_corrupt_missing_fields(self):
        with self.assertRaises(SnapshotError):
            TopKTracker.from_dict({})
        t = TopKTracker(k=3, window_size=5)
        t.add(Record("a", 1, 0))
        good = t.to_dict()
        for tamper in (
            lambda d: d.pop("slots"),
            lambda d: d["config"].pop("k"),
            lambda d: d.pop("stats"),
            lambda d: d["window"].pop("current"),
        ):
            bad = json.loads(json.dumps(good))
            tamper(bad)
            with self.assertRaises(SnapshotError):
                TopKTracker.from_dict(bad)

    def test_corrupt_invalid_values(self):
        t = TopKTracker(k=3, window_size=5)
        for key, w, ts in [("a", 2, 0), ("b", 3, 1), ("c", 4, 2)]:
            t.add(Record(key, w, ts))
        t.add(Record("a", 1, 6))
        good = t.to_dict()
        tamper_cases = [
            ("slots>k", lambda d: d["slots"].extend(json.loads(json.dumps(d["slots"])))),
            ("count<=0", lambda d: d["slots"][0].__setitem__("count", 0)),
            ("count float", lambda d: d["slots"][0].__setitem__("count", 1.5)),
            ("error<0", lambda d: d["slots"][0].__setitem__("error", -1)),
            ("error>count", lambda d: d["slots"][0].__setitem__("error", 9999)),
            ("dup key", lambda d: d["slots"].append(json.loads(json.dumps(d["slots"][0])))),
            ("empty slot key", lambda d: d["slots"][0].__setitem__("key", "")),
            ("window misaligned", lambda d: d["window"].__setitem__("start", 3)),
            ("neg stats", lambda d: d["stats"].__setitem__("total_weight", -1)),
            ("bad version", lambda d: d.__setitem__("version", 999)),
            ("weight inconsistent", lambda d: d["stats"].__setitem__("total_weight", 1)),
            ("start null but bucket", lambda d: d["window"].__setitem__("start", None)),
            ("neg window count", lambda d: d["current"].update(x=-1) if False else d["window"]["current"].__setitem__("zz", -1)),
        ]
        for name, tamper in tamper_cases:
            with self.subTest(case=name):
                bad = json.loads(json.dumps(good))
                tamper(bad)
                with self.assertRaises(SnapshotError):
                    TopKTracker.from_dict(bad)

    def test_load_missing_file(self):
        with self.assertRaises(SnapshotError):
            TopKTracker.load(self._path("does-not-exist.json"))

    def test_exact_snapshot_consistency_check(self):
        t = TopKTracker(k=2, window_size=5, exact=True)
        t.add(Record("a", 3, 0))
        good = t.to_dict()
        bad = json.loads(json.dumps(good))
        bad["exact_counts"]["a"] = 99  # 精确计数与槽位不一致
        with self.assertRaises(SnapshotError):
            TopKTracker.from_dict(bad)

    def test_load_empty_kernel_snapshot(self):
        t = TopKTracker(k=3, window_size=5)
        t.save(self._path("empty.json"))
        loaded = TopKTracker.load(self._path("empty.json"))
        self.assertEqual(loaded.to_dict(), t.to_dict())
        loaded.add(Record("a", 1, 0))
        self.assertEqual(loaded.estimate("a"), (1, 0))


# ---------------------------------------------------------------------------
# CLI（process_command 走内存；main 走子进程）
# ---------------------------------------------------------------------------


class CliUnitTest(unittest.TestCase):
    def test_init_and_add(self):
        tr, resp = cli_main.process_command(None, {"cmd": "init", "k": 3, "window_size": 5})
        self.assertTrue(resp["ok"])
        tr, resp = cli_main.process_command(
            tr, {"cmd": "add", "record": {"key": "a", "weight": 2, "ts": 0}}
        )
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"]["estimated_count"], 2)
        tr, resp = cli_main.process_command(tr, {"cmd": "top"})
        self.assertEqual(resp["result"][0]["key"], "a")

    def test_lazy_default_init(self):
        tr, resp = cli_main.process_command(None, {"cmd": "add", "record": {"key": "a"}})
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"]["total_processed"], 1)

    def test_error_response_has_error_field(self):
        tr = TopKTracker(k=3, window_size=5)
        _, resp = cli_main.process_command(tr, {"cmd": "add", "record": {"key": ""}})
        self.assertFalse(resp["ok"])
        self.assertIn("error", resp)
        self.assertEqual(resp["error_type"], "ValidationError")
        _, resp = cli_main.process_command(tr, {"cmd": "burst", "ratio": 0})
        self.assertFalse(resp["ok"])
        self.assertIn("error", resp)
        _, resp = cli_main.process_command(tr, {"cmd": "nope"})
        self.assertEqual(resp["error_type"], "UnknownCommand")
        _, resp = cli_main.process_command(tr, [1, 2])
        self.assertEqual(resp["error_type"], "InvalidCommand")

    def test_flat_add_form(self):
        tr = TopKTracker(k=3, window_size=5)
        _, resp = cli_main.process_command(
            tr, {"cmd": "add", "key": "a", "weight": 3, "ts": 0}
        )
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"]["estimated_count"], 3)

    def test_heavy_and_burst(self):
        tr = TopKTracker(k=10, window_size=5)
        for key, w, ts in [("a", 1, 0), ("a", 1, 5), ("a", 1, 5), ("b", 1, 5)]:
            cli_main.process_command(tr, {"cmd": "add", "record": {"key": key, "weight": w, "ts": ts}})
        _, resp = cli_main.process_command(tr, {"cmd": "heavy", "threshold": 2})
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"], [{"key": "a", "count": 2}])
        _, resp = cli_main.process_command(tr, {"cmd": "burst", "ratio": 0.5})
        keys = [r["key"] for r in resp["result"]]
        self.assertIn("a", keys)

    def test_dump_and_merge_snapshot(self):
        tr = TopKTracker(k=5, window_size=10)
        tr.add(Record("a", 3, 0))
        _, resp = cli_main.process_command(tr, {"cmd": "dump"})
        self.assertEqual(resp["result"]["slots"][0]["key"], "a")
        other = TopKTracker(k=5, window_size=10)
        other.add(Record("b", 2, 0))
        _, resp = cli_main.process_command(tr, {"cmd": "merge", "snapshot": other.to_dict()})
        self.assertTrue(resp["ok"])
        self.assertEqual(tr.estimate("b"), (2, 0))


class CliSubprocessTest(unittest.TestCase):
    def test_stdin_stdout_lines(self):
        commands = [
            {"cmd": "init", "k": 2, "window_size": 5},
            {"cmd": "add", "record": {"key": "a", "weight": 1, "ts": 0}},
            {"cmd": "add", "record": {"key": "b", "weight": 1, "ts": 0}},
            {"cmd": "add", "record": {"key": "c", "weight": 5, "ts": 0}},
            {"cmd": "top"},
            {"cmd": "estimate", "key": "c"},
            {"cmd": "stats"},
            {"cmd": "add", "record": {"key": "a", "weight": 0}},
            {"cmd": "burst", "ratio": -2},
            "garbage line",
            {},
            {"cmd": "unknown"},
        ]
        payload = "\n".join(json.dumps(c) for c in commands)
        proc = subprocess.run(
            [sys.executable, "-X", "utf8", "main.py"],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [ln for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertEqual(len(lines), len(commands))
        for ln in lines:
            obj = json.loads(ln)  # 每行必须是合法 JSON
            self.assertIn("ok", obj)
        # top 第一行结果是 c
        top_obj = json.loads(lines[4])
        self.assertEqual(top_obj["result"][0]["key"], "c")
        # 错误行都有 error 字段
        for idx in (7, 8, 9, 10, 11):
            obj = json.loads(lines[idx])
            self.assertFalse(obj["ok"])
            self.assertTrue(obj["error"])

    def test_save_load_merge_via_files(self):
        tmpdir = tempfile.mkdtemp()
        s1 = os.path.join(tmpdir, "a.json")
        commands = [
            {"cmd": "init", "k": 5, "window_size": 10},
            {"cmd": "add", "record": {"key": "a", "weight": 4, "ts": 0}},
            {"cmd": "save", "path": s1},
            {"cmd": "load", "path": s1},
            {"cmd": "merge", "path": s1},  # 载入自己再合并：两个相同状态副本，计数相加
            {"cmd": "estimate", "key": "a"},
        ]
        proc = subprocess.run(
            [sys.executable, "-X", "utf8", "main.py"],
            input="\n".join(json.dumps(c) for c in commands),
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        lines = [json.loads(ln) for ln in proc.stdout.splitlines() if ln.strip()]
        self.assertTrue(all(o["ok"] for o in lines), proc.stdout)
        self.assertEqual(lines[-1]["result"]["estimated_count"], 8)


# ---------------------------------------------------------------------------
# 大规模验收（精简版，秒级完成；完整验收见 README 的脚本）
# ---------------------------------------------------------------------------


class ScaleAcceptanceTest(unittest.TestCase):
    def test_large_stream_vs_exact(self):
        random.seed(2026)
        n = 100_000
        k = 25
        window = 2_000
        t = TopKTracker(k=k, window_size=window)
        truth: defaultdict[str, int] = defaultdict(int)
        for i in range(n):
            j = min(499, int(random.expovariate(1 / 20.0)))
            key = f"k{j:04d}"
            w = random.randint(1, 3)
            t.add(Record(key, w, i))
            truth[key] += w

        est = t.top(k)
        # 顺序严格按规则
        for a, b in zip(est, est[1:]):
            self.assertGreaterEqual(a.estimated_count, b.estimated_count)
            if a.estimated_count == b.estimated_count:
                self.assertLess(a.key, b.key)
        # 误差界
        for e in est:
            true_c = truth[e.key]
            self.assertGreaterEqual(true_c, e.estimated_count - e.error_bound)
            self.assertGreaterEqual(e.estimated_count, true_c)
        # 真正的 top-5 高频项必须全部命中
        true_top5 = {k_ for k_, _ in sorted(truth.items(), key=lambda kv: (-kv[1], kv[0]))[:5]}
        self.assertTrue(true_top5 <= {e.key for e in est})

        # 窗口重频与精确窗口一致
        start = t.window_start
        win_truth: defaultdict[str, int] = defaultdict(int)
        rnd = random.Random(2026)
        for i in range(n):
            j = min(499, int(rnd.expovariate(1 / 20.0)))
            key = f"k{j:04d}"
            w = rnd.randint(1, 3)
            if start <= i < start + window:
                win_truth[key] += w
        threshold = 100
        got = dict(t.heavy_hitters(threshold))
        for key, cnt in win_truth.items():
            if cnt >= threshold:
                self.assertEqual(got.get(key), cnt)


if __name__ == "__main__":
    unittest.main(verbosity=2)
