"""多租户并发竞争压力测试：验证任何时刻都不超卖、计数不泄漏、不发生死锁。"""

import random
import threading
import time
import unittest
from collections import Counter

import connpool as cp
from tests._helpers import make_kernel


class TestConcurrency(unittest.TestCase):
    def test_contention_invariants_hold(self):
        clock = cp.ManualClock(0)
        k = cp.PoolKernel(clock)
        k.add_pool(cp.PoolConfig(
            "p", capacity=4, idle_ttl=30, max_queue=-1,
            quotas={"a": 4, "b": 4, "c": 4}))

        rng = random.Random(42)
        stop = threading.Event()
        errors: list[BaseException] = []
        tenants = ["a", "b", "c"]

        def check_invariants():
            s = k.pool_stats("p")
            self.assertLessEqual(s.used, s.capacity)
            self.assertLessEqual(s.used + s.idle, s.capacity)
            usage = k.all_tenant_usage("p")
            total = 0
            for u in usage:
                self.assertLessEqual(
                    u.used, u.quota,
                    f"租户 {u.tenant} 占用 {u.used} 超过配额 {u.quota}")
                total += u.used
            self.assertEqual(total, s.used, "租户占用之和必须等于池已用数")
            return s

        def worker(tenant: str):
            try:
                for i in range(80):
                    r = k.acquire("p", tenant, f"{tenant}-{i}", wait=True)
                    if not r.is_acquired:
                        raise AssertionError("阻塞等待必须最终拿到连接")
                    check_invariants()
                    # 推进逻辑时钟会触发 TTL 回收（在锁外回调，线程安全）
                    if rng.random() < 0.2:
                        clock.advance(rng.randint(1, 40))
                    time.sleep(rng.random() * 0.002)
                    k.release("p", r.connection_id, tenant)
                    check_invariants()
            except BaseException as exc:  # noqa: BLE001 - 测试中收集所有异常
                errors.append(exc)

        threads = [threading.Thread(target=worker, args=(t,))
                   for t in tenants for _ in range(3)]
        for th in threads:
            th.start()

        def driver():
            end = time.time() + 3
            while time.time() < end and not stop.is_set():
                clock.advance(5)
                time.sleep(0.01)

        dth = threading.Thread(target=driver)
        dth.start()
        for th in threads:
            th.join(timeout=10)
            self.assertFalse(th.is_alive(), "发生死锁：工作线程未能结束")
        stop.set()
        dth.join(timeout=2)
        self.assertEqual(errors, [])

        # 全部归还后的稳态
        s = check_invariants()
        self.assertEqual(s.used, 0)
        self.assertEqual(s.queued, 0)

        # 事件账目必须轧平：
        # 创建数 - 关闭数 == 当前连接数；借出次数 - 归还次数 == 当前借出数
        kinds = Counter(e["kind"] for e in k.events("p"))
        self.assertEqual(
            kinds["connection_created"] - kinds["connection_closed"],
            len(k.all_connections("p")))
        self.assertEqual(
            kinds["connection_borrowed"] - kinds["connection_released"], 0)
        # 每一次关闭都有明确原因，可追溯
        for e in k.events("p"):
            if e["kind"] == "connection_closed":
                self.assertIn(e["reason"],
                              {"idle_ttl", "shrink", "manual_retire",
                               "retire_on_return", "pool_unhealthy",
                               "pool_down"})

    def test_concurrent_snapshot_does_not_corrupt_state(self):
        k, clock = make_kernel()
        k.add_pool(cp.PoolConfig("p", capacity=3, idle_ttl=20, max_queue=-1,
                                 quotas={"a": 3, "b": 3}))
        errors: list[BaseException] = []
        stop = threading.Event()

        def worker(tenant):
            try:
                for i in range(60):
                    r = k.acquire("p", tenant, "x", wait=True)
                    clock.advance(1)
                    k.release("p", r.connection_id, tenant)
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        def snapper():
            try:
                while not stop.is_set():
                    cp.save_json(k, os.path.join(tmpd, "live.json"))
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmpd:
            threads = [threading.Thread(target=worker, args=(t,))
                       for t in ("a", "b")]
            sth = threading.Thread(target=snapper)
            for th in threads + [sth]:
                th.start()
            for th in threads:
                th.join(timeout=10)
            stop.set()
            sth.join(timeout=5)
            # 所有工作线程结束后再拍一次最终快照，避免采样窗口
            final = os.path.join(tmpd, "final.json")
            cp.save_json(k, final)
            # 最终快照自身可载入且不变量成立
            k2 = cp.load_json(final)
        self.assertEqual(errors, [])
        self.assertEqual(k2.pool_stats("p").used, 0)


if __name__ == "__main__":
    unittest.main()
