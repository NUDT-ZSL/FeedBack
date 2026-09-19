"""Data models for feedback, clusters and merge evidence."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict


def new_id(prefix: str) -> str:
    return "%s_%s" % (prefix, uuid.uuid4().hex[:12])


@dataclass
class Feedback:
    id: str
    source: str
    timestamp: float
    text: str
    tags: list = field(default_factory=list)

    @staticmethod
    def create(source: str, text: str, tags=None, timestamp=None) -> "Feedback":
        return Feedback(
            id=new_id("fb"),
            source=source or "unknown",
            timestamp=float(timestamp if timestamp is not None else time.time()),
            text=text or "",
            tags=list(tags or []),
        )

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict) -> "Feedback":
        return Feedback(
            id=d["id"],
            source=d.get("source", "unknown"),
            timestamp=float(d.get("timestamp", 0.0)),
            text=d.get("text", ""),
            tags=list(d.get("tags", [])),
        )


@dataclass
class Evidence:
    """Why two pieces of feedback were (or were not) merged."""

    a: str
    b: str
    similarity: float
    decision: str  # "merged" | "kept_separate"
    reason: str    # "auto" | "must_link" | "cannot_link" | "below_threshold"
    shared_terms: list = field(default_factory=list)
    borderline: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Cluster:
    id: str
    member_ids: list
    label: str = ""
    representative_id: str = ""
    top_terms: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
