"""Treap 基础结构测试：增删查、排名、区间、批量构建、不变量。"""

import random
import unittest

from table_kernel.treap import DuplicateKeyError, Treap


class TreapTest(unittest.TestCase):
    def test_insert_and_order(self):
        t = Treap(lambda a, b: a < b, seed=1)
        data = random.Random(0).sample(range(5000), 1000)
        ref: list[int] = []
        for i, x in enumerate(data):
            t.insert(x, f"v{x}")
            # 维持参考有序列表
            lo, hi = 0, len(ref)
            while lo < hi:
                mid = (lo + hi) // 2
                if ref[mid] < x:
                    lo = mid + 1
                else:
                    hi = mid
            ref.insert(lo, x)
            if i % 97 == 0:
                t.verify()
                self.assertEqual([p for p in t.iter_payloads()],
                                 [f"v{k}" for k in ref])
        self.assertEqual(len(t), len(ref))
        t.verify()

    def test_rank_kth_count_less(self):
        t = Treap(lambda a, b: a < b, seed=2)
        keys = [random.Random(5).randrange(100000) for _ in range(2000)]
        keys = list(set(keys))
        for x in keys:
            t.insert(x, x * 10)
        ref = sorted(keys)
        for i, k in enumerate(ref):
            self.assertEqual(t.rank_of(k), i)
            self.assertEqual(t.kth_payload(i), k * 10)
        self.assertEqual(t.count_less(ref[0]), 0)
        self.assertEqual(t.count_less(ref[-1]), len(ref) - 1)
        self.assertEqual(t.count_less(ref[-1] + 1), len(ref))
        self.assertEqual(t.count_less(ref[0] - 1), 0)
        with self.assertRaises(IndexError):
            t.kth_payload(len(ref))
        with self.assertRaises(KeyError):
            t.rank_of(10 ** 9)

    def test_slice(self):
        t = Treap(lambda a, b: a < b, seed=9)
        n = 300
        for x in range(n):
            t.insert(x, f"id{x}")
        for lo, hi in [(0, 1), (0, n), (10, 20), (n - 5, n), (50, 50)]:
            self.assertEqual(t.slice_payloads(lo, hi),
                             [f"id{i}" for i in range(lo, hi)])
        with self.assertRaises(IndexError):
            t.slice_payloads(-1, 10)
        with self.assertRaises(IndexError):
            t.slice_payloads(0, n + 1)

    def test_remove_random(self):
        rng = random.Random(77)
        t = Treap(lambda a, b: a < b, seed=3)
        keys = rng.sample(range(3000), 800)
        for x in keys:
            t.insert(x, x)
        ref = sorted(keys)
        # 删除约一半
        victims = rng.sample(ref, 400)
        for x in victims:
            t.remove(x)
            ref.remove(x)
        t.verify()
        self.assertEqual([p for p in t.iter_payloads()], ref)
        # 再删光
        for x in list(ref):
            t.remove(x)
        self.assertEqual(len(t), 0)
        t.verify()
        with self.assertRaises(KeyError):
            t.remove(123456)

    def test_duplicate_insert(self):
        t = Treap(lambda a, b: a < b, seed=4)
        t.insert(1, "a")
        with self.assertRaises(DuplicateKeyError):
            t.insert(1, "b")
        self.assertEqual(len(t), 1)

    def test_bulk_build(self):
        rng = random.Random(123)
        keys = rng.sample(range(20000), 5000)
        pairs = sorted((k, f"v{k}") for k in keys)
        t = Treap(lambda a, b: a < b, seed=11)
        t.build_sorted(pairs)
        t.verify()
        self.assertEqual([p for p in t.iter_payloads()],
                         [p for _, p in pairs])
        self.assertEqual(len(t), len(pairs))
        for i in range(0, len(pairs), 251):
            self.assertEqual(t.rank_of(pairs[i][0]), i)
        # 空构建
        empty = Treap(lambda a, b: a < b)
        empty.build_sorted([])
        empty.verify()
        self.assertEqual(len(empty), 0)

    def test_bulk_build_then_mixed_ops(self):
        rng = random.Random(99)
        keys = rng.sample(range(5000), 1000)
        t = Treap(lambda a, b: a < b, seed=5)
        t.build_sorted(sorted((k, k) for k in keys))
        ref = sorted(keys)
        # 插入新键
        new = rng.sample(range(5000, 9000), 300)
        for x in new:
            t.insert(x, x)
            ins = 0
            while ins < len(ref) and ref[ins] < x:
                ins += 1
            ref.insert(ins, x)
        t.verify()
        for x in rng.sample(new, 200):
            t.remove(x)
            ref.remove(x)
        t.verify()
        self.assertEqual([p for p in t.iter_payloads()], ref)

    def test_descending_comparator(self):
        t = Treap(lambda a, b: a > b, seed=8)
        for x in range(1000):
            t.insert(x, x)
        t.verify()
        self.assertEqual(t.slice_payloads(0, 5), [999, 998, 997, 996, 995])
        self.assertEqual(t.rank_of(999), 0)
        self.assertEqual(t.rank_of(0), 999)

    def test_tuple_keys(self):
        t = Treap(lambda a, b: a < b, seed=6)
        pairs = [(("a", i), f"x{i}") for i in range(100)]
        pairs += [(("b", i), f"y{i}") for i in range(100)]
        t.build_sorted(sorted(pairs))
        self.assertEqual(t.kth_payload(100), "y0")
        t.verify()


if __name__ == "__main__":
    unittest.main()
