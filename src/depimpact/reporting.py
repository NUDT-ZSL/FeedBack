"""JSON and human-readable output rendering."""

from typing import Any, Dict, List

from .diffing import DescriptorDiff
from .graph import Graph
from .models import Descriptor
from .propagation import ImpactResult


def graph_payload(graph: Graph) -> Dict[str, Any]:
    return {
        "nodes": [
            {"id": node_id, "attributes": graph.attributes.get(node_id, {})}
            for node_id in sorted(graph.nodes)],
        "undeclared_nodes": sorted(graph.placeholders),
        "direct_dependencies": {
            key: value
            for key, value in sorted(graph.direct_dependencies.items())
            if key in graph.nodes},
        "reverse_dependencies": {
            key: value
            for key, value in sorted(graph.dependents.items())
            if key in graph.nodes},
        "structural_issues": [
            {
                "kind": issue.kind,
                "severity": issue.severity,
                "message": issue.message,
                "source": issue.source,
                "target": issue.target,
                "path": list(issue.path),
            }
            for issue in graph.issues],
    }


def impact_payload(result: ImpactResult) -> Dict[str, Any]:
    return {
        "origins": list(result.origins),
        "affected": list(result.affected),
        "locked": list(result.locked),
        "excluded": list(result.excluded),
        "undeclared": list(result.undeclared),
        "untrusted": list(result.untrusted),
        "incomplete": result.incomplete,
        "paths": [
            {
                "node": node.id,
                "state": node.state,
                "path": list(node.path),
                "untrusted": node.untrusted,
                "reasons": list(node.reasons),
            }
            for _node_id, node in sorted(result.nodes.items())],
    }


def diff_payload(diff: DescriptorDiff) -> Dict[str, Any]:
    return {
        "old_structure": graph_payload(diff.old_graph),
        "new_structure": graph_payload(diff.new_graph),
        "edge_changes": [
            {
                "kind": change.kind,
                "from": change.source,
                "to": change.target,
                "downstream_impact":
                    None if change.impact is None
                    else impact_payload(change.impact),
            }
            for change in diff.edge_changes],
        "node_changes": [
            {
                "kind": change.kind,
                "node": change.node_id,
                "details": [
                    {"attribute": name, "old": old, "new": new}
                    for name, old, new in change.details],
                "downstream_impact":
                    None if change.impact is None
                    else impact_payload(change.impact),
            }
            for change in diff.node_changes],
    }


def render_graph_text(graph: Graph, descriptor: Descriptor) -> str:
    lines = ["Nodes:"]
    for node_id in sorted(graph.nodes):
        markers = []
        if node_id in descriptor.locked:
            markers.append("locked")
        if node_id in descriptor.excluded:
            markers.append("excluded")
        suffix = f" [{', '.join(markers)}]" if markers else ""
        deps = ", ".join(graph.direct_dependencies[node_id]) or "-"
        rdeps = ", ".join(graph.dependents[node_id]) or "-"
        attributes = graph.attributes.get(node_id, {})
        lines.append(f"  {node_id}{suffix}")
        if attributes:
            lines.append(f"    attributes: {attributes}")
        lines.append(f"    depends on: {deps}")
        lines.append(f"    depended by: {rdeps}")
    _append_structure(lines, graph)
    return "\n".join(lines)


def render_impact_text(result: ImpactResult) -> str:
    if result.origins:
        lines = ["Origins: " + ", ".join(result.origins)]
    else:
        lines = ["Structural inspection (no change origin specified)"]
    lines.append("Affected: " + _format_list(result.affected))
    lines.append("Locked (still traversed): " + _format_list(result.locked))
    lines.append("Excluded (hidden from affected): " +
                 _format_list(result.excluded))
    lines.append("Undeclared trust boundaries: " +
                 _format_list(result.undeclared))
    lines.append("Untrusted conclusions: " + _format_list(result.untrusted))
    lines.append(f"Incomplete model: {'yes' if result.incomplete else 'no'}")
    lines.append("Paths:")
    for node_id, node in sorted(result.nodes.items()):
        marker = node.state.upper()
        trust = " [UNTRUSTED: " + "; ".join(node.reasons) + "]" \
            if node.reasons else ""
        lines.append(f"  {node_id} ({marker}): {' -> '.join(node.path)}"
                     f"{trust}")
    return "\n".join(lines)


def render_diff_text(diff: DescriptorDiff) -> str:
    lines = ["Dependency edge changes:"]
    if not diff.edge_changes:
        lines.append("  none")
    for change in diff.edge_changes:
        lines.append(f"  {change.kind.upper()}: {change.source} -> "
                     f"{change.target}")
        _append_change_impact(lines, change.impact)
    lines.append("Node changes:")
    if not diff.node_changes:
        lines.append("  none")
    for change in diff.node_changes:
        lines.append(f"  {change.kind.upper()}: {change.node_id}")
        for name, old, new in change.details:
            lines.append(f"    {name}: {old} -> {new}")
        _append_change_impact(lines, change.impact)
    _append_structure(lines, diff.new_graph, "New structural issues: ")
    return "\n".join(lines)


def _append_change_impact(lines: List[str], result: ImpactResult) -> None:
    if result is None:
        lines.append("    downstream impact: UNKNOWN for declared nodes "
                     "(structural issue)")
        return
    lines.append("    affected: " + _format_list(result.affected))
    if result.locked:
        lines.append("    locked: " + _format_list(result.locked))
    if result.excluded:
        lines.append("    excluded: " + _format_list(result.excluded))
    if result.undeclared:
        lines.append("    undeclared: " + _format_list(result.undeclared))
    if result.untrusted:
        lines.append("    untrusted: " + _format_list(result.untrusted))


def _append_structure(lines: List[str], graph: Graph,
                      title: str = "Structural issues: ") -> None:
    if graph.placeholders:
        lines.append("Undeclared nodes: " +
                     _format_list(sorted(graph.placeholders)))
    lines.append(title + ("none" if not graph.issues else ""))
    for issue in graph.issues:
        lines.append(f"  [{issue.kind}] {issue.message}")


def _format_list(values) -> str:
    return ", ".join(values) if values else "-"
