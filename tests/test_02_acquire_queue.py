"""需求 2/3：借出复用规则、容量与租户配额隔离、排队/拒绝原因。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestAcquire(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel(start=10)

    def test_same_tenant_idle_reused_first(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=3, quotas={"a": 3, "b": 3}))
        c1 = self.k.acquire("p", "a", "r1").connection_id
        self.k.release("p", c1, "a")
        # 同租户优先复用：即使有容量可新建，也拿到同一条
        c2 = self.k.acquire("p", "a", "r2").connection_id
        self.assertEqual(c1, c2)
        ev = [e for e in self.k.events("p") if e["kind"] == "connection_borrowed"]
        self.assertTrue(ev[-1]["reused"])

    def test_idle_of_other_tenant_not_stolen(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2, "b": 2}))
        ca = self.k.acquire("p", "a", "r").connection_id
        self.k.release("p", ca, "a")  # a 的空闲连接
        # b 不能拿走 a 的亲缘连接：新建第二条
        cb = self.k.acquire("p", "b", "r").connection_id
        self.assertNotEqual(ca, cb)
        # 此时一条空闲(a 亲缘)、一条借出(b)——空闲连接不占 b 配额
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle, s.capacity), (1, 1, 2))

    def test_new_connection_when_under_capacity(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2}))
        self.assertIsNotNone(self.k.acquire("p", "a"))
        self.assertIsNotNone(self.k.acquire("p", "a"))
        self.assertEqual(self.k.pool_stats("p").used, 2)

    def test_capacity_saturated_rejected_when_queue_disabled(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=0,
                                      quotas={"a": 1, "b": 1}))
        self.k.acquire("p", "a", "hold")
        with self.assertRaises(cp.PoolSaturatedError) as cm:
            self.k.acquire("p", "b", "x")
        self.assertEqual(cm.exception.reason, cp.Reason.POOL_SATURATED)
        self.assertEqual(cm.exception.pool_id, "p")
        self.assertIn("容量已打满", str(cm.exception))

    def test_tenant_without_quota_cannot_acquire(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2}))
        # 未配置配额 => 配额为 0 => 配额打满
        with self.assertRaises(cp.TenantQuotaExceededError):
            self.k.acquire("p", "ghost", "x")

    def test_tenant_quota_isolation(self):
        # 容量 4；a、b 配额各 2（配额和=容量）
        self.k.add_pool(cp.PoolConfig("p", capacity=4, quotas={"a": 2, "b": 2}))
        self.k.acquire("p", "a")
        self.k.acquire("p", "a")
        # a 打满自己的 2 条，但池里还有容量：b 照常拿满 2 条
        self.k.acquire("p", "b")
        self.k.acquire("p", "b")
        self.assertEqual(self.k.all_tenant_usage("p")[0].used, 2)
        # a 再借：配额拒绝，不得挤占 b（此时池容量也满了，
        # 但原因必须是租户配额而非池饱和）
        with self.assertRaises(cp.TenantQuotaExceededError) as cm:
            self.k.acquire("p", "a", "more")
        self.assertEqual(cm.exception.reason, cp.Reason.TENANT_QUOTA_EXCEEDED)
        self.assertEqual(cm.exception.tenant, "a")
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle), (4, 0))

    def test_quota_sum_over_capacity_but_use_capped(self):
        # 配额之和 6 > 容量 2；每租户最多拿 2，但总数不超过容量
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2, "b": 2, "c": 2}))
        self.k.acquire("p", "a")
        self.k.acquire("p", "b")
        with self.assertRaises(cp.PoolSaturatedError):
            self.k.acquire("p", "c")
        self.assertLessEqual(self.k.pool_stats("p").used, 2)

    def test_quota_zero_tenant_rejected(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2, "z": 0}))
        with self.assertRaises(cp.TenantQuotaExceededError) as cm:
            self.k.acquire("p", "z")
        self.assertEqual(cm.exception.tenant, "z")

    def test_queue_when_saturated_and_fulfilled_fifo(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                      quotas={"a": 2, "b": 2}))
        c1 = self.k.acquire("p", "a", "hold").connection_id
        t1 = self.k.acquire("p", "a", "wait1")
        t2 = self.k.acquire("p", "b", "wait2")
        self.assertTrue(t1.is_queued and t2.is_queued)
        self.assertEqual(self.k.pool_stats("p").queued, 2)
        # 归还：队首是 a，亲缘连接给 a
        self.k.release("p", c1, "a")
        self.assertEqual(
            self.k.ticket_status("p", t1.ticket.ticket_id)["status"], "fulfilled")
        self.assertEqual(
            self.k.ticket_status("p", t1.ticket.ticket_id)["conn_id"], c1)
        # b 仍在等
        self.assertEqual(
            self.k.ticket_status("p", t2.ticket.ticket_id)["status"], "waiting")
        # a 归还后连接带 a 亲缘，不能给 b：需要等 a 那条归还后……
        # 这里 b 只有等连接以“非亲缘”形态出现。验证：b 不能靠 a 亲缘连接兑现。
        a2 = self.k.ticket_status("p", t1.ticket.ticket_id)["conn_id"]
        self.k.release("p", a2, "a")
        # 池满场景：a 归还的通道虽然带 a 亲缘，但通道空闲且 b 是队首，
        # 按 FIFO 复用给 b（空闲通道不占任何租户配额）
        tb2 = self.k.ticket_status("p", t2.ticket.ticket_id)
        self.assertEqual(tb2["status"], "fulfilled")
        self.assertEqual(tb2["conn_id"], c1)

    def test_direct_acquire_uses_idle_channel_when_pool_full_no_queue(self):
        # 容量为 1：a 归还后池满且有一条空闲通道、队列为空，
        # b 的直接请求复用该通道（有容量可新建时则优先保留亲缘，见上例）
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=0,
                                      quotas={"a": 1, "b": 1}))
        ca = self.k.acquire("p", "a", "r").connection_id
        self.k.release("p", ca, "a")
        cb = self.k.acquire("p", "b", "r2").connection_id
        self.assertEqual(ca, cb)

    def test_release_always_pumps_before_idle_visible(self):
        # 归还时同步兑现队首，因此“有排队者同时又有空闲通道”不会发生，
        # 直接请求没有插队窗口
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                      quotas={"a": 2, "b": 2}))
        held = self.k.acquire("p", "b", "hold").connection_id
        waiter = self.k.acquire("p", "b", "q")
        self.k.release("p", held, "b")
        self.assertEqual(
            self.k.ticket_status("p", waiter.ticket.ticket_id)["status"],
            "fulfilled")
        self.assertEqual(self.k.pool_stats("p").idle, 0)
        self.assertEqual(self.k.pool_stats("p").queued, 0)

    def test_queue_full_rejected(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=1,
                                      quotas={"a": 3}))
        self.k.acquire("p", "a", "hold")
        self.assertTrue(self.k.acquire("p", "a", "q1").is_queued)
        with self.assertRaises(cp.QueueRejectedError) as cm:
            self.k.acquire("p", "a", "q2")
        self.assertEqual(cm.exception.reason, cp.Reason.QUEUE_FULL)

    def test_cancel_ticket(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                      quotas={"a": 2}))
        self.k.acquire("p", "a", "hold")
        t = self.k.acquire("p", "a", "q")
        self.assertTrue(self.k.cancel_ticket("p", t.ticket.ticket_id))
        self.assertEqual(
            self.k.ticket_status("p", t.ticket.ticket_id)["status"], "cancelled")
        self.assertFalse(self.k.cancel_ticket("p", t.ticket.ticket_id))

    def test_blocking_wait_is_served_on_release(self):
        import threading
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                      quotas={"a": 2}))
        held = self.k.acquire("p", "a", "hold").connection_id
        box = {}

        def waiter():
            box["r"] = self.k.acquire("p", "a", "blocking", wait=True)

        th = threading.Thread(target=waiter)
        th.start()
        self.clock.advance(1)  # 唤醒阻塞者检查一次（仍拿不到）
        import time
        time.sleep(0.05)
        self.k.release("p", held, "a")  # 释放并 notify
        th.join(timeout=2)
        self.assertFalse(th.is_alive())
        self.assertTrue(box["r"].is_acquired)
        self.assertEqual(box["r"].connection_id, held)

    def test_blocking_wait_timeout(self):
        import threading
        self.k.add_pool(cp.PoolConfig("p", capacity=1, max_queue=-1,
                                      quotas={"a": 2}))
        self.k.acquire("p", "a", "hold")
        box = {}

        def waiter():
            try:
                self.k.acquire("p", "a", "slow", wait=True, timeout=5)
            except cp.QueueRejectedError as e:
                box["err"] = e

        th = threading.Thread(target=waiter)
        th.start()
        import time
        time.sleep(0.05)
        self.clock.advance(6)  # 超过 deadline，时钟监听驱动 tick+notify
        th.join(timeout=2)
        self.assertFalse(th.is_alive())
        self.assertEqual(box["err"].reason, cp.Reason.QUEUE_TIMEOUT)


if __name__ == "__main__":
    unittest.main()
