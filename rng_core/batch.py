"""多种子批量运行与统计汇总。

对同一份实验配置在多个种子下独立运行（每次运行的随机流命名空间里都含有
种子，彼此天然隔离），汇总估计量的均值、样本方差与 t 置信区间，
并用稳健 z（中位数 + MAD）与经典 z 双口径标出偏离整体分布的种子，
同时给出可读原因。所有结果按种子数值升序返回，顺序稳定。

t 分位数由正则化不完全 Beta 函数反解（数值计算思路同 Numerical Recipes 的
betai/betacf），仅用标准库即可得到精确置信区间，无需 scipy。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field as dcfield
from typing import Any, Dict, List, Optional, Sequence

from .engine import Engine, RunResult
from .models import ExperimentSpec


# --------------------------------------------------------------------------- #
# t 分布分位数（无第三方依赖）
# --------------------------------------------------------------------------- #

def _betacf(a: float, b: float, x: float, itmax: int = 200,
            eps: float = 3.0e-12) -> float:
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < 1e-30:
        d = 1e-30
    d = 1.0 / d
    h = d
    for m in range(1, itmax + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < 1e-30:
            d = 1e-30
        c = 1.0 + aa / c
        if abs(c) < 1e-30:
            c = 1e-30
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """正则化不完全 Beta 函数 I_x(a, b)。"""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
    bt = math.exp(lbeta + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def _t_cdf(t: float, df: int) -> float:
    """Student t 分布的 CDF（利用与 Beta 分布的关系）。"""
    x = df / (df + t * t)
    p = 0.5 * _betai(df / 2.0, 0.5, x)
    return 1.0 - p if t > 0 else p


def t_quantile(prob: float, df: int) -> float:
    """双侧置信区间使用的上分位数：返回 P(T <= t)=prob 的 t。"""
    if df < 1:
        raise ValueError("自由度必须 >= 1")
    if not 0.0 < prob < 1.0:
        raise ValueError("prob 必须在 (0,1)")
    lo, hi = -100.0, 100.0
    for _ in range(100):
        mid = (lo + hi) / 2.0
        if _t_cdf(mid, df) < prob:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# --------------------------------------------------------------------------- #
# 汇总数据结构
# --------------------------------------------------------------------------- #

@dataclass
class EstimatorSpec:
    """估计量定位：某步骤输出中的某数值字段。"""
    name: str
    step_id: str
    field: str


@dataclass
class SeedRow:
    seed: int
    status: str
    value: Optional[float]
    robust_z: Optional[float] = None
    classic_z: Optional[float] = None
    is_outlier: bool = False
    reason: str = ""
    fingerprint: str = ""


@dataclass
class EstimatorSummary:
    estimator: str
    n: int
    step_id: str = ""
    field: str = ""
    mean: Optional[float] = None
    variance: Optional[float] = None
    std_error: Optional[float] = None
    confidence_level: Optional[float] = None
    ci_low: Optional[float] = None
    ci_high: Optional[float] = None
    median: Optional[float] = None
    mad: Optional[float] = None
    rows: List[SeedRow] = dcfield(default_factory=list)
    note: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "estimator": self.estimator,
            "step_id": self.step_id,
            "field": self.field,
            "n": self.n,
            "mean": self.mean,
            "variance": self.variance,
            "std_error": self.std_error,
            "confidence_level": self.confidence_level,
            "ci": [self.ci_low, self.ci_high],
            "median": self.median,
            "mad": self.mad,
            "note": self.note,
            "rows": [
                {
                    "seed": r.seed, "status": r.status, "value": r.value,
                    "robust_z": r.robust_z, "classic_z": r.classic_z,
                    "is_outlier": r.is_outlier, "reason": r.reason,
                    "fingerprint": r.fingerprint,
                }
                for r in self.rows
            ],
        }


@dataclass
class BatchReport:
    experiment_id: str
    seeds: List[int]
    parallel_seeds: bool
    summaries: List[EstimatorSummary]
    # 各种子的完整运行记录（供登记处补登，不进入 to_dict 的对外 JSON）。
    runs: Dict[int, "RunResult"] = dcfield(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "experiment_id": self.experiment_id,
            "seeds": self.seeds,
            "parallel_seeds": self.parallel_seeds,
            "summaries": [s.to_dict() for s in self.summaries],
        }


# --------------------------------------------------------------------------- #
# 批量运行
# --------------------------------------------------------------------------- #

class BatchRunner:
    def __init__(self, engine: Engine):
        self.engine = engine

    def run_batch(
        self,
        spec: ExperimentSpec,
        seeds: Sequence[int],
        estimators: Sequence[EstimatorSpec],
        param_values: Optional[Dict[str, Any]] = None,
        *,
        confidence_level: float = 0.95,
        parallel_seeds: bool = False,
        outlier_robust_cutoff: float = 3.5,
        outlier_classic_cutoff: float = 3.0,
    ) -> BatchReport:
        """在给定种子集合上运行并汇总。

        parallel_seeds 只影响不同种子之间的调度方式；每个种子内部是否并行
        由本模块额外覆盖（此处种子间相互独立，结果与顺序无关）。
        汇总时按种子升序排列，保证输出稳定。
        """
        if not seeds:
            raise ValueError("至少需要一个种子")
        if not estimators:
            raise ValueError("至少需要一个估计量")
        if not 0.0 < confidence_level < 1.0:
            raise ValueError("confidence_level 必须在 (0,1)")

        ordered_seeds = sorted(seeds)
        results: Dict[int, RunResult] = {}
        if parallel_seeds and len(ordered_seeds) > 1:
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(
                    max_workers=min(8, len(ordered_seeds))) as pool:
                futs = {
                    pool.submit(self.engine.run, spec, seed, param_values): seed
                    for seed in ordered_seeds
                }
                for f in concurrent.futures.as_completed(futs):
                    seed = futs[f]
                    results[seed] = f.result()
        else:
            for seed in ordered_seeds:
                results[seed] = self.engine.run(spec, seed, param_values)

        summaries = [
            self._summarize(spec, est, ordered_seeds, results,
                            confidence_level, outlier_robust_cutoff,
                            outlier_classic_cutoff)
            for est in estimators
        ]
        return BatchReport(
            experiment_id=spec.eid, seeds=ordered_seeds,
            parallel_seeds=parallel_seeds, summaries=summaries,
            runs=dict(results))

    # ---- 统计 ----------------------------------------------------------- #

    @staticmethod
    def _extract(run: RunResult, est: EstimatorSpec) -> Optional[float]:
        try:
            out = run.output_of(est.step_id)
        except KeyError:
            return None
        if est.field not in out:
            return None
        v = out[est.field]
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) \
            else None

    def _summarize(self, spec: ExperimentSpec, est: EstimatorSpec,
                   seeds: Sequence[int], results: Dict[int, RunResult],
                   level: float, robust_cut: float, classic_cut: float) \
            -> EstimatorSummary:
        rows: List[SeedRow] = []
        values: List[float] = []
        for seed in seeds:
            run = results[seed]
            value = self._extract(run, est) if run.status == "success" else None
            row = SeedRow(seed=seed, status=run.status, value=value,
                          fingerprint=run.fingerprint)
            if value is not None and math.isfinite(value):
                values.append(value)
            elif run.status != "success":
                row.reason = f"该种子运行失败（{run.steps[-1].error_category}），未参与统计"
            else:
                row.reason = f"估计量 {est.step_id}.{est.field} 缺失或非数值，未参与统计"
            rows.append(row)

        summary = EstimatorSummary(estimator=est.name, n=len(values), rows=rows,
                                   confidence_level=level,
                                   step_id=est.step_id, field=est.field)
        if not values:
            summary.note = "没有任何种子给出有效估计量，无法统计"
            return summary

        n = len(values)
        mean = sum(values) / n
        var = sum((x - mean) ** 2 for x in values) / (n - 1) if n > 1 else 0.0
        summary.mean, summary.variance = mean, var

        median = _percentile(sorted(values), 50)
        mad = _percentile(sorted(abs(x - median) for x in values), 50)
        summary.median, summary.mad = median, mad
        sd = math.sqrt(var)
        summary.std_error = sd / math.sqrt(n) if n > 1 else 0.0

        if n >= 2:
            df = n - 1
            tcrit = t_quantile(0.5 + level / 2.0, df)
            half = tcrit * summary.std_error
            summary.ci_low, summary.ci_high = mean - half, mean + half
        else:
            summary.note = "仅 1 个有效种子，无法构造置信区间"
            summary.ci_low = summary.ci_high = mean

        # 离群判定：优先稳健 z（MAD），退化时回退经典 z；两者都写入记录。
        for row in rows:
            if row.value is None:
                continue
            row.classic_z = (row.value - mean) / sd if sd > 0 else (
                0.0 if row.value == mean else math.inf)
            if mad > 0:
                row.robust_z = 0.6745 * (row.value - median) / mad
            flagged, why = _explain_outlier(
                row.value, mad, median, sd, mean, robust_cut, classic_cut)
            row.is_outlier = flagged
            row.reason = why
        return summary


def _percentile(sorted_values: Sequence[float], q: float) -> float:
    """线性插值分位数（与 numpy 默认 'linear' 口径一致）。"""
    if not sorted_values:
        raise ValueError("空序列")
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = (len(sorted_values) - 1) * q / 100.0
    lo = math.floor(pos)
    hi = math.ceil(pos)
    if lo == hi:
        return float(sorted_values[lo])
    frac = pos - lo
    return sorted_values[lo] * (1 - frac) + sorted_values[hi] * frac


def _explain_outlier(x: float, mad: float, median: float,
                     sd: float, mean: float,
                     robust_cut: float, classic_cut: float) -> tuple:
    """返回 (是否离群, 可读原因)。原因写清用了哪套基准、偏离多少。"""
    if mad > 0:
        rz = 0.6745 * (x - median) / mad
        if abs(rz) > robust_cut:
            direction = "偏高" if x > median else "偏低"
            return True, (
                f"稳健 z={rz:+.2f}，绝对值超过阈值 {robust_cut}："
                f"相对中位数 {median:.6g} {direction} {abs(x - median):.6g}"
                f"（MAD={mad:.6g}），偏离整体分布")
        return False, (
            f"稳健 z={rz:+.2f}，在阈值 ±{robust_cut} 内，"
            "与整体分布一致")
    # MAD=0：超过一半的种子取相同值，改用经典 z。
    if sd > 0:
        cz = (x - mean) / sd
        if abs(cz) > classic_cut:
            return True, (
                f"MAD=0（多数种子取值集中），改用经典 z={cz:+.2f}，"
                f"超过阈值 ±{classic_cut}：相对均值偏离 {abs(x - mean):.6g}")
        return False, f"MAD=0，经典 z={cz:+.2f}，在 ±{classic_cut} 内"
    if x == mean:
        return False, "所有种子取值完全相同，无偏离"
    return True, (
        f"所有其他种子取值均为 {mean:.6g}，该种子取 {x:.6g}，"
        "方差为 0 下仍出现偏离")
