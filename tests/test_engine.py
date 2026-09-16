"""多来源冲突与引擎增量重算测试。"""
import copy
import unittest

from settlement import (
    CouponSpec,
    CouponStatus,
    OrderLine,
    SettlementEngine,
)
from settlement.models import spec_signature


def base_engine():
    eng = SettlementEngine()
    eng.register_category("food")
    eng.register_category("book")
    eng.set_order(
        [
            OrderLine("L1", "food", 6000, 1, 6000),
            OrderLine("L2", "book", 4000, 1, 4000),
        ]
    )
    return eng


class ConflictTests(unittest.TestCase):
    def test_contradictory_issues_both_kept_and_frozen(self):
        eng = base_engine()
        s_marketing = CouponSpec.from_cents("C1", 5000, 2000, ["food"])
        s_partner = CouponSpec.from_cents("C1", 3000, 1500, ["food"])
        eng.issue_coupon(s_marketing, source="marketing", version=1)
        conflict = eng.issue_coupon(s_partner, source="partner", version=1)

        self.assertIsNotNone(conflict)
        coupon = eng.coupons()[0]
        self.assertEqual(coupon.status, CouponStatus.CONFLICTED)
        sources = {i.source for i in coupon.issues}
        self.assertEqual(sources, {"marketing", "partner"})
        self.assertFalse(coupon.active())

        # 冻结券不参与求解。
        res = eng.solve()
        self.assertNotIn("C1", res.selected_ids())
        self.assertIn("C1", res.frozen_coupon_ids)

        # 冲突记录可读，包含券、双方来源与各自参数。
        text = conflict.render()
        for token in ("C1", "marketing", "partner", "50.00", "20.00", "30.00", "15.00"):
            self.assertIn(token, text)

    def test_consistent_multi_source_is_not_conflict(self):
        eng = base_engine()
        a = CouponSpec.from_cents("C1", 5000, 2000, ["food"])
        b = CouponSpec.from_cents("C1", 5000, 2000, ["food"])
        eng.issue_coupon(a, "marketing", 1)
        conflict = eng.issue_coupon(b, "partner", 1)
        self.assertIsNone(conflict)
        self.assertEqual(eng.coupons()[0].status, CouponStatus.SINGLE)
        self.assertIn("C1", eng.solve().selected_ids())

    def test_resolve_conflict_keeps_both_records(self):
        eng = base_engine()
        eng.issue_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]), "marketing", 1)
        eng.issue_coupon(CouponSpec.from_cents("C1", 3000, 1500, ["food"]), "partner", 1)
        eng.resolve_conflict("C1", "marketing")
        coupon = eng.coupons()[0]
        self.assertEqual(coupon.status, CouponStatus.RESOLVED)
        self.assertEqual(len(coupon.issues), 2)  # 双方仍保留
        self.assertEqual(coupon.spec.threshold_cents, 5000)
        self.assertIn("C1", eng.solve().selected_ids())
        with self.assertRaises(Exception):
            eng.resolve_conflict("C1", "nobody")

    def test_same_source_version_rules(self):
        eng = base_engine()
        spec = CouponSpec.from_cents("C1", 5000, 2000, ["food"])
        eng.issue_coupon(spec, "marketing", 2)
        # 更旧版次拒绝。
        with self.assertRaises(Exception):
            eng.issue_coupon(spec, "marketing", 1)
        # 同版次不同参数拒绝。
        with self.assertRaises(Exception):
            eng.issue_coupon(CouponSpec.from_cents("C1", 5000, 9000, ["food"]), "marketing", 2)
        # 幂等重放。
        self.assertIsNone(eng.issue_coupon(spec, "marketing", 2))

    def test_failed_issue_leaves_state_unchanged(self):
        eng = base_engine()
        eng.issue_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]), "marketing", 1)
        before = copy.deepcopy(eng._state_for_snapshot())
        with self.assertRaises(Exception):
            eng.issue_coupon(CouponSpec.from_cents("C1", 5000, 9000, ["food"]), "marketing", 1)
        self.assertEqual(before, eng._state_for_snapshot())


class IncrementalTests(unittest.TestCase):
    def _engine_with_independent_components(self):
        eng = SettlementEngine()
        eng.register_category("food")
        eng.register_category("book")
        eng.register_category("toy")
        eng.set_order(
            [
                OrderLine("L1", "food", 6000, 1, 6000),
                OrderLine("L2", "book", 4000, 1, 4000),
                OrderLine("L3", "toy", 3000, 1, 3000),
            ]
        )
        return eng

    def test_add_only_recomputes_affected_component(self):
        eng = self._engine_with_independent_components()
        eng.add_coupon(CouponSpec.from_cents("CF", 5000, 2000, ["food"]))
        eng.add_coupon(CouponSpec.from_cents("CB", 3000, 1000, ["book"]))
        res_before = eng.solve()
        app_food_before = res_before.application_for("CF")
        app_book_before = res_before.application_for("CB")

        # 新增一张只作用于 toy 的券：前两张券属于另外的连通分量，不应重算。
        report = eng.add_coupon(CouponSpec.from_cents("CT", 1000, 500, ["toy"]))
        res_after = eng.solve()

        self.assertEqual(report.reused_components, ("CB", "CF"))
        self.assertEqual(report.recomputed_components, ("CT",))
        # 对象身份一致：未受影响的抵扣原样复用。
        self.assertIs(res_after.application_for("CF"), app_food_before)
        self.assertIs(res_after.application_for("CB"), app_book_before)
        # 增量结果与从头求解逐字段一致。
        scratch = eng.solve_from_scratch()
        self.assertEqual(scratch.fingerprint, res_after.fingerprint)
        self.assertEqual(
            [(a.coupon_id, [(x.line_id, x.amount_cents) for x in a.allocations]) for a in res_after.applications],
            [(a.coupon_id, [(x.line_id, x.amount_cents) for x in a.allocations]) for a in scratch.applications],
        )

    def test_revoke_recomputes_only_affected_component(self):
        eng = self._engine_with_independent_components()
        eng.add_coupon(CouponSpec.from_cents("CF", 5000, 2000, ["food"]))
        eng.add_coupon(CouponSpec.from_cents("CB", 3000, 1000, ["book"]))
        eng.add_coupon(CouponSpec.from_cents("CT", 1000, 500, ["toy"]))
        app_book = eng.last_result.application_for("CB")

        report = eng.revoke_coupon("CT")
        self.assertEqual(report.reused_components, ("CB", "CF"))
        self.assertIn("CT", report.retired_components)
        self.assertIs(eng.last_result.application_for("CB"), app_book)
        self.assertEqual(eng.last_result.total_discount_cents, 3000)
        self.assertEqual(eng.solve_from_scratch().fingerprint, eng.last_result.fingerprint)

    def test_exclusive_group_change_propagates(self):
        # 两张券同一互斥组、竞争同一行：撤销一张后另一张应接管该行。
        eng = SettlementEngine()
        eng.register_category("food")
        eng.set_order([OrderLine("L1", "food", 10000, 1, 10000)])
        eng.add_coupon(CouponSpec.from_cents("C1", 1000, 6000, ["food"], exclusive_group="G1"))
        eng.add_coupon(CouponSpec.from_cents("C2", 1000, 5000, ["food"], exclusive_group="G1"))
        self.assertEqual(eng.last_result.selected_ids(), ("C1",))
        eng.revoke_coupon("C1")
        self.assertEqual(eng.last_result.selected_ids(), ("C2",))
        self.assertEqual(eng.last_result.total_discount_cents, 5000)

    def test_repeatability(self):
        eng = base_engine()
        eng.add_coupon(CouponSpec.from_cents("C1", 5000, 2000, ["food"]))
        eng.add_coupon(CouponSpec.from_cents("C2", 3000, 1500, ["book"]))
        r1 = eng.solve()
        r2 = eng.solve()
        self.assertEqual(r1.fingerprint, r2.fingerprint)
        self.assertEqual(
            [(a.coupon_id, a.total_discount_cents) for a in r1.applications],
            [(a.coupon_id, a.total_discount_cents) for a in r2.applications],
        )


if __name__ == "__main__":
    unittest.main()
