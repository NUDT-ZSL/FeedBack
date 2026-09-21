"""Change propagation and impact trust analysis."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .graph import Graph, bfs_shortest_paths
from .models import Descriptor


@dataclass(frozen=True)
class ImpactNode:
    id: str
    path: Tuple[str, ...]
    untrusted: bool
    reasons: Tuple[str, ...]
    state: str


@dataclass(frozen=True)
class ImpactResult:
    origins: Tuple[str, ...]
    nodes: Dict[str, ImpactNode]
    affected: Tuple[str, ...]
    locked: Tuple[str, ...]
    excluded: Tuple[str, ...]
    untrusted: Tuple[str, ...]
    undeclared: Tuple[str, ...]
    incomplete: bool


@dataclass
class ChangeSpec:
    node_attributes: List[str] = field(default_factory=list)
    edge_added: List[Tuple[str, str]] = field(default_factory=list)
    edge_removed: List[Tuple[str, str]] = field(default_factory=list)
    edge_modified: List[Tuple[str, str]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.node_attributes or self.edge_added or
                    self.edge_removed or self.edge_modified)


def origins_for_changes(changes: ChangeSpec) -> List[str]:
    """Origins for downstream propagation.

    A node attribute change starts at that node. A changed dependency edge
    starts at its dependent endpoint (from), then follows reverse edges to
    consumers of that dependent.
    """
    origins = list(changes.node_attributes)
    for key in (changes.edge_added + changes.edge_removed +
                changes.edge_modified):
        endpoint = key[0]
        if endpoint not in origins:
            origins.append(endpoint)
    return origins


def analyze_impact(descriptor: Descriptor, graph: Graph,
                   origins: Optional[List[str]] = None) -> ImpactResult:
    """Compute all reachable downstream nodes and shortest paths."""
    if origins is None:
        # Structural inspection has no single origin. Declared nodes are
        # individually addressable; placeholders are exposed as boundaries.
        paths = {node: (node,)
                 for node in sorted(graph.nodes | graph.placeholders)}
        supplied_origins: Tuple[str, ...] = ()
    else:
        supplied_origins = tuple(origins)
        paths = bfs_shortest_paths(graph, list(supplied_origins))

    untrusted_reasons: Dict[str, List[str]] = {}

    for node_id, path in paths.items():
        reasons: List[str] = []
        path_set = set(path)
        if path_set & graph.cyclic_nodes:
            reasons.append("propagation path enters a dependency cycle")
        if path_set & graph.placeholders:
            reasons.append("propagation path reaches an undeclared node; "
                           "edges omitted from the descriptor cannot be known")
        if reasons:
            untrusted_reasons[node_id] = reasons

    impact_nodes: Dict[str, ImpactNode] = {}
    for node_id in sorted(paths):
        # Controls only alter presentation of a reachable node. BFS has
        # already run on the complete graph, so neither setting truncates
        # conclusions for other reachable nodes.
        if node_id in descriptor.excluded:
            state = "excluded"
        elif node_id in descriptor.locked:
            state = "locked"
        elif node_id in graph.placeholders:
            state = "undeclared"
        else:
            state = "affected"
        reasons = tuple(untrusted_reasons.get(node_id, []))
        impact_nodes[node_id] = ImpactNode(
            id=node_id,
            path=paths[node_id],
            untrusted=bool(reasons),
            reasons=reasons,
            state=state)

    affected = tuple(sorted(node.id for node in impact_nodes.values()
                            if node.state == "affected"))
    locked = tuple(sorted(node.id for node in impact_nodes.values()
                          if node.state == "locked"))
    excluded = tuple(sorted(node.id for node in impact_nodes.values()
                            if node.state == "excluded"))
    undeclared = tuple(sorted(node.id for node in impact_nodes.values()
                              if node.state == "undeclared"))
    untrusted = tuple(node_id for node_id, node in impact_nodes.items()
                      if node.untrusted)

    incomplete = bool(graph.placeholders or graph.cyclic_nodes)
    return ImpactResult(
        origins=supplied_origins,
        nodes=impact_nodes,
        affected=affected,
        locked=locked,
        excluded=excluded,
        untrusted=untrusted,
        undeclared=undeclared,
        incomplete=incomplete)
