"""多种子批量统计：均值、样本方差、t 置信区间、留一法离群检测。"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

from .models import BatchSummary, Experiment, OutlierInfo, RunRecord


def build_seed_list(experiment: Experiment,
                    seeds: Optional[Sequence[int]] = None) -> List[int]:
    """确定种子集合：显式传入 > seed_policy.sequence > fixed。"""
    if seeds is not None:
        out = [int(s) for s in seeds]
    else:
        pol = experiment.seed_policy or {}
        if pol.get("type") == "sequence":
            out = [int(s) for s in pol["seeds"]]
        elif pol.get("type") == "fixed":
            out = [int(pol["seed"])]
        else:
            raise ValueError("未提供 seeds，且实验没有 fixed/sequence 种子策略")
    if not out:
        raise ValueError("种子列表为空")
    if len(set(out)) != len(out):
        raise ValueError(f"种子列表存在重复: {out}")
    if any(s < 0 for s in out):
        raise ValueError("种子必须是非负整数")
    return list(out)


def mean_var(xs: Sequence[float]) -> Tuple[float, float]:
    n = len(xs)
    m = sum(xs) / n
    if n > 1:
        # 二阶矩中心化写法，数值稳定性可接受；再做一次校正
        var = sum((x - m) ** 2 for x in xs) / (n - 1)
        m2 = sum(xs) / n
        var = max(var, 0.0)
        return m2, var
    return m, 0.0


# ---------------------------------------------------------------------------
# Student-t 临界值：无需 scipy。用归一化不完全 Beta 的二分反解。
# ---------------------------------------------------------------------------

def _betacf(a: float, b: float, x: float) -> float:
    # Numerical Recipes 连分式
    MAXIT, EPS, FPMIN = 200, 3.0e-14, 1.0e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN:
            d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN:
            c = FPMIN
        d = 1.0 / d
        de = d * c
        h *= de
        if abs(de - 1.0) < EPS:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
             + a * math.log(x) + b * math.log1p(-x))
    bt = math.exp(lbeta)
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def t_sf_twosided_cdf(t: float, df: int) -> float:
    """双侧尾部概率 P(|T_df| >= |t|)。"""
    x = df / (df + t * t)
    return _betai(0.5 * df, 0.5, x)


def t_critical(df: int, level: float = 0.95) -> float:
    """学生 t 双侧临界值，df 为自由度。"""
    if df < 1:
        return math.inf
    alpha = 1.0 - level
    lo, hi = 0.0, 1.0
    while t_sf_twosided_cdf(hi, df) > alpha:
        hi *= 2.0
        if hi > 1e6:
            break
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if t_sf_twosided_cdf(mid, df) > alpha:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


# ---------------------------------------------------------------------------
# 批量分析
# ---------------------------------------------------------------------------

OUTLIER_Z = 2.5
MIN_OUTLIER_SEEDS = 3


def analyze_estimates(experiment_id: str, seeds: Sequence[int],
                      values: Dict[int, float], ci_level: float = 0.95,
                      z_threshold: float = OUTLIER_Z) -> BatchSummary:
    """对 ``seed -> 估计量`` 做汇总与留一法离群检测。

    离群判定：对每个种子用其余种子计算均值/样本标准差，若
    ``|x - mean_loo| / std_loo > z_threshold`` 则标记，并在 reason 中
    给出可读的偏离原因。
    """
    seed_list = sorted(seeds)
    est = {str(s): float(values[s]) for s in seed_list}
    xs = [values[s] for s in seed_list]
    n = len(seed_list)
    m, var = mean_var(xs)
    sd = math.sqrt(var)

    if n >= 2 and var > 0.0:
        tc = t_critical(n - 1, ci_level)
        half = tc * sd / math.sqrt(n)
        ci_low, ci_high = m - half, m + half
    elif n >= 2:
        ci_low = ci_high = m
    else:
        ci_low = ci_high = m

    outliers: List[OutlierInfo] = []
    if n >= MIN_OUTLIER_SEEDS:
        for idx, s in enumerate(seed_list):
            others = [x for j, x in enumerate(xs) if j != idx]
            mo, vo = mean_var(others)
            so = math.sqrt(vo)
            if so <= 0.0:
                if xs[idx] != mo:
                    z = math.inf
                else:
                    z = 0.0
            else:
                z = abs(xs[idx] - mo) / so
            if z > z_threshold:
                if math.isinf(z):
                    z_disp = math.inf
                    reason = (
                        f"种子 {s} 的结果 {xs[idx]!r} 与其余 {n - 1} 个种子"
                        f"的共同取值 {mo!r} 不同，而其余种子结果完全一致"
                        f"（留一法标准差为 0），属于唯一偏离点")
                else:
                    direction = "偏高" if xs[idx] > mo else "偏低"
                    z_disp = z
                    reason = (
                        f"种子 {s} 的结果 {xs[idx]:.6g} 相对其余 {n - 1} 个"
                        f"种子的均值 {mo:.6g}{direction} "
                        f"{abs(xs[idx] - mo):.3g}，留一法 z 分数 "
                        f"{z:.3f} 超过阈值 {z_threshold}；其余种子的样本"
                        f"标准差为 {so:.3g}")
                outliers.append(OutlierInfo(
                    seed=s, value=xs[idx], z_score=z_disp,
                    mean_without=mo, std_without=so,
                    threshold=z_threshold, reason=reason))

    return BatchSummary(
        experiment_id=experiment_id, ci_level=ci_level, seeds=seed_list,
        estimates=est, mean=m, variance=var, std=sd,
        ci_low=ci_low, ci_high=ci_high, outliers=outliers)


def runs_to_values(runs: Sequence[RunRecord]) -> Dict[int, float]:
    """从成功运行中提取 ``seed -> estimate``；失败或非数值估计会报错。"""
    out: Dict[int, float] = {}
    for r in runs:
        if r.status != "ok":
            raise ValueError(f"种子 {r.seed} 运行失败，无法纳入统计")
        if not isinstance(r.estimate, (int, float)) \
                or isinstance(r.estimate, bool):
            raise ValueError(
                f"种子 {r.seed} 的估计量不是数值: {r.estimate!r}")
        if not math.isfinite(r.estimate):
            raise ValueError(f"种子 {r.seed} 的估计量非有限数")
        out[r.seed] = float(r.estimate)
    return out
