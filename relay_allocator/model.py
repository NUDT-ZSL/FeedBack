"""Domain types for channel-to-uplink allocation.

Each channel is placed on at most one live uplink.  ``concurrency_limit``
represents the number of simultaneous channel streams that must be admitted
without queuing or silent drops.  The scheduler reserves that worst-case share
of a multiplexed uplink's stream capacity.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping


class ChannelState(str, Enum):
    """Lifecycle state visible to a registered business channel."""

    ACTIVE = "active"
    SUSPENDED = "suspended"


class LinkState(str, Enum):
    """Lifecycle state of a physical center-facing connection."""

    UP = "up"
    DOWN = "down"


class RejectionReason(str, Enum):
    """Stable, machine-readable reason codes for refused service."""

    NO_LINKS = "no_links"
    CHANNEL_EXCEEDS_LINK_CAPACITY = "channel_exceeds_link_capacity"
    NO_EXCLUSIVE_LINK = "no_exclusive_link"
    INSUFFICIENT_SHARED_CAPACITY = "insufficient_shared_capacity"


@dataclass(frozen=True)
class Channel:
    """A business channel requesting backhaul service.

    Args:
        channel_id: Unique stable channel name.
        priority: Larger numbers are more important and are admitted first.
        concurrency_limit: Worst-case simultaneous streams to reserve.
        shareable: Whether the channel may share a multiplexed link.
    """

    channel_id: str
    priority: int
    concurrency_limit: int
    shareable: bool

    def __post_init__(self) -> None:
        if not str(self.channel_id).strip():
            raise ValueError("channel_id must not be empty")
        if isinstance(self.priority, bool) or not isinstance(self.priority, int) or self.priority < 0:
            raise ValueError("priority must be a non-negative integer")
        if (
            isinstance(self.concurrency_limit, bool)
            or not isinstance(self.concurrency_limit, int)
            or self.concurrency_limit <= 0
        ):
            raise ValueError("concurrency_limit must be a positive integer")
        if not isinstance(self.shareable, bool):
            raise ValueError("shareable must be a boolean")


@dataclass(frozen=True)
class Link:
    """A physical long connection and its multiplexing capacity."""

    link_id: str
    capacity: int
    state: LinkState = LinkState.UP

    def __post_init__(self) -> None:
        if not str(self.link_id).strip():
            raise ValueError("link_id must not be empty")
        if isinstance(self.capacity, bool) or not isinstance(self.capacity, int) or self.capacity <= 0:
            raise ValueError("capacity must be a positive integer")
        if not isinstance(self.state, LinkState):
            raise ValueError("state must be a LinkState")


@dataclass(frozen=True)
class LinkUsage:
    """Capacity consumed and channels hosted on one link."""

    link_id: str
    capacity: int
    reserved: int = 0
    channel_ids: tuple[str, ...] = ()

    @property
    def available(self) -> int:
        return self.capacity - self.reserved

    @property
    def is_exclusive(self) -> bool:
        return len(self.channel_ids) == 1


@dataclass(frozen=True)
class Assignment:
    """An admitted placement and a human-readable decision explanation."""

    channel_id: str
    link_id: str
    reserved: int
    state: ChannelState
    explanation: str


@dataclass(frozen=True)
class Rejection:
    """A refused placement with an explicit reason."""

    channel_id: str
    reason: RejectionReason
    explanation: str


@dataclass(frozen=True)
class AllocationPlan:
    """A complete, self-consistent allocation snapshot."""

    assignments: Mapping[str, Assignment] = field(default_factory=dict)
    rejections: Mapping[str, Rejection] = field(default_factory=dict)
    link_usages: Mapping[str, LinkUsage] = field(default_factory=dict)
    channel_shareability: Mapping[str, bool] = field(default_factory=dict, repr=False, compare=False)

    def active_channels(self) -> tuple[str, ...]:
        return tuple(
            channel_id
            for channel_id, assignment in self.assignments.items()
            if assignment.state is ChannelState.ACTIVE
        )

    def validate(self) -> None:
        """Raise AssertionError if an invariant has been violated."""
        hosted: dict[str, list[str]] = {}
        for assignment in self.assignments.values():
            hosted.setdefault(assignment.link_id, []).append(
                assignment.channel_id
            )

        for link_id, channel_ids in hosted.items():
            assert link_id in self.link_usages, f"missing usage for {link_id}"
            usage = self.link_usages[link_id]
            assert tuple(usage.channel_ids) == tuple(channel_ids)
            assert usage.reserved <= usage.capacity

            if len(channel_ids) > 1:
                assert all(
                    self.channel_shareability[channel_id]
                    for channel_id in channel_ids
                ), f"non-shareable channel shares link {link_id}"
            elif channel_ids:
                # An isolated reservation on otherwise spare capacity is valid.
                assert len(channel_ids) == 1

        for channel_id, assignment in self.assignments.items():
            usage = self.link_usages[assignment.link_id]
            assert assignment.reserved > 0
            assert channel_id in set(usage.channel_ids)

        assert self.assignments.keys().isdisjoint(self.rejections)
