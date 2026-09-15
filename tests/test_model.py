import unittest

from narrative import (Compare, Edge, Engine, Graph, Node, StateChange,
                       ValidationError, VariableDef)
from tests.helpers import build_graph, build_schema


class TestModel(unittest.TestCase):
    def test_duplicate_node_id_rejected(self):
        with self.assertRaises(ValidationError):
            Graph([Node("a", "ch1"), Node("a", "ch2")], [])

    def test_duplicate_change_id_rejected(self):
        with self.assertRaises(ValidationError) as ctx:
            Graph([Node("a", "ch1", changes=[StateChange("c1", "x", "set", 1),
                                             StateChange("c1", "x", "set", 2)])], [])
        self.assertIn("c1", str(ctx.exception))

    def test_edge_to_missing_node_rejected(self):
        with self.assertRaises(ValidationError):
            Graph([Node("a", "ch1")], [Edge("a", "nowhere")])

    def test_validate_against_reports_undeclared_variable(self):
        schema = build_schema()
        graph = Graph([Node("bad", "ch1",
                            entry_condition=Compare("ghost", "eq", 1),
                            changes=[StateChange("c1", "phantom", "set", 1)])], [])
        problems = graph.validate_against(schema)
        self.assertTrue(any("ghost" in p and "进入条件" in p for p in problems))
        self.assertTrue(any("phantom" in p and "c1" in p for p in problems))

    def test_validate_against_reports_type_mismatch(self):
        schema = build_schema()
        graph = Graph([Node("bad", "ch1",
                            changes=[StateChange("c1", "trust", "set", "not-an-int"),
                                     StateChange("c2", "name", "add", 1)])], [])
        problems = graph.validate_against(schema)
        self.assertTrue(any("c1" in p and "类型不符" in p for p in problems))
        self.assertTrue(any("c2" in p and "非数值" in p for p in problems))

    def test_engine_rejects_inconsistent_graph(self):
        graph = Graph([Node("bad", "ch1",
                            changes=[StateChange("c1", "ghost", "set", 1)])], [])
        with self.assertRaises(ValidationError):
            Engine(build_schema(), graph)

    def test_graph_roundtrip(self):
        graph = build_graph()
        clone = Graph.from_dict(graph.to_dict())
        self.assertEqual(clone.to_dict(), graph.to_dict())


if __name__ == "__main__":
    unittest.main()
