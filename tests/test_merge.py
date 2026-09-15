import unittest

from narrative import Engine, ValidationError, merge_logs
from tests.helpers import build_graph, build_schema

LOG_A = [
    {"node": "n2a", "change": "c1", "variable": "met_ally", "op": "set",
     "old": False, "new": True},
    {"node": "n2a", "change": "c2", "variable": "trust", "op": "add",
     "old": 2, "new": 3},
]
LOG_B = [
    {"node": "n2b", "change": "c1", "variable": "gold", "op": "sub",
     "old": 7, "new": 2},
    {"node": "n2b", "change": "c2", "variable": "trust", "op": "set",
     "old": 2, "new": -1},
]


class TestMerge(unittest.TestCase):
    def test_conflict_keeps_both_sources_and_is_readable(self):
        merged, conflicts = merge_logs(LOG_A, LOG_B, "help-path", "rob-path")
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual(c.variable, "trust")
        # 双方来源都保留
        self.assertEqual(c.sources_a, ["节点n2a/变更c2"])
        self.assertEqual(c.sources_b, ["节点n2b/变更c2"])
        self.assertEqual((c.value_a, c.value_b), (3, -1))
        text = c.readable()
        for token in ("trust", "help-path", "rob-path", "3", "-1", "n2a", "n2b"):
            self.assertIn(token, text)

    def test_merge_is_deterministic_regardless_of_argument_order(self):
        m1, c1 = merge_logs(LOG_A, LOG_B, "help-path", "rob-path")
        m2, c2 = merge_logs(LOG_B, LOG_A, "rob-path", "help-path")
        self.assertEqual(m1, m2)
        self.assertEqual([c.to_dict() for c in c1], [c.to_dict() for c in c2])
        # 字典序较小分支胜出
        self.assertEqual(c1[0].winner, "help-path")

    def test_non_conflicting_variables_merge_cleanly(self):
        merged, _ = merge_logs(LOG_A, LOG_B, "help-path", "rob-path")
        written = {(e["variable"], e["new"]) for e in merged}
        self.assertIn(("met_ally", True), written)
        self.assertIn(("gold", 2), written)
        self.assertIn(("trust", 3), written)          # 胜出方
        self.assertNotIn(("trust", -1), written)      # 落败方不进入合并序列

    def test_engine_apply_merge_and_resolve(self):
        engine = Engine(build_schema(), build_graph())
        engine.enter("n0")
        engine.enter("n1")
        conflicts = engine.apply_merge(LOG_A, LOG_B, "help-path", "rob-path")
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(engine.state["trust"], 3)   # 确定性规则：help-path 胜
        self.assertEqual(engine.state["gold"], 2)
        self.assertTrue(engine.state["met_ally"])
        unresolved = engine.unresolved_conflicts()
        self.assertEqual(len(unresolved), 1)
        self.assertIn("readable", unresolved[0])
        # 解决冲突：改用 rob-path 的值
        engine.resolve_conflict("trust", "rob-path")
        self.assertEqual(engine.state["trust"], -1)
        self.assertEqual(engine.unresolved_conflicts(), [])
        with self.assertRaises(ValidationError):
            engine.resolve_conflict("trust", "rob-path")  # 已解决，不可重复

    def test_merge_rolls_back_with_snapshot(self):
        engine = Engine(build_schema(), build_graph())
        engine.enter("n0")
        engine.enter("n1")
        engine.enter("n2a")
        engine.apply_merge(LOG_A, LOG_B, "help-path", "rob-path")
        self.assertEqual(len(engine.conflicts), 1)
        engine.rollback_to("n2a")   # 回退到合并前
        self.assertEqual(engine.conflicts, [])
        self.assertEqual(engine.state["trust"], 2)


if __name__ == "__main__":
    unittest.main()
