"""Exact, deterministic channel placement for a small set of uplinks."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from .model import (
    AllocationPlan,
    Assignment,
    Channel,
    ChannelState,
    Link,
    LinkUsage,
    Rejection,
    RejectionReason,
)


def _reject(channel: Channel, reason: RejectionReason, why: str) -> Rejection:
    return Rejection(channel.channel_id, reason, why)


def allocate(
    channels: Iterable[Channel],
    links: Iterable[Link],
    current_assignments: Mapping[str, str] | None = None,
) -> AllocationPlan:
    """Admit channels in priority order using backtracking.

    Each channel is required until explicitly refused.  That means failure to
    fit in a provisional packing first triggers rearrangement of higher-priority
    channels; refusal occurs only when no such arrangement exists.
    """

    ordered = sorted(
        channels,
        key=lambda c: (-c.priority, c.shareable, -c.concurrency_limit, c.channel_id),
    )
    live = sorted(
        (link for link in links if link.state.value == "up"),
        key=lambda link: link.link_id,
    )
    if len({c.channel_id for c in ordered}) != len(ordered):
        raise ValueError("channel IDs must be unique")
    if len({link.link_id for link in live}) != len(live):
        raise ValueError("link IDs must be unique")

    if not live:
        return AllocationPlan(
            assignments={},
            rejections={
                c.channel_id: _reject(c, RejectionReason.NO_LINKS, "no live link is available")
                for c in ordered
            },
            link_usages={},
        )

    ids = tuple(link.link_id for link in live)
    caps = tuple(link.capacity for link in live)
    largest = max(caps)
    affinity = dict(current_assignments or {})
    empty_reserved = tuple(0 for _ in live)
    empty_flags = tuple(False for _ in live)

    def fits(
        channel: Channel,
        index: int,
        reserved: tuple[int, ...],
        occupied: tuple[bool, ...],
        isolated: tuple[bool, ...],
    ) -> bool:
        capacity_ok = reserved[index] + channel.concurrency_limit <= caps[index]
        isolation_ok = channel.shareable and not isolated[index]
        exclusive_ok = not channel.shareable and not occupied[index]
        return capacity_ok and (isolation_ok or exclusive_ok)

    def candidates(
        channel: Channel,
        reserved: tuple[int, ...],
        occupied: tuple[bool, ...],
        isolated: tuple[bool, ...],
    ) -> list[int]:
        options = []
        for index, link_id in enumerate(ids):
            if fits(channel, index, reserved, occupied, isolated):
                options.append(
                    (
                        affinity.get(channel.channel_id) != link_id,
                        caps[index] - reserved[index] - channel.concurrency_limit,
                        index,
                    )
                )
        return [index for _, _, index in sorted(options)]

    nodes = 0
    search_budget = 50_000
    memo: dict[tuple[int, int, tuple[int, ...], tuple[bool, ...], frozenset[str]], bool] = {}
    parent: dict[tuple[int, int, tuple[int, ...], tuple[bool, ...], frozenset[str]], int] = {}

    def greedy_placements(
        refused: frozenset[str],
        required_until: int = -1,
    ) -> tuple[tuple[str, int], ...] | None:
        reserved = list(empty_reserved)
        occupied = list(empty_flags)
        isolated = list(empty_flags)
        placements = []

        for position, current in enumerate(ordered):
            if current.channel_id in refused or current.concurrency_limit > largest:
                continue
            options = candidates(
                current,
                tuple(reserved),
                tuple(occupied),
                tuple(isolated),
            )
            if not options and position <= required_until:
                return None
            if not options:
                continue
            index = options[0]
            reserved[index] += current.concurrency_limit
            occupied[index] = True
            isolated[index] = not current.shareable
            placements.append((current.channel_id, index))
        return tuple(placements)

    def can_place(
        position: int,
        required_until: int,
        refused: frozenset[str],
        reserved: tuple[int, ...],
        occupied: tuple[bool, ...],
        isolated: tuple[bool, ...],
    ) -> bool:
        nonlocal nodes
        key = (position, required_until, reserved, isolated, refused)
        if key in memo:
            return memo[key]
        nodes += 1
        if nodes > search_budget:
            memo[key] = False
            return False
        if position > required_until:
            memo[key] = True
            return True

        current = ordered[position]
        if current.channel_id in refused or current.concurrency_limit > largest:
            parent[key] = -1
            result = can_place(
                position + 1,
                required_until,
                refused,
                reserved,
                occupied,
                isolated,
            )
            memo[key] = result
            return result

        options = candidates(current, reserved, occupied, isolated)
        if not options:
            memo[key] = False
            return False

        for index in options:
            next_reserved = list(reserved)
            next_occupied = list(occupied)
            next_isolated = list(isolated)
            next_reserved[index] += current.concurrency_limit
            next_occupied[index] = True
            next_isolated[index] = not current.shareable
            parent[key] = index
            if can_place(
                position + 1,
                required_until,
                refused,
                tuple(next_reserved),
                tuple(next_occupied),
                tuple(next_isolated),
            ):
                memo[key] = True
                return True

        parent.pop(key, None)
        memo[key] = False
        return False

    def reconstruct(
        required_until: int,
        refused: frozenset[str],
    ) -> tuple[tuple[str, int], ...]:
        reserved = list(empty_reserved)
        occupied = list(empty_flags)
        isolated = list(empty_flags)
        placements = []

        for position in range(required_until + 1):
            current = ordered[position]
            if current.channel_id in refused or current.concurrency_limit > largest:
                continue
            key = (
                position,
                required_until,
                tuple(reserved),
                tuple(isolated),
                refused,
            )
            index = parent[key]
            reserved[index] += current.concurrency_limit
            occupied[index] = True
            isolated[index] = not current.shareable
            placements.append((current.channel_id, index))
        return tuple(placements)

    refused: set[str] = {
        channel.channel_id
        for channel in ordered
        if channel.concurrency_limit > largest
    }
    required_placements: tuple[tuple[str, int], ...] = ()
    used_fallback = False

    for required_until, channel in enumerate(ordered):
        if channel.channel_id in refused:
            continue
        search_refused = frozenset(
            set(refused)
            | {
                candidate.channel_id
                for position, candidate in enumerate(ordered)
                if position > required_until
            }
        )
        result = None
        possible = False
        if nodes <= search_budget:
            possible = can_place(
                0,
                required_until,
                search_refused,
                empty_reserved,
                empty_flags,
                empty_flags,
            )

        if not possible and nodes > search_budget:
            prefix_greedy = greedy_placements(
                search_refused, required_until=required_until
            )
            if prefix_greedy is None:
                refused.add(channel.channel_id)
                continue
            required_placements = greedy_placements(frozenset(refused)) or ()
            used_fallback = True
            break
        elif not possible:
            refused.add(channel.channel_id)
        else:
            required_placements = reconstruct(required_until, search_refused)

    placements = required_placements

    chosen = dict(placements)
    final_reserved = [0] * len(live)
    final_hosted: list[tuple[str, ...]] = [() for _ in live]
    for channel in ordered:
        index = chosen.get(channel.channel_id)
        if index is None:
            continue
        final_reserved[index] += channel.concurrency_limit
        final_hosted[index] = (*final_hosted[index], channel.channel_id)

    usages = {
        ids[index]: LinkUsage(
            link_id=ids[index],
            capacity=caps[index],
            reserved=final_reserved[index],
            channel_ids=final_hosted[index],
        )
        for index in range(len(ids))
    }
    assignments: dict[str, Assignment] = {}

    for channel in ordered:
        index = chosen.get(channel.channel_id)
        if index is None:
            continue
        link_id = ids[index]
        peers = tuple(peer for peer in final_hosted[index] if peer != channel.channel_id)
        if channel.shareable and peers:
            why = (
                f"priority {channel.priority} shareable channel joins "
                f"{', '.join(peers)} on {link_id}; isolated channels cannot use it"
            )
        elif channel.shareable:
            why = (
                f"priority {channel.priority} shareable channel opens {link_id}; "
                "other shareable channels may consume spare capacity"
            )
        else:
            why = f"priority {channel.priority} isolated channel occupies {link_id} alone"
        if used_fallback:
            why += " (heuristic fallback used after bounded exact search)"
        assignments[channel.channel_id] = Assignment(
            channel.channel_id,
            link_id,
            channel.concurrency_limit,
            ChannelState.ACTIVE,
            why,
        )

    rejections = {}
    for channel in ordered:
        if channel.channel_id in chosen:
            continue
        if channel.concurrency_limit > largest:
            reason = RejectionReason.CHANNEL_EXCEEDS_LINK_CAPACITY
            why = (
                f"channel requires {channel.concurrency_limit} streams; largest "
                f"live link capacity is {largest}"
            )
        elif channel.shareable:
            reason = RejectionReason.INSUFFICIENT_SHARED_CAPACITY
            why = (
                "no shareable link with sufficient capacity exists after exact "
                "placement of channels that have at least its priority"
            )
        else:
            reason = RejectionReason.NO_EXCLUSIVE_LINK
            why = (
                "no empty link with sufficient capacity exists after exact "
                "placement of channels that have at least its priority"
            )
        if used_fallback:
            why += "; bounded exact search switched to deterministic greedy allocation"
        rejections[channel.channel_id] = _reject(channel, reason, why)

    plan = AllocationPlan(
        assignments,
        rejections,
        usages,
        {channel.channel_id: channel.shareable for channel in ordered},
    )
    plan.validate()
    return plan
