# -*- coding: utf-8 -*-
import os
import tempfile
import unittest

import engine
from store import Store

RULES = {
    "level_scores": {"A": 95, "B": 85, "C": 75, "D": 60},
    "grade_bands": [{"grade": "优秀", "min": 85}, {"grade": "良好", "min": 70},
                    {"grade": "合格", "min": 60}, {"grade": "不合格", "min": 0}],
    "dimensions": {
        "basic": {"name": "基础功", "weight": 1, "pass_line": 60, "prereqs": []},
        "adv": {"name": "进阶", "weight": 2, "pass_line": 70, "prereqs": ["basic"]},
        "proj": {"name": "项目", "weight": 1, "pass_line": 60, "prereqs": []},
    },
}


def ev(dimension, value, evaluator="师甲", at="2026-09-01"):
    return {"student": "S1", "dimension": dimension, "value": value,
            "evaluator": evaluator, "recorded_at": at}


class EngineTest(unittest.TestCase):
    def test_missing_dimension_not_zero(self):
        r = engine.evaluate_student(
            {"basic": [{"value": 90}], "adv": [{"value": 80}]}, RULES)
        self.assertEqual(r["dims"]["proj"]["status"], "missing")
        # (90*1 + 80*2) / 3 = 83.33，缺测的 proj 不参与
        self.assertAlmostEqual(r["composite"]["score"], 250 / 3, places=4)
        self.assertTrue(any("缺测" in n for n in r["composite"]["notes"]))

    def test_conflict_kept_and_stable(self):
        r = engine.evaluate_student(
            {"basic": [{"value": "A", "evaluator": "甲"},
                       {"value": "C", "evaluator": "乙"}],
             "adv": [{"value": 90}], "proj": [{"value": 90}]}, RULES)
        d = r["dims"]["basic"]
        self.assertTrue(d["conflict"])
        self.assertEqual(len(d["entries"]), 2)  # 双方保留
        self.assertEqual(r["composite"]["low_grade"],
                         r["composite"]["high_grade"])
        self.assertTrue(r["composite"]["stable"])

    def test_conflict_unstable_reported(self):
        rules = dict(RULES)
        rules["grade_bands"] = [{"grade": "优", "min": 80}, {"grade": "良", "min": 0}]
        r = engine.evaluate_student(
            {"basic": [{"value": 100}, {"value": 60}],
             "adv": [{"value": 80}], "proj": [{"value": 80}]}, rules)
        self.assertFalse(r["composite"]["stable"])
        self.assertNotEqual(r["composite"]["low_grade"],
                            r["composite"]["high_grade"])

    def test_prereq_blocks_successor(self):
        r = engine.evaluate_student(
            {"basic": [{"value": 50}], "adv": [{"value": 95}],
             "proj": [{"value": 80}]}, RULES)
        self.assertFalse(r["dims"]["adv"]["participates"])
        self.assertIn("前置", r["dims"]["adv"]["exclude_note"])
        self.assertAlmostEqual(r["composite"]["score"], 65.0)  # (50+80)/2

    def test_prereq_missing_blocks_successor(self):
        r = engine.evaluate_student({"adv": [{"value": 95}]}, RULES)
        self.assertFalse(r["dims"]["adv"]["participates"])


class StoreTest(unittest.TestCase):
    def setUp(self):
        fd, self.path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.unlink(self.path)
        self.store = Store(self.path)
        self.store.set_rules(RULES)

    def tearDown(self):
        self.store.conn.close()
        os.unlink(self.path)

    def test_incremental_matches_full(self):
        self.store.add_evidence([ev("basic", 90), ev("adv", 80), ev("proj", 70),
                                 dict(ev("proj", 70), student="S2"),
                                 dict(ev("basic", "B"), student="S2")])
        ok, bad = self.store.verify_consistency()
        self.assertTrue(ok, bad)
        # 补录一条采证，只应影响该学员
        affected = self.store.add_evidence([ev("proj", 88, evaluator="师乙")])
        self.assertEqual(affected, ["S1"])
        ok, bad = self.store.verify_consistency()
        self.assertTrue(ok, bad)
        detail = self.store.student_detail("S1")
        self.assertTrue(detail["dims"]["proj"]["conflict"])

    def test_rule_change_incremental_matches_full(self):
        self.store.add_evidence([ev("basic", 55), ev("adv", 90),
                                 dict(ev("basic", 80), student="S2"),
                                 dict(ev("adv", 75), student="S2")])
        rules = self.store.get_rules()
        rules["dimensions"]["basic"]["pass_line"] = 50  # S1 的 adv 解锁
        affected = self.store.set_rules(rules)
        self.assertIn("S1", affected)
        ok, bad = self.store.verify_consistency()
        self.assertTrue(ok, bad)
        self.assertTrue(self.store.student_detail("S1")["dims"]["adv"]["participates"])

    def test_delete_evidence(self):
        self.store.add_evidence([ev("basic", 90)])
        detail = self.store.student_detail("S1")
        eid = detail["dims"]["basic"]["entries"][0]["evidence_id"]
        self.store.delete_evidence(eid)
        ok, _ = self.store.verify_consistency()
        self.assertTrue(ok)
        self.assertEqual(self.store.student_detail("S1")["dims"]["basic"]["status"],
                         "missing")


if __name__ == "__main__":
    unittest.main()
