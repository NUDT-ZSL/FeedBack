"""Snapshots: compaction, install, catch-up of lagging followers."""
import unittest

from consensus import ConsensusNode, LogEntry, SnapshotIndexError

from .harness import Cluster


def node_with_entries():
    n = ConsensusNode("N", ["L"], seed=1)
    n.append_entries("L", 1, 0, 0,
                     [LogEntry(1, 1, "a"), LogEntry(2, 1, "b"),
                      LogEntry(3, 1, "c")], 3)
    return n


class SnapshotTests(unittest.TestCase):

    def test_take_snapshot_compacts_log(self):
        n = node_with_entries()
        n.take_snapshot(2, ["a", "b"])
        self.assertEqual(n.log.base_index, 2)
        self.assertEqual(n.log.base_term, 1)
        self.assertEqual([e.index for e in n.log.entries], [3])
        self.assertEqual(n.log.last_index, 3)
        self.assertEqual(n.log.last_term, 1)

    def test_take_snapshot_out_of_range_raises(self):
        n = node_with_entries()
        with self.assertRaises(SnapshotIndexError):
            n.take_snapshot(0, [])   # does not advance the base
        with self.assertRaises(SnapshotIndexError):
            n.take_snapshot(4, [])   # beyond last_applied

    def test_install_snapshot_resets_state(self):
        restored = []
        n = ConsensusNode("N", ["L"], seed=1, restore_fn=restored.append)
        n.install_snapshot(5, 2, ["x"])
        self.assertEqual(n.log.base_index, 5)
        self.assertEqual(n.log.base_term, 2)
        self.assertEqual(n.commit_index, 5)
        self.assertEqual(n.last_applied, 5)
        self.assertEqual(restored, [["x"]])

    def test_install_snapshot_keeps_matching_suffix(self):
        n = node_with_entries()
        n.install_snapshot(2, 1, ["a", "b"])  # term matches entry 2
        self.assertEqual([e.index for e in n.log.entries], [3])

    def test_install_snapshot_discards_conflicting_log(self):
        n = node_with_entries()
        n.install_snapshot(2, 9, ["other"])  # term mismatch at index 2
        self.assertEqual(n.log.entries, [])
        self.assertEqual(n.log.last_index, 2)
        self.assertEqual(n.log.last_term, 9)

    def test_stale_snapshot_raises_and_duplicate_is_idempotent(self):
        n = ConsensusNode("N", ["L"], seed=1)
        n.install_snapshot(5, 2, ["x"])
        with self.assertRaises(SnapshotIndexError):
            n.install_snapshot(4, 2, ["y"])       # older than base
        with self.assertRaises(SnapshotIndexError):
            n.install_snapshot(5, 3, ["x"])       # same index, wrong term
        before = n.state_snapshot()
        n.install_snapshot(5, 2, ["x"])           # exact duplicate
        self.assertEqual(n.state_snapshot(), before)

    def test_snapshot_catchup_after_partition(self):
        c = Cluster(["A", "B", "C"], seed=21)
        lid = c.run_until_leader()
        for cmd in ("c1", "c2", "c3"):
            c.propose(lid, cmd)
        c.run(5)

        straggler = next(nid for nid in c.nodes if nid != lid)
        c.isolate(straggler)
        for cmd in ("c4", "c5", "c6", "c7"):
            c.propose(lid, cmd)
        c.run(5)
        # leader compacts past the straggler's next_index
        c.take_snapshot(lid, 6)

        c.heal_all()
        c.run(60)
        n = c.nodes[straggler]
        self.assertGreaterEqual(n.log.base_index, 6)
        self.assertEqual(n.commit_index, 7)
        expected = [(i + 1, f"c{i + 1}") for i in range(7)]
        for nid in c.nodes:
            self.assertEqual(c.applied[nid], expected, nid)


if __name__ == "__main__":
    unittest.main()
