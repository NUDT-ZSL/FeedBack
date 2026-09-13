"""Typed errors raised by the consensus core.

Every error carries a ``context`` dict so failures are debuggable during
deterministic replay — nothing is swallowed silently.
"""
from __future__ import annotations


class ConsensusError(Exception):
    """Base class for all consensus errors. Carries structured context."""

    def __init__(self, message: str, **context):
        self.context = context
        if context:
            ctx = ", ".join(f"{k}={v!r}" for k, v in sorted(context.items()))
            message = f"{message} [{ctx}]"
        super().__init__(message)


class StaleTermError(ConsensusError):
    """A message or request carried an outdated term."""


class NotLeaderError(ConsensusError):
    """propose() was called on a node that is not the leader."""


class LogHoleError(ConsensusError):
    """A log index points into a gap or a compacted region."""


class CommitIndexError(ConsensusError):
    """apply() was asked to apply beyond commit_index."""


class SnapshotIndexError(ConsensusError):
    """A snapshot index is stale, out of range, or has a mismatched term."""


class MessageRoutingError(ConsensusError):
    """deliver() received an envelope addressed to a different node."""
