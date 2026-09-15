"""review_scheduler 的单元测试，逐条对应需求 1~8。

运行方式（仓库根目录）::

    python -m unittest discover -s tests -v
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from review_scheduler.scheduler import (  # noqa: E402
    DEFAULT_DIFFICULTY,
    DEFAULT_STABILITY,
    DEFER_REASON_DAILY_LIMIT,
    MAX_DIFFICULTY,
    MAX_INTERVAL_DAYS,
    MAX_STABILITY,
    MIN_DIFFICULTY,
    MIN_STABILITY,
    ManualClock,
    MemoryState,
    PersistenceError,
    QUALITY_MAX,
    QUALITY_MIN,
    Scheduler,
    ValidationError,
    next_difficulty,
    next_interval,
    next_stability,
)


def make_scheduler(**kwargs):
    return Scheduler(clock=ManualClock(0), **kwargs)


class Requirement1ItemStateTests(unittest.TestCase):
    """需求 1：内容维护、正数值校验、错误信息指出位置。"""

    def test_add_and_get_item(self):
        s = make_scheduler()
        s.add_item("c1", "数学", stability=2.0, difficulty=2.5)
        status = s.status("c1")
        self.assertEqual(status["item_id"], "c1")
        self.assertEqual(status["topic"], "数学")
        self.assertEqual(status["stability"], 2.0)
        self.assertEqual(status["difficulty"], 2.5)

    def test_duplicate_id_rejected(self):
        s = make_scheduler()
        s.add_item("c1", "数学")
        with self.assertRaisesRegex(ValidationError, "items\[c1\]"):
            s.add_item("c1", "英语")

    def test_non_positive_stability_rejected_with_location(self):
        s = make_scheduler()
        with self.assertRaisesRegex(ValidationError, r"items\[c1\]\.stability"):
            s.add_item("c1", "数学", stability=0)
        with self.assertRaisesRegex(ValidationError, r"items\[c2\]\.stability"):
            s.add_item("c2", "数学", stability=-1.5)
        with self.assertRaisesRegex(ValidationError, r"items\[c3\]\.stability"):
            s.add_item("c3", "数学", stability=float("nan"))

    def test_non_positive_difficulty_rejected_with_location(self):
        s = make_scheduler()
        with self.assertRaisesRegex(ValidationError, r"items\[c1\]\.difficulty"):
            s.add_item("c1", "数学", difficulty=0)
        with self.assertRaisesRegex(ValidationError, r"items\[c2\]\.difficulty"):
            s.add_item("c2", "数学", difficulty=float("inf"))

    def test_wrong_type_rejected(self):
        s = make_scheduler()
        with self.assertRaises(ValidationError):
            s.add_item("c1", "数学", stability="1.0")  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            s.add_item("c2", "数学", difficulty=True)  # bool 不被当成 1
        with self.assertRaises(ValidationError):
            s.add_item("", "数学")
        with self.assertRaises(ValidationError):
            s.add_item("c3", "")

    def test_batch_add_points_at_index(self):
        s = make_scheduler()
        with self.assertRaisesRegex(ValidationError, r"items\[2\].*difficulty"):
            s.add_items(
                [
                    {"item_id": "a", "topic": "t"},
                    {"item_id": "b", "topic": "t"},
                    {"item_id": "c", "topic": "t", "difficulty": -3},
                ]
            )
        # 整体校验失败时不应部分写入
        self.assertEqual(s.item_ids(), [])

    def test_batch_add_all_or_nothing(self):
        s = make_scheduler()
        specs = [
            {"item_id": "x", "topic": "t"},
            {"item_id": "x", "topic": "t"},
        ]
        with self.assertRaises(ValidationError):
            s.add_items(specs)
        self.assertEqual(s.item_ids(), [])


class Requirement2ReviewTests(unittest.TestCase):
    """需求 2：复习记录（质量/时刻/间隔）、幂等、质量范围拒绝。"""

    def test_first_review_records_elapsed_zero(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        r = s.review("c1", 4)
        self.assertEqual(r.item_id, "c1")
        self.assertEqual(r.timestamp, 0)
        self.assertEqual(r.quality, 4)
        self.assertEqual(r.elapsed, 0)

    def test_elapsed_is_time_since_previous_review(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock)
        s.add_item("c1", "t")
        s.review("c1", 5)
        clock.advance(3)
        r = s.review("c1", 5)
        self.assertEqual(r.elapsed, 3)
        self.assertEqual(r.timestamp, 3)

    def test_quality_out_of_range_rejected(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        for bad in (-1, 6):
            with self.assertRaisesRegex(
                ValidationError, r"quality.*范围|quality.*\["
            ):
                s.review("c1", bad)
        with self.assertRaisesRegex(ValidationError, "quality"):
            s.review("c1", 4.0)  # type: ignore[arg-type]
        with self.assertRaisesRegex(ValidationError, "quality"):
            s.review("c1", True)  # bool 不被当成 1

    def test_review_unknown_item(self):
        s = make_scheduler()
        with self.assertRaisesRegex(ValidationError, r"items\[ghost\]"):
            s.review("ghost", 3)

    def test_idempotent_same_timestamp_same_quality(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        r1 = s.review("c1", 5, timestamp=10)
        r2 = s.review("c1", 5, timestamp=10)
        self.assertIs(r1, r2)
        self.assertEqual(len(s.history("c1")), 1)
        self.assertEqual(s.status("c1")["reps"], 1)

    def test_idempotent_same_timestamp_ignores_different_quality(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        r1 = s.review("c1", 5, timestamp=10)
        # 同一时刻换一个质量重复提交：仍按幂等返回原记录，状态不变。
        r2 = s.review("c1", 1, timestamp=10)
        self.assertIs(r1, r2)
        self.assertEqual(s.status("c1")["stability"], r1.stability_after)
        self.assertEqual(s.status("c1")["lapses"], 0)
        self.assertEqual(len(s.history("c1")), 1)

    def test_clock_cannot_go_backwards(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        s.review("c1", 4, timestamp=10)
        with self.assertRaises(ValidationError):
            s.review("c1", 4, timestamp=9)


class Requirement3UpdateTests(unittest.TestCase):
    """需求 3：稳定度/难度按质量更新，结果可复现。"""

    def test_good_quality_raises_stability(self):
        s = make_scheduler()
        s.add_item("c1", "t", stability=1.0, difficulty=3.0)
        r = s.review("c1", 5)
        self.assertGreater(r.stability_after, 1.0)
        # 质量好，难度下降（更简单）
        self.assertLess(r.difficulty_after, 3.0)

    def test_hard_quality_lowers_stability(self):
        s = make_scheduler()
        s.add_item("c1", "t", stability=10.0, difficulty=3.0)
        r = s.review("c1", 1)
        self.assertEqual(r.stability_after, 5.0)
        # 失败，难度上升
        self.assertGreater(r.difficulty_after, 3.0)

    def test_reproducible_across_instances(self):
        def run():
            s = make_scheduler()
            s.add_item("c1", "t", stability=2.3, difficulty=2.8)
            results = []
            for day, q in [(0, 4), (2, 5), (6, 3), (10, 2), (12, 5)]:
                r = s.review("c1", q, timestamp=day)
                results.append(
                    (
                        round(r.stability_after, 12),
                        round(r.difficulty_after, 12),
                        r.scheduled_interval,
                    )
                )
            return results

        self.assertEqual(run(), run())

    def test_pure_functions_are_deterministic(self):
        self.assertEqual(
            next_stability(2.0, 3.0, 5), next_stability(2.0, 3.0, 5)
        )
        self.assertEqual(next_difficulty(3.0, 1), next_difficulty(3.0, 1))

    def test_difficulty_clamped(self):
        self.assertAlmostEqual(next_difficulty(5.0, 0), MAX_DIFFICULTY)
        self.assertAlmostEqual(next_difficulty(1.05, 5), MIN_DIFFICULTY)
        self.assertAlmostEqual(next_difficulty(1.2, 5), MIN_DIFFICULTY)

    def test_stability_bounded(self):
        self.assertLessEqual(next_stability(MAX_STABILITY, 1.05, 5), MAX_STABILITY)
        self.assertGreaterEqual(next_stability(MIN_STABILITY, 5.0, 0), MIN_STABILITY)


class Requirement4IntervalTests(unittest.TestCase):
    """需求 4：连续顺利间隔逐次拉长且有上限；失败显著回落。"""

    def _intervals(self, qualities, start=0):
        s = make_scheduler()
        s.add_item("c1", "t")
        intervals = []
        day = start
        for q in qualities:
            r = s.review("c1", q, timestamp=day)
            intervals.append(r.scheduled_interval)
            day += r.scheduled_interval
        return intervals

    def test_intervals_lengthen_with_cap(self):
        intervals = self._intervals([5] * 30)
        self.assertEqual(intervals[0], 1)
        # 顶到上限之前逐次严格拉长
        pre_cap = intervals[: intervals.index(MAX_INTERVAL_DAYS)]
        for prev, cur in zip(pre_cap, pre_cap[1:]):
            self.assertGreater(cur, prev)
        self.assertLessEqual(max(intervals), MAX_INTERVAL_DAYS)
        # 最终顶到上限
        self.assertEqual(intervals[-1], MAX_INTERVAL_DAYS)

    def test_interval_cap_holds_at_max(self):
        intervals = self._intervals([5] * 30)
        self.assertTrue(all(i <= MAX_INTERVAL_DAYS for i in intervals))
        self.assertEqual(intervals[-1], MAX_INTERVAL_DAYS)
        self.assertEqual(intervals[-2], MAX_INTERVAL_DAYS)

    def test_failure_drop_exceeds_growth(self):
        # 连续顺利把间隔推高，然后一次失败。
        s = make_scheduler()
        s.add_item("c1", "t", stability=1.0)
        day = 0
        last_good = None
        for q in [5, 5, 5, 5, 5]:
            r = s.review("c1", q, timestamp=day)
            day += r.scheduled_interval
            last_good = r
        good_interval = last_good.scheduled_interval
        good_stability = last_good.stability_after
        r_fail = s.review("c1", 1, timestamp=day)
        # 失败后间隔显著回落：不超过顺利间隔的一半 + 1
        self.assertLessEqual(
            r_fail.scheduled_interval,
            max(1, good_interval // 2 + 1),
        )
        self.assertLess(r_fail.scheduled_interval, good_interval)
        # 稳定度正好减半
        self.assertAlmostEqual(r_fail.stability_after, good_stability * 0.5)

    def test_single_failure_growth_vs_gain(self):
        # 任意一次顺利回忆的单步增长比例 <= 35%，
        # 而一次失败的回落比例为 50% —— 回落严格大于增长。
        max_gain = 0.35
        for q in (3, 4, 5):
            s_new = next_stability(10.0, 1.05, q)
            gain_ratio = (s_new - 10.0) / 10.0
            self.assertLessEqual(gain_ratio, max_gain)
        s_fail = next_stability(10.0, 3.0, 2)
        drop_ratio = (10.0 - s_fail) / 10.0
        self.assertEqual(drop_ratio, 0.5)
        self.assertGreater(drop_ratio, max_gain)

    def test_failure_resets_short_interval(self):
        intervals = self._intervals([5, 5, 5, 0])
        self.assertEqual(intervals[-1], 1)
        for prev, cur in zip(intervals[:-1], intervals[1:-1]):
            self.assertGreater(cur, prev)


class Requirement5DueSortingTests(unittest.TestCase):
    """需求 5：逻辑时钟判断到期、紧迫度稳定排序、重复查询一致。"""

    def test_due_uses_injected_clock(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock)
        s.add_item("c1", "t")
        s.add_item("c2", "t")
        self.assertEqual(s.due_items(), ["c1", "c2"])
        s.review("c1", 5)  # due 推后
        self.assertEqual(s.due_items(), ["c2"])
        clock.advance(2)
        self.assertIn("c1", s.due_items())

    def test_due_sorted_by_urgency(self):
        s = make_scheduler()
        s.add_item("later", "t")
        s.add_item("earlier", "t")
        # 手动造出不同到期时刻：earlier 已逾期更久
        s.review("later", 5, timestamp=0)   # due=1
        s.review("earlier", 3, timestamp=0)  # due=1
        # 两者 due 相同（都是 1），按 id 排
        s.get_item("later").due = 5
        s.get_item("earlier").due = 2
        self.assertEqual(s.due_items(now=10), ["earlier", "later"])

    def test_due_query_is_stable_and_side_effect_free(self):
        s = make_scheduler()
        for i in range(20):
            s.add_item(f"c{i:02d}", "t")
        first = s.due_items(now=0)
        second = s.due_items(now=0)
        self.assertEqual(first, second)
        self.assertEqual(first, [f"c{i:02d}" for i in range(20)])
        # 查询不改变 due
        self.assertTrue(all(s.get_item(i).due == 0 for i in first))

    def test_not_yet_due_excluded(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock)
        s.add_item("c1", "t")
        s.review("c1", 5)
        self.assertNotIn("c1", s.due_items())


class Requirement6DailyLimitTests(unittest.TestCase):
    """需求 6：超上限只留最紧迫内容，其余顺延并记录原因，不改记忆状态。"""

    def test_keeps_most_urgent_defers_rest(self):
        s = make_scheduler(daily_limit=2)
        for i in range(5):
            s.add_item(f"c{i}", "t")
        # c4 最紧迫（逾期最久），c0 最不紧迫
        for i in range(5):
            s.get_item(f"c{i}").due = -i
        plan = s.plan_day(day=0)
        self.assertEqual(plan.selected, ["c4", "c3"])
        self.assertEqual([d.item_id for d in plan.deferred], ["c2", "c1", "c0"])
        for d in plan.deferred:
            self.assertEqual(d.reason, DEFER_REASON_DAILY_LIMIT)
            self.assertEqual(d.day, 0)
            self.assertEqual(d.new_due, 1)

    def test_deferral_does_not_change_memory_state(self):
        s = make_scheduler(daily_limit=1)
        s.add_item("a", "t", stability=4.0, difficulty=2.2)
        s.add_item("b", "t", stability=7.0, difficulty=4.1)
        s.get_item("a").due = 0
        s.get_item("b").due = -1
        before = {k: v for k, v in s.status("a").items()}
        s.plan_day(day=0)
        after = s.status("a")
        self.assertEqual(before["stability"], after["stability"])
        self.assertEqual(before["difficulty"], after["difficulty"])
        self.assertEqual(before["reps"], after["reps"])
        self.assertEqual(before["lapses"], after["lapses"])
        self.assertEqual(after["due"], 1)  # 只有到期时刻被移动

    def test_deferred_items_show_up_next_day(self):
        s = make_scheduler(daily_limit=2)
        s.add_item("a", "t")
        s.add_item("b", "t")
        s.add_item("c", "t")
        s.get_item("a").due = 0
        s.get_item("b").due = 0
        s.get_item("c").due = -1
        plan1 = s.plan_day(day=0)
        self.assertEqual(plan1.selected, ["c", "a"])
        # 昨天顺延的 b 次日确实到期
        self.assertIn("b", s.due_items(now=1))
        # 完成当天选中内容的复习后，次日名额释放，b 被排入
        s.review("c", 5, timestamp=0)
        s.review("a", 5, timestamp=0)
        plan2 = s.plan_day(day=1)
        self.assertIn("b", plan2.selected)

    def test_no_limit_means_all_selected(self):
        s = make_scheduler()
        for i in range(10):
            s.add_item(f"c{i}", "t")
        plan = s.plan_day(day=0)
        self.assertEqual(len(plan.selected), 10)
        self.assertEqual(plan.deferred, [])

    def test_invalid_limit_rejected(self):
        with self.assertRaises(ValidationError):
            make_scheduler(daily_limit=0)
        with self.assertRaises(ValidationError):
            make_scheduler(daily_limit=-2)
        s = make_scheduler()
        with self.assertRaises(ValidationError):
            s.plan_day(day=0, limit=0)


class Requirement7QueryTests(unittest.TestCase):
    """需求 7：状态/到期/轨迹/间隔变化，主题到期数与平均间隔。"""

    def test_status_fields(self):
        s = make_scheduler()
        s.add_item("c1", "物理", stability=3.5, difficulty=2.0)
        r = s.review("c1", 5)
        status = s.status("c1")
        self.assertEqual(status["due"], r.scheduled_interval)
        self.assertEqual(status["last_reviewed"], 0)
        self.assertEqual(status["reps"], 1)
        self.assertEqual(status["lapses"], 0)

    def test_history_and_interval_changes(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock)
        s.add_item("c1", "t")
        s.review("c1", 5)
        clock.advance(1)
        s.review("c1", 4)
        history = s.history("c1")
        self.assertEqual([r.quality for r in history], [5, 4])
        self.assertEqual([r.elapsed for r in history], [0, 1])
        changes = s.interval_changes("c1")
        self.assertEqual(len(changes), 2)
        self.assertIn("scheduled_interval", changes[0])
        self.assertGreater(changes[1]["scheduled_interval"], changes[0]["scheduled_interval"])

    def test_history_returns_copy(self):
        s = make_scheduler()
        s.add_item("c1", "t")
        s.review("c1", 3)
        h1 = s.history("c1")
        h1.clear()
        self.assertEqual(len(s.history("c1")), 1)

    def test_topic_stats(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock)
        s.add_item("a", "数学")
        s.add_item("b", "数学")
        s.add_item("c", "英语")
        s.review("a", 5)  # due=1；此刻未到期
        stats = s.topic_stats("数学", now=0)
        self.assertEqual(stats["total_items"], 2)
        self.assertEqual(stats["due_count"], 1)  # 只有未复习的 b 到期
        clock.advance(2)
        s.review("b", 5)  # 在 tick=2 复习，due=3
        stats_now = s.topic_stats("数学", now=10)
        self.assertEqual(stats_now["due_count"], 2)
        self.assertAlmostEqual(stats_now["average_interval"], 1.0)

    def test_topic_stats_average_uses_latest_interval(self):
        s = make_scheduler()
        s.add_item("a", "t")
        s.review("a", 5, timestamp=0)  # 1
        s.review("a", 5, timestamp=10)  # 2
        stats = s.topic_stats("t")
        self.assertAlmostEqual(stats["average_interval"], 2.0)

    def test_topic_stats_empty(self):
        s = make_scheduler()
        stats = s.topic_stats("不存在")
        self.assertEqual(stats["total_items"], 0)
        self.assertEqual(stats["due_count"], 0)
        self.assertIsNone(stats["average_interval"])


class Requirement8PersistenceTests(unittest.TestCase):
    """需求 8：单文件存档/载入；损坏或字段缺失报错清晰，失败状态不变。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "state.json")

    def tearDown(self):
        self.tmp.cleanup()

    def _populated(self):
        clock = ManualClock(0)
        s = Scheduler(clock=clock, daily_limit=3)
        s.add_item("c1", "数学", stability=2.0, difficulty=2.5)
        s.add_item("c2", "英语", stability=1.0, difficulty=3.0)
        s.review("c1", 5)
        clock.advance(2)
        s.review("c1", 4)
        s.review("c2", 1)
        s.plan_day(day=2)
        return s

    def test_roundtrip_preserves_everything(self):
        s = self._populated()
        s.save(self.path)
        loaded = Scheduler.load(self.path)
        self.assertEqual(loaded.to_dict(), s.to_dict())
        self.assertEqual(loaded.clock.now(), 2)
        self.assertEqual(loaded.config.daily_limit, 3)
        self.assertEqual(loaded.status("c1"), s.status("c1"))
        self.assertEqual(
            [(r.quality, r.elapsed) for r in loaded.history("c1")],
            [(5, 0), (4, 2)],
        )
        # 载入后可继续调度，结果与原对象一致
        self.assertEqual(loaded.due_items(2), s.due_items(2))

    def test_corrupt_json_reports_error(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not valid json")
        with self.assertRaisesRegex(PersistenceError, "无法解析"):
            Scheduler.load(self.path)

    def test_missing_field_reports_location(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        del data["items"][0]["stability"]
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(PersistenceError, r"items\[0\]\.stability"):
            Scheduler.load(self.path)

    def test_bad_value_reports_location(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["items"][1]["difficulty"] = -9
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(PersistenceError, r"items\[1\]\.difficulty"):
            Scheduler.load(self.path)

    def test_bad_quality_in_record(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["records"][0]["quality"] = 9
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(PersistenceError, r"records\[0\]\.quality"):
            Scheduler.load(self.path)

    def test_missing_top_level_section(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            good = json.load(fh)
        for key in ("version", "clock", "config", "items", "records", "deferrals"):
            data = json.loads(json.dumps(good))
            del data[key]
            with open(self.path, "w", encoding="utf-8") as fh:
                json.dump(data, fh)
            with self.assertRaises(PersistenceError):
                Scheduler.load(self.path)

    def test_unsupported_version(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["version"] = 999
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(PersistenceError, "version"):
            Scheduler.load(self.path)

    def test_failed_load_leaves_caller_state_unchanged(self):
        existing = self._populated()
        snapshot = existing.to_dict()
        existing.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["items"][0]["stability"] = 0
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(PersistenceError):
            Scheduler.load(self.path)
        # 调用方原对象完全不受影响
        self.assertEqual(existing.to_dict(), snapshot)

    def test_save_is_atomic_and_rewritable(self):
        s = self._populated()
        s.save(self.path)
        s.save(self.path)  # 覆盖写不报错
        self.assertEqual(Scheduler.load(self.path).to_dict(), s.to_dict())
        # 不应残留临时文件
        siblings = [n for n in os.listdir(self.tmp.name) if n.startswith(".scheduler-")]
        self.assertEqual(siblings, [])

    def test_dangling_record_reference_rejected(self):
        s = self._populated()
        s.save(self.path)
        with open(self.path, encoding="utf-8") as fh:
            data = json.load(fh)
        data["records"][0]["item_id"] = "ghost"
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(PersistenceError, "ghost"):
            Scheduler.load(self.path)

    def test_deferral_records_survive_roundtrip(self):
        s = make_scheduler(daily_limit=1)
        for i in range(3):
            s.add_item(f"c{i}", "t")
        s.get_item("c0").due = 0
        s.get_item("c1").due = -1
        s.get_item("c2").due = -2
        plan = s.plan_day(day=0)
        self.assertEqual(len(plan.deferred), 2)
        s.save(self.path)
        loaded = Scheduler.load(self.path)
        self.assertEqual(
            [(d.item_id, d.old_due, d.new_due, d.reason) for d in loaded.deferrals()],
            [(d.item_id, d.old_due, d.new_due, d.reason) for d in s.deferrals()],
        )


class ConstantsTests(unittest.TestCase):
    def test_defaults_are_positive(self):
        self.assertGreater(DEFAULT_STABILITY, 0)
        self.assertGreater(DEFAULT_DIFFICULTY, 0)
        self.assertGreater(MIN_STABILITY, 0)
        self.assertGreater(MIN_DIFFICULTY, 0)


if __name__ == "__main__":
    unittest.main()
