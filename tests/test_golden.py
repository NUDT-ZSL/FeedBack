"""黄金值与跨进程确定性测试。

这些常量锁定 (golden, seed=12345, n=20) 在本算法版本下的精确结果。
SHA-256 计数器模式只依赖标准库中字节序严格规定的原语，因此任何机器、
任何 Python 3、任何执行顺序都必须得到同一指纹；一旦底层算法被改动，
这里会立即失败，防止"看似复现、实则悄悄变了"。
"""
import json
import os
import subprocess
import sys
import unittest

from rng_core import Registry, parse_experiment

GOLDEN_FINGERPRINT = "71538dc375ad0cd5785a2ab16c755f61c3ed1f491fd997741a6ab510cfc01058"
GOLDEN_OUTPUTS = {
    "u": {"n": 20, "mean": 0.058994548395555756,
          "variance": 1.2219819207798974,
          "min": -1.8891811754624954, "max": 1.531042823351802},
    "b": {"trials": 20, "successes": 5, "p_hat": 0.25},
    "i": {"n": 20, "sum": 76, "mean": 3.8, "min": 0, "max": 9},
}

WIRE = {
    "id": "golden",
    "source": "local",
    "seed_policy": {"mode": "fixed", "seed": 12345},
    "params": [{"name": "n", "type": "int", "default": 20, "min": 1}],
    "steps": [
        {"id": "u", "handler": "sample_mean",
         "draws": [{"id": "samples", "type": "uniform", "count": "$params.n",
                    "params": {"low": -2, "high": 2}}]},
        {"id": "b", "handler": "bernoulli_count",
         "draws": [{"id": "trials", "type": "bernoulli", "count": "$params.n",
                    "params": {"p": 0.3}}]},
        {"id": "i", "handler": "integer_sum",
         "draws": [{"id": "draws", "type": "integer", "count": "$params.n",
                    "params": {"low": 0, "high": 9}}]},
    ],
}


class TestGoldenValues(unittest.TestCase):
    def test_in_process_golden(self):
        reg = Registry()
        reg.register_experiment(parse_experiment(WIRE))
        r = reg.run("golden", 12345, parallel=True)
        self.assertEqual(r.fingerprint, GOLDEN_FINGERPRINT)
        for s in r.steps:
            self.assertEqual(s.output, GOLDEN_OUTPUTS[s.sid])

    def test_fingerprint_independent_of_execution_mode(self):
        reg = Registry()
        spec = parse_experiment(WIRE)
        for parallel in (False, True):
            r = reg.engine.run(spec, 12345, {}, parallel=parallel)
            self.assertEqual(r.fingerprint, GOLDEN_FINGERPRINT)

    def test_cross_process_golden(self):
        # 全新解释器进程必须给出同一指纹（跨进程/跨调用栈确定性）。
        code = (
            "import json,sys;"
            "sys.path.insert(0, %r);"
            "from rng_core import Registry, parse_experiment;"
            "wire=%r;"
            "reg=Registry();reg.register_experiment(parse_experiment(wire));"
            "r=reg.run('golden',12345);"
            "sys.stdout.write(r.fingerprint)"
        ) % (os.path.dirname(os.path.dirname(os.path.abspath(__file__))), WIRE)
        proc = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), GOLDEN_FINGERPRINT)


if __name__ == "__main__":
    unittest.main()
