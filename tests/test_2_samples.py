"""需求 2：带误差定位序列的登记——幂等与时刻单调。"""

import unittest

from mapmatching import Point, SampleValidationError, Track


class TestTrackRegistration(unittest.TestCase):
    def test_monotonic_ticks_accepted(self):
        track = Track("v1")
        # tick 允许重复（同刻多源/多次上报），seq 必须各自唯一
        for seq, tick in enumerate([1, 1, 2, 3, 3, 10]):
            self.assertIsNotNone(
                track.add(tick, Point(float(tick), 0), "gps", 100 + seq)
            )
        self.assertEqual(len(track), 6)

    def test_tick_must_be_monotonic_non_decreasing(self):
        track = Track("v1")
        track.add(5, Point(0, 0), "gps", 1)
        with self.assertRaises(SampleValidationError) as ctx:
            track.add(4, Point(0, 0), "gps", 2)
        self.assertIn("单调不减", str(ctx.exception))

    def test_monotonic_is_per_source(self):
        # 不同来源各自维护单调序列，交错登记也允许
        track = Track("v1")
        track.add(10, Point(0, 0), "gps-a", 1)
        track.add(2, Point(0, 0), "gps-b", 1)
        track.add(11, Point(0, 0), "gps-a", 2)
        track.add(3, Point(0, 0), "gps-b", 2)
        self.assertEqual(len(track), 4)

    def test_duplicate_source_seq_is_idempotent(self):
        track = Track("v1")
        first = track.add(3, Point(10, 20), "gps", 7)
        # 完全相同的重复上报 -> 幂等忽略，返回 None，点数不增加
        again = track.add(3, Point(10, 20), "gps", 7)
        self.assertIsNotNone(first)
        self.assertIsNone(again)
        self.assertEqual(len(track), 1)
        self.assertEqual(len(track.duplicates), 1)
        self.assertEqual(track.duplicates[0].source, "gps")
        self.assertEqual(track.duplicates[0].seq, 7)

    def test_duplicate_seq_with_different_payload_is_rejected(self):
        track = Track("v1")
        track.add(3, Point(10, 20), "gps", 7)
        with self.assertRaises(SampleValidationError) as ctx:
            track.add(3, Point(11, 20), "gps", 7)  # 同序号不同坐标
        self.assertIn("矛盾", str(ctx.exception))
        self.assertEqual(len(track), 1)

    def test_same_seq_from_different_sources_allowed(self):
        track = Track("v1")
        track.add(1, Point(0, 0), "gps-a", 1)
        track.add(1, Point(0, 0), "gps-b", 1)
        self.assertEqual(track.sources(), ["gps-a", "gps-b"])
        self.assertEqual(len(track.by_tick()[1]), 2)

    def test_observations_grouped_by_tick_and_source(self):
        track = Track("v1")
        track.add(1, Point(0, 0), "a", 1)
        track.add(1, Point(1, 0), "b", 1)
        track.add(2, Point(2, 0), "a", 2)
        self.assertEqual([o.tick for o in track.by_source("a")], [1, 2])
        self.assertEqual(len(track.by_tick()[1]), 2)
        self.assertEqual(track.tick_range(), (1, 2))


if __name__ == "__main__":
    unittest.main()
