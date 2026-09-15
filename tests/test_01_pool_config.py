"""需求 1：池创建的标识唯一、容量与配额校验。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestPoolCreation(unittest.TestCase):
    def setUp(self):
        self.k, _ = make_kernel()

    def test_duplicate_pool_id_rejected(self):
        cfg = cp.PoolConfig("p1", capacity=2, quotas={"a": 2})
        self.k.add_pool(cfg)
        with self.assertRaises(cp.PoolExistsError) as cm:
            self.k.add_pool(cp.PoolConfig("p1", capacity=5, quotas={"a": 5}))
        self.assertEqual(cm.exception.reason, cp.Reason.POOL_EXISTS)
        # 重复创建不得影响原配置
        self.assertEqual(self.k.pool_stats("p1").capacity, 2)

    def test_zero_capacity_rejected(self):
        for cap in (0, -1):
            with self.subTest(cap=cap):
                with self.assertRaises(cp.InvalidConfigError) as cm:
                    self.k.add_pool(
                        cp.PoolConfig(f"p{cap}", capacity=cap, quotas={"a": 1}))
                self.assertEqual(cm.exception.reason, cp.Reason.INVALID_CONFIG)
                self.assertIn("容量", str(cm.exception))

    def test_negative_quota_rejected(self):
        with self.assertRaises(cp.InvalidConfigError) as cm:
            self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": -1}))
        self.assertEqual(cm.exception.reason, cp.Reason.INVALID_CONFIG)

    def test_bool_capacity_rejected(self):
        with self.assertRaises(cp.InvalidConfigError):
            self.k.add_pool(cp.PoolConfig("p", capacity=True, quotas={"a": 1}))

    def test_empty_pool_id_rejected(self):
        with self.assertRaises(cp.InvalidConfigError):
            self.k.add_pool(cp.PoolConfig("", capacity=2, quotas={"a": 1}))

    def test_unknown_pool_raises_not_found(self):
        with self.assertRaises(cp.PoolNotFoundError):
            self.k.pool_stats("nope")

    def test_quotas_sum_may_exceed_capacity(self):
        # 配额之和 5 > 容量 2，合法
        self.k.add_pool(cp.PoolConfig(
            "p", capacity=2, quotas={"a": 3, "b": 2}))
        self.assertEqual(self.k.pool_stats("p").capacity, 2)

    def test_creation_audited(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, idle_ttl=7,
                                      quotas={"a": 2}))
        ev = self.k.events("p")[0]
        self.assertEqual(ev["kind"], "pool_created")
        self.assertEqual(ev["capacity"], 2)
        self.assertEqual(ev["idle_ttl"], 7)


if __name__ == "__main__":
    unittest.main()
