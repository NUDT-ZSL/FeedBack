"""解释引擎测试：解释必须覆盖每张券、与求解结果一致、可复现。"""
import unittest

from settlement import CouponSpec, OrderLine, SettlementEngine, explain
from settlement.explain import DOMINATED, FROZEN_CONFLICT, THRESHOLD_NOT_MET, TIE_LEXICOGRAPHIC


def build_engine():
    eng = SettlementEngine()
    eng.register_category("food")
    eng.register_category("book")
    eng.set_order(
        [
            OrderLine("L1", "food", 6000, 1, 6000),
            OrderLine("L2", "food", 5000, 1, 5000),
            OrderLine("L3", "book", 4000, 1, 4000),
        ]
    )
    return eng


class ExplainTests(unittest.TestCase):
    def test_selected_explanation_lists_hits_and_amounts(self):
        eng = build_engine()
        eng.add_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]))
        res = eng.solve()
        exp = explain(eng, res)
        sx = exp.selected[0]
        self.assertEqual(sx.coupon_id, "C1")
        # 命中行与抵扣之和必须等于求解结果。
        hit_total = sum(h.discount_cents for h in sx.hit_lines)
        self.assertEqual(hit_total, res.application_for("C1").total_discount_cents)
        hit_lines = {h.line_id for h in sx.hit_lines}
        self.assertTrue(hit_lines <= {"L1", "L2"})
        text = exp.render()
        self.assertIn("C1", text)
        self.assertIn("命中商品行", text)
        self.assertIn(res.fingerprint, text)

    def test_threshold_rejection_explained(self):
        eng = build_engine()
        # food 行合计 11000；门槛 999999 永远不够。
        eng.add_coupon(CouponSpec.from_cents("C1", 99999900, 2000, ["food"]))
        res = eng.solve()
        self.assertEqual(res.applications, ())
        exp = explain(eng, res)
        self.assertEqual(exp.rejected[0].reason_code, THRESHOLD_NOT_MET)
        self.assertIn("低于门槛", exp.rejected[0].reason)

    def test_dominated_rejection_with_counterfactual_loss(self):
        # 两张券竞争同一行、同互斥组；强券中选，弱券应给出反事实差额。
        eng = SettlementEngine()
        eng.register_category("food")
        eng.set_order([OrderLine("L1", "food", 10000, 1, 10000)])
        eng.add_coupon(CouponSpec.from_cents("STRONG", 1000, 6000, ["food"], exclusive_group="G1"))
        eng.add_coupon(CouponSpec.from_cents("WEAK", 1000, 5000, ["food"], exclusive_group="G1"))
        res = eng.solve()
        self.assertEqual(res.selected_ids(), ("STRONG",))
        weak = next(r for r in res.rejected if r.coupon_id == "WEAK")
        self.assertEqual(weak.reason_code, DOMINATED)
        self.assertEqual(weak.detail["loss_cents"], 1000)
        self.assertIn("STRONG", weak.reason)

    def test_tie_rejection_mentions_lexicographic(self):
        eng = SettlementEngine()
        eng.register_category("food")
        eng.set_order([OrderLine("L1", "food", 10000, 1, 10000)])
        eng.add_coupon(CouponSpec.from_cents("CB", 1000, 5000, ["food"], exclusive_group="G1"))
        eng.add_coupon(CouponSpec.from_cents("CA", 1000, 5000, ["food"], exclusive_group="G1"))
        res = eng.solve()
        self.assertEqual(res.selected_ids(), ("CA",))
        rej = next(r for r in res.rejected if r.coupon_id == "CB")
        self.assertEqual(rej.reason_code, TIE_LEXICOGRAPHIC)
        self.assertIn("字典序", rej.reason)

    def test_frozen_coupon_explained(self):
        eng = build_engine()
        eng.issue_coupon(CouponSpec.from_cents("C9", 5000, 2000, ["food"]), "marketing", 1)
        eng.issue_coupon(CouponSpec.from_cents("C9", 3000, 1500, ["food"]), "partner", 1)
        res = eng.solve()
        rej = next(r for r in res.rejected if r.coupon_id == "C9")
        self.assertEqual(rej.reason_code, FROZEN_CONFLICT)
        self.assertIn("marketing", rej.reason)
        self.assertIn("partner", rej.reason)

    def test_explanation_covers_every_coupon_exactly_once(self):
        eng = build_engine()
        eng.add_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]))
        eng.add_coupon(CouponSpec.from_cents("C2", 99999900, 2000, ["book"]))  # 门槛不足
        eng.issue_coupon(CouponSpec.from_cents("C3", 1000, 500, ["food"]), "a", 1)
        eng.issue_coupon(CouponSpec.from_cents("C3", 1000, 900, ["food"]), "b", 1)  # 冲突冻结
        res = eng.solve()
        exp = explain(eng, res)
        mentioned = {s.coupon_id for s in exp.selected} | {r.coupon_id for r in exp.rejected}
        self.assertEqual(mentioned, {"C1", "C2", "C3"})
        self.assertEqual(len(exp.rejected), 2)


if __name__ == "__main__":
    unittest.main()
