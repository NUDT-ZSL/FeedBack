"""步骤处理器注册表与内置处理器。

处理器拿不到随机流本身，只能拿到引擎按声明**预先切好的**数组
（``ctx.draws[抽签id]``），因此它不可能多抽、少抽或偷看后续步骤的随机量。
处理器输出必须是可 JSON 化的 dict。

失败用 :class:`StepFailure` 抛出，携带类别（value_error / overflow /
invalid_param / unknown），引擎据此与步骤的 ``retry.retry_on`` 配置决定是否重试。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Dict, List


class StepFailure(Exception):
    """步骤执行失败。``category`` 决定它是否属于可重试类别。"""

    def __init__(self, message: str, category: str = "value_error",
                 detail: Any = None):
        super().__init__(message)
        self.category = category
        self.detail = detail


@dataclass
class StepContext:
    experiment_id: str
    seed: int
    step_index: int
    step_id: str
    attempt: int                       # 1 = 首次执行，2 = 第一次重试……
    params: Dict[str, Any]
    draws: Dict[str, List[float]]      # draw_id -> 恰好声明长度的随机数列表
    outputs: Dict[str, Dict[str, Any]] # 更早步骤 id -> 其输出


HandlerFn = Callable[[StepContext], Dict[str, Any]]


class HandlerRegistry:
    def __init__(self) -> None:
        self._handlers: Dict[str, HandlerFn] = {}

    def register(self, name: str, fn: HandlerFn) -> None:
        if not name or not isinstance(name, str):
            raise ValueError("处理器名必须是非空字符串")
        self._handlers[name] = fn

    def get(self, name: str) -> HandlerFn:
        if name not in self._handlers:
            raise KeyError(f"未注册的处理器 {name!r}，已注册：{sorted(self._handlers)}")
        return self._handlers[name]

    def names(self) -> List[str]:
        return sorted(self._handlers)

    def contains(self, name: str) -> bool:
        return name in self._handlers


# --------------------------------------------------------------------------- #
# 内置处理器
# --------------------------------------------------------------------------- #

def _require_draw(ctx: StepContext, draw_id: str) -> List[float]:
    if draw_id not in ctx.draws:
        raise StepFailure(
            f"处理器需要抽签 {draw_id!r}，但步骤未声明", "invalid_param")
    return ctx.draws[draw_id]


def _finite(value: float, what: str) -> float:
    if not math.isfinite(value):
        raise StepFailure(f"{what} 不是有限值（溢出或 NaN）", "overflow",
                          {"value": str(value)})
    return value


def h_sample_mean(ctx: StepContext) -> Dict[str, Any]:
    """蒙特卡洛样本均值：消耗一组 uniform/gaussian 等连续样本。"""
    xs = _require_draw(ctx, "samples")
    n = len(xs)
    mean = sum(xs) / n
    _finite(mean, "样本均值")
    if n > 1:
        var = sum((x - mean) ** 2 for x in xs) / (n - 1)
    else:
        var = 0.0
    _finite(var, "样本方差")
    return {
        "n": n,
        "mean": mean,
        "variance": var,
        "min": min(xs),
        "max": max(xs),
    }


def h_bernoulli_count(ctx: StepContext) -> Dict[str, Any]:
    """伯努利计数：成功次数与成功频率。"""
    xs = [int(v) for v in _require_draw(ctx, "trials")]
    n = len(xs)
    k = sum(xs)
    return {"trials": n, "successes": k, "p_hat": k / n}


def h_integer_sum(ctx: StepContext) -> Dict[str, Any]:
    xs = [int(v) for v in _require_draw(ctx, "draws")]
    n = len(xs)
    s = sum(xs)
    return {"n": n, "sum": s, "mean": s / n, "min": min(xs), "max": max(xs)}


def h_gaussian_walk(ctx: StepContext) -> Dict[str, Any]:
    """对称随机游走：从 start 出发累加 gaussian 增量。"""
    inc = _require_draw(ctx, "increments")
    pos = float(ctx.params.get("start", 0.0))
    lo = hi = pos
    for d in inc:
        pos += d
        lo = min(lo, pos)
        hi = max(hi, pos)
    _finite(pos, "游走终点")
    return {"end": pos, "path_min": lo, "path_max": hi, "steps": len(inc)}


def h_combine(ctx: StepContext) -> Dict[str, Any]:
    """跨步骤组合：演示 $steps.<id>.<field> 引用（如估计量之差）。"""
    a = ctx.params.get("a")
    b = ctx.params.get("b")
    if a is None or b is None:
        raise StepFailure("combine 需要参数 a 与 b（通常引用更早步骤输出）",
                          "invalid_param")
    a, b = float(a), float(b)
    return {"sum": _finite(a + b, "sum"),
            "diff": _finite(a - b, "diff"),
            "abs_diff": abs(a - b)}


def h_flaky_overflow(ctx: StepContext) -> Dict[str, Any]:
    """模拟带瞬时数值故障的外部例程：前 ``fail_first_n`` 次调用溢出失败。

    用于离线验收重试机制：引擎每次重试都倒回该步骤自己的随机流，
    因此第 N 次成功时所用随机数与首次完全相同，且后续步骤的流原封不动。
    """
    fail_first_n = int(ctx.params.get("fail_first_n", 0))
    if ctx.attempt <= fail_first_n:
        raise StepFailure(
            f"第 {ctx.attempt} 次执行模拟数值溢出（配置要求前 "
            f"{fail_first_n} 次失败）",
            category="overflow",
            detail={"attempt": ctx.attempt, "fail_first_n": fail_first_n},
        )
    xs = _require_draw(ctx, "samples")
    n = len(xs)
    # 用平方和模拟可能溢出的计算；极端值时如实报 overflow（同样可触发重试策略）。
    s2 = sum(x * x for x in xs)
    _finite(s2, "平方和")
    mean = sum(xs) / n
    return {"n": n, "mean": mean, "sum_squares": s2,
            "succeeded_on_attempt": ctx.attempt}


def build_default_registry() -> HandlerRegistry:
    reg = HandlerRegistry()
    reg.register("sample_mean", h_sample_mean)
    reg.register("bernoulli_count", h_bernoulli_count)
    reg.register("integer_sum", h_integer_sum)
    reg.register("gaussian_walk", h_gaussian_walk)
    reg.register("combine", h_combine)
    reg.register("flaky_overflow", h_flaky_overflow)
    return reg
