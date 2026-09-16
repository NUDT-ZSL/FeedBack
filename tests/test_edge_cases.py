"""补充边界：不均匀间隔锚点拟合、双切口、文件级错误处理。"""

import os
import tempfile
import unittest
from fractions import Fraction

from subalign import (
    AlignConfig,
    Entry,
    PersistenceError,
    SubtitleSystem,
    from_json,
    to_json,
)
from subalign import fitter
from subalign.model import Anchor
from subalign.persistence import from_dict


class TestUnevenSpacing(unittest.TestCase):
    def test_uneven_anchor_spacing_recovers_line(self):
        # 锚点间隔严重不均（3s、47s、11s），仍须精确恢复 r = 1.004 c + 700。
        ratio, shift = Fraction(1004, 1000), Fraction(700)
        cand_mids = [3000, 50000, 61000, 90000]
        ref_entries = []
        # 先铺基准条目，再在指定位置放可匹配锚点。
        anchor_ref_idx = []
        cursor = 0
        for k, cm in enumerate(cand_mids):
            rm = ratio * cm + shift  # 精确整数
            self.assertEqual(rm.denominator, 1)
            mid = int(rm)
            ref_entries.append(Entry(mid - 1500, mid + 1500, f"TOK{k}"))
            anchor_ref_idx.append(k)
        cand_entries = [
            Entry(cm - 1500, cm + 1500, f"TOK{k}") for k, cm in enumerate(cand_mids)
        ]
        s = SubtitleSystem.build(
            ref_entries, {"t": ("v", cand_entries)}, config=AlignConfig(tolerance_ms=10)
        )
        s.align()
        seg = s.report("t").segments[0]
        self.assertEqual(seg.ratio, ratio)
        self.assertEqual(seg.shift, shift)
        self.assertEqual(seg.residual_max_abs, 0)

    def test_two_points_uneven_give_exact_line(self):
        pts = [(5000, 9000), (80000, 100000)]
        r, b = fitter.ols_fit(pts)
        self.assertEqual(r, Fraction(91000, 75000))
        self.assertEqual(b, Fraction(9000) - r * 5000)


class TestTwoCuts(unittest.TestCase):
    def test_three_segments_two_missing_intervals(self):
        # 基准 14 条；候选保留 0..3、6..9、12..13，共两个缺口（各缺 2 条）。
        ref = [Entry(i * 10000, i * 10000 + 3000, f"L{i} K{i}") for i in range(14)]
        kept = [0, 1, 2, 3, 6, 7, 8, 9, 12, 13]
        cand = [
            Entry(k * 10000, k * 10000 + 3000, f"L{i} K{i}")
            for k, i in enumerate(kept)
        ]
        s = SubtitleSystem.build(ref, {"t": ("cut", cand)},
                                 config=AlignConfig(tolerance_ms=50))
        s.align()
        rep = s.report("t")
        self.assertEqual(len(rep.segments), 3)
        for seg in rep.segments:
            self.assertEqual(seg.ratio, Fraction(1))
        self.assertEqual([seg.shift for seg in rep.segments],
                         [Fraction(0), Fraction(20000), Fraction(40000)])
        miss = rep.bias.missing_intervals
        self.assertEqual(len(miss), 2)
        self.assertEqual((miss[0].ref_lo, miss[0].ref_hi), (40000, 53000))
        self.assertEqual((miss[1].ref_lo, miss[1].ref_hi), (100000, 113000))
        # 段域首尾相接覆盖整条候选轴。
        self.assertIsNone(rep.segments[0].domain_lo)
        self.assertIsNone(rep.segments[-1].domain_hi)
        self.assertEqual(rep.segments[0].domain_hi, rep.segments[1].domain_lo)
        self.assertEqual(rep.segments[1].domain_hi, rep.segments[2].domain_lo)
        # 各段查询互不串用参数。
        self.assertEqual(s.correct_time("t", 15000).corrected_ms, Fraction(15000))
        self.assertEqual(s.correct_time("t", 55000).corrected_ms, Fraction(75000))
        self.assertEqual(s.correct_time("t", 95000).corrected_ms, Fraction(135000))
        self.assertEqual(rep.bias.rate_ratio, Fraction(1))


class TestFileErrors(unittest.TestCase):
    def test_missing_file(self):
        with self.assertRaises(PersistenceError):
            from_json(os.path.join(tempfile.gettempdir(), "definitely-no-such-file.json"))

    def test_bad_format_and_version(self):
        with self.assertRaises(PersistenceError):
            from_dict({"format": "other", "version": 1})
        with self.assertRaises(PersistenceError):
            from_dict({"format": "subalign", "version": 99})

    def test_export_contains_all_required_parts(self):
        ref = [Entry(i * 10000, i * 10000 + 3000, f"L{i} K{i}") for i in range(6)]
        s = SubtitleSystem.build(
            ref, {"a": ("v1", [Entry(e.start + 1000, e.end + 1000, e.text) for e in ref]),
                  "b": ("v2", [Entry(e.start + 5000, e.end + 5000, e.text) for e in ref])},
        )
        s.align()
        payload = to_json(s)
        # 需求 7 的文件内容要件。
        for key in ("reference", "tracks", "config", "results", "conflicts"):
            self.assertIn(f'"{key}"', payload)
        for tid in ("a", "b"):
            self.assertIn(tid, payload)
        # 容差配置在文件里。
        self.assertIn("tolerance_ms", payload)
        # 锚点、参数、缺失/冲突字段在 results/conflicts 中。
        self.assertIn('"anchors"', payload)
        self.assertIn('"ratio"', payload)
        self.assertIn('"missing_intervals"', payload)
        self.assertIn('"track_a"', payload)


if __name__ == "__main__":
    unittest.main()
