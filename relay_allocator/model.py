"""Domain objects and allocation snapshots."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping


class ChannelStatus(str, Enum):
    """The channel has its full target, a partial target, or no capacity."""

    FULL = "full"
    DEGRADED = "degraded"
    REJECTED = "rejected"


@dataclass(frozen=True)
class Channel:
    """A business channel's scheduling requirements.

    ``priority`` uses larger numbers for higher priority. ``concurrency_limit``
    is the number of multiplexed transmission slots the channel wants.
    ``allow_sharing=False`` requires every link it uses to carry no other
    channel.
    """

    id: str
    priority: int
    concurrency_limit: int
    allow_sharing: bool
    registration_order: int


@dataclass(frozen=True)
class Link:
    """A long-lived upstream connection.

    Capacity is the number of concurrent transmission slots on the link.
    ``None`` means the link has no scheduler-enforced multiplexing limit.
    """

    id: str
    capacity: int | None = None
    registration_order: int = 0


@dataclass(frozen=True)
class ChannelPlacement:
    """The scheduler's decision for one channel."""

    channel_id: str
    status: ChannelStatus
    requested: int
    granted: int
    allocations: Mapping[str, int]
    reason_code: str
    reason: str

    @property
    def active(self) -> bool:
        return self.status is not ChannelStatus.REJECTED


@dataclass(frozen=True)
class AllocationPlan:
    """An immutable-at-the-boundary view of the current assignment."""

    version: int
    placements: Mapping[str, ChannelPlacement]
    link_loads: Mapping[str, Mapping[str, int]]
    available_links: tuple[str, ...]
    unavailable_links: tuple[str, ...]
    decisions: tuple[str, ...]

    def placement(self, channel_id: str) -> ChannelPlacement:
        return self.placements[channel_id]

    @property
    def rejected_channels(self) -> tuple[ChannelPlacement, ...]:
        return tuple(
            p
            for p in self.placements.values()
            if p.status is ChannelStatus.REJECTED
        )

    @property
    def degraded_channels(self) -> tuple[ChannelPlacement, ...]:
        return tuple(
            p
            for p in self.placements.values()
            if p.status is ChannelStatus.DEGRADED
        )
