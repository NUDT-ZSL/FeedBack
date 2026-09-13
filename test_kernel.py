"""kernel.py / main.py 的 unittest 测试。

覆盖：逻辑时钟、滑动窗口边界突发、熔断状态迁移、半开探测成功/失败、
指数退避与上限、自适应观察期快速重开、限流熔断组合互不污染、
快照往返与坏文件错误、CLI 逐行 JSON 协议。

直接运行：``python -m unittest -v test_kernel``
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from typing import Any, Dict, List

import kernel
import main as cli
from kernel import (
    STATE_CLOSED,
    STATE_HALF_OPEN,
    STATE_OPEN,
    CircuitBreaker,
    FakeClock,
    Guard,
    SnapshotError,
    SlidingWindowRateLimiter,
)


# ---------------------------------------------------------------------------
# 逻辑时钟
# ---------------------------------------------------------------------------


class FakeClockTest(unittest.TestCase):
    """逻辑时钟只能前进、可注入。"""

    def test_tick_and_now(self) -> None:
        clock = FakeClock()
        self.assertEqual(clock.now(), 0.0)
        self.assertEqual(clock.tick(3), 3.0)
        self.assertEqual(clock.tick(2.5), 5.5)

    def test_tick_zero_is_allowed(self) -> None:
        clock = FakeClock(10)
        self.assertEqual(clock.tick(0), 10.0)

    def test_negative_tick_rejected(self) -> None:
        clock = FakeClock()
        with self.assertRaises(ValueError):
            clock.tick(-1)
        with self.assertRaises(ValueError):
            FakeClock(-1)

    def test_set_now_no_rollback(self) -> None:
        clock = FakeClock(5)
        clock.set_now(8)
        self.assertEqual(clock.now(), 8.0)
        with self.assertRaises(ValueError):
            clock.set_now(7)

    def test_bool_is_not_a_number(self) -> None:
        with self.assertRaises(ValueError):
            FakeClock(True)


# ---------------------------------------------------------------------------
# 滑动窗口限流器
# ---------------------------------------------------------------------------


class SlidingWindowTest(unittest.TestCase):
    """滑动窗口计数与固定窗口两倍突发的边界问题。"""

    def setUp(self) -> None:
        self.clock = FakeClock()
        # 10 个时间单位内容纳 3 个请求。
        self.rl = SlidingWindowRateLimiter(window_length=10, rate_limit=3,
                                           clock=self.clock)

    def test_basic_allow_and_reject(self) -> None:
        for _ in range(3):
            self.assertTrue(self.rl.allow("a")["allowed"])
        decision = self.rl.allow("a")
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["reason"], "rate_limited")
        self.assertIsNotNone(decision["retry_after"])

    def test_keys_are_independent(self) -> None:
        self.assertTrue(self.rl.allow("a")["allowed"])
        self.assertTrue(self.rl.allow("b")["allowed"])
        self.assertEqual(self.rl.get_stats("a")["current"], 1)
        self.assertEqual(self.rl.get_stats("b")["current"], 1)

    def test_window_slides_no_double_burst(self) -> None:
        """固定窗口在边界会放行 2*N；滑动窗口在任何 10 长度区间内最多 N。"""
        # t=0 连发 3 个用满窗口。
        for _ in range(3):
            self.assertTrue(self.rl.allow("a")["allowed"])
        # t=9：窗口 (-1,9] 仍包含 t=0 的 3 个事件，不能放行。
        self.clock.set_now(9)
        decision = self.rl.allow("a")
        self.assertFalse(decision["allowed"])
        self.assertAlmostEqual(decision["retry_after"], 1.0)
        # t=10：t=0 的事件恰好过期（半开区间语义），可以再发 3 个。
        self.clock.set_now(10)
        for _ in range(3):
            self.assertTrue(self.rl.allow("a")["allowed"])
        # 但窗口 (0,10] 已用满，立刻再来的第 4 个必须拒绝。
        self.assertFalse(self.rl.allow("a")["allowed"])

        # 经典固定窗口两倍突发场景：t=9.5 放 3 个，t=10.5 绝不能再放 3 个。
        rl = SlidingWindowRateLimiter(10, 3, FakeClock(9.5))
        for _ in range(3):
            self.assertTrue(rl.allow("k")["allowed"])
        rl._clock.set_now(10.5)
        # 窗口 (0.5, 10.5] 仍包含 t=9.5 的 3 个事件 -> 全部拒绝。
        decision = rl.allow("k")
        self.assertFalse(decision["allowed"])
        # 最早 t=19.5 才有空位，retry_after ≈ 9。
        self.assertAlmostEqual(decision["retry_after"], 9.0)

    def test_gradual_sliding(self) -> None:
        """事件逐个过期，容量逐个恢复，而不是整窗跳变。"""
        for t in (0, 2, 4):
            self.clock.set_now(t)
            self.assertTrue(self.rl.allow("a")["allowed"])
        self.clock.set_now(10)  # t=0 的事件过期
        self.assertTrue(self.rl.allow("a")["allowed"])
        self.assertFalse(self.rl.allow("a")["allowed"])
        self.clock.set_now(12)  # t=2 的过期
        self.assertTrue(self.rl.allow("a")["allowed"])

    def test_retry_after_decreases_with_clock(self) -> None:
        for _ in range(3):
            self.rl.allow("a")
        first = self.rl.allow("a")["retry_after"]
        self.clock.tick(4)
        second = self.rl.allow("a")["retry_after"]
        self.assertLess(second, first)
        self.assertAlmostEqual(second, first - 4)

    def test_clock_not_advancing_repeated_calls(self) -> None:
        for _ in range(3):
            self.assertTrue(self.rl.allow("a")["allowed"])
        for _ in range(5):
            self.assertFalse(self.rl.allow("a")["allowed"])
        self.assertEqual(self.rl.get_stats("a")["current"], 3)

    def test_cost_weight(self) -> None:
        self.assertTrue(self.rl.allow("a", cost=2)["allowed"])
        self.assertTrue(self.rl.allow("a", cost=1)["allowed"])
        rejected = self.rl.allow("a", cost=1)
        self.assertFalse(rejected["allowed"])
        self.clock.tick(10)
        self.assertTrue(self.rl.allow("a", cost=3)["allowed"])

    def test_cost_exceeds_limit(self) -> None:
        decision = self.rl.allow("a", cost=4)
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["reason"], "cost_exceeds_limit")
        self.assertIsNone(decision["retry_after"])

    def test_invalid_arguments(self) -> None:
        for bad in ("", None, 1):
            with self.assertRaises(ValueError):
                self.rl.allow(bad)  # type: ignore[arg-type]
        for bad in (0, -1, 1.5, True):
            with self.assertRaises(ValueError):
                self.rl.allow("a", bad)  # type: ignore[arg-type]

    def test_invalid_config(self) -> None:
        with self.assertRaises(ValueError):
            SlidingWindowRateLimiter(0, 3, self.clock)
        with self.assertRaises(ValueError):
            SlidingWindowRateLimiter(-1, 3, self.clock)
        with self.assertRaises(ValueError):
            SlidingWindowRateLimiter(10, 0, self.clock)
        with self.assertRaises(ValueError):
            SlidingWindowRateLimiter(10, -2, self.clock)


# ---------------------------------------------------------------------------
# 熔断器：状态迁移
# ---------------------------------------------------------------------------


class CircuitBreakerTransitionTest(unittest.TestCase):
    """closed -> open -> half_open -> closed/open 的迁移。"""

    def make(self, **kw: Any) -> CircuitBreaker:
        self.clock = FakeClock()
        defaults: Dict[str, Any] = dict(
            clock=self.clock,
            window_length=10,
            failure_rate_threshold=0.5,
            min_samples=4,
            consecutive_failure_threshold=3,
            cooldown_duration=5,
            half_open_max_calls=1,
        )
        defaults.update(kw)
        return CircuitBreaker(**defaults)

    def test_starts_closed_and_allows(self) -> None:
        cb = self.make()
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)
        self.assertTrue(cb.allow("a")["allowed"])

    def test_consecutive_failures_trip_at_exact_threshold(self) -> None:
        cb = self.make(consecutive_failure_threshold=3)
        cb.record_failure("a")
        cb.record_failure("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)
        result = cb.record_failure("a")  # 恰好达到阈值
        self.assertTrue(result["tripped"])
        self.assertEqual(result["trigger"], "consecutive_failures")
        self.assertEqual(cb.get_state("a")["state"], STATE_OPEN)

    def test_open_rejects_without_execution(self) -> None:
        cb = self.make()
        for _ in range(3):
            cb.record_failure("a")
        decision = cb.allow("a")
        self.assertFalse(decision["allowed"])
        self.assertEqual(decision["reason"], "circuit_open")
        self.assertEqual(decision["rejected_by"], "circuit_breaker")
        self.assertAlmostEqual(decision["retry_after"], 5.0)
        # open 期间上报的结果不被记录。
        ignored = cb.record_failure("a")
        self.assertFalse(ignored["recorded"])
        before = cb.get_state("a")["failures"]
        self.assertEqual(cb.record_success("a")["recorded"], False)
        self.assertEqual(cb.get_state("a")["failures"], before)

    def test_cooldown_then_half_open_single_probe(self) -> None:
        cb = self.make()
        for _ in range(3):
            cb.record_failure("a")
        # 冷却期内仍 open。
        self.clock.tick(4)
        self.assertEqual(cb.get_state("a")["state"], STATE_OPEN)
        # 恰好到冷却结束时刻进入 half_open。
        self.clock.tick(1)
        state = cb.get_state("a")
        self.assertEqual(state["state"], STATE_HALF_OPEN)
        self.assertEqual(state["next_probe_at"], None)
        probe = cb.allow("a")
        self.assertTrue(probe["allowed"])
        self.assertTrue(probe["probe"])
        # 第 2 个探测请求被拒（默认只放 1 个）。
        extra = cb.allow("a")
        self.assertFalse(extra["allowed"])
        self.assertEqual(extra["reason"], "half_open_probe_limit")

    def test_probe_success_closes_and_clears_stats(self) -> None:
        cb = self.make()
        for _ in range(3):
            cb.record_failure("a")
        self.clock.tick(5)
        cb.allow("a")  # 探测
        result = cb.record_success("a")
        self.assertEqual(result["transition"], "half_open->closed")
        state = cb.get_state("a")
        self.assertEqual(state["state"], STATE_CLOSED)
        self.assertEqual(state["successes"], 0)
        self.assertEqual(state["failures"], 0)
        self.assertEqual(state["consecutive_failures"], 0)
        self.assertIsNotNone(state["observation_until"])

    def test_probe_failure_reopens(self) -> None:
        cb = self.make()
        for _ in range(3):
            cb.record_failure("a")
        self.clock.tick(5)
        cb.allow("a")
        result = cb.record_failure("a")
        self.assertEqual(result["transition"], "half_open->open")
        self.assertEqual(cb.get_state("a")["state"], STATE_OPEN)

    def test_failure_rate_equal_threshold_trips(self) -> None:
        # 4 个样本、阈值 0.5：失败率恰好 0.5 也要熔断。
        cb = self.make()
        cb.record_success("a")
        cb.record_success("a")
        cb.record_failure("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)  # 样本不足
        result = cb.record_failure("a")  # 2/4 = 0.5
        self.assertTrue(result["tripped"])
        self.assertEqual(result["trigger"], "failure_rate")

    def test_below_min_samples_does_not_trip(self) -> None:
        cb = self.make(min_samples=10)
        for _ in range(2):
            cb.record_success("a")
        for _ in range(2):
            cb.record_failure("a")  # 50% 但只有 4 个样本
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)

    def test_just_below_threshold_stays_closed(self) -> None:
        cb = self.make(min_samples=4, failure_rate_threshold=0.5)
        cb.record_failure("a")
        cb.record_failure("a")
        cb.record_success("a")
        cb.record_success("a")
        cb.record_success("a")  # 2/5 = 0.4
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)

    def test_success_resets_consecutive_failures(self) -> None:
        # 把失败率阈值调到 1.0，隔离出“连续失败”这一条触发路径。
        cb = self.make(consecutive_failure_threshold=3,
                       failure_rate_threshold=1.0)
        cb.record_failure("a")
        cb.record_failure("a")
        cb.record_success("a")
        cb.record_failure("a")
        cb.record_failure("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)

    def test_stats_window_slides(self) -> None:
        cb = self.make(min_samples=4, failure_rate_threshold=0.75,
                       consecutive_failure_threshold=100)
        for t in range(3):
            self.clock.set_now(float(t))
            cb.record_failure("a")
        self.clock.set_now(10)  # 窗口 (0,10]：t=0 的失败过期
        cb.record_failure("a")  # 3/4 才会触发；这里只有 3 个窗口内失败
        self.assertEqual(cb.get_state("a")["failures"], 3)
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)

    def test_reset(self) -> None:
        cb = self.make()
        for _ in range(3):
            cb.record_failure("a")
        cb.reset("a")
        state = cb.get_state("a")
        self.assertEqual(state["state"], STATE_CLOSED)
        self.assertEqual(state["failures"], 0)
        self.assertIsNone(state["next_probe_at"])

    def test_get_state_fields(self) -> None:
        cb = self.make()
        cb.record_success("a")
        state = cb.get_state("a")
        for field in ("state", "successes", "failures", "failure_rate",
                      "next_probe_at", "consecutive_failures", "cooldown_end"):
            self.assertIn(field, state)
        self.assertEqual(state["state"], STATE_CLOSED)
        self.assertIsNone(state["next_probe_at"])


# ---------------------------------------------------------------------------
# 半开探测：多个探测名额
# ---------------------------------------------------------------------------


class HalfOpenProbesTest(unittest.TestCase):
    """half_open_max_calls > 1 时需要全部探测成功才恢复。"""

    def test_all_probes_succeed(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, half_open_max_calls=3)
        cb.record_failure("a")
        clock.tick(5)
        self.assertTrue(cb.allow("a")["allowed"])
        cb.record_success("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_HALF_OPEN)
        self.assertTrue(cb.allow("a")["allowed"])
        cb.record_success("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_HALF_OPEN)
        self.assertTrue(cb.allow("a")["allowed"])
        cb.record_success("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)

    def test_any_probe_failure_reopens_immediately(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, half_open_max_calls=3)
        cb.record_failure("a")
        clock.tick(5)
        cb.allow("a")
        cb.record_success("a")
        cb.allow("a")
        result = cb.record_failure("a")
        self.assertEqual(result["state"], STATE_OPEN)
        self.assertEqual(cb.get_state("a")["state"], STATE_OPEN)

    def test_unpaired_half_open_records_are_ignored(self) -> None:
        """没有先 allow 拿到探测名额时，半开状态下的结果上报应被忽略。"""
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, half_open_max_calls=1)
        cb.record_failure("a")
        clock.tick(5)
        self.assertEqual(cb.get_state("a")["state"], STATE_HALF_OPEN)
        # 未 allow 直接上报：不结案任何探测。
        self.assertFalse(cb.record_success("a")["recorded"])
        self.assertFalse(cb.record_failure("a")["recorded"])
        self.assertEqual(cb.get_state("a")["state"], STATE_HALF_OPEN)
        # 正常拿到唯一探测并成功后，额外的成功上报也不能重复计数。
        self.assertTrue(cb.allow("a")["allowed"])
        self.assertEqual(cb.record_success("a")["state"], STATE_CLOSED)

    def test_snapshot_never_rejects_its_own_output(self) -> None:
        """各种中间状态下 save -> load 必须始终成功。"""
        import tempfile
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, half_open_max_calls=2)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            cb.record_failure("a")
            CircuitBreaker.load  # 确保类方法存在
            cb.save(path)
            CircuitBreaker.load(path)
            clock.tick(5)
            cb.allow("a")  # half_open，1 个在途探测
            cb.save(path)
            CircuitBreaker.load(path)


# ---------------------------------------------------------------------------
# 退避：固定 / 指数 + 上限
# ---------------------------------------------------------------------------


class BackoffTest(unittest.TestCase):
    def _trip_and_reopen_once(self, cb: CircuitBreaker, clock: FakeClock) -> float:
        cb.record_failure("a")
        # 冷却到期 -> 半开 -> 探测失败 -> 重新打开
        clock.tick(5)
        cb.allow("a")
        result = cb.record_failure("a")
        return result["cooldown"]

    def test_fixed_backoff(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, backoff_strategy="fixed",
                            backoff_multiplier=2, max_cooldown=100)
        first = self._trip_and_reopen_once(cb, clock)
        self.assertEqual(first, 5.0)
        clock.tick(first)
        cb.allow("a")
        second = cb.record_failure("a")["cooldown"]
        self.assertEqual(second, 5.0)

    def test_exponential_backoff_doubles(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, backoff_multiplier=2,
                            max_cooldown=1000)
        first = self._trip_and_reopen_once(cb, clock)
        self.assertEqual(first, 10.0)
        clock.tick(first)
        cb.allow("a")
        second = cb.record_failure("a")["cooldown"]
        self.assertEqual(second, 20.0)

    def test_cooldown_is_capped(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, backoff_multiplier=4,
                            max_cooldown=20)
        cooldown = 5.0
        for _ in range(5):
            clock.tick(cooldown)
            cb.allow("a")
            result = cb.record_failure("a")
            cooldown = result["cooldown"]
        self.assertLessEqual(cooldown, 20.0)
        self.assertEqual(cooldown, 20.0)
        # 到达上限后保持在上限，不会无限增长。
        clock.tick(cooldown)
        cb.allow("a")
        self.assertEqual(cb.record_failure("a")["cooldown"], 20.0)

    def test_cooldown_end_timestamp_matches(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, backoff_multiplier=2,
                            max_cooldown=100)
        cb.record_failure("a")
        clock.tick(5)
        cb.allow("a")
        result = cb.record_failure("a")
        self.assertAlmostEqual(
            result["cooldown_end"], clock.now() + result["cooldown"]
        )


# ---------------------------------------------------------------------------
# 自适应恢复：观察期内快速重开
# ---------------------------------------------------------------------------


class AdaptiveRecoveryTest(unittest.TestCase):
    def test_observation_window_fast_reopen(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=1, cooldown_duration=10,
            observation_window=8, fast_open_multiplier=0.5,
            backoff_multiplier=2, max_cooldown=100,
        )
        # 首次熔断 -> 冷却 10 -> 探测成功恢复，观察期到 t=10+8=18。
        cb.record_failure("a")
        self.assertEqual(cb.get_state("a")["cooldown"], 10.0)
        clock.tick(10)
        cb.allow("a")
        cb.record_success("a")
        self.assertEqual(cb.get_state("a")["state"], STATE_CLOSED)
        self.assertAlmostEqual(cb.get_state("a")["observation_until"], 18.0)

        # 观察期内立刻再次失败：冷却缩短为 10*0.5=5。
        result = cb.record_failure("a")
        self.assertTrue(result["tripped"])
        self.assertTrue(result["fast_open"])
        self.assertEqual(result["cooldown"], 5.0)

    def test_outside_observation_window_normal_cooldown(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=1, cooldown_duration=10,
            observation_window=8, fast_open_multiplier=0.5,
        )
        cb.record_failure("a")
        clock.tick(10)
        cb.allow("a")
        cb.record_success("a")
        # 观察期结束后才再次失败。
        clock.tick(9)
        self.assertIsNone(cb.get_state("a")["observation_until"])
        result = cb.record_failure("a")
        self.assertTrue(result["tripped"])
        self.assertFalse(result.get("fast_open"))
        self.assertEqual(result["cooldown"], 10.0)

    def test_fast_cooldown_also_respects_cap(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=1, cooldown_duration=10,
            max_cooldown=3, observation_window=100, fast_open_multiplier=0.5,
        )
        cb.record_failure("a")
        clock.tick(10)
        cb.allow("a")
        cb.record_success("a")
        result = cb.record_failure("a")
        self.assertEqual(result["cooldown"], 3.0)

    def test_consecutive_failure_also_triggers_fast_open(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=2, cooldown_duration=10,
            observation_window=100, fast_open_multiplier=0.25,
        )
        cb.record_failure("a")
        cb.record_failure("a")  # 先真正打到 open
        clock.tick(10)
        cb.allow("a")
        cb.record_success("a")
        cb.record_failure("a")
        result = cb.record_failure("a")
        self.assertTrue(result["tripped"])
        self.assertTrue(result["fast_open"])
        self.assertEqual(result["cooldown"], 2.5)


# ---------------------------------------------------------------------------
# 配置校验
# ---------------------------------------------------------------------------


class ConfigValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()

    def test_illegal_configs(self) -> None:
        legal: Dict[str, Any] = dict(
            clock=self.clock, window_length=10, failure_rate_threshold=0.5,
            min_samples=4, consecutive_failure_threshold=3, cooldown_duration=5,
            half_open_max_calls=1, backoff_strategy="exponential",
            backoff_multiplier=2.0, max_cooldown=60, observation_window=30,
            fast_open_multiplier=0.5,
        )

        def expect_error(**overrides: Any) -> None:
            cfg = dict(legal)
            cfg.update(overrides)
            with self.assertRaises(ValueError):
                CircuitBreaker(**cfg)

        expect_error(window_length=0)
        expect_error(window_length=-1)
        expect_error(failure_rate_threshold=0)
        expect_error(failure_rate_threshold=1.1)
        expect_error(min_samples=0)
        expect_error(min_samples=-3)
        expect_error(consecutive_failure_threshold=0)
        expect_error(half_open_max_calls=0)
        expect_error(cooldown_duration=-1)
        expect_error(backoff_strategy="linear")
        expect_error(backoff_multiplier=0.5)
        expect_error(max_cooldown=-1)
        # max_cooldown 允许小于初始冷却期：语义为“统一钳到该上限”。
        capped = CircuitBreaker(
            clock=self.clock, cooldown_duration=10, max_cooldown=3
        )
        self.assertEqual(capped.max_cooldown, 3.0)
        expect_error(observation_window=0)
        expect_error(fast_open_multiplier=0)
        expect_error(fast_open_multiplier=1.5)
        expect_error(failure_rate_threshold=True)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# 组合：Guard
# ---------------------------------------------------------------------------


class GuardCombinationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = FakeClock()
        self.rl = SlidingWindowRateLimiter(window_length=10, rate_limit=3,
                                           clock=self.clock)
        self.cb = CircuitBreaker(
            self.clock, consecutive_failure_threshold=1, cooldown_duration=5,
            max_cooldown=100,
        )
        self.guard = Guard(self.clock, self.rl, self.cb)

    def test_allows_through_both(self) -> None:
        decision = self.guard.allow("a")
        self.assertTrue(decision["allowed"])
        self.assertEqual(self.rl.get_stats("a")["current"], 1)

    def test_rate_limited_does_not_touch_breaker(self) -> None:
        # 直接把限流器窗口填满（不经过熔断器）。
        for _ in range(3):
            self.rl.allow("z")
        self.assertNotIn("z", self.cb._states)
        rejected = self.guard.allow("z")
        self.assertFalse(rejected["allowed"])
        self.assertEqual(rejected["rejected_by"], "rate_limiter")
        # 被限流的 key 在熔断器里仍然完全不存在（从未被触碰）。
        self.assertNotIn("z", self.cb._states)

    def test_breaker_rejected_does_not_consume_rate_quota(self) -> None:
        # 先用直接访问熔断器的方式把 a 打到 open（不经过限流器）。
        self.cb.record_failure("a")
        self.assertEqual(self.cb.get_state("a")["state"], STATE_OPEN)
        # open 期间通过 Guard 申请：被熔断拒绝。
        for _ in range(10):
            decision = self.guard.allow("a")
            self.assertFalse(decision["allowed"])
            self.assertEqual(decision["rejected_by"], "circuit_breaker")
        # 限流窗口一个配额都没有被消耗。
        self.assertEqual(self.rl.get_stats("a")["current"], 0)

    def test_records_do_not_touch_limiter(self) -> None:
        self.guard.allow("a")
        self.guard.record_failure("b")
        self.assertEqual(self.rl.get_stats("b")["current"], 0)
        self.assertEqual(self.cb.get_state("b")["state"], STATE_OPEN)
        self.guard.record_success("c")
        self.assertEqual(self.rl.get_stats("c")["current"], 0)

    def test_end_to_end_rate_then_break(self) -> None:
        """限流配额与熔断探测在半开后仍然正确联动。"""
        self.guard.allow("a")
        self.guard.record_failure("a")  # consecutive=1 -> open
        self.clock.tick(5)
        # 半开放行探测，占用 1 个限流配额；探测失败重新打开。
        probe = self.guard.allow("a")
        self.assertTrue(probe["allowed"])
        self.assertTrue(probe["probe"])
        self.assertEqual(self.rl.get_stats("a")["current"], 2)
        self.guard.record_failure("a")
        # open 期间的申请不消耗配额。
        self.assertFalse(self.guard.allow("a")["allowed"])
        self.assertEqual(self.rl.get_stats("a")["current"], 2)

    def test_reset_clears_both(self) -> None:
        self.guard.allow("a")
        self.cb.record_failure("a")
        self.guard.reset("a")
        self.assertEqual(self.guard.get_state("a")["state"], STATE_CLOSED)
        self.assertEqual(self.rl.get_stats("a")["current"], 0)

    def test_shared_clock_required(self) -> None:
        with self.assertRaises(ValueError):
            Guard(FakeClock(), self.rl, self.cb)

    def test_invalid_key_and_cost(self) -> None:
        with self.assertRaises(ValueError):
            self.guard.allow("")
        with self.assertRaises(ValueError):
            self.guard.allow("a", 0)
        with self.assertRaises(ValueError):
            self.guard.allow("a", -2)


# ---------------------------------------------------------------------------
# 持久化：快照往返 / 坏文件
# ---------------------------------------------------------------------------


class SnapshotTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snap.json")

    def tearDown(self) -> None:
        for name in os.listdir(self.tmp):
            os.remove(os.path.join(self.tmp, name))
        os.rmdir(self.tmp)

    def _build_guard(self) -> Guard:
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(10, 3, clock)
        cb = CircuitBreaker(
            clock, window_length=10, failure_rate_threshold=0.6,
            min_samples=4, consecutive_failure_threshold=2,
            cooldown_duration=5, half_open_max_calls=2,
            backoff_strategy="exponential", backoff_multiplier=2,
            max_cooldown=40, observation_window=15, fast_open_multiplier=0.5,
        )
        return Guard(clock, rl, cb)

    def test_save_load_roundtrip_open_state(self) -> None:
        guard = self._build_guard()
        guard.allow("a")
        guard.record_failure("a")
        guard.allow("b")
        guard.record_failure("b")
        guard.record_failure("b")  # b -> open
        guard.tick(3)
        guard.allow("a")  # 再产生一条限流事件
        guard.save(self.path)

        restored = Guard.load(self.path)
        self.assertEqual(restored.clock.now(), 3.0)
        state_b = restored.get_state("b")
        self.assertEqual(state_b["state"], STATE_OPEN)
        self.assertEqual(state_b["failures"], 2)
        self.assertAlmostEqual(state_b["cooldown"], 5.0)
        self.assertAlmostEqual(state_b["cooldown_end"], 5.0)
        # 限流窗口事件被保留。
        self.assertEqual(restored.rate_limiter.get_stats("a")["current"], 2)
        self.assertEqual(restored.rate_limiter.get_stats("b")["current"], 1)
        # 配置被保留：继续推进时钟，冷却到期 -> 半开 -> 2 个探测名额。
        restored.tick(5)
        self.assertEqual(restored.get_state("b")["state"], STATE_HALF_OPEN)
        self.assertTrue(restored.allow("b")["allowed"])
        self.assertTrue(restored.allow("b")["allowed"])
        self.assertFalse(restored.allow("b")["allowed"])
        restored.record_success("b")
        restored.record_success("b")
        self.assertEqual(restored.get_state("b")["state"], STATE_CLOSED)

    def test_roundtrip_half_open_with_backoff(self) -> None:
        # 限流阈值给足，隔离出熔断探测名额这一条限制。
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(10, 100, clock)
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=2, cooldown_duration=5,
            half_open_max_calls=2, backoff_multiplier=2, max_cooldown=40,
        )
        guard = Guard(clock, rl, cb)
        guard.allow("a")
        guard.record_failure("a")
        guard.record_failure("a")  # open, cooldown=5
        guard.tick(5)
        guard.allow("a")  # 进入半开并放出第 1 个探测
        self.assertEqual(guard.get_state("a")["state"], STATE_HALF_OPEN)
        guard.save(self.path)

        restored = Guard.load(self.path)
        state = restored.get_state("a")
        self.assertEqual(state["state"], STATE_HALF_OPEN)
        self.assertEqual(state["half_open_calls"], 1)
        # 配置允许 2 个探测：快照时已用 1 个，还能再放 1 个，之后拒绝。
        second = restored.allow("a")
        self.assertTrue(second["allowed"])
        self.assertEqual(second["probe_index"], 2)
        third = restored.allow("a")
        self.assertFalse(third["allowed"])
        self.assertEqual(third["reason"], "half_open_probe_limit")

    def test_load_into_existing_clock_rollback_rejected(self) -> None:
        guard = self._build_guard()
        guard.allow("a")
        guard.record_failure("a")
        guard.record_failure("a")  # 快照时钟停在 0
        guard.save(self.path)

        # 已有逻辑时钟已经走到 2：载入 clock_now=0 的快照属于时钟回退。
        clock = FakeClock()
        clock.tick(2)
        with self.assertRaises(SnapshotError):
            Guard.load(self.path, clock=clock)
        self.assertEqual(clock.now(), 2.0)

    def test_load_advances_shared_clock_forward(self) -> None:
        guard = self._build_guard()
        guard.tick(7)
        guard.allow("a")
        guard.record_failure("a")
        guard.record_failure("a")
        guard.save(self.path)

        clock = FakeClock()
        clock.set_now(3)
        restored = Guard.load(self.path, clock=clock)
        self.assertIs(restored.clock, clock)
        self.assertEqual(clock.now(), 7.0)
        self.assertEqual(restored.get_state("a")["state"], STATE_OPEN)

    def test_missing_file(self) -> None:
        with self.assertRaises(SnapshotError) as ctx:
            Guard.load(os.path.join(self.tmp, "missing.json"))
        self.assertIn("不存在", str(ctx.exception))

    def test_corrupt_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not valid json")
        with self.assertRaises(SnapshotError) as ctx:
            Guard.load(self.path)
        self.assertIn("JSON", str(ctx.exception))

    def _write_snapshot(self, data: Any) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)

    def _base_snapshot(self) -> Dict[str, Any]:
        guard = self._build_guard()
        guard.allow("a")
        guard.record_failure("a")
        guard.record_failure("a")
        return guard.to_dict()

    def test_bad_top_level(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump([1, 2, 3], fh)
        with self.assertRaisesRegex(SnapshotError, "顶层"):
            Guard.load(self.path)

    def test_bad_version(self) -> None:
        data = self._base_snapshot()
        data["version"] = 99
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "版本"):
            Guard.load(self.path)

    def test_clock_rollback_rejected(self) -> None:
        data = self._base_snapshot()
        data["clock_now"] = -1
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "clock_now"):
            Guard.load(self.path)

    def test_illegal_state_value(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["breaker"]["state"] = "half_closed"
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "状态"):
            Guard.load(self.path)

    def test_negative_counters(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["breaker"]["failures"] = [0.0]
        data["keys"]["a"]["breaker"]["consecutive_failures"] = -1
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "consecutive_failures"):
            Guard.load(self.path)

    def test_negative_cooldown(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["breaker"]["current_cooldown"] = -3
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "cooldown"):
            Guard.load(self.path)

    def test_cooldown_over_cap(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["breaker"]["current_cooldown"] = 999
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "上限|cooldown"):
            Guard.load(self.path)

    def test_cooldown_end_before_opened_at(self) -> None:
        data = self._base_snapshot()
        data["clock_now"] = 10.0
        part = data["keys"]["a"]["breaker"]
        part["opened_at"] = 5.0
        part["cooldown_end"] = 2.0
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "回退|cooldown_end"):
            Guard.load(self.path)

    def test_half_open_calls_over_limit(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["breaker"]["state"] = STATE_HALF_OPEN
        data["keys"]["a"]["breaker"]["opened_at"] = 0.0
        data["keys"]["a"]["breaker"]["cooldown_end"] = 5.0
        data["keys"]["a"]["breaker"]["half_open_calls"] = 5
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "探测上限|half_open"):
            Guard.load(self.path)

    def test_missing_field(self) -> None:
        data = self._base_snapshot()
        del data["keys"]["a"]["breaker"]["state"]
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "缺少字段"):
            Guard.load(self.path)

    def test_missing_config_field(self) -> None:
        data = self._base_snapshot()
        del data["breaker_config"]["window_length"]
        self._write_snapshot(data)
        with self.assertRaises(SnapshotError):
            Guard.load(self.path)

    def test_empty_key_rejected(self) -> None:
        data = self._base_snapshot()
        data["keys"][""] = data["keys"]["a"]
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "空 key"):
            Guard.load(self.path)

    def test_timestamp_after_clock_rejected(self) -> None:
        data = self._base_snapshot()
        data["keys"]["a"]["limiter"]["events"][0]["t"] = 999
        self._write_snapshot(data)
        with self.assertRaisesRegex(SnapshotError, "时间戳"):
            Guard.load(self.path)

    def test_breaker_only_snapshot_roundtrip(self) -> None:
        """不挂限流器的 Guard 也能往返。"""
        clock = FakeClock()
        guard = Guard(clock, None, CircuitBreaker(
            clock, consecutive_failure_threshold=1, cooldown_duration=5))
        guard.record_failure("x")
        guard.save(self.path)
        restored = Guard.load(self.path)
        self.assertIsNone(restored.rate_limiter)
        self.assertEqual(restored.get_state("x")["state"], STATE_OPEN)

    def test_save_load_stats_identical(self) -> None:
        guard = self._build_guard()
        guard.tick(2)
        for _ in range(2):
            guard.allow("a")
            guard.record_failure("a")
        before = guard.get_stats()
        guard.save(self.path)
        after = Guard.load(self.path).get_stats()
        self.assertEqual(
            json.dumps(before, sort_keys=True),
            json.dumps(after, sort_keys=True),
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


class CliTest(unittest.TestCase):
    def run_cli(self, lines: List[str], *argv: str) -> List[Dict[str, Any]]:
        parser = cli.make_parser()
        args = parser.parse_args(list(argv))
        guard = cli.build_guard(args)
        out = io.StringIO()
        cli.run(guard, io.StringIO("\n".join(lines) + "\n"), out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_allow_success_failure_state(self) -> None:
        rows = self.run_cli(
            [
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"success","key":"a"}',
                '{"cmd":"state","key":"a"}',
                '{"cmd":"failure","key":"a"}',
            ],
            "--consecutive-failures", "5",
        )
        self.assertTrue(all(r["ok"] for r in rows))
        self.assertTrue(rows[0]["allowed"])
        self.assertEqual(rows[2]["state"], STATE_CLOSED)
        self.assertEqual(rows[2]["successes"], 1)

    def test_tick_and_open_and_stats(self) -> None:
        rows = self.run_cli(
            [
                '{"cmd":"failure","key":"a"}',
                '{"cmd":"state","key":"a"}',
                '{"cmd":"tick","delta":5}',
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"stats"}',
            ],
            "--consecutive-failures", "1", "--cooldown", "5",
        )
        self.assertEqual(rows[1]["state"], STATE_OPEN)
        self.assertEqual(rows[3]["state"], STATE_HALF_OPEN)
        self.assertTrue(rows[3]["probe"])
        self.assertIn("a", rows[4]["stats"])

    def test_errors_return_json_with_error_field(self) -> None:
        rows = self.run_cli(
            [
                "not json",
                '{"cmd":"allow"}',
                '{"cmd":"frobnicate","key":"a"}',
                '{"cmd":"allow","key":"a","cost":-1}',
                "",
            ],
        )
        self.assertFalse(rows[0]["ok"])
        self.assertIn("error", rows[0])
        self.assertIn("error", rows[1])
        self.assertIn("未知命令", rows[2]["error"])
        self.assertIn("error", rows[3])
        self.assertTrue(rows[4]["ignored"])

    def test_save_load_dump(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            rows = self.run_cli(
                [
                    '{"cmd":"failure","key":"a"}',
                    json.dumps({"cmd": "save", "path": path}),
                    json.dumps({"cmd": "load", "path": path}),
                    '{"cmd":"state","key":"a"}',
                    '{"cmd":"dump"}',
                ],
                "--consecutive-failures", "1",
            )
        self.assertTrue(rows[1]["ok"])
        self.assertTrue(rows[2]["ok"])
        self.assertEqual(rows[3]["state"], STATE_OPEN)
        self.assertEqual(rows[4]["version"], Guard.SNAPSHOT_VERSION)

    def test_load_bad_file_is_json_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{broken")
            rows = self.run_cli([json.dumps({"cmd": "load", "path": path})])
        self.assertFalse(rows[0]["ok"])
        self.assertIn("error", rows[0])

    def test_rate_limit_flow_via_cli(self) -> None:
        rows = self.run_cli(
            [
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"allow","key":"a"}',
                '{"cmd":"tick","delta":10}',
                '{"cmd":"allow","key":"a"}',
            ],
            "--rate-window", "10", "--rate-limit", "3",
        )
        self.assertTrue(rows[0]["allowed"])
        self.assertFalse(rows[3]["allowed"])
        self.assertEqual(rows[3]["rejected_by"], "rate_limiter")
        self.assertAlmostEqual(rows[3]["retry_after"], 10.0)
        self.assertTrue(rows[5]["allowed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
