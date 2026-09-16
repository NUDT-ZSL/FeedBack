"""登记处、冲突记录与稳定查询测试（需求 6、7）。"""
import copy
import unittest

from rng_core.registry import (
    Registry, AmbiguousReferenceError, UnknownExperimentError,
)
from rng_core.models import parse_experiment


def bern_wire(eid="bern", n_default=1000, source="local"):
    return {
        "id": eid,
        "source": source,
        "seed_policy": {"mode": "list", "seeds": [7, 3, 11, 1, 5]},
        "params": [{"name": "n", "type": "int", "default": n_default,
                    "min": 1, "max": 100000}],
        "steps": [
            {"id": "cnt", "handler": "bernoulli_count",
             "draws": [{"id": "trials", "type": "bernoulli",
                        "count": "$params.n", "params": {"p": 0.5}}]},
        ],
    }


class TestRegistry(unittest.TestCase):
    def setUp(self):
        self.reg = Registry()
        self.reg.register_experiment(parse_experiment(bern_wire()))

    def test_run_policy_and_stable_ordering(self):
        runs = self.reg.run_policy("bern")
        self.assertEqual([r.seed for r in runs], [7, 3, 11, 1, 5])
        self.assertEqual(self.reg.list_seeds("bern"), [1, 3, 5, 7, 11])
        listed = self.reg.list_results("bern")
        self.assertEqual(listed,
                         sorted(listed))  # 按种子、来源稳定排序
        self.assertEqual({s for _, s, st in listed}, {"local"})
        self.assertTrue(all(st == "success" for _, _, st in listed))

    def test_queries_current_result_consumed_seed_ci_outlier(self):
        report = self.reg.run_batch(
            "bern", [("phat", "cnt", "p_hat")], source="local")
        run = self.reg.get_result("bern", 7)
        self.assertEqual(run.experiment_id, "bern")
        self.assertEqual(run.seed, 7)
        # 随机量消耗查询
        cons = self.reg.consumed_draws("bern", 7)
        self.assertEqual(cons[0]["step_id"], "cnt")
        self.assertEqual(cons[0]["declared"], {"bernoulli": 1000})
        self.assertEqual(cons[0]["consumed"], {"bernoulli": 1000})
        self.assertEqual(len(cons[0]["stream_keys"]), 1)
        # 所用种子集合
        self.assertEqual(report.seeds, [1, 3, 5, 7, 11])
        # 置信区间查询与离群原因查询
        ci = self.reg.confidence_interval("bern", "phat")
        self.assertEqual(ci["seeds"], [1, 3, 5, 7, 11])
        self.assertTrue(ci["ci_low"] <= ci["mean"] <= ci["ci_high"])
        for seed in report.seeds:
            expl = self.reg.explain_outlier("bern", "phat", seed)
            self.assertIn("reason", expl)
            self.assertIn(expl["status"], ("success", "failed"))

    def test_config_conflict_both_sides_retained(self):
        wire_b = bern_wire(n_default=500, source="teamB")
        outcome = self.reg.register_experiment(parse_experiment(wire_b))
        self.assertEqual(outcome, "conflict")
        # 双方都在
        self.assertEqual(self.reg.sources_for("bern"), ["local", "teamB"])
        spec_a = self.reg.get_experiment("bern", source="local")
        spec_b = self.reg.get_experiment("bern", source="teamB")
        self.assertEqual(spec_a.params[0].default, 1000)
        self.assertEqual(spec_b.params[0].default, 500)
        # 不指定来源 -> 歧义错误，绝不静默择一
        with self.assertRaises(AmbiguousReferenceError) as cm:
            self.reg.get_experiment("bern")
        self.assertEqual(cm.exception.sources, ["local", "teamB"])
        # 冲突记录可读且双方内容都在
        confs = self.reg.conflicts("bern")
        self.assertEqual(len(confs), 1)
        rec = confs[0]
        self.assertEqual(rec.kind, "config")
        self.assertEqual(rec.sources, ["local", "teamB"])
        text = rec.render()
        self.assertIn("bern", text)
        self.assertIn("local", text)
        self.assertIn("teamB", text)
        self.assertEqual(set(rec.contents), {"local", "teamB"})
        self.assertEqual(rec.contents["teamB"]["params"][0]["default"], 500)

    def test_consistent_second_source_is_not_conflict(self):
        wire_b = copy.deepcopy(bern_wire(source="mirror"))
        self.assertEqual(
            self.reg.register_experiment(parse_experiment(wire_b)),
            "consistent")
        self.assertEqual(self.reg.conflicts("bern"), [])

    def test_result_conflict_both_retained(self):
        self.reg.run_policy("bern", source="local")
        # 伪造一个外部来源提交的不同结果
        run_local = self.reg.get_result("bern", 7, source="local")
        tampered = self.reg.engine.run(
            self.reg.get_experiment("bern", "local"), 7, {"n": 500})
        status = self.reg.store_result(tampered, "external")
        self.assertEqual(status, "conflict")
        with self.assertRaises(AmbiguousReferenceError):
            self.reg.get_result("bern", 7)
        # 双方结果都可按来源取到
        self.assertEqual(
            self.reg.get_result("bern", 7, source="local").fingerprint,
            run_local.fingerprint)
        self.assertNotEqual(
            self.reg.get_result("bern", 7, source="external").fingerprint,
            run_local.fingerprint)
        confs = [c for c in self.reg.conflicts("bern") if c.kind == "result"]
        self.assertEqual(len(confs), 1)
        self.assertEqual(confs[0].seed, 7)
        self.assertIn("external", confs[0].render())

    def test_same_source_resubmission_different_is_not_overwritten(self):
        r1 = self.reg.run("bern", seed=1, source="local")
        r2 = self.reg.engine.run(
            self.reg.get_experiment("bern", "local"), 1, {"n": 333})
        self.assertNotEqual(r1.fingerprint, r2.fingerprint)
        self.assertEqual(self.reg.store_result(r2, "local"), "conflict")
        # 旧值未被覆盖
        self.assertEqual(
            self.reg.get_result("bern", 1, source="local").fingerprint,
            r1.fingerprint)
        labels = [s for bucket in self.reg._results.values()
                  for s in bucket]
        self.assertTrue(any("#v" in s for s in labels))

    def test_unknown_experiment_errors(self):
        with self.assertRaises(UnknownExperimentError):
            self.reg.get_result("nope", 1)
        with self.assertRaises(UnknownExperimentError):
            self.reg.list_results("nope")

    def test_conflicts_sorted_stably(self):
        self.reg.register_experiment(parse_experiment(
            bern_wire(eid="alpha", source="x")))
        self.reg.register_experiment(parse_experiment(
            bern_wire(eid="alpha", n_default=9, source="y")))
        confs = self.reg.conflicts()
        self.assertEqual([c.experiment_id for c in confs],
                         sorted(c.experiment_id for c in confs))


if __name__ == "__main__":
    unittest.main()
