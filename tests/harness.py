"""In-memory cluster harness for deterministic simulation tests.

Delivers outbox envelopes between nodes, supports network partitions, and
records a full transcript (every delivered message, every applied command)
so replay runs can be compared byte-for-byte.
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from consensus import ConsensusNode, Role


class Cluster:
    def __init__(self, node_ids: List[Any], seed: int = 1,
                 election_timeout=(20, 40), heartbeat_interval: int = 5):
        self.applied: Dict[Any, list] = {nid: [] for nid in node_ids}
        self.transcript: List[list] = []
        self.nodes: Dict[Any, ConsensusNode] = {}
        self.pending: list = []
        self.blocked: set = set()
        for k, nid in enumerate(node_ids):
            peers = [p for p in node_ids if p != nid]
            self.nodes[nid] = ConsensusNode(
                nid, peers,
                apply_fn=self._make_apply(nid),
                restore_fn=self._make_restore(nid),
                election_timeout=election_timeout,
                heartbeat_interval=heartbeat_interval,
                seed=seed + k,
            )

    # ---- application callbacks ------------------------------------- #

    def _make_apply(self, nid):
        def apply(index, term, command):
            self.applied[nid].append((index, command))
            self.transcript.append(["apply", nid, index, command])
        return apply

    def _make_restore(self, nid):
        def restore(data):
            self.applied[nid][:] = [tuple(pair) for pair in data]
            self.transcript.append(["restore", nid, repr(data)])
        return restore

    # ---- fault injection -------------------------------------------- #

    def partition(self, a, b):
        self.blocked.add(frozenset((a, b)))

    def heal(self, a, b):
        self.blocked.discard(frozenset((a, b)))

    def isolate(self, nid):
        for other in self.nodes:
            if other != nid:
                self.partition(nid, other)

    def heal_all(self):
        self.blocked.clear()

    # ---- driving the simulation ------------------------------------- #

    def run(self, ticks: int):
        for _ in range(ticks):
            for node in self.nodes.values():
                node.tick()
                self.pending.extend(node.drain_outbox())
            self.deliver_pending()

    def deliver_pending(self, max_messages: int = 10000):
        count = 0
        while self.pending:
            count += 1
            if count > max_messages:
                raise RuntimeError("message storm: too many in-flight messages")
            env = self.pending.pop(0)
            if frozenset((env.frm, env.to)) in self.blocked:
                continue  # dropped by the partition
            self.transcript.append(["msg", env.frm, env.to, repr(env.payload)])
            node = self.nodes[env.to]
            node.deliver(env)
            self.pending.extend(node.drain_outbox())

    def propose(self, nid, command) -> int:
        index = self.nodes[nid].propose(command)
        self.pending.extend(self.nodes[nid].drain_outbox())
        self.deliver_pending()
        return index

    def take_snapshot(self, nid, index: int):
        data = [pair for pair in self.applied[nid] if pair[0] <= index]
        self.nodes[nid].take_snapshot(index, data)

    # ---- queries ----------------------------------------------------- #

    def leaders(self) -> List[Any]:
        return [nid for nid, n in self.nodes.items() if n.role is Role.LEADER]

    def leader_id(self) -> Optional[Any]:
        leaders = self.leaders()
        return leaders[0] if leaders else None

    def run_until_leader(self, max_ticks: int = 2000) -> Any:
        for _ in range(max_ticks):
            self.run(1)
            lid = self.leader_id()
            if lid is not None:
                return lid
        raise AssertionError("no leader elected")

    def log_of(self, nid) -> list:
        return [(e.index, e.term, e.command) for e in self.nodes[nid].log.entries]

    def states(self) -> dict:
        return {nid: n.state_snapshot() for nid, n in self.nodes.items()}

    def serialized(self) -> str:
        """Byte-stable serialization of everything observable."""
        return json.dumps(
            {"states": self.states(),
             "applied": self.applied,
             "transcript": self.transcript},
            sort_keys=True,
        )
