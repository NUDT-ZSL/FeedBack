"""Compare two dependency descriptors and propagate each edge change."""

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .graph import Graph, build_graph
from .models import Descriptor, Edge
from .propagation import ImpactResult, analyze_impact


@dataclass(frozen=True)
class EdgeChange:
    kind: str
    source: str
    target: str
    old_edge: Optional[Edge]
    new_edge: Optional[Edge]
    impact: Optional[ImpactResult]


@dataclass(frozen=True)
class NodeChange:
    kind: str
    node_id: str
    impact: Optional[ImpactResult]
    details: Tuple[Tuple[str, str, str], ...] = ()


@dataclass(frozen=True)
class DescriptorDiff:
    old_graph: Graph
    new_graph: Graph
    edge_changes: Tuple[EdgeChange, ...]
    node_changes: Tuple[NodeChange, ...]


def compare_descriptors(old: Descriptor, new: Descriptor) -> DescriptorDiff:
    old_graph = build_graph(old)
    new_graph = build_graph(new)
    old_edges = {edge.key: edge for edge in old.edges}
    new_edges = {edge.key: edge for edge in new.edges}
    edge_changes: List[EdgeChange] = []

    for key in sorted(set(old_edges) | set(new_edges)):
        old_edge = old_edges.get(key)
        new_edge = new_edges.get(key)
        if old_edge is None:
            impact = _edge_impact(new, new_graph, key, added=True)
            kind = "added"
        elif new_edge is None:
            impact = _edge_impact(old, old_graph, key, removed=True)
            kind = "removed"
        elif old_edge.attributes != new_edge.attributes:
            impact = _edge_impact(new, new_graph, key,
                                  old_descriptor=old, old_graph=old_graph)
            kind = "modified"
        else:
            continue
        edge_changes.append(EdgeChange(kind, key[0], key[1],
                                       old_edge, new_edge, impact))

    node_changes: List[NodeChange] = []
    for node_id in sorted(set(old.nodes) | set(new.nodes)):
        old_node = old.nodes.get(node_id)
        new_node = new.nodes.get(node_id)
        if old_node is None:
            kind, details = "added", (("presence", "absent", "present"),)
            impact = analyze_impact(new, new_graph, [node_id])
        elif new_node is None:
            kind, details = "removed", (("presence", "present", "absent"),)
            impact = analyze_impact(old, old_graph, [node_id])
        else:
            details = tuple(_attribute_differences(old_node.attributes,
                                                   new_node.attributes))
            if not details:
                continue
            kind = "modified"
            impact = analyze_impact(new, new_graph, [node_id])
        node_changes.append(NodeChange(kind, node_id, impact, details))

    return DescriptorDiff(old_graph, new_graph,
                          tuple(edge_changes), tuple(node_changes))


def _attribute_differences(
        old_attributes: Dict[str, Any],
        new_attributes: Dict[str, Any]) -> List[Tuple[str, str, str]]:
    changes: List[Tuple[str, str, str]] = []
    for key in sorted(set(old_attributes) | set(new_attributes)):
        if key not in old_attributes:
            changes.append((key, "<absent>", _short(new_attributes[key])))
        elif key not in new_attributes:
            changes.append((key, _short(old_attributes[key]), "<absent>"))
        elif old_attributes[key] != new_attributes[key]:
            changes.append((key, _short(old_attributes[key]),
                            _short(new_attributes[key])))
    return changes


def _short(value: Any, limit: int = 40) -> str:
    text = repr(value)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _edge_impact(descriptor: Descriptor, graph: Graph,
                 key: Tuple[str, str],
                 added: bool = False, removed: bool = False,
                 old_descriptor: Optional[Descriptor] = None,
                 old_graph: Optional[Graph] = None) -> Optional[ImpactResult]:
    source, _target = key
    if added and source not in graph.nodes:
        return None
    result = analyze_impact(descriptor, graph, [source])
    if old_descriptor is not None and old_graph is not None:
        old_result = analyze_impact(old_descriptor, old_graph, [source])
        result = _merge_impacts(result, old_result)
    return result


def _merge_impacts(first: ImpactResult, second: ImpactResult) -> ImpactResult:
    nodes = dict(first.nodes)
    for node_id, node in second.nodes.items():
        if node_id not in nodes:
            nodes[node_id] = node
            continue
        existing = nodes[node_id]
        reasons = tuple(sorted(set(existing.reasons) | set(node.reasons)))
        nodes[node_id] = type(node)(
            id=node_id,
            path=existing.path if len(existing.path) <= len(node.path)
            else node.path,
            untrusted=existing.untrusted or node.untrusted,
            reasons=reasons,
            state=existing.state if existing.state != "affected"
            else node.state)
    return ImpactResult(
        origins=tuple(sorted(set(first.origins) | set(second.origins))),
        nodes=nodes,
        affected=tuple(sorted(node.id for node in nodes.values()
                              if node.state == "affected")),
        locked=tuple(sorted(node.id for node in nodes.values()
                            if node.state == "locked")),
        excluded=tuple(sorted(node.id for node in nodes.values()
                              if node.state == "excluded")),
        undeclared=tuple(sorted(node.id for node in nodes.values()
                                if node.state == "undeclared")),
        untrusted=tuple(sorted(
            node_id for node_id, node in nodes.items() if node.untrusted)),
        incomplete=first.incomplete or second.incomplete)
