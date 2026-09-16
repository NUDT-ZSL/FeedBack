"""执行引擎测试（需求 2、3、5）：切分守恒、并行确定性、重试重播。"""
import threading
import unittest

from rng_core.engine import Engine
from rng_core.handlers import (
    HandlerRegistry, StepContext, StepFailure, build_default_registry,
)
from rng_core.models import parse_experiment


def wire(**over):
    w = {
        "id": "mc",
        "source": "local",
        "seed_policy": {"mode": "list", "seeds": [1, 2, 3, 4, 5, 6, 7, 8]},
        "params": [
            {"name": "n", "type": "int", "default": 300, "min": 1},
        ],
        "steps": [
            {"id": "s1", "handler": "sample_mean",
             "draws": [{"id": "samples", "type": "gaussian",
                        "count": "$params.n",
                        "params": {"mu": 2.0, "sigma": 1.0}}]},
            {"id": "walk", "handler": "gaussian_walk",
             "params": {"start": 0.0},
             "draws": [{"id": "increments", "type": "gaussian",
                        "count": 50, "params": {"mu": 0.1, "sigma": 0.2}}]},
            {"id": "tail", "handler": "bernoulli_count",
             "draws": [{"id": "trials", "type": "bernoulli",
                        "count": 40, "params": {"p": 0.3}}]},
        ],
    }
    w.update(over)
    return w


class TestEngineDeterminism(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(build_default_registry())
        self.spec = parse_experiment(wire())

    def test_sequential_and_parallel_identical(self):
        for seed in range(1, 21):
            a = self.engine.run(self.spec, seed, {}, parallel=False)
            b = self.engine.run(self.spec, seed, {}, parallel=True)
            self.assertEqual(a.status, "success")
            self.assertEqual(a.fingerprint, b.fingerprint, seed)
            for sa, sb in zip(a.steps, b.steps):
                self.assertEqual(sa.output, sb.output, (seed, sa.sid))

    def test_repeated_runs_identical_under_contention(self):
        # 多线程同时对同一份配置、同一批种子跑（顺序/并行混合），结果必须全等。
        results = {}
        lock = threading.Lock()

        def worker(parallel):
            for seed in range(1, 13):
                r = self.engine.run(self.spec, seed, {}, parallel=parallel)
                with lock:
                    results.setdefault(seed, []).append(r.fingerprint)

        threads = [threading.Thread(target=worker, args=(p,))
                   for p in (False, True, True, False)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        for seed, fps in results.items():
            self.assertEqual(len(set(fps)), 1, seed)

    def test_step_streams_are_independent(self):
        # 改变第一步的抽样数量，不得改变后续步骤拿到的随机数。
        r_small = self.engine.run(self.spec, 11, {})
        spec_big = parse_experiment(wire())
        r_big = self.engine.run(spec_big, 11, {"n": 900})
        # walk 与 tail 与 n 完全无关，输出应逐位相同。
        for sid in ("walk", "tail"):
            self.assertEqual(
                next(s for s in r_small.steps if s.sid == sid).output,
                next(s for s in r_big.steps if s.sid == sid).output, sid)

    def test_conservation_declared_equals_consumed(self):
        r = self.engine.run(self.spec, 4, {})
        for s in r.steps:
            self.assertEqual(s.declared_draws, s.consumed_draws, s.sid)
            self.assertEqual(len(s.stream_keys), len(
                self.spec.steps[s.index].draws))
        # tail 只消耗 bernoulli，walk 只消耗 gaussian
        tail = r.steps[2]
        self.assertEqual(tail.consumed_draws, {"bernoulli": 40})

    def test_invalid_experiment_param_rejected_before_running(self):
        w = wire()
        w["params"] = [{"name": "n", "type": "int", "min": 1, "max": 10}]
        spec = parse_experiment(w)
        with self.assertRaises(Exception) as cm:
            self.engine.run(spec, 1, {"n": 50})
        self.assertIn("params.n", str(cm.exception))
        self.assertIn("上限", str(cm.exception))

    def test_step_level_out_of_range_fails_step_and_skips_later(self):
        # 分布参数在运行期解析自前序步骤输出；越界要判该步骤失败、后续跳过。
        registry = build_default_registry()

        def bad_producer(ctx: StepContext):
            return {"q": 1.2}  # 非法概率，供下一步作为 bernoulli 的 p
        registry.register("bad_producer", bad_producer)

        w = {
            "id": "stepfail",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 1},
            "params": [],
            "steps": [
                {"id": "make", "handler": "bad_producer", "draws": []},
                {"id": "use", "handler": "bernoulli_count",
                 "draws": [{"id": "trials", "type": "bernoulli", "count": 10,
                            "params": {"p": "$steps.make.q"}}]},
                {"id": "later", "handler": "bernoulli_count",
                 "depends_on": ["use"],
                 "draws": [{"id": "trials", "type": "bernoulli",
                            "count": 5, "params": {"p": 0.5}}]},
            ],
        }
        r = Engine(registry).run(parse_experiment(w), 1, {})
        self.assertEqual(r.status, "failed")
        self.assertEqual(r.steps[0].status, "success")
        self.assertEqual(r.steps[1].status, "failed")
        self.assertEqual(r.steps[1].error_category, "invalid_param")
        self.assertIn("use", " ".join(s.sid for s in r.steps))
        self.assertEqual(r.steps[2].status, "skipped")

    def test_missing_param_is_error(self):
        w = wire()
        w["params"] = [{"name": "n", "type": "int", "min": 1}]
        spec = parse_experiment(w)
        with self.assertRaises(Exception):
            self.engine.run(spec, 1, {})


class TestRetryReplay(unittest.TestCase):
    def test_retry_reuses_same_stream_and_succeeds(self):
        w = {
            "id": "retry_exp",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 7},
            "params": [{"name": "k", "type": "int", "default": 2,
                        "min": 0, "max": 5}],
            "steps": [
                {"id": "flaky", "handler": "flaky_overflow",
                 "params": {"fail_first_n": "$params.k"},
                 "draws": [{"id": "samples", "type": "uniform",
                            "count": 100, "params": {"low": -1, "high": 1}}],
                 "retry": {"max_attempts": 4,
                           "retry_on": ["overflow", "value_error"]}},
                {"id": "after", "handler": "sample_mean",
                 "draws": [{"id": "samples", "type": "uniform",
                            "count": 100, "params": {"low": 0, "high": 1}}]},
            ],
        }
        engine = Engine(build_default_registry())

        spec_retry = parse_experiment(w)
        r = engine.run(spec_retry, 7, {})
        self.assertEqual(r.status, "success")
        flaky = r.steps[0]
        self.assertEqual(flaky.status, "success")
        self.assertEqual(flaky.output["succeeded_on_attempt"], 3)
        self.assertEqual(flaky.replayed_attempts, 2)
        self.assertEqual([(a.attempt, a.status, a.category) for a in flaky.attempts],
                         [(1, "failed", "overflow"),
                          (2, "failed", "overflow"),
                          (3, "success", None)])
        # 重试只重播：流键数量仍为 1，声明/消耗守恒。
        self.assertEqual(len(flaky.stream_keys), 1)
        self.assertEqual(flaky.declared_draws, flaky.consumed_draws)

        # 对照组：同样配置但首次就成功——后续步骤 after 的随机数必须完全一致，
        # flaky 成功时所用数字也必须与重试组成功那次一致（均值相等）。
        w0 = {**w, "params": [
            {"name": "k", "type": "int", "default": 0, "min": 0, "max": 5}]}
        spec0 = parse_experiment(w0)
        r0 = engine.run(spec0, 7, {})
        self.assertEqual(r0.steps[0].output["mean"], flaky.output["mean"])
        self.assertEqual(r0.steps[1].output, r.steps[1].output)

    def test_retry_exhausted_marks_failure_and_skips_later(self):
        w = {
            "id": "retry_fail",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 7},
            "params": [{"name": "k", "type": "int", "default": 9,
                        "min": 0, "max": 20}],
            "steps": [
                {"id": "flaky", "handler": "flaky_overflow",
                 "params": {"fail_first_n": "$params.k"},
                 "draws": [{"id": "samples", "type": "uniform", "count": 10}],
                 "retry": {"max_attempts": 2, "retry_on": ["overflow"]}},
                {"id": "after", "handler": "bernoulli_count",
                 "depends_on": ["flaky"],
                 "draws": [{"id": "trials", "type": "bernoulli", "count": 5}]},
            ],
        }
        engine = Engine(build_default_registry())
        r = engine.run(parse_experiment(w), 7, {})
        self.assertEqual(r.status, "failed")
        self.assertEqual(r.steps[0].status, "failed")
        self.assertEqual(r.steps[0].error_category, "overflow")
        self.assertEqual(len(r.steps[0].attempts), 2)
        self.assertEqual(r.steps[1].status, "skipped")

    def test_non_retryable_category_not_retried(self):
        w = {
            "id": "no_retry",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 1},
            "params": [{"name": "k", "type": "int", "default": 3,
                        "min": 0, "max": 10}],
            "steps": [
                {"id": "flaky", "handler": "flaky_overflow",
                 "params": {"fail_first_n": "$params.k"},
                 "draws": [{"id": "samples", "type": "uniform", "count": 10}],
                 "retry": {"max_attempts": 5, "retry_on": ["value_error"]}},
            ],
        }
        r = Engine(build_default_registry()).run(parse_experiment(w), 1, {})
        self.assertEqual(r.status, "failed")
        self.assertEqual(len(r.steps[0].attempts), 1)
        self.assertEqual(r.steps[0].replayed_attempts, 0)


class TestParallelLevels(unittest.TestCase):
    def test_independent_steps_run_in_parallel_and_match(self):
        # 四个互不依赖的步骤应被分到同一层：结果一致，且并行明显更快。
        import time

        registry = build_default_registry()

        def slow(ctx: StepContext):
            time.sleep(0.15)
            xs = ctx.draws["samples"]
            return {"mean": sum(xs) / len(xs)}
        registry.register("slow_uniform", slow)

        w = {
            "id": "levels",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 3},
            "params": [],
            "steps": [
                {"id": f"s{i}", "handler": "slow_uniform",
                 "draws": [{"id": "samples", "type": "uniform", "count": 20}]}
                for i in range(4)
            ],
        }
        spec = parse_experiment(w)
        engine = Engine(registry)

        t0 = time.perf_counter()
        seq = engine.run(spec, 3, {}, parallel=False)
        t_seq = time.perf_counter() - t0

        t0 = time.perf_counter()
        par = engine.run(spec, 3, {}, parallel=True)
        t_par = time.perf_counter() - t0

        self.assertEqual(seq.fingerprint, par.fingerprint)
        self.assertLess(t_par, t_seq * 0.7)

    def test_dependencies_force_separate_levels(self):
        # 显式 depends_on 的步骤必须在依赖成功后才执行（输出引用链可用）。
        w = {
            "id": "deps",
            "source": "local",
            "seed_policy": {"mode": "fixed", "seed": 8},
            "params": [],
            "steps": [
                {"id": "c", "handler": "bernoulli_count",
                 "draws": [{"id": "trials", "type": "bernoulli",
                            "count": 30, "params": {"p": 0.5}}]},
                {"id": "add", "handler": "combine",
                 "params": {"a": "$steps.c.successes", "b": 100},
                 "depends_on": ["c"]},
            ],
        }
        spec = parse_experiment(w)
        r = Engine(build_default_registry()).run(spec, 8, {}, parallel=True)
        self.assertEqual(r.status, "success")
        k = r.steps[0].output["successes"]
        self.assertEqual(r.steps[1].output["sum"], k + 100)


if __name__ == "__main__":
    unittest.main()
