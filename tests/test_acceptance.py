"""End-to-end acceptance: election -> replication -> partition -> heal ->
snapshot catch-up, and byte-identical deterministic replay."""
import unittest

from .harness import Cluster

COMMANDS = ["set a 1", "set b 2", "set c 3", "set d 4",
            "set e 5", "set f 6", "set g 7"]


class AcceptanceTests(unittest.TestCase):

    def _scenario(self) -> Cluster:
        c = Cluster(["A", "B", "C"], seed=99)

        # 1) three-node cluster elects a leader and replicates entries
        lid = c.run_until_leader()
        for cmd in COMMANDS[:3]:
            c.propose(lid, cmd)
        c.run(10)
        for nid, n in c.nodes.items():
            self.assertEqual(n.commit_index, 3, nid)

        # 2) partition: an isolated minority node must not commit and
        #    must not inflate its term
        follower = next(nid for nid in c.nodes if nid != lid)
        c.isolate(follower)
        term_before = c.nodes[follower].current_term
        c.propose(lid, COMMANDS[3])  # majority still commits
        c.run(50)
        self.assertEqual(c.nodes[lid].commit_index, 4)
        self.assertEqual(c.nodes[follower].commit_index, 3)
        self.assertEqual(c.nodes[follower].current_term, term_before)

        # 3) heal: logs converge
        c.heal_all()
        c.run(60)
        for nid, n in c.nodes.items():
            self.assertEqual(n.commit_index, 4, nid)
        self.assertEqual(c.log_of("A"), c.log_of("B"))
        self.assertEqual(c.log_of("B"), c.log_of("C"))

        # 4) snapshot catch-up: a node that fell behind a compacted log
        #    is brought up to date via install_snapshot
        other = next(nid for nid in c.nodes if nid not in (lid, follower))
        c.isolate(other)
        for cmd in COMMANDS[4:]:
            c.propose(lid, cmd)
        c.run(10)
        c.take_snapshot(lid, 6)
        c.heal_all()
        c.run(80)

        expected = [(i + 1, cmd) for i, cmd in enumerate(COMMANDS)]
        for nid, n in c.nodes.items():
            self.assertEqual(n.commit_index, 7, nid)
            self.assertEqual(c.applied[nid], expected, nid)
        self.assertGreaterEqual(c.nodes[other].log.base_index, 6)
        return c

    def test_full_acceptance_scenario(self):
        self._scenario()

    def test_same_event_sequence_replays_byte_identically(self):
        first = self._scenario().serialized()
        second = self._scenario().serialized()
        self.assertEqual(first, second)


if __name__ == "__main__":
    unittest.main()
