"""Priority-aware, isolation-safe relay link scheduler."""

from __future__ import annotations

from threading import RLock
from types import MappingProxyType

from .model import AllocationPlan, Channel, ChannelPlacement, ChannelStatus, Link


class RelayConnectionScheduler:
    """Maintain channel-to-link assignments as links and channels change.

    All public operations are serialized and return an immutable allocation
    snapshot. Recomputing from complete desired state on every change makes
    failure and recovery atomic: callers never observe mixed old/new ownership.
    """

    def __init__(self) -> None:
        self._lock = RLock()
        self._channels: dict[str, Channel] = {}
        self._links: dict[str, Link] = {}
        self._unavailable: set[str] = set()
        self._channel_seq = 0
        self._link_seq = 0
        self._version = 0
        self._plan = self._recompute()

    def register_channel(
        self,
        channel_id: str,
        *,
        priority: int,
        concurrency_limit: int,
        allow_sharing: bool,
    ) -> AllocationPlan:
        with self._lock:
            self._require_identifier(channel_id, "channel_id")
            if channel_id in self._channels:
                raise ValueError(f"channel {channel_id!r} is already registered")
            if not isinstance(priority, int) or isinstance(priority, bool) or priority < 0:
                raise ValueError("priority must be a non-negative integer")
            if (
                not isinstance(concurrency_limit, int)
                or isinstance(concurrency_limit, bool)
                or concurrency_limit < 1
            ):
                raise ValueError("concurrency_limit must be a positive integer")
            if not isinstance(allow_sharing, bool):
                raise ValueError("allow_sharing must be a boolean")
            self._channel_seq += 1
            self._channels[channel_id] = Channel(
                channel_id,
                priority,
                concurrency_limit,
                allow_sharing,
                self._channel_seq,
            )
            return self._recompute()

    def unregister_channel(self, channel_id: str) -> AllocationPlan:
        with self._lock:
            if channel_id not in self._channels:
                raise ValueError(f"unknown channel {channel_id!r}")
            del self._channels[channel_id]
            return self._recompute()

    def add_link(self, link_id: str, capacity: int | None = None) -> AllocationPlan:
        """Add a healthy link; ``None`` capacity means unlimited multiplexing."""
        with self._lock:
            self._require_identifier(link_id, "link_id")
            if link_id in self._links:
                raise ValueError(f"link {link_id!r} already exists")
            if capacity is not None and (
                not isinstance(capacity, int) or isinstance(capacity, bool) or capacity < 1
            ):
                raise ValueError("capacity must be None or a positive integer")
            self._links[link_id] = Link(link_id, capacity, self._link_seq)
            self._link_seq += 1
            self._unavailable.discard(link_id)
            return self._recompute()

    def link_failed(self, link_id: str) -> AllocationPlan:
        with self._lock:
            if link_id not in self._links:
                raise ValueError(f"unknown link {link_id!r}")
            if link_id not in self._unavailable:
                self._unavailable.add(link_id)
                return self._recompute()
            return self._plan

    def link_recovered(self, link_id: str) -> AllocationPlan:
        with self._lock:
            if link_id not in self._links:
                raise ValueError(f"unknown link {link_id!r}")
            if link_id in self._unavailable:
                self._unavailable.discard(link_id)
                return self._recompute()
            return self._plan

    @property
    def current_plan(self) -> AllocationPlan:
        with self._lock:
            return self._plan

    @staticmethod
    def _require_identifier(value: str, name: str) -> None:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{name} must be a non-empty string")

    def _recompute(self) -> AllocationPlan:
        channels = sorted(
            self._channels.values(),
            key=lambda channel: (-channel.priority, channel.registration_order, channel.id),
        )
        links = sorted(
            (link for link in self._links.values() if link.id not in self._unavailable),
            key=lambda link: (link.registration_order, link.id),
        )
        link_ids = [link.id for link in links]
        capacity = {
            link.id: float("inf") if link.capacity is None else float(link.capacity)
            for link in links
        }
        load: dict[str, dict[str, int]] = {link_id: {} for link_id in link_ids}
        remaining = dict(capacity)
        granted = {channel.id: 0 for channel in channels}
        rejected: dict[str, ChannelPlacement] = {}
        degraded_reason: dict[str, tuple[str, str]] = {}
        decisions: list[str] = []

        def take(channel: Channel, link_id: str, slots: int) -> int:
            available = remaining[link_id]
            used = slots if available == float("inf") else min(slots, int(available))
            if used <= 0:
                return 0
            load[link_id][channel.id] = load[link_id].get(channel.id, 0) + used
            remaining[link_id] -= used
            granted[channel.id] += used
            return used

        def choose(candidate_ids: list[str], need: int) -> str | None:
            """Best-fit finite links first, unlimited links next."""
            finite = [
                link_id
                for link_id in candidate_ids
                if capacity[link_id] != float("inf") and remaining[link_id] >= need
            ]
            finite.sort(key=lambda link_id: (remaining[link_id], link_ids.index(link_id)))
            if finite:
                return finite[0]
            infinite = [
                link_id for link_id in candidate_ids if capacity[link_id] == float("inf")
            ]
            if infinite:
                return infinite[0]
            partial = [link_id for link_id in candidate_ids if remaining[link_id] > 0]
            partial.sort(
                key=lambda link_id: (-remaining[link_id], link_ids.index(link_id))
            )
            return partial[0] if partial else None

        def occupied_summary(link_id: str) -> str:
            occupants = ", ".join(
                f"{channel_id}(priority={self._channels[channel_id].priority}):{slots}"
                for channel_id, slots in load[link_id].items()
            )
            free = (
                "unlimited"
                if remaining[link_id] == float("inf")
                else int(remaining[link_id])
            )
            return f"{link_id}(occupants={occupants}, free={free})"

        def baseline_rejection(channel: Channel) -> ChannelPlacement:
            occupied = [link_id for link_id in link_ids if load[link_id]]
            if not link_ids:
                code = "NO_AVAILABLE_LINKS"
                detail = "no healthy link is available"
            elif channel.allow_sharing:
                exclusive_links = [
                    link_id
                    for link_id in occupied
                    if any(not self._channels[c].allow_sharing for c in load[link_id])
                ]
                full_shared_links = [
                    link_id
                    for link_id in occupied
                    if link_id not in exclusive_links and remaining[link_id] <= 0
                ]
                details = []
                if exclusive_links:
                    details.append(
                        "reserved by non-sharable channels: "
                        + "; ".join(occupied_summary(link_id) for link_id in exclusive_links)
                    )
                if full_shared_links:
                    details.append(
                        "sharable but full: "
                        + "; ".join(
                            occupied_summary(link_id)
                            for link_id in full_shared_links
                        )
                    )
                incompatible = [
                    link_id
                    for link_id in occupied
                    if any(not self._channels[c].allow_sharing for c in load[link_id])
                ]
                if incompatible:
                    code = "ISOLATION_CONFLICT"
                    detail = "; ".join(details)
                else:
                    code = "INSUFFICIENT_CAPACITY"
                    detail = "; ".join(details)
            else:
                code = "ISOLATION_CONFLICT"
                detail = (
                    "an exclusive channel needs an unoccupied link, but all links "
                    "are occupied: "
                    + "; ".join(occupied_summary(link_id) for link_id in occupied)
                )
            reason = (
                f"priority {channel.priority} channel cannot be admitted because {detail}"
            )
            return ChannelPlacement(
                channel.id,
                ChannelStatus.REJECTED,
                channel.concurrency_limit,
                0,
                MappingProxyType({}),
                code,
                reason,
            )

        # Allocate in strict priority order. A higher-priority channel reaches
        # its full target before a lower-priority channel consumes a slot.
        # Partial grants remain active in degraded state; zero grants are
        # rejected with a concrete reason.
        for channel in channels:
            need = channel.concurrency_limit
            while need > 0:
                if channel.allow_sharing:
                    existing = [
                        link_id
                        for link_id in link_ids
                        if load[link_id]
                        and all(self._channels[c].allow_sharing for c in load[link_id])
                    ]
                    free = [link_id for link_id in link_ids if not load[link_id]]
                    selected = choose(existing, need) or choose(free, need)
                else:
                    existing = [
                        link_id
                        for link_id in link_ids
                        if set(load[link_id]) == {channel.id}
                    ]
                    free = [link_id for link_id in link_ids if not load[link_id]]
                selected = choose(existing, need) or choose(free, need)

                if selected is None:
                    if granted[channel.id] == 0:
                        placement = baseline_rejection(channel)
                        rejected[channel.id] = placement
                        decisions.append(f"reject {channel.id}: {placement.reason}")
                        break
                    if channel.allow_sharing:
                        detail = (
                            f"only {granted[channel.id]} of "
                            f"{channel.concurrency_limit} requested slots fit on "
                            f"{len(existing)} healthy compatible link(s)"
                        )
                    else:
                        detail = (
                            f"only {granted[channel.id]} of "
                            f"{channel.concurrency_limit} dedicated slots fit; "
                            "other links are occupied by channels that cannot share"
                        )
                    degraded_reason[channel.id] = ("INSUFFICIENT_LINK_CAPACITY", detail)
                    decisions.append(f"degrade {channel.id}: {detail}")
                    break

                used = take(channel, selected, need)
                if used == 0:
                    if granted[channel.id] == 0:
                        placement = baseline_rejection(channel)
                        rejected[channel.id] = placement
                        decisions.append(f"reject {channel.id}: {placement.reason}")
                        break
                    degraded_reason[channel.id] = (
                        "INSUFFICIENT_LINK_CAPACITY",
                        "no compatible link has remaining concurrency",
                    )
                    break
                need -= used
                mode = "shared link" if channel.allow_sharing else "dedicated link"
                if granted[channel.id] == used:
                    decisions.append(
                        f"admit {channel.id} at priority {channel.priority}: "
                        f"{used} slot(s) on {selected} ({mode})"
                    )
                else:
                    decisions.append(
                        f"expand {channel.id}: {used} additional slot(s) on {selected}"
                    )

        placements: dict[str, ChannelPlacement] = {}
        for channel in channels:
            if channel.id in rejected:
                placements[channel.id] = rejected[channel.id]
                continue
            allocations = {
                link_id: link_load[channel.id]
                for link_id, link_load in load.items()
                if channel.id in link_load
            }
            current = granted[channel.id]
            if current < channel.concurrency_limit:
                status = ChannelStatus.DEGRADED
                code, reason = degraded_reason.get(
                    channel.id,
                    (
                        "INSUFFICIENT_LINK_CAPACITY",
                        (
                            f"only {current} of {channel.concurrency_limit} requested "
                            "slots could be allocated"
                        ),
                    ),
                )
            else:
                status = ChannelStatus.FULL
                code, reason = "SATISFIED", "all requested concurrency slots are allocated"
            placements[channel.id] = ChannelPlacement(
                channel.id,
                status,
                channel.concurrency_limit,
                current,
                MappingProxyType(allocations),
                code,
                reason,
            )

        frozen_loads = {
            link_id: MappingProxyType(dict(link_load))
            for link_id, link_load in load.items()
        }
        for link_id in self._links:
            frozen_loads.setdefault(link_id, MappingProxyType({}))
        available = tuple(link_ids)
        unavailable = tuple(
            link.id
            for link in sorted(
                self._links.values(),
                key=lambda link: (link.registration_order, link.id),
            )
            if link.id in self._unavailable
        )
        self._validate(placements, frozen_loads, available)
        self._version += 1
        self._plan = AllocationPlan(
            self._version,
            MappingProxyType(placements),
            MappingProxyType(frozen_loads),
            available,
            unavailable,
            tuple(decisions),
        )
        return self._plan

    def _validate(
        self,
        placements: dict[str, ChannelPlacement],
        link_loads: dict[str, dict[str, int]],
        available: tuple[str, ...],
    ) -> None:
        """Fail loudly if the scheduler produced an inconsistent state."""
        for channel_id, placement in placements.items():
            channel = self._channels[channel_id]
            allocated = sum(placement.allocations.values())
            if allocated != placement.granted:
                raise RuntimeError(f"placement totals disagree for {channel_id}")
            if not (0 <= placement.granted <= channel.concurrency_limit):
                raise RuntimeError(f"allocation exceeds limit for {channel_id}")
            for link_id, slots in placement.allocations.items():
                if slots < 1 or link_id not in available:
                    raise RuntimeError(f"stale link assignment for {channel_id}")

        for link_id, link_load in link_loads.items():
            link = self._links[link_id]
            total = sum(link_load.values())
            if link.capacity is not None and total > link.capacity:
                raise RuntimeError(f"link {link_id} capacity exceeded")
            if any(slots < 1 for slots in link_load.values()):
                raise RuntimeError(f"invalid zero-slot load on {link_id}")
            if len(link_load) > 1:
                occupants = [self._channels[cid] for cid in link_load]
                if any(not channel.allow_sharing for channel in occupants):
                    raise RuntimeError(f"isolation violated on {link_id}")
