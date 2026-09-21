"""Dependency graph construction and structural diagnosis."""

from collections import deque
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Tuple

from .models import Descriptor, Edge


@dataclass(frozen=True)
class StructuralIssue:
    kind: str
    severity: str
    message: str
    source: Optional[str] = None
    target: Optional[str] = None
    path: Tuple[str, ...] = ()


@dataclass
class Graph:
    nodes: Set[str]
    attributes: Dict[str, Dict[str, object]]
    placeholders: Set[str]
    direct_dependencies: Dict[str, List[str]]
    dependents: Dict[str, List[str]]
    edges: List[Edge]
    edge_by_key: Dict[Tuple[str, str], Edge]
    issues: List[StructuralIssue] = field(default_factory=list)
    cyclic_nodes: Set[str] = field(default_factory=set)

    def downstream(self, node: str) -> List[str]:
        """Nodes affected when ``node`` changes: nodes depending on it."""
        return self.dependents.get(node, [])


def build_graph(descriptor: Descriptor) -> Graph:
    declared = set(descriptor.nodes)
    referenced = {endpoint for edge in descriptor.edges
                  for endpoint in (edge.source, edge.target)}
    placeholders = referenced - declared
    all_nodes = declared | placeholders

    dependencies: Dict[str, List[str]] = {
        node: [] for node in sorted(all_nodes)}
    dependents: Dict[str, List[str]] = {
        node: [] for node in sorted(all_nodes)}
    edge_by_key: Dict[Tuple[str, str], Edge] = {}
    for edge in descriptor.edges:
        dependencies[edge.source].append(edge.target)
        dependents[edge.target].append(edge.source)
        edge_by_key[edge.key] = edge

    graph = Graph(
        nodes=declared,
        attributes={node_id: dict(descriptor.nodes[node_id].attributes)
                    for node_id in sorted(declared)},
        placeholders=placeholders,
        direct_dependencies={key: sorted(set(values))
                             for key, values in dependencies.items()},
        dependents={key: sorted(set(values))
                    for key, values in dependents.items()},
        edges=list(descriptor.edges),
        edge_by_key=edge_by_key,
    )
    _find_missing_references(graph, descriptor, declared, placeholders)
    _find_cycles(graph)
    return graph


def _find_missing_references(graph: Graph, descriptor: Descriptor,
                             declared: Set[str],
                             placeholders: Set[str]) -> None:
    # ``placeholders`` is supplied alongside individual edges so callers can
    # see both the full unknown set and each exact reference location.
    del placeholders
    for edge in descriptor.edges:
        if edge.source not in declared:
            graph.issues.append(StructuralIssue(
                kind="missing_source",
                severity="warning",
                source=edge.source,
                target=edge.target,
                message=(f"edge {edge.source!r} -> {edge.target!r} starts at "
                         f"a node that is not declared")))
        if edge.target not in declared:
            graph.issues.append(StructuralIssue(
                kind="missing_target",
                severity="warning",
                source=edge.source,
                target=edge.target,
                message=(f"edge {edge.source!r} -> {edge.target!r} points to "
                         f"a node that is not declared")))


def _strong_components(graph: Graph) -> List[Set[str]]:
    """Iterative Tarjan SCC, safe for large dependency graphs."""
    index = 0
    indices: Dict[str, int] = {}
    lowlink: Dict[str, int] = {}
    stack: List[str] = []
    on_stack: Set[str] = set()
    components: List[Set[str]] = []

    for root in sorted(graph.direct_dependencies):
        if root in indices:
            continue
        work: List[Tuple[str, int]] = [(root, 0)]
        while work:
            node, next_pos = work[-1]
            if next_pos == 0:
                indices[node] = lowlink[node] = index
                index += 1
                stack.append(node)
                on_stack.add(node)
            neighbors = graph.direct_dependencies[node]
            if next_pos < len(neighbors):
                work[-1] = (node, next_pos + 1)
                neighbor = neighbors[next_pos]
                if neighbor not in indices:
                    work.append((neighbor, 0))
                elif neighbor in on_stack:
                    lowlink[node] = min(lowlink[node], indices[neighbor])
            else:
                if lowlink[node] == indices[node]:
                    component: Set[str] = set()
                    while True:
                        member = stack.pop()
                        on_stack.remove(member)
                        component.add(member)
                        if member == node:
                            break
                    components.append(component)
                work.pop()
                if work:
                    parent = work[-1][0]
                    lowlink[parent] = min(lowlink[parent], lowlink[node])
    return components


def _find_cycles(graph: Graph) -> None:
    components = _strong_components(graph)
    seen_cycles: Set[Tuple[str, ...]] = set()

    for component in components:
        if len(component) > 1:
            graph.cyclic_nodes.update(component)
            cycle = _simple_cycle(graph, component)
            if cycle is not None:
                canonical = _canonical_cycle(cycle)
                if canonical not in seen_cycles:
                    seen_cycles.add(canonical)
                    graph.issues.append(_cycle_issue(canonical))
        else:
            node = next(iter(component))
            if node in graph.direct_dependencies.get(node, []):
                graph.cyclic_nodes.add(node)
                canonical = (node,)
                if canonical not in seen_cycles:
                    seen_cycles.add(canonical)
                    graph.issues.append(_cycle_issue(canonical))

    graph.issues.sort(key=lambda issue: (issue.kind, issue.path,
                                        issue.source or "",
                                        issue.target or ""))


def _simple_cycle(graph: Graph, component: Set[str]) -> Optional[Tuple[str, ...]]:
    """Return one deterministic simple cycle inside an SCC."""
    start = min(component)
    stack = [start]
    on_stack = {start}
    positions = {start: 0}
    neighbors_by_node: Dict[str, List[str]] = {}

    while stack:
        node = stack[-1]
        neighbors = neighbors_by_node.setdefault(
            node, sorted(
                neighbor for neighbor in graph.direct_dependencies[node]
                if neighbor in component))
        position = positions[node]
        if position >= len(neighbors):
            stack.pop()
            on_stack.remove(node)
            positions.pop(node, None)
            neighbors_by_node.pop(node, None)
            if stack:
                positions[stack[-1]] += 1
            continue

        neighbor = neighbors[position]
        if neighbor == start and len(stack) > 1:
            return tuple(stack)
        if neighbor not in on_stack:
            stack.append(neighbor)
            on_stack.add(neighbor)
            positions[neighbor] = 0
        else:
            positions[node] += 1
    return None


def _canonical_cycle(cycle: Tuple[str, ...]) -> Tuple[str, ...]:
    starts = [cycle[index:] + cycle[:index] for index in range(len(cycle))]
    return min(starts)


def _cycle_issue(cycle: Tuple[str, ...]) -> StructuralIssue:
    shown = cycle + (cycle[0],)
    if len(cycle) == 1:
        message = f"self dependency at node {cycle[0]!r}"
    else:
        message = "dependency cycle: " + " -> ".join(shown)
    return StructuralIssue(
        kind="cycle",
        severity="warning",
        message=message,
        path=shown)


def bfs_shortest_paths(
        graph: Graph, origins: List[str],
        adjacency: Optional[Dict[str, List[str]]] = None
) -> Dict[str, Tuple[str, ...]]:
    """Return one deterministic shortest path from each reached origin."""
    adjacency = graph.dependents if adjacency is None else adjacency
    queue = deque()
    paths: Dict[str, Tuple[str, ...]] = {}
    for origin in origins:
        if origin in paths:
            continue
        paths[origin] = (origin,)
        queue.append(origin)

    while queue:
        node = queue.popleft()
        for neighbor in sorted(adjacency.get(node, [])):
            if neighbor not in paths:
                paths[neighbor] = paths[node] + (neighbor,)
                queue.append(neighbor)
    return paths
