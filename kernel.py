"""限流熔断内核（纯 Python 标准库实现）。

本模块提供四个可离线运行、可单测的组件：

* :class:`FakeClock` —— 可注入、可手动推进的逻辑时钟，单调不回退；
* :class:`SlidingWindowRateLimiter` —— 真正的滑动窗口计数限流器，
  按事件时间戳淘汰，窗口边界不会出现固定窗口的两倍突发；
* :class:`CircuitBreaker` —— 按连续失败数 / 滑动窗口失败率熔断，
  支持 open → half_open → closed 探测恢复、指数退避（含上限）、
  恢复后观察期快速重新熔断；
* :class:`Guard` —— 把限流器与熔断器组合成一道闸门，先限流后熔断，
  两边统计互不污染，并负责整体快照的 ``save`` / ``load``。

所有时间一律由注入的逻辑时钟提供，模块内不接触真实时钟与网络。
"""

from __future__ import annotations

import json
import os
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, List, Optional, Tuple, Union

__all__ = [
    "FakeClock",
    "SlidingWindowRateLimiter",
    "CircuitBreaker",
    "Guard",
    "SnapshotError",
    "STATE_CLOSED",
    "STATE_OPEN",
    "STATE_HALF_OPEN",
]

STATE_CLOSED = "closed"
STATE_OPEN = "open"
STATE_HALF_OPEN = "half_open"
_VALID_STATES = frozenset({STATE_CLOSED, STATE_OPEN, STATE_HALF_OPEN})

# 熔断器构造参数中必须持久化、载入时不允许缺失的字段。
_BREAKER_CONFIG_KEYS = (
    "window_length",
    "failure_rate_threshold",
    "min_samples",
    "consecutive_failure_threshold",
    "cooldown_duration",
    "half_open_max_calls",
    "backoff_strategy",
    "backoff_multiplier",
    "max_cooldown",
    "observation_window",
    "fast_open_multiplier",
)

Number = Union[int, float]


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class SnapshotError(ValueError):
    """快照文件损坏、字段缺失或一致性校验失败时抛出。"""


# ---------------------------------------------------------------------------
# 逻辑时钟
# ---------------------------------------------------------------------------


class FakeClock:
    """手动推进的逻辑时钟。

    时间从 ``start``（默认 0）开始，只能通过 :meth:`tick` 向前推进，
    不允许回退。内核中所有“当前时间”都从这里读取，从而可以在测试中
    精确控制窗口滑动与冷却到期。
    """

    def __init__(self, start: Number = 0) -> None:
        if not self._is_number(start) or start < 0:
            raise ValueError("时钟起始时间必须是非负数")
        self._now: float = float(start)

    @staticmethod
    def _is_number(value: Any) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    def now(self) -> float:
        """返回当前逻辑时间（浮点秒）。"""
        return self._now

    def tick(self, delta: Number = 1) -> float:
        """把时钟向前推进 ``delta`` 个时间单位并返回新的当前时间。

        ``delta`` 必须是非负数；传 0 是合法的（用于验证时钟不推进时
        重复调用的行为），传负数会抛出 :class:`ValueError`。
        """
        if not self._is_number(delta) or delta < 0:
            raise ValueError("时钟只能向前推进，delta 必须是非负数")
        self._now += float(delta)
        return self._now

    def set_now(self, value: Number) -> None:
        """直接设置绝对时间，仅用于快照恢复；目标时间不得早于当前时间。"""
        if not self._is_number(value) or value < 0:
            raise ValueError("时钟时间必须是非负数")
        if value < self._now:
            raise ValueError(
                f"逻辑时钟不能回退：当前 {self._now}，目标 {value}"
            )
        self._now = float(value)


# ---------------------------------------------------------------------------
# 滑动窗口限流器
# --------------------------------------------------------------------------


@dataclass
class _LimiterState:
    """单个 key 的限流窗口状态：窗口内 (时间戳, cost) 事件队列。"""

    events: Deque[Tuple[float, int]]

    def to_dict(self) -> Dict[str, Any]:
        return {"events": [{"t": t, "cost": c} for t, c in self.events]}


class SlidingWindowRateLimiter:
    """滑动窗口计数限流器。

    维护长度为 ``window_length`` 的时间窗口，窗口内所有已放行请求的
    ``cost`` 之和不得超过 ``rate_limit``。窗口随逻辑时钟连续滑动：
    每次请求都淘汰 ``now - window_length`` 之前（不含边界）的事件，
    因此在窗口边界处最多允许 ``rate_limit`` 个请求，不会像固定窗口
    那样出现两倍突发。

    边界语义：时刻 ``t`` 放行的事件在半开区间 ``(t, t + window_length]``
    之外失效，即事件在 ``t + window_length`` 时刻恰好过期。
    """

    def __init__(
        self,
        window_length: Number,
        rate_limit: int,
        clock: FakeClock,
    ) -> None:
        if not FakeClock._is_number(window_length) or window_length <= 0:
            raise ValueError("window_length 必须是正数，不能为 0 或负数")
        if not isinstance(rate_limit, int) or isinstance(rate_limit, bool):
            raise ValueError("rate_limit 必须是正整数")
        if rate_limit <= 0:
            raise ValueError("rate_limit 必须是正整数")
        self.window_length: float = float(window_length)
        self.rate_limit: int = int(rate_limit)
        self._clock = clock
        self._states: Dict[str, _LimiterState] = {}

    # -- 内部工具 -----------------------------------------------------------

    @staticmethod
    def _validate_key(key: Any) -> str:
        if not isinstance(key, str) or key == "":
            raise ValueError("key 必须是非空字符串")
        return key

    @staticmethod
    def _validate_cost(cost: Any) -> int:
        if not isinstance(cost, int) or isinstance(cost, bool):
            raise ValueError("cost 必须是正整数")
        if cost <= 0:
            raise ValueError("cost 必须是正整数，不能为 0 或负数")
        return int(cost)

    def _state(self, key: str) -> _LimiterState:
        st = self._states.get(key)
        if st is None:
            st = _LimiterState(events=deque())
            self._states[key] = st
        return st

    def _evict(self, st: _LimiterState, now: float) -> None:
        """淘汰严格早于 ``now - window_length`` 的事件。"""
        boundary = now - self.window_length
        while st.events and st.events[0][0] <= boundary:
            st.events.popleft()

    def _current_usage(self, key: str) -> int:
        st = self._state(key)
        self._evict(st, self._clock.now())
        return sum(cost for _, cost in st.events)

    # -- 对外 API -----------------------------------------------------------

    def reserve(self, key: str, cost: int = 1) -> Dict[str, Any]:
        """非提交式容量检查：只判断能否放行，不把本次请求计入窗口。

        供 :class:`Guard` 在“限流通过但熔断拒绝”时回滚使用，从而保证
        熔断拒绝不消耗限流配额。返回结构与 :meth:`allow` 一致，
        放行时额外携带 ``"_commit": [时间戳, cost]`` 供 :meth:`commit` 使用。
        """
        key = self._validate_key(key)
        cost = self._validate_cost(cost)
        now = self._clock.now()
        st = self._state(key)
        self._evict(st, now)

        used = sum(c for _, c in st.events)
        if cost > self.rate_limit:
            return {
                "allowed": False,
                "key": key,
                "reason": "cost_exceeds_limit",
                "rejected_by": "rate_limiter",
                "retry_after": None,
                "message": (
                    f"单次 cost={cost} 超过窗口阈值 {self.rate_limit}，永远无法放行"
                ),
                "window_length": self.window_length,
                "limit": self.rate_limit,
                "current": used,
                "now": now,
            }

        if used + cost > self.rate_limit:
            # 等待最老的若干个事件逐个过期，直到腾出 cost 个容量。
            need = used + cost - self.rate_limit
            freed = 0
            retry_at: Optional[float] = None
            for ts, c in st.events:
                freed += c
                if freed >= need:
                    retry_at = ts + self.window_length
                    break
            retry_after: Optional[float] = (
                max(0.0, retry_at - now) if retry_at is not None else None
            )
            return {
                "allowed": False,
                "key": key,
                "reason": "rate_limited",
                "rejected_by": "rate_limiter",
                "retry_after": retry_after,
                "message": (
                    f"窗口内已用 {used}/{self.rate_limit}，"
                    f"至少等待 {retry_after} 时间单位"
                ),
                "window_length": self.window_length,
                "limit": self.rate_limit,
                "current": used,
                "now": now,
            }

        return {
            "allowed": True,
            "key": key,
            "rejected_by": None,
            "current": used + cost,
            "remaining": self.rate_limit - used - cost,
            "window_length": self.window_length,
            "limit": self.rate_limit,
            "now": now,
            "_commit": (now, cost),
        }

    def commit(self, key: str, cost: int, timestamp: Number) -> None:
        """把一次此前通过 :meth:`reserve` 检查的请求正式计入窗口。"""
        key = self._validate_key(key)
        cost = self._validate_cost(cost)
        if not FakeClock._is_number(timestamp) or timestamp < 0:
            raise ValueError("timestamp 必须是非负数")
        self._state(key).events.append((float(timestamp), cost))

    def allow(self, key: str, cost: int = 1) -> Dict[str, Any]:
        """判断 ``key`` 的一次请求（权重 ``cost``）能否放行并计入窗口。

        放行时把本次请求计入窗口；超限时不计数。返回字典：

        * 放行：``{"allowed": True, "current": 窗口内已用量, ...}``
        * 拒绝：``{"allowed": False, "reason": "rate_limited",
          "retry_after": 最早多久后有足够容量, "rejected_by":
          "rate_limiter"}``
        """
        decision = self.reserve(key, cost)
        if decision.get("allowed"):
            ts, c = decision.pop("_commit")
            self.commit(key, c, ts)
        return decision

    def reset(self, key: str) -> None:
        """清空 ``key`` 的窗口计数。"""
        key = self._validate_key(key)
        self._states.pop(key, None)

    def keys(self) -> List[str]:
        """返回当前有计数的 key 列表。"""
        return list(self._states.keys())

    def get_stats(self, key: Optional[str] = None) -> Dict[str, Any]:
        """返回限流统计。

        传入 ``key`` 时直接返回该 key 的统计字典；不传时返回
        ``{key: stats}`` 的全量字典。
        """
        single = key is not None
        if key is not None:
            key = self._validate_key(key)
            keys = [key]
        else:
            keys = list(self._states.keys())
        result: Dict[str, Any] = {}
        now = self._clock.now()
        for k in keys:
            st = self._state(k)
            self._evict(st, now)
            used = sum(c for _, c in st.events)
            result[k] = {
                "window_length": self.window_length,
                "limit": self.rate_limit,
                "current": used,
                "remaining": max(0, self.rate_limit - used),
                "events": len(st.events),
                "oldest": st.events[0][0] if st.events else None,
                "now": now,
            }
        return result[key] if single else result


# ---------------------------------------------------------------------------
# 熔断器
# ---------------------------------------------------------------------------


@dataclass
class _BreakerState:
    """单个 key 的熔断状态机数据。"""

    state: str = STATE_CLOSED
    # open / half_open 期间有效
    opened_at: Optional[float] = None
    cooldown_end: Optional[float] = None
    current_cooldown: float = 0.0
    # closed 期间滑动统计窗口
    successes: Optional[Deque[float]] = None
    failures: Optional[Deque[float]] = None
    consecutive_failures: int = 0
    # half_open 期间探测计数
    half_open_calls: int = 0
    half_open_successes: int = 0
    half_open_failures: int = 0
    last_probe_at: Optional[float] = None
    # 自适应恢复
    observation_until: Optional[float] = None
    fast_open: bool = False
    # 最近一次评估的失败率（便于观测）
    last_failure_rate: float = 0.0


class CircuitBreaker:
    """熔断器（closed / open / half_open 三态）。

    触发打开（:meth:`record_failure` 时评估）满足任一条件：

    1. 连续失败数达到 ``consecutive_failure_threshold``；
    2. 长度 ``window_length`` 的统计窗口内样本数
       ``successes + failures >= min_samples``，且失败率
       ``failures / total >= failure_rate_threshold``（含等于）。

    打开后经过 ``cooldown_duration`` 冷却期，下一次 :meth:`allow`
    自动进入半开状态。半开最多放行 ``half_open_max_calls`` 个探测：
    任一探测失败立即重新打开并按退避策略延长冷却；全部探测成功则
    关闭熔断、清零统计并进入观察期。

    退避策略：

    * ``"fixed"``：冷却期固定；
    * ``"exponential"``：每次探测失败重新打开，冷却期乘
      ``backoff_multiplier``，上限 ``max_cooldown``。

    观察期：恢复后的 ``observation_window`` 内若再次超标，冷却期按
    ``fast_open_multiplier`` 缩短，更快重新打开；冷却期永远不会超过
    ``max_cooldown``。
    """

    def __init__(
        self,
        clock: FakeClock,
        window_length: Number = 10.0,
        failure_rate_threshold: float = 0.5,
        min_samples: int = 5,
        consecutive_failure_threshold: int = 5,
        cooldown_duration: Number = 5.0,
        half_open_max_calls: int = 1,
        backoff_strategy: str = "exponential",
        backoff_multiplier: float = 2.0,
        max_cooldown: Number = 60.0,
        observation_window: Number = 30.0,
        fast_open_multiplier: float = 0.5,
    ) -> None:
        self._clock = clock
        self._validate_config(
            window_length=window_length,
            failure_rate_threshold=failure_rate_threshold,
            min_samples=min_samples,
            consecutive_failure_threshold=consecutive_failure_threshold,
            cooldown_duration=cooldown_duration,
            half_open_max_calls=half_open_max_calls,
            backoff_strategy=backoff_strategy,
            backoff_multiplier=backoff_multiplier,
            max_cooldown=max_cooldown,
            observation_window=observation_window,
            fast_open_multiplier=fast_open_multiplier,
        )
        self.window_length: float = float(window_length)
        self.failure_rate_threshold: float = float(failure_rate_threshold)
        self.min_samples: int = int(min_samples)
        self.consecutive_failure_threshold: int = int(
            consecutive_failure_threshold
        )
        self.cooldown_duration: float = float(cooldown_duration)
        self.half_open_max_calls: int = int(half_open_max_calls)
        self.backoff_strategy: str = backoff_strategy
        self.backoff_multiplier: float = float(backoff_multiplier)
        self.max_cooldown: float = float(max_cooldown)
        self.observation_window: float = float(observation_window)
        self.fast_open_multiplier: float = float(fast_open_multiplier)
        self._states: Dict[str, _BreakerState] = {}

    # -- 校验 ---------------------------------------------------------------

    @staticmethod
    def _validate_config(**cfg: Any) -> None:
        def num(name: str, value: Any) -> float:
            if not FakeClock._is_number(value):
                raise ValueError(f"{name} 必须是数值类型")
            return float(value)

        wl = num("window_length", cfg["window_length"])
        if wl <= 0:
            raise ValueError("window_length 必须是正数，不能为 0")

        frt = num("failure_rate_threshold", cfg["failure_rate_threshold"])
        if not (0.0 < frt <= 1.0):
            raise ValueError("failure_rate_threshold 必须在 (0, 1] 区间内")

        for name in ("min_samples", "consecutive_failure_threshold",
                     "half_open_max_calls"):
            v = cfg[name]
            if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
                raise ValueError(f"{name} 必须是正整数")

        cd = num("cooldown_duration", cfg["cooldown_duration"])
        if cd < 0:
            raise ValueError("cooldown_duration 不能为负数")

        strategy = cfg["backoff_strategy"]
        if strategy not in ("fixed", "exponential"):
            raise ValueError("backoff_strategy 只能是 'fixed' 或 'exponential'")

        mult = num("backoff_multiplier", cfg["backoff_multiplier"])
        if mult < 1.0:
            raise ValueError("exponential 退避的 backoff_multiplier 必须 >= 1")

        mx = num("max_cooldown", cfg["max_cooldown"])
        if mx < 0:
            raise ValueError("max_cooldown 必须非负（冷却期会被钳到该上限）")

        ow = num("observation_window", cfg["observation_window"])
        if ow <= 0:
            raise ValueError("observation_window 必须是正数")

        fm = num("fast_open_multiplier", cfg["fast_open_multiplier"])
        if not (0.0 < fm <= 1.0):
            raise ValueError("fast_open_multiplier 必须在 (0, 1] 区间内")

    @staticmethod
    def _validate_key(key: Any) -> str:
        if not isinstance(key, str) or key == "":
            raise ValueError("key 必须是非空字符串")
        return key

    @staticmethod
    def _validate_cost(cost: Any) -> int:
        if not isinstance(cost, int) or isinstance(cost, bool):
            raise ValueError("cost 必须是正整数")
        if cost <= 0:
            raise ValueError("cost 必须是正整数，不能为 0 或负数")
        return int(cost)

    # -- 状态存取 -----------------------------------------------------------

    def _state(self, key: str) -> _BreakerState:
        st = self._states.get(key)
        if st is None:
            st = _BreakerState(
                successes=deque(),
                failures=deque(),
                current_cooldown=self.cooldown_duration,
            )
            self._states[key] = st
        return st

    def _evict_window(self, st: _BreakerState, now: float) -> None:
        boundary = now - self.window_length
        assert st.successes is not None and st.failures is not None
        while st.successes and st.successes[0] <= boundary:
            st.successes.popleft()
        while st.failures and st.failures[0] <= boundary:
            st.failures.popleft()

    def _failure_rate(self, st: _BreakerState, now: float) -> Tuple[float, int, int]:
        self._evict_window(st, now)
        assert st.successes is not None and st.failures is not None
        succ = len(st.successes)
        fail = len(st.failures)
        total = succ + fail
        rate = (fail / total) if total else 0.0
        st.last_failure_rate = rate
        return rate, succ, fail

    # -- 状态迁移 -----------------------------------------------------------

    def _enter_open(self, st: _BreakerState, now: float,
                    cooldown: Optional[float] = None) -> None:
        if cooldown is None:
            cooldown = st.current_cooldown if st.current_cooldown > 0 \
                else self.cooldown_duration
        cooldown = min(max(0.0, float(cooldown)), self.max_cooldown)
        st.state = STATE_OPEN
        st.opened_at = now
        st.current_cooldown = cooldown
        st.cooldown_end = now + cooldown
        st.half_open_calls = 0
        st.half_open_successes = 0
        st.half_open_failures = 0

    def _enter_half_open(self, st: _BreakerState, now: float) -> None:
        st.state = STATE_HALF_OPEN
        st.half_open_calls = 0
        st.half_open_successes = 0
        st.half_open_failures = 0

    def _enter_closed(self, st: _BreakerState, now: float) -> None:
        st.state = STATE_CLOSED
        st.opened_at = None
        st.cooldown_end = None
        st.current_cooldown = self.cooldown_duration
        st.successes = deque()
        st.failures = deque()
        st.consecutive_failures = 0
        st.half_open_calls = 0
        st.half_open_successes = 0
        st.half_open_failures = 0
        st.last_probe_at = None
        # 恢复后保留一段观察期，期内再次超标更快重新打开。
        st.observation_until = now + self.observation_window
        st.fast_open = False

    def _maybe_auto_transition(self, st: _BreakerState, now: float) -> None:
        """冷却到期后 open -> half_open（惰性迁移）。"""
        if st.state == STATE_OPEN and st.cooldown_end is not None:
            if now >= st.cooldown_end:
                self._enter_half_open(st, now)

    def _next_cooldown_after_probe_failure(
        self, st: _BreakerState, now: float
    ) -> float:
        """探测失败重新打开时的冷却时长（含退避与上限）。"""
        if self.backoff_strategy == "fixed":
            return min(st.current_cooldown, self.max_cooldown)
        backed_off = st.current_cooldown * self.backoff_multiplier
        if backed_off <= 0:  # cooldown 配置为 0 的退化情况
            backed_off = self.cooldown_duration
        return min(backed_off, self.max_cooldown)

    # -- 对外 API -----------------------------------------------------------

    def allow(self, key: str, cost: int = 1) -> Dict[str, Any]:
        """判断 ``key`` 的一次调用能否通过熔断闸门。

        * closed：放行；
        * open：直接拒绝（不真正执行），冷却到期时惰性切到 half_open；
        * half_open：探测名额未满则放行一个探测，否则拒绝。

        ``cost`` 仅为与限流器保持一致的 API 形状（熔断器不按权重计数），
        但同样要求正整数。
        """
        key = self._validate_key(key)
        self._validate_cost(cost)
        now = self._clock.now()
        st = self._state(key)
        self._maybe_auto_transition(st, now)

        if st.state == STATE_CLOSED:
            return {
                "allowed": True,
                "key": key,
                "state": STATE_CLOSED,
                "rejected_by": None,
                "probe": False,
                "retry_after": 0.0,
                "now": now,
            }

        if st.state == STATE_OPEN:
            return {
                "allowed": False,
                "key": key,
                "state": STATE_OPEN,
                "reason": "circuit_open",
                "rejected_by": "circuit_breaker",
                "retry_after": max(0.0, (st.cooldown_end or now) - now),
                "next_probe_at": st.cooldown_end,
                "probe": False,
                "now": now,
            }

        # half_open
        if st.half_open_calls >= self.half_open_max_calls:
            return {
                "allowed": False,
                "key": key,
                "state": STATE_HALF_OPEN,
                "reason": "half_open_probe_limit",
                "rejected_by": "circuit_breaker",
                "retry_after": None,
                "next_probe_at": None,
                "probe": False,
                "message": (
                    f"半开探测名额已满（{self.half_open_max_calls}），"
                    "请先通过 success/failure 终结探测"
                ),
                "now": now,
            }

        st.half_open_calls += 1
        st.last_probe_at = now
        return {
            "allowed": True,
            "key": key,
            "state": STATE_HALF_OPEN,
            "rejected_by": None,
            "probe": True,
            "probe_index": st.half_open_calls,
            "retry_after": 0.0,
            "now": now,
        }

    def record_success(self, key: str) -> Dict[str, Any]:
        """记录 ``key`` 的一次调用成功。

        * closed：计入统计窗口并把连续失败数清零；
        * half_open：计一次探测成功；全部探测成功才关闭熔断并清零统计；
        * open：理论上不应发生（open 不放行），收到时忽略且不改状态。
        """
        key = self._validate_key(key)
        now = self._clock.now()
        st = self._state(key)
        self._maybe_auto_transition(st, now)

        if st.state == STATE_OPEN:
            return {"key": key, "state": STATE_OPEN, "recorded": False,
                    "message": "open 状态不放行调用，成功结果已忽略", "now": now}

        if st.state == STATE_HALF_OPEN:
            outstanding = (
                st.half_open_calls - st.half_open_successes - st.half_open_failures
            )
            if outstanding <= 0:
                # 没有尚未结案的探测：忽略，避免探测结果数超过放行数。
                return {
                    "key": key,
                    "state": STATE_HALF_OPEN,
                    "recorded": False,
                    "message": "没有尚未结案的探测请求，请先 allow 再上报结果",
                    "now": now,
                }
            st.half_open_successes += 1
            if st.half_open_successes >= self.half_open_max_calls:
                self._enter_closed(st, now)
                return {"key": key, "state": STATE_CLOSED, "recorded": True,
                        "transition": "half_open->closed",
                        "observation_until": st.observation_until, "now": now}
            return {
                "key": key,
                "state": STATE_HALF_OPEN,
                "recorded": True,
                "probe_successes": st.half_open_successes,
                "probe_required": self.half_open_max_calls,
                "now": now,
            }

        # closed
        assert st.successes is not None
        st.successes.append(now)
        st.consecutive_failures = 0
        rate, succ, fail = self._failure_rate(st, now)
        # 观察期在获得新的成功样本后自然延续/到期检查。
        if st.observation_until is not None and now >= st.observation_until:
            st.observation_until = None
            st.fast_open = False
        return {"key": key, "state": STATE_CLOSED, "recorded": True,
                "successes": succ, "failures": fail, "failure_rate": rate,
                "now": now}

    def record_failure(self, key: str) -> Dict[str, Any]:
        """记录 ``key`` 的一次调用失败。

        * closed：计入窗口，按连续失败数 / 失败率评估是否打开；
          观察期内超标时按 ``fast_open_multiplier`` 缩短冷却；
        * half_open：探测失败，立即重新打开并延长冷却期（fixed 保持，
          exponential 乘倍数，均受 ``max_cooldown`` 上限约束）；
        * open：忽略（open 期间调用根本没有执行）。
        """
        key = self._validate_key(key)
        now = self._clock.now()
        st = self._state(key)
        self._maybe_auto_transition(st, now)

        if st.state == STATE_OPEN:
            return {"key": key, "state": STATE_OPEN, "recorded": False,
                    "message": "open 状态不放行调用，失败结果已忽略", "now": now}

        if st.state == STATE_HALF_OPEN:
            outstanding = (
                st.half_open_calls - st.half_open_successes - st.half_open_failures
            )
            if outstanding <= 0:
                return {
                    "key": key,
                    "state": STATE_HALF_OPEN,
                    "recorded": False,
                    "message": "没有尚未结案的探测请求，请先 allow 再上报结果",
                    "now": now,
                }
            st.half_open_failures += 1
            cooldown = self._next_cooldown_after_probe_failure(st, now)
            self._enter_open(st, now, cooldown=cooldown)
            return {
                "key": key,
                "state": STATE_OPEN,
                "recorded": True,
                "transition": "half_open->open",
                "cooldown": st.current_cooldown,
                "cooldown_end": st.cooldown_end,
                "backoff": self.backoff_strategy,
                "now": now,
            }

        # closed
        assert st.failures is not None
        st.failures.append(now)
        st.consecutive_failures += 1
        rate, succ, fail = self._failure_rate(st, now)
        total = succ + fail

        hit_consecutive = st.consecutive_failures >= self.consecutive_failure_threshold
        hit_rate = (
            total >= self.min_samples and rate >= self.failure_rate_threshold
        )
        if not (hit_consecutive or hit_rate):
            return {
                "key": key,
                "state": STATE_CLOSED,
                "recorded": True,
                "tripped": False,
                "successes": succ,
                "failures": fail,
                "failure_rate": rate,
                "consecutive_failures": st.consecutive_failures,
                "now": now,
            }

        # 观察期内再次超标：更快重新打开。
        in_observation = (
            st.observation_until is not None and now < st.observation_until
        )
        if in_observation:
            cooldown = min(
                self.max_cooldown,
                max(0.0, self.cooldown_duration * self.fast_open_multiplier),
            )
            st.fast_open = True
        else:
            cooldown = self.cooldown_duration
            if st.observation_until is not None and now >= st.observation_until:
                st.observation_until = None
        self._enter_open(st, now, cooldown=cooldown)
        return {
            "key": key,
            "state": STATE_OPEN,
            "recorded": True,
            "tripped": True,
            "transition": "closed->open",
            "trigger": (
                "consecutive_failures" if hit_consecutive else "failure_rate"
            ),
            "successes": succ,
            "failures": fail,
            "failure_rate": rate,
            "cooldown": st.current_cooldown,
            "cooldown_end": st.cooldown_end,
            "fast_open": st.fast_open,
            "now": now,
        }

    def get_state(self, key: str) -> Dict[str, Any]:
        """返回 ``key`` 的完整状态快照。

        包含：``state``、窗口内 ``successes`` / ``failures`` 数、
        ``failure_rate``、``next_probe_at``（下一次可探测时间，
        closed 时为 None）、连续失败数、冷却期等观测字段。
        调用本身会驱动 open -> half_open 的惰性迁移。
        """
        key = self._validate_key(key)
        now = self._clock.now()
        st = self._state(key)
        self._maybe_auto_transition(st, now)
        rate, succ, fail = self._failure_rate(st, now)

        in_observation = (
            st.observation_until is not None and now < st.observation_until
        )
        return {
            "key": key,
            "state": st.state,
            "successes": succ,
            "failures": fail,
            "failure_rate": rate,
            "consecutive_failures": st.consecutive_failures,
            "opened_at": st.opened_at,
            "cooldown": st.current_cooldown if st.state != STATE_CLOSED else None,
            "cooldown_end": st.cooldown_end if st.state != STATE_CLOSED else None,
            "next_probe_at": (
                st.cooldown_end if st.state == STATE_OPEN else None
            ),
            "half_open_calls": st.half_open_calls if st.state == STATE_HALF_OPEN else 0,
            "half_open_successes": (
                st.half_open_successes if st.state == STATE_HALF_OPEN else 0
            ),
            "half_open_failures": (
                st.half_open_failures if st.state == STATE_HALF_OPEN else 0
            ),
            "half_open_max_calls": self.half_open_max_calls,
            "observation_until": st.observation_until if in_observation else None,
            "fast_open": st.fast_open and in_observation,
            "now": now,
        }

    def reset(self, key: str) -> None:
        """重置 ``key``：回到 closed 并清空全部统计与冷却状态。"""
        key = self._validate_key(key)
        self._states.pop(key, None)

    def keys(self) -> List[str]:
        """返回所有出现过的 key。"""
        return list(self._states.keys())

    def get_stats(self, key: Optional[str] = None) -> Dict[str, Any]:
        """返回一个或全部 key 的状态（结构同 :meth:`get_state`）。"""
        if key is not None:
            return self.get_state(key)
        return {k: self.get_state(k) for k in list(self._states.keys())}

    # -- 快照 ---------------------------------------------------------------

    def config_dict(self) -> Dict[str, Any]:
        """导出构造参数，便于持久化与重建。"""
        return {
            "window_length": self.window_length,
            "failure_rate_threshold": self.failure_rate_threshold,
            "min_samples": self.min_samples,
            "consecutive_failure_threshold": self.consecutive_failure_threshold,
            "cooldown_duration": self.cooldown_duration,
            "half_open_max_calls": self.half_open_max_calls,
            "backoff_strategy": self.backoff_strategy,
            "backoff_multiplier": self.backoff_multiplier,
            "max_cooldown": self.max_cooldown,
            "observation_window": self.observation_window,
            "fast_open_multiplier": self.fast_open_multiplier,
        }

    def _state_dict(self, st: _BreakerState) -> Dict[str, Any]:
        return {
            "state": st.state,
            "opened_at": st.opened_at,
            "cooldown_end": st.cooldown_end,
            "current_cooldown": st.current_cooldown,
            "successes": list(st.successes) if st.successes is not None else [],
            "failures": list(st.failures) if st.failures is not None else [],
            "consecutive_failures": st.consecutive_failures,
            "half_open_calls": st.half_open_calls,
            "half_open_successes": st.half_open_successes,
            "half_open_failures": st.half_open_failures,
            "last_probe_at": st.last_probe_at,
            "observation_until": st.observation_until,
            "fast_open": st.fast_open,
            "last_failure_rate": st.last_failure_rate,
        }

    def to_dict(self) -> Dict[str, Any]:
        """导出熔断器（含时钟读数）的完整快照。"""
        return {
            "config": self.config_dict(),
            "clock_now": self._clock.now(),
            "keys": {k: self._state_dict(st) for k, st in self._states.items()},
        }

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any],
        clock: Optional[FakeClock] = None,
    ) -> "CircuitBreaker":
        """从快照字典重建熔断器并做一致性校验。

        校验内容：字段完整、状态取值合法、计数非负、冷却期非负且不超
        上限、时间戳不晚于逻辑时钟、半开探测数不超过配置等。
        """
        if not isinstance(data, dict):
            raise SnapshotError("熔断快照必须是 JSON 对象")
        if "config" not in data or not isinstance(data["config"], dict):
            raise SnapshotError("快照缺少 config 字段")
        if "keys" not in data or not isinstance(data["keys"], dict):
            raise SnapshotError("快照缺少 keys 字段")
        clock_now = data.get("clock_now")
        if not FakeClock._is_number(clock_now) or clock_now < 0:
            raise SnapshotError("快照缺少合法的 clock_now（非负数值）")

        cfg = dict(data["config"])
        missing = [k for k in _BREAKER_CONFIG_KEYS if k not in cfg]
        if missing:
            raise SnapshotError(f"熔断配置缺少字段: {', '.join(missing)}")
        extra = [k for k in cfg if k not in _BREAKER_CONFIG_KEYS]
        if extra:
            raise SnapshotError(f"熔断配置存在未知字段: {', '.join(extra)}")
        try:
            breaker = cls(clock=FakeClock(float(clock_now)), **cfg)
        except TypeError as exc:
            raise SnapshotError(f"熔断配置字段非法: {exc}") from exc
        except ValueError as exc:
            raise SnapshotError(f"熔断配置非法: {exc}") from exc
        if clock is not None:
            try:
                clock.set_now(float(clock_now))
            except ValueError as exc:
                raise SnapshotError(str(exc)) from exc
            breaker._clock = clock

        now = breaker._clock.now()
        for key, raw in data["keys"].items():
            cls._load_one_state(breaker, key, raw, now)
        return breaker

    @classmethod
    def _load_one_state(
        cls,
        breaker: "CircuitBreaker",
        key: Any,
        raw: Any,
        now: float,
    ) -> None:
        if not isinstance(key, str) or key == "":
            raise SnapshotError("快照中存在空 key 或非字符串 key")
        if not isinstance(raw, dict):
            raise SnapshotError(f"key {key!r} 的状态必须是 JSON 对象")

        required = [
            "state", "opened_at", "cooldown_end", "current_cooldown",
            "successes", "failures", "consecutive_failures",
            "half_open_calls", "half_open_successes", "half_open_failures",
            "last_probe_at", "observation_until", "fast_open",
        ]
        for field in required:
            if field not in raw:
                raise SnapshotError(f"key {key!r} 的快照缺少字段: {field}")

        state = raw["state"]
        if state not in _VALID_STATES:
            raise SnapshotError(
                f"key {key!r} 的状态 {state!r} 非法，"
                f"必须是 {sorted(_VALID_STATES)} 之一"
            )

        def nonneg_int(field: str) -> int:
            v = raw[field]
            if not isinstance(v, int) or isinstance(v, bool) or v < 0:
                raise SnapshotError(
                    f"key {key!r} 的 {field} 必须是非负整数"
                )
            return int(v)

        cf = nonneg_int("consecutive_failures")
        hc = nonneg_int("half_open_calls")
        hs = nonneg_int("half_open_successes")
        hf = nonneg_int("half_open_failures")
        if hc > breaker.half_open_max_calls:
            raise SnapshotError(
                f"key {key!r} 的 half_open_calls={hc} 超过配置的探测上限 "
                f"{breaker.half_open_max_calls}"
            )
        if hs > hc or hf > hc:
            raise SnapshotError(
                f"key {key!r} 的半开成功/失败数不能超过已放行探测数"
            )

        cur_cd = raw["current_cooldown"]
        if not FakeClock._is_number(cur_cd) or cur_cd < 0:
            raise SnapshotError(f"key {key!r} 的 current_cooldown 必须非负")
        if cur_cd > breaker.max_cooldown + 1e-9:
            raise SnapshotError(
                f"key {key!r} 的 current_cooldown={cur_cd} 超过上限 "
                f"{breaker.max_cooldown}"
            )

        opened_at = raw["opened_at"]
        cooldown_end = raw["cooldown_end"]
        last_probe_at = raw["last_probe_at"]
        observation_until = raw["observation_until"]
        # opened_at / last_probe_at 是“过去发生”的时间点，不得晚于当前时钟；
        # cooldown_end / observation_until 是“计划中的未来时间点”，允许在未来。
        for name, v in (
            ("opened_at", opened_at),
            ("last_probe_at", last_probe_at),
        ):
            if v is not None and (
                not FakeClock._is_number(v) or v < 0 or v > now + 1e-9
            ):
                raise SnapshotError(
                    f"key {key!r} 的 {name}={v} 非法：需为 [0, clock_now] 内的数值"
                )
        for name, v in (
            ("cooldown_end", cooldown_end),
            ("observation_until", observation_until),
        ):
            if v is not None and (not FakeClock._is_number(v) or v < 0):
                raise SnapshotError(
                    f"key {key!r} 的 {name}={v} 非法：需为非负数值"
                )

        if state in (STATE_OPEN, STATE_HALF_OPEN):
            if opened_at is None or cooldown_end is None:
                raise SnapshotError(
                    f"key {key!r} 处于 {state}，但 opened_at/cooldown_end 缺失"
                )
            if cooldown_end < opened_at - 1e-9:
                raise SnapshotError(
                    f"key {key!r} 的 cooldown_end 早于 opened_at（冷却期回退）"
                )

        def ts_list(field: str) -> Deque[float]:
            v = raw[field]
            if not isinstance(v, list):
                raise SnapshotError(f"key {key!r} 的 {field} 必须是数组")
            out: Deque[float] = deque()
            prev: Optional[float] = None
            for ts in v:
                if not FakeClock._is_number(ts) or ts < 0 or ts > now + 1e-9:
                    raise SnapshotError(
                        f"key {key!r} 的 {field} 中存在非法时间戳 {ts!r}"
                    )
                if prev is not None and ts < prev:
                    raise SnapshotError(
                        f"key {key!r} 的 {field} 时间戳必须单调不减"
                    )
                out.append(float(ts))
                prev = float(ts)
            return out

        st = _BreakerState(
            state=state,
            opened_at=(float(opened_at) if opened_at is not None else None),
            cooldown_end=(float(cooldown_end) if cooldown_end is not None else None),
            current_cooldown=float(cur_cd),
            successes=ts_list("successes"),
            failures=ts_list("failures"),
            consecutive_failures=cf,
            half_open_calls=hc,
            half_open_successes=hs,
            half_open_failures=hf,
            last_probe_at=(float(last_probe_at) if last_probe_at is not None else None),
            observation_until=(
                float(observation_until) if observation_until is not None else None
            ),
            fast_open=bool(raw["fast_open"]),
        )
        rate, _, _ = breaker._failure_rate(st, now)
        st.last_failure_rate = rate
        breaker._states[key] = st

    def save(self, path: Union[str, os.PathLike[str]]) -> None:
        """把熔断器快照写入 ``path``（JSON）。"""
        _write_json(path, self.to_dict())

    @classmethod
    def load(cls, path: Union[str, os.PathLike[str]]) -> "CircuitBreaker":
        """从 ``path`` 读取熔断器快照；文件损坏抛出 :class:`SnapshotError`。"""
        return cls.from_dict(_read_json(path))


# ---------------------------------------------------------------------------
# 组合闸门
# ---------------------------------------------------------------------------


class Guard:
    """限流 + 熔断组合闸门。

    请求先过限流器、再过熔断器：

    * 限流拒绝：直接返回，**不**触碰熔断统计；
    * 熔断拒绝：限流器此前已计数（请求确实申请了配额），但熔断器
      拒绝的调用不会产生 success/failure，因此**不**计入熔断统计；
    * :meth:`record_success` / :meth:`record_failure` 只写给熔断器，
      **不**触碰限流窗口。

    两条统计链路因此完全独立、互不污染。``rate_limiter`` 可为 None，
    此时 Guard 退化为纯熔断闸门。
    """

    SNAPSHOT_VERSION = 1

    def __init__(
        self,
        clock: Optional[FakeClock] = None,
        rate_limiter: Optional[SlidingWindowRateLimiter] = None,
        circuit_breaker: Optional[CircuitBreaker] = None,
    ) -> None:
        self.clock: FakeClock = clock or FakeClock()
        if rate_limiter is not None and rate_limiter._clock is not self.clock:
            raise ValueError("限流器与熔断器必须共用同一个逻辑时钟实例")
        if circuit_breaker is not None and circuit_breaker._clock is not self.clock:
            raise ValueError("限流器与熔断器必须共用同一个逻辑时钟实例")
        self.rate_limiter: Optional[SlidingWindowRateLimiter] = rate_limiter
        self.circuit_breaker: CircuitBreaker = (
            circuit_breaker or CircuitBreaker(self.clock)
        )

    # -- 对外 API -----------------------------------------------------------

    def allow(self, key: str, cost: int = 1) -> Dict[str, Any]:
        """先限流后熔断；返回闸门决策（字段含义同各子组件）。

        计数独立性：

        * 限流拒绝：直接返回，既不提交限流配额，也不触碰熔断器；
        * 熔断拒绝：此前只做了限流容量预检，此处不提交配额，因此
          **不**消耗限流窗口；熔断器不产生 success/failure，
          也**不**计入熔断统计；
        * 双重通过：此刻才把请求提交进限流窗口。
        """
        # 先做参数校验，保证两个组件拿到的输入一致。
        SlidingWindowRateLimiter._validate_key(key)
        SlidingWindowRateLimiter._validate_cost(cost)

        reservation: Optional[Dict[str, Any]] = None
        if self.rate_limiter is not None:
            reservation = self.rate_limiter.reserve(key, cost)
            if not reservation["allowed"]:
                # 限流拒绝：完全不触碰熔断器（也不创建其 key 状态）。
                existing = self.circuit_breaker._states.get(key)
                reservation["state"] = (
                    existing.state if existing is not None else STATE_CLOSED
                )
                return reservation

        decision = self.circuit_breaker.allow(key, cost)
        if not decision["allowed"]:
            # 熔断拒绝：预检保留不提交，限流窗口用量不变。
            decision["rate_limited"] = False
            return decision

        if self.rate_limiter is not None and reservation is not None:
            ts, c = reservation["_commit"]
            self.rate_limiter.commit(key, c, ts)
            decision["current"] = reservation["current"]
            decision["remaining"] = reservation["remaining"]
            decision["limit"] = reservation["limit"]
            decision["window_length"] = reservation["window_length"]
        decision["rate_limited"] = False
        return decision

    def record_success(self, key: str) -> Dict[str, Any]:
        """只记录到熔断器，不影响限流窗口。"""
        return self.circuit_breaker.record_success(key)

    def record_failure(self, key: str) -> Dict[str, Any]:
        """只记录到熔断器，不影响限流窗口。"""
        return self.circuit_breaker.record_failure(key)

    def get_state(self, key: str) -> Dict[str, Any]:
        """返回熔断状态，并附带限流窗口当前用量。"""
        state = self.circuit_breaker.get_state(key)
        if self.rate_limiter is not None:
            stats = self.rate_limiter.get_stats(key)
            state["rate_limit"] = stats
        return state

    def reset(self, key: str) -> Dict[str, Any]:
        """同时重置某个 key 的限流与熔断状态。"""
        SlidingWindowRateLimiter._validate_key(key)
        if self.rate_limiter is not None:
            self.rate_limiter.reset(key)
        self.circuit_breaker.reset(key)
        return {"key": key, "reset": True, "now": self.clock.now()}

    def tick(self, delta: Number = 1) -> float:
        """推进逻辑时钟，返回推进后的时间。"""
        return self.clock.tick(delta)

    def get_stats(self) -> Dict[str, Any]:
        """返回全部 key 的限流 + 熔断统计。"""
        result: Dict[str, Any] = {}
        keys = set(self.circuit_breaker.keys())
        if self.rate_limiter is not None:
            keys.update(self.rate_limiter.keys())
        for key in keys:
            result[key] = self.get_state(key)
        return result

    # -- 快照 ---------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """导出整道闸门（时钟、配置、每个 key 的窗口计数与熔断状态）。"""
        limiter_part: Optional[Dict[str, Any]] = None
        limiter_keys: Dict[str, Any] = {}
        if self.rate_limiter is not None:
            rl = self.rate_limiter
            limiter_part = {
                "window_length": rl.window_length,
                "rate_limit": rl.rate_limit,
            }
            limiter_keys = {
                k: rl._states[k].to_dict() for k in rl._states
            }

        breaker_data = self.circuit_breaker.to_dict()
        all_keys = set(breaker_data["keys"].keys()) | set(limiter_keys.keys())
        keys_out: Dict[str, Any] = {}
        for key in all_keys:
            keys_out[key] = {
                "limiter": limiter_keys.get(key, {"events": []}),
                "breaker": breaker_data["keys"].get(key),
            }
        # 只在熔断器里出现、而该 key 没有任何实际数据时补上默认空状态。
        for key, part in keys_out.items():
            if part["breaker"] is None:
                st = self.circuit_breaker._state(key)
                part["breaker"] = self.circuit_breaker._state_dict(st)

        return {
            "version": self.SNAPSHOT_VERSION,
            "clock_now": self.clock.now(),
            "limiter": limiter_part,
            "breaker_config": breaker_data["config"],
            "keys": keys_out,
        }

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any],
        clock: Optional[FakeClock] = None,
    ) -> "Guard":
        """从快照字典重建闸门并做一致性校验。"""
        if not isinstance(data, dict):
            raise SnapshotError("快照必须是 JSON 对象")
        version = data.get("version")
        if version != cls.SNAPSHOT_VERSION:
            raise SnapshotError(
                f"不支持的快照版本 {version!r}，期望 {cls.SNAPSHOT_VERSION}"
            )
        clock_now = data.get("clock_now")
        if not FakeClock._is_number(clock_now) or clock_now < 0:
            raise SnapshotError("快照缺少合法的 clock_now（非负数值）")

        limiter_cfg = data.get("limiter")
        if limiter_cfg is not None and not isinstance(limiter_cfg, dict):
            raise SnapshotError("快照的 limiter 字段必须是对象或 null")
        breaker_cfg = data.get("breaker_config")
        if not isinstance(breaker_cfg, dict):
            raise SnapshotError("快照缺少 breaker_config 字段")
        keys = data.get("keys")
        if not isinstance(keys, dict):
            raise SnapshotError("快照缺少 keys 字段")

        the_clock = clock or FakeClock(float(clock_now))
        if clock is not None:
            try:
                clock.set_now(float(clock_now))
            except ValueError as exc:
                raise SnapshotError(str(exc)) from exc

        rl: Optional[SlidingWindowRateLimiter] = None
        if limiter_cfg is not None:
            lim_missing = [
                k for k in ("window_length", "rate_limit") if k not in limiter_cfg
            ]
            if lim_missing:
                raise SnapshotError(
                    f"限流配置缺少字段: {', '.join(lim_missing)}"
                )
            try:
                rl = SlidingWindowRateLimiter(
                    window_length=limiter_cfg["window_length"],
                    rate_limit=limiter_cfg["rate_limit"],
                    clock=the_clock,
                )
            except KeyError as exc:
                raise SnapshotError(f"限流配置缺少字段: {exc}") from exc
            except ValueError as exc:
                raise SnapshotError(f"限流配置非法: {exc}") from exc

        cfg_missing = [
            k for k in _BREAKER_CONFIG_KEYS if k not in breaker_cfg
        ]
        if cfg_missing:
            raise SnapshotError(
                f"熔断配置缺少字段: {', '.join(cfg_missing)}"
            )
        try:
            breaker = CircuitBreaker(clock=the_clock, **breaker_cfg)
        except TypeError as exc:
            raise SnapshotError(f"熔断配置字段非法: {exc}") from exc
        except ValueError as exc:
            raise SnapshotError(f"熔断配置非法: {exc}") from exc

        guard = cls(clock=the_clock, rate_limiter=rl, circuit_breaker=breaker)
        now = the_clock.now()

        for key, part in keys.items():
            if not isinstance(key, str) or key == "":
                raise SnapshotError("快照中存在空 key 或非字符串 key")
            if not isinstance(part, dict):
                raise SnapshotError(f"key {key!r} 的条目必须是对象")
            if "limiter" not in part or "breaker" not in part:
                raise SnapshotError(f"key {key!r} 的条目缺少 limiter/breaker 部分")

            if rl is not None:
                lim_raw = part["limiter"]
                if not isinstance(lim_raw, dict) or not isinstance(
                    lim_raw.get("events"), list
                ):
                    raise SnapshotError(
                        f"key {key!r} 的 limiter 部分必须含 events 数组"
                    )
                st = _LimiterState(events=deque())
                prev: Optional[float] = None
                for ev in lim_raw["events"]:
                    if not isinstance(ev, dict) or "t" not in ev or "cost" not in ev:
                        raise SnapshotError(
                            f"key {key!r} 的限流事件必须含 t 和 cost"
                        )
                    t, cost = ev["t"], ev["cost"]
                    if not FakeClock._is_number(t) or t < 0 or t > now + 1e-9:
                        raise SnapshotError(
                            f"key {key!r} 存在非法限流事件时间戳 {t!r}"
                        )
                    if prev is not None and t < prev:
                        raise SnapshotError(
                            f"key {key!r} 的限流事件时间戳必须单调不减"
                        )
                    if (not isinstance(cost, int) or isinstance(cost, bool)
                            or cost <= 0):
                        raise SnapshotError(
                            f"key {key!r} 的限流事件 cost={cost!r} 必须是正整数"
                        )
                    st.events.append((float(t), int(cost)))
                    prev = float(t)
                # 只统计仍落在窗口内的事件，超窗的历史事件不构成超额。
                boundary = now - rl.window_length
                used = sum(c for ts, c in st.events if ts > boundary)
                if used > rl.rate_limit:
                    raise SnapshotError(
                        f"key {key!r} 快照窗口内用量 {used} 超过阈值 "
                        f"{rl.rate_limit}，状态不一致"
                    )
                rl._states[key] = st

            CircuitBreaker._load_one_state(breaker, key, part["breaker"], now)

        return guard

    def save(self, path: Union[str, os.PathLike[str]]) -> None:
        """把整个闸门的状态（窗口计数、熔断状态、配置、时钟）写成 JSON。"""
        _write_json(path, self.to_dict())

    @classmethod
    def load(
        cls,
        path: Union[str, os.PathLike[str]],
        clock: Optional[FakeClock] = None,
    ) -> "Guard":
        """从 JSON 文件重建闸门；损坏或字段缺失抛出 :class:`SnapshotError`。"""
        return cls.from_dict(_read_json(path), clock=clock)

    def restore(self, path: Union[str, os.PathLike[str]]) -> "Guard":
        """从快照就地恢复到当前闸门；快照时钟早于当前时钟会报错（不回退）。"""
        data = _read_json(path)
        if not isinstance(data, dict) or not FakeClock._is_number(
            data.get("clock_now")
        ):
            raise SnapshotError("快照缺少合法的 clock_now")
        if data["clock_now"] + 1e-9 < self.clock.now():
            raise SnapshotError(
                f"逻辑时钟不能回退：当前 {self.clock.now()}，"
                f"快照时钟 {data['clock_now']}"
            )
        restored = Guard.from_dict(data, clock=self.clock)
        self.rate_limiter = restored.rate_limiter
        self.circuit_breaker = restored.circuit_breaker
        return self


# ---------------------------------------------------------------------------
# JSON 文件读写
# ---------------------------------------------------------------------------


def _write_json(path: Union[str, os.PathLike[str]], data: Dict[str, Any]) -> None:
    """原子写入 JSON 快照（先写临时文件再替换，避免半写文件）。"""
    path = os.fspath(path)
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")
    os.replace(tmp_path, path)


def _read_json(path: Union[str, os.PathLike[str]]) -> Dict[str, Any]:
    """读取并解析 JSON 快照，把所有底层错误转成 :class:`SnapshotError`。"""
    path = os.fspath(path)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError as exc:
        raise SnapshotError(f"快照文件不存在: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SnapshotError(
            f"快照文件不是合法 JSON（{path} 第 {exc.lineno} 行 "
            f"第 {exc.colno} 列）: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise SnapshotError(f"快照文件无法读取: {exc}") from exc
    if not isinstance(data, dict):
        raise SnapshotError("快照顶层必须是 JSON 对象")
    return data
