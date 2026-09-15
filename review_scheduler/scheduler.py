"""离线复习调度模块（仅依赖 Python 标准库）。

核心概念
========

* 每条学习内容 :class:`Item` 有唯一标识、所属主题，以及一份记忆状态
  :class:`MemoryState`（稳定度 stability、难度 difficulty 等）。
* 每次复习产生一条 :class:`ReviewRecord`，记录回忆质量、发生时刻、
  距上次复习的实际间隔，以及复习后新排定的间隔。
* 时间以整数“滴答”表示（可理解为天），由可注入的逻辑时钟
  :class:`ManualClock` 提供，因此所有计算都可复现、可离线测试。
* 回忆质量取值 0~5 的整数；``>= 3`` 视为顺利通过，``< 3`` 视为失败。

稳定度/难度更新公式（确定性，无随机量）
--------------------------------------

顺利通过（q ∈ {3,4,5}）::

    f_q   = {3: 0.15, 4: 0.25, 5: 0.35}[q]      # 质量越高增长越多
    D_eff = min(1.0, sqrt(D0 / D))               # 越简单增长略快，封顶 1
    S'    = min(S_max, S * (1 + f_q * D_eff))

失败（q < 3）::

    S'    = max(S_min, S * 0.5)                  # 稳定度直接减半

难度（向 3 回归，夹紧到 [1.05, 5.0]）::

    D'    = clamp(D + 0.15 * (3 - q), 1.05, 5.0)

下次间隔（天，整数）由新稳定度导出；顺利时间隔保证逐次严格拉长，
直到 ``MAX_INTERVAL_DAYS`` 上限；失败时间隔随稳定度减半而显著回落，
单次回落幅度（约 50%）大于任何一次顺利回忆的最大增长（≤ 35%）。
"""

from __future__ import annotations

import json
import math
import os
import tempfile
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

__all__ = [
    "Clock",
    "ManualClock",
    "MemoryState",
    "Item",
    "ReviewRecord",
    "Deferral",
    "DayPlan",
    "ScheduleConfig",
    "Scheduler",
    "SchedulerError",
    "ValidationError",
    "PersistenceError",
    "QUALITY_MIN",
    "QUALITY_MAX",
    "PASS_QUALITY",
    "MIN_DIFFICULTY",
    "MAX_DIFFICULTY",
    "DEFAULT_DIFFICULTY",
    "DEFAULT_STABILITY",
    "MIN_STABILITY",
    "MAX_STABILITY",
    "MAX_INTERVAL_DAYS",
    "DEFER_REASON_DAILY_LIMIT",
    "SCHEMA_VERSION",
]

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

QUALITY_MIN = 0
QUALITY_MAX = 5
PASS_QUALITY = 3

MIN_DIFFICULTY = 1.05
MAX_DIFFICULTY = 5.0
DEFAULT_DIFFICULTY = 3.0
D0 = DEFAULT_DIFFICULTY

DEFAULT_STABILITY = 1.0
MIN_STABILITY = 0.1
MAX_STABILITY = 3650.0
MAX_INTERVAL_DAYS = 365

_PASS_GROWTH = {3: 0.15, 4: 0.25, 5: 0.35}
_FAIL_STABILITY_FACTOR = 0.5

DEFER_REASON_DAILY_LIMIT = "daily_limit_exceeded"
SCHEMA_VERSION = 1


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class SchedulerError(Exception):
    """调度模块所有异常的基类。"""


class ValidationError(SchedulerError):
    """输入数据非法（数值越界、类型错误等）。"""


class PersistenceError(SchedulerError):
    """存档损坏、字段缺失或读写失败。"""


# ---------------------------------------------------------------------------
# 逻辑时钟
# ---------------------------------------------------------------------------


class Clock:
    """逻辑时钟接口：返回整数时刻（天粒度的滴答数）。"""

    def now(self) -> int:  # pragma: no cover - 接口
        raise NotImplementedError


class ManualClock(Clock):
    """可手动推进的逻辑时钟，测试与离线复算都使用它。"""

    def __init__(self, tick: int = 0):
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0:
            raise ValidationError(f"clock.tick: 必须为非负整数，实际为 {tick!r}")
        self.tick = tick

    def now(self) -> int:
        return self.tick

    def advance(self, days: int = 1) -> int:
        if isinstance(days, bool) or not isinstance(days, int) or days < 0:
            raise ValidationError(f"advance: 前进天数必须为非负整数，实际为 {days!r}")
        self.tick += days
        return self.tick

    def set(self, tick: int) -> None:
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0:
            raise ValidationError(f"clock.tick: 必须为非负整数，实际为 {tick!r}")
        self.tick = tick


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------


@dataclass
class MemoryState:
    """记忆状态：稳定度与难度必须为正。"""

    stability: float
    difficulty: float
    reps: int = 0  # 累计顺利回忆次数
    lapses: int = 0  # 累计失败次数

    @staticmethod
    def validate(stability: float, difficulty: float, path: str = "memory") -> None:
        _require_positive_number(stability, f"{path}.stability")
        _require_positive_number(difficulty, f"{path}.difficulty")

    def snapshot(self) -> "MemoryState":
        return MemoryState(self.stability, self.difficulty, self.reps, self.lapses)


@dataclass
class Item:
    """一条学习内容。"""

    item_id: str
    topic: str
    stability: float
    difficulty: float
    reps: int = 0
    lapses: int = 0
    due: int = 0
    last_reviewed: Optional[int] = None
    created_at: int = 0

    @property
    def state(self) -> MemoryState:
        return MemoryState(self.stability, self.difficulty, self.reps, self.lapses)


@dataclass(frozen=True)
class ReviewRecord:
    """一次复习的不可变记录。

    ``elapsed`` 是距上次复习的实际间隔（首次复习为 0）；
    ``scheduled_interval`` 是本次复习后新排定的下次间隔。
    """

    item_id: str
    timestamp: int
    quality: int
    elapsed: int
    scheduled_interval: int
    stability_before: float
    stability_after: float
    difficulty_before: float
    difficulty_after: float


@dataclass(frozen=True)
class Deferral:
    """一条内容被顺延时的原因记录（不改变记忆状态）。"""

    item_id: str
    day: int
    old_due: int
    new_due: int
    reason: str


@dataclass(frozen=True)
class DayPlan:
    """某一天的排课结果。"""

    day: int
    selected: List[str]
    deferred: List[Deferral]


@dataclass
class ScheduleConfig:
    """排课配置；daily_limit 为 None 表示不限量。"""

    daily_limit: Optional[int] = None

    def validate(self) -> None:
        if self.daily_limit is not None:
            if (
                isinstance(self.daily_limit, bool)
                or not isinstance(self.daily_limit, int)
                or self.daily_limit <= 0
            ):
                raise ValidationError(
                    f"config.daily_limit: 必须为正整数或 null，实际为 {self.daily_limit!r}"
                )


# ---------------------------------------------------------------------------
# 校验小工具
# ---------------------------------------------------------------------------


def _require_positive_number(value: object, path: str) -> None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{path}: 必须为正数，实际类型为 {type(value).__name__}")
    if not math.isfinite(value) or value <= 0:
        raise ValidationError(f"{path}: 必须为正数，实际为 {value!r}")


def _require_int(value: object, path: str, *, minimum: Optional[int] = None) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValidationError(f"{path}: 必须为整数，实际为 {value!r}")
    if minimum is not None and value < minimum:
        raise ValidationError(f"{path}: 必须 >= {minimum}，实际为 {value!r}")
    return value


# ---------------------------------------------------------------------------
# 纯函数：确定性的记忆状态更新
# ---------------------------------------------------------------------------


def next_difficulty(difficulty: float, quality: int) -> float:
    d = difficulty + 0.15 * (PASS_QUALITY - quality)
    return min(MAX_DIFFICULTY, max(MIN_DIFFICULTY, d))


def next_stability(stability: float, difficulty: float, quality: int) -> float:
    if quality >= PASS_QUALITY:
        growth = _PASS_GROWTH[quality]
        difficulty_factor = min(1.0, math.sqrt(D0 / difficulty))
        updated = stability * (1.0 + growth * difficulty_factor)
        return min(MAX_STABILITY, updated)
    updated = stability * _FAIL_STABILITY_FACTOR
    return max(MIN_STABILITY, updated)


def next_interval(
    stability_after: float,
    quality: int,
    previous_interval: int,
) -> int:
    """根据新稳定度计算下次间隔（整数天）。"""

    value = max(1, int(math.floor(stability_after + 0.5)))
    if quality >= PASS_QUALITY:
        # 顺利回忆：逐次严格拉长，直到上限。
        value = max(value, previous_interval + 1)
        return min(MAX_INTERVAL_DAYS, value)
    # 失败：随稳定度减半而显著回落（不少于 1 天）。
    return value


# ---------------------------------------------------------------------------
# 调度器
# ---------------------------------------------------------------------------


class Scheduler:
    """复习调度器。

    构造参数
    --------
    clock: 可注入的逻辑时钟，默认使用 :class:`ManualClock`（从 0 开始）。
    daily_limit: 每天复习量上限，None 表示不限量。
    """

    def __init__(
        self,
        clock: Optional[Clock] = None,
        daily_limit: Optional[int] = None,
    ) -> None:
        self.clock: Clock = clock if clock is not None else ManualClock(0)
        self.config = ScheduleConfig(daily_limit=daily_limit)
        self.config.validate()
        self._items: Dict[str, Item] = {}
        self._records: Dict[str, List[ReviewRecord]] = {}
        self._deferrals: List[Deferral] = []

    # ---- 内容管理 ---------------------------------------------------------

    def add_item(
        self,
        item_id: str,
        topic: str,
        stability: float = DEFAULT_STABILITY,
        difficulty: float = DEFAULT_DIFFICULTY,
    ) -> Item:
        if not isinstance(item_id, str) or not item_id:
            raise ValidationError("item_id: 必须为非空字符串")
        if not isinstance(topic, str) or not topic:
            raise ValidationError(f"items[{item_id}].topic: 必须为非空字符串")
        if item_id in self._items:
            raise ValidationError(f"items[{item_id}]: 标识已存在")
        MemoryState.validate(stability, difficulty, f"items[{item_id}]")
        now = self.clock.now()
        item = Item(
            item_id=item_id,
            topic=topic,
            stability=float(stability),
            difficulty=float(difficulty),
            due=now,
            last_reviewed=None,
            created_at=now,
        )
        self._items[item_id] = item
        self._records[item_id] = []
        return item

    def add_items(self, specs: Sequence[dict]) -> List[Item]:
        """批量加入内容；先整体校验再写入，错误信息指出下标位置。"""

        if not isinstance(specs, Sequence) or isinstance(specs, (str, bytes)):
            raise ValidationError("add_items: 参数必须为序列")
        for index, spec in enumerate(specs):
            if not isinstance(spec, dict):
                raise ValidationError(f"items[{index}]: 必须为对象")
            item_id = spec.get("item_id")
            if not isinstance(item_id, str) or not item_id:
                raise ValidationError(f"items[{index}].item_id: 必须为非空字符串")
            if item_id in self._items or any(
                j != index and specs[j].get("item_id") == item_id
                for j in range(len(specs))
            ):
                raise ValidationError(f"items[{index}].item_id: 标识 {item_id!r} 重复")
            topic = spec.get("topic")
            if not isinstance(topic, str) or not topic:
                raise ValidationError(f"items[{index}].topic: 必须为非空字符串")
            MemoryState.validate(
                spec.get("stability", DEFAULT_STABILITY),
                spec.get("difficulty", DEFAULT_DIFFICULTY),
                f"items[{index}](id={item_id})",
            )
        return [
            self.add_item(
                spec["item_id"],
                spec["topic"],
                spec.get("stability", DEFAULT_STABILITY),
                spec.get("difficulty", DEFAULT_DIFFICULTY),
            )
            for spec in specs
        ]

    def get_item(self, item_id: str) -> Item:
        try:
            return self._items[item_id]
        except KeyError:
            raise ValidationError(f"items[{item_id}]: 内容不存在") from None

    def item_ids(self) -> List[str]:
        return sorted(self._items)

    # ---- 复习与更新 -------------------------------------------------------

    def review(
        self,
        item_id: str,
        quality: int,
        timestamp: Optional[int] = None,
    ) -> ReviewRecord:
        """登记一次复习并更新记忆状态。

        * 质量必须是 0~5 的整数，否则 :class:`ValidationError`。
        * 同一内容同一时刻重复提交按幂等处理：原样返回已有记录，
          不改变任何状态（即使重交的质量不同）。
        """

        item = self.get_item(item_id)
        if isinstance(quality, bool) or not isinstance(quality, int):
            raise ValidationError(
                f"items[{item_id}].review.quality: "
                f"必须为 {QUALITY_MIN}~{QUALITY_MAX} 的整数，实际为 {quality!r}"
            )
        if not (QUALITY_MIN <= quality <= QUALITY_MAX):
            raise ValidationError(
                f"items[{item_id}].review.quality: "
                f"必须在 [{QUALITY_MIN}, {QUALITY_MAX}] 范围内，实际为 {quality}"
            )
        ts = self.clock.now() if timestamp is None else _require_int(
            timestamp, f"items[{item_id}].review.timestamp", minimum=0
        )
        if item.last_reviewed is not None and ts < item.last_reviewed:
            raise ValidationError(
                f"items[{item_id}].review.timestamp: 时刻 {ts} 早于上次复习 "
                f"{item.last_reviewed}，时钟不能倒退"
            )

        history = self._records[item_id]
        if history and history[-1].timestamp == ts:
            # 幂等：同一内容同一时刻的重复提交直接返回已有记录。
            return history[-1]

        elapsed = 0 if item.last_reviewed is None else ts - item.last_reviewed
        stability_before = item.stability
        difficulty_before = item.difficulty
        previous_interval = history[-1].scheduled_interval if history else 0

        stability_after = next_stability(item.stability, item.difficulty, quality)
        difficulty_after = next_difficulty(item.difficulty, quality)
        scheduled_interval = next_interval(stability_after, quality, previous_interval)

        record = ReviewRecord(
            item_id=item_id,
            timestamp=ts,
            quality=quality,
            elapsed=elapsed,
            scheduled_interval=scheduled_interval,
            stability_before=stability_before,
            stability_after=stability_after,
            difficulty_before=difficulty_before,
            difficulty_after=difficulty_after,
        )
        history.append(record)

        item.stability = stability_after
        item.difficulty = difficulty_after
        item.last_reviewed = ts
        item.due = ts + scheduled_interval
        if quality >= PASS_QUALITY:
            item.reps += 1
        else:
            item.lapses += 1
        return record

    # ---- 到期查询与排课 ---------------------------------------------------

    def due_items(self, now: Optional[int] = None) -> List[str]:
        """返回当前应复习内容的标识集合。

        纯查询，不修改任何状态。按 (到期时刻, 标识) 稳定排序，
        同一时刻重复查询结果完全一致。
        """

        current = self.clock.now() if now is None else _require_int(
            now, "now", minimum=0
        )
        due = [it for it in self._items.values() if it.due <= current]
        due.sort(key=lambda it: (it.due, it.item_id))
        return [it.item_id for it in due]

    def plan_day(
        self,
        day: Optional[int] = None,
        limit: Optional[int] = None,
    ) -> DayPlan:
        """安排某一天（默认时钟当前时刻所在天）的复习。

        到期（含逾期）内容按紧迫度排序；超过当日上限时只保留最紧迫的，
        其余顺延并记录原因。顺延只移动到期时刻 ``due``，
        稳定度、难度、次数等记忆状态保持不变。

        顺延目标取 ``max(day + 1, clock.now() + 1)``：既严格晚于被排的
        这一天，也不早于逻辑时钟当前时刻的次日。这样即使显式传入一个
        历史日期排课，顺延项也不会在“当前”再次冒充到期、抢占名额。
        """

        current = self.clock.now() if day is None else _require_int(
            day, "day", minimum=0
        )
        cap = self.config.daily_limit if limit is None else limit
        if limit is not None:
            ScheduleConfig(daily_limit=limit).validate()

        ordered = sorted(
            (it for it in self._items.values() if it.due <= current),
            key=lambda it: (it.due, it.item_id),
        )
        if cap is None:
            return DayPlan(current, [it.item_id for it in ordered], [])

        selected = ordered[:cap]
        deferred_items = ordered[cap:]
        # 顺延到排课日的次日；若排课日早于逻辑时钟当前时刻，则至少推到
        # 当前时刻的次日，保证顺延项当天（及对当前时钟而言）不再到期。
        new_due = max(current + 1, self.clock.now() + 1)
        deferrals: List[Deferral] = []
        for it in deferred_items:
            old_due = it.due
            it.due = new_due  # 顺延；记忆状态不动
            entry = Deferral(
                item_id=it.item_id,
                day=current,
                old_due=old_due,
                new_due=it.due,
                reason=DEFER_REASON_DAILY_LIMIT,
            )
            deferrals.append(entry)
            self._deferrals.append(entry)
        return DayPlan(current, [it.item_id for it in selected], deferrals)

    def deferrals(self) -> List[Deferral]:
        return list(self._deferrals)

    # ---- 查询接口 ---------------------------------------------------------

    def status(self, item_id: str) -> dict:
        """回答任意内容当前的稳定度、难度、到期时刻等状态。"""

        it = self.get_item(item_id)
        return {
            "item_id": it.item_id,
            "topic": it.topic,
            "stability": it.stability,
            "difficulty": it.difficulty,
            "due": it.due,
            "last_reviewed": it.last_reviewed,
            "reps": it.reps,
            "lapses": it.lapses,
        }

    def history(self, item_id: str) -> List[ReviewRecord]:
        """返回历史复习轨迹（按时间顺序的副本）。"""

        self.get_item_id_or_raise(item_id)
        return list(self._records[item_id])

    def interval_changes(self, item_id: str) -> List[dict]:
        """返回每次复习后的间隔变化轨迹。"""

        self.get_item_id_or_raise(item_id)
        return [
            {
                "timestamp": r.timestamp,
                "quality": r.quality,
                "elapsed": r.elapsed,
                "scheduled_interval": r.scheduled_interval,
            }
            for r in self._records[item_id]
        ]

    def get_item_id_or_raise(self, item_id: str) -> str:
        if item_id not in self._items:
            raise ValidationError(f"items[{item_id}]: 内容不存在")
        return item_id

    def topic_stats(self, topic: str, now: Optional[int] = None) -> dict:
        """某主题下到期内容数与平均间隔。

        两项口径都以内容**当前生效的到期时刻** ``due`` 为准，与
        :meth:`due_items` 的“应复习集合”完全一致：

        * 到期数：该主题下 ``due <= now`` 的内容数；顺延后的内容按
          顺延后的新到期时刻判定，不会在当天被重复计入。
        * 平均间隔：每条已复习内容“最新复习时刻 → 当前生效到期时刻”的
          实际间隔（``due - last_reviewed``）的算术平均。无顺延时它等于
          最新一次排定间隔；发生顺延时如实反映顺延带来的推迟。
          尚未复习过的内容不计入平均。
        """

        current = self.clock.now() if now is None else _require_int(
            now, "now", minimum=0
        )
        members = [it for it in self._items.values() if it.topic == topic]
        due_count = sum(1 for it in members if it.due <= current)
        intervals: List[int] = []
        for it in members:
            if self._records[it.item_id]:
                # 以顺延后的实际到期时刻为准，而不是记录里的原始排定间隔。
                intervals.append(it.due - (it.last_reviewed or 0))
        average = sum(intervals) / len(intervals) if intervals else None
        return {
            "topic": topic,
            "total_items": len(members),
            "due_count": due_count,
            "average_interval": average,
        }

    # ---- 持久化 -----------------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "version": SCHEMA_VERSION,
            "clock": {"type": "ManualClock", "tick": self.clock.now()},
            "config": {"daily_limit": self.config.daily_limit},
            "items": [_item_to_dict(self._items[i]) for i in sorted(self._items)],
            "records": [
                _record_to_dict(r)
                for item_id in sorted(self._records)
                for r in self._records[item_id]
            ],
            "deferrals": [
                {
                    "item_id": d.item_id,
                    "day": d.day,
                    "old_due": d.old_due,
                    "new_due": d.new_due,
                    "reason": d.reason,
                }
                for d in self._deferrals
            ],
        }

    @classmethod
    def from_dict(cls, data: object) -> "Scheduler":
        """从字典完整重建；任何字段问题都抛 :class:`PersistenceError`。

        采用“先完整构建、成功后再返回”的策略，失败时不会产生半成品对象，
        调用方已有状态不受影响。
        """

        if not isinstance(data, dict):
            raise PersistenceError("存档根节点必须是 JSON 对象")
        version = data.get("version")
        if version != SCHEMA_VERSION:
            raise PersistenceError(
                f"version: 不支持的存档版本 {version!r}，仅支持 {SCHEMA_VERSION}"
            )

        clock_data = data.get("clock")
        if not isinstance(clock_data, dict):
            raise PersistenceError("clock: 字段缺失或不是对象")
        if clock_data.get("type") != "ManualClock":
            raise PersistenceError(
                f"clock.type: 仅支持 ManualClock，实际为 {clock_data.get('type')!r}"
            )
        tick = clock_data.get("tick")
        if isinstance(tick, bool) or not isinstance(tick, int) or tick < 0:
            raise PersistenceError(f"clock.tick: 必须为非负整数，实际为 {tick!r}")

        config_data = data.get("config")
        if not isinstance(config_data, dict):
            raise PersistenceError("config: 字段缺失或不是对象")
        daily_limit = config_data.get("daily_limit")
        if daily_limit is not None and (
            isinstance(daily_limit, bool)
            or not isinstance(daily_limit, int)
            or daily_limit <= 0
        ):
            raise PersistenceError(
                f"config.daily_limit: 必须为正整数或 null，实际为 {daily_limit!r}"
            )

        scheduler = cls(clock=ManualClock(tick), daily_limit=daily_limit)

        raw_items = data.get("items")
        if not isinstance(raw_items, list):
            raise PersistenceError("items: 字段缺失或不是数组")
        for index, raw in enumerate(raw_items):
            path = f"items[{index}]"
            if not isinstance(raw, dict):
                raise PersistenceError(f"{path}: 必须是对象")
            item_id = _load_str(raw, "item_id", path)
            topic = _load_str(raw, "topic", path)
            stability = _load_positive(raw, "stability", path)
            difficulty = _load_positive(raw, "difficulty", path)
            reps = _load_nonneg_int(raw, "reps", path)
            lapses = _load_nonneg_int(raw, "lapses", path)
            due = _load_int(raw, "due", path)
            created_at = _load_int(raw, "created_at", path)
            last_reviewed = raw.get("last_reviewed")
            if last_reviewed is not None:
                if isinstance(last_reviewed, bool) or not isinstance(last_reviewed, int):
                    raise PersistenceError(f"{path}.last_reviewed: 必须为整数或 null")
            if item_id in scheduler._items:
                raise PersistenceError(f"{path}.item_id: {item_id!r} 重复")
            scheduler._items[item_id] = Item(
                item_id=item_id,
                topic=topic,
                stability=stability,
                difficulty=difficulty,
                reps=reps,
                lapses=lapses,
                due=due,
                last_reviewed=last_reviewed,
                created_at=created_at,
            )
            scheduler._records[item_id] = []

        raw_records = data.get("records")
        if not isinstance(raw_records, list):
            raise PersistenceError("records: 字段缺失或不是数组")
        for index, raw in enumerate(raw_records):
            path = f"records[{index}]"
            if not isinstance(raw, dict):
                raise PersistenceError(f"{path}: 必须是对象")
            item_id = _load_str(raw, "item_id", path)
            if item_id not in scheduler._items:
                raise PersistenceError(f"{path}.item_id: 引用了不存在的内容 {item_id!r}")
            ts = _load_int(raw, "timestamp", path)
            quality = raw.get("quality")
            if isinstance(quality, bool) or not isinstance(quality, int):
                raise PersistenceError(f"{path}.quality: 必须为整数")
            if not (QUALITY_MIN <= quality <= QUALITY_MAX):
                raise PersistenceError(
                    f"{path}.quality: 必须在 [{QUALITY_MIN}, {QUALITY_MAX}] 内，实际为 {quality}"
                )
            elapsed = _load_nonneg_int(raw, "elapsed", path)
            scheduled = _load_nonneg_int(raw, "scheduled_interval", path)
            if scheduled < 1:
                raise PersistenceError(
                    f"{path}.scheduled_interval: 必须 >= 1，实际为 {scheduled}"
                )
            s_before = _load_positive(raw, "stability_before", path)
            s_after = _load_positive(raw, "stability_after", path)
            d_before = _load_positive(raw, "difficulty_before", path)
            d_after = _load_positive(raw, "difficulty_after", path)
            history = scheduler._records[item_id]
            if history and ts < history[-1].timestamp:
                raise PersistenceError(
                    f"{path}.timestamp: 同一内容的复习记录必须按时间升序"
                )
            history.append(
                ReviewRecord(
                    item_id=item_id,
                    timestamp=ts,
                    quality=quality,
                    elapsed=elapsed,
                    scheduled_interval=scheduled,
                    stability_before=s_before,
                    stability_after=s_after,
                    difficulty_before=d_before,
                    difficulty_after=d_after,
                )
            )

        raw_deferrals = data.get("deferrals")
        if not isinstance(raw_deferrals, list):
            raise PersistenceError("deferrals: 字段缺失或不是数组")
        for index, raw in enumerate(raw_deferrals):
            path = f"deferrals[{index}]"
            if not isinstance(raw, dict):
                raise PersistenceError(f"{path}: 必须是对象")
            item_id = _load_str(raw, "item_id", path)
            if item_id not in scheduler._items:
                raise PersistenceError(f"{path}.item_id: 引用了不存在的内容 {item_id!r}")
            scheduler._deferrals.append(
                Deferral(
                    item_id=item_id,
                    day=_load_int(raw, "day", path),
                    old_due=_load_int(raw, "old_due", path),
                    new_due=_load_int(raw, "new_due", path),
                    reason=_load_str(raw, "reason", path),
                )
            )

        return scheduler

    def save(self, path: "str | os.PathLike[str]") -> None:
        """原子写入存档（同目录临时文件 + os.replace）。"""

        directory = os.path.dirname(os.path.abspath(path))
        fd, tmp_path = tempfile.mkstemp(prefix=".scheduler-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(self.to_dict(), fh, ensure_ascii=False, indent=2, sort_keys=True)
                fh.write("\n")
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp_path, path)
        except OSError as exc:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise PersistenceError(f"写入存档失败: {exc}") from exc

    @classmethod
    def load(cls, path: "str | os.PathLike[str]") -> "Scheduler":
        """从文件载入；JSON 损坏或字段缺失时抛 :class:`PersistenceError`。

        载入是“构造一个全新对象”的过程：要么成功返回，要么抛异常，
        不会出现载入一半的状态。
        """

        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError:
            raise PersistenceError(f"存档文件不存在: {path}") from None
        except (json.JSONDecodeError, OSError, UnicodeDecodeError) as exc:
            raise PersistenceError(f"存档无法解析: {exc}") from exc
        return cls.from_dict(data)


def _item_to_dict(it: Item) -> dict:
    return {
        "item_id": it.item_id,
        "topic": it.topic,
        "stability": it.stability,
        "difficulty": it.difficulty,
        "reps": it.reps,
        "lapses": it.lapses,
        "due": it.due,
        "last_reviewed": it.last_reviewed,
        "created_at": it.created_at,
    }


def _record_to_dict(r: ReviewRecord) -> dict:
    return {
        "item_id": r.item_id,
        "timestamp": r.timestamp,
        "quality": r.quality,
        "elapsed": r.elapsed,
        "scheduled_interval": r.scheduled_interval,
        "stability_before": r.stability_before,
        "stability_after": r.stability_after,
        "difficulty_before": r.difficulty_before,
        "difficulty_after": r.difficulty_after,
    }


def _load_str(raw: dict, key: str, path: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise PersistenceError(f"{path}.{key}: 必须为非空字符串，实际为 {value!r}")
    return value


def _load_int(raw: dict, key: str, path: str) -> int:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, int):
        raise PersistenceError(f"{path}.{key}: 必须为整数，实际为 {value!r}")
    return value


def _load_nonneg_int(raw: dict, key: str, path: str) -> int:
    value = _load_int(raw, key, path)
    if value < 0:
        raise PersistenceError(f"{path}.{key}: 必须 >= 0，实际为 {value}")
    return value


def _load_positive(raw: dict, key: str, path: str) -> float:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PersistenceError(
            f"{path}.{key}: 必须为正数，实际类型为 {type(value).__name__}"
        )
    if not math.isfinite(value) or value <= 0:
        raise PersistenceError(f"{path}.{key}: 必须为正数，实际为 {value!r}")
    return float(value)
