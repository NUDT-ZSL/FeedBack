"""时钟抽象：所有时间判断都走 Clock，便于离线确定性测试。

内核只依赖三个方法：now()、monotonic()、sleep()。
生产环境可换成 SystemClock（真实时钟），测试用 ManualClock 手动推进。
"""

from __future__ import annotations

import time
from typing import Protocol, runtime_checkable


@runtime_checkable
class Clock(Protocol):
    """内核要求的最小时钟接口。"""

    def now(self) -> int:
        """当前逻辑时间（整数时间戳，单位由调用方约定，例如毫秒）。"""
        ...

    def sleep(self, seconds: float) -> None:
        ...


class ManualClock:
    """手动推进的逻辑时钟。线程安全，可配合多线程测试。

    时间为整数（逻辑 tick）。advance() 推进后会唤醒所有等待者；
    sleep 在 ManualClock 下表现为：阻塞直到时钟推进到目标时刻
    （仅按 tick 比较，不做真实睡眠），从而测试完全确定且快速。
    """

    def __init__(self, start: int = 0):
        import threading
        self._now = int(start)
        self._cond = threading.Condition()
        # 时钟跳变监听；注意回调在条件变量锁外执行，避免与监听方
        # 自身的锁形成 AB-BA
        self._listeners: list = []

    def add_listener(self, fn) -> None:
        """注册时钟跳变回调 fn(new_time)，在 advance/set 后、锁外调用。"""
        self._listeners.append(fn)

    def now(self) -> int:
        with self._cond:
            return self._now

    def advance(self, ticks: int = 1) -> int:
        """推进时钟并唤醒所有 sleep 中的等待者，返回推进后的时刻。"""
        if ticks < 0:
            raise ValueError("时钟只能向前推进，ticks 不能为负")
        with self._cond:
            self._now += ticks
            self._cond.notify_all()
            value = self._now
        for fn in list(self._listeners):
            fn(value)
        return value

    def set(self, value: int) -> int:
        """直接设置到某个不小于当前值的时刻（用于快进到指定时间点）。"""
        with self._cond:
            if value < self._now:
                raise ValueError(
                    f"不能把时钟回拨：当前 {self._now}，目标 {value}")
            changed = value > self._now
            if changed:
                self._now = value
                self._cond.notify_all()
        if changed:
            for fn in list(self._listeners):
                fn(value)
        return value

    def sleep(self, ticks: float) -> None:
        """逻辑睡眠：等待时钟前进 ticks 个 tick（立即随 advance/set 唤醒）。"""
        if ticks <= 0:
            return
        with self._cond:
            target = self._now + ticks
            while self._now < target:
                self._cond.wait(timeout=None)

    @property
    def is_manual(self) -> bool:
        return True


class SystemClock:
    """真实时钟的适配器（内核测试不使用，留作接真实系统时注入）。"""

    def __init__(self):
        self._t0 = time.monotonic()

    def now(self) -> int:
        # 毫秒级单调时间戳
        return int((time.monotonic() - self._t0) * 1000)

    def sleep(self, seconds: float) -> None:
        time.sleep(seconds)

    @property
    def is_manual(self) -> bool:
        return False
