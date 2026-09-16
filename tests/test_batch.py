"""多种子批量与统计测试（需求 4）。"""
import math
import unittest

from rng_core.batch import (
    BatchRunner, EstimatorSpec, EstimatorSummary, SeedRow, t_quantile,
    _percentile,
)
from rng_core.engine import Engine, RunResult, StepRecord
from rng_core.handlers import build_default_registry
from rng_core.models import parse_experiment


class TestTQuantile(unittest.TestCase):
    def test_known_critical_values(self):
        cases = {(1, 0.975): 12.7062, (9, 0.975): 2.2622,
                 (30, 0.975): 2.0423, (10, 0.95): 1.8125,
                 (1000, 0.975): 1.9623}
        for (df, p), want in cases.items():
            self.assertAlmostEqual(t_quantile(p, df), want, delta=0.002,
                                   msg=(df, p))

    def test_symmetric(self):
        self.assertAlmostEqual(t_quantile(0.025, 10),
                               -t_quantile(0.975, 10), places=9)


class TestPercentile(unittest.TestCase):
    def test_linear_interpolation(self):
        xs = [1, 2, 3, 4]
        self.assertAlmostEqual(_percentile(sorted(xs), 0), 1)
        self.assertAlmostEqual(_percentile(sorted(xs), 100), 4)
        self.assertAlmostEqual(_percentile(sorted(xs), 50), 2.5)


def _bernoulli_experiment(n=8000):
    return parse_experiment({
        "id": "bern",
        "source": "local",
        "seed_policy": {"mode": "list", "seeds": list(range(1, 25))},
        "params": [{"name": "n", "type": "int", "default": n, "min": 1}],
        "steps": [
            {"id": "cnt", "handler": "bernoulli_count",
             "draws": [{"id": "trials", "type": "bernoulli",
                        "count": "$params.n", "params": {"p": 0.5}}]},
        ],
    })


class TestBatchRun(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(build_default_registry())
        self.runner = BatchRunner(self.engine)

    def test_summary_against_known_truth(self):
        # n=50000 时正常抽样波动的稳健 z 不会越过 3.5，避免误报
        spec = _bernoulli_experiment(50000)
        report = self.runner.run_batch(
            spec, list(range(1, 25)),
            [EstimatorSpec("phat", "cnt", "p_hat")])
        self.assertEqual(report.seeds, list(range(1, 25)))
        s = report.summaries[0]
        self.assertEqual(s.n, 24)
        self.assertAlmostEqual(s.mean, 0.5, delta=0.01)
        # 二项分布方差 p(1-p)/n
        self.assertAlmostEqual(s.variance, 0.25 / 50000, delta=2.0e-5)
        self.assertTrue(s.ci_low < 0.5 < s.ci_high)
        # 区间宽度 = 2 * t_{0.975,23} * 标准误（用本库 t 分位数与实测方差）
        tcrit = t_quantile(0.975, 23)
        self.assertAlmostEqual(s.ci_high - s.ci_low,
                               2 * tcrit * math.sqrt(s.variance / 24),
                               delta=1e-12)
        # 与 t 表值吻合
        self.assertAlmostEqual(tcrit, 2.0687, delta=2e-4)
        # 与理论二项方差只有抽样误差
        self.assertLess(abs(s.variance - 0.25 / 50000), 4.0e-6)
        # 正常样本不应误报离群
        self.assertEqual([r for r in s.rows if r.is_outlier], [])
        self.assertTrue(all(r.reason for r in s.rows))

    def test_parallel_seeds_matches_sequential(self):
        spec = _bernoulli_experiment(2000)
        seeds = list(range(1, 17))
        est = [EstimatorSpec("phat", "cnt", "p_hat")]
        a = self.runner.run_batch(spec, seeds, est, parallel_seeds=False)
        b = self.runner.run_batch(spec, seeds, est, parallel_seeds=True)
        self.assertEqual(
            [r.value for r in a.summaries[0].rows],
            [r.value for r in b.summaries[0].rows])
        self.assertAlmostEqual(a.summaries[0].mean, b.summaries[0].mean)

    def test_outlier_detection_robust_z(self):
        # 30 个紧密围绕 10 的小幅散布值 + 一个明显远离的值 50
        values = [10.0 + ((-1) ** i) * 0.001 * i for i in range(30)] + [50.0]
        seeds = list(range(101, 132))
        results = {}
        for seed, v in zip(seeds, values):
            rec = StepRecord(index=0, sid="cnt", handler="h", status="success")
            rec.output = {"x": v}
            results[seed] = RunResult("synthetic", seed, "success", {}, [rec])
        summary = self.runner._summarize(
            parse_experiment({
                "id": "synthetic", "source": "local",
                "seed_policy": {"mode": "fixed", "seed": 1},
                "params": [],
                "steps": [{"id": "cnt", "handler": "h", "draws": []}]}),
            EstimatorSpec("x", "cnt", "x"), seeds, results, 0.95, 3.5, 3.0)
        out = [r for r in summary.rows if r.is_outlier]
        self.assertEqual([r.seed for r in out], [131])
        row = next(r for r in summary.rows if r.seed == 131)
        self.assertIn("稳健 z", row.reason)
        self.assertGreater(abs(row.robust_z), 3.5)

    def test_failed_seed_excluded_with_reason(self):
        good = StepRecord(index=0, sid="cnt", handler="h", status="success")
        good.output = {"x": 1.0}
        bad = StepRecord(index=0, sid="cnt", handler="h", status="failed",
                         error_category="overflow", error_message="boom")
        results = {
            1: RunResult("e", 1, "success", {}, [good]),
            2: RunResult("e", 2, "failed", {}, [bad]),
        }
        summary = self.runner._summarize(
            parse_experiment({
                "id": "e", "source": "local",
                "seed_policy": {"mode": "fixed", "seed": 1},
                "params": [],
                "steps": [{"id": "cnt", "handler": "h", "draws": []}]}),
            EstimatorSpec("x", "cnt", "x"), [1, 2], results, 0.95, 3.5, 3.0)
        self.assertEqual(summary.n, 1)
        row2 = next(r for r in summary.rows if r.seed == 2)
        self.assertFalse(row2.is_outlier)
        self.assertIn("失败", row2.reason)


if __name__ == "__main__":
    unittest.main()
