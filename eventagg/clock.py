"""可注入的逻辑时钟。

引擎不读取系统时间，所有需要"当前时刻"的地方（审计记录时间戳、
as-of 查询默认值）都通过注入的时钟获取，保证完全离线、可重放。
"""

from __future__ import annotations

from typing import Protocol


class Clock(Protocol):
    """逻辑时钟协议：任何提供 now() 的对象都可注入引擎。"""

    def now(self) -> float:
        ...


class ManualClock:
    """手动推进的逻辑时钟，供离线验收与单元测试使用。"""

    def __init__(self, start: float = 0.0) -> None:
        self._now = float(start)

    def now(self) -> float:
        return self._now

    def set(self, t: float) -> None:
        self._now = float(t)

    def advance(self, delta: float = 1.0) -> float:
        self._now += float(delta)
        return self._now
