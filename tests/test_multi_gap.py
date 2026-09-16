"""两处及以上互不相邻缺失的切口判定（本轮收紧目标）。

覆盖：密锚点双缺口、最小 2/2/2、3/2/3（中段与两侧接近）、三缺口，
以及顺序无关、重复一致、速率不被扭曲、校正时刻与逐步推导一致。
"""

import random
import unittest
from fractions import Fraction

from subalign import AlignConfig, Entry, SubtitleSystem, fitter
from subalign.model import Anchor


def gap_system(kept, n_total=None, step=10000, dur=3000, **cfg):
    n_total = n_total if n_total is not None else kept[-1] + 1
    ref = [Entry(i * step, i * step + dur, f"L{i} K{i}") for i in range(n_total)]
    cand = [
        Entry(k * step, k * step + dur, f"L{i} K{i}")
        for k, i in enumerate(kept)
    ]
    config = AlignConfig(**{**dict(tolerance_ms=50, min_cut_gap_ms=1500), **cfg})
    return SubtitleSystem.build(ref, {"t": ("cut", cand)}, config=config), ref, cand


def anchor_points(kept, step=10000):
    return [
        Anchor(ref_index=i, cand_index=k, ref_mid=i * step + 1500,
               cand_mid=k * step + 1500, score=1.0, kind="exact", evidence="")
        for k, i in enumerate(kept)
    ]


class TestTwoGaps(unittest.TestCase):
    def test_dense_anchors_two_gaps_matches_derivation(self):
        # 密锚点（2s 间距）：基准 18 条，缺第 6,7 与 12,13 条，组 6/4/4。
        step, dur = 2000, 700
        kept = [i for i in range(18) if i not in (6, 7, 12, 13)]
        s, ref, cand = gap_system(kept, step=step, dur=dur)
        s.align()
        r = s.report("t")
        self.assertEqual(r.status, "aligned_segmented")
        self.assertEqual(len(r.segments), 3)
        # 无真实漂移：三段 ratio 精确为 1，聚合速率也为 1。
        for seg in r.segments:
            self.assertEqual(seg.ratio, Fraction(1))
            self.assertEqual(seg.residual_max_abs, 0)
        self.assertEqual(r.bias.rate_ratio, Fraction(1))
        self.assertEqual([seg.shift for seg in r.segments],
                         [Fraction(0), Fraction(2 * step), Fraction(4 * step)])
        # 两段缺失，按基准起点稳定升序。
        miss = r.bias.missing_intervals
        self.assertEqual(len(miss), 2)
        self.assertEqual([m.ref_lo for m in miss], sorted(m.ref_lo for m in miss))
        self.assertEqual((miss[0].ref_lo, miss[0].ref_hi),
                         (6 * step, 7 * step + dur))
        self.assertEqual((miss[1].ref_lo, miss[1].ref_hi),
                         (12 * step, 13 * step + dur))
        self.assertEqual(miss[0].left_anchor, (5, 5))
        self.assertEqual(miss[0].right_anchor, (8, 6))
        # 逐步推导：每个候选锚点校正后必须精确回到其基准中点。
        for k, i in enumerate(kept):
            q = s.correct_time("t", k * step + 350)
            self.assertEqual(q.corrected_ms, Fraction(i * step + 350))
        self.assertTrue(r.tolerance.within_tolerance)

    def test_minimal_two_two_two(self):
        # 中段只有 2 个锚点（旧窗口实现的失败拓扑）。
        s, _, _ = gap_system([0, 1, 4, 5, 8, 9])
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 3)
        self.assertEqual([g.ratio for g in r.segments], [Fraction(1)] * 3)
        self.assertEqual([g.shift for g in r.segments],
                         [Fraction(0), Fraction(20000), Fraction(40000)])
        self.assertEqual(len(r.bias.missing_intervals), 2)
        self.assertEqual(
            [(m.ref_lo, m.ref_hi) for m in r.bias.missing_intervals],
            [(20000, 33000), (60000, 73000)],
        )
        # 缺失附近校正不整体偏移：候选 k=4（中点 41500）对应基准第 8 条。
        self.assertEqual(s.correct_time("t", 41500).corrected_ms, Fraction(81500))

    def test_middle_group_close_to_sides_three_two_three(self):
        s, _, _ = gap_system([0, 1, 2, 5, 6, 9, 10, 11])
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 3)
        self.assertEqual(r.bias.rate_ratio, Fraction(1))
        self.assertEqual(len(r.bias.missing_intervals), 2)

    def test_three_gaps_four_segments(self):
        s, _, _ = gap_system([0, 1, 4, 5, 8, 9, 12, 13])
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 4)
        self.assertEqual([g.shift for g in r.segments],
                         [Fraction(0), Fraction(20000), Fraction(40000), Fraction(60000)])
        self.assertEqual(len(r.bias.missing_intervals), 3)
        self.assertEqual(
            [(m.ref_lo, m.ref_hi) for m in r.bias.missing_intervals],
            [(20000, 33000), (60000, 73000), (100000, 113000)],
        )


class TestCutDeterminism(unittest.TestCase):
    def test_arrival_order_invariant(self):
        for kept in ([0, 1, 4, 5, 8, 9],
                     [0, 1, 2, 5, 6, 9, 10, 11],
                     [0, 1, 4, 5, 8, 9, 12, 13]):
            A = anchor_points(kept)
            base = fitter.detect_cuts(A, 3.0, 1500)
            rng = random.Random(2026)
            for _ in range(40):
                B = A[:]
                rng.shuffle(B)
                self.assertEqual(fitter.detect_cuts(B, 3.0, 1500), base, kept)

    def test_repeated_align_bit_identical(self):
        from subalign.persistence import to_json
        s, _, _ = gap_system([i for i in range(18) if i not in (6, 7, 12, 13)],
                             step=2000, dur=700)
        s.align()
        first = to_json(s)
        s.align()
        self.assertEqual(to_json(s), first)

    def test_missing_intervals_stable_order(self):
        s, _, _ = gap_system([0, 1, 4, 5, 8, 9, 12, 13])
        s.align()
        lo = [m.ref_lo for m in s.report("t").bias.missing_intervals]
        self.assertEqual(lo, sorted(lo))


class TestNoFalseCutsUnchanged(unittest.TestCase):
    def test_pure_shift_unchanged(self):
        n = 14
        ref = [Entry(i * 10000, i * 10000 + 3000, f"L{i} K{i}") for i in range(n)]
        cand = [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref]
        s = SubtitleSystem.build(ref, {"t": ("v", cand)})
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 1)
        self.assertEqual(r.segments[0].shift, Fraction(-2000))
        self.assertEqual(r.bias.missing_intervals, ())

    def test_pure_rate_drift_dense_unchanged(self):
        # 密锚点纯漂移（无缺失）不得切出任何段。
        n = 30
        ref = [Entry(i * 2000, i * 2000 + 700, f"L{i} K{i}") for i in range(n)]
        cand = []
        for i, e in enumerate(ref):
            mid = int(round(e.mid * 1000 / 1004)) + 5000
            cand.append(Entry(mid - 350, mid + 350, e.text))
        s = SubtitleSystem.build(ref, {"t": ("v", cand)},
                                 config=AlignConfig(min_cut_gap_ms=1000))
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 1)
        self.assertEqual(r.bias.missing_intervals, ())
        self.assertAlmostEqual(float(r.segments[0].ratio), 1.004, places=4)

    def test_single_gap_unchanged(self):
        s, _, _ = gap_system([0, 1, 2, 3, 4, 7, 8, 9])
        s.align()
        r = s.report("t")
        self.assertEqual(len(r.segments), 2)
        self.assertEqual(len(r.bias.missing_intervals), 1)
        self.assertEqual(r.bias.rate_ratio, Fraction(1))


if __name__ == "__main__":
    unittest.main()
