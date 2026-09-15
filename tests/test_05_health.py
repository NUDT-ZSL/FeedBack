"""需求 6：不健康/下线摘流与恢复。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestHealth(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel()
        self.k.add_pool(cp.PoolConfig("p", capacity=3, idle_ttl=-1,
                                      max_queue=-1, quotas={"a": 3, "b": 3}))

    def test_unhealthy_stops_acquire_and_reaps_idle(self):
        idle_id = self.k.acquire("p", "a", "x").connection_id
        self.k.release("p", idle_id, "a")
        held = self.k.acquire("p", "b", "y").connection_id

        self.k.mark_unhealthy("p")
        self.assertEqual(self.k.pool_health("p"), "unhealthy")
        # 空闲连接被逐步回收
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", idle_id)
        # 借出中的连接不中断
        self.assertEqual(self.k.connection_view("p", held).state, "borrowed")
        # 新借出被拒，原因明确
        with self.assertRaises(cp.PoolUnhealthyError) as cm:
            self.k.acquire("p", "a", "z")
        self.assertEqual(cm.exception.reason, cp.Reason.POOL_UNHEALTHY)

    def test_unhealthy_queue_requests_rejected_not_enqueued(self):
        self.k.acquire("p", "a", "hold")
        self.k.mark_unhealthy("p")
        with self.assertRaises(cp.PoolUnhealthyError):
            self.k.acquire("p", "a", "q")
        self.assertEqual(self.k.pool_stats("p").queued, 0)

    def test_borrowed_connection_not_reused_after_return(self):
        cid = self.k.acquire("p", "a", "keep").connection_id
        self.k.mark_down("p")
        self.assertEqual(self.k.pool_health("p"), "down")
        # 归还后直接关闭，不进空闲集
        self.k.release("p", cid, "a")
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", cid)
        self.assertEqual((self.k.pool_stats("p").used,
                          self.k.pool_stats("p").idle), (0, 0))

    def test_recover_healthy_accepts_and_creates_new(self):
        cid = self.k.acquire("p", "a", "x").connection_id
        self.k.mark_unhealthy("p")
        self.k.release("p", cid, "a")  # 归还即关
        self.k.mark_healthy("p")
        r = self.k.acquire("p", "b", "after-recovery")
        self.assertTrue(r.is_acquired)
        self.assertEqual(r.connection.last_tenant, None)  # 全新连接

    def test_recover_pumps_waiting_queue(self):
        k2, clock2 = make_kernel()
        k2.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                  quotas={"a": 2}))
        held = k2.acquire("p", "a", "hold").connection_id
        t = k2.acquire("p", "a", "wait")
        self.assertTrue(t.is_queued)
        k2.mark_unhealthy("p")   # 摘流不取消已排队请求
        self.assertEqual(
            k2.ticket_status("p", t.ticket.ticket_id)["status"], "waiting")
        k2.release("p", held, "a")  # 摘流期间归还：关闭，不兑现
        self.assertEqual(
            k2.ticket_status("p", t.ticket.ticket_id)["status"], "waiting")
        self.assertEqual(k2.pool_stats("p").idle, 0)
        k2.mark_healthy("p")
        # 恢复瞬间 pump：容量空闲，新建连接兑现队首
        got = k2.ticket_status("p", t.ticket.ticket_id)
        self.assertEqual(got["status"], "fulfilled")
        self.assertEqual(k2.pool_stats("p").used, 1)

    def test_health_transitions_audited(self):
        self.k.mark_unhealthy("p")
        self.k.mark_healthy("p")
        kinds = [(e["kind"], e.get("old"), e.get("new"))
                 for e in self.k.events("p") if e["kind"] == "pool_health_changed"]
        self.assertEqual(kinds, [
            ("pool_health_changed", "healthy", "unhealthy"),
            ("pool_health_changed", "unhealthy", "healthy"),
        ])


if __name__ == "__main__":
    unittest.main()
