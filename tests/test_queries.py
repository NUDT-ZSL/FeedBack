import unittest

from narrative import Engine
from tests.helpers import build_graph, build_schema
from tests.test_merge import LOG_A, LOG_B


class TestQueries(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(build_schema(), build_graph())

    def test_entry_condition_query(self):
        cond = self.engine.entry_condition("n2a")
        self.assertEqual(cond, {"op": "cmp", "var": "trust", "cmp": "ge", "value": 2})
        self.assertEqual(self.engine.entry_condition("n0"),
                         {"op": "const", "value": True})

    def test_reachable_from_current_state(self):
        self.engine.enter("n0")
        self.assertEqual(self.engine.reachable_from("n0"), ["n1"])
        self.engine.enter("n1")
        # trust=2, gold=7：n2a（trust>=2）与 n2b（gold>=5）均可达，按标识排序
        self.assertEqual(self.engine.reachable_from("n1"), ["n2a", "n2b"])

    def test_reachable_from_hypothetical_state(self):
        state = {"trust": 0, "gold": 3, "reputation": 0.0,
                 "met_ally": False, "name": "hero"}
        self.assertEqual(self.engine.reachable_from("n1", state), [])
        state["gold"] = 9
        self.assertEqual(self.engine.reachable_from("n1", state), ["n2b"])

    def test_provenance_chain(self):
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2a")
        chain = self.engine.provenance("trust")
        self.assertEqual([(e["node"], e["change"], e["old"], e["new"])
                          for e in chain],
                         [("n1", "c1", 0, 2), ("n2a", "c2", 2, 3)])
        self.assertEqual(self.engine.provenance("gold")[0]["new"], 7)
        self.assertEqual(self.engine.provenance("name")[0]["branch"], "main")

    def test_branch_attribution_query(self):
        self.assertEqual(self.engine.branch_attribution(), "main")
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2b")
        self.assertEqual(self.engine.branch_attribution(), "n1:rob")

    def test_unresolved_conflicts_stable_order(self):
        self.engine.enter("n0")
        self.engine.enter("n1")
        extra_a = [{"node": "n2a", "change": "c9", "variable": "gold",
                    "op": "set", "old": 7, "new": 1}]
        extra_b = [{"node": "n2b", "change": "c9", "variable": "gold",
                    "op": "set", "old": 7, "new": 4}]
        self.engine.apply_merge(LOG_A + extra_a, LOG_B + extra_b, "A", "B")
        conflicts = self.engine.unresolved_conflicts()
        self.assertEqual([c["variable"] for c in conflicts], ["gold", "trust"])
        # 重复查询结果一致（稳定顺序）
        self.assertEqual(self.engine.unresolved_conflicts(), conflicts)


if __name__ == "__main__":
    unittest.main()
