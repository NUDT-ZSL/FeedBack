# -*- coding: utf-8 -*-
"""引擎测试：冲突检测、效果判定、基准锁定、增量与全量重算一致性。"""
import random
import unittest

from engine import Engine, demo_store, new_store


def make_engine():
    return Engine(demo_store())


class ConflictTest(unittest.TestCase):
    def test_three_conflict_types_detected(self):
        e = make_engine()
        types = {c["type"] for c in e.conflicts.values()}
        self.assertEqual(types, {"multi_variant", "caliber", "overlap"})

    def test_resolve_keep_variant_keeps_all_sources(self):
        e = make_engine()
        key = [k for k in e.conflicts if k.startswith("multi:")][0]
        gid = e.conflicts[key]["group_ids"][0]
        keep = e.conflicts[key]["variant_ids"][0]
        e.resolve_conflict(key, "keep_variant", variant_id=keep)
        # 来源全部保留：归属记录仍在，只是被标记为 excluded
        ms = [m for m in e.store["memberships"] if m["group_id"] == gid]
        self.assertGreaterEqual(len(ms), 2)
        self.assertEqual(len([m for m in ms if m["status"] == "active"]), 1)
        self.assertTrue(e.verify_consistency())

    def test_ack_keeps_conflict_listed(self):
        e = make_engine()
        key = [k for k in e.conflicts if k.startswith("caliber:")][0]
        e.resolve_conflict(key, "ack")
        self.assertIn(key, e.conflicts)
        self.assertTrue(e.conflicts[key]["resolved"])
        self.assertTrue(e.verify_consistency())


class ConclusionTest(unittest.TestCase):
    def test_sample_insufficient(self):
        e = Engine(new_store())
        gb = e.add_group({"name": "b", "audience_key": "x", "entrants": 2000,
                          "conversions": 200, "period_start": "2026-01-01",
                          "period_end": "2026-01-31"})
        gs = e.add_group({"name": "s", "audience_key": "x", "entrants": 30,
                          "conversions": 6, "period_start": "2026-01-01",
                          "period_end": "2026-01-31"})
        vb = e.add_variant({"name": "base"})
        vs = e.add_variant({"name": "small"})
        e.add_membership(vb, gb)
        e.add_membership(vs, gs)
        e.set_baseline(gb)
        self.assertEqual(e.conclusions[vs]["verdict"], "样本量不足")
        self.assertEqual(e.conclusions[vs]["confidence"], "低")

    def test_period_not_overlapping_flagged(self):
        e = Engine(new_store())
        gb = e.add_group({"name": "b", "audience_key": "x", "entrants": 2000,
                          "conversions": 200, "period_start": "2026-01-01",
                          "period_end": "2026-01-31"})
        gt = e.add_group({"name": "t", "audience_key": "x", "entrants": 2000,
                          "conversions": 300, "period_start": "2026-03-01",
                          "period_end": "2026-03-31"})
        vb = e.add_variant({"name": "base"})
        vt = e.add_variant({"name": "treat"})
        e.add_membership(vb, gb)
        e.add_membership(vt, gt)
        e.set_baseline(gb)
        warns = " ".join(e.conclusions[vt]["warnings"])
        self.assertIn("时段不重叠", warns)

    def test_caliber_inconsistency_flagged(self):
        e = make_engine()
        e.set_baseline(None)
        for c in e.conclusions.values():
            if c["role"] == "treatment":
                self.assertTrue(any("口径" in w for w in c["warnings"]))

    def test_significant_difference(self):
        e = Engine(new_store())
        gb = e.add_group({"name": "b", "audience_key": "x", "entrants": 5000,
                          "conversions": 500, "period_start": "2026-01-01",
                          "period_end": "2026-01-31"})
        gt = e.add_group({"name": "t", "audience_key": "x", "entrants": 5000,
                          "conversions": 650, "period_start": "2026-01-01",
                          "period_end": "2026-01-31"})
        vb = e.add_variant({"name": "base"})
        vt = e.add_variant({"name": "treat"})
        e.add_membership(vb, gb)
        e.add_membership(vt, gt)
        e.set_baseline(gb)
        c = e.conclusions[vt]
        self.assertEqual(c["verdict"], "显著优于基准")
        self.assertEqual(c["confidence"], "高")

class BaselineLockTest(unittest.TestCase):
    def test_lock_changes_baseline_and_marks_caliber_shift(self):
        e = make_engine()
        e.set_baseline("g4")  # 对照-新客，口径「新客」
        self.assertEqual(e.baseline_variant, "v8")
        # 变体A 额外覆盖「老客」口径 -> 应标出口径偏移
        ca = e.conclusions["v6"]
        self.assertIsNotNone(ca["caliber_shift"])
        self.assertTrue(any("口径偏移" in w for w in ca["warnings"]))
        self.assertTrue(e.verify_consistency())

    def test_conclusions_after_lock_match_full_recompute(self):
        e = make_engine()
        e.set_baseline("g1")
        import copy
        fresh = Engine(copy.deepcopy(e.store))
        self.assertEqual(e._normalized(), fresh._normalized())


class IncrementalConsistencyTest(unittest.TestCase):
    def test_random_mutation_sequence_stays_consistent(self):
        rng = random.Random(20260923)
        e = make_engine()
        for step in range(120):
            op = rng.randrange(8)
            gids = list(e.store["groups"])
            vids = list(e.store["variants"])
            try:
                if op == 0:
                    e.add_group({"name": "r%d" % step, "audience_key": rng.choice(["新客", "老客", "兴趣包"]),
                                 "version": rng.choice(["v1", "v2"]),
                                 "entrants": rng.randrange(0, 3000),
                                 "conversions": rng.randrange(0, 200),
                                 "period_start": "2026-0%d-01" % rng.randrange(1, 9),
                                 "period_end": "2026-0%d-28" % rng.randrange(1, 9)})
                elif op == 1 and gids:
                    g = e.store["groups"][rng.choice(gids)]
                    n = rng.randrange(0, 3000)
                    e.update_group(g["id"], {"entrants": n,
                                             "conversions": rng.randrange(0, n + 1)})
                elif op == 2 and gids:
                    e.delete_group(rng.choice(gids))
                elif op == 3:
                    e.add_variant({"name": "v%d" % step})
                elif op == 4 and vids and gids:
                    e.add_membership(rng.choice(vids), rng.choice(gids))
                elif op == 5 and e.store["memberships"]:
                    m = rng.choice(e.store["memberships"])
                    e.remove_membership(m["variant_id"], m["group_id"])
                elif op == 6 and e.conflicts:
                    key = rng.choice(list(e.conflicts))
                    c = e.conflicts[key]
                    if c["type"] == "multi_variant":
                        e.resolve_conflict(key, "keep_variant",
                                           variant_id=rng.choice(c["variant_ids"]))
                    else:
                        e.resolve_conflict(key, rng.choice(["ack", "exclude_membership"]),
                                           variant_id=c["variant_ids"][0],
                                           group_id=rng.choice(c["group_ids"]))
                elif op == 7:
                    e.set_baseline(rng.choice(gids) if gids and rng.random() < 0.7 else None)
            except ValueError:
                pass  # 非法操作（如转化>进入）应被拒绝且不影响一致性
            self.assertTrue(e.verify_consistency(),
                            "第 %d 步（op=%d）后增量结果与全量重算不一致" % (step, op))

    def test_observation_fix_only_touches_affected(self):
        e = make_engine()
        e.set_baseline("g4")
        before = dict(e.conclusions)
        e.update_group("g5", {"conversions": 10})  # g5 只属于 v7
        self.assertNotEqual(e.conclusions["v7"], before["v7"])
        self.assertTrue(e.verify_consistency())


if __name__ == "__main__":
    unittest.main(verbosity=2)
