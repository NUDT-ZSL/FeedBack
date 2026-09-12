"""scheduler 的离线验收测试（纯 unittest，无网络、无外部账号、无第三方依赖）。

运行：
    python -m unittest test_scheduler.py -v
"""

import unittest

from scheduler import (
    CalendarResult,
    ConflictKind,
    CycleError,
    DropCheck,
    DropResult,
    InfeasibleDropError,
    InvalidCalendarError,
    Resource,
    ResourceNotFoundError,
    ScheduleError,
    Scheduler,
    StaleTokenError,
    Task,
    TaskNotFoundError,
)

ALLDAY = ((0, 100_000),)


def mk(*task_rows, resources=None):
    """task_rows: (id, start, dur[, deps[, pinned]])"""
    if resources is None:
        resources = [Resource("R1", 1, ALLDAY)]
    tasks = []
    for row in task_rows:
        tid, start, dur = row[0], row[1], row[2]
        deps = row[3] if len(row) > 3 else ()
        pinned = row[4] if len(row) > 4 else False
        tasks.append(Task(tid, "R1", start, dur, tuple(deps), pinned))
    return Scheduler(tasks, resources)


def pos(s, tid):
    t = s.get_task(tid)
    return t.resource_id, t.start, t.end


def cf(check, kind):
    return [
        (c.obj_id, c.overlap)
        for c in check.conflicts if c.kind == kind
    ]


class ModelTests(unittest.TestCase):
    def test_task_end_half_open(self):
        t = Task("a", "R1", 5, 10)
        self.assertEqual((t.start, t.end), (5, 15))

    def test_unknown_task_and_resource(self):
        s = mk(("a", 0, 10))
        with self.assertRaises(TaskNotFoundError):
            s.can_drop("nope", 0, "R1")
        with self.assertRaises(ResourceNotFoundError):
            s.can_drop("a", 0, "NOPE")

    def test_calendar_validation(self):
        with self.assertRaises(InvalidCalendarError):
            Scheduler(resources=[Resource("R1", 1, ((10, 10),))])
        with self.assertRaises(InvalidCalendarError):
            Scheduler(resources=[Resource("R1", 1, ((20, 10),))])
        with self.assertRaises(InvalidCalendarError):
            Scheduler(resources=[Resource("R1", 0, ALLDAY)])

    def test_overlapping_calendar_unioned(self):
        # 重叠日历区间按并集处理：任务落在重叠/接缝处不产生缺口。
        res = Resource("R1", 1, ((0, 400), (300, 700), (600, 2000)))
        s = Scheduler([Task("a", "R1", 350, 50)], [res])
        chk = s.can_drop("a", 650, "R1")
        self.assertTrue(chk.ok)


class NormalDropTests(unittest.TestCase):
    def test_drop_into_free_slot(self):
        s = mk(("a", 0, 10), ("b", 20, 10))
        chk = s.can_drop("b", 10, "R1")
        self.assertIsInstance(chk, DropCheck)
        self.assertTrue(chk.ok)
        self.assertEqual(chk.conflicts, ())
        self.assertEqual(chk.earliest, 10)

        r = s.apply_drop("b", 10, "R1")
        self.assertIsInstance(r, DropResult)
        self.assertEqual(r.moved, ("b",))
        self.assertEqual(r.delayed, ())
        self.assertEqual(pos(s, "a"), ("R1", 0, 10))
        self.assertEqual(pos(s, "b"), ("R1", 10, 20))

    def test_cross_resource_drop(self):
        r1 = Resource("R1", 1, ALLDAY)
        r2 = Resource("R2", 1, ALLDAY)
        s = Scheduler(
            [Task("a", "R1", 0, 10), Task("b", "R1", 10, 10)], [r1, r2]
        )
        chk = s.can_drop("a", 0, "R2")
        self.assertTrue(chk.ok)
        res = s.apply_drop("a", 0, "R2")
        self.assertEqual(pos(s, "a"), ("R2", 0, 10))
        self.assertEqual(pos(s, "b"), ("R1", 10, 20))
        change = [c for c in res.changes if c.task_id == "a"][0]
        self.assertEqual((change.old_resource, change.new_resource), ("R1", "R2"))

    def test_earliest_equals_request_when_free(self):
        s = mk(("a", 0, 10), ("b", 50, 10))
        self.assertEqual(s.can_drop("b", 20, "R1").earliest, 20)


class ConflictTests(unittest.TestCase):
    def test_resource_conflict_single_capacity(self):
        s = mk(("a", 0, 10), ("b", 10, 10))
        chk = s.can_drop("a", 5, "R1")
        self.assertFalse(chk.ok)
        self.assertEqual(cf(chk, ConflictKind.RESOURCE), [("b", (10, 15))])
        self.assertEqual(cf(chk, ConflictKind.CALENDAR), [])
        # 最早可行点：b 结束之后。
        self.assertEqual(chk.earliest, 20)

    def test_resource_conflict_capacity_two(self):
        rc = Resource("RC", 2, ALLDAY)
        s = Scheduler(
            [Task("a", "RC", 0, 10), Task("b", "RC", 0, 10),
             Task("c", "RC", 100, 10)],
            [rc],
        )
        chk = s.can_drop("c", 0, "RC")
        # a、b 在超容时刻同时在场，二者都被列为冲突对象，顺序确定。
        self.assertEqual(
            cf(chk, ConflictKind.RESOURCE),
            [("a", (0, 10)), ("b", (0, 10))],
        )
        self.assertEqual(chk.earliest, 10)

    def test_staggered_tasks_not_false_positive_at_capacity_three(self):
        # cap=3，t[0,30) 与三个错峰任务：[0,10) 并发 t+a+b=3，
        # [10,15) 并发 t+a+c=3，[15,20) 并发 t+c=2，从不超容。
        # 旧的"成对计数"判据会在 t∩a=[0,15) 内数到 b、c 两个而误报 a，
        # 事件点扫描必须判 ok。
        rc = Resource("RC", 3, ALLDAY)
        s = Scheduler(
            [Task("a", "RC", 0, 15), Task("b", "RC", 0, 10),
             Task("c", "RC", 10, 10), Task("t", "RC", 100, 30)],
            [rc],
        )
        chk = s.can_drop("t", 0, "RC")
        self.assertTrue(chk.ok)
        self.assertEqual(cf(chk, ConflictKind.RESOURCE), [])
        self.assertEqual(chk.earliest, 0)

    def test_calendar_unavailable_whole_window(self):
        res = Resource("R2", 1, ((0, 100), (200, 10_000)))
        s = Scheduler([Task("a", "R2", 0, 10)], [res])
        chk = s.can_drop("a", 150, "R2")
        self.assertFalse(chk.ok)
        self.assertEqual(
            cf(chk, ConflictKind.CALENDAR), [("R2", (150, 160))]
        )
        self.assertEqual(chk.earliest, 200)

    def test_calendar_unavailable_partial_gap(self):
        res = Resource("R2", 1, ((0, 100), (200, 10_000)))
        s = Scheduler([Task("a", "R2", 0, 10)], [res])
        chk = s.can_drop("a", 95, "R2")  # [95,105) 跨过 100-200
        self.assertEqual(
            cf(chk, ConflictKind.CALENDAR), [("R2", (100, 105))]
        )
        self.assertEqual(chk.earliest, 200)

    def test_empty_calendar_means_never_available(self):
        res = Resource("RX", 1, ())
        s = Scheduler([Task("a", "RX", 0, 10)], [
            Resource("R1", 1, ALLDAY), res
        ])
        # 该任务所在资源空日历 -> 任意点都冲突，earliest 为 None。
        chk = s.can_drop("a", 0, "RX")
        self.assertFalse(chk.ok)
        self.assertEqual(cf(chk, ConflictKind.CALENDAR), [("RX", (0, 10))])
        self.assertIsNone(chk.earliest)

    def test_dependency_predecessor_violation(self):
        # b 依赖 a（a[0,30)）；把 b 拖到 10 早于 a 结束。
        s = mk(("a", 0, 30), ("b", 100, 10, ("a",)))
        chk = s.can_drop("b", 10, "R1")
        self.assertFalse(chk.ok)
        self.assertEqual(cf(chk, ConflictKind.DEPENDENCY), [("a", (10, 30))])
        self.assertEqual(chk.earliest, 30)

    def test_dependency_successor_violation(self):
        # 把前驱 a 拖晚到顶到后继 b。
        s = mk(("a", 0, 10), ("b", 30, 10, ("a",)))
        chk = s.can_drop("a", 25, "R1")  # a 结束于 35 > b 起点 30
        self.assertFalse(chk.ok)
        self.assertEqual(cf(chk, ConflictKind.DEPENDENCY), [("b", (30, 35))])

    def test_conflict_order_is_deterministic(self):
        # 同时违反依赖与资源占用；冲突按稳定键排序。
        s = mk(("a", 0, 30), ("b", 100, 10, ("a",)))
        chk = s.can_drop("b", 10, "R1")
        kinds = [c.kind for c in chk.conflicts]
        self.assertEqual(kinds, sorted(kinds, key=lambda k: k.value))


class RippleTests(unittest.TestCase):
    def test_resource_push(self):
        s = mk(("a", 0, 10), ("b", 10, 10))
        r = s.apply_drop("a", 5, "R1")
        self.assertEqual(r.moved, ("a",))
        self.assertEqual(r.delayed, ("b",))
        self.assertEqual(pos(s, "a"), ("R1", 5, 15))
        self.assertEqual(pos(s, "b"), ("R1", 15, 25))

    def test_dependency_chain_ripple(self):
        s = mk(
            ("a", 0, 10),
            ("b", 10, 10, ("a",)),
            ("c", 20, 10, ("b",)),
        )
        r = s.apply_drop("a", 5, "R1")
        self.assertEqual(r.delayed, ("b", "c"))
        self.assertEqual(pos(s, "a"), ("R1", 5, 15))
        self.assertEqual(pos(s, "b"), ("R1", 15, 25))
        self.assertEqual(pos(s, "c"), ("R1", 25, 35))

    def test_capacity_two_ripple_pushes_one(self):
        rc = Resource("RC", 2, ALLDAY)
        s = Scheduler(
            [Task("a", "RC", 0, 10), Task("b", "RC", 0, 10),
             Task("c", "RC", 100, 10)],
            [rc],
        )
        r = s.apply_drop("c", 0, "RC")
        self.assertEqual(r.moved, ("c",))
        self.assertEqual(r.delayed, ("b",))
        self.assertEqual(pos(s, "a"), ("RC", 0, 10))
        self.assertEqual(pos(s, "c"), ("RC", 0, 10))
        self.assertEqual(pos(s, "b"), ("RC", 10, 20))

    def test_ripple_blocked_by_pinned_successor(self):
        # a -> b(可移动) -> c(pinned)；拖 a 到 10，b 被顺延但不能越过 c。
        s = mk(
            ("a", 0, 10),
            ("b", 10, 10, ("a",)),
            ("c", 20, 10, ("b",), True),
        )
        snap = s.snapshot()
        r = s.apply_drop("a", 10, "R1")
        self.assertEqual(r.blocked, ("c",))
        self.assertIn("b", r.delayed)
        # pinned c 原地不动。
        self.assertEqual(pos(s, "c"), ("R1", 20, 30))
        self.assertTrue(s.get_task("c").pinned)
        # b 停在 pinned 前（残余重叠），位置确定为 20。
        self.assertEqual(pos(s, "b"), ("R1", 20, 30))
        # 残余冲突同时记录依赖与资源两类，对象都是 c。
        kinds_objs = {(c.kind, c.obj_id, c.overlap) for c in r.residual_conflicts}
        self.assertIn((ConflictKind.DEPENDENCY, "c", (20, 30)), kinds_objs)
        self.assertIn((ConflictKind.RESOURCE, "c", (20, 30)), kinds_objs)

    def test_drop_directly_onto_pinned_at_capacity_rejected(self):
        s = mk(
            ("p", 0, 20, (), True),
            ("a", 100, 10),
        )
        with self.assertRaises(InfeasibleDropError):
            s.apply_drop("a", 5, "R1")

    def test_pinned_alongside_ok_at_higher_capacity(self):
        rc = Resource("R1", 2, ALLDAY)
        s = Scheduler(
            [Task("p", "R1", 0, 20, pinned=True), Task("a", "R1", 100, 10)],
            [rc],
        )
        r = s.apply_drop("a", 5, "R1")
        self.assertEqual(r.blocked, ())
        self.assertEqual(pos(s, "a"), ("R1", 5, 15))
        self.assertEqual(pos(s, "p"), ("R1", 0, 20))

    def test_dragged_pinned_into_unvacatable_window_rejected(self):
        # cap=1：把 pinned 的 t5 从 R1 拖到 R0 的 [197,215)。该窗口与未
        # pinned 的 t6[213,223) 重叠；t6 无法让位，因为它有 pinned 后继
        # t7@223（t6 必须在 223 前结束）。右推无解 -> 整体拒绝、零改动。
        r0 = Resource("R0", 1, ALLDAY)
        r1 = Resource("R1", 1, ALLDAY)
        s = Scheduler(
            [
                Task("t3", "R1", 100, 50),
                Task("t5", "R1", 329, 18, deps=("t3",), pinned=True),
                Task("t6", "R0", 213, 10),
                Task("t7", "R0", 223, 10, deps=("t6",), pinned=True),
            ],
            [r0, r1],
        )
        before = s.snapshot()
        with self.assertRaises(InfeasibleDropError):
            s.apply_drop("t5", 197, "R0")
        self.assertEqual(s.snapshot(), before)

    def test_pinned_task_can_still_be_dragged_to_free_slot(self):
        # 直接拖动 pinned 任务本身允许；落点空闲时正常落位并顶开旁人。
        rc = Resource("R1", 1, ALLDAY)
        s = Scheduler(
            [Task("p", "R1", 100, 10, pinned=True),
             Task("q", "R1", 0, 10)],
            [rc],
        )
        r = s.apply_drop("p", 5, "R1")
        self.assertTrue(s.get_task("p").pinned)  # pinned 属性不丢失
        self.assertEqual(pos(s, "p"), ("R1", 5, 15))
        self.assertEqual(pos(s, "q"), ("R1", 15, 25))

    def test_long_chain_shift_is_exact_no_extra_gap(self):
        # 回归：拖拽子点跨过很多任务后，资源顶人与依赖顺延叠加可能产生
        # 多余空隙。200 任务紧密链，拖 t0 到 1000，每个任务必须恰好右移
        # 1000（t199 从 1990 -> 2990），不能多出一格。
        r = Resource("R", 1, ((0, 10 ** 9),))
        tasks = [Task("t0", "R", 0, 10)]
        for i in range(1, 200):
            tasks.append(Task(f"t{i}", "R", i * 10, 10, deps=(f"t{i-1}",)))
        s = Scheduler(tasks, [r])
        res = s.apply_drop("t0", 1000, "R")
        self.assertEqual(len(res.delayed), 199)
        self.assertEqual(s.get_task("t1").start, 1010)
        self.assertEqual(s.get_task("t199").start, 2990)

    def test_unrelated_tasks_not_moved(self):
        # 同资源但时间上无关、且无依赖关系的任务不得被改动。
        s = mk(
            ("a", 0, 10),
            ("b", 10, 10),
            ("z", 500, 10),
        )
        r = s.apply_drop("a", 5, "R1")
        self.assertNotIn("z", r.delayed)
        self.assertEqual(pos(s, "z"), ("R1", 500, 510))


class HardRejectTests(unittest.TestCase):
    def test_drop_into_calendar_gap_raises_and_state_unchanged(self):
        res = Resource("R2", 1, ((0, 100), (200, 1000)))
        s = Scheduler([Task("a", "R2", 0, 10)], [
            Resource("R1", 1, ALLDAY), res
        ])
        before = s.snapshot()
        with self.assertRaises(InfeasibleDropError):
            s.apply_drop("a", 150, "R2")
        self.assertEqual(s.snapshot(), before)

    def test_drop_before_predecessor_end_raises_and_state_unchanged(self):
        s = mk(("a", 0, 30), ("b", 100, 10, ("a",)))
        before = s.snapshot()
        with self.assertRaises(InfeasibleDropError):
            s.apply_drop("b", 10, "R1")
        self.assertEqual(s.snapshot(), before)


class CycleTests(unittest.TestCase):
    def test_self_dependency(self):
        with self.assertRaises(CycleError) as ctx:
            mk(("x", 0, 10, ("x",)))
        self.assertEqual(ctx.exception.cycle, ("x", "x"))
        self.assertIsInstance(ctx.exception, ScheduleError)

    def test_two_cycle_forward_reference(self):
        r1 = Resource("R1", 1, ALLDAY)
        with self.assertRaises(CycleError) as ctx:
            Scheduler(
                [Task("a", "R1", 0, 10, deps=("b",)),
                 Task("b", "R1", 20, 10, deps=("a",))],
                [r1],
            )
        self.assertEqual(ctx.exception.cycle, ("a", "b", "a"))

    def test_three_cycle(self):
        r1 = Resource("R1", 1, ALLDAY)
        with self.assertRaises(CycleError) as ctx:
            Scheduler(
                [Task("a", "R1", 0, 10, deps=("c",)),
                 Task("b", "R1", 0, 10, deps=("a",)),
                 Task("c", "R1", 0, 10, deps=("b",))],
                [r1],
            )
        self.assertEqual(ctx.exception.cycle, ("a", "c", "b", "a"))

    def test_unknown_dependency_still_rejected(self):
        with self.assertRaises(ScheduleError):
            mk(("a", 0, 10, ("zzz",)))

    def test_failed_construction_creates_no_partial_state(self):
        # 抛错的 Scheduler 对象不可用；新对象不受影响。
        r1 = Resource("R1", 1, ALLDAY)
        with self.assertRaises(CycleError):
            Scheduler(
                [Task("a", "R1", 0, 10, deps=("b",)),
                 Task("b", "R1", 0, 10, deps=("a",))],
                [r1],
            )
        fresh = Scheduler([Task("a", "R1", 0, 10)], [r1])
        self.assertEqual(fresh.get_task("a").start, 0)


class CalendarUpdateTests(unittest.TestCase):
    def test_recalc_lists_invalidated_with_earliest(self):
        r1 = Resource("R1", 1, ((0, 1000),))
        s = Scheduler(
            [Task("a", "R1", 0, 50),
             Task("b", "R1", 500, 50),
             Task("c", "R1", 900, 50)],
            [r1],
        )
        res = s.update_calendar("R1", ((0, 400), (600, 2000)))
        self.assertIsInstance(res, CalendarResult)
        # 只有 b 落进新缺口 [400,600)；a、c 仍被覆盖。
        self.assertEqual(len(res.invalidated), 1)
        inv = res.invalidated[0]
        self.assertEqual((inv.task_id, inv.start, inv.earliest),
                         ("b", 500, 600))
        # 日历实际已更新。
        self.assertEqual(s.get_resource("R1").calendar, ((0, 400), (600, 2000)))

    def test_overlapping_windows_merged(self):
        r1 = Resource("R1", 1, ((0, 1000),))
        s = Scheduler([Task("a", "R1", 0, 50)], [r1])
        s.update_calendar("R1", ((0, 400), (300, 700), (600, 2000)))
        self.assertEqual(s.get_resource("R1").calendar, ((0, 2000),))

    def test_empty_calendar_invalidates_all(self):
        r1 = Resource("R1", 1, ((0, 1000),))
        s = Scheduler(
            [Task("a", "R1", 0, 50), Task("b", "R1", 500, 50)], [r1]
        )
        res = s.update_calendar("R1", ())
        self.assertEqual(
            [(i.task_id, i.earliest) for i in res.invalidated],
            [("a", None), ("b", None)],
        )

    def test_calendar_update_undo(self):
        r1 = Resource("R1", 1, ((0, 1000),))
        s = Scheduler([Task("a", "R1", 0, 50)], [r1])
        token = s.update_calendar("R1", ((0, 10),)).token
        s.undo(token)
        self.assertEqual(s.get_resource("R1").calendar, ((0, 1000),))


class UndoTests(unittest.TestCase):
    def test_drop_undo_restores_fields(self):
        s = mk(("a", 0, 10), ("b", 10, 10))
        before = s.snapshot()
        token = s.apply_drop("a", 5, "R1").token
        self.assertNotEqual(s.snapshot(), before)
        s.undo(token)
        self.assertEqual(s.snapshot(), before)

    def test_multiple_ops_undo_in_reverse(self):
        r1 = Resource("R1", 1, ALLDAY)
        r2 = Resource("R2", 1, ALLDAY)
        s = Scheduler(
            [Task("a", "R1", 0, 10), Task("b", "R1", 10, 10)], [r1, r2]
        )
        before = s.snapshot()
        t1 = s.apply_drop("a", 5, "R1").token
        t2 = s.apply_drop("b", 30, "R1").token
        t3 = s.update_calendar("R2", ((0, 500),)).token

        # 非栈顶 token 必须报错，不能静默。
        with self.assertRaises(StaleTokenError):
            s.undo(t1)

        s.undo(t3)
        self.assertEqual(s.get_resource("R2").calendar, ((0, 100_000),))
        s.undo(t2)
        # t2 撤销后 b 回到 t1 之后的位置（被 a 顶到 15），不是初始的 10。
        self.assertEqual(pos(s, "a"), ("R1", 5, 15))
        self.assertEqual(pos(s, "b"), ("R1", 15, 25))
        s.undo(t1)
        self.assertEqual(s.snapshot(), before)

        # 已消费的 token 再 undo 必须报错。
        with self.assertRaises(StaleTokenError):
            s.undo(t1)

    def test_undo_empty_stack_raises(self):
        s = mk(("a", 0, 10))
        from scheduler import UndoToken
        with self.assertRaises(StaleTokenError):
            s.undo(UndoToken(1, "drop"))

    def test_change_record_roundtrips(self):
        s = mk(("a", 0, 10), ("b", 10, 10))
        res = s.apply_drop("a", 5, "R1")
        entry = res.changes[0]
        self.assertEqual(
            (entry.task_id, entry.old_start, entry.new_start),
            ("a", 0, 5),
        )


class DeterminismTests(unittest.TestCase):
    def test_repeated_operations_identical(self):
        def build():
            return mk(
                ("a", 0, 10),
                ("b", 10, 10, ("a",)),
                ("c", 20, 10, ("b",)),
                ("z", 100, 10),
            )

        ref = build()
        r_ref = ref.apply_drop("a", 5, "R1")
        expected_pos = {
            tid: (t.resource_id, t.start, t.end)
            for tid, t in ((x.task_id, x) for x in ref.tasks_sorted())
        }
        expected_delayed = r_ref.delayed
        for _ in range(20):
            s = build()
            r = s.apply_drop("a", 5, "R1")
            self.assertEqual(r.delayed, expected_delayed)
            self.assertEqual(r.blocked, r_ref.blocked)
            self.assertEqual(
                {tid: pos(s, tid) for tid in expected_pos},
                expected_pos,
            )

    def test_conflict_list_order_stable(self):
        def build():
            rc = Resource("RC", 2, ALLDAY)
            return Scheduler(
                [Task("a", "RC", 0, 10), Task("b", "RC", 0, 10),
                 Task("c", "RC", 100, 10)],
                [rc],
            )
        first = [
            (c.kind.value, c.obj_id, c.overlap)
            for c in build().can_drop("c", 0, "RC").conflicts
        ]
        for _ in range(20):
            cur = [
                (c.kind.value, c.obj_id, c.overlap)
                for c in build().can_drop("c", 0, "RC").conflicts
            ]
            self.assertEqual(cur, first)


if __name__ == "__main__":
    unittest.main(verbosity=2)
