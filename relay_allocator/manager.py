"""Thread-safe manager that keeps allocations aligned with live topology."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from threading import RLock

from .model import AllocationPlan, Channel, ChannelState, Link, LinkState
from .scheduler import allocate


class EventType(str, Enum):
    """Change produced while reconciling a new allocation snapshot."""

    ACTIVATED = "activated"
    MIGRATED = "migrated"
    SUSPENDED = "suspended"
    RESTORED = "restored"
    UNREGISTERED = "unregistered"


@dataclass(frozen=True)
class AllocationEvent:
    """A channel-level transition emitted by an atomic reconciliation."""

    event_type: EventType
    channel_id: str
    old_link_id: str | None
    new_link_id: str | None
    reason: str
    version: int


def _copy_plan(plan: AllocationPlan) -> AllocationPlan:
    return AllocationPlan(
        assignments=dict(plan.assignments),
        rejections=dict(plan.rejections),
        link_usages=dict(plan.link_usages),
        channel_shareability=dict(plan.channel_shareability),
    )


class ConnectionRelay:
    """Register channels/links and atomically reconcile allocations.

    Every topology or declaration change recomputes the entire desired
    placement and then replaces the previous snapshot as one unit.  This makes
    link release, migration, admission and refusal mutually consistent.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._channels: dict[str, Channel] = {}
        self._links: dict[str, Link] = {}
        self._version = 0
        self._plan = AllocationPlan()

    @property
    def version(self) -> int:
        with self._lock:
            return self._version

    def snapshot(self) -> AllocationPlan:
        """Return an isolated copy of the current complete allocation."""
        with self._lock:
            return _copy_plan(self._plan)

    def register_channel(self, channel: Channel) -> list[AllocationEvent]:
        """Register a new business channel and reconcile."""
        with self._lock:
            if channel.channel_id in self._channels:
                raise ValueError(f"channel {channel.channel_id!r} already exists")
            self._channels[channel.channel_id] = channel
            return self._reconcile()

    def update_channel(self, channel: Channel) -> list[AllocationEvent]:
        """Replace an existing channel declaration and reconcile."""
        with self._lock:
            if channel.channel_id not in self._channels:
                raise KeyError(f"channel {channel.channel_id!r} does not exist")
            self._channels[channel.channel_id] = channel
            return self._reconcile()

    def unregister_channel(self, channel_id: str) -> list[AllocationEvent]:
        """Remove a channel, releasing all of its reserved capacity."""
        with self._lock:
            old_assignment = self._plan.assignments.get(channel_id)
            del self._channels[channel_id]
            events = self._reconcile()
            if old_assignment is not None:
                events.append(
                    AllocationEvent(
                        event_type=EventType.UNREGISTERED,
                        channel_id=channel_id,
                        old_link_id=old_assignment.link_id,
                        new_link_id=None,
                        reason="channel registration removed",
                        version=self._version,
                    )
                )
            return events

    def add_link(self, link: Link) -> list[AllocationEvent]:
        """Add a physical connection and reconcile current channels."""
        with self._lock:
            if link.link_id in self._links:
                raise ValueError(f"link {link.link_id!r} already exists")
            self._links[link.link_id] = link
            return self._reconcile()

    def remove_link(self, link_id: str) -> list[AllocationEvent]:
        """Remove a connection record and relocate its channels."""
        with self._lock:
            del self._links[link_id]
            return self._reconcile()

    def mark_link_down(self, link_id: str) -> list[AllocationEvent]:
        """Mark a failed link unavailable and relocate its channels."""
        with self._lock:
            link = self._links[link_id]
            self._links[link_id] = Link(
                link_id=link.link_id,
                capacity=link.capacity,
                state=LinkState.DOWN,
            )
            return self._reconcile(failed_link_id=link_id)

    def mark_link_up(self, link_id: str) -> list[AllocationEvent]:
        """Recover a link and re-evaluate suspended or displaced channels."""
        with self._lock:
            link = self._links[link_id]
            self._links[link_id] = Link(
                link_id=link.link_id,
                capacity=link.capacity,
                state=LinkState.UP,
            )
            return self._reconcile(recovered_link_id=link_id)

    recover_link = mark_link_up

    def link_state(self, link_id: str) -> LinkState:
        with self._lock:
            return self._links[link_id].state

    def channel_state(self, channel_id: str) -> ChannelState:
        with self._lock:
            if channel_id in self._plan.assignments:
                return ChannelState.ACTIVE
            if channel_id in self._plan.rejections:
                return ChannelState.SUSPENDED
            raise KeyError(f"channel {channel_id!r} does not exist")

    def _reconcile(
        self,
        *,
        failed_link_id: str | None = None,
        recovered_link_id: str | None = None,
    ) -> list[AllocationEvent]:
        previous = self._plan
        current_assignments = {
            channel_id: assignment.link_id
            for channel_id, assignment in previous.assignments.items()
        }
        next_plan = allocate(
            self._channels.values(),
            self._links.values(),
            current_assignments=current_assignments,
        )
        self._version += 1
        self._plan = next_plan
        return self._diff(previous, next_plan, failed_link_id, recovered_link_id)

    def _diff(
        self,
        previous: AllocationPlan,
        current: AllocationPlan,
        failed_link_id: str | None,
        recovered_link_id: str | None,
    ) -> list[AllocationEvent]:
        channel_ids = sorted(
            set(previous.assignments)
            | set(current.assignments)
            | set(previous.rejections)
            | set(current.rejections)
        )
        events: list[AllocationEvent] = []

        for channel_id in channel_ids:
            old = previous.assignments.get(channel_id)
            new = current.assignments.get(channel_id)
            rejection = current.rejections.get(channel_id)

            if old is not None and new is not None:
                if old.link_id != new.link_id:
                    if failed_link_id and old.link_id == failed_link_id:
                        reason = f"link {failed_link_id} failed"
                    else:
                        reason = "allocation reconciled after topology or policy change"
                    events.append(
                        AllocationEvent(
                            EventType.MIGRATED,
                            channel_id,
                            old.link_id,
                            new.link_id,
                            reason,
                            self._version,
                        )
                    )
                continue

            if old is not None and new is None and rejection is not None:
                reason = rejection.explanation
                if failed_link_id:
                    reason = (
                        f"link {failed_link_id} failed and no remaining link "
                        f"satisfies constraints: {reason}"
                    )
                events.append(
                    AllocationEvent(
                        EventType.SUSPENDED,
                        channel_id,
                        old.link_id,
                        None,
                        reason,
                        self._version,
                    )
                )
                continue

            if old is None and new is not None:
                was_rejected = channel_id in previous.rejections
                event_type = (
                    EventType.RESTORED if was_rejected or recovered_link_id
                    else EventType.ACTIVATED
                )
                if recovered_link_id:
                    reason = f"link {recovered_link_id} recovered"
                elif was_rejected:
                    reason = "capacity became available after reconciliation"
                else:
                    reason = "channel admitted according to current allocation"
                events.append(
                    AllocationEvent(
                        event_type,
                        channel_id,
                        None,
                        new.link_id,
                        reason,
                        self._version,
                    )
                )
                continue

            if old is None and new is None and rejection is not None:
                events.append(
                    AllocationEvent(
                        EventType.SUSPENDED,
                        channel_id,
                        None,
                        None,
                        rejection.explanation,
                        self._version,
                    )
                )

        return events
