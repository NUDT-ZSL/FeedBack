"""ManualClock 的单元测试：推进、回退、高水位与序列化。"""

import unittest

from leasekernel.clock import ManualClock


class ManualClockTest(unittest.TestCase):
    def test_initial_reading(self) -> None:
        clk = ManualClock(7.0)
        self.assertEqual(clk.now, 7.0)
        self.assertEqual(clk.monotonic, 7.0)

    def test_advance_updates_both(self) -> None:
        clk = ManualClock(0.0)
        clk.advance(5)
        self.assertEqual(clk.now, 5.0)
        self.assertEqual(clk.monotonic, 5.0)
        clk.advance(2.5)
        self.assertEqual(clk.now, 7.5)
        self.assertEqual(clk.monotonic, 7.5)

    def test_advance_negative_rejected(self) -> None:
        clk = ManualClock(10.0)
        with self.assertRaises(ValueError):
            clk.advance(-1)
        self.assertEqual(clk.now, 10.0)

    def test_set_back_keeps_high_water_mark(self) -> None:
        clk = ManualClock(0.0)
        clk.advance(100)
        clk.set_time(20)  # 时钟回退
        self.assertEqual(clk.now, 20.0)
        self.assertEqual(clk.monotonic, 100.0)
        clk.set_time(50)  # 仍低于高水位
        self.assertEqual(clk.now, 50.0)
        self.assertEqual(clk.monotonic, 100.0)

    def test_jump_forward_raises_high_water_mark(self) -> None:
        clk = ManualClock(0.0)
        clk.set_time(1_000_000)  # 大幅向前跳变
        self.assertEqual(clk.now, 1_000_000.0)
        self.assertEqual(clk.monotonic, 1_000_000.0)
        clk.set_time(500_000)
        self.assertEqual(clk.monotonic, 1_000_000.0)

    def test_tick_increases_on_every_injection(self) -> None:
        clk = ManualClock(0.0)
        t0 = clk.tick
        clk.advance(1)
        clk.set_time(2)
        self.assertEqual(clk.tick, t0 + 2)

    def test_roundtrip(self) -> None:
        clk = ManualClock(0.0)
        clk.advance(100)
        clk.set_time(10)  # 回退后序列化
        restored = ManualClock.from_dict(clk.to_dict())
        self.assertEqual(restored.now, 10.0)
        self.assertEqual(restored.monotonic, 100.0)

    def test_from_dict_repairs_high_water_mark(self) -> None:
        # 即使数据被改成 high < now，恢复后单调读数也不得低于 now。
        restored = ManualClock.from_dict({"now": 50, "high": 3, "tick": 0})
        self.assertEqual(restored.now, 50.0)
        self.assertEqual(restored.monotonic, 50.0)

    def test_from_dict_errors(self) -> None:
        with self.assertRaises(ValueError):
            ManualClock.from_dict({"now": "x", "high": 1})
        with self.assertRaises(ValueError):
            ManualClock.from_dict({"now": 1})
        with self.assertRaises(ValueError):
            ManualClock.from_dict([1, 2])
        with self.assertRaises(ValueError):
            ManualClock.from_dict({"now": 1, "high": 2, "tick": -1})


if __name__ == "__main__":
    unittest.main()
