"""模型与声明期校验测试（需求 1、2）。"""
import unittest

from rng_core.models import parse_experiment, ValidationError


def base_wire(**over):
    w = {
        "id": "exp1",
        "source": "local",
        "seed_policy": {"mode": "fixed", "seed": 42},
        "params": [
            {"name": "n", "type": "int", "default": 100, "min": 1, "max": 1000},
            {"name": "p", "type": "float", "min": 0.0, "max": 1.0},
        ],
        "steps": [
            {"id": "a", "handler": "bernoulli_count",
             "draws": [{"id": "trials", "type": "bernoulli", "count": "$params.n",
                        "params": {"p": "$params.p"}}]},
            {"id": "b", "handler": "combine",
             "params": {"x": "$steps.a.successes", "y": "$seed"},
             "depends_on": ["a"]},
        ],
    }
    w.update(over)
    return w


class TestValidation(unittest.TestCase):
    def test_valid_parses(self):
        spec = parse_experiment(base_wire())
        self.assertEqual(spec.eid, "exp1")
        self.assertEqual(spec.seed_policy.seeds("exp1"), [42])
        self.assertEqual([s.sid for s in spec.steps], ["a", "b"])

    def test_duplicate_experiment_fields(self):
        w = base_wire()
        w["params"][1]["name"] = "n"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("params.[1]", str(cm.exception))
        self.assertIn("重复", str(cm.exception))

    def test_bad_param_range_rejected_with_location(self):
        w = base_wire()
        w["params"][0]["default"] = -5
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        msg = str(cm.exception)
        self.assertIn("params.[0].default", msg)
        self.assertIn("下限", msg)

    def test_param_type_mismatch_location(self):
        w = base_wire()
        w["params"][0]["default"] = "lots"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("params.[0].default", str(cm.exception))

    def test_step_referencing_missing_param(self):
        w = base_wire()
        w["steps"][0]["draws"][0]["count"] = "$params.missing"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        msg = str(cm.exception)
        self.assertIn("steps.[0].draws.[0].count", msg)
        self.assertIn("$params.missing", msg)

    def test_forward_step_reference_rejected(self):
        w = base_wire()
        w["steps"][0]["params"] = {"future": "$steps.b.sum"}
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        msg = str(cm.exception)
        self.assertIn("steps.[0].params.future", msg)
        self.assertIn("后续步骤", msg)

    def test_unknown_step_reference_rejected(self):
        w = base_wire()
        w["steps"][1]["params"]["z"] = "$steps.ghost.mean"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("不存在的步骤", str(cm.exception))

    def test_duplicate_step_id_and_draw_id(self):
        w = base_wire()
        w["steps"][1]["id"] = "a"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("steps.[1]", str(cm.exception))

        w = base_wire()
        w["steps"][0]["draws"].append(
            {"id": "trials", "type": "uniform", "count": 2})
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("draws.[1]", str(cm.exception))

    def test_invalid_draw_type_and_count(self):
        w = base_wire()
        w["steps"][0]["draws"][0]["type"] = "exponential"
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("draws.[0]", str(cm.exception))

        w = base_wire()
        w["steps"][0]["draws"][0]["count"] = 0
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("count", str(cm.exception))

    def test_distribution_param_checked(self):
        w = base_wire()
        w["steps"][0]["draws"][0]["params"]["p"] = 1.5
        with self.assertRaises(ValidationError) as cm:
            parse_experiment(w)
        self.assertIn("draws.[0]", str(cm.exception))

    def test_empty_steps_rejected(self):
        w = base_wire()
        w["steps"] = []
        with self.assertRaises(ValidationError):
            parse_experiment(w)

    def test_seed_policies(self):
        s = parse_experiment(base_wire(
            seed_policy={"mode": "list", "seeds": [3, 1, 2]}))
        self.assertEqual(s.seed_policy.seeds("exp1"), [3, 1, 2])
        with self.assertRaises(ValidationError):
            parse_experiment(base_wire(
                seed_policy={"mode": "list", "seeds": [1, 1]}))
        derived = parse_experiment(base_wire(
            seed_policy={"mode": "derive", "base_seed": 100, "count": 4}))
        seeds = derived.seed_policy.seeds("exp1")
        self.assertEqual(len(seeds), 4)
        self.assertEqual(seeds, sorted(seeds))
        # 派生只取决于 (实验id, base, i)
        again = parse_experiment(base_wire(
            seed_policy={"mode": "derive", "base_seed": 100, "count": 4}))
        self.assertEqual(again.seed_policy.seeds("exp1"), seeds)
        self.assertNotEqual(
            seeds, parse_experiment(base_wire(
                id="other", seed_policy={"mode": "derive",
                                         "base_seed": 100, "count": 4})
            ).seed_policy.seeds("other"))

    def test_enum_param(self):
        w = base_wire()
        w["params"].append({"name": "mode", "type": "enum",
                            "choices": ["fast", "slow"], "default": "fast"})
        spec = parse_experiment(w)
        self.assertEqual(spec.params[-1].choices, ("fast", "slow"))
        w["params"][-1]["default"] = "medium"
        with self.assertRaises(ValidationError):
            parse_experiment(w)


if __name__ == "__main__":
    unittest.main()
