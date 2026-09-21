from __future__ import annotations

import threading
import unittest

from relay_allocator import (
    AllocationEvent,
    Channel,
    ConnectionRelay,
    EventType,
    Link,
)


class ManagerTests(unittest.TestCase):
    def test_failure_relocates_or_suspends_with_explicit_reason(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("l1", capacity=4))
        relay.add_link(Link("l2", capacity=4))

        relay.register_channel(
            Channel("isolated-a", priority=10, concurrency_limit=1, shareable=False)
        )
        relay.register_channel(
            Channel("isolated-b", priority=5, concurrency_limit=1, shareable=False)
        )
        initial = relay.snapshot()
        self.assertEqual(initial.assignments["isolated-a"].link_id, "l1")
        self.assertEqual(initial.assignments["isolated-b"].link_id, "l2")

        events = relay.mark_link_down("l1")
        plan = relay.snapshot()

        self.assertEqual(plan.assignments["isolated-a"].link_id, "l2")
        self.assertIn("isolated-b", plan.rejections)
        self.assertEqual(
            {(event.event_type, event.channel_id) for event in events},
            {
                (EventType.MIGRATED, "isolated-a"),
                (EventType.SUSPENDED, "isolated-b"),
            },
        )
        suspension = next(
            event for event in events if event.channel_id == "isolated-b"
        )
        self.assertIn("l1 failed", suspension.reason)
        self.assertIn("empty link", suspension.reason)

    def test_recovery_restores_suspended_channel_without_duplicate_link(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("l1", capacity=2))
        relay.add_link(Link("l2", capacity=2))

        relay.register_channel(
            Channel("high", priority=10, concurrency_limit=1, shareable=False)
        )
        relay.register_channel(
            Channel("low", priority=1, concurrency_limit=1, shareable=False)
        )
        relay.mark_link_down("l1")

        during_failure = relay.snapshot()
        self.assertNotIn("low", during_failure.assignments)

        events = relay.mark_link_up("l1")
        restored = relay.snapshot()

        self.assertEqual(restored.assignments["high"].link_id, "l2")
        self.assertEqual(restored.assignments["low"].link_id, "l1")
        self.assertNotIn("low", restored.rejections)
        self.assertEqual(
            [event.event_type for event in events if event.channel_id == "low"],
            [EventType.RESTORED],
        )
        self.assertEqual(
            len(restored.link_usages["l1"].channel_ids),
            1,
        )

    def test_failure_moves_shareable_group_to_capacity_available(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("failed", capacity=8))
        relay.add_link(Link("spare", capacity=8))

        relay.register_channel(
            Channel("a", priority=2, concurrency_limit=3, shareable=True)
        )
        relay.register_channel(
            Channel("b", priority=1, concurrency_limit=3, shareable=True)
        )

        events = relay.mark_link_down("failed")
        plan = relay.snapshot()

        self.assertEqual(plan.assignments["a"].link_id, "spare")
        self.assertEqual(plan.assignments["b"].link_id, "spare")
        self.assertEqual(plan.link_usages["spare"].reserved, 6)
        self.assertTrue(
            all(event.event_type is EventType.MIGRATED for event in events)
        )

    def test_unregister_releases_capacity_and_admits_waiting_channel(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("only", capacity=4))
        relay.register_channel(
            Channel("big", priority=10, concurrency_limit=3, shareable=True)
        )
        relay.register_channel(
            Channel("small", priority=1, concurrency_limit=2, shareable=True)
        )

        self.assertIn("small", relay.snapshot().rejections)
        relay.unregister_channel("big")

        plan = relay.snapshot()
        self.assertEqual(plan.assignments["small"].link_id, "only")
        self.assertEqual(plan.link_usages["only"].reserved, 2)

    def test_update_declaration_reallocates_without_duplicate_assignment(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("only", capacity=4))
        relay.register_channel(
            Channel("changing", priority=5, concurrency_limit=1, shareable=True)
        )

        relay.update_channel(
            Channel("changing", priority=5, concurrency_limit=1, shareable=False)
        )

        plan = relay.snapshot()
        self.assertEqual(len(plan.assignments), 1)
        self.assertEqual(plan.assignments["changing"].link_id, "only")
        self.assertEqual(plan.link_usages["only"].channel_ids, ("changing",))

    def test_repeated_recovery_is_idempotent(self) -> None:
        relay = ConnectionRelay()
        relay.add_link(Link("l1", capacity=2))
        relay.register_channel(
            Channel("a", priority=1, concurrency_limit=1, shareable=True)
        )

        first_events = relay.mark_link_up("l1")
        second_events = relay.mark_link_up("l1")
        plan = relay.snapshot()

        self.assertEqual(first_events, [])
        self.assertEqual(second_events, [])
        self.assertEqual(len(plan.assignments), 1)

    def test_allocation_snapshots_stay_consistent_under_concurrent_changes(self) -> None:
        relay = ConnectionRelay()
        for index in range(4):
            relay.add_link(Link(f"l{index}", capacity=6))

        errors: list[BaseException] = []

        def worker(worker_id: int) -> None:
            try:
                for index in range(5):
                    channel = Channel(
                        f"w{worker_id}-{index}",
                        priority=index,
                        concurrency_limit=(index % 3) + 1,
                        shareable=index % 2 == 0,
                    )
                    relay.register_channel(channel)
                    plan = relay.snapshot()
                    self.assert_no_duplicate_or_over_capacity(plan)
            except BaseException as exc:  # pragma: no cover - test diagnostic
                errors.append(exc)

        threads = [
            threading.Thread(target=worker, args=(worker_id,))
            for worker_id in range(4)
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()

        self.assertEqual(errors, [])

    @staticmethod
    def assert_no_duplicate_or_over_capacity(plan) -> None:
        seen: set[str] = set()
        for assignment in plan.assignments.values():
            assert assignment.channel_id not in seen
            seen.add(assignment.channel_id)
            usage = plan.link_usages[assignment.link_id]
            assert usage.reserved <= usage.capacity


if __name__ == "__main__":
    unittest.main()
