"""需求 7：导出/导入、损坏报错、失败后状态不变。"""

import json
import os
import tempfile
import unittest
from fractions import Fraction

from subalign import (
    AlignConfig,
    Entry,
    PersistenceError,
    Reference,
    SubtitleSystem,
    SubtitleTrack,
    from_json,
    to_json,
)
from subalign.persistence import from_json_text, to_dict


def build_full_system():
    ref = [Entry(i * 10000, i * 10000 + 3000, f"Line {i} TOK{i}") for i in range(12)]
    # 整体偏移
    t_shift = [Entry(e.start + 2000, e.end + 2000, e.text) for e in ref]
    # 帧率漂移：cand = 0.99*ref + 3000，首条不会为负。
    t_rate = []
    for e in ref:
        mid = int(round(e.mid * 99 / 100)) + 3000
        t_rate.append(Entry(mid - 1500, mid + 1500, e.text))
    # 中段缺失（删掉基准 5、6 两条对应内容）
    kept = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11]
    t_gap = [
        Entry(k * 10000, k * 10000 + 3000, f"Line {i} TOK{i}")
        for k, i in enumerate(kept)
    ]
    # 与 t_shift 矛盾的另一来源
    t_other = [Entry(e.start + 9000, e.end + 9000, e.text) for e in ref]
    s = SubtitleSystem.build(
        ref,
        {
            "shift": ("vendor-a", t_shift),
            "rate": ("vendor-b", t_rate),
            "gap": ("vendor-c", t_gap),
            "other": ("vendor-d", t_other),
        },
        config=AlignConfig(tolerance_ms=100),
    )
    s.align()
    return s


class TestRoundTrip(unittest.TestCase):
    def test_roundtrip_preserves_everything(self):
        s = build_full_system()
        text = to_json(s)
        s2 = from_json_text(text)

        self.assertEqual(s2.track_ids(), s.track_ids())
        self.assertEqual(s2.config, s.config)
        self.assertEqual(len(s2.conflicts()), len(s.conflicts()))
        for tid in s.track_ids():
            r1, r2 = s.report(tid), s2.report(tid)
            self.assertEqual(r2.status, r1.status)
            self.assertEqual(len(r2.segments), len(r1.segments))
            for g1, g2 in zip(r1.segments, r2.segments):
                self.assertEqual(g2.ratio, g1.ratio)
                self.assertEqual(g2.shift, g1.shift)
                self.assertEqual(g2.domain_lo, g1.domain_lo)
                self.assertEqual(g2.domain_hi, g1.domain_hi)
                self.assertEqual(
                    [(a.ref_index, a.cand_index) for a in g2.anchors],
                    [(a.ref_index, a.cand_index) for a in g1.anchors],
                )
            self.assertEqual(r2.bias.shift_ms, r1.bias.shift_ms)
            self.assertEqual(r2.bias.rate_ratio, r1.bias.rate_ratio)
            self.assertEqual(
                [(m.ref_lo, m.ref_hi) for m in r2.bias.missing_intervals],
                [(m.ref_lo, m.ref_hi) for m in r1.bias.missing_intervals],
            )
            self.assertEqual(
                [
                    (v.ref_start, v.ref_end, v.max_residual)
                    for v in r2.tolerance.violations
                ],
                [
                    (v.ref_start, v.ref_end, v.max_residual)
                    for v in r1.tolerance.violations
                ],
            )
            # 查询结果完全一致。
            for x in (0, 12345, 55555, 118000):
                q1, q2 = s.correct_time(tid, x), s2.correct_time(tid, x)
                self.assertEqual(q2.corrected_ms, q1.corrected_ms)
                self.assertEqual(q2.segment_index, q1.segment_index)
        self.assertEqual(
            [c.key() for c in s2.conflicts()], [c.key() for c in s.conflicts()]
        )
        # 再次导出必须字节级一致。
        self.assertEqual(to_json(s2), text)

    def test_roundtrip_file(self):
        s = build_full_system()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "align.subalign.json")
            to_json(s, path)
            s2 = from_json(path)
            self.assertEqual(to_json(s2), to_json(s))


class TestCorruption(unittest.TestCase):
    def setUp(self):
        self.text = to_json(build_full_system())

    def _expect_fail(self, raw_text, needles=()):
        with self.assertRaises(PersistenceError) as cm:
            from_json_text(raw_text)
        msg = str(cm.exception)
        for n in needles:
            self.assertIn(n, msg)

    def test_bad_json(self):
        self._expect_fail("{not json", ["JSON 解析失败"])

    def test_missing_top_fields(self):
        data = json.loads(self.text)
        del data["tracks"]
        self._expect_fail(json.dumps(data), ["tracks"])

    def test_duplicate_track_id(self):
        data = json.loads(self.text)
        data["tracks"][1]["id"] = data["tracks"][0]["id"]
        self._expect_fail(json.dumps(data), ["重复"])

    def test_illegal_time(self):
        data = json.loads(self.text)
        data["tracks"][0]["entries"][2]["end"] = 1
        self._expect_fail(json.dumps(data), ["结束时刻", "entry[2]"])

    def test_non_monotonic_entry(self):
        data = json.loads(self.text)
        data["tracks"][0]["entries"][5]["start"] = 0
        self._expect_fail(json.dumps(data), ["单调不减"])

    def test_missing_result_fields(self):
        data = json.loads(self.text)
        del data["results"]["shift"]["segments"]
        self._expect_fail(json.dumps(data), ["segments"])

    def test_tampered_ratio_detected(self):
        data = json.loads(self.text)
        # 手改存储参数但不改输入 → 重算不一致必须被发现。
        data["results"]["shift"]["segments"][0]["ratio"] = "1.5"
        self._expect_fail(json.dumps(data), ["ratio", "不一致"])

    def test_tampered_conflict_detected(self):
        data = json.loads(self.text)
        data["conflicts"][0]["rate_delta"] = "99/100"
        self._expect_fail(json.dumps(data), ["rate_delta"])

    def test_tampered_missing_duration_detected(self):
        data = json.loads(self.text)
        mi = data["results"]["gap"]["bias"]["missing_intervals"][0]
        mi["duration_ms"] = mi["duration_ms"] + 9999
        self._expect_fail(json.dumps(data), ["missing_intervals", "不一致"])

    def test_missing_interval_missing_field(self):
        data = json.loads(self.text)
        del data["results"]["gap"]["bias"]["missing_intervals"][0]["confidence"]
        self._expect_fail(json.dumps(data), ["confidence"])

    def test_unknown_track_result(self):
        data = json.loads(self.text)
        data["results"]["ghost"] = data["results"]["shift"]
        self._expect_fail(json.dumps(data), ["ghost"])

    def test_bad_fraction(self):
        data = json.loads(self.text)
        data["results"]["shift"]["segments"][0]["shift"] = "abc"
        self._expect_fail(json.dumps(data), ["shift"])

    def test_failure_leaves_state_unchanged(self):
        # 已存在的系统不受失败载入影响。
        good = build_full_system()
        before = to_json(good)
        data = json.loads(self.text)
        data["tracks"][0]["entries"][1]["start"] = -5
        with self.assertRaises(PersistenceError):
            from_json_text(json.dumps(data))
        good.align()
        self.assertEqual(to_json(good), before)


class TestFractionPrecision(unittest.TestCase):
    def test_non_integer_ratio_exact_roundtrip(self):
        ref = [Entry(60000 + i * 30000, 63000 + i * 30000, f"L{i} K{i}") for i in range(8)]
        cand = []
        for e in ref:
            mid = (e.start + e.end) // 2
            cmid = mid * 3  # 候选时钟走得慢 3 倍 → 校正 ratio = 1/3
            cand.append(Entry(cmid - 4500, cmid + 4500, e.text))
        s = SubtitleSystem.build(ref, {"t": ("v", cand)})
        s.align()
        ratio = s.report("t").segments[0].ratio
        self.assertEqual(ratio, Fraction(1, 3))
        s2 = from_json_text(to_json(s))
        self.assertEqual(s2.report("t").segments[0].ratio, Fraction(1, 3))


if __name__ == "__main__":
    unittest.main()
