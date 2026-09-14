"""核心调度逻辑测试：准入判断、承诺保护、抢占回退、容量时间线、时钟。"""

import unittest
from fractions import Fraction

from batch_scheduler.core import (
    Scheduler,
    SchedulerError,
    REASON_CAPACITY_INSUFFICIENT,
    REASON_DEADLINE_PASSED,
    REASON_DUPLICATE_TASK_ID,
    REASON_RESOURCE_NOT_FOUND,
    STATUS_PENDING,
    STATUS_SCHEDULED,
)


class AdmissionTests(unittest.TestCase):
    """基本准入判断与各类拒绝原因。"""

    def setUp(self) -> None:
        self.s = Scheduler()
        self.s.register_resource("r1", 2)

    def test_admit_simple(self) -> None:
        result = self.s.submit_task("t1", "r1", 4, 10)
        self.assertTrue(result.admitted)
        task = self.s.tasks["t1"]
        self.assertEqual(task.status, STATUS_SCHEDULED)
        self.assertEqual(task.start, Fraction(0))
        self.assertEqual(task.end, Fraction(2))  # 4 / 2 = 2

    def test_reject_unknown_resource(self) -> None:
        result = self.s.submit_task("t1", "nope", 4, 10)
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_RESOURCE_NOT_FOUND)
        self.assertEqual(len(self.s.tasks), 0)
        records = self.s.query_records()
        self.assertEqual(len(records["rejections"]), 1)
        self.assertEqual(records["rejections"][0]["reason"], REASON_RESOURCE_NOT_FOUND)
        self.assertEqual(records["rejections"][0]["task_id"], "t1")

    def test_reject_deadline_passed(self) -> None:
        self.s.advance_clock(5)
        result = self.s.submit_task("t1", "r1", 1, 5)  # 截止 == 当前时钟也视为已过
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_DEADLINE_PASSED)

    def test_reject_duplicate_task_id(self) -> None:
        self.assertTrue(self.s.submit_task("t1", "r1", 1, 10).admitted)
        result = self.s.submit_task("t1", "r1", 1, 10)
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_DUPLICATE_TASK_ID)

    def test_reject_capacity_insufficient_keeps_state(self) -> None:
        self.assertTrue(self.s.submit_task("t1", "r1", 2, 10).admitted)
        before = self.s.query_task("t1")
        result = self.s.submit_task("big", "r1", 100, 3)  # 需要 50 单位时间
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_CAPACITY_INSUFFICIENT)
        self.assertNotIn("big", self.s.tasks)
        self.assertEqual(self.s.query_task("t1"), before)  # 已排入任务不受影响

    def test_zero_capacity_resource(self) -> None:
        self.s.register_resource("r0", 0)
        result = self.s.submit_task("t", "r0", 1, 100)
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_CAPACITY_INSUFFICIENT)

    def test_negative_capacity_rejected_at_registration(self) -> None:
        with self.assertRaises(SchedulerError):
            self.s.register_resource("bad", -1)

    def test_invalid_amount(self) -> None:
        with self.assertRaises(SchedulerError):
            self.s.submit_task("t", "r1", 0, 10)
        with self.assertRaises(SchedulerError):
            self.s.submit_task("t", "r1", -3, 10)

    def test_empty_system_queries(self) -> None:
        empty = Scheduler()
        records = empty.query_records()
        self.assertEqual(records["rejections"], [])
        self.assertEqual(records["preemptions"], [])
        with self.assertRaises(SchedulerError):
            empty.query_occupancy("r1", 0, 10)
        with self.assertRaises(SchedulerError):
            empty.query_task("t1")


class CommittedProtectionTests(unittest.TestCase):
    """已承诺任务不得被后续任务挤掉。"""

    def setUp(self) -> None:
        self.s = Scheduler()
        self.s.register_resource("r1", 1)

    def test_committed_exact_deadline_boundary(self) -> None:
        # 恰好卡在截止边界：end == deadline，应准入。
        result = self.s.submit_task("c", "r1", 4, 4, committed=True)
        self.assertTrue(result.admitted)
        self.assertEqual(self.s.tasks["c"].end, Fraction(4))

    def test_new_task_squeezing_committed_is_rejected(self) -> None:
        self.assertTrue(self.s.submit_task("c", "r1", 4, 4, committed=True).admitted)
        self.assertTrue(self.s.submit_task("t3", "r1", 1, 10).admitted)  # [4,5]
        # t2 截止更早，按 EDF 会排到 c 前面，使 c 无法按时完成 → 必须拒绝。
        result = self.s.submit_task("t2", "r1", 2, 3)
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_CAPACITY_INSUFFICIENT)
        # 已承诺任务区间不变。
        self.assertEqual(self.s.tasks["c"].start, Fraction(0))
        self.assertEqual(self.s.tasks["c"].end, Fraction(4))

    def test_committed_tasks_protect_each_other(self) -> None:
        self.assertTrue(self.s.submit_task("c1", "r1", 3, 3, committed=True).admitted)
        result = self.s.submit_task("c2", "r1", 2, 4, committed=True)
        # c2 排在 c1 后 [3,5] 超过自身截止 4 → 拒绝，且 c1 不变。
        self.assertFalse(result.admitted)
        self.assertEqual(self.s.tasks["c1"].end, Fraction(3))


class PreemptionTests(unittest.TestCase):
    """紧急任务抢占非紧急任务、被抢占任务回退与重新准入。"""

    def setUp(self) -> None:
        self.s = Scheduler()
        self.s.register_resource("r1", 1)

    def test_committed_preempts_non_committed(self) -> None:
        self.assertTrue(self.s.submit_task("a", "r1", 3, 3, priority=1).admitted)  # [0,3]
        self.assertTrue(self.s.submit_task("b", "r1", 2, 10, priority=5).admitted)  # [3,5]
        # 紧急任务 u 截止 4：EDF 下 a[0,3]、u[3,5] 超时，仅凭重排不可行，
        # 需抢占优先级最低的 a。
        result = self.s.submit_task("u", "r1", 2, 4, committed=True)
        self.assertTrue(result.admitted)
        self.assertEqual(result.preempted, ["a"])
        u = self.s.tasks["u"]
        self.assertEqual((u.start, u.end), (Fraction(0), Fraction(2)))
        # 被抢占任务回到待排状态，处理量与截止时刻不变。
        a = self.s.tasks["a"]
        self.assertEqual(a.status, STATUS_PENDING)
        self.assertIsNone(a.start)
        self.assertIsNone(a.end)
        self.assertEqual(a.amount, Fraction(3))
        self.assertEqual(a.deadline, Fraction(3))
        # 抢占记录包含原因与触发者。
        records = self.s.query_records()["preemptions"]
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["task_id"], "a")
        self.assertEqual(records[0]["displaced_by"], "u")
        self.assertIn("u", records[0]["reason"])

    def test_failed_committed_submission_rolls_back_preemption(self) -> None:
        self.assertTrue(self.s.submit_task("a", "r1", 2, 10).admitted)  # [0,2]
        # 即使抢占 a 也无法容纳的紧急任务 → 拒绝，且 a 保持已排入。
        result = self.s.submit_task("u", "r1", 100, 4, committed=True)
        self.assertFalse(result.admitted)
        self.assertEqual(result.reason, REASON_CAPACITY_INSUFFICIENT)
        a = self.s.tasks["a"]
        self.assertEqual(a.status, STATUS_SCHEDULED)
        self.assertEqual((a.start, a.end), (Fraction(0), Fraction(2)))
        self.assertEqual(self.s.query_records()["preemptions"], [])

    def test_manual_preempt_and_errors(self) -> None:
        self.assertTrue(self.s.submit_task("a", "r1", 2, 10).admitted)
        self.assertTrue(self.s.submit_task("c", "r1", 1, 9, committed=True).admitted)
        # 抢占不存在的任务。
        with self.assertRaises(SchedulerError) as ctx:
            self.s.preempt_task("ghost")
        self.assertEqual(ctx.exception.code, "task_not_found")
        # 承诺任务不可被抢占。
        with self.assertRaises(SchedulerError) as ctx:
            self.s.preempt_task("c")
        self.assertEqual(ctx.exception.code, "cannot_preempt_committed")
        # 正常抢占。
        record = self.s.preempt_task("a", reason="manual_check")
        self.assertEqual(record["reason"], "manual_check")
        self.assertEqual(self.s.tasks["a"].status, STATUS_PENDING)
        # 待排任务不能被再次抢占。
        with self.assertRaises(SchedulerError) as ctx:
            self.s.preempt_task("a")
        self.assertEqual(ctx.exception.code, "task_not_scheduled")

    def test_preempted_task_readmitted_on_clock_advance(self) -> None:
        self.assertTrue(self.s.submit_task("a", "r1", 2, 4).admitted)  # [0,2]
        self.assertTrue(self.s.submit_task("b", "r1", 2, 10).admitted)  # [2,4]
        self.s.preempt_task("b")
        self.assertEqual(self.s.tasks["b"].status, STATUS_PENDING)
        resumed = self.s.advance_clock(2)
        self.assertEqual(resumed, ["b"])
        b = self.s.tasks["b"]
        self.assertEqual(b.status, STATUS_SCHEDULED)
        self.assertEqual((b.start, b.end), (Fraction(2), Fraction(4)))

    def test_pending_retry_respects_priority_order(self) -> None:
        self.assertTrue(self.s.submit_task("m", "r1", 2, 20, priority=1).admitted)
        self.assertTrue(self.s.submit_task("n", "r1", 2, 20, priority=5).admitted)
        self.s.preempt_task("m")
        self.s.preempt_task("n")
        resumed = self.s.advance_clock(4)
        # 优先级高的 n 先重新准入，占据更早的位置。
        self.assertEqual(resumed, ["n", "m"])
        self.assertEqual((self.s.tasks["n"].start, self.s.tasks["n"].end), (Fraction(4), Fraction(6)))
        self.assertEqual((self.s.tasks["m"].start, self.s.tasks["m"].end), (Fraction(6), Fraction(8)))

    def test_clock_cannot_go_backward(self) -> None:
        self.s.advance_clock(5)
        with self.assertRaises(SchedulerError) as ctx:
            self.s.advance_clock(4)
        self.assertEqual(ctx.exception.code, "invalid_clock")
        self.assertEqual(self.s.clock, Fraction(5))


class CapacityTimelineTests(unittest.TestCase):
    """容量时间线：区间不重叠、占用查询、任务位置查询。"""

    def setUp(self) -> None:
        self.s = Scheduler()
        self.s.register_resource("r1", 2)

    def test_intervals_never_overlap(self) -> None:
        for tid, amount, deadline in [("a", 2, 10), ("b", 4, 10), ("c", 6, 20)]:
            self.assertTrue(self.s.submit_task(tid, "r1", amount, deadline).admitted)
        intervals = [
            (t.start, t.end) for t in self.s.tasks.values() if t.status == STATUS_SCHEDULED
        ]
        intervals.sort()
        for (prev_start, prev_end), (next_start, next_end) in zip(intervals, intervals[1:]):
            self.assertLessEqual(prev_end, next_start)

    def test_query_occupancy(self) -> None:
        self.s.submit_task("a", "r1", 2, 10)  # [0,1]
        self.s.submit_task("b", "r1", 4, 10)  # [1,3]
        occ = self.s.query_occupancy("r1", 0, 10)
        self.assertEqual(
            [(iv["task_id"], iv["start"], iv["end"]) for iv in occ["intervals"]],
            [("a", Fraction(0), Fraction(1)), ("b", Fraction(1), Fraction(3))],
        )
        self.assertEqual(occ["total_busy"], Fraction(3))
        # 范围裁剪：只统计与 [0, 2) 相交的部分。
        occ2 = self.s.query_occupancy("r1", 0, 2)
        self.assertEqual(occ2["total_busy"], Fraction(2))
        # 空范围。
        occ3 = self.s.query_occupancy("r1", 5, 10)
        self.assertEqual(occ3["intervals"], [])
        self.assertEqual(occ3["total_busy"], Fraction(0))

    def test_query_task_position_and_completion(self) -> None:
        self.s.submit_task("a", "r1", 2, 10)
        self.s.submit_task("b", "r1", 4, 10)
        info = self.s.query_task("b")
        self.assertEqual(info["start"], Fraction(1))
        self.assertEqual(info["end"], Fraction(3))  # 预计完成时刻
        self.assertEqual(info["status"], STATUS_SCHEDULED)

    def test_urgent_task_jumps_queue_by_deadline(self) -> None:
        # 紧急插队：截止更早的任务排到先到的任务前面。
        self.s.submit_task("late", "r1", 4, 100)  # [0,2]
        self.s.submit_task("urgent", "r1", 2, 5, committed=True)
        self.assertEqual(
            (self.s.tasks["urgent"].start, self.s.tasks["urgent"].end),
            (Fraction(0), Fraction(1)),
        )
        self.assertEqual(
            (self.s.tasks["late"].start, self.s.tasks["late"].end),
            (Fraction(1), Fraction(3)),
        )


if __name__ == "__main__":
    unittest.main()
