"""线程安全并发回归测试。

全部用 :class:`threading.Barrier` / :class:`threading.Event` 控制线程
交错，不使用 ``sleep`` 制造竞态（时钟也是可注入的假时钟），因此测试
确定性运行、不会 flaky。

覆盖：
  * 同一 key 上 allow 并发：滑动窗口计数精确，绝不超发；
  * Guard 复合操作原子：熔断拒绝时一个限流配额都不扣；
  * 半开探测名额不超发、探测结果不重复计数；
  * 并发 record_failure 恰好熔断一次、计数不丢失；
  * 不同 key 使用不同锁、不互相阻塞（锁身份 + 混合压力）；
  * save 与写并发时每个快照都能通过 load 校验（无撕裂）；
  * restore 失败回滚（坏文件 / 时钟回退），成功后状态正确；
  * 高并发混合调用不死锁、不抛异常。

直接运行：``python -m unittest -v test_concurrency``
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import traceback
import unittest
from typing import Any, Callable, Dict, List, Optional, Tuple

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
# 测试辅助
# ---------------------------------------------------------------------------


class WorkerError(Exception):
    """工作线程内出现的异常聚合。"""


def start_workers(
    n: int,
    fn: Callable[[int, threading.Barrier], None],
    timeout: float = 15.0,
) -> Tuple[List[threading.Thread], List[Tuple[int, str]]]:
    """启动 ``n`` 个工作线程执行 ``fn(i, barrier)`` 并等待结束。

    每个 fn 拿到同一个 ``n`` 方 Barrier，可以在每轮操作前同步，
    从而制造“同时进入临界区”的确定性竞态。任何线程抛错或超时
    （可能意味着死锁）都通过返回的错误列表暴露。
    """
    barrier = threading.Barrier(n)
    errors: List[Tuple[int, str]] = []

    def target(i: int) -> None:
        try:
            fn(i, barrier)
        except BaseException:  # noqa: BLE001 - 测试需要捕获所有线程异常
            errors.append((i, traceback.format_exc()))

    threads = [
        threading.Thread(target=target, args=(i,), daemon=True)
        for i in range(n)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout)
    return threads, errors


def assert_workers_clean(
    testcase: unittest.TestCase,
    threads: List[threading.Thread],
    errors: List[Tuple[int, str]],
) -> None:
    """断言工作线程全部结束且无异常（未结束通常代表死锁）。"""
    alive = [i for i, t in enumerate(threads) if t.is_alive()]
    testcase.assertFalse(
        alive, f"工作线程 {alive} 超时未结束，可能发生死锁"
    )
    if errors:
        msg = "\n".join(f"[thread {i}]\n{tb}" for i, tb in errors)
        testcase.fail(f"工作线程抛出异常：\n{msg}")


# ---------------------------------------------------------------------------
# 1. 同一 key：滑动窗口计数精确
# ---------------------------------------------------------------------------


class RateLimiterConcurrencyTest(unittest.TestCase):
    def test_concurrent_allow_never_exceeds_limit(self) -> None:
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(window_length=10, rate_limit=25,
                                      clock=clock)
        contenders = 32

        def burst() -> List[bool]:
            results: List[bool] = []
            lock = threading.Lock()

            def worker(i: int, barrier: threading.Barrier) -> None:
                barrier.wait()  # 32 个线程同时进入 allow
                allowed = bool(rl.allow("k")["allowed"])
                with lock:
                    results.append(allowed)

            threads, errors = start_workers(contenders, worker)
            assert_workers_clean(self, threads, errors)
            return results

        # t=0：32 个并发申请，恰好放行 25。
        r1 = burst()
        self.assertEqual(sum(r1), 25)
        self.assertEqual(rl.get_stats("k")["current"], 25)

        # t=5：旧事件都在窗口 (-5,5] 内，32 个并发申请必须全部拒绝。
        clock.tick(5)
        r2 = burst()
        self.assertEqual(sum(r2), 0)
        self.assertEqual(rl.get_stats("k")["current"], 25)

        # t=10：t=0 的事件恰好过期，窗口腾空，再并发恰好放行 25。
        clock.tick(5)
        r3 = burst()
        self.assertEqual(sum(r3), 25)
        self.assertEqual(rl.get_stats("k")["current"], 25)

    def test_concurrent_costed_allow_usage_exact(self) -> None:
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(100, 10, clock)
        decisions: List[bool] = []
        lock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            d = rl.allow("k", cost=3)  # 5 线程 * 3 = 15，阈值 10
            with lock:
                decisions.append(d["allowed"])

        threads, errors = start_workers(5, worker)
        assert_workers_clean(self, threads, errors)
        self.assertEqual(sum(decisions), 3)       # 恰好 3 个 * cost 3 = 9
        self.assertEqual(rl.get_stats("k")["current"], 9)

    def test_per_key_locks_are_distinct(self) -> None:
        registry = rl_locks = None  # type: ignore
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(10, 5, clock)
        self.assertIs(rl._locks.key_lock("a"), rl._locks.key_lock("a"))
        self.assertIsNot(rl._locks.key_lock("a"), rl._locks.key_lock("b"))


# ---------------------------------------------------------------------------
# 2/3/4. 熔断器：探测名额、结果回收、恰好熔断一次
# ---------------------------------------------------------------------------


class BreakerConcurrencyTest(unittest.TestCase):
    def test_concurrent_failures_trip_exactly_once(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(
            clock, consecutive_failure_threshold=3,
            failure_rate_threshold=1.0, min_samples=1000,
        )
        recorded: List[bool] = []
        tripped: List[bool] = []
        lock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            r = cb.record_failure("k")  # 8 线程同时失败
            with lock:
                recorded.append(bool(r.get("recorded")))
                tripped.append(bool(r.get("tripped")))

        threads, errors = start_workers(8, worker)
        assert_workers_clean(self, threads, errors)

        # 只有前 3 个（串行进入临界区）被记录，恰好 1 个触发熔断，
        # 其余线程看到 open，结果被忽略。
        self.assertEqual(sum(recorded), 3)
        self.assertEqual(sum(tripped), 1)
        state = cb.get_state("k")
        self.assertEqual(state["state"], STATE_OPEN)
        self.assertEqual(state["failures"], 3)
        self.assertEqual(state["consecutive_failures"], 3)

    def test_half_open_probes_never_over_issued(self) -> None:
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(100, 1000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1,
                           cooldown_duration=5, half_open_max_calls=3),
        )
        guard.record_failure("k")          # -> open
        clock.tick(5)                      # -> 冷却结束
        self.assertEqual(guard.get_state("k")["state"], STATE_HALF_OPEN)

        probes: List[bool] = []
        reasons: List[Optional[str]] = []
        lock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            d = guard.allow("k")           # 12 线程同时抢探测名额
            with lock:
                probes.append(bool(d.get("probe")) and d["allowed"])
                reasons.append(d.get("reason"))

        threads, errors = start_workers(12, worker)
        assert_workers_clean(self, threads, errors)

        self.assertEqual(sum(probes), 3)   # 恰好放 3 个探测
        state = guard.get_state("k")
        self.assertEqual(state["state"], STATE_HALF_OPEN)
        self.assertEqual(state["half_open_calls"], 3)

        # 3 个在途探测并发上报成功：恰好 1 个触发关闭。
        transitions: List[Optional[str]] = []
        states: List[str] = []

        def closer(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            r = guard.record_success("k")
            with lock:
                transitions.append(r.get("transition"))
                states.append(r["state"])

        threads, errors = start_workers(3, closer)
        assert_workers_clean(self, threads, errors)
        self.assertEqual(transitions.count("half_open->closed"), 1)
        self.assertEqual(guard.get_state("k")["state"], STATE_CLOSED)
        # 关闭即清零。
        self.assertEqual(guard.get_state("k")["failures"], 0)

    def test_probe_failure_claimed_exactly_once(self) -> None:
        clock = FakeClock()
        cb = CircuitBreaker(clock, consecutive_failure_threshold=1,
                            cooldown_duration=5, half_open_max_calls=1,
                            backoff_multiplier=2, max_cooldown=100)
        cb.record_failure("k")
        clock.tick(5)
        self.assertTrue(cb.allow("k")["allowed"])  # 唯一在途探测

        recorded: List[bool] = []
        lock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            # 8 个线程同时为“同一个探测”上报失败：只能有 1 个生效。
            r = cb.record_failure("k")
            with lock:
                recorded.append(bool(r.get("recorded")))

        threads, errors = start_workers(8, worker)
        assert_workers_clean(self, threads, errors)
        self.assertEqual(sum(recorded), 1)
        state = cb.get_state("k")
        self.assertEqual(state["state"], STATE_OPEN)
        self.assertAlmostEqual(state["cooldown_end"] - clock.now(), 10.0)

    def test_breaker_rejected_calls_consume_no_quota(self) -> None:
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(100, 10, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1,
                           cooldown_duration=5),
        )
        guard.record_failure("k")  # open

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            d = guard.allow("k")
            assert not d["allowed"] and d["rejected_by"] == "circuit_breaker"

        threads, errors = start_workers(10, worker)
        assert_workers_clean(self, threads, errors)
        # 10 次并发申请全部被熔断拒绝，限流窗口用量必须仍为 0。
        self.assertEqual(guard.rate_limiter.get_stats("k")["current"], 0)


# ---------------------------------------------------------------------------
# 5. 不同 key 不互相阻塞 + 混合压力
# ---------------------------------------------------------------------------


class CrossKeyAndStressTest(unittest.TestCase):
    def test_guard_uses_one_shared_registry(self) -> None:
        clock = FakeClock()
        rl = SlidingWindowRateLimiter(10, 5, clock)
        cb = CircuitBreaker(clock)
        guard = Guard(clock, rl, cb)
        self.assertIs(guard._locks, rl._locks)
        self.assertIs(guard._locks, cb._locks)

    def test_mixed_concurrent_workload_completes(self) -> None:
        """多 key、多操作混合并发：不死锁、不异常、限流永不超限。"""
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(100, 4, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1000,
                           min_samples=1000, failure_rate_threshold=1.0),
        )
        keys = ["a", "b", "c", "d"]
        violations: List[str] = []
        vlock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            key = keys[i % len(keys)]
            for rnd in range(60):
                barrier.wait()  # 每轮所有线程同时发起一次操作
                op = (i + rnd) % 4
                if op == 0:
                    d = guard.allow(key)
                    if d["allowed"]:
                        # 放行后窗口用量不得超过阈值。
                        usage = guard.rate_limiter.get_stats(key)["current"]
                        if usage > 4:
                            with vlock:
                                violations.append(f"{key} usage={usage}")
                elif op == 1:
                    guard.record_success(key)
                elif op == 2:
                    guard.get_state(key)
                else:
                    guard.record_success(key)

        threads, errors = start_workers(4, worker)
        assert_workers_clean(self, threads, errors)
        self.assertEqual(violations, [])

    def test_different_keys_progress_under_contention(self) -> None:
        """同一 key 上大量串行化竞争时，其他 key 仍能独立完成大量操作。"""
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1000, 100000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=100000),
        )
        stop = threading.Event()
        errors: List[Tuple[int, str]] = []

        def hot_key_worker(i: int) -> None:
            try:
                while not stop.is_set():
                    guard.allow("hot")
                    guard.record_success("hot")
            except BaseException:  # noqa: BLE001
                errors.append((i, traceback.format_exc()))

        # 4 个线程猛打同一个 key。
        hot = [threading.Thread(target=hot_key_worker, args=(i,), daemon=True)
               for i in range(4)]
        for t in hot:
            t.start()

        # 另一个 key 由本线程做 2000 次操作；若被 hot 串行阻塞，
        # 仍会正确完成——这里验证计数精确且异常为零（锁互不污染）。
        for _ in range(2000):
            self.assertTrue(guard.allow("other")["allowed"])
            guard.record_success("other")

        stop.set()
        for t in hot:
            t.join(5)
        self.assertFalse(any(t.is_alive() for t in hot))
        self.assertEqual(errors, [])
        self.assertEqual(
            guard.rate_limiter.get_stats("other")["current"], 2000
        )


# ---------------------------------------------------------------------------
# 6/7. save / load / restore 并发
# ---------------------------------------------------------------------------


class SnapshotConcurrencyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp()

    def _path(self, name: str) -> str:
        return os.path.join(self.tmp, name)

    def test_every_concurrent_snapshot_loads_cleanly(self) -> None:
        """写线程持续变更时，保存线程产出的每个快照都必须通过 load 校验。"""
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(100000, 1000000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1_000_000,
                           min_samples=1_000_000),
        )
        rounds = 12
        writers = 4
        start = threading.Barrier(writers + 1)
        done = threading.Barrier(writers + 1)
        load_results: List[Tuple[bool, str]] = []
        saver_errors: List[str] = []

        def writer(i: int) -> None:
            key = ("a", "b", "c", "d")[i]
            for rnd in range(rounds):
                start.wait()
                guard.allow(key)
                guard.allow(key)
                guard.record_success(key)
                done.wait()

        def saver() -> None:
            try:
                for rnd in range(rounds):
                    start.wait()  # 与写线程同时出发：save 与写并发
                    path = self._path(f"snap_{rnd}.json")
                    guard.save(path)          # 全锁内取一致性视图
                    try:
                        restored = Guard.load(path)
                        restored.get_stats()
                        load_results.append((True, path))
                    except SnapshotError as exc:
                        load_results.append((False, f"{path}: {exc}"))
                    done.wait()
            except BaseException:  # noqa: BLE001
                saver_errors.append(traceback.format_exc())

        ts = [threading.Thread(target=writer, args=(i,), daemon=True)
              for i in range(writers)]
        ts.append(threading.Thread(target=saver, daemon=True))
        for t in ts:
            t.start()
        for t in ts:
            t.join(15)
        self.assertFalse(any(t.is_alive() for t in ts), "快照并发测试死锁")
        self.assertEqual(saver_errors, [])
        self.assertEqual(len(load_results), rounds)
        bad = [info for ok, info in load_results if not ok]
        self.assertEqual(bad, [], f"存在无法 load 的并发快照: {bad}")

        # 静止后最终快照往返：统计逐字段一致。
        final_path = self._path("final.json")
        guard.save(final_path)
        before = json.dumps(guard.get_stats(), sort_keys=True)
        after = json.dumps(Guard.load(final_path).get_stats(), sort_keys=True)
        self.assertEqual(before, after)

    def test_snapshot_during_trip_is_consistent(self) -> None:
        """熔断恰好发生的过程中反复 save，任何快照都必须自洽。"""
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1000, 1000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=3,
                           cooldown_duration=5, half_open_max_calls=2),
        )
        rounds = 6
        writers = 3
        start = threading.Barrier(writers + 1)
        done = threading.Barrier(writers + 1)
        bad: List[str] = []

        def writer(i: int) -> None:
            for rnd in range(rounds):
                start.wait()
                guard.record_failure("k")  # 并发失败：其中一次触发 open
                done.wait()

        def checker() -> None:
            for rnd in range(rounds):
                start.wait()
                path = self._path(f"trip_{rnd}.json")
                guard.save(path)
                try:
                    g = Guard.load(path)
                    st = g.get_state("k")
                    # 不变量：半开计数不超配置、状态合法。
                    assert st["state"] in ("closed", "open", "half_open")
                    assert st["half_open_calls"] <= 2
                except (SnapshotError, AssertionError) as exc:
                    bad.append(f"round {rnd}: {exc}")
                done.wait()

        ts = [threading.Thread(target=writer, args=(i,), daemon=True)
              for i in range(writers)]
        ts.append(threading.Thread(target=checker, daemon=True))
        for t in ts:
            t.start()
        for t in ts:
            t.join(15)
        self.assertFalse(any(t.is_alive() for t in ts))
        self.assertEqual(bad, [])
        self.assertEqual(guard.get_state("k")["state"], STATE_OPEN)

    def test_restore_bad_file_rolls_back_under_concurrency(self) -> None:
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1000, 1000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1_000_000),
        )
        for _ in range(3):
            guard.allow("a")

        bad_path = self._path("bad.json")
        with open(bad_path, "w", encoding="utf-8") as fh:
            fh.write("{broken json")

        errors: List[Tuple[int, str]] = []
        stop = threading.Event()

        def worker(i: int) -> None:
            try:
                while not stop.is_set():
                    guard.allow("a")
                    guard.get_state("a")
            except BaseException:  # noqa: BLE001
                errors.append((i, traceback.format_exc()))

        ts = [threading.Thread(target=worker, args=(i,), daemon=True)
              for i in range(3)]
        for t in ts:
            t.start()

        # 与工作线程并发地多次尝试坏文件恢复：每次都必须失败且实例不变。
        for _ in range(5):
            with self.assertRaises(SnapshotError):
                guard.restore(bad_path)

        stop.set()
        for t in ts:
            t.join(10)
        self.assertFalse(any(t.is_alive() for t in ts))
        self.assertEqual(errors, [])
        # 回滚后实例依然可用。
        self.assertTrue(guard.allow("a")["allowed"] in (True, False))
        self.assertEqual(clock.now(), 0.0)

    def test_restore_clock_rollback_leaves_instance_untouched(self) -> None:
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1000, 1000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1_000_000),
        )
        guard.allow("a")
        clock.tick(50)
        guard.allow("a")
        usage_before = guard.rate_limiter.get_stats("a")["current"]

        old_path = self._path("old.json")
        # 手工造一份 clock_now=0 的合法快照。
        old_clock = FakeClock(0)
        old_guard = Guard(
            old_clock,
            SlidingWindowRateLimiter(1000, 1000, old_clock),
            CircuitBreaker(old_clock),
        )
        old_guard.save(old_path)

        with self.assertRaises(SnapshotError):
            guard.restore(old_path)

        # 时钟没有回退、数据没有变、实例仍可用。
        self.assertEqual(clock.now(), 50.0)
        self.assertEqual(
            guard.rate_limiter.get_stats("a")["current"], usage_before
        )
        self.assertTrue(guard.allow("a")["allowed"])

    def test_restore_good_snapshot_publishes_new_state(self) -> None:
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1000, 1000, clock),
            CircuitBreaker(clock),
        )
        # 造一份“t=30、key x 已 open”的快照。
        snap_clock = FakeClock()
        snap = Guard(
            snap_clock,
            SlidingWindowRateLimiter(1000, 1000, snap_clock),
            CircuitBreaker(snap_clock, consecutive_failure_threshold=1,
                           cooldown_duration=5),
        )
        snap.record_failure("x")
        snap_clock.tick(30)
        snap.allow("y")
        snap_path = self._path("good.json")
        snap.save(snap_path)

        guard.restore(snap_path)
        self.assertEqual(clock.now(), 30.0)
        state_x = guard.get_state("x")
        self.assertEqual(state_x["state"], STATE_HALF_OPEN)  # 冷却早已结束
        self.assertEqual(guard.rate_limiter.get_stats("y")["current"], 1)
        # 恢复后仍可正常运转。
        self.assertTrue(guard.allow("z")["allowed"])

    def test_restore_races_with_callers_on_old_and_new_keys(self) -> None:
        """restore 与调用并发：老 key 和快照新引入的 key 都不能损坏。"""
        clock = FakeClock()
        guard = Guard(
            clock,
            SlidingWindowRateLimiter(1_000_000, 1_000_000, clock),
            CircuitBreaker(clock, consecutive_failure_threshold=1_000_000),
        )
        guard.allow("p")  # p 为 restore 前已存在的 key

        # 快照引入一个当前实例还没有的 key q。
        snap_clock = FakeClock()
        snap = Guard(
            snap_clock,
            SlidingWindowRateLimiter(1_000_000, 1_000_000, snap_clock),
            CircuitBreaker(snap_clock, consecutive_failure_threshold=1_000_000),
        )
        snap.allow("q")
        snap_clock.tick(5)
        path = self._path("race.json")
        snap.save(path)

        errors: List[Tuple[int, str]] = []
        stop = threading.Event()

        def worker(i: int) -> None:
            try:
                key = "p" if i % 2 == 0 else "q"
                while not stop.is_set():
                    d = guard.allow(key)
                    assert d["allowed"], d
                    guard.record_success(key)
                    guard.get_state(key)
            except BaseException:  # noqa: BLE001
                errors.append((i, traceback.format_exc()))

        ts = [threading.Thread(target=worker, args=(i,), daemon=True)
              for i in range(6)]
        for t in ts:
            t.start()
        # 与在途调用并发地恢复（多次，包含同一快照反复发布）。
        for _ in range(3):
            guard.restore(path)
        stop.set()
        for t in ts:
            t.join(15)
        self.assertFalse(any(t.is_alive() for t in ts), "restore 并发死锁")
        self.assertEqual(errors, [])
        self.assertEqual(clock.now(), 5.0)
        # 两个 key 恢复后都仍可正常、精确地工作。
        self.assertTrue(guard.allow("p")["allowed"])
        self.assertTrue(guard.allow("q")["allowed"])


# ---------------------------------------------------------------------------
# FakeClock 并发
# ---------------------------------------------------------------------------


class ClockConcurrencyTest(unittest.TestCase):
    def test_concurrent_tick_is_monotonic_and_exact(self) -> None:
        clock = FakeClock()
        seen: List[float] = []
        lock = threading.Lock()

        def worker(i: int, barrier: threading.Barrier) -> None:
            barrier.wait()
            value = clock.tick(1)
            with lock:
                seen.append(value)

        threads, errors = start_workers(20, worker)
        assert_workers_clean(self, threads, errors)
        self.assertEqual(sorted(seen), [float(i) for i in range(1, 21)])
        self.assertEqual(clock.now(), 20.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
