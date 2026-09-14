"""可注入的逻辑时钟。

真实部署中节点的墙上时间会漂移、回退或跳变。内核绝不比较墙上时间，
而是依赖 :class:`LogicalClock` 抽象。本模块提供默认实现 :class:`ManualClock`，
测试与 CLI 通过 ``set_time`` / ``advance`` 显式推进它。

时钟同时维护：

* 绝对读数 :attr:`ManualClock.now`：可以被设成任意值（模拟跳变/回退），
  用于与请求方上报的本地时间比较；
* 单调高水位 :attr:`ManualClock.monotonic`：只增不减，租约的安全期判定
  全部基于它，因此时钟回退或向下跳变不会错误延长任何租约。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

__all__ = ["LogicalClock", "ManualClock"]


class LogicalClock(ABC):
    """逻辑时钟抽象：内核只依赖本接口。"""

    @property
    @abstractmethod
    def now(self) -> float:
        """当前（绝对）逻辑时间，单位由调用方约定（通常为毫秒）。"""

    @property
    @abstractmethod
    def monotonic(self) -> float:
        """单调读数：只增不减的高水位，用于所有安全期判定。"""


class ManualClock(LogicalClock):
    """可手动设置/推进的逻辑时钟。

    :param initial: 初始绝对时间。
    """

    __slots__ = ("_t", "_high", "tick")

    def __init__(self, initial: float = 0.0) -> None:
        self._t = float(initial)
        self._high = float(initial)
        self.tick = 0

    @property
    def now(self) -> float:
        """当前绝对逻辑时间（可随 ``set_time`` 回退）。"""
        return self._t

    @property
    def monotonic(self) -> float:
        """单调高水位读数，永不下降。"""
        return self._high

    def set_time(self, value: float) -> float:
        """把时钟设为 ``value``（可前可后，用于模拟回退/跳变）。

        绝对读数变为 ``value``；若 ``value`` 低于历史高水位，高水位保持
        不变，租约的安全期继续按高水位计算。返回设置后的绝对读数。
        """
        value = float(value)
        self._t = value
        if value > self._high:
            self._high = value
        self.tick += 1
        return self._t

    def advance(self, delta: float) -> float:
        """把时钟前进 ``delta``（必须非负）；返回前进后的绝对读数。"""
        delta = float(delta)
        if delta < 0:
            raise ValueError("advance delta must be non-negative, got %r" % (delta,))
        self._t += delta
        if self._t > self._high:
            self._high = self._t
        self.tick += 1
        return self._t

    def to_dict(self) -> dict:
        """序列化为可 JSON 化的字典。"""
        return {"now": self._t, "high": self._high, "tick": self.tick}

    @classmethod
    def from_dict(cls, data: dict) -> "ManualClock":
        """从字典恢复时钟。

        ``high`` 取记载值与 ``now`` 的较大者，保证单调读数不被损坏数据拉低。
        """
        if not isinstance(data, dict):
            raise ValueError("clock 段必须是对象")
        try:
            now = float(data["now"])
            high = float(data["high"])
        except KeyError as exc:
            raise ValueError("clock 缺少字段: %s" % (exc,)) from None
        except (TypeError, ValueError):
            raise ValueError("clock 的 now/high 必须是数值") from None
        if high < now:
            high = now
        tick = int(data.get("tick", 0))
        if tick < 0:
            raise ValueError("clock.tick 不能为负")
        clk = cls.__new__(cls)
        clk._t = now
        clk._high = high
        clk.tick = tick
        return clk
