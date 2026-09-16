"""需求 2/3/4：三类偏差分项、顺序无关拟合、中段缺失两侧分别对齐。"""

import random
import unittest
from fractions import Fraction

from subalign import AlignConfig, Entry, Reference, SubtitleTrack, SubtitleSystem
from subalign import fitter
from subalign.matcher import AnchorMatcher
from subalign.model import Anchor


def identical_text_ref(n=10, step=10000, first=0, dur=3000):
    return [Entry(first + i * step, first + i * step + dur, f"Line {i} TOK{i}") for i in range(n)]


def make_track(tid, entries, source="src"):
    return SubtitleTrack(tid, source, entries)


class TestShiftOnly(unittest.TestCase):
    def test_global_shift(self):
        ref = identical_text_ref()
        shift_ms = 2000
        cand = [
            Entry(e.start + shift_ms, e.end + shift_ms, e.text) for e in ref
        ]
        s = SubtitleSystem.build(ref, {"t": ("vendor", cand)}, config=AlignConfig(tolerance_ms=50))
        s.align()
        rep = s.report("t")
        self.assertEqual(len(rep.segments), 1)
        self.assertEqual(rep.segments[0].ratio, Fraction(1))
        self.assertEqual(rep.segments[0].shift, Fraction(-shift_ms))
        self.assertEqual(rep.bias.rate_ratio, Fraction(1))
        self.assertEqual(rep.bias.shift_ms, Fraction(-shift_ms))
        self.assertEqual(rep.bias.missing_intervals, ())
        self.assertTrue(rep.tolerance.within_tolerance)
        # 全部锚点精确。
        self.assertTrue(all(a.kind == "exact" for a in rep.anchors))


class TestRateDrift(unittest.TestCase):
    def test_frame_rate_drift_exact(self):
        # 基准中点 r = 10000 i + 6500；候选 c = 0.99 r；校正 r = (100/99) c。
        n = 10
        ref = [Entry(5000 + i * 10000, 8000 + i * 10000, f"Line {i} TOK{i}") for i in range(n)]
        cand = []
        for i in range(n):
            mid = (6500 + i * 10000) * 99 // 100
            cand.append(Entry(mid - 1500, mid + 1500, f"Line {i} TOK{i}"))
        s = SubtitleSystem.build(ref, {"t": ("23.976fps source", cand)},
                                 config=AlignConfig(tolerance_ms=10))
        s.align()
        seg = s.report("t").segments[0]
        self.assertEqual(seg.ratio, Fraction(100, 99))
        self.assertEqual(seg.shift, Fraction(0))
        self.assertEqual(seg.residual_max_abs, 0)
        self.assertTrue(s.report("t").tolerance.within_tolerance)
        # 漂移越往后越大：查询给出的校正量随时刻增大。
        q1 = s.correct_time("t", cand[1].mid)
        q9 = s.correct_time("t", cand[9].mid)
        self.assertAlmostEqual(float(q1.corrected_ms - q1.cand_ms), float(ref[1].mid - cand[1].mid))
        self.assertGreater(
            q9.corrected_ms - q9.cand_ms, q1.corrected_ms - q1.cand_ms
        )


class TestOrderInsensitivity(unittest.TestCase):
    def test_ols_permutation_invariant(self):
        pts = [(i * 1000 + 300, i * 1003 + 1200) for i in range(8)]
        base = fitter.ols_fit(pts)
        rng = random.Random(1234)
        for _ in range(10):
            p = pts[:]
            rng.shuffle(p)
            self.assertEqual(fitter.ols_fit(p), base)

    def test_segments_permutation_invariant(self):
        anchors = [
            Anchor(ref_index=i, cand_index=j, ref_mid=x, cand_mid=y,
                   score=1.0, kind="exact", evidence="")
            for i, (j, x, y) in enumerate([
                (0, 1000, 1000), (1, 11000, 11000), (2, 21000, 21000),
                (3, 31000, 31000),
                (7, 71000, 41000), (8, 81000, 51000), (9, 91000, 61000),
            ])
        ]
        cuts = fitter.detect_cuts(anchors, 3.0, 1500)
        segs1, miss1 = fitter.build_segments(anchors, cuts, 2)
        rng = random.Random(42)
        for _ in range(8):
            p = anchors[:]
            rng.shuffle(p)
            cuts_p = fitter.detect_cuts(p, 3.0, 1500)
            segs2, miss2 = fitter.build_segments(p, cuts_p, 2)
            self.assertEqual(
                [(sg.ratio, sg.shift, sg.domain_lo, sg.domain_hi) for sg in segs1],
                [(sg.ratio, sg.shift, sg.domain_lo, sg.domain_hi) for sg in segs2],
            )
            self.assertEqual(
                [(m.ref_lo, m.ref_hi) for m in miss1],
                [(m.ref_lo, m.ref_hi) for m in miss2],
            )

    def test_track_insertion_order_invariant(self):
        ref = identical_text_ref()
        tracks = {
            "a": ("src-a", [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref]),
            "b": ("src-b", [Entry(round(e.mid * 99 / 100) - 1500 + 5000,
                                 round(e.mid * 99 / 100) + 1500 + 5000, e.text)
                            for e in ref]),
        }
        s1 = SubtitleSystem.build(ref, {"a": tracks["a"], "b": tracks["b"]})
        s2 = SubtitleSystem.build(ref, {"b": tracks["b"], "a": tracks["a"]})
        s1.align(); s2.align()
        for tid in ("a", "b"):
            r1, r2 = s1.report(tid), s2.report(tid)
            self.assertEqual(
                [(g.ratio, g.shift) for g in r1.segments],
                [(g.ratio, g.shift) for g in r2.segments],
            )
        self.assertEqual(
            [c.key() for c in s1.conflicts()], [c.key() for c in s2.conflicts()]
        )

    def test_repeated_align_bit_identical(self):
        ref = identical_text_ref()
        cand = [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref]
        s = SubtitleSystem.build(ref, {"t": ("v", cand)})
        s.align()
        from subalign.persistence import to_json
        first = to_json(s)
        s.align()
        second = to_json(s)
        self.assertEqual(first, second)


class TestMissingMiddle(unittest.TestCase):
    def _gap_system(self):
        ref = identical_text_ref()
        kept = [0, 1, 2, 3, 4, 7, 8, 9]
        cand = [
            Entry(k * 10000, k * 10000 + 3000, f"Line {i} TOK{i}")
            for k, i in enumerate(kept)
        ]
        s = SubtitleSystem.build(ref, {"gap": ("cut-source", cand)},
                                 config=AlignConfig(tolerance_ms=50))
        s.align()
        return s

    def test_two_segments_and_interval(self):
        s = self._gap_system()
        rep = s.report("gap")
        self.assertEqual(rep.status, "aligned_segmented")
        self.assertEqual(len(rep.segments), 2)
        left, right = rep.segments
        self.assertEqual(left.ratio, Fraction(1))
        self.assertEqual(right.ratio, Fraction(1))
        self.assertEqual(left.shift, Fraction(0))
        self.assertEqual(right.shift, Fraction(30000 - 10000))
        # 缺失区间 = 基准第 5、6 条的时间并集。
        miss = rep.bias.missing_intervals
        self.assertEqual(len(miss), 1)
        self.assertEqual((miss[0].ref_lo, miss[0].ref_hi), (50000, 63000))
        self.assertEqual(miss[0].duration_ms, 13000)
        self.assertEqual(miss[0].left_anchor, (4, 4))
        self.assertEqual(miss[0].right_anchor, (7, 5))
        # 速率未被缺失扭曲。
        self.assertEqual(rep.bias.rate_ratio, Fraction(1))

    def test_rate_not_distorted_by_gap(self):
        # 反证：若不切口做单段 OLS，斜率会是 9/7；分段后两段都必须精确为 1。
        rep = self._gap_system().report("gap")
        one_line_ratio = fitter.ols_fit(
            [(a.cand_mid, a.ref_mid) for a in rep.anchors]
        )[0]
        self.assertNotEqual(one_line_ratio, Fraction(1))
        for seg in rep.segments:
            self.assertEqual(seg.ratio, Fraction(1))
            self.assertEqual(seg.residual_max_abs, 0)
        self.assertTrue(rep.tolerance.within_tolerance)

    def test_correct_time_uses_segment_sides(self):
        s = self._gap_system()
        # 左側：候选 15000 → 基准 15000
        self.assertEqual(s.correct_time("gap", 15000).corrected_ms, Fraction(15000))
        # 右側：候选 55000 → 基准 75000
        q = s.correct_time("gap", 55000)
        self.assertEqual(q.corrected_ms, Fraction(75000))
        self.assertEqual(q.segment_index, 1)
        self.assertEqual(len(q.anchors), 3)

    def test_no_false_cut_on_pure_rate_drift(self):
        ref = identical_text_ref(n=12)
        # 纯速率漂移（无缺失）不应被误切。
        cand = []
        for i, e in enumerate(ref):
            mid = int(round(e.mid * 1002 / 1000))
            cand.append(Entry(mid - 1500, mid + 1500, e.text))
        s = SubtitleSystem.build(ref, {"r": ("v", cand)},
                                 config=AlignConfig(min_cut_gap_ms=1000))
        s.align()
        rep = s.report("r")
        self.assertEqual(len(rep.segments), 1)
        self.assertEqual(rep.bias.missing_intervals, ())


class TestTolerance(unittest.TestCase):
    def test_one_late_anchor_is_violation(self):
        ref = identical_text_ref()
        cand = []
        for i, e in enumerate(ref):
            extra = 3000 if i == 9 else 0  # 最后一条错位 3s
            cand.append(Entry(e.start + extra, e.end + extra, e.text))
        s = SubtitleSystem.build(ref, {"t": ("v", cand)},
                                 config=AlignConfig(tolerance_ms=1000))
        s.align()
        violations = s.report("t").tolerance.violations
        self.assertEqual(len(violations), 1)
        self.assertEqual(violations[0].ref_start, 90000)
        self.assertIn((9, 9), violations[0].anchor_points)
        self.assertGreater(violations[0].max_residual, 1000)


class TestInsufficientAnchors(unittest.TestCase):
    def test_no_common_text(self):
        ref = identical_text_ref()
        cand = [Entry(i * 10000, i * 10000 + 3000, f"翻译句子 {i}") for i in range(10)]
        s = SubtitleSystem.build(ref, {"zh": ("translated", cand)})
        s.align()
        rep = s.report("zh")
        self.assertEqual(rep.status, "insufficient_anchors")
        self.assertEqual(rep.segments, ())
        from subalign import AlignmentError
        with self.assertRaises(AlignmentError):
            s.correct_time("zh", 1000)


if __name__ == "__main__":
    unittest.main()
