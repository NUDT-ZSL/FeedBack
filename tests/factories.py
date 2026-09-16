"""测试用构造辅助。"""

from detexp.models import Experiment, ParameterSpec, Slice, Step


def make_pi(experiment_id: str = "pi", n: int = 1000,
            default_retries: int = 0, source: str = "local") -> Experiment:
    return Experiment(
        experiment_id=experiment_id,
        param_specs=[
            ParameterSpec("n", kind="int", default=n, required=False,
                          min=1, max=10_000_000)],
        values={"n": n},
        steps=[Step(
            "throw_darts", "pi_dart", params={"n": n},
            slices=[Slice("uniform", 2 * n,
                          {"low": 0.0, "high": 1.0})])],
        default_retries=default_retries, source=source)


def make_normal_mean(experiment_id: str = "nm", n: int = 100,
                     mean: float = 0.0, std: float = 1.0,
                     default_retries: int = 0) -> Experiment:
    return Experiment(
        experiment_id=experiment_id,
        param_specs=[
            ParameterSpec("n", kind="int", default=n, required=False,
                          min=2)],
        values={"n": n},
        steps=[Step(
            "sample", "normal_mean", params={"n": n},
            slices=[Slice("normal", n, {"mean": mean, "std": std})])],
        default_retries=default_retries)


def make_walk(experiment_id: str = "walk", n: int = 50, p: float = 0.5,
              bound=None, default_retries: int = 0) -> Experiment:
    params: dict = {"n": n}
    if bound is not None:
        params["bound"] = bound
    return Experiment(
        experiment_id=experiment_id, param_specs=[],
        steps=[Step(
            "walk", "bernoulli_walk", params=params,
            slices=[Slice("bernoulli", n, {"p": p})])],
        default_retries=default_retries)
