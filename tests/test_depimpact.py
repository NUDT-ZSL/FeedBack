import json
import unittest

from depimpact.diffing import compare_descriptors
from depimpact.errors import DescriptorParseError
from depimpact.graph import build_graph
from depimpact.parser import parse_descriptor
from depimpact.propagation import analyze_impact


VALID = {
    "version": 1,
    "nodes": [
        {"id": "db", "attributes": {"version": 1}},
        {"id": "api", "attributes": {"version": 1}},
        {"id": "web", "attributes": {"version": 1}},
        {"id": "worker", "attributes": {"version": 1}},
        {"id": "locked", "attributes": {}},
        {"id": "hidden", "attributes": {}},
    ],
    "edges": [
        {"from": "api", "to": "db"},
        {"from": "web", "to": "api"},
        {"from": "worker", "to": "db"},
        {"from": "locked", "to": "db"},
        {"from": "hidden", "to": "locked"},
    ],
    "controls": {"locked": ["locked"], "excluded": ["hidden"]},
}


def descriptor(raw):
    return parse_descriptor(json.dumps(raw), source="test.json")


class DependencyImpactTests(unittest.TestCase):
    def test_direct_and_reverse_dependencies(self):
        graph = build_graph(descriptor(VALID))
        self.assertEqual(graph.direct_dependencies["api"], ["db"])
        self.assertEqual(graph.dependents["db"],
                         ["api", "locked", "worker"])

    def test_transitive_propagation_uses_shortest_paths(self):
        desc = descriptor(VALID)
        graph = build_graph(desc)
        result = analyze_impact(desc, graph, ["db"])
        self.assertIn("web", result.affected)
        self.assertIn("worker", result.affected)
        self.assertEqual(result.nodes["web"].path, ("db", "api", "web"))

    def test_locked_is_traversed_but_excluded_is_hidden(self):
        desc = descriptor(VALID)
        graph = build_graph(desc)
        result = analyze_impact(desc, graph, ["db"])
        self.assertNotIn("locked", result.affected)
        self.assertIn("locked", result.locked)
        self.assertNotIn("hidden", result.affected)
        self.assertNotIn("hidden", result.locked)
        self.assertIn("hidden", result.excluded)
        # The hidden node does not alter results for any visible node.
        self.assertIn("locked", result.nodes)

    def test_cycle_marks_reachable_conclusions_untrusted(self):
        raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "edges": [
                {"from": "a", "to": "b"},
                {"from": "b", "to": "a"},
                {"from": "c", "to": "b"},
            ],
        }
        graph = build_graph(descriptor(raw))
        self.assertEqual(graph.cyclic_nodes, {"a", "b"})
        result = analyze_impact(descriptor(raw), graph, ["a"])
        self.assertIn("a", result.untrusted)
        self.assertIn("b", result.untrusted)
        self.assertIn("c", result.untrusted)
        self.assertTrue(any(issue.kind == "cycle" for issue in graph.issues))

    def test_missing_target_is_structural_and_pollutes_path(self):
        raw = {
            "version": 1,
            "nodes": [{"id": "a"}],
            "edges": [{"from": "a", "to": "missing"}],
        }
        desc = descriptor(raw)
        graph = build_graph(desc)
        self.assertIn("missing", graph.placeholders)
        result = analyze_impact(desc, graph, ["a"])
        self.assertEqual(result.affected, ("a",))
        self.assertEqual(result.undeclared, ())
        self.assertTrue(any(issue.kind == "missing_target"
                            for issue in graph.issues))

    def test_undeclared_origin_reveals_known_reverse_dependents(self):
        raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [
                {"from": "a", "to": "ghost"},
                {"from": "b", "to": "a"},
            ],
        }
        desc = descriptor(raw)
        graph = build_graph(desc)
        result = analyze_impact(desc, graph, ["ghost"])
        self.assertEqual(result.affected, ("a", "b"))
        self.assertEqual(result.undeclared, ("ghost",))
        self.assertEqual(result.nodes["b"].path, ("ghost", "a", "b"))
        self.assertEqual(set(result.untrusted), {"a", "b", "ghost"})

    def test_locked_node_keeps_downstream_result_consistent(self):
        desc = descriptor(VALID)
        graph = build_graph(desc)
        controlled = analyze_impact(desc, graph, ["db"])

        raw = json.loads(json.dumps(VALID))
        raw["controls"] = {"locked": [], "excluded": []}
        plain_desc = descriptor(raw)
        plain = analyze_impact(plain_desc, graph, ["db"])
        for node_id in ("db", "api", "web", "worker"):
            self.assertEqual(controlled.nodes[node_id].path,
                             plain.nodes[node_id].path)
            self.assertEqual(controlled.nodes[node_id].untrusted,
                             plain.nodes[node_id].untrusted)

    def test_invalid_descriptor_reports_location_without_result(self):
        raw = {
            "version": "1",
            "nodes": [{"attributes": {}}, {"id": "a"}],
            "edges": [{"from": "a"}],
            "unknown": True,
        }
        with self.assertRaises(DescriptorParseError) as caught:
            descriptor(raw)
        locations = {issue.location for issue in caught.exception.issues}
        self.assertIn("test.json:/version", locations)
        self.assertIn("test.json:/nodes[0]/id", locations)
        self.assertIn("test.json:/edges[0]/to", locations)
        self.assertIn("test.json:/unknown", locations)

    def test_partial_controls_still_produces_clean_validation_error(self):
        raw = {
            "version": 1,
            "nodes": [{"id": "a"}],
            "edges": [],
            "controls": {"locked": "not-an-array"},
        }
        with self.assertRaises(DescriptorParseError) as caught:
            descriptor(raw)
        self.assertEqual(
            caught.exception.issues[0].location,
            "test.json:/controls/locked")

    def test_edge_diff_propagates_added_and_removed_edges(self):
        old_raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}],
            "edges": [{"from": "b", "to": "a",
                       "attributes": {"type": "compile"}}],
        }
        new_raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "edges": [
                {"from": "b", "to": "a",
                 "attributes": {"type": "runtime"}},
                {"from": "c", "to": "b"},
            ],
        }
        diff = compare_descriptors(descriptor(old_raw), descriptor(new_raw))
        kinds = [(change.kind, change.source, change.target)
                 for change in diff.edge_changes]
        self.assertIn(("added", "c", "b"), kinds)
        self.assertIn(("modified", "b", "a"), kinds)
        added = next(change for change in diff.edge_changes
                     if change.kind == "added")
        self.assertEqual(added.impact.affected, ("c",))

    def test_removed_edge_propagates_from_dependent_endpoint(self):
        old_raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "edges": [
                {"from": "b", "to": "a"},
                {"from": "c", "to": "b"},
            ],
        }
        new_raw = {
            "version": 1,
            "nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "edges": [{"from": "b", "to": "a"}],
        }
        diff = compare_descriptors(descriptor(old_raw), descriptor(new_raw))
        removed = next(change for change in diff.edge_changes
                       if change.kind == "removed")
        self.assertEqual((removed.source, removed.target), ("c", "b"))
        self.assertEqual(removed.impact.affected, ("c",))


if __name__ == "__main__":
    unittest.main()
