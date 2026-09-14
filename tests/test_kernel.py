"""LeaseKernel 的单元测试。

覆盖：发放/续租/释放/回收、偏差窗口三态、时钟回退与跳变、
拒绝原因、fancing token 失效、持有者互斥、确定性回放。
"""

import unittest

from leasekernel.clock import ManualClock
from leasekernel.kernel import (
    LeaseKernel,
    LeaseState,
    PersistenceError,
    ValidationError,
)


class KernelTestBase(unittest.TestCase):
    def make_kernel(
        self, ttl: float = 100.0, epsilon: float = 10.0,
        initial: float = 0.0, **node_eps: float
    ) -> LeaseKernel:
        k = LeaseKernel(ManualClock(initial))
        k.register_resource("r", ttl=ttl, epsilon=epsilon,
                            node_epsilons=node_eps or None)
        return k


class RegisterAndEmptyTest(KernelTestBase):
    def test_empty_system_status_unknown_resource(self) -> None:
        k = LeaseKernel(ManualClock(0.0))
        with self.assertRaises(ValidationError):
            k.status("nope")
        self.assertEqual(k.reclaim()["reclaimed"], [])

    def test_register_validation(self) -> None:
        k = LeaseKernel()
        with self.assertRaises(ValidationError):
            k.register_resource("", ttl=10)
        with self.assertRaises(ValidationError):
            k.register_resource("x", ttl=0)
        with self.assertRaises(ValidationError):
            k.register_resource("x", ttl=10, epsilon=-1)
        with self.assertRaises(ValidationError):
            k.register_resource("x", ttl=10, epsilon=float("nan"))
        with self.assertRaises(ValidationError):
            k.register_resource("x", ttl=True)
        k.register_resource("x", ttl=10, epsilon=0)
        with self.assertRaises(ValidationError):
            k.register_resource("x", ttl=10)  # 重复注册

    def test_register_event_logged(self) -> None:
        k = self.make_kernel()
        evt = k.events[0]
        self.assertEqual(evt.kind, "register")
        self.assertEqual(evt.result, "ok")
        self.assertEqual(evt.monotonic, 0.0)


class AcquireTest(KernelTestBase):
    def test_grant_records_holder_and_times(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        g = k.acquire("r", "a")
        self.assertTrue(g["granted"])
        self.assertEqual(g["generation"], 1)
        self.assertEqual(g["grant_mono"], 0.0)
        self.assertEqual(g["expire_mono"], 100.0)
        self.assertEqual(g["safe_until_mono"], 90.0)
        st = k.status("r")
        self.assertEqual(st.state, LeaseState.SAFE)
        self.assertEqual(st.holder, "a")
        self.assertTrue(st.acquirable is False)

    def test_duplicate_acquire_same_holder_denied(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        r = k.acquire("r", "a")
        self.assertFalse(r["granted"])
        self.assertEqual(r["reason"], "already_held")
        self.assertEqual(k.status("r").generation, 1)

    def test_duplicate_acquire_other_holder_denied(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        r = k.acquire("r", "b")
        self.assertFalse(r["granted"])
        self.assertEqual(r["reason"], "lease_active_other_holder")
        self.assertEqual(r["current_holder"], "a")

    def test_unknown_resource(self) -> None:
        k = LeaseKernel()
        with self.assertRaises(ValidationError):
            k.acquire("ghost", "a")
        with self.assertRaises(ValidationError):
            k.acquire("r", "")


class StateTransitionTest(KernelTestBase):
    def test_safe_uncertain_expired_boundaries(self) -> None:
        # ttl=100 epsilon=10：safe [0,90) uncertain [90,100) expired [100,∞)
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        for t, expected in [
            (0, LeaseState.SAFE),
            (89, LeaseState.SAFE),
            (90, LeaseState.UNCERTAIN),   # 边界：进入不确定区
            (99, LeaseState.UNCERTAIN),
            (100, LeaseState.EXPIRED),   # 边界：硬到期
        ]:
            k.clock.set_time(t)
            self.assertEqual(k.clock.monotonic, float(max(t, 0)))
            self.assertEqual(k.status("r").state, expected,
                             "t=%d 应为 %s" % (t, expected))

    def test_zero_epsilon_has_no_uncertainty_zone(self) -> None:
        k = self.make_kernel(ttl=50, epsilon=0)
        k.acquire("r", "a")
        k.clock.advance(49)
        self.assertEqual(k.status("r").state, LeaseState.SAFE)
        k.clock.advance(1)
        self.assertEqual(k.status("r").state, LeaseState.EXPIRED)
        # 不确定区续租拒绝路径不应出现：50 时刻续租报 expired 而非 uncertainty
        r = k.renew("r", "a", 1, local_time=50.0)
        self.assertFalse(r["renewed"])
        self.assertEqual(r["reason"], "expired")

    def test_clock_rollback_does_not_extend_safety(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(100)  # 硬到期
        self.assertEqual(k.status("r").state, LeaseState.EXPIRED)
        k.clock.set_time(0)  # 时钟大幅回退
        self.assertEqual(k.clock.now, 0.0)
        # 高水位仍在 100：租约不得复活，写入必须拒绝
        self.assertEqual(k.status("r").state, LeaseState.EXPIRED)
        w = k.check_write("r", "a", 1)
        self.assertFalse(w["allowed"])
        self.assertEqual(w["reason"], "expired")

    def test_large_forward_jump_expires_lease(self) -> None:
        k = self.make_kernel(ttl=10, epsilon=1)
        k.acquire("r", "a")
        k.clock.set_time(10_000_000)
        st = k.status("r")
        self.assertEqual(st.state, LeaseState.EXPIRED)
        # 到期后旧持有者写入被拒
        self.assertFalse(k.check_write("r", "a", 1)["allowed"])
        # 旧租约硬到期之后，新持有者可以获得租约
        g = k.acquire("r", "b")
        self.assertTrue(g["granted"])
        self.assertEqual(g["generation"], 2)
        self.assertEqual(k.status("r").holder, "b")


class RenewTest(KernelTestBase):
    def test_renew_extends_from_now(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(40)
        r = k.renew("r", "a", 1, local_time=40.0)
        self.assertTrue(r["renewed"])
        self.assertEqual(r["expire_mono"], 140.0)
        self.assertEqual(r["safe_until_mono"], 130.0)
        self.assertEqual(r["renew_count"], 1)

    def test_renew_in_uncertain_zone_denied(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(90)
        r = k.renew("r", "a", 1, local_time=90.0)
        self.assertFalse(r["renewed"])
        self.assertEqual(r["reason"], "uncertainty_window")
        # 拒绝不得默默续期：到期时刻不变
        self.assertEqual(k.status("r").expire_mono, 100.0)

    def test_renew_after_expiry_denied_and_reclaims(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(100)
        r = k.renew("r", "a", 1, local_time=100.0)
        self.assertFalse(r["renewed"])
        self.assertEqual(r["reason"], "expired")
        lease = k._resources["r"].lease
        self.assertFalse(lease.active)

    def test_renew_skew_boundary(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        # |local_time - now| <= epsilon 允许；边界相等也允许
        self.assertTrue(k.renew("r", "a", 1, local_time=10.0)["renewed"])
        k.clock.advance(10)  # now=10
        self.assertTrue(k.renew("r", "a", 1, local_time=20.0)["renewed"])
        k.clock.advance(10)  # now=20
        denied = k.renew("r", "a", 1, local_time=31.0)
        self.assertFalse(denied["renewed"])
        self.assertEqual(denied["reason"], "clock_skew_exceeded")
        self.assertEqual(denied["skew"], 11.0)

    def test_renew_after_jumpback_uses_high_water_mark(self) -> None:
        # 内核时钟从 50 回退到 10（高水位仍是 50）：
        # 1) 与回退后时钟一致的续租可以成功，但新到期按高水位 50 计算，
        #    回退没有白白“赚”到时间（100 时长 -> 到期 150，而非 110）；
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(50)
        k.clock.set_time(10)
        ok = k.renew("r", "a", 1, local_time=10.0)
        self.assertTrue(ok["renewed"])
        self.assertEqual(ok["expire_mono"], 150.0)
        # 2) 延迟到达、按跳变前真实时间（50）上报的续租与当前时钟偏差 40，
        #    超过 epsilon，必须拒绝。
        denied = k.renew("r", "a", 1, local_time=50.0)
        self.assertFalse(denied["renewed"])
        self.assertEqual(denied["reason"], "clock_skew_exceeded")
        self.assertEqual(denied["skew"], 40.0)

    def test_renew_stale_generation_denied(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        r = k.renew("r", "a", 999, local_time=0.0)
        self.assertFalse(r["renewed"])
        self.assertEqual(r["reason"], "stale_generation")
        self.assertEqual(r["current_generation"], 1)

    def test_renew_wrong_holder_and_lease_id(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        self.assertEqual(
            k.renew("r", "b", 1, local_time=0.0)["reason"], "not_holder")
        self.assertEqual(
            k.renew("r", "a", 1, local_time=0.0, lease_id="r#L9")["reason"],
            "stale_lease_id")
        self.assertEqual(
            k.renew("r", "a", 1, local_time=0.0)["renewed"], True)

    def test_renew_no_active_lease(self) -> None:
        k = self.make_kernel()
        self.assertEqual(
            k.renew("r", "a", 1, local_time=0.0)["reason"], "no_active_lease")

    def test_renew_validation(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        with self.assertRaises(ValidationError):
            k.renew("r", "a", 1.0, local_time=0)  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            k.renew("r", "a", 1, local_time="now")  # type: ignore[arg-type]

    def test_node_specific_epsilon(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10, **{"a": 2.0})
        g = k.acquire("r", "a")
        self.assertEqual(g["epsilon"], 2.0)
        self.assertEqual(g["safe_until_mono"], 98.0)
        # 偏差 3 超过节点级上界 2
        k.clock.advance(5)
        self.assertFalse(
            k.renew("r", "a", 1, local_time=8.0)["renewed"])


class WriteFencingTest(KernelTestBase):
    def test_write_allowed_only_in_safe_period(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        self.assertTrue(k.check_write("r", "a", 1)["allowed"])
        k.clock.advance(90)
        w = k.check_write("r", "a", 1)
        self.assertFalse(w["allowed"])
        self.assertEqual(w["reason"], "uncertainty_window")

    def test_old_holder_write_after_reclaim_denied(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(95)  # 进入不确定区
        k.reclaim("r")
        # 原持有者的后续写入必须被拒绝
        for args_extra in ({}, ):
            w = k.check_write("r", "a", 1)
            self.assertFalse(w["allowed"])
            self.assertIn(w["reason"], ("lease_ended", "uncertainty_window"))
        # 不确定区回收后，新持有者在硬到期前也拿不到租约
        g = k.acquire("r", "b")
        self.assertFalse(g["granted"])
        self.assertEqual(g["reason"], "within_expiry_uncertainty_grace")
        k.clock.advance(5)  # 到达硬到期 100
        g2 = k.acquire("r", "b")
        self.assertTrue(g2["granted"])
        # 旧持有者携带旧 token 写入仍被拒（fancing）
        w2 = k.check_write("r", "a", 1)
        self.assertFalse(w2["allowed"])
        self.assertEqual(w2["reason"], "stale_generation")
        # 同一时刻只有新持有者有效
        self.assertTrue(k.check_write("r", "b", 2)["allowed"])

    def test_no_two_valid_holders_at_any_instant(self) -> None:
        # 穷举每个逻辑时刻：旧 token 与新 token 永不同时有效，
        # 且旧租约安全/不确定期间新持有者无法获得租约。
        k = self.make_kernel(ttl=30, epsilon=5)
        k.acquire("r", "a")
        granted_to_b = False
        for t in range(0, 90):
            k.clock.set_time(float(t))
            old_ok = k.check_write("r", "a", 1, log=False)["allowed"]
            st = k.status("r")
            if not granted_to_b and st.acquirable:
                g = k.acquire("r", "b")
                self.assertTrue(g["granted"], "t=%d 应可重新发放" % t)
                granted_to_b = True
            st = k.status("r")
            new_ok = (
                k.check_write("r", "b", st.generation, log=False)["allowed"]
                if st.holder == "b" else False
            )
            self.assertFalse(old_ok and new_ok,
                             "t=%d 两个持有者同时有效" % t)
            if old_ok:
                # 旧持有者仍在安全期：抢占必须失败
                self.assertFalse(k.acquire("r", "c")["granted"],
                                 "t=%d 旧持有者仍安全却被抢占" % t)
        self.assertTrue(granted_to_b, "测试应当走过一次重新发放")


class ReclaimTest(KernelTestBase):
    def test_reclaim_safe_period_denied(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        r = k.reclaim("r")
        self.assertFalse(r["reclaimed"])
        self.assertEqual(r["reason"], "still_in_safe_period")
        self.assertEqual(k.status("r").holder, "a")

    def test_reclaim_uncertain_then_grace(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(90)
        info = k.reclaim("r")
        self.assertTrue(info["reclaimed"])
        self.assertEqual(info["reason"], "reclaimed_uncertain")
        st = k.status("r")
        self.assertEqual(st.state, LeaseState.UNCERTAIN)
        self.assertIsNone(st.holder)
        self.assertFalse(st.acquirable)

    def test_reclaim_expired(self) -> None:
        k = self.make_kernel(ttl=100, epsilon=10)
        k.acquire("r", "a")
        k.clock.advance(100)
        info = k.reclaim("r")
        self.assertTrue(info["reclaimed"])
        self.assertEqual(info["reason"], "reclaimed_expired")
        self.assertEqual(k.status("r").state, LeaseState.FREE)

    def test_reclaim_without_lease(self) -> None:
        k = self.make_kernel()
        with self.assertRaises(ValidationError):
            k.reclaim("r")

    def test_reclaim_all_scan(self) -> None:
        k = LeaseKernel(ManualClock(0.0))
        k.register_resource("fast", ttl=10, epsilon=1)
        k.register_resource("slow", ttl=100, epsilon=1)
        k.register_resource("empty", ttl=100, epsilon=1)
        k.acquire("fast", "a")
        k.acquire("slow", "b")
        k.clock.advance(50)
        out = k.reclaim()
        names = sorted(item["resource"] for item in out["reclaimed"])
        self.assertEqual(names, ["fast"])

    def test_auto_expire_on_acquire_then_grant(self) -> None:
        k = self.make_kernel(ttl=10, epsilon=0)
        k.acquire("r", "a")
        k.clock.advance(10)
        g = k.acquire("r", "b")
        self.assertTrue(g["granted"])
        self.assertEqual(g["generation"], 2)
        kinds = [(e.kind, e.reason) for e in k.events]
        self.assertIn(("expire", "auto_expired"), kinds)


class ReleaseTest(KernelTestBase):
    def test_release_makes_resource_free(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        out = k.release("r", "a", 1)
        self.assertTrue(out["released"])
        st = k.status("r")
        self.assertEqual(st.state, LeaseState.FREE)
        self.assertTrue(st.acquirable)
        # 立刻可以被新持有者获取
        self.assertTrue(k.acquire("r", "b")["granted"])
        # 旧 token 立即失效
        self.assertEqual(
            k.check_write("r", "a", 1)["reason"], "stale_generation")

    def test_release_wrong_generation_holder(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        with self.assertRaises(ValidationError):
            k.release("r", "a", 2)
        with self.assertRaises(ValidationError):
            k.release("r", "b", 1)
        self.assertEqual(k.status("r").holder, "a")

    def test_release_nonexistent(self) -> None:
        k = self.make_kernel()
        with self.assertRaises(ValidationError):
            k.release("r", "a", 1)
        k2 = LeaseKernel()
        with self.assertRaises(ValidationError):
            k2.release("ghost", "a", 1)

    def test_double_release_denied(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        k.release("r", "a", 1)
        with self.assertRaises(ValidationError):
            k.release("r", "a", 1)


class DeterminismTest(KernelTestBase):
    def _script(self, k: LeaseKernel) -> list:
        k.register_resource("x", ttl=30, epsilon=5)
        out = []
        out.append(k.acquire("x", "a"))
        k.clock.advance(10)
        out.append(k.renew("x", "a", 1, local_time=10.0))
        k.clock.advance(28)
        out.append(k.status("x").to_dict())
        out.append(k.renew("x", "a", 1, local_time=38.0))
        out.append(k.reclaim("x"))
        k.clock.advance(10)
        out.append(k.acquire("x", "b"))
        out.append(k.check_write("x", "a", 1))
        out.append(k.check_write("x", "b", 2))
        return out

    def test_same_input_same_output_and_log_order(self) -> None:
        k1 = LeaseKernel(ManualClock(0.0))
        k2 = LeaseKernel(ManualClock(0.0))
        r1 = self._script(k1)
        r2 = self._script(k2)
        self.assertEqual(repr(r1), repr(r2))
        e1 = [e.to_dict() for e in k1.events if e.kind != "register"]
        e2 = [e.to_dict() for e in k2.events if e.kind != "register"]
        # 去掉 register（资源名相同则也相同，直接整体比）
        self.assertEqual(e1, e2)
        self.assertEqual(
            [e.seq for e in k1.events], list(range(1, len(k1.events) + 1))
        )

    def test_event_log_has_time_basis(self) -> None:
        k = self.make_kernel()
        k.acquire("r", "a")
        k.clock.advance(5)
        k.renew("r", "a", 1, local_time=5.0)
        ev_renew = [e for e in k.events if e.kind == "renew" and e.result == "ok"][0]
        self.assertEqual(ev_renew.monotonic, 5.0)
        self.assertEqual(ev_renew.clock_now, 5.0)
        self.assertEqual(ev_renew.details["skew"], 0.0)
        self.assertEqual(ev_renew.details["new_expire_mono"], 105.0)


if __name__ == "__main__":
    unittest.main()
