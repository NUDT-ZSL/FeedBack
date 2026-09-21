"""Strict JSON parser for dependency descriptors."""

import json
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

from .errors import DescriptorParseError, ValidationIssue
from .models import Descriptor, Edge, Node


def load_descriptor(path: Path) -> Descriptor:
    text = Path(path).read_text(encoding="utf-8-sig")
    return parse_descriptor(text, source=str(path))


def parse_descriptor(text: str, source: str = "<descriptor>") -> Descriptor:
    if text.startswith("\ufeff"):
        text = text[1:]
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        location = f"{source}: line {exc.lineno}, column {exc.colno}"
        raise DescriptorParseError([ValidationIssue(location, exc.msg)]) from None
    return _validate(raw, source)


def _validate(raw: Any, source: str) -> Descriptor:
    issues: List[ValidationIssue] = []

    def error(location: str, message: str) -> None:
        prefix = f"{source}:{location}"
        issues.append(ValidationIssue(prefix, message))

    if not isinstance(raw, dict):
        error("/", "root value must be an object")
        raise DescriptorParseError(issues)

    allowed = {"version", "nodes", "edges", "controls"}
    for key in raw:
        if key not in allowed:
            error(f"/{key}", "unknown root field")

    version = raw.get("version", 1)
    if not isinstance(version, int) or isinstance(version, bool) or version != 1:
        error("/version", "must be the integer 1")

    nodes = _validate_nodes(raw, issues, source)
    edges = _validate_edges(raw, issues, file_source=source)
    locked, excluded = _validate_controls(raw, issues, source, set(nodes))
    if issues:
        raise DescriptorParseError(issues)
    return Descriptor(nodes=nodes, edges=edges, locked=locked, excluded=excluded)


def _valid_id(value: Any) -> bool:
    return isinstance(value, str) and value == value.strip() and value != ""


def _validate_attributes(value: Any, source: str, location: str,
                         issues: List[ValidationIssue]) -> bool:
    if not isinstance(value, dict):
        issues.append(ValidationIssue(f"{source}:{location}",
                                      "attributes must be an object"))
        return False
    for key in value:
        if not isinstance(key, str):
            issues.append(ValidationIssue(
                f"{source}:{location}/{key}",
                "attribute names must be strings"))
    return True


def _validate_nodes(raw: Dict[str, Any],
                    issues: List[ValidationIssue],
                    source: str) -> Dict[str, Node]:
    value = raw.get("nodes")
    location = "/nodes"
    if "nodes" not in raw:
        issues.append(ValidationIssue(f"{source}:{location}",
                                      "field is required"))
        return {}
    if not isinstance(value, list):
        issues.append(ValidationIssue(f"{source}:{location}",
                                      "must be an array"))
        return {}

    nodes: Dict[str, Node] = {}
    for index, item in enumerate(value):
        item_location = f"{location}[{index}]"
        if not isinstance(item, dict):
            issues.append(ValidationIssue(f"{source}:{item_location}",
                                          "node must be an object"))
            continue
        for key in item:
            if key not in {"id", "attributes"}:
                issues.append(ValidationIssue(
                    f"{source}:{item_location}/{key}",
                    "unknown node field"))
        node_id = item.get("id")
        if "id" not in item:
            issues.append(ValidationIssue(f"{source}:{item_location}/id",
                                          "field is required"))
        elif not _valid_id(node_id):
            issues.append(ValidationIssue(
                f"{source}:{item_location}/id",
                "must be a non-empty, non-blank string"))
        elif node_id in nodes:
            issues.append(ValidationIssue(
                f"{source}:{item_location}/id",
                f"duplicate node id {node_id!r}"))

        attributes: Dict[str, object] = {}
        if "attributes" in item and _validate_attributes(
                item["attributes"], source,
                f"{item_location}/attributes", issues):
            attributes = dict(item["attributes"])
        if _valid_id(node_id) and node_id not in nodes:
            nodes[node_id] = Node(node_id, attributes)
    return nodes


def _validate_edges(raw: Dict[str, Any],
                    issues: List[ValidationIssue],
                    file_source: str) -> List[Edge]:
    value = raw.get("edges")
    location = "/edges"
    if "edges" not in raw:
        issues.append(ValidationIssue(f"{file_source}:{location}",
                                      "field is required"))
        return []
    if not isinstance(value, list):
        issues.append(ValidationIssue(f"{file_source}:{location}",
                                      "must be an array"))
        return []

    edges: List[Edge] = []
    seen: Set[Tuple[str, str]] = set()
    for index, item in enumerate(value):
        item_location = f"{location}[{index}]"
        if not isinstance(item, dict):
            issues.append(ValidationIssue(f"{file_source}:{item_location}",
                                          "edge must be an object"))
            continue
        for key in item:
            if key not in {"from", "to", "attributes"}:
                issues.append(ValidationIssue(
                    f"{file_source}:{item_location}/{key}",
                    "unknown edge field"))

        source = item.get("from")
        target = item.get("to")
        endpoint_ok = True
        for endpoint, endpoint_value in (("from", source), ("to", target)):
            if endpoint not in item:
                issues.append(ValidationIssue(
                    f"{file_source}:{item_location}/{endpoint}",
                    "field is required"))
                endpoint_ok = False
            elif not _valid_id(endpoint_value):
                issues.append(ValidationIssue(
                    f"{file_source}:{item_location}/{endpoint}",
                    "must be a non-empty, non-blank string"))
                endpoint_ok = False

        attributes: Dict[str, object] = {}
        if "attributes" in item and _validate_attributes(
                item["attributes"], file_source,
                f"{item_location}/attributes", issues):
            attributes = dict(item["attributes"])

        if endpoint_ok:
            key = (source, target)
            if key in seen:
                issues.append(ValidationIssue(
                    f"{file_source}:{item_location}",
                    f"duplicate edge {source!r} -> {target!r}"))
            else:
                seen.add(key)
                edges.append(Edge(source, target, attributes))
    return edges


def _validate_controls(raw: Dict[str, Any], issues: List[ValidationIssue],
                       source: str,
                       node_ids: Set[str]) -> Tuple[Set[str], Set[str]]:
    controls = raw.get("controls", {})
    location = "/controls"
    if "controls" not in raw:
        return set(), set()
    if not isinstance(controls, dict):
        issues.append(ValidationIssue(f"{source}:{location}",
                                      "must be an object"))
        return set(), set()
    for key in controls:
        if key not in {"locked", "excluded"}:
            issues.append(ValidationIssue(f"{source}:{location}/{key}",
                                         "unknown control field"))

    result = {"locked": set(), "excluded": set()}
    for name in ("locked", "excluded"):
        values: Set[str] = set()
        if name in controls:
            field_location = f"{location}/{name}"
            raw_values = controls[name]
            if not isinstance(raw_values, list):
                issues.append(ValidationIssue(f"{source}:{field_location}",
                                              "must be an array"))
                continue
            for index, value in enumerate(raw_values):
                value_location = f"{field_location}[{index}]"
                if not _valid_id(value):
                    issues.append(ValidationIssue(
                        f"{source}:{value_location}",
                        "must be a non-empty, non-blank string"))
                    continue
                if value not in node_ids:
                    issues.append(ValidationIssue(
                        f"{source}:{value_location}",
                        f"unknown node id {value!r}"))
                values.add(value)
        result[name] = values

    overlap = result["locked"] & result["excluded"]
    for node_id in sorted(overlap):
        issues.append(ValidationIssue(
            f"{source}:{location}",
            f"node {node_id!r} cannot be both locked and excluded"))
    return result["locked"], result["excluded"]
