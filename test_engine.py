# -*- coding: utf-8 -*-
"""对齐引擎测试：异常检测、矛盾保留、增量与全量一致性。"""
import copy
import json
import os
import unittest

import align_engine as eng


def load_sample():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                           "sample_data.json"), encoding="utf-8") as f:
        return json.load(f)


def seg(result, sid):
    return next(s for s in result["segments"] if s["id"] == sid)


class TestDetect(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = eng.derive(load_sample())

    def test_inverted_untrusted(self):
        s = seg(self.result, "s5")
        self.assertEqual(s["status"], "untrusted")
        self.assertTrue(any("倒置" in i for i in s["issues"]))

    def test_anchor_conflict_keeps_both_parties(self):
        s = seg(self.result, "s6")
        self.assertEqual(s["status"], "conflict")
        c = next(c for c in s["conflicts"] if c["type"] == "anchor_conflict")
        types = {p["type"] for p in c["parties"]}
        self.assertEqual(types, {"anchor", "interp"})

    def test_overlap_marks_both(self):
        for sid in ("s7", "s8"):
            s = seg(self.result, sid)
            self.assertTrue(any(c["type"] == "overlap"
                                for c in s["conflicts"]), sid)

    def test_out_of_bounds(self):
        s = seg(self.result, "s12")
        self.assertTrue(any("越界" in i for i in s["issues"]))

    def test_extrapolation_low_confidence(self):
        self.assertEqual(seg(self.result, "s1")["confidence"], "low")
        self.assertEqual(seg(self.result, "s11")["confidence"], "low")
        self.assertEqual(seg(self.result, "s3")["confidence"], "medium")
        self.assertEqual(seg(self.result, "s2")["confidence"], "high")

    def test_no_anchors_all_untrusted(self):
        st = load_sample()
        st["anchors"] = []
        r = eng.derive(st)
        for s in r["segments"]:
            if s["raw_end"] > s["raw_start"]:
                self.assertEqual(s["status"], "untrusted")
                self.assertTrue(any("缺少锚点" in i for i in s["issues"]))

    def test_trend_present(self):
        drifts = [t["drift"] for t in self.result["trend"]
                  if t["drift"] is not None]
        self.assertTrue(drifts)
        t2 = next(t for t in self.result["trend"] if t["id"] == "s2")
        self.assertAlmostEqual(t2["drift"], 0.0, places=6)  # 首锚点处漂移为零


class TestIncremental(unittest.TestCase):
    """增量重推必须与整体重推逐段一致。"""

    def setUp(self):
        self.state = load_sample()
        self.prev = eng.derive(self.state)

    def check(self, changed_segments=(), changed_anchors=(),
              changed_decisions=()):
        inc, affected = eng.apply_change(
            self.state, self.prev, changed_segments, changed_anchors,
            changed_decisions)
        full = eng.derive(self.state)
        self.assertEqual(inc["segments"], full["segments"])
        self.assertEqual(inc["trend"], full["trend"])
        self.assertEqual(inc["anchors"], full["anchors"])
        return inc, affected

    def test_anchor_update(self):
        self.state["anchors"].append(
            {"id": "a4", "segment_id": "s11", "media_time": 405.0})
        self.prev = eng.derive(self.state)
        a = next(x for x in self.state["anchors"] if x["id"] == "a2")
        a["media_time"] = 131.5
        inc, affected = self.check(changed_anchors=["a2"])
        self.assertLess(len(affected), len(self.state["segments"]))
        affected_ids = {self.state["segments"][i]["id"] for i in affected}
        self.assertIn("s6", affected_ids)
        self.assertNotIn("s12", affected_ids)  # 远端外推段不受 a2 影响

    def test_adjudicate_anchor_conflict(self):
        self.state["decisions"]["s6"] = {"choice": "interp"}
        inc, affected = self.check(changed_decisions=["s6"])
        self.assertEqual(affected, [5])  # 裁决只重推本段
        s = seg(inc, "s6")
        self.assertTrue(s["resolved"])
        self.assertNotEqual(s["status"], "conflict")
        # 双方依据仍保留在矛盾记录中
        self.assertTrue(any(c["type"] == "anchor_conflict"
                            for c in s["conflicts"]))

    def test_adjudicate_custom_offset(self):
        self.state["decisions"]["s8"] = {"choice": "custom", "offset": 2.5}
        inc, _ = self.check(changed_decisions=["s8"])
        self.assertAlmostEqual(seg(inc, "s8")["offset"], 2.5)

    def test_adjudicate_clear(self):
        self.state["decisions"]["s6"] = {"choice": "anchor"}
        r1, _ = eng.apply_change(self.state, self.prev, (), (), ["s6"])
        del self.state["decisions"]["s6"]
        inc, _ = eng.apply_change(self.state, r1, (), (), ["s6"])
        self.assertEqual(inc["segments"], eng.derive(self.state)["segments"])

    def test_segment_time_fix(self):
        s = next(x for x in self.state["segments"] if x["id"] == "s5")
        s["start"], s["end"] = 88.0, 92.0
        inc, _ = self.check(changed_segments=["s5"])
        self.assertNotEqual(seg(inc, "s5")["status"], "untrusted")

    def test_anchor_add_and_delete(self):
        self.state["anchors"].append(
            {"id": "a9", "segment_id": "s11", "media_time": 405.0})
        inc, affected = self.check(changed_anchors=["a9"])
        self.assertEqual(seg(inc, "s11")["confidence"], "high")
        self.prev = inc
        self.state["anchors"] = [x for x in self.state["anchors"]
                                 if x["id"] != "a9"]
        self.check(changed_anchors=["a9"])

    def test_repeated_random_changes(self):
        """连续多次变更后增量结果仍与全量一致。"""
        prev = self.prev
        for k, t in enumerate([11.0, 12.5, 9.0, 10.0]):
            a = next(x for x in self.state["anchors"] if x["id"] == "a1")
            a["media_time"] = t
            prev, _ = eng.apply_change(self.state, prev, [], ["a1"])
            self.assertEqual(prev["segments"],
                             eng.derive(self.state)["segments"],
                             "iteration %d" % k)


if __name__ == "__main__":
    unittest.main()
