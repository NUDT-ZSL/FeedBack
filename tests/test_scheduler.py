from __future__ import annotations

import threading
import unittest

from relay_allocator import ChannelStatus, RelayConnectionScheduler


class SchedulerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.scheduler = RelayConnectionScheduler()

    def test_sharable_channels_are_packed_while_exclusive_gets_own_link(self) -> None:
        self.scheduler.add_link("l1")
        self.scheduler.add_link("l2")
        self.scheduler.register_channel(
            "shared-a", priority=5, concurrency_limit=2, allow_sharing=True
        )
        self.scheduler.register_channel(
            "shared-b", priority=4, concurrency_limit=1, allow_sharing=True
        )
        plan = self.scheduler.register_channel(
            "exclusive", priority=10, concurrency_limit=1, allow_sharing=False
        )

        shared_link = next(
            link_id
            for link_id, link_load in plan.link_loads.items()
            if "shared-a" in link_load
        )
        exclusive_link = next(
            link_id
            for link_id, link_load in plan.link_loads.items()
            if "exclusive" in link_load
        )
        self.assertEqual(set(plan.link_loads[shared_link]), {"shared-a", "shared-b"})
        self.assertEqual(plan.link_loads[exclusive_link], {"exclusive": 1})
        self.assertEqual(plan.placement("shared-a").granted, 2)
        self.assertEqual(plan.placement("shared-b").granted, 1)
        self.assertEqual(plan.placement("exclusive").status, ChannelStatus.FULL)

    def test_low_priority_channel_is_rejected_with_explicit_reason(self) -> None:
        self.scheduler.add_link("only-link")
        self.scheduler.register_channel(
            "critical", priority=10, concurrency_limit=1, allow_sharing=False
        )
        self.scheduler.register_channel(
            "low", priority=1, concurrency_limit=1, allow_sharing=True
        )
        plan = self.scheduler.register_channel(
            "exclusive-low", priority=0, concurrency_limit=1, allow_sharing=False
        )

        rejected = plan.placement("exclusive-low")
        self.assertEqual(rejected.status, ChannelStatus.REJECTED)
        self.assertEqual(rejected.reason_code, "ISOLATION_CONFLICT")
        self.assertIn("exclusive channel needs an unoccupied link", rejected.reason)
        self.assertIn("critical", rejected.reason)
        self.assertEqual(rejected.granted, 0)
        self.assertEqual(rejected.allocations, {})

    def test_link_failure_rehomes_channels_without_breaking_isolation(self) -> None:
        self.scheduler.add_link("a")
        self.scheduler.add_link("b")
        self.scheduler.add_link("c")
        self.scheduler.register_channel(
            "shared-1", priority=5, concurrency_limit=1, allow_sharing=True
        )
        self.scheduler.register_channel(
            "shared-2", priority=4, concurrency_limit=1, allow_sharing=True
        )
        self.scheduler.register_channel(
            "exclusive", priority=10, concurrency_limit=1, allow_sharing=False
        )

        failed = self.scheduler.link_failed("a")
        self.assertNotIn("a", failed.available_links)
        self.assertIn("a", failed.unavailable_links)
        self.assertIn("exclusive", failed.link_loads["b"])
        load = failed.link_loads["c"]
        self.assertIn("shared-1", load)
        self.assertIn("shared-2", load)
        self.assertNotIn("exclusive", load)

    def test_recovery_restores_degraded_channel_without_duplicate_holdings(self) -> None:
        self.scheduler.add_link("a", capacity=1)
        self.scheduler.add_link("b", capacity=1)
        self.scheduler.register_channel(
            "exclusive", priority=10, concurrency_limit=2, allow_sharing=False
        )
        self.scheduler.register_channel(
            "low", priority=1, concurrency_limit=1, allow_sharing=False
        )

        failed = self.scheduler.link_failed("a")
        self.assertEqual(failed.placement("exclusive").status, ChannelStatus.DEGRADED)
        self.assertEqual(failed.placement("exclusive").allocations, {"b": 1})
        self.assertEqual(failed.placement("low").status, ChannelStatus.REJECTED)

        recovered = self.scheduler.link_recovered("a")
        self.assertEqual(
            recovered.placement("exclusive").allocations, {"a": 1, "b": 1}
        )
        self.assertEqual(recovered.placement("low").status, ChannelStatus.REJECTED)
        total_exclusive = sum(
            link_load.get("exclusive", 0)
            for link_load in recovered.link_loads.values()
        )
        self.assertEqual(total_exclusive, 2)
        self.assertNotIn("low", recovered.link_loads["a"])
        self.assertNotIn("low", recovered.link_loads["b"])

    def test_higher_priority_is_satisfied_before_lower_priority_admission(self) -> None:
        self.scheduler.add_link("a", capacity=1)
        self.scheduler.add_link("b", capacity=1)
        self.scheduler.register_channel(
            "critical", priority=10, concurrency_limit=2, allow_sharing=False
        )
        plan = self.scheduler.register_channel(
            "bulk", priority=1, concurrency_limit=1, allow_sharing=False
        )

        self.assertEqual(plan.placement("critical").status, ChannelStatus.FULL)
        self.assertEqual(plan.placement("critical").allocations, {"a": 1, "b": 1})
        self.assertEqual(plan.placement("bulk").status, ChannelStatus.REJECTED)
        self.assertEqual(plan.placement("bulk").reason_code, "ISOLATION_CONFLICT")
        self.assertIn("priority=10", plan.placement("bulk").reason)

        failed = self.scheduler.link_failed("b")
        self.assertEqual(failed.placement("critical").status, ChannelStatus.DEGRADED)
        self.assertEqual(failed.placement("critical").granted, 1)
        self.assertEqual(failed.placement("bulk").status, ChannelStatus.REJECTED)

        recovered = self.scheduler.link_recovered("b")
        self.assertEqual(recovered.placement("critical").status, ChannelStatus.FULL)
        self.assertEqual(recovered.placement("bulk").status, ChannelStatus.REJECTED)

    def test_finite_capacity_shared_link_never_exceeds_capacity(self) -> None:
        self.scheduler.add_link("a", capacity=2)
        for index, priority in enumerate((5, 4, 3)):
            self.scheduler.register_channel(
                f"shared-{index}",
                priority=priority,
                concurrency_limit=1,
                allow_sharing=True,
            )
        plan = self.scheduler.current_plan

        self.assertEqual(sum(plan.link_loads["a"].values()), 2)
        rejected = plan.rejected_channels
        self.assertEqual(len(rejected), 1)
        self.assertEqual(rejected[0].channel_id, "shared-2")
        self.assertEqual(rejected[0].reason_code, "INSUFFICIENT_CAPACITY")
        self.assertIn("sharable but full", rejected[0].reason)

    def test_capacity_and_snapshot_are_consistent_under_concurrent_events(self) -> None:
        self.scheduler.add_link("a", capacity=2)
        self.scheduler.add_link("b", capacity=2)
        errors: list[Exception] = []

        def add_channels() -> None:
            try:
                for index in range(10):
                    self.scheduler.register_channel(
                        f"c{index}",
                        priority=index,
                        concurrency_limit=2,
                        allow_sharing=index % 2 == 0,
                    )
            except Exception as exc:  # pragma: no cover - failure reporting
                errors.append(exc)

        def toggle_links() -> None:
            try:
                for _ in range(10):
                    self.scheduler.link_failed("a")
                    self.scheduler.link_recovered("a")
            except Exception as exc:  # pragma: no cover - failure reporting
                errors.append(exc)

        first = threading.Thread(target=add_channels)
        second = threading.Thread(target=toggle_links)
        first.start()
        second.start()
        first.join()
        second.join()

        self.assertEqual(errors, [])
        plan = self.scheduler.current_plan
        for link_id, link_load in plan.link_loads.items():
            self.assertLessEqual(sum(link_load.values()), 2)
            if len(link_load) > 1:
                for channel_id in link_load:
                    index = int(channel_id.removeprefix("c"))
                    self.assertTrue(index % 2 == 0)
        for placement in plan.placements.values():
            self.assertLessEqual(placement.granted, placement.requested)

    def test_rejection_without_any_link_reports_available_resource_failure(self) -> None:
        plan = self.scheduler.register_channel(
            "orphan", priority=3, concurrency_limit=1, allow_sharing=True
        )

        rejected = plan.placement("orphan")
        self.assertEqual(rejected.status, ChannelStatus.REJECTED)
        self.assertEqual(rejected.granted, 0)
        self.assertEqual(rejected.reason_code, "NO_AVAILABLE_LINKS")
        self.assertIn("no healthy link", rejected.reason)


if __name__ == "__main__":
    unittest.main()
