# -*- coding: utf-8 -*-
"""引擎行为测试：冲突保留、修正留痕、裁决、异常链路、增量与全量一致。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import engine  # noqa: E402


def base_state():
    s = engine.new_state()
    b1 = engine.add_batch(s, "A", 1000, "src", "回收")
    b2 = engine.add_batch(s, "B", 0, "A转入", "再利用")
    engine.add_record(s, b1, "t1", 600, "回收")
    engine.add_record(s, b1, "t2", 300, "转出", dest_batch=b2)
    return s, b1, b2


class TestEngine(unittest.TestCase):
    def test_propagation_and_closure(self):
        s, b1, b2 = base_state()
        engine.add_record(s, b2, "t3", 250, "再利用")
        out = engine.compute(s)
        self.assertEqual(out["results"][b2]["incoming"], 300)
        self.assertEqual(out["results"][b2]["available"], 300)
        self.assertEqual(out["results"][b2]["unallocated"], 50)
        c = engine.closure_summary(s, out["results"])
        self.assertEqual(c["回收"], 600)
        self.assertEqual(c["再利用"], 250)
        # 差额 = A未分配100 + B未分配50（转出为内部流转，不重复计）
        self.assertEqual(c["未闭合差额"], 150)

    def test_conflict_kept_and_flagged(self):
        s, b1, b2 = base_state()
        engine.add_record(s, b2, "t9", 20, "损耗")
        engine.add_record(s, b2, "t9", 35, "再利用")
        conflicts = engine.detect_conflicts(s)
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(len(conflicts[0]["record_ids"]), 2)
        # 两条都保留且均为有效
        self.assertEqual(len(engine.active_records(s)), 4)

    def test_resolve_conflict_marks_rejected_keeps_history(self):
        s, b1, b2 = base_state()
        r1 = engine.add_record(s, b2, "t9", 20, "损耗")
        r2 = engine.add_record(s, b2, "t9", 35, "再利用")
        engine.resolve_conflict(s, r1, "以仓管为准")
        self.assertEqual(s["records"][r2]["status"], "rejected")
        self.assertEqual(s["records"][r1]["status"], "active")
        self.assertEqual(engine.detect_conflicts(s), [])
        self.assertEqual(len(s["records"]), 4)  # 全部保留

    def test_correction_keeps_original(self):
        s, b1, b2 = base_state()
        r = engine.add_record(s, b1, "t5", 50, "损耗")
        rid, affected = engine.correct_record(s, r, 45, "损耗", note="复核")
        self.assertEqual(s["records"][r]["status"], "superseded")
        self.assertEqual(s["records"][r]["superseded_by"], rid)
        self.assertEqual(s["records"][rid]["correction_of"], r)
        self.assertIn(b1, affected)

    def test_missing_predecessor_flagged(self):
        s, b1, b2 = base_state()
        engine.add_record(s, b2, "t4", 10, "转出", dest_batch="B9999")
        out = engine.compute(s)
        types = [a["type"] for a in out["anomalies"]]
        self.assertIn("前置批次缺失", types)

    def test_cycle_flagged_and_not_propagated(self):
        s = engine.new_state()
        x = engine.add_batch(s, "X", 100, "s", "d")
        y = engine.add_batch(s, "Y", 0, "s", "d")
        engine.add_record(s, x, "t1", 40, "转出", dest_batch=y)
        engine.add_record(s, y, "t2", 30, "转出", dest_batch=x)
        out = engine.compute(s)
        self.assertTrue(out["cycles"])
        types = [a["type"] for a in out["anomalies"]]
        self.assertIn("循环引用", types)
        # 环内边不传播
        self.assertEqual(out["results"][y]["incoming"], 0)
        self.assertEqual(out["results"][x]["incoming"], 0)

    def test_incremental_matches_full(self):
        s, b1, b2 = base_state()
        b3 = engine.add_batch(s, "C", 0, "B转入", "待定")
        engine.add_record(s, b2, "t3", 100, "转出", dest_batch=b3)
        full1 = engine.compute(s)["results"]
        # 修正 b1 的转出数量 -> 只重推受影响链路
        r = [x for x in engine.active_records(s)
             if x["batch_id"] == b1 and x["dest_type"] == "转出"][0]
        _, affected = engine.correct_record(s, r["id"], 350, "转出",
                                            dest_batch=b2)
        incr = engine.compute(s, only_batches=affected,
                              prev_results=full1)["results"]
        ok, diffs = engine.verify_incremental(s, incr)
        self.assertTrue(ok, "增量与全量不一致: %s" % diffs)
        self.assertEqual(incr[b2]["incoming"], 350)
        self.assertEqual(incr[b3]["incoming"], 100)

    def test_over_allocation_flagged(self):
        s, b1, b2 = base_state()
        engine.add_record(s, b1, "t6", 500, "损耗")
        out = engine.compute(s)
        types = [a["type"] for a in out["anomalies"]]
        self.assertIn("超量转出", types)

    def test_correct_rejects_bad_dest_type(self):
        s, b1, b2 = base_state()
        r = engine.add_record(s, b1, "t5", 50, "损耗")
        with self.assertRaises(ValueError):
            engine.correct_record(s, r, 50, "??")


if __name__ == "__main__":
    unittest.main()
