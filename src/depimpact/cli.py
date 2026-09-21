"""Command line interface for offline dependency impact analysis."""

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

from .diffing import compare_descriptors
from .errors import DescriptorParseError
from .graph import build_graph
from .parser import load_descriptor
from .propagation import ChangeSpec, analyze_impact, origins_for_changes
from .reporting import (diff_payload, graph_payload, impact_payload,
                        render_diff_text, render_graph_text,
                        render_impact_text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="depimpact",
        description="Analyze dependency graph changes and trust boundaries.")
    parser.add_argument("--json", action="store_true",
                        help="emit machine-readable JSON")
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect = subparsers.add_parser(
        "inspect", help="show nodes, dependencies, reverse dependencies")
    inspect.add_argument("descriptor", type=Path)

    propagate = subparsers.add_parser(
        "propagate", help="propagate one or more node/edge changes")
    propagate.add_argument("descriptor", type=Path)
    propagate.add_argument("--node", action="append", default=[],
                           dest="nodes", help="changed node id; repeatable")
    propagate.add_argument("--edge-added", action="append", default=[])
    propagate.add_argument("--edge-removed", action="append", default=[])
    propagate.add_argument("--edge-modified", action="append", default=[])

    diff = subparsers.add_parser(
        "diff", help="compare two complete dependency descriptors")
    diff.add_argument("old_descriptor", type=Path)
    diff.add_argument("new_descriptor", type=Path)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "inspect":
            return _run_inspect(args)
        if args.command == "propagate":
            return _run_propagate(args)
        return _run_diff(args)
    except DescriptorParseError as exc:
        _print_errors(exc)
        return 2
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def _run_inspect(args: argparse.Namespace) -> int:
    descriptor = load_descriptor(args.descriptor)
    graph = build_graph(descriptor)
    if args.json:
        print(json.dumps(graph_payload(graph), ensure_ascii=False, indent=2))
    else:
        print(render_graph_text(graph, descriptor))
    return 0


def _run_propagate(args: argparse.Namespace) -> int:
    descriptor = load_descriptor(args.descriptor)
    graph = build_graph(descriptor)
    changes = ChangeSpec(
        node_attributes=args.nodes,
        edge_added=[_parse_edge(value) for value in args.edge_added],
        edge_removed=[_parse_edge(value) for value in args.edge_removed],
        edge_modified=[_parse_edge(value) for value in args.edge_modified])
    _validate_change_targets(changes, graph)
    origins = origins_for_changes(changes)
    result = analyze_impact(descriptor, graph, origins)
    if args.json:
        print(json.dumps({"structure": graph_payload(graph),
                          "impact": impact_payload(result)},
                         ensure_ascii=False, indent=2))
    else:
        print(render_graph_text(graph, descriptor))
        print()
        print(render_impact_text(result))
    return 0


def _run_diff(args: argparse.Namespace) -> int:
    old = load_descriptor(args.old_descriptor)
    new = load_descriptor(args.new_descriptor)
    diff = compare_descriptors(old, new)
    if args.json:
        print(json.dumps(diff_payload(diff), ensure_ascii=False, indent=2))
    else:
        print(render_diff_text(diff))
    return 0


def _parse_edge(value: str) -> Tuple[str, str]:
    parts = [part.strip() for part in value.split("->", 1)]
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"edge {value!r} must use FROM->TO form")
    return parts[0], parts[1]


def _validate_change_targets(changes: ChangeSpec, graph) -> None:
    errors: List[str] = []
    for node_id in changes.node_attributes:
        if node_id not in graph.nodes and node_id not in graph.placeholders:
            errors.append(f"changed node {node_id!r} is neither declared nor "
                          "referenced by an edge")
    for label, keys in (("added", changes.edge_added),
                        ("removed", changes.edge_removed),
                        ("modified", changes.edge_modified)):
        for key in keys:
            edge_text = f"{key[0]} -> {key[1]}"
            if label == "removed" and key not in graph.edge_by_key:
                errors.append(f"removed edge {edge_text!r} does not exist")
            if label == "modified" and key not in graph.edge_by_key:
                errors.append(f"modified edge {edge_text!r} does not exist")
            if label == "added" and key in graph.edge_by_key:
                errors.append(f"added edge {edge_text!r} already exists")
            if label in {"added", "modified"} and key[1] not in (
                    graph.nodes | graph.placeholders):
                errors.append(
                    f"{label} edge {edge_text!r} has an unknown target; "
                    "add the target to the descriptor first")
    if errors:
        raise ValueError("; ".join(errors))


def _print_errors(exc: DescriptorParseError) -> None:
    print("Invalid dependency descriptor; no propagation result was produced:",
          file=sys.stderr)
    for issue in exc.issues:
        print(f"  - {issue}", file=sys.stderr)
