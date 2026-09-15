"""可注入的逻辑时钟。

引擎不直接读墙钟时间，所有“现在几点”都向时钟询问；测试 / 重放时可以
注入固定或步进时钟，从而保证“重复计算完全一致”。
"""

from typing import Callable, Optional


class LogicalClock:
    """单调非递减的整数逻辑时钟。

    时间用 ``int`` 表示（可理解为版本号 / 逻辑滴答），取值任意，只要求：

    - 单调：``advance`` 不允许把时钟往回拨；
    - 可注入：构造时可给一个 ``supplier``，``tick()`` 用它推进。
    """

    __slots__ = ("_now", "_supplier")

    def __init__(self, start: int = 0, supplier: Optional[Callable[[], int]] = None):
        if not isinstance(start, int) or isinstance(start, bool):
            raise TypeError("逻辑时钟起点必须是 int")
        self._now = start
        self._supplier = supplier

    @property
    def now(self) -> int:
        return self._now

    def advance(self, value: int) -> int:
        """把时钟设置到 ``value``；要求不小于当前时刻（单调）。"""
        if not isinstance(value, int) or isinstance(value, bool):
            raise TypeError("逻辑时钟时刻必须是 int")
        if value < self._now:
            raise ValueError(
                f"逻辑时钟不能回拨：当前 {self._now}，收到 {value}"
            )
        self._now = value
        return self._now

    def tick(self) -> int:
        """前进一步。

        - 注入了 ``supplier`` 时，用其返回值（仍须单调）推进；
        - 否则自增 1。
        """
        if self._supplier is not None:
            return self.advance(self._supplier())
        self._now += 1
        return self._now

    def snapshot(self) -> int:
        return self._now

    def __int__(self) -> int:
        return self._now

    def __repr__(self) -> str:
        return f"LogicalClock(now={self._now})"
