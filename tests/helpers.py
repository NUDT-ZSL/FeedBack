"""测试共用的样例世界：两章、一次分叉、一个汇合节点。"""
from narrative import (And, Compare, Edge, Graph, Node, Not, Or, Schema,
                       StateChange, VariableDef)


def build_schema(extra=()):
    return Schema([
        VariableDef("trust", "int", 0),
        VariableDef("gold", "int", 10),
        VariableDef("reputation", "float", 0.0),
        VariableDef("met_ally", "bool", False),
        VariableDef("name", "str", "wanderer"),
        *extra,
    ])


def build_graph():
    nodes = [
        Node("n0", "ch1", changes=[StateChange("c1", "name", "set", "hero")]),
        Node("n1", "ch1",
             entry_condition=Compare("trust", "ge", 0),
             changes=[StateChange("c1", "trust", "add", 2),
                      StateChange("c2", "gold", "sub", 3)]),
        Node("n2a", "ch2",
             entry_condition=Compare("trust", "ge", 2),
             changes=[StateChange("c1", "met_ally", "set", True),
                      StateChange("c2", "trust", "add", 1)]),
        Node("n2b", "ch2",
             entry_condition=Compare("gold", "ge", 5),
             changes=[StateChange("c1", "gold", "sub", 5),
                      StateChange("c2", "trust", "set", -1)]),
        Node("n3", "ch2",
             entry_condition=Or([Compare("met_ally", "eq", True),
                                 Compare("trust", "lt", 0)]),
             changes=[StateChange("c1", "reputation", "add", 1.5)]),
    ]
    edges = [
        Edge("n0", "n1"),
        Edge("n1", "n2a", label="help"),
        Edge("n1", "n2b", label="rob"),
        Edge("n2a", "n3"),
        Edge("n2b", "n3", condition=Compare("gold", "ge", 0)),
    ]
    return Graph(nodes, edges)
