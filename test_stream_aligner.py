"""stream_aligner 的单元测试。

只用标准库（unittest）。其中 :func:`reference_align` 是一份完全独立的
“整段从头算”的带窗 DTW 参考实现，测试用它逐前缀核对增量内核的距离与路径
必须**完全一致**，并覆盖：窗口约束、路径回溯、不可达、内存上限、
零向量、快照往返、CLI 协议与各类错误处理。

运行：``python -m unittest -v`` 或 ``python test_stream_aligner.py``。
"""

from __future__ import annotations

import json
import math
import os
import random
import subprocess
import sys
import tempfile
import unittest

from stream_aligner import (
    MAX_SERIES_LENGTH,
    METRICS,
    AlignResult,
    AppendResult,
    MemoryLimitError,
    MetricError,
    Series,
    SeriesValidationError,
    SnapshotError,
    StateResult,
    StreamAligner,
    ZeroVectorError,
)
import main as cli_main


# ---------------------------------------------------------------------------
# 参考实现：整段全量带窗 DTW（独立于内核，用于等价性验收）
# ---------------------------------------------------------------------------


def reference_align(a, b, band, metric):
    """从头计算带窗 DTW。

    :return: ``(distance, path)``；端点不可达返回 ``(None, None)``。
    :raises ZeroVectorError: cos 下参与比较的前缀为零向量。
    """
    n, m = len(a), len(b)
    if n == 0 or m == 0 or abs(n - m) > band:
        return None, None
    inf = math.inf
    dp = [[inf] * (m + 1) for _ in range(n + 1)]
    bp = [[None] * (m + 1) for _ in range(n + 1)]
    dp[0][0] = 0.0

    norm_a = [0.0] * (n + 1)
    norm_b = [0.0] * (m + 1)
    for i in range(1, n + 1):
        norm_a[i] = norm_a[i - 1] + a[i - 1] * a[i - 1]
    for j in range(1, m + 1):
        norm_b[j] = norm_b[j - 1] + b[j - 1] * b[j - 1]
    dot = [0.0]
    for k in range(1, min(n, m) + 1):
        dot.append(dot[-1] + a[k - 1] * b[k - 1])

    def cost(i, j):
        x, y = a[i - 1], b[j - 1]
        if metric == "abs":
            return abs(x - y)
        if metric == "sq":
            d = x - y
            return d * d
        if norm_a[i] == 0.0 or norm_b[j] == 0.0:
            raise ZeroVectorError("reference: zero vector prefix")
        return 1.0 - dot[min(i, j)] / math.sqrt(norm_a[i] * norm_b[j])

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if abs(i - j) > band:
                continue  # 窗口外不可达，保持 inf
            c = cost(i, j)
            best, prev = dp[i - 1][j], (i - 1, j)  # 平局优先级：上
            if dp[i - 1][j - 1] < best:            # 左上
                best, prev = dp[i - 1][j - 1], (i - 1, j - 1)
            if dp[i][j - 1] < best:                # 左
                best, prev = dp[i][j - 1], (i, j - 1)
            if math.isfinite(best):
                dp[i][j] = c + best
                bp[i][j] = prev

    if not math.isfinite(dp[n][m]):
        return None, None
    path = []
    cur = (n, m)
    while cur != (0, 0):
        path.append((cur[0] - 1, cur[1] - 1))
        cur = bp[cur[0]][cur[1]]
    path.reverse()
    return dp[n][m], path


def expected_banded_cells(n, m, band):
    """参考实现实际填充的窗口内单元格数。"""
    total = 0
    for i in range(1, n + 1):
        lo = max(1, i - band)
        hi = min(m, i + band)
        total += max(0, hi - lo + 1)
    return total


def make_values(rng, k, metric):
    """生成测试值；cos 下保证首值非零（否则零前缀本身非法）。"""
    out = [round(rng.uniform(-3.0, 3.0), 2) for _ in range(k)]
    if metric == "cos":
        if not out:
            return out
        if out[0] == 0.0:
            out[0] = 1.0
        # 之后允许出现 0，验证“非零首值 + 后续零”不触发零向量错误。
    return out


# ---------------------------------------------------------------------------
# Series 与构造校验
# ---------------------------------------------------------------------------


class SeriesValidationTests(unittest.TestCase):
    def test_valid_series(self):
        s = Series("temp", [1.0, -2.5, 3])
        self.assertEqual(s.name, "temp")
        self.assertEqual(s.values, [1.0, -2.5, 3.0])
        self.assertIsInstance(s.values[2], float)

    def test_empty_name_rejected(self):
        with self.assertRaises(SeriesValidationError):
            Series("", [1.0])

    def test_non_string_name_rejected(self):
        with self.assertRaises(SeriesValidationError):
            Series(7, [1.0])  # type: ignore[arg-type]

    def test_nan_and_infinity_rejected(self):
        for bad in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(bad=bad):
                with self.assertRaises(SeriesValidationError):
                    Series("s", [1.0, bad])

    def test_non_numeric_rejected(self):
        for bad in ("1.0", None, [1.0], True):
            with self.subTest(bad=bad):
                with self.assertRaises(SeriesValidationError):
                    Series("s", [bad])  # type: ignore[list-item]

    def test_values_must_be_list_like(self):
        with self.assertRaises(SeriesValidationError):
            Series("s", 1.0)  # type: ignore[arg-type]

    def test_length_limit(self):
        Series("s", [0.0] * MAX_SERIES_LENGTH)  # 恰好不超限
        with self.assertRaises(SeriesValidationError):
            Series("s", [0.0] * (MAX_SERIES_LENGTH + 1))

    def test_frozen(self):
        s = Series("s", [1.0])
        with self.assertRaises(Exception):
            s.name = "other"  # type: ignore[misc]


class ConstructionTests(unittest.TestCase):
    def test_invalid_metric(self):
        with self.assertRaises(MetricError):
            StreamAligner("a", "b", metric="manhattan")

    def test_band_validation(self):
        StreamAligner("a", "b", band=0)
        with self.assertRaises(ValueError):
            StreamAligner("a", "b", band=-1)
        with self.assertRaises(ValueError):
            StreamAligner("a", "b", band=True)  # type: ignore[arg-type]

    def test_max_cells_validation(self):
        StreamAligner("a", "b", max_cells=None)
        StreamAligner("a", "b", max_cells=1)
        for bad in (0, -3, True, 1.5):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    StreamAligner("a", "b", max_cells=bad)  # type: ignore[arg-type]

    def test_empty_names_rejected(self):
        with self.assertRaises(SeriesValidationError):
            StreamAligner("", "b")
        with self.assertRaises(SeriesValidationError):
            StreamAligner("a", "")

    def test_defaults(self):
        al = StreamAligner("a", "b")
        self.assertEqual(al.metric, "abs")
        self.assertEqual(al.band, 4096)
        self.assertIsNone(al.max_cells)
        self.assertEqual(al.get_state().length_a, 0)


# ---------------------------------------------------------------------------
# 三种距离度量
# ---------------------------------------------------------------------------


class MetricTests(unittest.TestCase):
    def test_abs_hand_case(self):
        al = StreamAligner("a", "b", metric="abs", band=4096)
        for v in (0.0, 1.0, 2.0):
            al.append("a", v)
        for v in (0.5, 1.0, 3.0):
            al.append("b", v)
        d, path = reference_align([0, 1, 2], [0.5, 1, 3], 4096, "abs")
        self.assertTrue(math.isclose(al.align().distance, d))
        self.assertEqual(al.align().path, path)

    def test_sq_known(self):
        al = StreamAligner("a", "b", metric="sq", band=0)
        al.append("a", 0.0)
        al.append("b", 3.0)
        self.assertAlmostEqual(al.align().distance, 9.0)

    def test_cos_identical_and_positive_scaled(self):
        vec = [1.0, -2.0, 3.0]
        for scale in (1.0, 2.5, 7.0):
            al = StreamAligner("a", "b", metric="cos", band=4096)
            for v in vec:
                al.append("a", v)
            for v in [x * scale for x in vec]:
                al.append("b", v)
            # 正标量倍：前缀余弦相似度恒为 1，对角线上代价全 0。
            self.assertAlmostEqual(al.align().distance, 0.0, places=12)

    def test_cos_negative_scale_is_far(self):
        # 负标量倍方向相反，余弦距离不可能为 0，并与参考实现一致。
        vec = [1.0, 2.0, 3.0]
        a, b = vec, [-v for v in vec]
        al = StreamAligner("a", "b", metric="cos", band=4096)
        for v in a:
            al.append("a", v)
        for v in b:
            al.append("b", v)
        d, path = reference_align(a, b, 4096, "cos")
        self.assertGreater(al.align().distance, 0.0)
        self.assertEqual(al.align().distance, d)
        self.assertEqual(al.align().path, path)

    def test_cos_matches_reference_with_interior_zeros(self):
        a, b = [1.0, 0.0, 2.0], [2.0, 0.0, -1.0]
        al = StreamAligner("a", "b", metric="cos", band=2)
        for v in a:
            al.append("a", v)
        for v in b:
            al.append("b", v)
        d, path = reference_align(a, b, 2, "cos")
        self.assertAlmostEqual(al.align().distance, d)
        self.assertEqual(al.align().path, path)

    def test_cos_zero_head_rejected(self):
        al = StreamAligner("a", "b", metric="cos", band=2)
        with self.assertRaises(ZeroVectorError):
            al.append("a", 0.0)
        # 状态不变，仍可追加非零首值
        self.assertEqual(al.get_state().length_a, 0)
        al.append("a", 0.5)
        with self.assertRaises(ZeroVectorError):
            al.append("b", 0.0)
        self.assertEqual(al.get_state().length_b, 0)
        al.append("b", 1.0)
        self.assertAlmostEqual(al.align().distance, 0.0)

    def test_cos_zero_on_both_heads(self):
        al = StreamAligner("a", "b", metric="cos", band=0)
        al.append("a", 2.0)
        with self.assertRaises(ZeroVectorError):
            al.append("b", 0.0)
        self.assertEqual(al.get_state().length_b, 0)
        al.append("b", 1.0)
        self.assertAlmostEqual(al.align().distance, 0.0)

    def test_cos_later_zero_is_allowed(self):
        al = StreamAligner("a", "b", metric="cos", band=4096)
        al.append("a", 1.0)
        al.append("b", 1.0)
        al.append("a", 0.0)  # 前缀范数仍为正，合法
        al.append("b", 0.0)
        self.assertIsNotNone(al.align().distance)


# ---------------------------------------------------------------------------
# 增量等价性（核心）
# ---------------------------------------------------------------------------


class IncrementalEquivalenceTests(unittest.TestCase):
    def _assert_path_well_formed(self, path, n, m, result):
        self.assertEqual(path[0], (0, 0))
        self.assertEqual(path[-1], (n - 1, m - 1))
        self.assertEqual(result.warping_ratio, len(path) / max(n, m))
        self.assertEqual(result.band_violations, 0)
        for (i1, j1), (i2, j2) in zip(path, path[1:]):
            di, dj = i2 - i1, j2 - j1
            self.assertIn((di, dj), ((1, 0), (1, 1), (0, 1)))

    def _run_merge(self, a, b, band, metric, mode):
        """按指定交织方式增量构建，并在每个前缀与参考实现核对。"""
        al = StreamAligner("a", "b", metric=metric, band=band)
        ia = ib = 0
        n, m = len(a), len(b)
        rng = random.Random(1234)
        while ia < n or ib < m:
            if mode == "a_first":
                go_a = ia < n
            elif mode == "b_first":
                go_a = not (ib < m)
            else:
                if ib == m:
                    go_a = True
                elif ia == n:
                    go_a = False
                else:
                    go_a = rng.random() < 0.5
            if go_a:
                r = al.append("a", a[ia])
                ia += 1
            else:
                r = al.append("b", b[ib])
                ib += 1

            cur_a, cur_b = a[:ia], b[:ib]
            result = al.align()
            ref_d, ref_path = reference_align(cur_a, cur_b, band, metric)
            self.assertEqual(r.distance, result.distance)  # AppendResult 与 align 一致
            if ref_d is None:
                self.assertIsNone(result.distance)
                self.assertIsNotNone(result.reason)
                self.assertEqual(result.path, [])
            else:
                self.assertIsNotNone(result.distance, result.reason)
                self.assertTrue(
                    math.isclose(result.distance, ref_d, abs_tol=1e-12, rel_tol=1e-12),
                    (result.distance, ref_d, cur_a, cur_b, band, metric, mode),
                )
                self.assertEqual(result.path, ref_path)
                self._assert_path_well_formed(result.path, ia, ib, result)
                self.assertFalse(r.recomputed)
        return al

    def test_named_families(self):
        base = [0.0, 0.5, 1.0, 1.5, 2.0, 1.5, 1.0, 0.5]
        families = {
            "identical": (base, base),
            "shifted": (base, [v + 0.3 for v in base]),
            "scaled": (base, [v * 2.0 - 0.4 for v in base]),
            "length_gap": (base, base[:3]),
            "single_points": ([1.0], [1.5]),
            "one_vs_many": ([0.0], [0.0, 1.0, 2.0, 1.0]),
        }
        for name, (a, b) in families.items():
            for metric in METRICS:
                if metric == "cos":
                    continue
                for band in (0, 1, 2, 4, 64):
                    for mode in ("a_first", "b_first", "merge"):
                        with self.subTest(name=name, metric=metric, band=band, mode=mode):
                            if abs(len(a) - len(b)) <= band:
                                self._run_merge(list(a), list(b), band, metric, mode)

    def test_randomized_all_metrics(self):
        rng = random.Random(20260911)
        for trial in range(120):
            n = rng.randint(1, 9)
            m = rng.randint(1, 9)
            metric = rng.choice(METRICS)
            a = make_values(rng, n, metric)
            b = make_values(rng, m, metric)
            band = rng.choice([0, 1, 2, 3, 99])
            mode = rng.choice(["a_first", "b_first", "merge"])
            with self.subTest(trial=trial, n=n, m=m, metric=metric, band=band, mode=mode):
                self._run_merge(a, b, band, metric, mode)

    def test_final_matches_full_recompute(self):
        # 显式模拟验收脚本：多组序列，最终结果与整段重算 distance+path 完全一致。
        rng = random.Random(4242)
        for _ in range(60):
            n, m = rng.randint(1, 12), rng.randint(1, 12)
            metric = rng.choice(["abs", "sq"])
            band = rng.randint(0, 14)
            a = make_values(rng, n, metric)
            b = make_values(rng, m, metric)
            if abs(n - m) > band:
                continue
            al = StreamAligner("a", "b", metric=metric, band=band)
            for v in a:
                al.append("a", v)
            for v in b:
                al.append("b", v)
            ref_d, ref_path = reference_align(a, b, band, metric)
            result = al.align()
            self.assertTrue(math.isclose(result.distance, ref_d, abs_tol=1e-12))
            self.assertEqual(result.path, ref_path)

    def test_band_at_least_max_length_equals_unconstrained(self):
        a, b = [0.0, 2.0, 1.0, 3.0], [1.0, 2.0, 0.0]
        al = StreamAligner("a", "b", metric="sq", band=max(len(a), len(b)))
        for v in a:
            al.append("a", v)
        for v in b:
            al.append("b", v)
        d_big, p_big = reference_align(a, b, max(len(a), len(b)), "sq")
        d_inf, p_inf = reference_align(a, b, 10_000, "sq")
        self.assertEqual(d_big, d_inf)
        self.assertEqual(al.align().distance, d_big)
        self.assertEqual(al.align().path, p_big)

    def test_band_zero_is_diagonal_only(self):
        a, b = [0.0, 1.0, 2.0], [0.5, 0.5, 2.5]
        al = StreamAligner("a", "b", metric="abs", band=0)
        for v in a:
            al.append("a", v)
        for v in b:
            al.append("b", v)
        result = al.align()
        self.assertEqual(result.path, [(0, 0), (1, 1), (2, 2)])
        self.assertAlmostEqual(result.distance, 0.5 + 0.5 + 0.5)

    def test_old_cells_never_recomputed(self):
        # 增量性质的白盒验证：后续 append 不得改动任何历史单元格。
        al = StreamAligner("a", "b", metric="abs", band=2)
        al.append("a", 0.0)
        al.append("b", 0.1)
        al.append("a", 1.0)
        snapshot = [row[:] for row in al._dp]
        n0, m0 = len(al._a), len(al._b)
        al.append("b", 0.9)
        al.append("a", 2.0)
        al.append("b", 1.1)
        for i in range(n0 + 1):
            self.assertEqual(al._dp[i][: m0 + 1], snapshot[i])

    def test_filled_cells_tracks_window_only(self):
        al = StreamAligner("a", "b", metric="abs", band=1)
        seq = [("a", 0.0), ("a", 1.0), ("b", 0.0), ("b", 1.0), ("a", 2.0), ("b", 2.0)]
        expected_lengths = [(1, 0), (2, 0), (2, 1), (2, 2), (3, 2), (3, 3)]
        for (side, v), (n, m) in zip(seq, expected_lengths):
            al.append(side, v)
            self.assertEqual((len(al._a), len(al._b)), (n, m))
            self.assertEqual(al.filled_cells, expected_banded_cells(n, m, 1))

    def test_out_of_window_cells_stay_infinite(self):
        al = StreamAligner("a", "b", metric="abs", band=1)
        for v in range(4):
            al.append("a", float(v))
        for v in range(4):
            al.append("b", float(v) + 0.1)
        n, m = len(al._a), len(al._b)
        for i in range(1, n + 1):
            for j in range(1, m + 1):
                if abs(i - j) > 1:
                    self.assertEqual(al._dp[i][j], math.inf)
                    self.assertIsNone(al._bp[i][j])


# ---------------------------------------------------------------------------
# 不可达
# ---------------------------------------------------------------------------


class UnreachableTests(unittest.TestCase):
    def test_empty_sequences(self):
        al = StreamAligner("a", "b", band=1)
        r = al.align()
        self.assertIsInstance(r, AlignResult)
        self.assertIsNone(r.distance)
        self.assertIn("empty", r.reason)
        al.append("a", 1.0)
        self.assertIsNone(al.align().distance)
        self.assertIn("empty", al.align().reason)

    def test_length_gap_exceeds_band(self):
        al = StreamAligner("a", "b", metric="abs", band=1)
        for v in (0.0, 1.0, 2.0):
            al.append("a", v)
        al.append("b", 0.0)
        result = al.align()
        self.assertIsNone(result.distance)
        self.assertIsNotNone(result.reason)
        self.assertEqual(result.path, [])
        self.assertEqual(result.warping_ratio, 0.0)

    def test_becomes_reachable_after_catching_up(self):
        # 长度差超过 band 时不可达；对侧追上来后自动恢复可达。
        al = StreamAligner("a", "b", metric="abs", band=1)
        al.append("a", 0.0)
        al.append("a", 1.0)
        al.append("a", 2.0)
        al.append("b", 0.0)
        self.assertIsNone(al.align().distance)  # 3 vs 1，差距 2 > 1
        al.append("b", 1.0)                     # 3 vs 2，差距 1 <= 1：可达
        self.assertIsNotNone(al.align().distance)
        al.append("b", 2.0)                     # 3 vs 3
        self.assertIsNotNone(al.align().distance)

    def test_tight_band_path_truncation(self):
        # band 很小且形状不匹配：|n-m|<=band 仍可能不可达？对满代价网格不会，
        # 但确认 band=0 长度相等恒可达且为逐点配对。
        a, b = [5.0, 5.0, 5.0], [1.0, 1.0, 1.0]
        al = StreamAligner("a", "b", metric="abs", band=0)
        for v in a:
            al.append("a", v)
        for v in b:
            al.append("b", v)
        self.assertAlmostEqual(al.align().distance, 12.0)


# ---------------------------------------------------------------------------
# append 结果与状态
# ---------------------------------------------------------------------------


class AppendAndStateTests(unittest.TestCase):
    def test_append_result_fields(self):
        al = StreamAligner("a", "b", metric="abs", band=2)
        r = al.append("a", 1.0)
        self.assertIsInstance(r, AppendResult)
        self.assertEqual((r.name, r.new_length, r.recomputed, r.distance), ("a", 1, False, None))
        al.append("b", 2.0)
        r2 = al.append("a", 3.0)
        self.assertEqual(r2.new_length, 2)
        self.assertFalse(r2.recomputed)
        self.assertIsNotNone(r2.distance)

    def test_append_validation_and_atomicity(self):
        al = StreamAligner("a", "b", metric="abs", band=2)
        with self.assertRaises(SeriesValidationError):
            al.append("c", 1.0)
        with self.assertRaises(SeriesValidationError):
            al.append("a", float("nan"))
        with self.assertRaises(SeriesValidationError):
            al.append("a", "1")  # type: ignore[arg-type]
        self.assertEqual(al.get_state().length_a, 0)

    def test_length_limit_on_append(self):
        al = StreamAligner("a", "b", metric="abs", band=0)
        for _ in range(MAX_SERIES_LENGTH):
            al.append("a", 0.0)  # B 为空时不产生单元格，速度快
        with self.assertRaises(SeriesValidationError):
            al.append("a", 1.0)

    def test_get_state(self):
        al = StreamAligner("a", "b", metric="abs", band=1)
        state = al.get_state()
        self.assertIsInstance(state, StateResult)
        self.assertEqual(state.filled_cells, 0)
        self.assertEqual(state.window_utilization, 0.0)
        self.assertIsNone(state.last_distance)
        al.append("a", 0.0)
        al.append("b", 0.5)
        al.align()
        state = al.get_state()
        self.assertEqual((state.length_a, state.length_b, state.filled_cells), (1, 1, 1))
        self.assertAlmostEqual(state.window_utilization, 1.0)
        self.assertAlmostEqual(state.last_distance, 0.5)

    def test_align_is_cached_but_consistent(self):
        al = StreamAligner("a", "b", metric="abs", band=2)
        al.append("a", 0.0)
        al.append("b", 1.0)
        first = al.align()
        second = al.align()
        self.assertEqual(first.distance, second.distance)
        al.append("a", 2.0)
        self.assertIsNotNone(al.align().distance)


# ---------------------------------------------------------------------------
# 内存上限
# ---------------------------------------------------------------------------


class MemoryLimitTests(unittest.TestCase):
    def test_rejection_is_atomic(self):
        al = StreamAligner("a", "b", metric="abs", band=1, max_cells=2)
        al.append("a", 0.0)   # +0
        al.append("b", 0.0)   # +1 -> 1
        al.append("a", 1.0)   # +1 -> 2
        before = al.get_state()
        with self.assertRaises(MemoryLimitError):
            al.append("b", 1.0)  # 新列覆盖 i=1,2 -> +2 -> 4 > 2，拒绝
        after = al.get_state()
        self.assertEqual(before.length_a, after.length_a)
        self.assertEqual(before.length_b, after.length_b)
        self.assertEqual(before.filled_cells, after.filled_cells)
        # 拒绝后状态仍可正常使用
        self.assertIsNotNone(al.align().distance)

    def test_exact_fit_then_reject(self):
        al = StreamAligner("a", "b", metric="abs", band=0, max_cells=3)
        for v in (0.0, 1.0, 2.0):
            al.append("a", v)
            al.append("b", v)
        self.assertEqual(al.filled_cells, 3)
        # band=0、A 超前时新行窗口为空（j=4 尚不存在）：允许追加但不增格。
        al.append("a", 3.0)
        self.assertEqual(al.get_state().length_a, 4)
        self.assertEqual(al.filled_cells, 3)
        with self.assertRaises(MemoryLimitError):
            al.append("b", 3.0)  # 此时 (4,4) 需 +1，超过上限
        self.assertEqual(al.get_state().length_b, 3)
        self.assertEqual(al.filled_cells, 3)

    def test_unlimited_exact_mode(self):
        al = StreamAligner("a", "b", metric="abs", band=4096, max_cells=None)
        for k in range(60):
            al.append("a" if k % 2 == 0 else "b", float(k))
        self.assertGreater(al.filled_cells, 800)

    def test_limit_persists_through_load(self):
        al = StreamAligner("a", "b", metric="abs", band=0, max_cells=1)
        al.append("a", 0.0)
        al.append("b", 0.0)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            al.save(path)
            loaded = StreamAligner.load(path)
            self.assertEqual(loaded.max_cells, 1)
            # A 先超前：band=0 下新行窗口为空，不增格，允许追加。
            loaded.append("a", 1.0)
            self.assertEqual(loaded.filled_cells, 1)
            # B 追上时 (2,2) 需要 +1，触发上限。
            with self.assertRaises(MemoryLimitError):
                loaded.append("b", 1.0)


# ---------------------------------------------------------------------------
# 快照持久化
# ---------------------------------------------------------------------------


class SnapshotTests(unittest.TestCase):
    def _build(self):
        al = StreamAligner("mic", "ref", metric="sq", band=2, max_cells=10_000)
        for v in (0.0, 1.0, 2.0, 3.0):
            al.append("mic", v)
        for v in (0.2, 1.1, 2.0):
            al.append("ref", v)
        al.align()
        return al

    def test_roundtrip_and_continue_append(self):
        al = self._build()
        before = al.align()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "s.json")
            al.save(path)
            loaded = StreamAligner.load(path)
            after = loaded.align()
            self.assertEqual(before.distance, after.distance)
            self.assertEqual(before.path, after.path)
            self.assertEqual(loaded.values_a, al.values_a)
            self.assertEqual(loaded.values_b, al.values_b)
            self.assertEqual(loaded.get_state().filled_cells, al.filled_cells)
            self.assertEqual(loaded.band, 2)
            self.assertEqual(loaded.metric, "sq")
            # 往返后继续 append，与未中断的实例结果一致
            for side, v in (("mic", 4.0), ("ref", 3.0), ("mic", 5.0)):
                al.append(side, v)
                loaded.append(side, v)
            self.assertEqual(al.align().distance, loaded.align().distance)
            self.assertEqual(al.align().path, loaded.align().path)
            self.assertEqual(al.get_state().filled_cells, loaded.get_state().filled_cells)

    def test_roundtrip_unreachable_state(self):
        al = StreamAligner("a", "b", metric="abs", band=1)
        al.append("a", 0.0)
        al.append("a", 1.0)
        al.append("a", 2.0)
        al.append("b", 0.0)
        self.assertIsNone(al.align().distance)
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "u.json")
            al.save(path)
            loaded = StreamAligner.load(path)
            self.assertIsNone(loaded.align().distance)
            self.assertIsNotNone(loaded.align().reason)

    def test_corrupt_json_and_missing_file(self):
        with tempfile.TemporaryDirectory() as d:
            bad = os.path.join(d, "bad.json")
            with open(bad, "w", encoding="utf-8") as fh:
                fh.write("{not valid json")
            with self.assertRaises(SnapshotError):
                StreamAligner.load(bad)
            with self.assertRaises(SnapshotError):
                StreamAligner.load(os.path.join(d, "absent.json"))

    def test_missing_and_bad_fields(self):
        good = self._build().to_snapshot()
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot({"format": "stream-aligner-v1"})
        for mutate in (
            lambda d: d.update(format="other"),
            lambda d: d.update(band=-1),
            lambda d: d.update(metric="l2"),
            lambda d: d.update(name_a=""),
            lambda d: d.update(values_a=[1.0, float("nan")]),
            lambda d: d.update(dp=[]),
            lambda d: d["dp"].update(rows=99),
            lambda d: d.pop("max_cells"),
        ):
            data = json.loads(json.dumps(good))  # 深拷贝（无 NaN）
            mutate(data)
            with self.subTest(mutate=mutate.__doc__ or mutate.__name__):
                with self.assertRaises(SnapshotError):
                    StreamAligner.from_snapshot(data)

    def test_tampered_cell_value_detected(self):
        data = self._build().to_snapshot()
        cells = data["dp"]["cells"]
        target = next(c for c in cells if c[3] is not None)
        target[2] = target[2] + 1.0
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)

    def test_out_of_window_cell_detected(self):
        data = self._build().to_snapshot()
        # 强行写入一个 |i-j| > band 的单元格。
        data["dp"]["cells"].append([4, 1, 9.9, [3, 1]])
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)

    def test_missing_cell_detected(self):
        data = self._build().to_snapshot()
        data["dp"]["cells"].pop()
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)

    def test_tampered_last_distance_detected(self):
        al = self._build()
        data = al.to_snapshot()
        data["last_distance"] = 123456.0
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)

    def test_from_series_equivalence(self):
        a = Series("a", [0.0, 1.0, 2.0])
        b = Series("b", [0.5, 1.0])
        al = StreamAligner.from_series(a, b, metric="abs", band=2)
        d, path = reference_align(a.values, b.values, 2, "abs")
        self.assertEqual(al.align().distance, d)
        self.assertEqual(al.align().path, path)

    def test_load_rejects_series_exceeding_max_cells(self):
        al = StreamAligner("a", "b", metric="abs", band=0, max_cells=None)
        for k in range(5):
            al.append("a", float(k))
            al.append("b", float(k))
        data = al.to_snapshot()
        data["max_cells"] = 1  # 现有 5 格，装不下
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)

    def test_load_rejects_zero_head_cos(self):
        # 手工构造一份 cos 但首值被改成 0 的“脏快照”，维度不变，重建必须失败。
        al = StreamAligner("a", "b", metric="cos", band=2)
        al.append("a", 1.0)
        al.append("a", 2.0)
        al.append("b", 1.0)
        data = al.to_snapshot()
        data["values_a"] = [0.0, 2.0]  # 零首值 -> 余弦代价无定义
        with self.assertRaises(SnapshotError):
            StreamAligner.from_snapshot(data)


# ---------------------------------------------------------------------------
# 命令行入口
# ---------------------------------------------------------------------------


class CliProtocolTests(unittest.TestCase):
    def setUp(self):
        self.session = cli_main.Session()

    def _send(self, text):
        return cli_main.process_line(self.session, text)

    def test_full_session(self):
        r = json.loads(self._send('{"cmd":"new","name_a":"a","name_b":"b","band":2}'))
        self.assertTrue(r["ok"])
        for line in (
            '{"cmd":"append","series":"a","value":0}',
            '{"cmd":"append","series":"a","value":1}',
            '{"cmd":"append","series":"b","value":0.2}',
        ):
            self.assertTrue(json.loads(self._send(line))["ok"])
        r = json.loads(self._send('{"cmd":"align"}'))
        self.assertIn("distance", r["result"])
        r = json.loads(self._send('{"cmd":"state"}'))
        self.assertEqual(r["state"]["length_a"], 2)
        self.assertEqual(r["state"]["length_b"], 1)

    def test_errors_are_json_with_error_field(self):
        self.assertIn("no active session", self._send('{"cmd":"align"}'))
        r = json.loads(self._send('{"cmd":"new","name_a":"a","name_b":"b","metric":"x"}'))
        self.assertFalse(r["ok"])
        self.assertIn("error", r)
        json.loads(self._send('{"cmd":"new","name_a":"a","name_b":"b"}'))
        r = json.loads(self._send("not json"))
        self.assertFalse(r["ok"])
        self.assertIsNone(r["cmd"])
        r = json.loads(self._send('{"cmd":"append","series":"zzz","value":1}'))
        self.assertFalse(r["ok"])
        r = json.loads(self._send('{"cmd":"frobnicate"}'))
        self.assertFalse(r["ok"])
        self.assertEqual(r["cmd"], "frobnicate")
        self.assertIsNone(self._send("   "))  # 空行无输出

    def test_save_load_dump(self):
        self._send('{"cmd":"new","name_a":"a","name_b":"b","metric":"abs","band":1}')
        self._send('{"cmd":"append","series":"a","value":0}')
        self._send('{"cmd":"append","series":"b","value":0.1}')
        before = json.loads(self._send('{"cmd":"align"}'))["result"]
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "cli.json")
            r = json.loads(self._send(json.dumps({"cmd": "save", "path": path})))
            self.assertTrue(r["ok"])
            r = json.loads(self._send(json.dumps({"cmd": "load", "path": path})))
            self.assertTrue(r["ok"])
            after = json.loads(self._send('{"cmd":"align"}'))
            self.assertEqual(after["result"]["distance"], before["distance"])
            dump = json.loads(self._send('{"cmd":"dump"}'))
            self.assertEqual(dump["snapshot"]["format"], "stream-aligner-v1")
            bad_load = json.loads(
                self._send(json.dumps({"cmd": "load", "path": os.path.join(d, "x")}))
            )
            self.assertFalse(bad_load["ok"])

    def test_subprocess_end_to_end(self):
        # 真正以子进程方式跑 main.py，验证 stdin/stdout 协议离线可用。
        root = os.path.dirname(os.path.abspath(__file__))
        with tempfile.TemporaryDirectory() as d:
            snap = os.path.join(d, "s.json").replace("\\", "/")
            commands = "\n".join(
                [
                    '{"cmd":"new","name_a":"a","name_b":"b","metric":"sq","band":2}',
                    '{"cmd":"append","series":"a","value":1}',
                    '{"cmd":"append","series":"b","value":1}',
                    '{"cmd":"align"}',
                    f'{{"cmd":"save","path":"{snap}"}}',
                    f'{{"cmd":"load","path":"{snap}"}}',
                    '{"cmd":"state"}',
                    "garbage line",
                ]
            )
            proc = subprocess.run(
                [sys.executable, os.path.join(root, "main.py")],
                input=commands,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            lines = [json.loads(line) for line in proc.stdout.splitlines()]
            self.assertEqual(len(lines), 8)
            self.assertTrue(lines[0]["ok"])
            self.assertAlmostEqual(lines[3]["result"]["distance"], 0.0)
            self.assertTrue(lines[5]["ok"])
            self.assertFalse(lines[7]["ok"])
            self.assertIn("error", lines[7])


if __name__ == "__main__":
    unittest.main(verbosity=2)
