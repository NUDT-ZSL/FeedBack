"""Consistent hash ring for shard ownership and expansion migration plans.

Data structures (kept deliberately dependency-free):

* ``self._token_owner``: ``dict[token -> node]`` index, one owner per token;
* ``self._ring``: sorted list of ``(token, node)``, rebuilt from the dict;
* ``self._tokens``: parallel sorted token list used with :mod="bisect".

Hashing always goes through :func="digest_int" backed by :mod="hashlib",
never the built-in ``hash()`` (which is salted per process).

Token collision policy (bug fix #1): two physical nodes' vnodes may hash to
the same token. The token then has exactly ONE owner, arbitrated
deterministically by node name (lexicographically smaller wins). Lookup
therefore always returns the same owner for a key, regardless of insertion
order. The ring is rebuilt from the full node set on every mutation, so
removing the winner hands the token back to the surviving contender with
no stale index entries.
"""

from __future__ import annotations

import bisect
import hashlib
from typing import Dict, Iterable, List, Optional, Sequence, Set, Tuple

# md5 digest -> 128-bit token space: [0, TOKEN_SPACE)
TOKEN_SPACE = 1 << 128


# --------------------------------------------------------------------------- #
# Hashing
# --------------------------------------------------------------------------- #


def digest_int(data: bytes) -> int:
    """Stable 128-bit digest of ``data``. Tests may monkeypatch this to a
    small-space wrapper (e.g. ``digest % 64``) to force token collisions."""
    return int.from_bytes(hashlib.md5(data).digest(), "big")


def node_token(node: str, index: int) -> int:
    """Token of vnode ``index`` for ``node``: digest of name + sequence."""
    return digest_int(f"{node}#{index}".encode("utf-8"))


def key_hash(key) -> int:
    if isinstance(key, bytes):
        data = key
    else:
        data = str(key).encode("utf-8")
    return digest_int(data)


# --------------------------------------------------------------------------- #
# Ring
# --------------------------------------------------------------------------- #


class HashRing:
    def __init__(self, nodes: Iterable[str] = (), vnodes: int = 4):
        if vnodes < 1:
            raise ValueError("vnodes must be >= 1")
        self._vnodes = vnodes
        self._nodes: Set[str] = set()
        self._token_owner: Dict[int, str] = {}
        self._ring: List[Tuple[int, str]] = []
        self._tokens: List[int] = []
        for node in nodes:
            self.add_node(node)

    # -- mutation ------------------------------------------------------------

    @staticmethod
    def _check_name(node: str) -> None:
        if not isinstance(node, str) or not node:
            raise ValueError(f"invalid node name: {node!r}")

    def add_node(self, node: str) -> None:
        self._check_name(node)
        if node in self._nodes:
            raise ValueError(f"node already in ring: {node!r}")
        self._nodes.add(node)
        self._rebuild()

    def remove_node(self, node: str) -> None:
        self._check_name(node)
        if node not in self._nodes:
            raise ValueError(f"node not in ring: {node!r}")
        self._nodes.discard(node)
        self._rebuild()

    def _rebuild(self) -> None:
        """Recompute every vnode from the current node set.

        Nodes are visited in sorted order and a token is claimed by the
        first (smallest-named) contender, which makes collision arbitration
        stable and leaves no residue when a node is removed.
        """
        owners: Dict[int, str] = {}
        for node in sorted(self._nodes):
            for i in range(self._vnodes):
                token = node_token(node, i)
                if token not in owners:
                    owners[token] = node
        self._token_owner = owners
        self._ring = sorted(owners.items())
        self._tokens = [token for token, _ in self._ring]

    # -- introspection -------------------------------------------------------

    @property
    def vnodes(self) -> int:
        return self._vnodes

    @property
    def nodes(self) -> List[str]:
        return sorted(self._nodes)

    @property
    def ring(self) -> List[Tuple[int, str]]:
        """Sorted ``(token, node)`` pairs (copy)."""
        return list(self._ring)

    def tokens_of(self, node: str) -> List[int]:
        return sorted(t for t, n in self._ring if n == node)

    # -- lookup --------------------------------------------------------------

    def _index_for_point(self, point: int) -> int:
        if not self._tokens:
            raise RuntimeError("cannot lookup in an empty ring")
        idx = bisect.bisect_left(self._tokens, point)
        if idx == len(self._tokens):  # wrap around
            idx = 0
        return idx

    def owner_at(self, point: int) -> str:
        """Owner of the left-closed range containing raw token ``point``."""
        return self._ring[self._index_for_point(point)][1]

    def lookup(self, key) -> str:
        """Owner of ``key``: first token >= hash(key), wrapping to first."""
        return self.owner_at(key_hash(key))

    def get_replicas(
        self, key, count: int, exclude: Optional[Iterable[str]] = None
    ) -> List[str]:
        """Distinct physical nodes clockwise from ``key``'s position.

        Nodes in ``exclude`` are skipped; fewer than ``count`` nodes are
        returned (never an error) when the ring does not have enough.
        """
        if count < 0:
            raise ValueError("count must be >= 0")
        excluded: Set[str] = set(exclude or ())
        result: List[str] = []
        seen: Set[str] = set()
        if not self._tokens or count == 0:
            return result
        start = self._index_for_point(key_hash(key))
        n = len(self._tokens)
        for step in range(n):  # one full lap at most
            node = self._ring[(start + step) % n][1]
            if node in excluded or node in seen:
                continue
            seen.add(node)
            result.append(node)
            if len(result) == count:
                break
        return result


def build_ring(nodes: Iterable[str], vnodes: int = 4) -> HashRing:
    """Construct a ring from ``nodes`` (deterministic for equal inputs)."""
    return HashRing(nodes, vnodes=vnodes)


# --------------------------------------------------------------------------- #
# Migration planning
# --------------------------------------------------------------------------- #


def _owner_of_point(ring: HashRing, point: int) -> Optional[str]:
    if not ring._tokens:
        return None
    return ring.owner_at(point)


def _diff_rings(old: HashRing, new: HashRing) -> List[Tuple[int, int, Optional[str], Optional[str]]]:
    """Return merged ``(start, end, from_node, to_node)`` ranges whose
    ownership differs between ``old`` and ``new``.

    The token space is cut at the union of both rings' token boundaries, so
    every changed sub-range is covered exactly once (no gaps, no overlap);
    adjacent segments with the same (from, to) pair are merged into one
    left-closed/right-open range. ``from_node is None`` means keys that did
    not have any owner before (the old ring was empty). A migration onto an
    empty ring yields an empty plan (there is no successor to name).
    """
    if not new._tokens:
        return []

    # Lookup convention is "first token >= point", so token t owns the
    # integer set (prev, t]. Expressed half-open, ownership changes at
    # t + 1: cut the space at every (token + 1) and every segment
    # [cut_j, cut_{j+1}) has a constant owner on both rings. The wrap
    # stretch after the largest token stays a final [cut, TOKEN_SPACE)
    # entry (possibly paired with the [0, ...) entry; never merged across
    # the numeric boundary).
    boundaries = sorted(
        {
            token + 1
            for token in (set(old._tokens) | set(new._tokens))
            if token + 1 < TOKEN_SPACE
        }
    )
    if not boundaries:
        return []

    cuts = [0] + boundaries + [TOKEN_SPACE]
    entries: List[Tuple[int, int, Optional[str], Optional[str]]] = []
    for j in range(len(cuts) - 1):
        start, end = cuts[j], cuts[j + 1]
        if start == end:
            continue
        old_owner = _owner_of_point(old, start)
        new_owner = _owner_of_point(new, start)
        if old_owner == new_owner:
            continue
        if entries and entries[-1][1] == start and entries[-1][2:] == (
            old_owner,
            new_owner,
        ):
            prev_start, _, prev_from, prev_to = entries[-1]
            entries[-1] = (prev_start, end, prev_from, prev_to)
        else:
            entries.append((start, end, old_owner, new_owner))
    return entries


def plan_migration(
    old_nodes: Sequence[str], new_nodes: Sequence[str], vnodes: int = 4
) -> List[Tuple[int, int, Optional[str], Optional[str]]]:
    """Ownership-change ranges from the old topology to the new one.

    Works for both scale-up and scale-down; on scale-down a removed node's
    ranges are attributed to its successor on the new ring.
    """
    old = build_ring(old_nodes, vnodes=vnodes)
    new = build_ring(new_nodes, vnodes=vnodes)
    return _diff_rings(old, new)


def rebalance_plan(
    current: Sequence[str], target: Sequence[str], vnodes: int = 4
) -> List[Tuple[str, str, List[Tuple[int, int, Optional[str], Optional[str]]]]]:
    """Ordered steps taking ``current`` to ``target``.

    Each step is ``(action, node, ranges)`` with action ``"remove"`` or
    ``"add"``; removes (in name order) run before adds (in name order), and
    ``ranges`` is the exact migration that step induces against the ring
    state at that point. Output is deterministic: identical inputs produce
    byte-identical plans.
    """
    live: Set[str] = set(current)
    wanted: Set[str] = set(target)
    removes = sorted(live - wanted)
    adds = sorted(wanted - live)

    steps: List[Tuple[str, str, list]] = []

    for node in removes:
        before = build_ring(sorted(live), vnodes=vnodes)
        live.discard(node)
        after = build_ring(sorted(live), vnodes=vnodes)
        steps.append(("remove", node, _diff_rings(before, after)))

    for node in adds:
        before = build_ring(sorted(live), vnodes=vnodes)
        live.add(node)
        after = build_ring(sorted(live), vnodes=vnodes)
        steps.append(("add", node, _diff_rings(before, after)))

    return steps
