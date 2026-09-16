"""需求 4：多种子批量运行、均值/方差/置信区间、离群种子与原因。"""

import math
import unittest

from detexp.analysis import analyze_estimates, t_critical
from detexp.models import Experiment, Slice, Step
from detexp.registry import ExperimentSystem
from detexp.steps import StepContext, register_step_fn


def _seed_response(ctx: StepContext, params):
    # 消耗固定切片保证流守恒，但估计量按种子可预测地变化，
    # 便于确定性地构造离群场景。
    w = ctx.window(0)
    w.draw_many(w.count)
    outlier_at = int(params.get("outlier_seed", -1))
    shift = float(params.get("shift", 5.0))
    base = float(params.get("base", 1.0))
    if ctx.seed == outlier_at:
        return {"estimate": base + shift}
    return {"estimate": base}


register_step_fn("seed_response", _seed_response)


def make_response_experiment(outlier_seed: int = -1, shift: float = 5.0,
                             experiment_id: str = "resp") -> Experiment:
    return Experiment(
        experiment_id=experiment_id, param_specs=[],
        steps=[Step("r", "seed_response",
                    params={"outlier_seed": outlier_seed, "shift": shift,
                            "base": 1.0},
                    slices=[Slice("uniform", 2)])])


class TestTCritical(unittest.TestCase):
    def test_known_values(self):
        self.assertAlmostEqual(t_critical(10, 0.95), 2.22814, places=4)
        self.assertAlmostEqual(t_critical(1, 0.95), 12.7062, places=3)
        self.assertGreater(t_critical(2, 0.99), t_critical(10, 0.99))

    def test_ci_monotone_in_level(self):
        self.assertLess(t_critical(20, 0.90), t_critical(20, 0.99))


class TestAnalyze(unittest.TestCase):
    def test_mean_variance(self):
        bs = analyze_estimates("e", [1, 2, 3], {1: 1.0, 2: 2.0, 3: 3.0})
        self.assertAlmostEqual(bs.mean, 2.0)
        self.assertAlmostEqual(bs.variance, 1.0)
        self.assertLess(bs.ci_low, bs.ci_high)
        self.assertLessEqual(bs.ci_low, bs.mean)
        self.assertLessEqual(bs.mean, bs.ci_high)

    def test_single_seed_ci_is_point(self):
        bs = analyze_estimates("e", [1], {1: 2.5})
        self.assertEqual(bs.ci_low, 2.5)
        self.assertEqual(bs.ci_high, 2.5)

    def test_outlier_detected_with_reason(self):
        seeds = list(range(10, 19))
        values = {10: 0.95, 11: 1.02, 12: 1.0, 13: 0.98, 14: 8.0,
                  15: 1.03, 16: 0.97, 17: 1.01, 18: 0.99}
        bs = analyze_estimates("e", seeds, values)
        self.assertEqual([o.seed for o in bs.outliers], [14])
        o = bs.outliers[0]
        self.assertGreater(o.z_score, 2.5)
        self.assertIn("14", o.reason)
        self.assertIn("z 分数", o.reason)

    def test_tight_cluster_unique_deviator_inf_z(self):
        seeds = [1, 2, 3, 4]
        values = {1: 1.0, 2: 1.0, 3: 1.0, 4: 1.5}
        bs = analyze_estimates("e", seeds, values)
        self.assertEqual([o.seed for o in bs.outliers], [4])
        self.assertEqual(bs.outliers[0].z_score, math.inf)
        self.assertIn("唯一偏离点", bs.outliers[0].reason)

    def test_no_outlier_in_tight_normal_cluster(self):
        seeds = [1, 2, 3, 4, 5]
        values = {1: 0.999, 2: 1.001, 3: 1.0, 4: 1.0005, 5: 0.9995}
        bs = analyze_estimates("e", seeds, values)
        self.assertEqual(bs.outliers, [])


class TestBatchRun(unittest.TestCase):
    def test_batch_over_seed_policy(self):
        exp = make_response_experiment()
        exp.seed_policy = {"type": "sequence", "seeds": [100, 101, 102]}
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        bs = sys.batch_run("resp", ci_level=0.95)
        self.assertEqual(bs.seeds, [100, 101, 102])
        self.assertEqual(sys.get_seeds("resp"), [100, 101, 102])
        ci = sys.get_confidence_interval("resp")
        self.assertEqual(ci["seeds"], [100, 101, 102])
        self.assertEqual(ci["n_seeds"], 3)
        self.assertEqual(ci["ci_level"], 0.95)

    def test_batch_flags_outlier_seed_and_query_reason(self):
        exp = make_response_experiment(outlier_seed=999, shift=10.0,
                                       experiment_id="resp2")
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        seeds = [1, 2, 3, 4, 999]
        bs = sys.batch_run("resp2", seeds=seeds)
        self.assertEqual([o.seed for o in bs.outliers], [999])
        reason = sys.get_outlier_reason("resp2", 999)
        self.assertIsNotNone(reason)
        self.assertIn("999", reason)
        self.assertIsNone(sys.get_outlier_reason("resp2", 1))
        self.assertEqual(
            [o["seed"] for o in sys.get_outliers("resp2")], [999])

    def test_batch_rejects_bad_ci_level(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_response_experiment(experiment_id="x"))
        with self.assertRaises(ValueError):
            sys.batch_run("x", seeds=[1, 2], ci_level=1.0)


if __name__ == "__main__":
    unittest.main()
