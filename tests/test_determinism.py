"""需求 2/3：随机流确定性切分、调度顺序无关、跨进程字节级复现。"""

import math
import unittest

from detexp.engine import Executor
from detexp.errors import StreamExhaustedError
from detexp.models import Experiment, Slice, Step
from detexp.registry import ExperimentSystem
from detexp.rng import DeterministicStream
from detexp.steps import StepContext, StepFail, register_step_fn

from .factories import make_normal_mean, make_pi, make_walk


class TestStreamLayout(unittest.TestCase):
    def test_offsets_are_contiguous_and_per_step(self):
        exp = Experiment(
            experiment_id="layout", param_specs=[],
            steps=[
                Step("a", "passthrough",
                     slices=[Slice("uniform", 3), Slice("normal", 2)]),
                Step("b", "passthrough", slices=[Slice("bernoulli", 4)]),
            ])
        layout = exp.lay_out_stream()
        self.assertEqual(
            [(l.step_id, l.slice_index, l.kind, l.offset, l.count)
             for l in layout],
            [("a", 0, "uniform", 0, 3),
             ("a", 1, "normal", 3, 2),
             ("b", 0, "bernoulli", 5, 4)])
        self.assertEqual(exp.total_draws(), 9)

    def test_steps_cannot_read_beyond_their_window(self):
        def greedy(ctx: StepContext, params):
            w = ctx.window(0)
            while True:
                w.draw()
        register_step_fn("greedy", greedy)
        exp = Experiment(
            experiment_id="greedy", param_specs=[],
            steps=[Step("g", "greedy", slices=[Slice("uniform", 2)]),
                   Step("after", "passthrough",
                        slices=[Slice("normal", 1, {"std": 1.0})])])
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        rec = sys.run("greedy", seed=5)
        self.assertEqual(rec.status, "failed")
        self.assertIn("越界", rec.step_records[0].attempts[0].error)

    def test_later_step_offsets_untouched_when_first_overdraws(self):
        def greedy5(ctx, params):
            w = ctx.window(0)
            for _ in range(5):
                w.draw()

        def exact2(ctx, params):
            w = ctx.window(0)
            return {"estimate": float(sum(w.draw_many(2)) / 2)}

        register_step_fn("greedy5", greedy5)
        register_step_fn("exact2", exact2)
        # 失败实验：第一步越界，第二步的布局仍为 offset 2,3
        bad = Experiment(
            experiment_id="stream-layout", param_specs=[],
            steps=[Step("g", "greedy5", slices=[Slice("uniform", 2)]),
                   Step("n", "normal_mean", params={"n": 2},
                        slices=[Slice("normal", 2)])])
        rec_bad = Executor().run(bad, seed=5)
        self.assertEqual(rec_bad.step_records[0].status, "failed")

        # 健康实验：相同实验 id 与布局，仅第一步改为正常消耗 2 个
        healthy = Experiment(
            experiment_id="stream-layout", param_specs=[],
            steps=[Step("g", "exact2", slices=[Slice("uniform", 2)]),
                   Step("n", "normal_mean", params={"n": 2},
                        slices=[Slice("normal", 2)])])
        rec = Executor().run(healthy, seed=5)
        self.assertEqual(rec.status, "ok")
        st = DeterministicStream(5, "stream-layout")
        expected = [st.draw_at(2, "normal", {}), st.draw_at(3, "normal", {})]
        samples = rec.step_records[1].slices[0].sample_draws
        self.assertEqual([pair[0] for pair in samples], [2, 3])
        self.assertEqual([pair[1] for pair in samples], expected)


class TestSchedulingInvariance(unittest.TestCase):
    def test_sequential_parallel_reverse_identical(self):
        for factory, seed in ((make_pi, 42), (make_normal_mean, 7),
                              (make_walk, 99)):
            sys = ExperimentSystem()
            sys.register_experiment(factory())
            report = sys.verify_scheduling_invariance(
                factory().experiment_id, seed=seed)
            self.assertTrue(
                report["identical"],
                msg=f"scheduling changed results: {report['fingerprints']}")
            self.assertEqual(len(set(report["estimates"].values())), 1)

    def test_multi_step_parallel_independence(self):
        calls = []

        def sum_draw(label):
            def fn(ctx: StepContext, params):
                w = ctx.window(0)
                vals = w.draw_many(w.count)
                calls.append(label)
                return {"estimate": float(sum(vals)), "vals": vals}
            return fn

        register_step_fn("sum_a", sum_draw("a"))
        register_step_fn("sum_b", sum_draw("b"))
        register_step_fn("sum_c", sum_draw("c"))
        exp = Experiment(
            experiment_id="multi", param_specs=[],
            steps=[Step("a", "sum_a", slices=[Slice("uniform", 4)]),
                   Step("b", "sum_b", slices=[Slice("normal", 3)]),
                   Step("c", "sum_c", slices=[Slice("bernoulli", 5,
                                                    {"p": 0.4})])])
        ex = Executor(max_workers=4)
        r_seq = ex.run(exp, seed=11, scheduling="sequential")
        r_par = ex.run(exp, seed=11, scheduling="parallel")
        r_rev = ex.run(exp, seed=11, scheduling="reverse")
        self.assertEqual(r_seq.result_fingerprint, r_par.result_fingerprint)
        self.assertEqual(r_seq.result_fingerprint, r_rev.result_fingerprint)
        # 每个步骤拿到自己切片的值
        st = DeterministicStream(11, "multi")
        self.assertEqual(
            r_seq.step_records[0].result["vals"],
            [st.draw_at(i, "uniform", {}) for i in range(4)])
        self.assertEqual(
            r_seq.step_records[1].result["vals"],
            [st.draw_at(4 + i, "normal", {}) for i in range(3)])

    def test_repeated_runs_are_bit_identical(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_pi(n=5000))
        r1 = sys.run("pi", seed=123)
        r2 = sys.run("pi", seed=123, scheduling="parallel")
        self.assertTrue(r2.reproduced)
        self.assertEqual(r1.result_fingerprint, r2.result_fingerprint)
        self.assertEqual(
            [sr.result for sr in r1.step_records],
            [sr.result for sr in r2.step_records])

    def test_different_seeds_differ_but_are_each_reproducible(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_pi(n=2000))
        a = sys.run("pi", seed=1)
        b = sys.run("pi", seed=2)
        self.assertNotEqual(a.estimate, b.estimate)
        a2 = Executor().run(make_pi(n=2000), seed=1)
        self.assertEqual(a.estimate, a2.estimate)

    def test_seed_types_normalize_deterministically(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_pi(n=100))
        r1 = sys.run("pi", seed=999)
        r2 = Executor().run(make_pi(n=100), seed=999)
        self.assertEqual(r1.estimate, r2.estimate)

    def test_experiment_id_participates_in_stream(self):
        e1 = make_pi("exp-a", n=100)
        e2 = make_pi("exp-b", n=100)
        r1 = Executor().run(e1, seed=7)
        r2 = Executor().run(e2, seed=7)
        self.assertNotEqual(r1.estimate, r2.estimate)


class TestDeterministicNumerics(unittest.TestCase):
    def test_golden_vectors(self):
        # 固定黄金向量：任何机器上这些值必须一致（验收锚点）
        st = DeterministicStream(2026, "golden")
        self.assertAlmostEqual(st.uniform01_at(0), 0.5152883683416787,
                               places=15)
        self.assertAlmostEqual(st.uniform01_at(1), 0.8830855646840546,
                               places=15)
        n0 = st.draw_at(10, "normal", {"mean": 0.0, "std": 1.0})
        self.assertAlmostEqual(n0, 1.6400477993778138, places=12)
        self.assertEqual(
            st.draw_at(20, "integer", {"low": 0, "high": 100}), 1)

    def test_inverse_normal_symmetric_and_monotone(self):
        from detexp.rng import inverse_normal
        self.assertAlmostEqual(inverse_normal(0.5), 0.0, places=12)
        self.assertAlmostEqual(inverse_normal(0.1), -inverse_normal(0.9),
                               places=9)
        prev = -math.inf
        for i in range(1, 1000):
            v = inverse_normal(i / 1000)
            self.assertGreater(v, prev)
            prev = v


if __name__ == "__main__":
    unittest.main()
