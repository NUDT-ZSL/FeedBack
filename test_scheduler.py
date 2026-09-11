"""test_scheduler.py — 调度内核的 unittest 测试套件。

覆盖：
* Task 字段校验（重复 id、空 owner、负 deadline、bool 伪装整数等）
* 逻辑时钟单调推进与回退报错
* 堆排序契约（deadline / priority / task_id 三级次序）
* 惰性删除不破坏堆序（直接校验内部堆不变量）
* 超时边界 deadline == clock、重复 poll 不重复返回
* 批量取消数量、peek 全已取消、空内核等边界
* max_tasks 上限（含 0）
* save/load 往返一致性、损坏文件报错
* CLI 逐行 JSON 协议
* 数千任务、随机操作与“排序列表 + 线性扫描”参考实现的差分测试
"""

from __future__ import annotations

import io
import json
import os
import random
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from typing import Dict, List, Optional

from main import run as cli_run
from scheduler import DeadlineScheduler, SchedulerError, Task


def make_task(
    task_id: str,
    owner: str = "svc",
    deadline: int = 10,
    priority: int = 0,
    payload=None,
) -> Task:
    return Task(task_id=task_id, owner=owner, deadline=deadline,
                priority=priority, payload=payload)


def assert_valid_heap(testcase: unittest.TestCase, heap: List) -> None:
    """断言 list 满足最小堆不变量（父节点 <= 每个子节点）。"""
    for i in range(1, len(heap)):
        testcase.assertLessEqual(
            heap[(i - 1) // 2], heap[i],
            msg=f"heap invariant violated at index {i}: {heap}",
        )


class TaskValidationTests(unittest.TestCase):
    def test_valid_task_accepted(self):
        t = make_task("a", payload={"nested": [1, 2, {"x": None}]})
        self.assertEqual(t.task_id, "a")

    def test_empty_and_whitespace_ids_rejected(self):
        for bad in ("", "   "):
            with self.assertRaises(SchedulerError) as cm:
                DeadlineScheduler().register(make_task(bad))
            self.assertIn("task_id", str(cm.exception))

    def test_non_string_id_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(Task(123, "o", 1, 0))  # type: ignore[arg-type]

    def test_empty_owner_rejected(self):
        with self.assertRaises(SchedulerError) as cm:
            DeadlineScheduler().register(make_task("a", owner=""))
        self.assertIn("owner", str(cm.exception))

    def test_negative_deadline_rejected(self):
        with self.assertRaises(SchedulerError) as cm:
            DeadlineScheduler().register(make_task("a", deadline=-1))
        self.assertIn("deadline", str(cm.exception))

    def test_bool_fields_rejected(self):
        # bool 虽是 int 子类，但 True/False 不能冒充时间/优先级。
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(Task("a", "o", True, 0))  # type: ignore[arg-type]
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(Task("a", "o", 1, False))  # type: ignore[arg-type]

    def test_float_deadline_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(make_task("a", deadline=1.5))  # type: ignore[arg-type]

    def test_duplicate_task_id_rejected(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", deadline=5))
        with self.assertRaises(SchedulerError) as cm:
            kernel.register(make_task("a", deadline=9))
        self.assertIn("duplicate task_id", str(cm.exception))

    def test_id_not_reused_after_expiry_or_cancel(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", deadline=1))
        kernel.advance_to(2)
        kernel.poll_expired()
        with self.assertRaises(SchedulerError):
            kernel.register(make_task("a", deadline=3))

        kernel.register(make_task("b", deadline=10))
        kernel.cancel("b")
        with self.assertRaises(SchedulerError):
            kernel.register(make_task("b", deadline=10))

    def test_unserializable_payload_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(make_task("a", payload=object()))

    def test_nan_payload_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().register(make_task("a", payload=float("nan")))


class ClockTests(unittest.TestCase):
    def test_initial_clock_is_zero(self):
        self.assertEqual(DeadlineScheduler().clock, 0)

    def test_advance_and_stay(self):
        kernel = DeadlineScheduler()
        self.assertEqual(kernel.advance_to(5), 5)
        self.assertEqual(kernel.clock, 5)
        # 推进到当前值是允许的空操作。
        self.assertEqual(kernel.advance_to(5), 5)

    def test_rollback_rejected_with_values_in_message(self):
        kernel = DeadlineScheduler()
        kernel.advance_to(10)
        with self.assertRaises(SchedulerError) as cm:
            kernel.advance_to(9)
        msg = str(cm.exception)
        self.assertIn("current=10", msg)
        self.assertIn("attempted=9", msg)
        # 报错后时钟不变。
        self.assertEqual(kernel.clock, 10)

    def test_negative_advance_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().advance_to(-1)


class OrderingAndHeapTests(unittest.TestCase):
    def test_ordering_by_deadline_then_priority_then_id(self):
        kernel = DeadlineScheduler()
        for tid, dl, pr in [
            ("late", 10, 0),
            ("same-hi", 5, 2),
            ("same-lo-b", 5, 1),
            ("same-lo-a", 5, 1),
            ("early", 1, 9),
        ]:
            kernel.register(make_task(tid, deadline=dl, priority=pr))
        kernel.advance_to(10)
        ids = [t.task_id for t in kernel.poll_expired()]
        self.assertEqual(
            ids,
            ["early", "same-lo-a", "same-lo-b", "same-hi", "late"],
        )

    def test_negative_priority_orders_first(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("p0", deadline=5, priority=0))
        kernel.register(make_task("pn", deadline=5, priority=-3))
        kernel.advance_to(5)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["pn", "p0"]
        )

    def test_heap_invariant_after_registrations(self):
        kernel = DeadlineScheduler()
        rng = random.Random(1234)
        for i in range(500):
            kernel.register(
                make_task(f"t{i:04d}", owner=f"o{rng.randrange(7)}",
                          deadline=rng.randrange(0, 1000),
                          priority=rng.randrange(-5, 5))
            )
        assert_valid_heap(self, kernel._heap)

    def test_deadline_zero_is_due_immediately(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("z", deadline=0))
        # 文档规则：deadline <= clock 即超时；初始 clock=0。
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["z"]
        )

    def test_boundary_deadline_equals_clock(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("edge", deadline=5))
        kernel.advance_to(4)
        self.assertEqual(kernel.poll_expired(), [])
        kernel.advance_to(5)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["edge"]
        )

    def test_repeated_poll_does_not_repeat_tasks(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", deadline=1))
        kernel.advance_to(2)
        first = kernel.poll_expired()
        second = kernel.poll_expired()
        self.assertEqual([t.task_id for t in first], ["a"])
        self.assertEqual(second, [])
        self.assertEqual(kernel.stats()["expired_tasks"], 1)

    def test_register_after_clock_advanced_is_immediately_due(self):
        kernel = DeadlineScheduler()
        kernel.advance_to(100)
        kernel.register(make_task("latecomer", deadline=50))
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["latecomer"]
        )

    def test_peek_skips_unexpired_and_returns_none_when_empty(self):
        kernel = DeadlineScheduler()
        self.assertIsNone(kernel.peek_next())
        kernel.register(make_task("a", deadline=10))
        self.assertEqual(kernel.peek_next(), 10)
        kernel.advance_to(3)
        self.assertEqual(kernel.peek_next(), 10)

    def test_poll_empty_kernel(self):
        self.assertEqual(DeadlineScheduler().poll_expired(), [])


class LazyDeletionTests(unittest.TestCase):
    def test_cancel_is_lazy_and_heap_invariant_holds(self):
        kernel = DeadlineScheduler()
        rng = random.Random(99)
        for i in range(300):
            kernel.register(
                make_task(f"t{i:04d}",
                          deadline=rng.randrange(0, 500),
                          priority=rng.randrange(0, 4))
            )
        # 取消一半，堆条目应原地保留。
        for i in range(0, 300, 2):
            kernel.cancel(f"t{i:04d}")
        self.assertEqual(kernel.stats()["active_tasks"], 150)
        self.assertGreaterEqual(kernel.stats()["heap_stale_entries"], 150)
        self.assertEqual(kernel.stats()["heap_size"], 300)
        assert_valid_heap(self, kernel._heap)

        # 推进并 poll：任何已取消任务都不能出现，堆序始终成立。
        for t in range(0, 500, 37):
            kernel.advance_to(t)
            due = kernel.poll_expired()
            self.assertTrue(
                all(int(tid[1:]) % 2 == 1 for tid in
                    (x.task_id for x in due))
            )
            assert_valid_heap(self, kernel._heap)

    def test_peek_when_all_tasks_cancelled(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", deadline=5))
        kernel.register(make_task("b", deadline=6))
        kernel.cancel("a")
        kernel.cancel("b")
        # 堆顶惰性条目被清掉后应返回 None，而不是返回已取消任务的 deadline。
        self.assertIsNone(kernel.peek_next())
        self.assertEqual(kernel.poll_expired(), [])
        self.assertEqual(kernel.stats()["heap_size"], 0)

    def test_cancel_nonexistent_and_double_cancel(self):
        kernel = DeadlineScheduler()
        with self.assertRaises(SchedulerError):
            kernel.cancel("ghost")
        kernel.register(make_task("a", deadline=5))
        kernel.cancel("a")
        with self.assertRaises(SchedulerError) as cm:
            kernel.cancel("a")
        self.assertIn("already cancelled", str(cm.exception))

    def test_cancel_empty_id_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().cancel(" ")

    def test_cancelled_task_never_expires(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", deadline=1))
        kernel.register(make_task("b", deadline=1))
        kernel.cancel("a")
        kernel.advance_to(1)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["b"]
        )
        self.assertEqual(kernel.stats()["cancelled_tasks"], 1)
        self.assertEqual(kernel.stats()["expired_tasks"], 1)


class CancelByOwnerTests(unittest.TestCase):
    def test_batch_cancel_counts(self):
        kernel = DeadlineScheduler()
        for tid, owner in [
            ("a1", "alpha"), ("a2", "alpha"),
            ("b1", "beta"), ("a3", "alpha"),
        ]:
            kernel.register(make_task(tid, owner=owner, deadline=10))
        self.assertEqual(kernel.cancel_by_owner("alpha"), 3)
        self.assertEqual(kernel.stats()["active_tasks"], 1)
        self.assertEqual(kernel.stats()["active_by_owner"], {"beta": 1})
        # 再来一次没有可取消的，返回 0。
        self.assertEqual(kernel.cancel_by_owner("alpha"), 0)

    def test_batch_cancel_unknown_owner_returns_zero(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", owner="x", deadline=1))
        self.assertEqual(kernel.cancel_by_owner("nope"), 0)

    def test_batch_cancel_empty_owner_rejected(self):
        with self.assertRaises(SchedulerError):
            DeadlineScheduler().cancel_by_owner("")

    def test_batch_cancel_then_poll(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a1", owner="a", deadline=2))
        kernel.register(make_task("b1", owner="b", deadline=2))
        kernel.cancel_by_owner("a")
        kernel.advance_to(2)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["b1"]
        )
        assert_valid_heap(self, kernel._heap)


class StatsTests(unittest.TestCase):
    def test_stats_shape_and_counts(self):
        kernel = DeadlineScheduler()
        stats = kernel.stats()
        self.assertEqual(stats["clock"], 0)
        self.assertEqual(stats["active_tasks"], 0)
        self.assertEqual(stats["cancelled_tasks"], 0)
        self.assertEqual(stats["expired_tasks"], 0)
        self.assertEqual(stats["heap_stale_entries"], 0)
        self.assertEqual(stats["active_by_owner"], {})
        self.assertIsNone(stats["max_tasks"])

        kernel.register(make_task("a", owner="o1", deadline=5))
        kernel.register(make_task("b", owner="o2", deadline=5))
        kernel.cancel("a")
        kernel.advance_to(5)
        kernel.poll_expired()
        stats = kernel.stats()
        self.assertEqual(stats["active_tasks"], 0)
        self.assertEqual(stats["cancelled_tasks"], 1)
        self.assertEqual(stats["expired_tasks"], 1)
        # poll 从堆顶依次弹出了 a 的惰性条目和 b 的到期条目，堆已清空。
        self.assertEqual(stats["heap_stale_entries"], 0)
        self.assertEqual(stats["heap_size"], 0)

    def test_stale_entries_visible_before_poll(self):
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", owner="o1", deadline=50))
        kernel.register(make_task("b", owner="o2", deadline=10))
        kernel.cancel("b")  # b 在堆顶，但尚未被任何调用物理摘除
        # stats 直接扫描堆，因此能反映出膨胀。
        self.assertEqual(kernel.stats()["heap_stale_entries"], 1)
        # peek 顺带清掉堆顶惰性条目。
        self.assertEqual(kernel.peek_next(), 50)
        self.assertEqual(kernel.stats()["heap_stale_entries"], 0)


class MaxTasksTests(unittest.TestCase):
    def test_construct_bad_limit(self):
        for bad in (-1, 1.5):
            with self.assertRaises(SchedulerError):
                DeadlineScheduler(max_tasks=bad)  # type: ignore[arg-type]

    def test_zero_limit_rejects_everything(self):
        kernel = DeadlineScheduler(max_tasks=0)
        with self.assertRaises(SchedulerError) as cm:
            kernel.register(make_task("a"))
        self.assertIn("max_tasks=0", str(cm.exception))

    def test_limit_rejects_register_but_keeps_state(self):
        kernel = DeadlineScheduler(max_tasks=2)
        kernel.register(make_task("a", deadline=5))
        kernel.register(make_task("b", deadline=6))
        with self.assertRaises(SchedulerError) as cm:
            kernel.register(make_task("c", deadline=7))
        self.assertIn("active task limit reached", str(cm.exception))
        # 被拒绝的任务完全不存在：id 可在任务腾出空位后……仍不可复用
        # （运行期内唯一），这里验证 c 没进活跃集合，a/b 照常工作。
        self.assertEqual(kernel.stats()["active_tasks"], 2)
        kernel.advance_to(6)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()], ["a", "b"]
        )
        # 弹出一个后腾出一个名额；新 id 可以注册。
        kernel.register(make_task("d", deadline=8))
        self.assertEqual(kernel.stats()["active_tasks"], 1)

    def test_cancelled_slot_counts_as_freed(self):
        kernel = DeadlineScheduler(max_tasks=1)
        kernel.register(make_task("a", deadline=100))
        with self.assertRaises(SchedulerError):
            kernel.register(make_task("b", deadline=100))
        kernel.cancel("a")
        kernel.register(make_task("b", deadline=100))
        self.assertEqual(kernel.stats()["active_tasks"], 1)

    def test_unlimited_mode_for_small_reference_runs(self):
        kernel = DeadlineScheduler(max_tasks=None)
        for i in range(100):
            kernel.register(make_task(f"t{i}", deadline=i))
        self.assertEqual(kernel.stats()["active_tasks"], 100)


class SnapshotTests(unittest.TestCase):
    def _build_kernel(self) -> DeadlineScheduler:
        kernel = DeadlineScheduler()
        kernel.register(make_task("a", owner="o1", deadline=5,
                                  payload={"k": 1}))
        kernel.register(make_task("b", owner="o1", deadline=3, priority=2,
                                  payload=[1, "x"]))
        kernel.register(make_task("c", owner="o2", deadline=8, payload=None))
        kernel.cancel("b")
        kernel.advance_to(4)
        return kernel

    def test_roundtrip_file(self):
        kernel = self._build_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            kernel.save(path)
            restored = DeadlineScheduler.load(path)

        self.assertEqual(restored.clock, 4)
        before = kernel.stats()
        after = restored.stats()
        # 逻辑计数完全一致；堆物理指标允许因快照压缩而不同（堆被重建成
        # 只含活跃任务，惰性条目归零）。
        for key in ("clock", "active_tasks", "cancelled_tasks",
                    "expired_tasks", "active_by_owner", "max_tasks"):
            self.assertEqual(after[key], before[key], msg=key)
        self.assertEqual(after["heap_size"], after["active_tasks"])
        # 堆被压缩：只剩活跃任务，且仍是合法堆。
        assert_valid_heap(self, restored._heap)
        self.assertEqual(restored.stats()["heap_stale_entries"], 0)
        self.assertEqual(restored.peek_next(), 5)

        # 继续推进并 poll：结果与未保存过的内核完全一致。
        kernel.advance_to(10)
        restored.advance_to(10)
        self.assertEqual(
            [t.task_id for t in restored.poll_expired()],
            [t.task_id for t in kernel.poll_expired()],
        )

    def test_roundtrip_then_register_and_poll(self):
        kernel = self._build_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            kernel.save(path)
            restored = DeadlineScheduler.load(path)
        restored.register(make_task("d", owner="o3", deadline=4))
        restored.advance_to(4)
        # clock=4：deadline=4 的 d 到期；a 的 deadline=5 尚未到期。
        ids = [t.task_id for t in restored.poll_expired()]
        self.assertEqual(ids, ["d"])
        restored.advance_to(5)
        self.assertEqual(
            [t.task_id for t in restored.poll_expired()], ["a"]
        )
        # 快照里已取消的 b 不能复活。
        self.assertEqual(restored.stats()["cancelled_tasks"], 1)

    def test_save_creates_missing_parent_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "deep" / "state.json"
            kernel = DeadlineScheduler()
            kernel.register(make_task("a", deadline=1))
            kernel.save(path)
            self.assertTrue(path.exists())

    def test_load_missing_file(self):
        with self.assertRaises(SchedulerError) as cm:
            DeadlineScheduler.load("definitely-not-here.json")
        self.assertIn("not found", str(cm.exception))

    def test_load_corrupt_json_reports_location(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not json", encoding="utf-8")
            with self.assertRaises(SchedulerError) as cm:
                DeadlineScheduler.load(path)
            self.assertIn("corrupt snapshot", str(cm.exception))

    def _expect_snapshot_error(self, data, fragment):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            path.write_text(json.dumps(data), encoding="utf-8")
            with self.assertRaises(SchedulerError) as cm:
                DeadlineScheduler.load(path)
        self.assertIn(fragment, str(cm.exception),
                      msg=f"expected {fragment!r} in {cm.exception!s}")

    def test_load_rejects_inconsistent_snapshots(self):
        good = self._build_kernel().to_snapshot()

        bad_version = json.loads(json.dumps(good))
        bad_version["version"] = 999
        self._expect_snapshot_error(bad_version, "unsupported version")

        bad_clock = json.loads(json.dumps(good))
        bad_clock["clock"] = -3
        self._expect_snapshot_error(bad_clock, "clock")

        dup = json.loads(json.dumps(good))
        for rec in dup["tasks"]:
            rec["task_id"] = "same"
        self._expect_snapshot_error(dup, "duplicate task_id")

        neg_dl = json.loads(json.dumps(good))
        neg_dl["tasks"][0]["deadline"] = -1
        self._expect_snapshot_error(neg_dl, "deadline")

        bad_pr = json.loads(json.dumps(good))
        bad_pr["tasks"][0]["priority"] = "high"
        self._expect_snapshot_error(bad_pr, "priority")

        missing_field = json.loads(json.dumps(good))
        del missing_field["tasks"][0]["owner"]
        self._expect_snapshot_error(missing_field, "missing fields")

        bad_stats = json.loads(json.dumps(good))
        bad_stats["stats"]["cancelled"] = 42
        self._expect_snapshot_error(bad_stats, "stats.cancelled")

        dangling_cancel = json.loads(json.dumps(good))
        # 取消标记与任务对应：每个 cancelled=true 必须有对应记录本身，
        # 这里把 cancelled 标志放成字符串类型。
        dangling_cancel["tasks"][0]["cancelled"] = "yes"
        self._expect_snapshot_error(dangling_cancel, "cancelled")

        over_limit = json.loads(json.dumps(good))
        over_limit["max_tasks"] = 1
        self._expect_snapshot_error(over_limit, "max_tasks")

    def test_load_rejects_top_level_garbage(self):
        self._expect_snapshot_error([1, 2, 3], "top-level")

    def test_max_tasks_preserved_across_roundtrip(self):
        kernel = DeadlineScheduler(max_tasks=7)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "s.json"
            kernel.save(path)
            restored = DeadlineScheduler.load(path)
        self.assertEqual(restored.max_tasks, 7)


# ---------------------------------------------------------------------------
# 参考实现：排序列表 + 线性扫描
# ---------------------------------------------------------------------------
class ReferenceKernel:
    """与 DeadlineScheduler 语义对齐的朴素实现，专用于差分测试。"""

    def __init__(self, max_tasks: Optional[int] = None):
        self.clock = 0
        self.active: Dict[str, Task] = {}
        self.cancelled: set = set()
        self.expired: set = set()
        self.known: set = set()
        self.max_tasks = max_tasks

    def register(self, task: Task):
        if task.task_id in self.known:
            raise SchedulerError("dup")
        if self.max_tasks is not None and len(self.active) >= self.max_tasks:
            raise SchedulerError("limit")
        self.active[task.task_id] = task
        self.known.add(task.task_id)

    def cancel(self, task_id: str):
        if task_id in self.active:
            del self.active[task_id]
            self.cancelled.add(task_id)
            return True
        if task_id in self.cancelled:
            raise SchedulerError("already cancelled")
        raise SchedulerError("not found")

    def cancel_by_owner(self, owner: str) -> int:
        ids = [tid for tid, t in self.active.items() if t.owner == owner]
        for tid in ids:
            del self.active[tid]
            self.cancelled.add(tid)
        return len(ids)

    def advance_to(self, t: int):
        if t < self.clock:
            raise SchedulerError("backwards")
        self.clock = t

    def peek_next(self):
        if not self.active:
            return None
        return min(t.deadline for t in self.active.values())

    def poll_expired(self):
        due = [t for t in self.active.values()
               if t.deadline <= self.clock]
        due.sort(key=lambda t: (t.deadline, t.priority, t.task_id))
        for t in due:
            del self.active[t.task_id]
            self.expired.add(t.task_id)
        return due


class DifferentialTests(unittest.TestCase):
    def _run_scenario(self, seed: int, n: int, owners: int,
                      max_tasks: Optional[int]):
        rng = random.Random(seed)
        kernel = DeadlineScheduler(max_tasks=max_tasks)
        reference = ReferenceKernel(max_tasks=max_tasks)
        next_id = 0

        def new_id():
            nonlocal next_id
            tid = f"t{next_id:05d}"
            next_id += 1
            return tid

        for _ in range(n):
            roll = rng.random()
            if roll < 0.55:
                tid = new_id()
                task = Task(
                    task_id=tid,
                    owner=f"owner-{rng.randrange(owners)}",
                    deadline=rng.randrange(0, 500),
                    priority=rng.randrange(-3, 4),
                    payload={"i": next_id, "ok": rng.random() < 0.5},
                )
                try:
                    kernel.register(task)
                except SchedulerError:
                    with self.assertRaises(SchedulerError):
                        reference.register(task)
                else:
                    reference.register(task)
            elif roll < 0.70:
                target = kernel.clock + rng.randrange(0, 20)
                kernel.advance_to(target)
                reference.advance_to(target)
            elif roll < 0.80:
                kid = [tid for tid in reference.active
                       if rng.random() < 0.3]
                if kid:
                    tid = rng.choice(kid)
                    kernel.cancel(tid)
                    reference.cancel(tid)
            elif roll < 0.90:
                owner = f"owner-{rng.randrange(owners)}"
                self.assertEqual(
                    kernel.cancel_by_owner(owner),
                    reference.cancel_by_owner(owner),
                )
            else:
                # poll：两个实现的顺序与集合必须完全一致。
                got = kernel.poll_expired()
                want = reference.poll_expired()
                self.assertEqual(
                    [(t.task_id, t.deadline, t.priority) for t in got],
                    [(t.task_id, t.deadline, t.priority) for t in want],
                )
                assert_valid_heap(self, kernel._heap)

            # 每一步都比对 peek 与统计计数。
            self.assertEqual(kernel.peek_next(), reference.peek_next())
            self.assertEqual(kernel.stats()["active_tasks"],
                             len(reference.active))

        # 最终：把时钟推过所有可能的 deadline，全部 poll 干净。
        end = kernel.clock + 1000
        kernel.advance_to(end)
        reference.advance_to(end)
        got = kernel.poll_expired()
        want = reference.poll_expired()
        self.assertEqual(
            [t.task_id for t in got], [t.task_id for t in want]
        )
        self.assertEqual(kernel.stats()["active_tasks"], 0)

    def test_large_random_scenario_unlimited(self):
        self._run_scenario(seed=2026, n=4000, owners=6, max_tasks=None)

    def test_large_random_scenario_capped(self):
        self._run_scenario(seed=77, n=3000, owners=4, max_tasks=250)

    def test_random_with_snapshot_resume(self):
        """随机跑到一半 save/load，恢复后与参考实现继续比对。"""
        rng = random.Random(31337)
        kernel = DeadlineScheduler(max_tasks=300)
        reference = ReferenceKernel(max_tasks=300)
        next_id = 0

        def step(k: DeadlineScheduler, r: ReferenceKernel):
            nonlocal next_id
            roll = rng.random()
            if roll < 0.5:
                tid = f"t{next_id:05d}"
                next_id += 1
                task = Task(tid, f"owner-{rng.randrange(5)}",
                            rng.randrange(0, 300), rng.randrange(-2, 3), None)
                try:
                    k.register(task)
                except SchedulerError:
                    self.assertRaises(SchedulerError, r.register, task)
                else:
                    r.register(task)
            elif roll < 0.7:
                t = k.clock + rng.randrange(0, 15)
                k.advance_to(t)
                r.advance_to(t)
            elif roll < 0.8:
                if not r.active:
                    return  # 没有可取消的任务，跳过本轮
                t = rng.choice(list(r.active))
                k.cancel(t)
                r.cancel(t)
            elif roll < 0.9:
                k.poll_expired()
                r.poll_expired()
            else:
                owner = f"owner-{rng.randrange(5)}"
                self.assertEqual(k.cancel_by_owner(owner),
                                 r.cancel_by_owner(owner))

        for _ in range(800):
            step(kernel, reference)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "mid.json"
            kernel.save(path)
            kernel = DeadlineScheduler.load(path)

        for _ in range(800):
            step(kernel, reference)

        end = kernel.clock + 1000
        kernel.advance_to(end)
        reference.advance_to(end)
        self.assertEqual(
            [t.task_id for t in kernel.poll_expired()],
            [t.task_id for t in reference.poll_expired()],
        )


class CliTests(unittest.TestCase):
    def test_full_protocol_session(self):
        commands = [
            '{"cmd": "init", "max_tasks": 10}',
            '{"cmd": "register", "task": {"task_id": "a", "owner": "o",'
            ' "deadline": 5, "priority": 0, "payload": {"x": 1}}}',
            '{"cmd": "register", "task_id": "b", "owner": "o",'
            ' "deadline": 5, "priority": -1}',
            '{"cmd": "peek"}',
            '{"cmd": "advance", "time": 5}',
            '{"cmd": "poll"}',
            '{"cmd": "poll"}',
            '{"cmd": "cancel_owner", "owner": "o"}',
            '{"cmd": "stats"}',
            '{"cmd": "frobnicate"}',
            'not json at all',
            '{"cmd": "advance", "time": 2}',
        ]
        out = cli_run(commands)
        results = [json.loads(line) for line in out]
        self.assertTrue(results[0]["ok"])
        self.assertTrue(results[1]["ok"])
        self.assertTrue(results[2]["ok"])
        self.assertEqual(results[3]["next"], 5)
        self.assertTrue(results[4]["ok"])
        self.assertEqual([t["task_id"] for t in results[5]["tasks"]],
                         ["b", "a"])  # priority -1 先
        self.assertEqual(results[6]["tasks"], [])
        self.assertEqual(results[7]["count"], 0)  # 已全部超时弹出
        self.assertTrue(results[8]["ok"])
        self.assertFalse(results[9]["ok"])
        self.assertIn("unknown command", results[9]["error"])
        self.assertFalse(results[10]["ok"])
        self.assertIn("invalid JSON", results[10]["error"])
        self.assertFalse(results[11]["ok"])
        self.assertIn("cannot go backwards", results[11]["error"])
        for line in out:
            self.assertTrue(line.strip())

    def test_save_load_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            commands = [
                '{"cmd": "register", "task": {"task_id": "a", "owner": "o",'
                ' "deadline": 9, "priority": 0}}',
                '{"cmd": "advance", "time": 3}',
                f'{{"cmd": "save", "path": {json.dumps(path)}}}',
                f'{{"cmd": "load", "path": {json.dumps(path)}}}',
                '{"cmd": "peek"}',
                '{"cmd": "dump"}',
            ]
            results = [json.loads(line) for line in cli_run(commands)]
            for r in results[:4]:
                self.assertTrue(r["ok"], msg=r)
            self.assertEqual(results[4]["next"], 9)
            self.assertEqual(results[5]["snapshot"]["clock"], 3)

    def test_load_missing_file_is_json_error(self):
        out = cli_run(['{"cmd": "load", "path": "no-such-file.json"}'])
        result = json.loads(out[0])
        self.assertFalse(result["ok"])
        self.assertIn("error", result)

    def test_main_reads_stdin_and_writes_stdout(self):
        import sys
        buf = io.StringIO(
            '{"cmd": "register", "task": {"task_id": "a", "owner": "o",'
            ' "deadline": 0, "priority": 0}}\n'
            '{"cmd": "poll"}\n'
            '\n'
        )
        out = io.StringIO()
        old_stdin = sys.stdin
        sys.stdin = buf
        try:
            with redirect_stdout(out):
                import main as main_mod
                rc = main_mod.main()
        finally:
            sys.stdin = old_stdin
        self.assertEqual(rc, 0)
        lines = [json.loads(line) for line in out.getvalue().splitlines()]
        self.assertTrue(lines[0]["ok"])
        self.assertEqual([t["task_id"] for t in lines[1]["tasks"]], ["a"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
