"""确定性随机流测试。"""
import math
import unittest
from collections import Counter

from rng_core.rng import RandomStream, normalize_type, DeterministicRandomError


class TestRandomStream(unittest.TestCase):
    def test_same_identity_same_sequence(self):
        a = RandomStream("exp", 7, 2, "d")
        b = RandomStream("exp", 7, 2, "d")
        self.assertEqual(a.uniform(0, 1, 8), b.uniform(0, 1, 8))

    def test_identity_parts_isolate_streams(self):
        base = RandomStream("exp", 1, 0, "d").uniform(0, 1, 6)
        for kwargs in (
            {"experiment_id": "exp2", "seed": 1, "step_index": 0, "draw_id": "d"},
            {"experiment_id": "exp", "seed": 2, "step_index": 0, "draw_id": "d"},
            {"experiment_id": "exp", "seed": 1, "step_index": 1, "draw_id": "d"},
            {"experiment_id": "exp", "seed": 1, "step_index": 0, "draw_id": "other"},
        ):
            other = RandomStream(**kwargs).uniform(0, 1, 6)
            self.assertNotEqual(base, other, kwargs)

    def test_type_counters_are_independent(self):
        # 同一流里只抽 gaussian 不应改变 uniform 序列（各类型独立计数器）。
        a = RandomStream("e", 1, 0)
        b = RandomStream("e", 1, 0)
        a.gaussian(0, 1, 5)
        self.assertEqual(a.uniform(0, 1, 8), b.uniform(0, 1, 8))

    def test_rewind_replays_exactly_and_resets_consumption(self):
        s = RandomStream("e", 3, 1)
        first = s.uniform(-1, 1, 10) + s.bernoulli(0.5, 7)
        self.assertEqual(s.consumed(), {"uniform": 10, "bernoulli": 7})
        s.rewind()
        self.assertEqual(s.consumed(), {})
        again = s.uniform(-1, 1, 10) + s.bernoulli(0.5, 7)
        self.assertEqual(first, again)

    def test_value_ranges(self):
        s = RandomStream("e", 5, 0)
        us = s.uniform(0, 1, 5000)
        self.assertTrue(all(0.0 <= x < 1.0 for x in us))
        self.assertAlmostEqual(sum(us) / len(us), 0.5, delta=0.03)

        ns = s.gaussian(0, 1, 5000)
        self.assertTrue(all(math.isfinite(x) for x in ns))
        self.assertAlmostEqual(sum(ns) / len(ns), 0.0, delta=0.05)
        self.assertAlmostEqual(sum(x * x for x in ns) / len(ns), 1.0, delta=0.08)

        ints = s.integer(-3, 4, 4000)
        self.assertTrue(all(-3 <= x <= 4 for x in ints))
        counts = Counter(ints)
        # 8 个桶，每桶约 500 次；容差很宽只查明显偏斜
        self.assertTrue(all(350 < counts[k] < 650 for k in range(-3, 5)))

        bs = s.bernoulli(0.25, 4000)
        self.assertTrue(all(v in (0, 1) for v in bs))
        self.assertAlmostEqual(sum(bs) / len(bs), 0.25, delta=0.04)

    def test_consumed_matches_requested_even_with_rejection(self):
        s = RandomStream("e", 9, 0)
        vals = s.integer(0, 2, 1000)  # 跨度 3 触发拒绝采样
        self.assertEqual(len(vals), 1000)
        self.assertEqual(s.consumed(), {"integer": 1000})

    def test_invalid_arguments(self):
        s = RandomStream("e", 1, 0)
        with self.assertRaises(DeterministicRandomError):
            s.uniform(1, 0, 3)
        with self.assertRaises(DeterministicRandomError):
            s.bernoulli(1.2, 3)
        with self.assertRaises(DeterministicRandomError):
            s.gaussian(0, -1, 3)
        self.assertEqual(normalize_type("Normal"), "gaussian")
        self.assertEqual(normalize_type("float"), "uniform")
        with self.assertRaises(DeterministicRandomError):
            normalize_type("exponential")

    def test_conservation_digest_stable_then_changes(self):
        s = RandomStream("e", 1, 0)
        s.uniform(0, 1, 4)
        d1 = s.conservation_digest()
        s2 = RandomStream("e", 1, 0)
        s2.uniform(0, 1, 4)
        self.assertEqual(d1, s2.conservation_digest())
        s2.uniform(0, 1, 1)
        self.assertNotEqual(d1, s2.conservation_digest())


if __name__ == "__main__":
    unittest.main()
