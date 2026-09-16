"""需求 5：失败重试复用原随机流，不触碰后续步骤的随机量。"""

import unittest

from detexp.engine import Executor
from detexp.models import Experiment, Slice, Step
from detexp.registry import ExperimentSystem
from detexp.rng import DeterministicStream
from detexp.steps import StepContext, StepFail, register_step_fn


class TestRetry(unittest.TestCase):
    def test_flaky_builtin_retries_with_identical_draws(self):
        exp = Experiment(
            experiment_id="flaky", param_specs=[],
            steps=[Step(
                "f", "flaky_retry",
                params={"fail_before": 3, "succeed_on_attempt": 2},
                slices=[Slice("uniform", 8)])],
            default_retries=3)
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        rec = sys.run("flaky", seed=77)
        self.assertEqual(rec.status, "ok")
        sr = rec.step_records[0]
        # attempt 0、1 失败，attempt 2 成功
        self.assertEqual([a.attempt for a in sr.attempts], [0, 1, 2])
        self.assertEqual(sr.result["attempt_used"], 2)
        self.assertEqual(rec.retries_total, 2)

    def test_retry_reuses_same_random_values(self):
        seen_by_attempt = []

        def fn(ctx: StepContext, params):
            w = ctx.window(0)
            vals = w.draw_many(4)
            seen_by_attempt.append((ctx.attempt, list(vals)))
            if ctx.attempt < 1:
                raise StepFail("transient")
            return {"estimate": sum(vals) / len(vals)}

        register_step_fn("record_then_ok", fn)
        exp = Experiment(
            experiment_id="reuse", param_specs=[],
            steps=[Step("f", "record_then_ok",
                        slices=[Slice("uniform", 4)])],
            default_retries=2)
        rec = Executor().run(exp, seed=321)
        self.assertEqual(rec.status, "ok")
        self.assertEqual(seen_by_attempt[0][1], seen_by_attempt[1][1])
        st = DeterministicStream(321, "reuse")
        self.assertEqual(
            seen_by_attempt[0][1],
            [st.draw_at(i, "uniform", {}) for i in range(4)])

    def test_retry_does_not_consume_later_step_stream(self):
        def fail_twice(ctx: StepContext, params):
            w = ctx.window(0)
            vals = w.draw_many(w.count)
            if ctx.attempt < 2:
                raise StepFail(f"fail {ctx.attempt}")
            return {"estimate": sum(vals)}

        register_step_fn("fail_twice", fail_twice)
        exp = Experiment(
            experiment_id="retry-later", param_specs=[],
            steps=[
                Step("flaky", "fail_twice",
                     slices=[Slice("uniform", 5)]),
                Step("after", "normal_mean", params={"n": 3},
                     slices=[Slice("normal", 3)]),
            ], default_retries=3)
        rec = Executor().run(exp, seed=7)
        self.assertEqual(rec.status, "ok")
        self.assertEqual(
            [a.attempt for a in rec.step_records[0].attempts], [0, 1, 2])
        st = DeterministicStream(7, "retry-later")
        expected = [st.draw_at(5 + i, "normal", {}) for i in range(3)]
        # 后续步骤记录的样本必须从 offset 5 开始
        samples = rec.step_records[1].slices[0].sample_draws
        self.assertEqual([pair[0] for pair in samples], [5, 6, 7])
        self.assertAlmostEqual(
            rec.step_records[1].result["estimate"],
            sum(expected) / 3, places=15)
        # 守恒：总声明 8 个，总消耗 8 个
        self.assertEqual(
            sum(sl.consumed for sr in rec.step_records for sl in sr.slices),
            8)

    def test_exhausted_retries_marks_failed_but_stream_layout_intact(self):
        exp = Experiment(
            experiment_id="always-fail", param_specs=[],
            steps=[Step("f", "flaky_retry",
                        params={"fail_before": 1, "succeed_on_attempt": 99},
                        slices=[Slice("uniform", 3)])],
            default_retries=2)
        rec = Executor().run(exp, seed=1)
        self.assertEqual(rec.status, "failed")
        self.assertEqual(rec.attempts_total, 3)
        sr = rec.step_records[0]
        self.assertEqual(sr.status, "failed")
        # 失败记录仍保留切片布局（offset/count 不丢）
        self.assertEqual(
            [(s.offset, s.count) for s in sr.slices], [(0, 3)])

    def test_non_retryable_failure_does_not_retry(self):
        def bad_param(ctx: StepContext, params):
            raise StepFail("config error", retryable=False)

        register_step_fn("bad_param", bad_param)
        exp = Experiment(
            experiment_id="noretry", param_specs=[],
            steps=[Step("f", "bad_param")], default_retries=5)
        rec = Executor().run(exp, seed=1)
        self.assertEqual(rec.status, "failed")
        self.assertEqual(rec.attempts_total, 1)

    def test_step_level_retries_override_default(self):
        exp = Experiment(
            experiment_id="stepretry", param_specs=[],
            steps=[Step("f", "flaky_retry",
                        params={"fail_before": 1, "succeed_on_attempt": 1},
                        slices=[Slice("uniform", 2)], retries=0)],
            default_retries=5)
        rec = Executor().run(exp, seed=1)
        self.assertEqual(rec.status, "failed")
        self.assertEqual(rec.attempts_total, 1)

    def test_overflow_error_retried_on_same_stream(self):
        attempt = {"n": 0}

        def overflow_once(ctx: StepContext, params):
            w = ctx.window(0)
            v = w.draw()
            attempt["n"] += 1
            if ctx.attempt == 0:
                raise OverflowError("simulated numerical overflow")
            return {"estimate": v, "first": v}

        register_step_fn("overflow_once", overflow_once)
        exp = Experiment(
            experiment_id="overflow", param_specs=[],
            steps=[Step("f", "overflow_once",
                        slices=[Slice("uniform", 1)])],
            default_retries=2)
        rec = Executor().run(exp, seed=42)
        self.assertEqual(rec.status, "ok")
        self.assertEqual(rec.retries_total, 1)
        st = DeterministicStream(42, "overflow")
        self.assertEqual(rec.step_records[0].result["first"],
                         st.draw_at(0, "uniform", {}))


if __name__ == "__main__":
    unittest.main()
