"""求解器正确性测试：随机实例上与独立的暴力枚举实现逐例对照。"""
import itertools
import random
import unittest

from settlement import CouponSpec, OrderLine, SettlementEngine, solve
from settlement.models import eligible_lines_for


def brute_force(specs, lines):
    """与求解器语义相同的朴素枚举：枚举券子集 × 每行归属，全枚举取最优。"""
    by_id = {s.coupon_id: s for s in specs}
    ids = sorted(by_id)
    totals = {ln.line_id: ln.line_total_cents for ln in lines}
    elig = {
        cid: {ln.line_id for ln in eligible_lines_for(by_id[cid], lines)}
        for cid in ids
    }
    best = None  # (总额, 中选标识元组)

    for r in range(len(ids) + 1):
        for subset in itertools.combinations(ids, r):
            subset_set = set(subset)
            # 互斥组约束。
            groups_used = [by_id[c].exclusive_group for c in subset if by_id[c].exclusive_group]
            if len(groups_used) != len(set(groups_used)):
                continue
            choices = {}
            for lid in sorted(totals):
                choices[lid] = [None] + [cid for cid in subset if lid in elig[cid]]
            for combo in itertools.product(*(choices[lid] for lid in sorted(totals))):
                owned = {cid: [] for cid in subset}
                for lid, owner in zip(sorted(totals), combo):
                    if owner is not None:
                        owned[owner].append(lid)
                value = 0
                ok = True
                for cid in subset:
                    held = owned[cid]
                    held_total = sum(totals[x] for x in held)
                    if not held or held_total < by_id[cid].threshold_cents:
                        ok = False
                        break
                    value += min(by_id[cid].discount_cents, held_total)
                if not ok:
                    continue
                key = tuple(subset)
                if best is None or value > best[0] or (value == best[0] and key < best[1]):
                    best = (value, key)
    return best


def random_case(rng):
    categories = ["catA", "catB", "catC"][: rng.randint(1, 3)]
    lines = []
    for i in range(rng.randint(1, 5)):
        unit = rng.randint(5, 40) * 100
        qty = rng.randint(1, 3)
        lines.append(
            OrderLine(
                line_id=f"L{i}",
                category_id=rng.choice(categories),
                unit_price_cents=unit,
                quantity=qty,
                line_total_cents=unit * qty,
            )
        )
    specs = []
    for i in range(rng.randint(1, 4)):
        cats = rng.choice([None, sorted(rng.sample(categories, rng.randint(1, len(categories))))])
        specs.append(
            CouponSpec.from_cents(
                coupon_id=f"C{i}",
                threshold_cents=rng.randint(1, 120) * 100,
                discount_cents=rng.randint(1, 90) * 100,
                applicable_categories=cats,
                exclusive_group=rng.choice([None, None, None, "G1", "G2"]),
                priority=rng.randint(1, 9),
            )
        )
    return specs, lines


class BruteForceComparisonTests(unittest.TestCase):
    def test_many_random_cases(self):
        rng = random.Random(20260916)
        checked = 0
        for seed in range(180):
            specs, lines = random_case(rng)
            output = solve(specs, lines)
            expected = brute_force(specs, lines)
            got_value = output.total_discount_cents
            got_set = tuple(sorted(a.coupon_id for a in output.applications))
            self.assertEqual(
                (got_value, got_set),
                expected,
                msg=f"seed={seed} specs={specs} lines={lines}",
            )
            # 逐方案可行性复核。
            covered = set()
            for app in output.applications:
                spec = next(s for s in specs if s.coupon_id == app.coupon_id)
                alloc_lines = [a.line_id for a in app.allocations]
                self.assertEqual(len(alloc_lines), len(set(alloc_lines)))
                self.assertTrue(set(alloc_lines).isdisjoint(covered), "商品行被重复抵扣")
                covered.update(alloc_lines)
                totals = {ln.line_id: ln.line_total_cents for ln in lines}
                held_total = sum(totals[lid] for lid in alloc_lines)
                self.assertGreaterEqual(held_total, spec.threshold_cents)
                self.assertEqual(app.total_discount_cents, sum(a.amount_cents for a in app.allocations))
                self.assertEqual(app.total_discount_cents, min(spec.discount_cents, held_total))
                for a in app.allocations:
                    self.assertLessEqual(a.amount_cents, totals[a.line_id])
                self.assertTrue(set(alloc_lines) <= {ln.line_id for ln in eligible_lines_for(spec, lines)})
            checked += 1
        self.assertGreater(checked, 150)


class DeterminismTests(unittest.TestCase):
    def test_repeat_solve_identical(self):
        rng = random.Random(7)
        specs, lines = random_case(rng)
        r1 = solve(specs, lines)
        r2 = solve(list(reversed(specs)), list(reversed(lines)))
        self.assertEqual(
            [a.coupon_id for a in r1.applications],
            [a.coupon_id for a in r2.applications],
        )
        self.assertEqual(r1.total_discount_cents, r2.total_discount_cents)
        fp1 = [[a.coupon_id, [(x.line_id, x.amount_cents) for x in a.allocations]] for a in r1.applications]
        fp2 = [[a.coupon_id, [(x.line_id, x.amount_cents) for x in a.allocations]] for a in r2.applications]
        self.assertEqual(fp1, fp2)

    def test_lexicographic_tie_breaks_to_smaller_id(self):
        specs = [
            CouponSpec.from_cents("CB", threshold_cents=100, discount_cents=1000),
            CouponSpec.from_cents("CA", threshold_cents=100, discount_cents=1000),
        ]
        lines = [OrderLine("L1", "catA", 2000, 1, 2000)]
        out = solve(specs, lines)
        self.assertEqual(tuple(a.coupon_id for a in out.applications), ("CA",))


class TieDenseComparisonTests(unittest.TestCase):
    """大量“同面额”券制造平局，验证字典序破平局与暴力枚举一致（含跨分量场景）。"""

    def test_tie_dense_cases(self):
        rng = random.Random(424242)
        checked = 0
        for _ in range(120):
            # 1–2 个品类（即 1–2 个互不相连的分量），每行固定 50.00。
            categories = ["catA", "catB"][: rng.randint(1, 2)]
            lines = [
                OrderLine(f"L{i}", rng.choice(categories), 5000, 1, 5000)
                for i in range(rng.randint(2, 5))
            ]
            # 券面额集中在少数取值上，制造大量同额方案。
            discount = rng.choice([2000, 3000, 5000])
            specs = []
            for i in range(rng.randint(2, 5)):
                specs.append(
                    CouponSpec.from_cents(
                        coupon_id=f"C{i}",
                        threshold_cents=rng.choice([1000, 3000, 5000]),
                        discount_cents=discount,
                        applicable_categories=rng.choice([None, ["catA"], ["catB"]]),
                        exclusive_group=rng.choice([None, None, "G1"]),
                    )
                )
            output = solve(specs, lines)
            expected = brute_force(specs, lines)
            got_set = tuple(sorted(a.coupon_id for a in output.applications))
            self.assertEqual(
                (output.total_discount_cents, got_set),
                expected,
                msg=f"specs={specs} lines={lines}",
            )
            checked += 1
        self.assertGreater(checked, 100)


class AllocationTests(unittest.TestCase):
    def test_largest_remainder_split(self):
        # 两行 30/60，券额度 80、门槛 80：必须两行都占有，80 按比例 26.67/53.33 分摊。
        eng = SettlementEngine()
        eng.register_category("catA")
        eng.set_order(
            [
                OrderLine("L1", "catA", 3000, 1, 3000),
                OrderLine("L2", "catA", 6000, 1, 6000),
            ]
        )
        eng.add_coupon(CouponSpec.from_cents("C1", 8000, 8000))
        res = eng.solve()
        app = res.applications[0]
        amounts = {a.line_id: a.amount_cents for a in app.allocations}
        self.assertEqual(amounts, {"L1": 2667, "L2": 5333})
        self.assertEqual(sum(amounts.values()), 8000)

    def test_discount_capped_by_held_total(self):
        eng = SettlementEngine()
        eng.register_category("catA")
        eng.set_order([OrderLine("L1", "catA", 500, 1, 500)])
        eng.add_coupon(CouponSpec.from_cents("C1", 100, 9000))
        res = eng.solve()
        self.assertEqual(res.total_discount_cents, 500)
        self.assertEqual(res.applications[0].allocations[0].amount_cents, 500)


if __name__ == "__main__":
    unittest.main()
