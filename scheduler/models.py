"""领域模型：门店、班次、员工、时段与全局配置。

时间统一使用 ``datetime``（naive，视为同一时区），内部以分钟为粒度计算。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import FrozenSet, List

MINUTES_PER_DAY = 24 * 60


@dataclass(frozen=True)
class TimeWindow:
    """半开区间 [start, end) 的可用时段。"""

    start: datetime
    end: datetime

    def __post_init__(self):
        if self.end <= self.start:
            raise ValueError(f"时段结束必须晚于开始: {self.start!r} ~ {self.end!r}")

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)

    def contains(self, start: datetime, end: datetime) -> bool:
        return self.start <= start and end <= self.end

    def overlaps(self, start: datetime, end: datetime) -> bool:
        return self.start < end and start < self.end


@dataclass(frozen=True)
class Store:
    id: str
    name: str = ""


@dataclass(frozen=True)
class Shift:
    """班次：唯一标识、所属门店、起止时刻、所需技能集合。"""

    id: str
    store_id: str
    start: datetime
    end: datetime
    required_skills: FrozenSet[str] = frozenset()

    def __post_init__(self):
        if self.end <= self.start:
            raise ValueError(f"班次结束必须晚于开始: {self.id} {self.start!r} ~ {self.end!r}")

    @property
    def duration_minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclass
class Employee:
    """员工：唯一标识、技能集合、可用时段列表、工时上限（分钟）。"""

    id: str
    skills: FrozenSet[str]
    availability: List[TimeWindow]
    max_minutes: int

    def is_available_for(self, start: datetime, end: datetime) -> bool:
        """可用时段中至少有一段完整包含 [start, end)。"""
        return any(w.contains(start, end) for w in self.availability)


@dataclass(frozen=True)
class Config:
    """全局配置：最短休息分钟数、夜班窗口（当日分钟数，可跨零点）。"""

    min_rest_minutes: int = 8 * 60
    night_start_minute: int = 22 * 60
    night_end_minute: int = 6 * 60

    def __post_init__(self):
        if self.min_rest_minutes < 0:
            raise ValueError("最短休息时长不能为负")
        for name in ("night_start_minute", "night_end_minute"):
            v = getattr(self, name)
            if not (0 <= v < MINUTES_PER_DAY):
                raise ValueError(f"{name} 必须在 [0, 1440) 内，得到 {v}")

    @property
    def night_length_minutes(self) -> int:
        return (self.night_end_minute - self.night_start_minute) % MINUTES_PER_DAY

    def is_night_shift(self, start: datetime, end: datetime) -> bool:
        """班次与任一夜班窗口（默认 22:00~次日06:00）相交即计为夜班。"""
        length = self.night_length_minutes
        if length == 0:
            return False
        day = datetime(start.year, start.month, start.day) - timedelta(days=1)
        while day < end:
            ws = day + timedelta(minutes=self.night_start_minute)
            we = ws + timedelta(minutes=length)
            if ws < end and start < we:
                return True
            day += timedelta(days=1)
        return False


def subtract_window(windows: List[TimeWindow], start: datetime, end: datetime) -> List[TimeWindow]:
    """从可用时段列表中扣除 [start, end)（用于请假），可能把一段拆成两段。"""
    out: List[TimeWindow] = []
    for w in windows:
        if not w.overlaps(start, end):
            out.append(w)
            continue
        if w.start < start:
            out.append(TimeWindow(w.start, start))
        if end < w.end:
            out.append(TimeWindow(end, w.end))
    return out
