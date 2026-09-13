"""Edge cases: idempotent delivery, error paths, apply semantics."""
import unittest

from consensus import (
    AppendEntries,
    CommitIndexError,
    ConsensusError,
    ConsensusNode,
    Envelope,
    LogEntry,
    LogHoleError,
    MessageRoutingError,
)


class EdgeCaseTests(unittest.TestCase):

    def test_duplicate_append_entries_delivery_changes_nothing(self):
        f = ConsensusNode("F", ["L"], seed=1)
        msg = Envelope(frm="L", to="F", payload=AppendEntries(
            leader_id="L", term=1, prev_log_index=0, prev_log_term=0,
            entries=(LogEntry(1, 1, "a"),), leader_commit=1))
        f.deliver(msg)
        f.drain_outbox()
        mid = f.state_snapshot()
        f.deliver(msg)  # same message again
        f.drain_outbox()
        self.assertEqual(f.state_snapshot(), mid)
        self.assertEqual(len(f.log.entries), 1)
        self.assertEqual(f.commit_index, 1)

    def test_duplicate_vote_request_is_idempotent(self):
        n = ConsensusNode("N", ["A"], seed=1)
        r1 = n.request_vote("A", 1, 0, 0)
        snap = n.state_snapshot()
        r2 = n.request_vote("A", 1, 0, 0)
        self.assertTrue(r1.granted and r2.granted)
        self.assertEqual(n.state_snapshot(), snap)

    def test_deliver_to_wrong_node_raises(self):
        n = ConsensusNode("N", ["A"], seed=1)
        msg = Envelope(frm="A", to="SOMEONE_ELSE", payload=AppendEntries(
            leader_id="A", term=1, prev_log_index=0, prev_log_term=0,
            entries=(), leader_commit=0))
        with self.assertRaises(MessageRoutingError):
            n.deliver(msg)

    def test_unknown_message_type_raises(self):
        n = ConsensusNode("N", ["A"], seed=1)
        with self.assertRaises(ConsensusError):
            n.deliver(Envelope(frm="A", to="N", payload=object()))

    def test_apply_is_idempotent_and_bounded(self):
        n = ConsensusNode("N", ["L"], seed=1)
        seen = []
        n.apply_fn = lambda i, t, c: seen.append((i, c))
        n.append_entries("L", 1, 0, 0,
                         [LogEntry(1, 1, "a"), LogEntry(2, 1, "b")], 2)
        # entries 1..2 were auto-applied on commit; explicit apply is a no-op
        self.assertEqual(n.apply(), [])
        self.assertEqual(n.apply(1), [])
        self.assertEqual(seen, [(1, "a"), (2, "b")])
        with self.assertRaises(CommitIndexError):
            n.apply(3)  # beyond commit_index
        self.assertEqual(seen, [(1, "a"), (2, "b")])  # nothing re-applied

    def test_log_hole_errors_carry_context(self):
        n = ConsensusNode("N", ["L"], seed=1)
        with self.assertRaises(LogHoleError):
            n.log.term_at(5)
        # entries that do not extend prev_log_index
        with self.assertRaises(LogHoleError):
            n.append_entries("L", 1, 0, 0, [LogEntry(3, 1, "x")], 0)
        # compacted index: term_at still answers at the base, entry_at does not
        n.append_entries("L", 1, 0, 0, [LogEntry(1, 1, "a")], 1)
        n.take_snapshot(1, ["a"])
        self.assertEqual(n.log.term_at(1), 1)
        with self.assertRaises(LogHoleError):
            n.log.entry_at(1)

    def test_stale_append_entries_leaves_state_untouched(self):
        n = ConsensusNode("N", ["L"], seed=1)
        n.current_term = 5
        n.log.append([LogEntry(1, 4, "a")])
        before = n.state_snapshot()
        r = n.append_entries("L", 2, 0, 0, [LogEntry(1, 2, "z")], 0)
        self.assertFalse(r.success)
        self.assertEqual(n.state_snapshot(), before)

    def test_deterministic_random_replays_exactly(self):
        from consensus import DeterministicRandom
        a = DeterministicRandom(42)
        b = DeterministicRandom(42)
        seq_a = [a.randint(10, 99) for _ in range(1000)]
        seq_b = [b.randint(10, 99) for _ in range(1000)]
        self.assertEqual(seq_a, seq_b)
        c = DeterministicRandom(43)
        seq_c = [c.randint(10, 99) for _ in range(1000)]
        self.assertNotEqual(seq_a, seq_c)


if __name__ == "__main__":
    unittest.main()
