"""Wire messages exchanged between nodes.

Everything is an immutable dataclass — messages are pure data. Nodes never
send anything themselves; they place ``Envelope`` objects in their outbox
and the test harness (or user code) delivers them explicitly.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Tuple

from .log import LogEntry


@dataclass(frozen=True)
class Envelope:
    frm: Any
    to: Any
    payload: Any


@dataclass(frozen=True)
class RequestVote:
    candidate_id: Any
    term: int
    last_log_index: int
    last_log_term: int
    pre_vote: bool = False


@dataclass(frozen=True)
class RequestVoteReply:
    voter_id: Any
    term: int        # voter's current term (so stale candidates step down)
    vote_term: int   # the term the vote refers to (echo of the request)
    granted: bool
    pre_vote: bool = False


@dataclass(frozen=True)
class AppendEntries:
    leader_id: Any
    term: int
    prev_log_index: int
    prev_log_term: int
    entries: Tuple[LogEntry, ...]
    leader_commit: int


@dataclass(frozen=True)
class AppendEntriesReply:
    follower_id: Any
    term: int
    success: bool
    match_index: int
    # Fast-backtrack hints when success=False:
    # conflict_term = term of the conflicting entry (None = follower's log too short)
    # conflict_index = first index of conflict_term, or last_index + 1
    conflict_index: int = 0
    conflict_term: Optional[int] = None


@dataclass(frozen=True)
class InstallSnapshot:
    leader_id: Any
    term: int
    last_included_index: int
    last_included_term: int
    data: Any


@dataclass(frozen=True)
class InstallSnapshotReply:
    follower_id: Any
    term: int
    success: bool
    match_index: int  # follower's base_index after handling
