"""需求 7：结果、随机量消耗、种子、置信区间、偏离原因查询，稳定顺序。"""

import unittest

from detexp.models import Experiment, Slice, Step
from detexp.registry import ExperimentSystem
from detexp.steps import StepContext, register_step_fn

from .factories import make_normal_mean, make_pi, make_walk


class TestQueries(unittest.TestCase):
    def setUp(self):
        self.sys = ExperimentSystem()
        self.sys.register_experiment(make_pi(n=200))
        self.sys.run("pi", seed=2)
        self.sys.run("pi", seed=1)
        self.sys.run("pi", seed=3)

    def test_seeds_sorted(self):
        self.assertEqual(self.sys.get_seeds("pi"), [1, 2, 3])

    def test_result_runs_sorted_by_seed_and_steps_by_order(self):
        res = self.sys.get_result("pi")
        self.assertEqual([r["seed"] for r in res["runs"]], [1, 2, 3])
        orders = [s["order"] for s in res["runs"][0]["steps"]]
        self.assertEqual(orders, sorted(orders))

    def test_stream_usage_reports_declared_and_consumed(self):
        usage = self.sys.get_stream_usage("pi", seed=1)
        self.assertEqual(usage["total_declared"], 400)
        seed_info = usage["seeds"][0]
        self.assertEqual(seed_info["declared_total"], 400)
        self.assertEqual(seed_info["consumed_total"], 400)
        self.assertTrue(seed_info["conserved"])
        sl = seed_info["steps"][0]["slices"][0]
        self.assertEqual(sl["kind"], "uniform")
        self.assertEqual(sl["offset"], 0)
        self.assertTrue(sl["balanced"])

    def test_query_bundle_is_stable(self):
        q1 = self.sys.query("pi")
        q2 = self.sys.query("pi")
        import json
        from detexp.engine import canonical_json
        self.assertEqual(canonical_json(q1), canonical_json(q2))
        self.assertEqual(q1["seeds"], [1, 2, 3])

    def test_confidence_interval_after_batch(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=30))
        sys.batch_run("nm", seeds=[11, 12, 13, 14], ci_level=0.9)
        ci = sys.get_confidence_interval("nm")
        self.assertEqual(ci["ci_level"], 0.9)
        self.assertEqual(ci["seeds"], [11, 12, 13, 14])
        self.assertLessEqual(ci["ci_low"], ci["mean"])
        self.assertLessEqual(ci["mean"], ci["ci_high"])
        self.assertGreaterEqual(ci["variance"], 0.0)

    def test_outlier_reason_query(self):
        def responder(ctx: StepContext, params):
            w = ctx.window(0)
            w.draw_many(w.count)
            return {"estimate": 10.0 if ctx.seed == 7 else 0.0}

        register_step_fn("resp_q", responder)
        exp = Experiment(
            experiment_id="rq", param_specs=[],
            steps=[Step("r", "resp_q", slices=[Slice("uniform", 1)])])
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        sys.batch_run("rq", seeds=[1, 2, 3, 7])
        reason = sys.get_outlier_reason("rq", 7)
        self.assertIsNotNone(reason)
        self.assertIn("种子 7", reason)

    def test_walk_process_records_final_and_stream(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_walk(n=40))
        rec = sys.run("walk", seed=8)
        self.assertEqual(rec.status, "ok")
        result = rec.step_records[0].result
        self.assertIn("final", result)
        usage = sys.get_stream_usage("walk", seed=8)
        self.assertEqual(usage["seeds"][0]["consumed_total"], 40)


if __name__ == "__main__":
    unittest.main()
