"""引擎行为与增量一致性测试。运行：python -m unittest discover tests"""
import copy
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aligner.engine import AlignmentEngine
from aligner.io import load_project
from aligner.models import Anchor, MediaInfo, Segment

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def snapshot(engine):
    return {sid: (r.offset, r.status, tuple(sorted(r.conflict_ids)),
                  r.drift, r.cumulative_drift)
            for sid, r in engine.results.items()}


class TestSampleProject(unittest.TestCase):
    def setUp(self):
        media, segs, anchors = load_project(
            os.path.join(ROOT, "sample_project.json"))
        self.engine = AlignmentEngine(media, segs, anchors)

    def test_anchor_offset(self):
        r = self.engine.results["S01"]
        self.assertAlmostEqual(r.offset, 2.0)
        self.assertEqual(r.status, "ok")

    def test_anchor_vs_context_conflict_keeps_both_evidences(self):
        r = self.engine.results["S05"]
        self.assertEqual(r.status, "conflict")
        conf = self.engine.conflicts["anchor:S05"]
        kinds = {e.kind for e in conf.evidences}
        self.assertEqual(kinds, {"anchor", "context"})
        self.assertIsNone(conf.resolution)

    def test_overlap_marks_both_segments(self):
        self.assertEqual(self.engine.results["S02"].status, "conflict")
        self.assertEqual(self.engine.results["S03"].status, "conflict")
        self.assertIn("overlap:S02:S03", self.engine.conflicts)

    def test_inverted_duration_untrusted(self):
        r = self.engine.results["S07"]
        self.assertEqual(r.status, "untrusted")
        self.assertIn("invert:S07", r.conflict_ids)

    def test_out_of_bounds(self):
        r = self.engine.results["S12"]
        self.assertEqual(r.status, "conflict")
        self.assertIn("bounds:S12", r.conflict_ids)

    def test_missing_anchor_reference(self):
        r = self.engine.results["S13"]
        self.assertEqual(r.status, "conflict")
        self.assertTrue(any(e.kind == "no_anchor" for e in r.evidences))

    def test_no_anchors_at_all_untrusted(self):
        media = MediaInfo(100.0, 25.0)
        segs = [Segment("X1", 1.0, 2.0, "a"), Segment("X2", 3.0, 4.0, "b")]
        eng = AlignmentEngine(media, segs, [])
        for r in eng.results.values():
            self.assertEqual(r.status, "untrusted")
            self.assertIsNone(r.offset)

    def test_drift_trend(self):
        trend = self.engine.drift_trend()
        self.assertEqual(len(trend), len(self.engine.segments))
        s11 = [t for t in trend if t[0] == "S11"][0]
        self.assertAlmostEqual(s11[1], 5.0)          # 偏移
        self.assertAlmostEqual(s11[3], 5.0 - 2.0)    # 相对首段累计漂移


class TestIncrementalConsistency(unittest.TestCase):
    """增量更新必须与整体重推结果一致。"""

    def setUp(self):
        media, segs, anchors = load_project(
            os.path.join(ROOT, "sample_project.json"))
        self.media, self.segs, self.anchors = media, segs, anchors

    def test_anchor_update_matches_full_recompute(self):
        eng = AlignmentEngine(self.media, copy.deepcopy(self.segs),
                              copy.deepcopy(self.anchors))
        affected = eng.update_anchor("A2", 160.0)
        self.assertIn("S05", affected)
        ref = AlignmentEngine(self.media, copy.deepcopy(self.segs),
                              [Anchor(a.id, 160.0 if a.id == "A2" else
                                      a.media_time, a.label)
                               for a in self.anchors])
        self.assertEqual(snapshot(eng), snapshot(ref))
        self.assertEqual({c: (k.kind, k.resolution)
                          for c, k in eng.conflicts.items()},
                         {c: (k.kind, k.resolution)
                          for c, k in ref.conflicts.items()})

    def test_resolve_conflict_matches_full_recompute(self):
        eng = AlignmentEngine(self.media, copy.deepcopy(self.segs),
                              copy.deepcopy(self.anchors))
        eng.resolve_conflict("anchor:S05", "context")
        ref = AlignmentEngine(self.media, copy.deepcopy(self.segs),
                              copy.deepcopy(self.anchors))
        ref.resolutions["anchor:S05"] = "context"
        ref.recompute_all()
        self.assertEqual(snapshot(eng), snapshot(ref))
        r = eng.results["S05"]
        self.assertAlmostEqual(r.offset, 2.0)  # 采信上下文偏移

    def test_unaffected_segments_unchanged(self):
        eng = AlignmentEngine(self.media, copy.deepcopy(self.segs),
                              copy.deepcopy(self.anchors))
        before = snapshot(eng)
        affected = eng.update_anchor("A4", 506.0)
        after = snapshot(eng)
        for sid in before:
            if sid not in affected and sid not in ("S12",):
                self.assertEqual(before[sid], after[sid], sid)


if __name__ == "__main__":
    unittest.main()
