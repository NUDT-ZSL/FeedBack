"""需求 5/6：矛盾参数双方保留 + 确定性查询。"""

import unittest
from fractions import Fraction

from subalign import AlignConfig, Entry, SubtitleSystem
from subalign.timecode import to_millis


def ref_lines(n=12, step=10000):
    return [Entry(i * step, i * step + 3000, f"Line {i} TOK{i}") for i in range(n)]


def shifted(ref, ms):
    return [Entry(e.start + ms, e.end + ms, e.text) for e in ref]


class TestConflicts(unittest.TestCase):
    def test_conflicting_shifts_both_kept(self):
        ref = ref_lines()
        s = SubtitleSystem.build(
            ref,
            {
                "vendor-a": ("甲来源", shifted(ref, 2000)),
                "vendor-b": ("乙来源", shifted(ref, 5000)),
            },
            config=AlignConfig(conflict_shift_eps_ms=400),
        )
        s.align()
        conflicts = s.conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        ids = sorted((c.track_a.track_id, c.track_b.track_id))
        self.assertEqual(ids, ["vendor-a", "vendor-b"])
        # 双方原始参数都还在各自报告里，没有静默择一。
        self.assertEqual(s.report("vendor-a").segments[0].shift, Fraction(-2000))
        self.assertEqual(s.report("vendor-b").segments[0].shift, Fraction(-5000))
        # 速率相同（同为 1）→ 触发的是平移矛盾；错位差 3000ms。
        self.assertEqual(c.rate_delta, Fraction(0))
        self.assertEqual(c.shift_delta_ms, Fraction(3000))
        # 区间覆盖共同基准范围。
        self.assertEqual(c.interval_ref_lo, 1500)
        self.assertEqual(c.interval_ref_hi, 111500)
        # 双方来源与各自参数都记录在案。
        self.assertEqual(c.track_a.track_id, "vendor-a")
        self.assertEqual(c.track_b.track_id, "vendor-b")

    def test_conflicting_rates(self):
        ref = ref_lines()
        rate_a = []
        rate_b = []
        for e in ref:
            ma = e.mid
            rate_a.append(Entry(ma - 1000, ma + 1000, e.text))  # ratio 1
            mb = int(round(ma * 1000 / 1020))
            rate_b.append(Entry(mb - 1000, mb + 1000, e.text))  # ratio 1.02
        s = SubtitleSystem.build(
            ref,
            {"r1": ("a", rate_a), "r2": ("b", rate_b)},
            config=AlignConfig(conflict_rate_eps=Fraction(1, 100)),
        )
        s.align()
        conflicts = s.conflicts()
        self.assertTrue(conflicts)
        c = conflicts[0]
        self.assertGreater(c.rate_delta, Fraction(1, 100))
        self.assertNotEqual(c.track_a.ratio, c.track_b.ratio)

    def test_consistent_tracks_no_conflict(self):
        ref = ref_lines()
        s = SubtitleSystem.build(
            ref,
            {"a": ("a", shifted(ref, 2000)), "b": ("b", shifted(ref, 2100))},
            config=AlignConfig(conflict_shift_eps_ms=400),
        )
        s.align()
        self.assertEqual(s.conflicts(), [])

    def test_conflict_stable_order(self):
        ref = ref_lines()
        s = SubtitleSystem.build(
            ref,
            {"a": ("a", shifted(ref, 2000)), "b": ("b", shifted(ref, 9000)),
             "c": ("c", shifted(ref, 14000))},
        )
        s.align()
        keys1 = [(c.key()) for c in s.conflicts()]
        s2 = SubtitleSystem.build(
            ref,
            {"c": ("c", shifted(ref, 14000)), "a": ("a", shifted(ref, 2000)),
             "b": ("b", shifted(ref, 9000))},
        )
        s2.align()
        keys2 = [c.key() for c in s2.conflicts()]
        self.assertEqual(keys1, keys2)
        self.assertEqual(keys1, sorted(keys1))


class TestQuery(unittest.TestCase):
    def _sys(self):
        ref = ref_lines()
        return SubtitleSystem.build(
            ref, {"t": ("v", shifted(ref, 2000))}, config=AlignConfig()
        )

    def test_query_basic_and_provenance(self):
        s = self._sys()
        s.align()
        q = s.correct_time("t", "00:00:32.000")
        self.assertEqual(q.cand_ms, 32000)
        self.assertEqual(q.corrected_ms, Fraction(30000))
        self.assertEqual(q.ratio, Fraction(1))
        self.assertEqual(q.shift, Fraction(-2000))
        self.assertEqual(len(q.anchors), 12)
        self.assertFalse(q.extrapolated)
        # 参与拟合锚点排序稳定。
        self.assertEqual(
            [a.cand_index for a in q.anchors], sorted(a.cand_index for a in q.anchors)
        )

    def test_query_repeatable_bit_identical(self):
        s = self._sys()
        s.align()
        q1 = s.correct_time("t", 45678)
        q2 = s.correct_time("t", 45678)
        self.assertEqual(q1.corrected_ms, q2.corrected_ms)
        self.assertEqual(
            [(a.ref_index, a.cand_index) for a in q1.anchors],
            [(a.ref_index, a.cand_index) for a in q2.anchors],
        )

    def test_query_accepts_many_time_types(self):
        s = self._sys()
        s.align()
        self.assertEqual(s.correct_time("t", "00:00:10.000").corrected_ms, Fraction(8000))
        self.assertEqual(s.correct_time("t", 10000).corrected_ms, Fraction(8000))

    def test_query_unknown_track(self):
        s = self._sys()
        s.align()
        with self.assertRaises(Exception):
            s.correct_time("nope", 0)


if __name__ == "__main__":
    unittest.main()
