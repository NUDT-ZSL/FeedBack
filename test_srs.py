"""核心调度逻辑单元测试：python test_srs.py"""
import unittest
from datetime import date, timedelta

import srs

TODAY = date(2026, 9, 24)


def item(**kw):
    it = srs.make_item(kw.pop("title", "t"), **kw)
    return it


class TestRetention(unittest.TestCase):
    def test_retention_decays(self):
        it = item(last_review="2026-09-14", interval_days=10)
        r0 = srs.retention(it, TODAY)
        self.assertAlmostEqual(r0, 0.85, places=2)  # 到期间隔时保持率=阈值
        it2 = item(last_review="2026-09-04", interval_days=10)
        self.assertLess(srs.retention(it2, TODAY), r0)  # 越久没复习保持率越低

    def test_queue_order_by_importance_and_forgetting(self):
        a = item(title="a", importance=5, last_review="2026-09-10", interval_days=5)
        b = item(title="b", importance=1, last_review="2026-09-10", interval_days=5)
        c = item(title="c", importance=3, last_review="2026-09-23", interval_days=10)
        q = srs.today_queue([c, b, a], TODAY)
        self.assertEqual([x["title"] for x in q], ["a", "b"])  # c 未到期；a 更重要排前


class TestReview(unittest.TestCase):
    def test_correct_updates_and_explains(self):
        it = item(mastery=0.5, interval_days=4, last_review="2026-09-20")
        _, reasons = srs.apply_review(it, True, TODAY)
        self.assertGreater(it["mastery"], 0.5)
        self.assertGreater(it["interval_days"], 4)
        self.assertEqual(it["last_review"], "2026-09-24")
        self.assertTrue(any("掌握度" in r for r in reasons))
        self.assertTrue(any("下次复习" in r for r in reasons))

    def test_wrong_shrinks(self):
        it = item(mastery=0.6, interval_days=8, last_review="2026-09-20")
        srs.apply_review(it, False, TODAY)
        self.assertLess(it["mastery"], 0.6)
        self.assertLess(it["interval_days"], 8)

    def test_streak_accelerates(self):
        it = item(mastery=0.5, interval_days=2, last_review="2026-09-22")
        growth = []
        for _ in range(4):
            old = it["interval_days"]
            srs.apply_review(it, True, TODAY)
            growth.append(it["interval_days"] / old)
        self.assertLess(growth[0], growth[-1])  # 连对越多增长系数越大
        self.assertEqual(it["streak"], 4)

    def test_wrong_streak_decelerates(self):
        it = item(mastery=0.5, interval_days=20, last_review="2026-09-20")
        shrink = []
        for _ in range(3):
            old = it["interval_days"]
            srs.apply_review(it, False, TODAY)
            shrink.append(it["interval_days"] / old)
        self.assertGreater(shrink[0], shrink[-1])  # 连错越多压缩越狠
        self.assertEqual(it["streak"], -3)


class TestManualEdit(unittest.TestCase):
    def test_edit_only_affects_target(self):
        a = item(title="a", mastery=0.4, interval_days=4, last_review="2026-09-20")
        b = item(title="b", mastery=0.7, interval_days=7, last_review="2026-09-20")
        before = dict(b)
        _, reasons = srs.apply_manual_edit(a, {"mastery": 0.9})
        self.assertEqual(b, before)  # 其他条目完全不变
        self.assertEqual(a["mastery"], 0.9)
        self.assertGreater(a["interval_days"], 4)  # 掌握度升高，间隔重估变长
        self.assertTrue(reasons)

    def test_edit_last_review_recomputes_due(self):
        it = item(interval_days=5, last_review="2026-09-23")
        srs.apply_manual_edit(it, {"last_review": "2026-09-01"})
        self.assertLess(srs.days_until_due(it, TODAY), 0)  # 变为逾期

    def test_bad_date_rejected(self):
        it = item()
        with self.assertRaises(ValueError):
            srs.apply_manual_edit(it, {"last_review": "not-a-date"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
