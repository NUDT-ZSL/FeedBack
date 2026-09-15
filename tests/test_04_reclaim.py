"""需求 5：TTL 空闲回收、池收缩、归还后关闭、计数不泄漏。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestReclaim(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel(start=0)

    def test_idle_ttl_reaped_on_advance(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=3, idle_ttl=10,
                                      quotas={"a": 3}))
        c1 = self.k.acquire("p", "a", "r").connection_id
        self.k.release("p", c1, "a")        # idle_since=0
        self.clock.advance(10)              # now=10，达到 TTL
        # advance 通过时钟监听自动驱动 reap + pump
        self.assertEqual(self.k.pool_stats("p").idle, 0)
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", c1)
        # TTL 后再借会新建，ID 严格递增
        c2 = self.k.acquire("p", "a", "r2").connection_id
        self.assertNotEqual(c1, c2)

    def test_idle_ttl_does_not_touch_borrowed(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, idle_ttl=5,
                                      quotas={"a": 2}))
        c1 = self.k.acquire("p", "a", "long-job").connection_id
        self.clock.advance(100)             # 借出中，绝不能被回收
        self.assertEqual(self.k.connection_view("p", c1).state, "borrowed")
        self.assertEqual(self.k.pool_stats("p").used, 1)

    def test_shrink_closes_idle_and_marks_borrowed(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=4, quotas={"a": 4}))
        ids = [self.k.acquire("p", "a", f"r{i}").connection_id for i in range(4)]
        self.k.release("p", ids[0], "a")    # 空闲
        self.k.release("p", ids[1], "a")    # 空闲
        res = self.k.shrink_pool("p", 2)
        self.assertEqual(res["closed_idle"], 2)
        self.assertEqual(res["marked_borrowed"], 0)
        # 收缩到 2，当前两条借出，没有空闲
        s = self.k.pool_stats("p")
        self.assertEqual((s.capacity, s.used, s.idle), (2, 2, 0))

        out = self.k.shrink_pool("p", 1)
        # 容量收缩到 1：没有空闲可关，超出的 1 条借出连接打归还即关标记
        self.assertEqual((out["closed_idle"], out["marked_borrowed"]), (0, 1))
        # 借出中的连接不能中断：仍可查、仍由 a 持有
        for cid in ids[2:]:
            v = self.k.connection_view("p", cid)
            self.assertEqual(v.state, "borrowed")
        retired = [cid for cid in ids[2:]
                   if self.k.connection_view("p", cid).retire_on_return]
        survivor = next(cid for cid in ids[2:] if cid not in retired)
        self.assertEqual(len(retired), 1)
        # 标记退役的连接归还后立即关闭；未标记的连接归还后正常入空闲集
        self.k.release("p", retired[0], "a")
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", retired[0])
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle, s.capacity), (1, 0, 1))
        self.k.release("p", survivor, "a")
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle, s.capacity), (0, 1, 1))

    def test_shrink_below_used_marks_all_excess(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=3, quotas={"a": 3}))
        ids = [self.k.acquire("p", "a").connection_id for _ in range(3)]
        # 3 条全部借出时直接收缩到 1：不拒绝、不中断，2 条标记归还即关
        res = self.k.shrink_pool("p", 1)
        self.assertEqual((res["closed_idle"], res["marked_borrowed"]), (0, 2))
        self.assertEqual(self.k.pool_stats("p").used, 3)
        for cid in ids:
            self.assertEqual(
                self.k.connection_view("p", cid).state, "borrowed")
        # 收缩期间不允许新建/兑现造成超额
        for cid in ids:
            self.k.release("p", cid, "a")
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle), (0, 1))  # 最后一条正常空闲

    def test_shrink_zero_rejected(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2}))
        with self.assertRaises(cp.InvalidConfigError):
            self.k.shrink_pool("p", 0)

    def test_grow_then_new_connects_possible(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=1, quotas={"a": 3}))
        self.k.shrink_pool("p", 3)
        self.k.acquire("p", "a")
        self.k.acquire("p", "a")
        self.assertEqual(self.k.pool_stats("p").used, 2)

    def test_retire_connection_idle_closes_immediately(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2}))
        c1 = self.k.acquire("p", "a").connection_id
        self.k.release("p", c1, "a")
        self.k.retire_connection("p", c1)
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", c1)

    def test_retire_connection_borrowed_marks_and_closes_on_return(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2}))
        c1 = self.k.acquire("p", "a").connection_id
        self.k.retire_connection("p", c1)
        v = self.k.connection_view("p", c1)
        self.assertTrue(v.retire_on_return)
        self.assertEqual(v.state, "borrowed")
        self.k.release("p", c1, "a")
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.connection_view("p", c1)

    def test_no_counter_leak_through_cycles(self):
        self.k.add_pool(cp.PoolConfig("p", capacity=2, idle_ttl=3,
                                      quotas={"a": 2}))
        for cycle in range(6):
            ids = [self.k.acquire("p", "a").connection_id for _ in range(2)]
            for cid in ids:
                self.k.release("p", cid, "a")
            self.clock.advance(4)  # 触发 TTL 全量回收
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle, s.capacity), (0, 0, 2))


if __name__ == "__main__":
    unittest.main()
