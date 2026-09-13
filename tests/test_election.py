"""Election behaviour: terms, vote granting, pre-vote, partitions."""
import unittest

from consensus import ConsensusNode, LogEntry, Role

from .harness import Cluster


class ElectionTests(unittest.TestCase):

    def test_three_node_cluster_elects_single_leader(self):
        c = Cluster(["A", "B", "C"], seed=7)
        lid = c.run_until_leader()
        self.assertIn(lid, {"A", "B", "C"})
        self.assertEqual(len(c.leaders()), 1)
        c.run(10)
        for nid, n in c.nodes.items():
            if nid != lid:
                self.assertEqual(n.role, Role.FOLLOWER)
                self.assertEqual(n.leader_id, lid)

    def test_empty_log_election_grants_vote(self):
        voter = ConsensusNode("V", ["C"], seed=1)
        reply = voter.request_vote("C", 1, 0, 0)
        self.assertTrue(reply.granted)
        self.assertEqual(voter.voted_for, "C")
        self.assertEqual(voter.current_term, 1)

    def test_single_node_cluster_becomes_leader_immediately(self):
        n = ConsensusNode("solo", [], seed=1, election_timeout=(1, 1))
        n.tick()
        self.assertEqual(n.role, Role.LEADER)
        idx = n.propose("cmd")
        self.assertEqual(n.commit_index, idx)
        self.assertEqual(n.last_applied, idx)

    def test_one_vote_per_term(self):
        voter = ConsensusNode("V", ["A", "B"], seed=1)
        self.assertTrue(voter.request_vote("A", 1, 0, 0).granted)
        # second candidate in the same term is refused
        self.assertFalse(voter.request_vote("B", 1, 0, 0).granted)
        # the same candidate asking again is idempotent
        self.assertTrue(voter.request_vote("A", 1, 0, 0).granted)
        self.assertEqual(voter.voted_for, "A")

    def test_log_freshness_compares_term_then_index(self):
        voter = ConsensusNode("V", ["A", "B", "C"], seed=1)
        voter.log.append([LogEntry(1, 1, "a"), LogEntry(2, 2, "b")])
        # higher index but older term loses
        self.assertFalse(voter.request_vote("A", 3, 3, 1).granted)
        # same (index, term) is fresh enough
        self.assertTrue(voter.request_vote("B", 3, 2, 2).granted)
        # newer term wins even with a lower index
        voter2 = ConsensusNode("V2", ["C"], seed=1)
        voter2.log.append([LogEntry(1, 1, "a"), LogEntry(2, 2, "b")])
        self.assertTrue(voter2.request_vote("C", 3, 1, 3).granted)

    def test_stale_term_messages_are_rejected_without_state_change(self):
        n = ConsensusNode("N", ["X"], seed=1)
        n.current_term = 5
        before = n.state_snapshot()
        r1 = n.request_vote("X", 3, 0, 0)
        self.assertFalse(r1.granted)
        self.assertEqual(r1.term, 5)
        r2 = n.append_entries("X", 3, 0, 0, [], 0)
        self.assertFalse(r2.success)
        self.assertEqual(r2.term, 5)
        self.assertEqual(n.state_snapshot(), before)

    def test_pre_vote_never_changes_term_or_vote(self):
        n = ConsensusNode("N", ["X"], seed=1, election_timeout=(10, 10))
        n.now = 100  # long past any leader contact
        reply = n.request_vote("X", 6, 0, 0, pre_vote=True)
        self.assertTrue(reply.granted)
        self.assertEqual(n.current_term, 0)
        self.assertIsNone(n.voted_for)

    def test_pre_vote_rejected_while_leader_lease_holds(self):
        n = ConsensusNode("N", ["X", "L"], seed=1, election_timeout=(10, 10))
        n.current_term = 5
        n.now = 100
        n._last_leader_contact = 95  # heard from the leader 5 ticks ago
        reply = n.request_vote("X", 6, 0, 0, pre_vote=True)
        self.assertFalse(reply.granted)

    def test_partitioned_minority_cannot_inflate_terms(self):
        # 5 nodes: a 2-node minority partition must not disturb the majority.
        c = Cluster(["A", "B", "C", "D", "E"], seed=3)
        lid = c.run_until_leader()
        c.propose(lid, "stable")
        c.run(10)
        minority = [nid for nid in c.nodes if nid != lid][:2]
        for m in minority:
            c.isolate(m)
        c.partition(minority[0], minority[1])
        terms_before = {m: c.nodes[m].current_term for m in minority}
        c.run(300)
        for m in minority:
            # pre-vote can never reach a majority => term stays put
            self.assertEqual(c.nodes[m].current_term, terms_before[m])
            self.assertNotEqual(c.nodes[m].role, Role.LEADER)
        # the majority side keeps its leader and its term
        self.assertEqual(c.leader_id(), lid)
        self.assertEqual(c.nodes[lid].current_term,
                         c.nodes[[n for n in c.nodes
                                  if n != lid and n not in minority][0]].current_term)

    def test_higher_term_message_demotes_leader(self):
        c = Cluster(["A", "B", "C"], seed=14)
        lid = c.run_until_leader()
        node = c.nodes[lid]
        higher = node.current_term + 1
        reply = node.append_entries("outsider", higher, 0, 0, [], 0)
        self.assertTrue(reply.success)
        self.assertEqual(node.role, Role.FOLLOWER)
        self.assertEqual(node.current_term, higher)


if __name__ == "__main__":
    unittest.main()
