"""Core data types for dependency descriptors."""

from dataclasses import dataclass, field
from typing import Dict, List, Set, Tuple


@dataclass(frozen=True)
class Node:
    id: str
    attributes: Dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class Edge:
    source: str
    target: str
    attributes: Dict[str, object] = field(default_factory=dict)

    @property
    def key(self) -> Tuple[str, str]:
        return (self.source, self.target)


@dataclass(frozen=True)
class Descriptor:
    nodes: Dict[str, Node]
    edges: List[Edge]
    locked: Set[str]
    excluded: Set[str]

