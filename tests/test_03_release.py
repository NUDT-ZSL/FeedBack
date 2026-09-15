"""需求 4：归还的归属校验、重复归还拒绝、状态不变性。"""

import unittest

import connpool as cp
from tests._helpers import make_kernel


class TestRelease(unittest.TestCase):
    def setUp(self):
        self.k, self.clock = make_kernel()
        self.k.add_pool(cp.PoolConfig("p", capacity=2, quotas={"a": 2, "b": 2}))

    def test_normal_release_updates_state_and_audit(self):
        cid = self.k.acquire("p", "a", "job").connection_id
        self.clock.advance(3)
        self.k.release("p", cid, "a")
        v = self.k.connection_view("p", cid)
        self.assertEqual(v.state, "idle")
        self.assertIsNone(v.tenant)
        self.assertEqual(v.last_tenant, "a")
        self.assertEqual(v.idle_since, 3)
        rel = [e for e in self.k.events("p") if e["kind"] == "connection_released"]
        self.assertEqual(len(rel), 1)
        self.assertEqual(rel[0]["borrow_duration"], 3)
        self.assertEqual(self.k.pool_stats("p").used, 0)

    def test_double_release_rejected_without_state_change(self):
        cid = self.k.acquire("p", "a", "job").connection_id
        self.k.release("p", cid, "a")
        with self.assertRaises(cp.InvalidReleaseError) as cm:
            self.k.release("p", cid, "a")
        self.assertEqual(cm.exception.reason, cp.Reason.DOUBLE_RELEASE)
        # 再次归还同样拒绝；状态仍是一条空闲连接
        with self.assertRaises(cp.InvalidReleaseError):
            self.k.release("p", cid, "a")
        s = self.k.pool_stats("p")
        self.assertEqual((s.used, s.idle), (0, 1))

    def test_wrong_tenant_release_rejected_without_state_change(self):
        cid = self.k.acquire("p", "a", "job").connection_id
        before = self.k.connection_view("p", cid)
        with self.assertRaises(cp.InvalidReleaseError) as cm:
            self.k.release("p", cid, "b")
        self.assertEqual(cm.exception.reason, cp.Reason.WRONG_TENANT)
        after = self.k.connection_view("p", cid)
        # 持有租户、借出时刻、用途标记全部不变
        self.assertEqual(after.tenant, before.tenant)
        self.assertEqual(after.borrowed_at, before.borrowed_at)
        self.assertEqual(after.purpose, before.purpose)
        self.assertEqual(self.k.all_tenant_usage("p")[0].used,
                         self.k.all_tenant_usage("p")[0].used)
        usage = {u.tenant: u.used for u in self.k.all_tenant_usage("p")}
        self.assertEqual(usage, {"a": 1, "b": 0})
        # 真正的持有者仍可正常归还
        self.k.release("p", cid, "a")

    def test_release_unknown_connection(self):
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.release("p", "p-999", "a")
        with self.assertRaises(cp.ConnectionNotFoundError):
            self.k.release("other-pool", "p-1", "a")

    def test_borrowed_fields_recorded(self):
        cid = self.k.acquire("p", "b", "billing#42").connection_id
        v = self.k.connection_view("p", cid)
        self.assertEqual(v.tenant, "b")
        self.assertEqual(v.purpose, "billing#42")
        self.assertEqual(v.borrowed_at, 0)
        self.clock.advance(7)
        self.assertEqual(self.k.connection_view("p", cid).borrow_duration, 7)


if __name__ == "__main__":
    unittest.main()
