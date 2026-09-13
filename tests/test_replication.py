"""Log replication: commit rules, conflict backtracking, convergence."""
import unittest

from consensus import (
    ConsensusError,
    ConsensusNode,
    LogEntry,
    NotLeaderError,
    Role,
)

from .harness import Cluster


class ReplicationTests(unittest.TestCase):

    def test_propose_replicates_and_commits_on_all_nodes(self):
        c = Cluster(["A", "B", "C"], seed=11)
        lid = c.run_until_leader()
        c.propose(lid, "x=1")
        c.propose(lid, "y=2")
        c.run(5)
        for nid, n in c.nodes.items():
            self.assertEqual(n.commit_index, 2, nid)
            self.assertEqual(c.applied[nid], [(1, "x=1"), (2, "y=2")], nid)

    def test_commit_requires_majority(self):
        c = Cluster(["A", "B", "C"], seed=12)
        lid = c.run_until_leader()
        follower = next(nid for nid in c.nodes if nid != lid)
        c.isolate(follower)
        c.propose(lid, "k=v")  # leader + one follower still form a majority
        c.run(10)
        self.assertEqual(c.nodes[lid].commit_index, 1)
        self.assertEqual(c.nodes[follower].commit_index, 0)
        c.heal_all()
        c.run(30)
        self.assertEqual(c.nodes[follower].commit_index, 1)
        self.assertEqual(c.applied[follower], [(1, "k=v")])

    def test_old_leader_in_minority_cannot_commit_then_converges(self):
        c = Cluster(["A", "B", "C"], seed=13)
        lid = c.run_until_leader()
        c.propose(lid, "base")
        c.run(5)

        # Isolate the leader: it can append locally but never commit.
        c.isolate(lid)
        idx = c.nodes[lid].propose("divergent")
        c.run(200)
        self.assertLess(c.nodes[lid].commit_index, idx)

        # The majority side elects a new leader with a higher term.
        others = [nid for nid in c.nodes if nid != lid]
        new_leaders = [nid for nid in others if c.nodes[nid].role is Role.LEADER]
        self.assertEqual(len(new_leaders), 1)
        new_lid = new_leaders[0]
        self.assertGreater(c.nodes[new_lid].current_term,
                           c.nodes[lid].current_term)
        c.propose(new_lid, "m=1")
        c.run(5)
        self.assertEqual(c.nodes[new_lid].commit_index, 2)

        # Heal: old leader steps down, divergent entry is rolled back,
        # every log converges, committed entries are never lost.
        c.heal_all()
        c.run(100)
        self.assertEqual(c.nodes[lid].role, Role.FOLLOWER)
        self.assertEqual(c.nodes[lid].current_term,
                         c.nodes[new_lid].current_term)
        logs = {nid: c.log_of(nid) for nid in c.nodes}
        self.assertEqual(logs["A"], logs["B"])
        self.assertEqual(logs["B"], logs["C"])
        commands = [cmd for _, _, cmd in logs[lid]]
        self.assertNotIn("divergent", commands)
        self.assertIn("base", commands)
        for nid in c.nodes:
            self.assertEqual(c.applied[nid], c.applied[new_lid], nid)

    def test_conflict_reply_carries_fast_backtrack_hints(self):
        f = ConsensusNode("F", ["L"], seed=1)
        f.log.append([LogEntry(1, 1, "a"), LogEntry(2, 1, "b"), LogEntry(3, 2, "c")])
        f.current_term = 3
        # term mismatch at prev_log_index: report the conflicting term and
        # the first index of that term so the leader can skip the whole term
        r = f.append_entries("L", 3, 3, 1, [], 0)
        self.assertFalse(r.success)
        self.assertEqual(r.conflict_term, 2)
        self.assertEqual(r.conflict_index, 3)
        # follower's log is shorter: report last_index + 1, no term
        r2 = f.append_entries("L", 3, 5, 2, [], 0)
        self.assertFalse(r2.success)
        self.assertEqual(r2.conflict_index, 4)
        self.assertIsNone(r2.conflict_term)

    def test_conflicting_suffix_is_truncated_and_refilled(self):
        f = ConsensusNode("F", ["L"], seed=1)
        f.log.append([LogEntry(1, 1, "a"), LogEntry(2, 1, "b"), LogEntry(3, 1, "c")])
        r = f.append_entries("L", 2, 1, 1,
                             [LogEntry(2, 2, "x"), LogEntry(3, 2, "y")], 0)
        self.assertTrue(r.success)
        self.assertEqual([(e.index, e.term, e.command) for e in f.log.entries],
                         [(1, 1, "a"), (2, 2, "x"), (3, 2, "y")])

    def test_commit_index_never_moves_backwards(self):
        f = ConsensusNode("F", ["L"], seed=1)
        f.append_entries("L", 1, 0, 0,
                         [LogEntry(1, 1, "a"), LogEntry(2, 1, "b")], 2)
        self.assertEqual(f.commit_index, 2)
        # a stale heartbeat with leader_commit=0 must not move it back
        f.append_entries("L", 1, 2, 1, [], 0)
        self.assertEqual(f.commit_index, 2)

    def test_committed_entries_are_never_overwritten(self):
        f = ConsensusNode("F", ["L"], seed=1)
        f.append_entries("L", 1, 0, 0,
                         [LogEntry(1, 1, "a"), LogEntry(2, 1, "b")], 2)
        with self.assertRaises(ConsensusError):
            f.append_entries("L", 2, 1, 1, [LogEntry(2, 2, "evil")], 0)

    def test_commit_rule_requires_current_term_on_majority(self):
        # A leader must not commit an older-term entry by counting replicas.
        n = ConsensusNode("L", ["F1", "F2"], seed=1)
        n.current_term = 2
        n.log.append([LogEntry(1, 1, "old")])  # entry from term 1
        n._become_leader()
        n._match_index["F1"] = 1  # replicated on a majority (L + F1)
        n._try_advance_commit()
        self.assertEqual(n.commit_index, 0)  # term 1 entry: not committable
        # an entry from the current term on a majority commits fine
        n.propose("new")
        n._match_index["F1"] = 2
        n._try_advance_commit()
        self.assertEqual(n.commit_index, 2)  # and carries the old entry along

    def test_propose_on_non_leader_raises(self):
        n = ConsensusNode("N", ["X"], seed=1)
        with self.assertRaises(NotLeaderError):
            n.propose("cmd")


if __name__ == "__main__":
    unittest.main()
