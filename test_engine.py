#!/usr/bin/env python3
"""血缘推演引擎测试: python -m unittest test_engine -v"""
import copy
import random
import unittest

import lineage_engine as engine
from server import demo_data


class TestEngine(unittest.TestCase):
    def setUp(self):
        self.data = demo_data()

    def states(self):
        return engine.evaluate(self.data)[0]

    # 需求3: 冲突保留双方并标出, 不静默择一
    def test_conflict_kept_and_flagged(self):
        states, diags = engine.evaluate(self.data)
        self.assertEqual(states["dws_region_sales"]["state"], engine.CONFLICT)
        conflict_diags = [d for d in diags if d["code"] == "conflict"]
        self.assertEqual(len(conflict_diags), 2)  # 两条依据都保留并标出
        ders = {d["derivation"] for d in conflict_diags}
        self.assertEqual(ders, {"der_region_by_order", "der_region_by_pay"})

    def test_adopt_resolves_conflict(self):
        self.data["derivations"]["der_region_by_order"]["status"] = "superseded"
        st = self.states()
        self.assertEqual(st["dws_region_sales"]["state"], engine.OK)

    # 需求2: 上游定义变更 -> 下游需要重算(可传递)
    def test_version_bump_propagates_stale(self):
        self.data["datasets"]["src_orders"]["version"] += 1
        st = self.states()
        self.assertEqual(st["dwd_order_detail"]["state"], engine.STALE)
        self.assertEqual(st["dws_user_refund"]["state"], engine.STALE)
        self.assertEqual(st["ads_user_360"]["state"], engine.STALE)      # 跨两级传递
        self.assertEqual(st["rpt_daily_sales"]["state"], engine.STALE)
        self.assertEqual(st["src_users"]["state"], engine.OK)            # 未受影响

    # 需求2: 上游停用 -> 下游结论失效
    def test_disable_upstream_invalidates(self):
        self.data["datasets"]["src_refunds"]["status"] = "disabled"
        st = self.states()
        self.assertEqual(st["dws_user_refund"]["state"], engine.INVALID)
        self.assertEqual(st["ads_user_360"]["state"], engine.INVALID)
        self.assertEqual(st["dwd_order_detail"]["state"], engine.OK)

    # 需求5: 上游缺失定位
    def test_missing_upstream_located(self):
        self.data["derivations"]["der_user_refund"]["inputs"][0]["dataset"] = "src_ghost"
        states, diags = engine.evaluate(self.data)
        self.assertEqual(states["dws_user_refund"]["state"], engine.INVALID)
        hits = [d for d in diags if d["code"] == "missing_upstream"]
        self.assertTrue(hits and "src_ghost" in hits[0]["message"])
        self.assertEqual(hits[0]["dataset"], "dws_user_refund")

    # 需求5: 字段映射不完整定位
    def test_incomplete_mapping_located(self):
        self.data["datasets"]["dwd_order_detail"]["fields"].append(
            {"name": "coupon", "type": "decimal"})
        states, diags = engine.evaluate(self.data)
        self.assertEqual(states["dwd_order_detail"]["state"], engine.INVALID)
        hits = [d for d in diags if d["code"] == "incomplete_mapping"]
        self.assertTrue(hits and "coupon" in hits[0]["message"])

    def test_bad_mapping_field_located(self):
        self.data["derivations"]["der_order_detail"]["inputs"][0]["mappings"].append(
            {"from": "ghost_col", "to": "amount"})
        states, diags = engine.evaluate(self.data)
        self.assertEqual(states["dwd_order_detail"]["state"], engine.INVALID)
        hits = [d for d in diags if d["code"] == "bad_mapping"]
        self.assertTrue(hits and hits[0]["field"] == "ghost_col")

    # 需求5: 循环依赖定位到具体环节
    def test_cycle_located(self):
        self.data["datasets"]["src_orders"]["kind"] = "derived"
        self.data["derivations"]["der_cycle"] = {
            "id": "der_cycle", "target": "src_orders", "status": "active",
            "version": 1, "note": "错误回环", "steps": [],
            "inputs": [{"dataset": "rpt_daily_sales",
                        "mappings": [{"from": "day", "to": "pay_time"}]}],
            "input_versions": {"rpt_daily_sales": 1}}
        states, diags = engine.evaluate(self.data)
        for nid in ("src_orders", "dwd_order_detail", "rpt_daily_sales"):
            self.assertEqual(states[nid]["state"], engine.INVALID, nid)
        hits = [d for d in diags if d["code"] == "cycle"]
        self.assertTrue(hits)
        self.assertIn("src_orders", hits[0]["message"])

    # 需求4: 重算标记后恢复新鲜
    def test_recompute_marks_fresh(self):
        self.data["datasets"]["src_orders"]["version"] += 1
        self.assertEqual(self.states()["dwd_order_detail"]["state"], engine.STALE)
        for der in self.data["derivations"].values():
            der["input_versions"] = {
                i["dataset"]: self.data["datasets"][i["dataset"]]["version"]
                for i in der.get("inputs", [])}
        st = self.states()
        self.assertEqual(st["dwd_order_detail"]["state"], engine.OK)
        self.assertEqual(st["ads_user_360"]["state"], engine.OK)

    # 需求1: 同一数据集被多个下游引用
    def test_multi_downstream_reference(self):
        st = self.states()
        for nid in ("ads_user_360", "rpt_daily_sales"):
            self.assertEqual(st[nid]["state"], engine.OK)
        closure = engine.downstream_closure(self.data, ["dwd_order_detail"])
        self.assertIn("ads_user_360", closure)
        self.assertIn("rpt_daily_sales", closure)
        self.assertIn("dws_region_sales", closure)

    # 需求4: 增量推演与全量推演一致(随机变更序列)
    def test_incremental_matches_full(self):
        rng = random.Random(20260920)
        data = demo_data()
        ds_ids = list(data["datasets"])
        for step in range(300):
            prev, _ = engine.evaluate(data)
            op = rng.randrange(5)
            target = rng.choice(ds_ids)
            if op == 0:
                data["datasets"][target]["version"] += 1
            elif op == 1:
                d = data["datasets"][target]
                d["status"] = "disabled" if d["status"] == "active" else "active"
            elif op == 2:
                f = data["datasets"][target]["fields"]
                if f:
                    f.pop(rng.randrange(len(f)))
                data["datasets"][target]["version"] += 1
            elif op == 3:
                data["datasets"][target]["fields"].append(
                    {"name": "extra_%d" % step, "type": "string"})
                data["datasets"][target]["version"] += 1
            else:
                der = data["derivations"][rng.choice(list(data["derivations"]))]
                der["status"] = "superseded" if der["status"] == "active" else "active"
                target = der["target"]
            closure = engine.downstream_closure(data, [target])
            inc, _ = engine.evaluate(data, prev_states=prev, only=closure)
            full, _ = engine.evaluate(data)
            self.assertEqual(inc, full, "step=%d op=%d target=%s" % (step, op, target))


if __name__ == "__main__":
    unittest.main()
