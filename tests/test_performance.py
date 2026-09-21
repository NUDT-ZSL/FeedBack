from __future__ import annotations

import time
import unittest

from relay_allocator import Channel, Link, allocate


class PerformanceTests(unittest.TestCase):
    def test_large_registration_set_recomputes_with_bounded_latency(self) -> None:
        channels = [
            Channel(
                channel_id=f"channel-{index}",
                priority=1,
                concurrency_limit=(index % 4) + 1,
                shareable=True,
            )
            for index in range(1000)
        ]
        links = [Link(f"link-{index}", capacity=8) for index in range(20)]

        started = time.perf_counter()
        plan = allocate(channels, links)
        elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 1.0)
        self.assertEqual(len(plan.assignments), 40)
        self.assertEqual(len(plan.rejections), 960)
        for usage in plan.link_usages.values():
            self.assertLessEqual(usage.reserved, usage.capacity)


if __name__ == "__main__":
    unittest.main()
