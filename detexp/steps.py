"""内置实验步骤函数。

每个步骤函数签名为 ``fn(ctx, params) -> JSON 可序列化结果``，
随机数只能从 ``ctx.window``（当前切片）取；需要多个切片的步骤用
``ctx.window(slice_index)`` 切换。步骤抛出的 :class:`StepFail` 会触发
重试；参数越界、数值溢出均用它报告。
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict


class StepFail(Exception):
    """步骤可重试失败（参数越界 / 数值溢出 / 显式触发）。"""

    def __init__(self, message: str, *, retryable: bool = True):
        super().__init__(message)
        self.retryable = retryable


class StepContext:
    """传给步骤函数的执行上下文。"""

    def __init__(self, windows, rng_seed: int, attempt: int):
        self._windows = windows
        self.seed = rng_seed
        self.attempt = attempt          # 0 表示首次，1+ 表示第几次重试
        self.shared: Dict[str, Any] = {}

    def window(self, slice_index: int = 0):
        if slice_index < 0 or slice_index >= len(self._windows):
            raise IndexError(f"切片下标 {slice_index} 越界 "
                             f"(共 {len(self._windows)} 个)")
        return self._windows[slice_index]


StepFn = Callable[[StepContext, Dict[str, Any]], Any]


# ---------------------------------------------------------------------------
# 蒙特卡洛：投点估计 pi
# ---------------------------------------------------------------------------

def pi_dart(ctx: StepContext, params: Dict[str, Any]) -> Dict[str, Any]:
    """用 unit square 投点，落在单位圆内的比例 * 4 估计 pi。"""
    w = ctx.window(0)
    n = int(params.get("n", w.count // 2))
    if n <= 0:
        raise StepFail(f"n 必须为正整数，收到 {n}", retryable=False)
    if 2 * n > w.count:
        raise StepFail(
            f"需要 2*n={2 * n} 个 uniform，切片仅 {w.count} 个",
            retryable=False)
    inside = 0
    for _ in range(n):
        x = w.draw()
        y = w.draw()
        if x * x + y * y <= 1.0:
            inside += 1
    estimate = 4.0 * inside / n
    if not math.isfinite(estimate):
        raise StepFail(f"估计值非有限数: {estimate}")
    return {"estimate": estimate, "n": n, "inside": inside}


# ---------------------------------------------------------------------------
# 蒙特卡洛：正态样本均值
# ---------------------------------------------------------------------------

def normal_mean(ctx: StepContext, params: Dict[str, Any]) -> Dict[str, Any]:
    """从 N(mu, sigma^2) 抽 n 个样本，返回样本均值。

    mu / sigma 取自切片声明的 draw_params（唯一来源），保证随机数解释
    方式与配置、持久化重算完全一致。
    """
    w = ctx.window(0)
    n = int(params.get("n", w.count))
    mu = float(w.params.get("mean", 0.0))
    sigma = float(w.params.get("std", 1.0))
    if n <= 1:
        raise StepFail(f"n 必须 >= 2，收到 {n}", retryable=False)
    if n > w.count:
        raise StepFail(f"需要 {n} 个 normal，切片仅 {w.count} 个",
                       retryable=False)
    s = 0.0
    for _ in range(n):
        s += w.draw()
    mean = s / n
    return {"estimate": mean, "n": n, "mu": mu, "sigma": sigma}


# ---------------------------------------------------------------------------
# 随机过程：伯努利随机游走
# ---------------------------------------------------------------------------

def bernoulli_walk(ctx: StepContext, params: Dict[str, Any]) -> Dict[str, Any]:
    """n 步 +/-1 对称（或 p 偏置）随机游走，返回终值/极值/路径摘要。"""
    w = ctx.window(0)
    n = int(params.get("n", w.count))
    p = float(w.params.get("p", 0.5))
    bound = params.get("bound")
    if n <= 0:
        raise StepFail(f"n 必须为正整数，收到 {n}", retryable=False)
    if not 0.0 <= p <= 1.0:
        raise StepFail(f"p 必须在 [0,1]，收到 {p}", retryable=False)
    if n > w.count:
        raise StepFail(f"需要 {n} 个 bernoulli，切片仅 {w.count} 个",
                       retryable=False)
    pos = 0
    lo = hi = 0
    crossings = 0
    for _ in range(n):
        bit = w.draw()
        pos += 1 if bit else -1
        lo = min(lo, pos)
        hi = max(hi, pos)
        if pos == 0:
            crossings += 1
        if bound is not None and abs(pos) > float(bound):
            # 参数越界：路径超出允许边界 → 触发（复用随机流的）重试
            raise StepFail(
                f"随机游走位置 |{pos}| 超过边界 {bound}（第 {w.pos} 步）")
    estimate = pos / n
    if not math.isfinite(estimate):
        raise StepFail("终值/n 非有限数")
    return {"estimate": estimate, "final": pos, "min": lo, "max": hi,
            "zero_crossings": crossings, "n": n, "p": p}


# ---------------------------------------------------------------------------
# 工具步骤：常数/算术，便于组合
# ---------------------------------------------------------------------------

def passthrough(ctx: StepContext, params: Dict[str, Any]) -> Any:
    return params.get("value")


# ---------------------------------------------------------------------------
# 专用：演示重试的步骤。
# 第一次尝试消费 fail_before 个 uniform 后抛错；当且仅当
# ctx.attempt >= succeed_on_attempt 时成功。每次尝试看到的随机数完全
# 相同（同一切片从头重放），因此可以断言“重试复用原有随机流”。
# ---------------------------------------------------------------------------

def flaky_retry(ctx: StepContext, params: Dict[str, Any]) -> Dict[str, Any]:
    w = ctx.window(0)
    fail_before = int(params.get("fail_before", 1))
    succeed_on = int(params.get("succeed_on_attempt", 1))
    overflow_after = params.get("overflow_after")
    seen = []
    for i in range(w.count):
        v = w.draw()
        seen.append(v)
        if overflow_after is not None and i + 1 == int(overflow_after):
            raise StepFail(
                f"模拟数值溢出：消费 {i + 1} 个随机量后结果溢出"
                f"（attempt={ctx.attempt}）")
        if ctx.attempt < succeed_on and i + 1 == fail_before:
            raise StepFail(
                f"模拟瞬时失败：第 {i + 1} 个随机量后失败"
                f"（attempt={ctx.attempt}，需 attempt>={succeed_on}）")
    return {"estimate": float(sum(seen) / len(seen)),
            "attempt_used": ctx.attempt, "first_draws": seen[:3],
            "consumed": len(seen)}


REGISTRY: Dict[str, StepFn] = {
    "pi_dart": pi_dart,
    "normal_mean": normal_mean,
    "bernoulli_walk": bernoulli_walk,
    "passthrough": passthrough,
    "flaky_retry": flaky_retry,
}


def register_step_fn(name: str, fn: StepFn) -> None:
    """注册自定义步骤函数（名称冲突会报错，不静默覆盖）。"""
    if name in REGISTRY:
        raise ValueError(f"步骤函数 {name!r} 已注册")
    REGISTRY[name] = fn


def get_step_fn(name: str) -> StepFn:
    if name not in REGISTRY:
        raise KeyError(f"未注册的步骤函数 {name!r}")
    return REGISTRY[name]
