"""熔断内核的单元测试（纯标准库 unittest，可完全离线运行）。

运行方式：
    python -m unittest test_circuit_breaker -v
"""

import json
import os
import tempfile
import unittest

from circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerError,
    ClockRegressionError,
    ConfigError,
    DuplicateUnitError,
    ImportValidationError,
    LogicalClock,
    NoInflightRequestError,
    State,
    UnitConfig,
    UnknownUnitError,
)


def make_config(**overrides):
    base = dict(
        failure_threshold=3,
        cooldown_seconds=10.0,
        half_open_probe_quota=2,
        flapping_window_seconds=50.0,
        backoff_multiplier=2.0,
        max_cooldown_seconds=100.0,
    )
    base.update(overrides)
    return UnitConfig(**base)


class TestRegistrationAndQuery(unittest.TestCase):
    """需求 1 / 6：多单元、独立状态、查询字段完整。"""

    def test_multiple_units_are_independent(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        cb.register("b", make_config())
        for _ in range(3):
            cb.report_failure("a", "timeout")
        self.assertEqual(cb.query("a")["state"], "open")
        self.assertEqual(cb.query("b")["state"], "closed")
        self.assertEqual(cb.query("b")["consecutive_failures"], 0)

    def test_query_fields(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        cb.report_failure("a", "boom")
        snap = cb.query("a")
        self.assertEqual(snap["state"], "closed")
        self.assertEqual(snap["consecutive_failures"], 1)
        self.assertEqual(snap["last_failure_at"], 0.0)
        self.assertEqual(snap["last_failure_reason"], "boom")
        self.assertIsNone(snap["cooldown_remaining"])
        self.assertIsNone(snap["last_transition"])  # 尚未发生迁移

    def test_register_rejects_empty_id_and_duplicate(self):
        cb = CircuitBreaker()
        with self.assertRaises(ConfigError):
            cb.register("")
        with self.assertRaises(ConfigError):
            cb.register(None)
        cb.register("a")
        with self.assertRaises(DuplicateUnitError) as ctx:
            cb.register("a")
        self.assertIn("'a'", str(ctx.exception))

    def test_invalid_config_rejected(self):
        cb = CircuitBreaker()
        with self.assertRaises(ConfigError):
            cb.register("a", make_config(failure_threshold=0))
        with self.assertRaises(ConfigError):
            cb.register("a", make_config(cooldown_seconds=0))
        with self.assertRaises(ConfigError):
            cb.register("a", make_config(half_open_probe_quota=-1))
        with self.assertRaises(ConfigError):
            cb.register("a", make_config(backoff_multiplier=0.5))
        with self.assertRaises(ConfigError):
            cb.register("a", make_config(max_cooldown_seconds=1.0))


class TestClosedToOpen(unittest.TestCase):
    """需求 2：阈值触发熔断；冷却期内拒绝且无副作用。"""

    def test_threshold_exactly_reached_opens_immediately(self):
        cb = CircuitBreaker()
        cb.register("a", make_config(failure_threshold=3))
        cb.report_failure("a")
        cb.report_failure("a")
        self.assertEqual(cb.query("a")["state"], "closed")  # 2 < 3 未触发
        cb.report_failure("a")  # 恰好第 3 次
        snap = cb.query("a")
        self.assertEqual(snap["state"], "open")
        self.assertEqual(snap["consecutive_failures"], 3)
        self.assertEqual(snap["cooldown_remaining"], 10.0)

    def test_success_resets_consecutive_failures(self):
        cb = CircuitBreaker()
        cb.register("a", make_config(failure_threshold=3))
        cb.report_failure("a")
        cb.report_failure("a")
        cb.report_success("a")
        self.assertEqual(cb.query("a")["consecutive_failures"], 0)
        cb.report_failure("a")
        cb.report_failure("a")
        self.assertEqual(cb.query("a")["state"], "closed")

    def test_rejection_during_open_has_no_side_effects(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        history_before = cb.history()
        for _ in range(5):
            self.assertFalse(cb.allow("a"))
        snap = cb.query("a")
        self.assertEqual(snap["consecutive_failures"], 3)  # 计数未变
        self.assertEqual(snap["state"], "open")
        self.assertEqual(cb.history(), history_before)  # 无新迁移

    def test_report_while_open_is_error(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        with self.assertRaises(NoInflightRequestError) as ctx:
            cb.report_failure("a")
        self.assertIn("'a'", str(ctx.exception))
        with self.assertRaises(NoInflightRequestError):
            cb.report_success("a")


class TestHalfOpen(unittest.TestCase):
    """需求 3 / 4：冷却结束进半开、探测配额、探测成败的分支。"""

    def _open_unit(self, cb, unit="a", **cfg):
        cb.register(unit, make_config(**cfg))
        for _ in range(cfg.get("failure_threshold", 3)):
            cb.report_failure(unit)

    def test_half_open_after_cooldown_and_probe_quota(self):
        cb = CircuitBreaker()
        self._open_unit(cb, half_open_probe_quota=2)
        cb.advance_clock(10.0)  # 冷却期恰好结束
        self.assertEqual(cb.query("a")["state"], "half_open")
        self.assertTrue(cb.allow("a"))   # 第 1 个探测
        self.assertTrue(cb.allow("a"))   # 第 2 个探测
        self.assertFalse(cb.allow("a"))  # 配额用尽，拒绝
        snap = cb.query("a")
        self.assertEqual(snap["probes_in_flight"], 2)
        self.assertEqual(snap["probe_quota_remaining"], 0)
        # 配额用尽后状态不变，等待在途探测结果
        self.assertEqual(snap["state"], "half_open")

    def test_cooldown_exactly_elapsed(self):
        cb = CircuitBreaker()
        self._open_unit(cb)
        cb.advance_clock(9.999)
        self.assertEqual(cb.query("a")["state"], "open")
        cb.advance_clock(0.001)  # 恰好到达 10.0
        self.assertEqual(cb.query("a")["state"], "half_open")

    def test_probe_success_closes_and_resets(self):
        cb = CircuitBreaker()
        self._open_unit(cb)
        cb.advance_clock(10.0)
        self.assertTrue(cb.allow("a"))
        cb.report_success("a")
        snap = cb.query("a")
        self.assertEqual(snap["state"], "closed")
        self.assertEqual(snap["consecutive_failures"], 0)
        self.assertEqual(snap["probes_in_flight"], 0)

    def test_probe_failure_reopens_with_reason_and_time(self):
        cb = CircuitBreaker()
        self._open_unit(cb)
        cb.advance_clock(10.0)
        self.assertTrue(cb.allow("a"))
        cb.report_failure("a", "probe-503")
        snap = cb.query("a")
        self.assertEqual(snap["state"], "open")
        self.assertEqual(snap["last_failure_reason"], "probe-503")
        self.assertEqual(snap["last_failure_at"], 10.0)
        last = snap["last_transition"]
        self.assertEqual(last["to_state"], "open")
        self.assertEqual(last["at"], 10.0)
        self.assertIn("probe-503", last["reason"])

    def test_report_without_inflight_probe_is_error(self):
        cb = CircuitBreaker()
        self._open_unit(cb)
        cb.advance_clock(10.0)
        with self.assertRaises(NoInflightRequestError) as ctx:
            cb.report_success("a")
        self.assertIn("'a'", str(ctx.exception))

    def test_zero_probe_quota_stays_half_open(self):
        cb = CircuitBreaker()
        self._open_unit(cb, half_open_probe_quota=0)
        cb.advance_clock(10.0)
        self.assertEqual(cb.query("a")["state"], "half_open")
        self.assertFalse(cb.allow("a"))  # 配额为零，一律拒绝
        self.assertEqual(cb.query("a")["probe_quota_remaining"], 0)
        cb.advance_clock(1000.0)
        self.assertEqual(cb.query("a")["state"], "half_open")  # 不会自动恢复


class TestFlappingAcceleration(unittest.TestCase):
    """需求 5：恢复抖动识别、加速策略、冷却期上限。"""

    def test_flapping_accelerates_recooldown(self):
        cb = CircuitBreaker()
        # 窗口 50，倍率 2，基础冷却 10，上限 100
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        self.assertEqual(cb.query("a")["effective_cooldown"], 10.0)  # 首次：10
        cb.advance_clock(10.0)
        self.assertTrue(cb.allow("a"))
        cb.report_success("a")  # 恢复关闭（t=10）
        # 短时间内再次连续失败（t=15，距离开打开状态 5 < 50）
        cb.advance_clock(5.0)
        for _ in range(3):
            cb.report_failure("a")
        snap = cb.query("a")
        self.assertEqual(snap["state"], "open")
        self.assertEqual(snap["flap_level"], 1)
        self.assertEqual(snap["effective_cooldown"], 20.0)  # 10 * 2^1

    def test_probe_failure_counts_as_flapping(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        cb.advance_clock(10.0)  # 进半开
        self.assertTrue(cb.allow("a"))
        cb.report_failure("a")  # 探测失败，立即重新打开
        snap = cb.query("a")
        self.assertEqual(snap["flap_level"], 1)
        self.assertEqual(snap["effective_cooldown"], 20.0)

    def test_cooldown_capped_at_max(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        # 反复抖动：10 -> 20 -> 40 -> 80 -> 100(封顶) -> 100
        expected = [20.0, 40.0, 80.0, 100.0, 100.0]
        for want in expected:
            cb.advance_clock(cb.query("a")["cooldown_remaining"])
            self.assertTrue(cb.allow("a"))
            cb.report_failure("a")
            self.assertEqual(cb.query("a")["effective_cooldown"], want)

    def test_healthy_period_resets_flap_level(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        for _ in range(3):
            cb.report_failure("a")
        cb.advance_clock(10.0)
        self.assertTrue(cb.allow("a"))
        cb.report_success("a")
        cb.advance_clock(200.0)  # 健康运行远超抖动窗口
        for _ in range(3):
            cb.report_failure("a")
        snap = cb.query("a")
        self.assertEqual(snap["flap_level"], 0)
        self.assertEqual(snap["effective_cooldown"], 10.0)  # 回到基础冷却期


class TestDeterminism(unittest.TestCase):
    """需求 6：同一输入序列重放，迁移序列与判定结果完全一致。"""

    @staticmethod
    def script():
        return [
            {"op": "register", "unit_id": "a",
             "config": make_config().__dict__},
            {"op": "register", "unit_id": "b",
             "config": make_config(failure_threshold=2).__dict__},
            {"op": "allow", "unit_id": "a"},
            {"op": "report_failure", "unit_id": "a", "reason": "x"},
            {"op": "report_failure", "unit_id": "a", "reason": "y"},
            {"op": "report_failure", "unit_id": "a", "reason": "z"},
            {"op": "allow", "unit_id": "a"},
            {"op": "report_failure", "unit_id": "b"},
            {"op": "report_failure", "unit_id": "b"},
            {"op": "advance", "delta": 10.0},
            {"op": "allow", "unit_id": "a"},
            {"op": "report_success", "unit_id": "a"},
            {"op": "query", "unit_id": "a"},
            {"op": "query", "unit_id": "b"},
            {"op": "history"},
            {"op": "inspect"},
        ]

    def test_replay_is_deterministic(self):
        outputs = []
        for _ in range(2):
            cb = CircuitBreaker()
            run = []
            for op in self.script():
                run.append(cb.apply(op))
            outputs.append(run)
        self.assertEqual(outputs[0], outputs[1])

    def test_transition_sequence_is_reproducible(self):
        def run():
            cb = CircuitBreaker()
            cb.register("a", make_config())
            for _ in range(3):
                cb.report_failure("a")
            cb.advance_clock(10.0)
            cb.allow("a")
            cb.report_failure("a", "again")
            return cb.history()

        self.assertEqual(run(), run())
        transitions = [(h["from_state"], h["to_state"]) for h in run()]
        self.assertEqual(
            transitions,
            [("closed", "open"), ("open", "half_open"), ("half_open", "open")],
        )


class TestPersistence(unittest.TestCase):
    """需求 7：导出 / 导入、校验、失败不影响内存。"""

    def _populated(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        cb.register("b", make_config(failure_threshold=2))
        cb.report_failure("a", "e1")
        cb.report_failure("a", "e2")
        cb.report_failure("a", "e3")
        cb.advance_clock(4.0)
        cb.report_failure("b")
        return cb

    def test_export_import_roundtrip(self):
        cb = self._populated()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            cb.export_file(path)
            cb2 = CircuitBreaker()
            cb2.import_file(path)
        self.assertEqual(cb.inspect(), cb2.inspect())
        # 载入后继续运行行为一致
        cb.advance_clock(6.0)
        cb2.advance_clock(6.0)
        self.assertEqual(cb.history(), cb2.history())
        self.assertEqual(cb.query("a"), cb2.query("a"))

    def test_export_is_valid_json_with_sorted_keys(self):
        cb = self._populated()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            cb.export_file(path)
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        self.assertEqual(data["version"], 1)
        self.assertIn("clock", data)
        self.assertEqual(len(data["units"]), 2)

    def _import_error(self, mutate):
        cb = self._populated()
        data = cb.export_dict()
        mutate(data)
        before = cb.inspect()
        with self.assertRaises(ImportValidationError):
            cb.import_dict(data)
        self.assertEqual(cb.inspect(), before)  # 内存状态不变

    def test_import_rejects_duplicate_unit_ids(self):
        def mutate(data):
            data["units"].append(dict(data["units"][0]))
        self._import_error(mutate)

    def test_import_rejects_negative_counts(self):
        def mutate(data):
            data["units"][0]["consecutive_failures"] = -1
        self._import_error(mutate)

    def test_import_rejects_illegal_state(self):
        def mutate(data):
            data["units"][0]["state"] = "exploded"
        self._import_error(mutate)

    def test_import_rejects_illegal_config(self):
        def mutate(data):
            data["units"][0]["config"]["half_open_probe_quota"] = -2
        self._import_error(mutate)

    def test_import_rejects_history_referencing_unknown_unit(self):
        def mutate(data):
            data["history"][0]["unit_id"] = "ghost"
        self._import_error(mutate)

    def test_import_rejects_missing_fields(self):
        def mutate(data):
            del data["units"][0]["state"]
        self._import_error(mutate)

    def test_import_rejects_missing_top_level_fields(self):
        def mutate(data):
            del data["clock"]
        self._import_error(mutate)

    def test_import_corrupted_file(self):
        cb = self._populated()
        before = cb.inspect()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{ not json !!!")
            with self.assertRaises(ImportValidationError) as ctx:
                cb.import_file(path)
        self.assertIn("JSON", str(ctx.exception))
        self.assertEqual(cb.inspect(), before)

    def test_import_missing_file(self):
        cb = CircuitBreaker()
        with self.assertRaises(ImportValidationError):
            cb.import_file("no-such-file.json")

    def test_error_message_identifies_unit(self):
        cb = self._populated()
        data = cb.export_dict()
        data["units"][1]["probes_in_flight"] = -3
        with self.assertRaises(ImportValidationError) as ctx:
            cb.import_dict(data)
        self.assertIn("'b'", str(ctx.exception))


class TestEdgeCasesAndOps(unittest.TestCase):
    """需求 8：逐条操作分发与各类边界行为。"""

    def test_empty_system(self):
        cb = CircuitBreaker()
        self.assertEqual(cb.history(), [])
        snap = cb.inspect()
        self.assertEqual(snap["units"], {})
        self.assertEqual(snap["clock"], 0.0)
        # 空系统导出 / 导入
        data = cb.export_dict()
        cb2 = CircuitBreaker()
        cb2.import_dict(data)
        self.assertEqual(cb2.inspect(), snap)

    def test_unknown_unit_errors_name_the_unit(self):
        cb = CircuitBreaker()
        for action in (
            lambda: cb.allow("nope"),
            lambda: cb.report_success("nope"),
            lambda: cb.report_failure("nope"),
            lambda: cb.query("nope"),
            lambda: cb.history("nope"),
        ):
            with self.assertRaises(UnknownUnitError) as ctx:
                action()
            self.assertIn("'nope'", str(ctx.exception))

    def test_clock_regression_rejected(self):
        cb = CircuitBreaker()
        cb.register("a")
        cb.advance_clock(5.0)
        with self.assertRaises(ClockRegressionError):
            cb.advance_clock(-1.0)
        self.assertEqual(cb.now, 5.0)  # 时钟未被破坏
        with self.assertRaises(ClockRegressionError):
            LogicalClock().advance(-0.5)

    def test_clock_advance_zero_is_allowed(self):
        cb = CircuitBreaker()
        self.assertEqual(cb.advance_clock(0.0), 0.0)

    def test_apply_dispatch(self):
        cb = CircuitBreaker()
        cb.apply({"op": "register", "unit_id": "a",
                  "config": make_config(failure_threshold=1).__dict__})
        self.assertTrue(cb.apply({"op": "allow", "unit_id": "a"})["allowed"])
        cb.apply({"op": "report_failure", "unit_id": "a", "reason": "r"})
        self.assertFalse(cb.apply({"op": "allow", "unit_id": "a"})["allowed"])
        result = cb.apply({"op": "advance", "delta": 10.0})
        self.assertEqual(result["now"], 10.0)
        self.assertEqual(
            cb.apply({"op": "query", "unit_id": "a"})["state"], "half_open"
        )
        self.assertTrue(len(cb.apply({"op": "history"})["history"]) >= 2)
        exported = cb.apply({"op": "export"})
        self.assertEqual(exported["version"], 1)
        cb2 = CircuitBreaker()
        cb2.apply({"op": "import", "data": exported})
        self.assertEqual(cb2.inspect(), cb.inspect())
        self.assertIn("units", cb.apply({"op": "inspect"}))

    def test_apply_unknown_op_and_bad_operand(self):
        cb = CircuitBreaker()
        with self.assertRaises(CircuitBreakerError):
            cb.apply({"op": "explode"})
        with self.assertRaises(CircuitBreakerError):
            cb.apply("not-a-dict")
        with self.assertRaises(CircuitBreakerError):
            cb.apply({"op": "allow"})  # 缺 unit_id

    def test_apply_export_import_via_files(self):
        cb = CircuitBreaker()
        cb.register("a", make_config())
        cb.report_failure("a")
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            cb.apply({"op": "export", "path": path})
            cb2 = CircuitBreaker()
            cb2.apply({"op": "import", "path": path})
            self.assertEqual(cb.inspect(), cb2.inspect())

    def test_single_unit_full_lifecycle(self):
        cb = CircuitBreaker()
        cb.register("only", make_config(failure_threshold=2,
                                        half_open_probe_quota=1))
        self.assertTrue(cb.allow("only"))
        cb.report_failure("only")
        self.assertTrue(cb.allow("only"))
        cb.report_failure("only")  # 达到阈值
        self.assertFalse(cb.allow("only"))
        cb.advance_clock(10.0)
        self.assertTrue(cb.allow("only"))   # 半开放行探测
        self.assertFalse(cb.allow("only"))  # 配额 1 用尽
        cb.report_success("only")
        self.assertEqual(cb.query("only")["state"], "closed")
        self.assertTrue(cb.allow("only"))


if __name__ == "__main__":
    unittest.main()
