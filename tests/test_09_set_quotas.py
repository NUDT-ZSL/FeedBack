"""配额动态调整规则：不得缩到占用以下、不得删除有等待请求的租户配额。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestSetQuotas(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel()
        self.k.add_pool(cp.PoolConfig("p", capacity=3, max_queue=-1,
                                      quotas={"a": 2, "b": 2}))

    def test_shrink_below_in_use_rejected(self):
        self.k.acquire("p", "a")
        self.k.acquire("p", "a")
        with self.assertRaises(cp.InvalidConfigError) as cm:
            self.k.set_quotas("p", {"a": 1, "b": 2})
        self.assertEqual(cm.exception.reason, cp.Reason.INVALID_QUOTA)
        self.assertEqual(self.k.tenant_usage("p", "a").quota, 2)

    def test_drop_tenant_without_usage_ok(self):
        self.k.set_quotas("p", {"a": 2})  # b 当前占用 0，可删
        with self.assertRaises(cp.InvalidConfigError):
            self.k.tenant_usage("p", "b")

    def test_drop_waiting_tenant_rejected(self):
        self.k.acquire("p", "a")
        self.k.acquire("p", "a")
        self.k.acquire("p", "b")  # 容量 3 打满
        t = self.k.acquire("p", "b", "wait")
        self.assertTrue(t.is_queued)
        with self.assertRaises(cp.InvalidConfigError):
            self.k.set_quotas("p", {"a": 2})  # 删掉有等待请求的 b
        # b 的票据仍可在放宽配额/归还后兑现
        self.k.set_quotas("p", {"a": 2, "b": 3})

    def test_grow_quota_pumps_queue(self):
        self.k.set_quotas("p", {"a": 1, "b": 2})
        self.k.acquire("p", "a")            # a 占 1
        self.k.acquire("p", "b")
        self.k.acquire("p", "b")            # 池满
        t = self.k.acquire("p", "a", "more")
        self.assertTrue(t.is_queued)        # a 配额 1
        # 扩容物理容量不能直接解决，但归还后队首 a 复用；
        # 这里验证仅放宽配额而有空闲时能 pump：构造空闲
        # 直接验证 set_quotas 自身不报错且排队保持
        self.k.set_quotas("p", {"a": 3, "b": 2})
        # 容量仍满，需等归还；归还一条 b 的连接，池满情况下空闲通道
        # 经 FIFO 给队首 a
        conns = [c.conn_id for c in self.k.all_connections("p")
                 if c.tenant == "b"]
        self.k.release("p", conns[0], "b")
        self.assertEqual(
            self.k.ticket_status("p", t.ticket.ticket_id)["status"],
            "fulfilled")

    def test_negative_quota_update_rejected(self):
        with self.assertRaises(cp.InvalidConfigError):
            self.k.set_quotas("p", {"a": -1})


if __name__ == "__main__":
    unittest.main()
