"""End-to-end tests of the six product requirements against TriageStore."""
import unittest

from triage import TriageStore, compute_priority, final_priority


def items_of(store, demand):
    return [store.items[i] for i in demand["items"]]


def make_store():
    s = TriageStore()
    s.import_feedback([
        {"source": "工单", "feature": "数据导出",
         "text": "导出报表时系统崩溃，数据丢失，无法使用"},
        {"source": "社区", "feature": "数据导出",
         "text": "导出报表直接闪退报错，希望尽快修复导出功能"},
    ])
    return s


class Req1ImportTest(unittest.TestCase):
    def test_import_creates_pending_demand(self):
        s = make_store()
        board = s.board()
        self.assertTrue(board["demands"])
        d = board["demands"][0]
        self.assertEqual(d["status"], "pending")
        it = d["items"][0]
        for field in ("source", "text", "feature", "reported_at"):
            self.assertIn(field, it)


class Req2MergeTest(unittest.TestCase):
    def test_similar_feedback_merges_with_rationale(self):
        s = make_store()
        self.assertEqual(len(s.demands), 1)  # 两条相似反馈归并为一条诉求
        d = next(iter(s.demands.values()))
        self.assertEqual(len(d["items"]), 2)
        r = d["merge_rationales"][0]
        self.assertGreater(r["similarity"], 0.3)
        self.assertTrue(r["shared_terms"])  # 归并依据可查看
        self.assertIsNone(r["confirmed"])   # 待运营确认

    def test_merge_confirm_and_reject(self):
        s = make_store()
        d = next(iter(s.demands.values()))
        item_id = d["items"][1]
        s.confirm_merge(d["id"], item_id, True, "op")
        self.assertTrue(d["merge_rationales"][0]["confirmed"])
        # 再导入一条相似反馈然后拒绝 -> 拆分为新诉求
        s.import_feedback([{"source": "客服记录", "feature": "数据导出",
                            "text": "客户反馈导出报表失败，报错提示文件生成异常"}])
        self.assertEqual(len(s.demands), 1)
        new_item = d["items"][-1]
        s.confirm_merge(d["id"], new_item, False, "op")
        self.assertEqual(len(s.demands), 2)


class Req3ContradictionTest(unittest.TestCase):
    def test_contradiction_keeps_both_sides(self):
        s = TriageStore()
        s.import_feedback([
            {"source": "社区", "feature": "深色模式",
             "text": "希望保留深色模式自动切换，很好用"},
            {"source": "工单", "feature": "深色模式",
             "text": "建议去掉深色模式自动切换，很难用"},
        ])
        d = next(iter(s.demands.values()))
        self.assertEqual(len(d["items"]), 2)  # 双方都保留
        self.assertEqual(len(d["contradictions"]), 1)
        c = d["contradictions"][0]
        self.assertEqual(c["status"], "pending")  # 标记待裁定
        self.assertTrue(c["text_a"] and c["text_b"])
        s.resolve_contradiction(d["id"], c["id"], "灰度验证后决定", "op")
        self.assertEqual(len(d["items"]), 2)  # 裁定后仍不丢弃任何一方


class Req4AdjudicateTest(unittest.TestCase):
    def test_adjudication_recomputes_final_priority(self):
        s = make_store()
        d = next(iter(s.demands.values()))
        before = final_priority(d, items_of(s, d))
        s.adjudicate(d["id"], "立即修复", "P0", "影响核心流程", "op")
        self.assertEqual(final_priority(d, items_of(s, d)), "P0")
        board = s.board()
        self.assertEqual(board["demands"][0]["final_priority"], "P0")
        self.assertNotEqual(before == "P0" and d["status"] == "pending", True)


class Req5ReconfirmTest(unittest.TestCase):
    def test_new_feedback_invalidates_old_adjudication(self):
        s = make_store()
        d = next(iter(s.demands.values()))
        s.adjudicate(d["id"], "排期优化", "P2", "下迭代处理", "op")
        self.assertEqual(d["status"], "adjudicated")
        s.import_feedback([{"source": "客服记录", "feature": "数据导出",
                            "text": "客户反馈导出报表失败，报错提示文件生成异常"}])
        self.assertEqual(d["status"], "needs_reconfirm")
        self.assertIsNone(d["adjudication"])            # 不沿用旧结论
        self.assertEqual(len(d["adjudication_history"]), 1)  # 旧结论留痕
        # 重新确认后恢复已裁定状态
        s.adjudicate(d["id"], "立即修复", "P0", "升级处理", "op")
        self.assertEqual(d["status"], "adjudicated")
        self.assertEqual(final_priority(d, items_of(s, d)), "P0")


class Req6BoardViewTest(unittest.TestCase):
    def test_board_exposes_everything_ui_needs(self):
        s = make_store()
        d = next(iter(s.demands.values()))
        s.adjudicate(d["id"], "立即修复", "P0", "核心流程", "op")
        board = s.board()
        d0 = board["demands"][0]
        for field in ("merge_rationales", "contradictions", "final_priority",
                      "computed", "adjudication"):
            self.assertIn(field, d0)
        self.assertTrue(board["audit_log"])  # 裁定记录
        actions = {e["action"] for e in board["audit_log"]}
        self.assertIn("裁定诉求", actions)

    def test_priority_scoring_reflects_impact_and_urgency(self):
        s = TriageStore()
        s.import_feedback([{"source": "社区", "feature": "界面",
                            "text": "建议优化一下图标颜色"}])
        calm = next(iter(s.demands.values()))
        s2 = make_store()
        hot = next(iter(s2.demands.values()))
        self.assertGreater(compute_priority(items_of(s2, hot))["score"],
                           compute_priority(items_of(s, calm))["score"])


if __name__ == "__main__":
    unittest.main()
