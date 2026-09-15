import unittest

from narrative import (ChangeError, Compare, Edge, Engine, EntryError, Graph,
                       Node, StateChange)
from tests.helpers import build_graph, build_schema


class TestEngine(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(build_schema(), build_graph())

    def test_enter_applies_changes_in_order(self):
        self.engine.enter("n0")
        self.assertEqual(self.engine.state["name"], "hero")
        self.engine.enter("n1")
        self.assertEqual(self.engine.state["trust"], 2)
        self.assertEqual(self.engine.state["gold"], 7)
        self.assertEqual(self.engine.progress, 2)
        self.assertEqual(self.engine.unlocked, {"n0", "n1"})
        self.assertEqual(self.engine.current_node, "n1")

    def test_entry_condition_blocks_entry(self):
        # n2a 要求 trust>=2，初始为 0
        with self.assertRaises(EntryError):
            self.engine.enter("n2a")
        self.assertEqual(self.engine.progress, 0)

    def test_branch_attribution_recorded_from_edge_label(self):
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2a")  # 经 n1->n2a（label=help）
        self.assertEqual(self.engine.branch_attribution(), "n1:help")

    def test_type_mismatch_rejected_with_location_and_no_residue(self):
        # add 浮点操作数到 int 变量 trust：运行期类型不符
        graph = Graph([Node("x", "ch1",
                            changes=[StateChange("c1", "gold", "sub", 2),
                                     StateChange("c2", "trust", "add", 1.5)])], [])
        engine = Engine(build_schema(), graph)
        before = dict(engine.state)
        with self.assertRaises(ChangeError) as ctx:
            engine.enter("x")
        msg = str(ctx.exception)
        self.assertIn("x", msg) and self.assertIn("c2", msg) and self.assertIn("trust", msg)
        # 整体回滚：c1 的 gold-2 也不残留
        self.assertEqual(engine.state, before)
        self.assertEqual(engine.progress, 0)
        self.assertEqual(engine.change_log, [])

    def test_undeclared_variable_rejected_with_location(self):
        # 构造期校验拦截未声明变量，错误信息含节点与变更标识
        graph = Graph([Node("y", "ch1",
                            changes=[StateChange("c9", "ghost", "set", 1)])], [])
        with self.assertRaises(Exception) as ctx:
            Engine(build_schema(), graph)
        msg = str(ctx.exception)
        self.assertIn("y", msg) and self.assertIn("c9", msg) and self.assertIn("ghost", msg)

    def test_float_accepts_int_operand(self):
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2a")
        self.engine.enter("n3")
        self.assertEqual(self.engine.state["reputation"], 1.5)


if __name__ == "__main__":
    unittest.main()
