"""Event-driven Raft consensus node.

No threads, no sockets, no wall-clock time, no global randomness. The node
is driven entirely by four kinds of calls:

  tick()                  advance the logical clock by one step
  deliver(envelope)       hand a message to this node
  propose(command)        leader-only: append a command to the log
  request_vote / append_entries / install_snapshot
                          direct RPC-style entry points (also used by deliver)

Outbound messages accumulate in an outbox; callers drain it with
drain_outbox() and route the envelopes themselves. Same seed + same call
sequence => byte-identical behaviour.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set

from .errors import (
    CommitIndexError,
    ConsensusError,
    LogHoleError,
    MessageRoutingError,
    NotLeaderError,
    SnapshotIndexError,
)
from .log import Log, LogEntry
from .messages import (
    AppendEntries,
    AppendEntriesReply,
    Envelope,
    InstallSnapshot,
    InstallSnapshotReply,
    RequestVote,
    RequestVoteReply,
)
from .random_source import DeterministicRandom


class Role(Enum):
    FOLLOWER = "follower"
    CANDIDATE = "candidate"
    LEADER = "leader"


class ConsensusNode:
    def __init__(
        self,
        node_id: Any,
        peers: List[Any],
        apply_fn: Optional[Callable[[int, int, Any], None]] = None,
        restore_fn: Optional[Callable[[Any], None]] = None,
        election_timeout: tuple = (30, 60),
        heartbeat_interval: int = 10,
        seed: int = 0,
        pre_vote: bool = True,
    ):
        peers = list(peers)
        if node_id in peers:
            raise ValueError("peers must not contain node_id")
        lo, hi = election_timeout
        if lo <= 0 or hi < lo:
            raise ValueError(f"invalid election_timeout range: {election_timeout}")
        if heartbeat_interval <= 0:
            raise ValueError("heartbeat_interval must be positive")

        self.node_id = node_id
        self.peers = peers
        self.cluster_size = len(peers) + 1
        self.apply_fn = apply_fn or (lambda index, term, command: None)
        self.restore_fn = restore_fn
        self.election_timeout_range = (lo, hi)
        self.heartbeat_interval = heartbeat_interval
        self.pre_vote_enabled = pre_vote
        self._rng = DeterministicRandom(seed)

        # ---- persistent state (would be on disk in a real deployment) ----
        self.current_term: int = 0
        self.voted_for: Optional[Any] = None
        self.log = Log()

        # ---- volatile state ----
        self.role = Role.FOLLOWER
        self.commit_index: int = 0
        self.last_applied: int = 0
        self.leader_id: Optional[Any] = None
        self.snapshot_data: Any = None

        # ---- logical clock ----
        self.now: int = 0
        self._last_leader_contact: int = -(10 ** 9)
        self._election_deadline: int = 0
        self._next_heartbeat: int = 0

        # ---- leader-only volatile state ----
        self._next_index: Dict[Any, int] = {}
        self._match_index: Dict[Any, int] = {}

        # ---- candidate-only volatile state ----
        self._votes: Set[Any] = set()
        self._pre_votes: Set[Any] = set()
        self._pre_vote_active: bool = False

        self._outbox: List[Envelope] = []
        self._reset_election_deadline()

    def __repr__(self) -> str:
        return (f"ConsensusNode({self.node_id!r}, role={self.role.value}, "
                f"term={self.current_term}, commit={self.commit_index}, "
                f"log=({self.log.base_index}..{self.log.last_index}])")

    # ------------------------------------------------------------------ #
    # deterministic time & randomness
    # ------------------------------------------------------------------ #

    def set_random_source(self, seed: int) -> None:
        """Replace the random source. Takes effect for future timeouts."""
        self._rng = DeterministicRandom(seed)
        self._reset_election_deadline()

    def _reset_election_deadline(self) -> None:
        lo, hi = self.election_timeout_range
        self._election_deadline = self.now + self._rng.randint(lo, hi)

    @property
    def _majority(self) -> int:
        return self.cluster_size // 2 + 1

    # ------------------------------------------------------------------ #
    # outbox
    # ------------------------------------------------------------------ #

    def _emit(self, to: Any, payload: Any) -> None:
        self._outbox.append(Envelope(frm=self.node_id, to=to, payload=payload))

    def drain_outbox(self) -> List[Envelope]:
        """Return and clear all pending outbound messages."""
        out, self._outbox = self._outbox, []
        return out

    # ------------------------------------------------------------------ #
    # ticking
    # ------------------------------------------------------------------ #

    def tick(self) -> None:
        """Advance the logical clock by one step."""
        self.now += 1
        if self.role is Role.LEADER:
            if self.now >= self._next_heartbeat:
                self._next_heartbeat = self.now + self.heartbeat_interval
                for peer in self.peers:
                    self._send_append_entries(peer)
        elif self.now >= self._election_deadline:
            if self.pre_vote_enabled:
                self._start_pre_vote()
            else:
                self._start_election()

    # ------------------------------------------------------------------ #
    # elections
    # ------------------------------------------------------------------ #

    def _start_pre_vote(self) -> None:
        """Ask peers whether they *would* vote for us, without touching our term.

        A partitioned minority can never collect a majority of pre-votes, so
        it never increments its term and cannot disrupt a healthy majority.
        """
        self._pre_vote_active = True
        self._pre_votes = {self.node_id}
        self._reset_election_deadline()
        if len(self._pre_votes) >= self._majority:
            self._start_election()
            return
        for peer in self.peers:
            self._emit(peer, RequestVote(
                candidate_id=self.node_id,
                term=self.current_term + 1,
                last_log_index=self.log.last_index,
                last_log_term=self.log.last_term,
                pre_vote=True,
            ))

    def _start_election(self) -> None:
        self._pre_vote_active = False
        self.role = Role.CANDIDATE
        self.current_term += 1
        self.voted_for = self.node_id
        self.leader_id = None
        self._votes = {self.node_id}
        self._reset_election_deadline()
        if len(self._votes) >= self._majority:
            self._become_leader()
            return
        for peer in self.peers:
            self._emit(peer, RequestVote(
                candidate_id=self.node_id,
                term=self.current_term,
                last_log_index=self.log.last_index,
                last_log_term=self.log.last_term,
            ))

    def _become_leader(self) -> None:
        self.role = Role.LEADER
        self.leader_id = self.node_id
        self._next_index = {p: self.log.last_index + 1 for p in self.peers}
        self._match_index = {p: 0 for p in self.peers}
        self._next_heartbeat = self.now + self.heartbeat_interval
        for peer in self.peers:
            self._send_append_entries(peer)

    def _become_follower(self, term: int) -> None:
        if term > self.current_term:
            self.current_term = term
            self.voted_for = None
        self.role = Role.FOLLOWER
        self.leader_id = None
        self._pre_vote_active = False
        self._votes = set()
        self._reset_election_deadline()

    def _is_log_up_to_date(self, last_log_index: int, last_log_term: int) -> bool:
        """Candidate log freshness: compare term first, then index."""
        if last_log_term != self.log.last_term:
            return last_log_term > self.log.last_term
        return last_log_index >= self.log.last_index

    def request_vote(self, candidate_id: Any, term: int,
                     last_log_index: int, last_log_term: int,
                     pre_vote: bool = False) -> RequestVoteReply:
        if pre_vote:
            # Granted only if we have not heard from a leader recently —
            # this is what keeps a partitioned minority from disrupting
            # a healthy majority. Never touches current_term or voted_for.
            granted = (
                term > self.current_term
                and self.role is not Role.LEADER
                and self.now - self._last_leader_contact >= self.election_timeout_range[0]
                and self._is_log_up_to_date(last_log_index, last_log_term)
            )
            return RequestVoteReply(voter_id=self.node_id, term=self.current_term,
                                    vote_term=term, granted=granted, pre_vote=True)

        if term < self.current_term:
            # Stale term: reject outright, change nothing.
            return RequestVoteReply(voter_id=self.node_id, term=self.current_term,
                                    vote_term=term, granted=False)
        if term > self.current_term:
            self._become_follower(term)
        granted = (self.voted_for in (None, candidate_id)
                   and self._is_log_up_to_date(last_log_index, last_log_term))
        if granted:
            self.voted_for = candidate_id
            self._reset_election_deadline()
        return RequestVoteReply(voter_id=self.node_id, term=self.current_term,
                                vote_term=term, granted=granted)

    def _handle_vote_reply(self, reply: RequestVoteReply) -> None:
        if reply.term > self.current_term:
            self._become_follower(reply.term)
            return
        if not reply.granted:
            return
        if reply.pre_vote:
            if (self._pre_vote_active
                    and self.role is not Role.LEADER
                    and reply.vote_term == self.current_term + 1):
                self._pre_votes.add(reply.voter_id)
                if len(self._pre_votes) >= self._majority:
                    self._start_election()
            return
        if self.role is Role.CANDIDATE and reply.vote_term == self.current_term:
            self._votes.add(reply.voter_id)
            if len(self._votes) >= self._majority:
                self._become_leader()

    # ------------------------------------------------------------------ #
    # log replication — follower side
    # ------------------------------------------------------------------ #

    def append_entries(self, leader_id: Any, term: int,
                       prev_log_index: int, prev_log_term: int,
                       entries: List[Any], leader_commit: int) -> AppendEntriesReply:
        entries = [e if isinstance(e, LogEntry) else LogEntry(*e) for e in entries]

        if term < self.current_term:
            # Stale leader: reject, change nothing.
            return AppendEntriesReply(
                follower_id=self.node_id, term=self.current_term, success=False,
                match_index=0, conflict_index=self.log.last_index + 1,
                conflict_term=None)
        if term > self.current_term or self.role is not Role.FOLLOWER:
            self._become_follower(term)
        self.leader_id = leader_id
        self._last_leader_contact = self.now
        self._reset_election_deadline()

        # prev_log_index inside our snapshot: skip the compacted prefix and
        # re-anchor the check at the snapshot boundary.
        if prev_log_index < self.log.base_index:
            entries = [e for e in entries if e.index > self.log.base_index]
            prev_log_index = self.log.base_index
            prev_log_term = self.log.base_term

        # Consistency check, with fast-backtrack hints on failure.
        if prev_log_index > self.log.last_index:
            return AppendEntriesReply(
                follower_id=self.node_id, term=self.current_term, success=False,
                match_index=0, conflict_index=self.log.last_index + 1,
                conflict_term=None)
        actual_term = self.log.term_at(prev_log_index)
        if actual_term != prev_log_term:
            return AppendEntriesReply(
                follower_id=self.node_id, term=self.current_term, success=False,
                match_index=0,
                conflict_index=self.log.first_index_of_term(actual_term),
                conflict_term=actual_term)

        entries = [e for e in entries if e.index > prev_log_index]
        if entries and entries[0].index != prev_log_index + 1:
            raise LogHoleError("entries do not extend prev_log_index",
                               prev_log_index=prev_log_index,
                               first_entry_index=entries[0].index)
        for e in entries:
            if e.index <= self.commit_index and self.log.term_at(e.index) != e.term:
                raise ConsensusError("refusing to overwrite a committed entry",
                                     index=e.index, commit_index=self.commit_index,
                                     existing_term=self.log.term_at(e.index),
                                     incoming_term=e.term)
        self.log.append(entries)

        new_last = prev_log_index + len(entries)
        if leader_commit > self.commit_index:
            # commit_index only ever moves forward.
            self.commit_index = min(leader_commit, new_last)
            self.apply()
        return AppendEntriesReply(
            follower_id=self.node_id, term=self.current_term, success=True,
            match_index=new_last)

    # ------------------------------------------------------------------ #
    # log replication — leader side
    # ------------------------------------------------------------------ #

    def propose(self, command: Any) -> int:
        if self.role is not Role.LEADER:
            raise NotLeaderError("only the leader can propose commands",
                                 node_id=self.node_id, role=self.role.value,
                                 leader_id=self.leader_id)
        entry = LogEntry(index=self.log.last_index + 1,
                         term=self.current_term, command=command)
        self.log.append([entry])
        for peer in self.peers:
            self._send_append_entries(peer)
        self._try_advance_commit()  # single-node cluster commits at once
        return entry.index

    def _send_append_entries(self, peer: Any) -> None:
        next_index = self._next_index.get(peer, self.log.last_index + 1)
        if next_index <= self.log.base_index:
            self._send_snapshot(peer)
            return
        prev = next_index - 1
        self._emit(peer, AppendEntries(
            leader_id=self.node_id, term=self.current_term,
            prev_log_index=prev, prev_log_term=self.log.term_at(prev),
            entries=tuple(self.log.entries_from(next_index)),
            leader_commit=self.commit_index))

    def _send_snapshot(self, peer: Any) -> None:
        self._emit(peer, InstallSnapshot(
            leader_id=self.node_id, term=self.current_term,
            last_included_index=self.log.base_index,
            last_included_term=self.log.base_term,
            data=self.snapshot_data))

    def _handle_append_entries_reply(self, reply: AppendEntriesReply) -> None:
        if reply.term > self.current_term:
            self._become_follower(reply.term)
            return
        if self.role is not Role.LEADER or reply.term != self.current_term:
            return
        follower = reply.follower_id
        if follower not in self.peers:
            return
        if reply.success:
            if reply.match_index > self._match_index.get(follower, 0):
                self._match_index[follower] = reply.match_index
                self._next_index[follower] = reply.match_index + 1
            self._try_advance_commit()
            return
        next_index = self._next_after_conflict(reply)
        self._next_index[follower] = next_index
        if next_index <= self.log.base_index:
            self._send_snapshot(follower)
        else:
            self._send_append_entries(follower)

    def _next_after_conflict(self, reply: AppendEntriesReply) -> int:
        """Fast backtracking: jump to the follower's conflicting term if we
        still have entries from it, otherwise to its conflict_index."""
        if reply.conflict_term is not None:
            last = self.log.last_index_of_term(reply.conflict_term)
            if last is not None:
                return last + 1
        return max(reply.conflict_index, 1)

    def _try_advance_commit(self) -> None:
        """Commit the highest index replicated on a majority — but only if it
        belongs to the current term (older entries commit indirectly)."""
        if self.role is not Role.LEADER:
            return
        for n in range(self.log.last_index, self.commit_index, -1):
            if self.log.term_at(n) != self.current_term:
                continue
            replicated = 1 + sum(1 for p in self.peers
                                 if self._match_index.get(p, 0) >= n)
            if replicated >= self._majority:
                self.commit_index = n
                self.apply()
                break

    # ------------------------------------------------------------------ #
    # applying committed entries
    # ------------------------------------------------------------------ #

    def apply(self, commit_index: Optional[int] = None) -> List[LogEntry]:
        """Feed committed entries to apply_fn in order.

        Idempotent: entries at or below last_applied are never re-applied.
        Applying beyond commit_index is an error, not a silent no-op.
        """
        target = self.commit_index if commit_index is None else commit_index
        if target > self.commit_index:
            raise CommitIndexError("cannot apply beyond commit_index",
                                   requested=target, commit_index=self.commit_index)
        if target <= self.last_applied:
            return []
        applied = []
        for index in range(self.last_applied + 1, target + 1):
            entry = self.log.entry_at(index)
            self.apply_fn(entry.index, entry.term, entry.command)
            applied.append(entry)
        self.last_applied = target
        return applied

    # ------------------------------------------------------------------ #
    # snapshots
    # ------------------------------------------------------------------ #

    def take_snapshot(self, last_included_index: int, data: Any) -> None:
        """Compact the local log up to an applied index."""
        if (last_included_index <= self.log.base_index
                or last_included_index > self.last_applied):
            raise SnapshotIndexError("snapshot index out of range",
                                     index=last_included_index,
                                     base_index=self.log.base_index,
                                     last_applied=self.last_applied)
        term = self.log.term_at(last_included_index)
        self.log.truncate_prefix(last_included_index, term)
        self.snapshot_data = data

    def install_snapshot(self, last_included_index: int,
                         last_included_term: int, data: Any) -> None:
        """Install a snapshot received from the leader (or replayed manually)."""
        if last_included_index < self.log.base_index:
            raise SnapshotIndexError("snapshot is older than the current log base",
                                     index=last_included_index,
                                     base_index=self.log.base_index)
        if last_included_index == self.log.base_index:
            if last_included_term != self.log.base_term:
                raise SnapshotIndexError("snapshot term mismatch at log base",
                                         index=last_included_index,
                                         expected=self.log.base_term,
                                         actual=last_included_term)
            return  # exact duplicate delivery: no state change

        if (last_included_index <= self.log.last_index
                and self.log.term_at(last_included_index) == last_included_term):
            # Our log agrees with the snapshot: keep the suffix after it.
            self.log.truncate_prefix(last_included_index, last_included_term)
        else:
            # Snapshot covers entries we do not have (or conflicts): drop all.
            self.log.discard_all(last_included_index, last_included_term)

        self.snapshot_data = data
        if self.commit_index < last_included_index:
            self.commit_index = last_included_index
        if self.last_applied < last_included_index:
            self.last_applied = last_included_index
        if self.restore_fn is not None:
            self.restore_fn(data)

    # ------------------------------------------------------------------ #
    # message delivery
    # ------------------------------------------------------------------ #

    def deliver(self, envelope: Envelope) -> None:
        """Deliver one message. Responses go to the outbox."""
        if envelope.to != self.node_id:
            raise MessageRoutingError("message delivered to the wrong node",
                                      addressed_to=envelope.to, node_id=self.node_id)
        p = envelope.payload
        if isinstance(p, RequestVote):
            reply = self.request_vote(p.candidate_id, p.term,
                                      p.last_log_index, p.last_log_term,
                                      pre_vote=p.pre_vote)
            self._emit(envelope.frm, reply)
        elif isinstance(p, RequestVoteReply):
            self._handle_vote_reply(p)
        elif isinstance(p, AppendEntries):
            reply = self.append_entries(p.leader_id, p.term, p.prev_log_index,
                                        p.prev_log_term, list(p.entries),
                                        p.leader_commit)
            self._emit(envelope.frm, reply)
        elif isinstance(p, AppendEntriesReply):
            self._handle_append_entries_reply(p)
        elif isinstance(p, InstallSnapshot):
            reply = self._handle_install_snapshot(p)
            self._emit(envelope.frm, reply)
        elif isinstance(p, InstallSnapshotReply):
            self._handle_install_snapshot_reply(p)
        else:
            raise ConsensusError("unknown message type",
                                 payload_type=type(p).__name__)

    def _handle_install_snapshot(self, p: InstallSnapshot) -> InstallSnapshotReply:
        if p.term < self.current_term:
            return InstallSnapshotReply(follower_id=self.node_id,
                                        term=self.current_term, success=False,
                                        match_index=self.log.base_index)
        if p.term > self.current_term or self.role is not Role.FOLLOWER:
            self._become_follower(p.term)
        self.leader_id = p.leader_id
        self._last_leader_contact = self.now
        self._reset_election_deadline()
        try:
            self.install_snapshot(p.last_included_index, p.last_included_term, p.data)
        except SnapshotIndexError:
            return InstallSnapshotReply(follower_id=self.node_id,
                                        term=self.current_term, success=False,
                                        match_index=self.log.base_index)
        return InstallSnapshotReply(follower_id=self.node_id,
                                    term=self.current_term, success=True,
                                    match_index=self.log.base_index)

    def _handle_install_snapshot_reply(self, reply: InstallSnapshotReply) -> None:
        if reply.term > self.current_term:
            self._become_follower(reply.term)
            return
        if self.role is not Role.LEADER or reply.term != self.current_term:
            return
        if reply.success:
            follower = reply.follower_id
            if reply.match_index > self._match_index.get(follower, 0):
                self._match_index[follower] = reply.match_index
                self._next_index[follower] = reply.match_index + 1
            self._send_append_entries(follower)

    # ------------------------------------------------------------------ #
    # introspection (used by replay/determinism checks)
    # ------------------------------------------------------------------ #

    def state_snapshot(self) -> Dict[str, Any]:
        """A JSON-serialisable view of the consensus-visible state."""
        return {
            "node_id": self.node_id,
            "role": self.role.value,
            "current_term": self.current_term,
            "voted_for": self.voted_for,
            "leader_id": self.leader_id,
            "commit_index": self.commit_index,
            "last_applied": self.last_applied,
            "base_index": self.log.base_index,
            "base_term": self.log.base_term,
            "log": [(e.index, e.term, e.command) for e in self.log.entries],
            "snapshot_data": self.snapshot_data,
        }
