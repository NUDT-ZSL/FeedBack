from __future__ import annotations

import unittest

from relay_allocator import (
    Channel,
    Link,
    LinkState,
    RejectionReason,
    allocate,
)


class SchedulerTests(unittest.TestCase):
    def test_shareable_channels_are_packed_with_isolation_preserved(self) -> None:
        plan = allocate(
            channels=[
                Channel("shared-a", priority=1, concurrency_limit=3, shareable=True),
                Channel("shared-b", priority=1, concurrency_limit=2, shareable=True),
                Channel("isolated", priority=1, concurrency_limit=4, shareable=False),
            ],
            links=[Link("l1", capacity=8), Link("l2", capacity=8)],
        )

        shared_link = plan.assignments["shared-a"].link_id
        self.assertEqual(plan.assignments["shared-b"].link_id, shared_link)
        isolated_link = plan.assignments["isolated"].link_id
        self.assertNotEqual(shared_link, isolated_link)
        self.assertEqual(plan.link_usages[shared_link].reserved, 5)
        self.assertEqual(
            plan.link_usages[isolated_link].channel_ids,
            ("isolated",),
        )

    def test_non_shareable_channel_cannot_share_even_with_capacity(self) -> None:
        plan = allocate(
            channels=[
                Channel("shared", priority=10, concurrency_limit=1, shareable=True),
                Channel("isolated", priority=1, concurrency_limit=1, shareable=False),
            ],
            links=[Link("only", capacity=10)],
        )

        self.assertEqual(plan.assignments["shared"].link_id, "only")
        self.assertIn("isolated", plan.rejections)
        self.assertEqual(
            plan.rejections["isolated"].reason,
            RejectionReason.NO_EXCLUSIVE_LINK,
        )

    def test_higher_priority_channels_preempt_limited_links_on_recompute(self) -> None:
        first = allocate(
            [Channel("low", priority=1, concurrency_limit=1, shareable=False)],
            [Link("only", capacity=4)],
        )
        self.assertEqual(first.assignments["low"].link_id, "only")

        second = allocate(
            [
                Channel("low", priority=1, concurrency_limit=1, shareable=False),
                Channel("high", priority=10, concurrency_limit=1, shareable=False),
            ],
            [Link("only", capacity=4)],
            current_assignments={"low": "only"},
        )

        self.assertEqual(second.assignments["high"].link_id, "only")
        self.assertIn("low", second.rejections)

    def test_capacity_limit_is_reserved_for_every_shared_channel(self) -> None:
        plan = allocate(
            [
                Channel("a", priority=5, concurrency_limit=4, shareable=True),
                Channel("b", priority=4, concurrency_limit=4, shareable=True),
                Channel("c", priority=3, concurrency_limit=3, shareable=True),
            ],
            [Link("l1", capacity=8), Link("l2", capacity=4)],
        )

        self.assertEqual(plan.assignments["a"].link_id, "l2")
        self.assertEqual(plan.assignments["b"].link_id, "l1")
        self.assertEqual(plan.assignments["c"].link_id, "l1")
        self.assertEqual(plan.link_usages["l1"].reserved, 7)

    def test_no_links_reports_explicit_rejections(self) -> None:
        plan = allocate(
            [Channel("a", priority=1, concurrency_limit=1, shareable=True)],
            [],
        )

        self.assertEqual(
            plan.rejections["a"].reason,
            RejectionReason.NO_LINKS,
        )

    def test_down_links_are_not_used(self) -> None:
        plan = allocate(
            [Channel("a", priority=1, concurrency_limit=1, shareable=True)],
            [Link("down", capacity=4, state=LinkState.DOWN)],
        )

        self.assertIn("a", plan.rejections)

    def test_channel_larger_than_link_capacity_is_rejected(self) -> None:
        plan = allocate(
            [Channel("big", priority=10, concurrency_limit=5, shareable=True)],
            [Link("small", capacity=4)],
        )

        self.assertEqual(
            plan.rejections["big"].reason,
            RejectionReason.CHANNEL_EXCEEDS_LINK_CAPACITY,
        )

    def test_exact_search_avoids_false_packing_failure(self) -> None:
        plan = allocate(
            [
                Channel("first-small", priority=5, concurrency_limit=2, shareable=True),
                Channel("large", priority=5, concurrency_limit=6, shareable=True),
                Channel("second-small", priority=5, concurrency_limit=2, shareable=True),
            ],
            [Link("l1", capacity=8), Link("l2", capacity=6)],
        )

        self.assertEqual(
            set(plan.assignments),
            {"first-small", "large", "second-small"},
        )
        self.assertEqual(plan.assignments["large"].link_id, "l2")
        self.assertEqual(
            plan.assignments["first-small"].link_id,
            plan.assignments["second-small"].link_id,
        )

    def test_equal_priority_tie_break_is_stable_and_explicit(self) -> None:
        first = allocate(
            [Channel("a", priority=5, concurrency_limit=1, shareable=False)],
            [Link("only", capacity=4)],
        )
        second = allocate(
            [
                Channel("a", priority=5, concurrency_limit=1, shareable=False),
                Channel("b", priority=5, concurrency_limit=1, shareable=False),
            ],
            [Link("only", capacity=4)],
            current_assignments={"a": first.assignments["a"].link_id},
        )

        self.assertEqual(second.assignments["a"].link_id, "only")
        self.assertIn("b", second.rejections)
        self.assertIn("exact placement", second.rejections["b"].explanation)


if __name__ == "__main__":
    unittest.main()
