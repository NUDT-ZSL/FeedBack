"""需求 1：实验维护、非法参数/悬空引用拒绝并指出位置。"""

import unittest

from detexp.errors import MultiValidationError, ValidationError
from detexp.models import Experiment, ParameterSpec, Slice, Step
from detexp.registry import ExperimentSystem
from detexp.steps import REGISTRY

from .factories import make_pi


class TestValidation(unittest.TestCase):
    def test_valid_experiment_registers(self):
        sys = ExperimentSystem()
        self.assertEqual(sys.register_experiment(make_pi()), "registered")
        self.assertEqual(sys.list_experiment_ids(), ["pi"])

    def test_unique_id_enforced_by_system_on_re_register_equal(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_pi())
        # 同内容重复注册不算冲突
        self.assertEqual(sys.register_experiment(make_pi()), "unchanged")

    def test_invalid_parameter_value_reports_location(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("n", kind="int", min=1, max=10)],
            values={"n": 50},
            steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        msg = str(cm.exception)
        self.assertIn("experiment.values['n']", msg)
        self.assertIn("最大值", msg)
        self.assertEqual(len(cm.exception.errors), 1)

    def test_wrong_type_reports_location(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("n", kind="int")],
            values={"n": "fifty"},
            steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("experiment.values['n']", str(cm.exception))

    def test_non_finite_float_rejected(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("x", kind="float")],
            values={"x": float("inf")},
            steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError):
            exp.validate()

    def test_choice_constraint(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("m", kind="str",
                                       choices=["a", "b"])],
            values={"m": "c"},
            steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("允许集合", str(cm.exception))

    def test_dangling_parameter_reference(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("n", kind="int", default=3,
                                       required=False)],
            values={"n": 3},
            steps=[Step("s", "passthrough",
                        params={"v": {"$param": "ghost"}})])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        msg = str(cm.exception)
        self.assertIn("ghost", msg)
        # 必须指出步骤下标与引用位置
        self.assertIn("steps[0]", msg)
        self.assertIn("params.v.$param", msg)

    def test_good_parameter_reference_resolves(self):
        exp = Experiment(
            experiment_id="ref",
            param_specs=[ParameterSpec("v", kind="int", default=7,
                                       required=False)],
            values={"v": 7},
            steps=[Step("s", "passthrough",
                        params={"value": {"$param": "v"}})])
        sys = ExperimentSystem()
        sys.register_experiment(exp)
        rec = sys.run("ref", seed=1)
        self.assertEqual(rec.step_records[0].result, 7)

    def test_unknown_step_function(self):
        exp = Experiment(
            experiment_id="bad", param_specs=[],
            steps=[Step("s", "does_not_exist")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate(fn_names=list(REGISTRY))
        self.assertIn("does_not_exist", str(cm.exception))

    def test_duplicate_step_id(self):
        exp = Experiment(
            experiment_id="bad", param_specs=[],
            steps=[Step("s", "passthrough"), Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("步骤标识重复", str(cm.exception))

    def test_empty_steps_rejected(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("v", kind="int", default=1,
                                       required=False)],
            values={"v": 1}, steps=[])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("至少需要一个步骤", str(cm.exception))

    def test_bad_slice_kind_and_count(self):
        exp = Experiment(
            experiment_id="bad", param_specs=[],
            steps=[Step("s", "passthrough",
                        slices=[Slice("weibull", 3)]),
                   Step("t", "passthrough",
                        slices=[Slice("uniform", -2)])])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
            # 多个错误应一次报出
        self.assertGreaterEqual(len(cm.exception.errors), 2)

    def test_undeclared_parameter_supplied(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("v", kind="int", default=1,
                                       required=False)],
            values={"v": 1, "rogue": 2},
            steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("rogue", str(cm.exception))

    def test_required_parameter_missing(self):
        exp = Experiment(
            experiment_id="bad",
            param_specs=[ParameterSpec("v", kind="int")],
            values={}, steps=[Step("s", "passthrough")])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("必填项", str(cm.exception))

    def test_multiple_errors_collected(self):
        exp = Experiment(
            experiment_id="",
            param_specs=[
                ParameterSpec("a", kind="int"),
                ParameterSpec("a", kind="int", default=2, required=False)],
            values={}, steps=[])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertGreaterEqual(len(cm.exception.errors), 3)

    def test_invalid_draw_params_rejected(self):
        exp = Experiment(
            experiment_id="bad", param_specs=[],
            steps=[Step("s", "normal_mean", params={"n": 2},
                        slices=[Slice("normal", 2, {"std": 0.0})])])
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("draw_params", str(cm.exception))

    def test_bad_seed_policy(self):
        exp = make_pi()
        exp.seed_policy = {"type": "sequence", "seeds": [1, 1]}
        with self.assertRaises(MultiValidationError) as cm:
            exp.validate()
        self.assertIn("seed_policy", str(cm.exception))


if __name__ == "__main__":
    unittest.main()
