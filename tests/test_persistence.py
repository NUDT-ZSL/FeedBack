"""导出/导入测试：往返一致性与各类校验失败。"""

import json
import os
import tempfile
import unittest
from fractions import Fraction

from batch_scheduler.core import Scheduler, SchedulerError, STATUS_PENDING, STATUS_SCHEDULED
from batch_scheduler import persistence


def build_sample_scheduler() -> Scheduler:
    """构造一个包含承诺任务、待排任务、拒绝与抢占记录的样例状态。"""
    s = Scheduler()
    s.register_resource("r1", 1)
    s.register_resource("r2", 4)
    s.submit_task("a", "r1", 3, 3, priority=1)
    s.submit_task("b", "r1", 2, 10, priority=5)
    s.submit_task("u", "r1", 2, 4, committed=True)  # 抢占 a
    s.submit_task("ghost", "no-such-resource", 1, 10)  # 被拒绝
    s.submit_task("c", "r2", Fraction(1, 3) * 4, 7)  # 非二进制友好的分数时长
    s.advance_clock(2)
    return s


class RoundTripTests(unittest.TestCase):
    """导出后重新载入，状态应完全一致。"""

    def test_round_trip_via_file(self) -> None:
        original = build_sample_scheduler()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            persistence.export_state(original, path)
            loaded = persistence.import_state(path)
        self.assertEqual(
            persistence.state_to_dict(original), persistence.state_to_dict(loaded)
        )

    def test_round_trip_preserves_fractions(self) -> None:
        s = Scheduler()
        s.register_resource("r", 3)
        s.submit_task("t", "r", 1, 10)  # 时长 1/3，浮点无法精确表示
        data = persistence.state_to_dict(s)
        loaded = persistence.state_from_dict(json.loads(json.dumps(data)))
        self.assertEqual(loaded.tasks["t"].end, Fraction(1, 3))

    def test_round_trip_via_dict(self) -> None:
        original = build_sample_scheduler()
        data = json.loads(json.dumps(persistence.state_to_dict(original)))
        loaded = persistence.state_from_dict(data)
        self.assertEqual(persistence.state_to_dict(original), persistence.state_to_dict(loaded))
        # 载入后的状态可以继续推进。
        loaded.advance_clock(3)
        self.assertEqual(loaded.clock, Fraction(3))


class ImportValidationTests(unittest.TestCase):
    """导入校验：字段缺失、标识重复、非法数值、容量冲突、承诺被挤掉。"""

    def _base_state(self) -> dict:
        s = Scheduler()
        s.register_resource("r1", 2)
        s.submit_task("t1", "r1", 2, 10)
        return persistence.state_to_dict(s)

    def _assert_invalid(self, data) -> None:
        with self.assertRaises(SchedulerError) as ctx:
            persistence.state_from_dict(data)
        self.assertEqual(ctx.exception.code, "invalid_import")

    def test_corrupted_json_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{ not valid json ")
            with self.assertRaises(SchedulerError) as ctx:
                persistence.import_state(path)
            self.assertEqual(ctx.exception.code, "invalid_import")

    def test_missing_file(self) -> None:
        with self.assertRaises(SchedulerError):
            persistence.import_state("no_such_file_12345.json")

    def test_missing_top_level_field(self) -> None:
        data = self._base_state()
        del data["tasks"]
        self._assert_invalid(data)

    def test_unsupported_version(self) -> None:
        data = self._base_state()
        data["version"] = 999
        self._assert_invalid(data)

    def test_duplicate_task_id(self) -> None:
        data = self._base_state()
        dup = dict(data["tasks"][0])
        data["tasks"].append(dup)
        self._assert_invalid(data)

    def test_non_positive_amount(self) -> None:
        data = self._base_state()
        data["tasks"][0]["amount"] = 0
        self._assert_invalid(data)

    def test_negative_deadline(self) -> None:
        data = self._base_state()
        data["tasks"][0]["deadline"] = -1
        self._assert_invalid(data)

    def test_unknown_resource_reference(self) -> None:
        data = self._base_state()
        data["tasks"][0]["resource_id"] = "ghost"
        self._assert_invalid(data)

    def test_overlapping_intervals(self) -> None:
        data = self._base_state()
        data["tasks"].append(
            {
                "task_id": "t2",
                "resource_id": "r1",
                "amount": 2,
                "deadline": 10,
                "priority": 0,
                "committed": False,
                "status": "scheduled",
                "submit_seq": 1,
                "start": 0,
                "end": 1,  # 与 t1 的 [0,1) 重叠
            }
        )
        self._assert_invalid(data)

    def test_occupancy_exceeds_capacity(self) -> None:
        data = self._base_state()
        # t1 处理量 2，区间 [0,1) 时长 1，容量 2 → 速率 2 不超；改成 [0, 0.5) 速率 4 > 2。
        data["tasks"][0]["end"] = 0.5
        self._assert_invalid(data)

    def test_committed_task_not_scheduled(self) -> None:
        data = self._base_state()
        task = data["tasks"][0]
        task["committed"] = True
        task["status"] = "pending"
        task["start"] = None
        task["end"] = None
        self._assert_invalid(data)

    def test_committed_task_misses_deadline(self) -> None:
        data = self._base_state()
        task = data["tasks"][0]
        task["committed"] = True
        task["deadline"] = 0.5  # end == 1 > 0.5
        self._assert_invalid(data)

    def test_missing_task_field(self) -> None:
        data = self._base_state()
        del data["tasks"][0]["deadline"]
        self._assert_invalid(data)

    def test_failed_import_leaves_existing_state_untouched(self) -> None:
        s = Scheduler()
        s.register_resource("r1", 2)
        s.submit_task("t1", "r1", 2, 10)
        before = persistence.state_to_dict(s)
        bad = self._base_state()
        bad["tasks"][0]["amount"] = -5
        with self.assertRaises(SchedulerError):
            persistence.state_from_dict(bad)  # 只构造新对象，不触碰 s
        self.assertEqual(persistence.state_to_dict(s), before)


if __name__ == "__main__":
    unittest.main()
