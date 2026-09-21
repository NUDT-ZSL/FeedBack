# -*- coding: utf-8 -*-
"""引擎行为测试：推断理由、修订同步、冲突保留、确认稳定性、合并/废弃传播。"""
import unittest

import engine


def make_state():
    entries = [
        engine.new_entry("A", "缓存方案", "缓存穿透用空值缓存和布隆过滤器，Redis 加互斥锁",
                         ["缓存", "后端"]),
        engine.new_entry("B", "缓存一致性", "缓存与数据库一致性用延迟双删，Redis 缓存失效加抖动",
                         ["缓存", "一致性"]),
        engine.new_entry("C", "发布流程", "发布先灰度后全量，异常时一键回滚",
                         ["发布", "运维"]),
    ]
    return {"entries": entries, "events": []}


class InferTest(unittest.TestCase):
    def test_infer_with_readable_reason(self):
        s = make_state()
        engine.bootstrap(s)
        a = engine.find_entry(s, "A")
        lk = engine.find_link(a, "B")
        self.assertIsNotNone(lk, "A、B 标签与正文均重合，应推断出关联")
        self.assertEqual(lk["origin"], "inferred")
        self.assertIn("共同标签", lk["reason"])
        self.assertIn("缓存", lk["reason"])

    def test_no_infer_without_overlap(self):
        s = make_state()
        engine.bootstrap(s)
        a = engine.find_entry(s, "A")
        self.assertIsNone(engine.find_link(a, "C"), "A、C 无重合，不应推断关联")


class ReviseSyncTest(unittest.TestCase):
    def test_inferred_link_invalidated_when_basis_gone(self):
        s = make_state()
        engine.bootstrap(s)
        engine.revise_entry(s, "B", body="发布先灰度后全量，异常时一键回滚",
                            tags=["发布"], note="彻底改写")
        a = engine.find_entry(s, "A")
        lk = engine.find_link(a, "B")
        self.assertEqual(lk["state"], "invalidated")
        self.assertIn("已失效", lk["reason"])

    def test_confirmed_stable_on_minor_change(self):
        s = make_state()
        engine.bootstrap(s)
        engine.decide_link(s, "A", "B", "confirmed")
        engine.revise_entry(s, "B",
                            body="缓存与数据库一致性用延迟双删，Redis 缓存失效加随机抖动防止雪崩",
                            note="小幅补充")
        lk = engine.find_link(engine.find_entry(s, "A"), "B")
        self.assertEqual(lk["decision"], "confirmed")
        self.assertEqual(lk["state"], "active", "小幅修订不应动摇已确认关联")

    def test_confirmed_needs_reconfirm_on_substantive_change(self):
        s = make_state()
        engine.bootstrap(s)
        engine.decide_link(s, "A", "B", "confirmed")
        engine.revise_entry(s, "B", body="评审关注边界条件、单测覆盖率与日志上下文",
                            tags=["流程", "质量"], note="彻底改写")
        lk = engine.find_link(engine.find_entry(s, "A"), "B")
        self.assertEqual(lk["state"], "needs_reconfirm")

    def test_rejected_inference_not_resurrected(self):
        s = make_state()
        engine.bootstrap(s)
        engine.decide_link(s, "A", "B", "rejected")
        engine.revise_entry(s, "B", note="无实质改动")
        a = engine.find_entry(s, "A")
        lk = engine.find_link(a, "B")
        self.assertEqual(lk["decision"], "rejected")
        self.assertEqual(lk["state"], "invalidated")


class ConflictTest(unittest.TestCase):
    def test_mutual_supersede_kept_and_flagged(self):
        s = make_state()
        a, b = engine.find_entry(s, "A"), engine.find_entry(s, "B")
        a["links"].append(engine.normalize_link(
            {"target": "B", "relation": "supersedes", "reason": "A 取代 B"}))
        b["links"].append(engine.normalize_link(
            {"target": "A", "relation": "supersedes", "reason": "B 取代 A"}))
        engine.detect_conflicts(s)
        lk_ab = engine.find_link(a, "B")
        lk_ba = engine.find_link(b, "A")
        self.assertEqual(lk_ab["state"], "conflict")
        self.assertEqual(lk_ba["state"], "conflict")
        self.assertEqual(len(a["links"]) + len(b["links"]),
                         2 + len([l for l in a["links"] if l["target"] == "B"
                                  and l["origin"] == "inferred"]),
                         "冲突双方都必须保留，不能静默丢弃")

    def test_conflict_cleared_when_relation_fixed(self):
        s = make_state()
        a, b = engine.find_entry(s, "A"), engine.find_entry(s, "B")
        a["links"].append(engine.normalize_link({"target": "B", "relation": "supersedes"}))
        b["links"].append(engine.normalize_link({"target": "A", "relation": "supersedes"}))
        engine.detect_conflicts(s)
        engine.find_link(b, "A")["relation"] = "related"
        engine.detect_conflicts(s)
        self.assertEqual(engine.find_link(a, "B")["state"], "active")


class MergeDeprecateTest(unittest.TestCase):
    def test_deprecate_propagates_to_inbound(self):
        s = make_state()
        engine.bootstrap(s)
        engine.deprecate_entry(s, "B")
        lk = engine.find_link(engine.find_entry(s, "A"), "B")
        self.assertEqual(lk["state"], "needs_reconfirm")
        self.assertIn("废弃", lk["reason"])

    def test_merge_marks_links_and_redirect_info(self):
        s = make_state()
        engine.bootstrap(s)
        engine.merge_entries(s, "B", "A")
        b = engine.find_entry(s, "B")
        self.assertEqual(b["status"], "merged")
        self.assertEqual(b["merged_into"], "A")
        lk = engine.find_link(engine.find_entry(s, "A"), "B")
        self.assertEqual(lk["state"], "needs_reconfirm")
        self.assertIn("合并", lk["reason"])

    def test_revision_history_appended(self):
        s = make_state()
        engine.revise_entry(s, "A", body="缓存穿透用空值缓存", note="精简")
        a = engine.find_entry(s, "A")
        self.assertEqual(len(a["revisions"]), 2)
        self.assertEqual(a["revisions"][1]["note"], "精简")


if __name__ == "__main__":
    unittest.main(verbosity=2)
