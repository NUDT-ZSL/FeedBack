# -*- coding: utf-8 -*-
import json
import os
import unittest

from engine import Engine

BASE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(BASE, "sample_data.json"), encoding="utf-8") as f:
    SAMPLE = json.load(f)


class DeriveTest(unittest.TestCase):
    def setUp(self):
        self.eng = Engine(SAMPLE)

    def test_multihop_final_landing(self):
        # req-3: edge-1 -> proxy-b -> backend-v2
        d = self.eng.derivations["req-3"]
        self.assertEqual(d["outcome"]["status"], "delivered")
        self.assertEqual(d["outcome"]["landing"], "backend-v2")
        self.assertEqual([r["node"] for r in d["route"]], ["edge-1", "proxy-b"])

    def test_all_candidates_kept_with_basis(self):
        # req-1 在 edge-1 同时命中 r5(撤回)/r1/r2/r4，必须全部保留并带依据
        d = self.eng.derivations["req-1"]
        hop0 = d["trace"][0]
        ids = [c["rule_id"] for c in hop0["candidates"]]
        # 生效候选按优先级在前，撤回候选列在最后且不参与选择
        self.assertEqual(ids, ["r1", "r2", "r4", "r5"])
        self.assertEqual(hop0["candidates"][-1]["status"], "withdrawn")
        self.assertTrue(all(c["basis"] for c in hop0["candidates"]))
        self.assertEqual(hop0["chosen"]["rule_id"], "r1")

    def test_fallback_to_backup_target(self):
        # proxy-a 不可达 -> 回退到 r1 的备用目标 proxy-b
        d = self.eng.derivations["req-1"]
        self.assertEqual(d["outcome"]["landing"], "backend-v2")
        hop0 = d["trace"][0]
        self.assertTrue(hop0["chosen"]["via_backup"])
        self.assertTrue(any("备用目标" in e for e in hop0["events"]))

    def test_cycle_marked_undetermined(self):
        d = self.eng.derivations["req-5"]
        o = d["outcome"]
        self.assertEqual(o["status"], "undetermined")
        self.assertEqual(o["reason"], "cycle")
        self.assertEqual(o["break_hop"]["node"], "loop-1")

    def test_missing_target_marked_undetermined(self):
        d = self.eng.derivations["req-6"]
        o = d["outcome"]
        self.assertEqual(o["status"], "undetermined")
        self.assertEqual(o["reason"], "missing-target")
        self.assertEqual(o["break_hop"]["node"], "ghost")
        self.assertEqual(o["break_hop"]["depth"], 2)
class IncrementalTest(unittest.TestCase):
    def setUp(self):
        self.eng = Engine(SAMPLE)

    def test_withdraw_rule_only_rederives_affected(self):
        # 撤回 r12（proxy-b 的规则）：只影响经过 proxy-b 的请求
        rep = self.eng.apply_mutation({"type": "rule_status", "rule_id": "r12", "status": "withdrawn"})
        self.assertTrue(rep["consistent"])
        self.assertEqual(set(rep["rederived"]), {"req-1", "req-2", "req-3"})
        self.assertEqual(set(rep["changed"]), {"req-1", "req-2", "req-3"})
        # req-4/req-5/req-6 未被重推，结论与全量一致
        self.assertEqual(rep["results"]["req-4"]["landing"], "backend-static")

    def test_restore_node_changes_landing(self):
        # proxy-a 恢复可达：req-1 改走 proxy-a -> backend-v1
        rep = self.eng.apply_mutation({"type": "node_reachable", "node_id": "proxy-a", "reachable": True})
        self.assertTrue(rep["consistent"])
        self.assertIn("req-1", rep["changed"])
        self.assertEqual(rep["results"]["req-1"]["landing"], "backend-v1")
        self.assertEqual(rep["results"]["req-2"]["landing"], "backend-v2")
        # req-3 不经过 proxy-a，落点不变
        self.assertNotIn("req-3", rep["changed"])

    def test_restore_withdrawn_rule(self):
        # 恢复已撤回的 r5（优先级最高）：req-1/req-2 直达 backend-v2
        rep = self.eng.apply_mutation({"type": "rule_status", "rule_id": "r5", "status": "active"})
        self.assertTrue(rep["consistent"])
        self.assertEqual(rep["results"]["req-1"]["landing"], "backend-v2")
        self.assertEqual(rep["results"]["req-1"]["path"], ["edge-1", "backend-v2"])

    def test_request_update_only_rederives_itself(self):
        rep = self.eng.apply_mutation({"type": "request_update", "request_id": "req-3",
                                       "patch": {"features": {"host": "static.example.com",
                                                              "path": "/img/a.png", "method": "GET"}}})
        self.assertTrue(rep["consistent"])
        self.assertEqual(rep["rederived"], ["req-3"])
        self.assertEqual(rep["results"]["req-3"]["landing"], "backend-static")

    def test_rule_update_to_missing_target(self):
        # 把 r12 改写到不存在的节点 -> req-3 变为无法确定
        rep = self.eng.apply_mutation({"type": "rule_update", "rule_id": "r12",
                                       "patch": {"target": "nowhere"}})
        self.assertTrue(rep["consistent"])
        r3 = rep["results"]["req-3"]
        self.assertEqual(r3["status"], "undetermined")
        self.assertEqual(r3["reason"], "missing-target")
        self.assertEqual(r3["break_hop"]["node"], "nowhere")

    def test_rule_add_takes_effect(self):
        rep = self.eng.apply_mutation({"type": "rule_add", "rule": {
            "id": "r99", "node": "edge-1", "priority": 1,
            "when": {"host": "unknown.example.com"}, "target": "backend-v1"}})
        self.assertTrue(rep["consistent"])
        self.assertEqual(rep["results"]["req-5"]["landing"], "backend-v1")


if __name__ == "__main__":
    unittest.main()
