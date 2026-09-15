"""需求 7：查询接口与稳定排序。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestQueries(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel(start=100)
        self.k.add_pool(cp.PoolConfig(
            "zeta", capacity=3, max_queue=5,
            quotas={"alpha": 2, "beta": 1}))
        self.k.add_pool(cp.PoolConfig(
            "alpha", capacity=2, quotas={"alpha": 2}))

    def test_pool_stats_fields(self):
        # 容量 3：alpha*2 + beta*1 打满物理容量
        c = self.k.acquire("zeta", "alpha", "job").connection_id
        self.k.acquire("zeta", "alpha", "job2")
        self.k.acquire("zeta", "beta", "job3")
        # gamma 有配额但池已满 -> 排队
        self.k.set_quotas("zeta", {"alpha": 2, "beta": 1, "gamma": 2})
        t = self.k.acquire("zeta", "gamma", "queued")
        self.assertTrue(t.is_queued)
        s = self.k.pool_stats("zeta")
        self.assertEqual(s.to_dict(), {
            "pool_id": "zeta", "capacity": 3, "used": 3,
            "idle": 0, "queued": 1, "health": "healthy",
        })
        self.k.release("zeta", c, "alpha")
        s = self.k.pool_stats("zeta")
        # 归还给队首 gamma 兑现：used 仍为 3，queued=0
        self.assertEqual((s.used, s.idle, s.queued), (3, 0, 0))

    def test_all_pool_stats_sorted(self):
        ids = [s.pool_id for s in self.k.all_pool_stats()]
        self.assertEqual(ids, ["alpha", "zeta"])

    def test_tenant_usage_and_available(self):
        self.k.acquire("zeta", "alpha")
        u = self.k.tenant_usage("zeta", "alpha")
        self.assertEqual((u.quota, u.used, u.available), (2, 1, 1))
        self.k.acquire("zeta", "alpha")
        self.assertEqual(self.k.tenant_usage("zeta", "alpha").available, 0)
        # 未配置租户查询报错
        with self.assertRaises(cp.InvalidConfigError):
            self.k.tenant_usage("zeta", "ghost")

    def test_all_tenant_usage_stable_order_and_zero_rows(self):
        rows = self.k.all_tenant_usage()
        self.assertEqual([(r.pool_id, r.tenant) for r in rows], [
            ("alpha", "alpha"),
            ("zeta", "alpha"),
            ("zeta", "beta"),
        ])
        # 占用为 0 的已配置租户也出现
        self.assertEqual(rows[2].used, 0)

    def test_connection_view_fields_and_duration(self):
        cid = self.k.acquire("zeta", "beta", "scrape").connection_id
        self.clock.advance(4)
        v = self.k.connection_view("zeta", cid)
        self.assertEqual(v.state, "borrowed")
        self.assertEqual(v.tenant, "beta")
        self.assertEqual(v.purpose, "scrape")
        self.assertEqual(v.borrowed_at, 100)
        self.assertEqual(v.borrow_duration, 4)
        self.assertIsNone(v.idle_duration)
        d = v.to_dict()
        self.assertEqual(d["borrow_duration"], 4)

    def test_all_connections_sorted(self):
        ids = [c.conn_id for c in self.k.all_connections()]
        self.assertEqual(ids, sorted(ids))
        zeta = [c.conn_id for c in self.k.all_connections("zeta")]
        self.assertTrue(all(c.startswith("zeta-") for c in zeta))

    def test_queued_requests_listed_in_order(self):
        k2, _ = make_kernel()
        k2.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                  quotas={"a": 3}))
        k2.acquire("p", "a", "hold")
        k2.acquire("p", "a", "q1")
        k2.acquire("p", "a", "q2")
        reqs = k2.queued_requests("p")
        self.assertEqual([r["purpose"] for r in reqs], ["q1", "q2"])
        self.assertEqual([r["status"] for r in reqs], ["waiting", "waiting"])


if __name__ == "__main__":
    unittest.main()
