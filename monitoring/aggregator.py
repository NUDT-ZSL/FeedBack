"""时间窗口聚合与多维标签索引。

设计要点
--------
* 窗口基于**事件时间**（事件自带 timestamp），与到达顺序无关，天然支持乱序。
* 支持两类窗口：
  - 固定窗口（tumbling）：``size`` 秒一个，互不重叠；
  - 滑动窗口（sliding/hopping）：窗口长 ``size`` 秒，每 ``slide`` 秒启动一个。
* 每个窗口内部不保存原始事件，只维护四项部分统计量
  ``(count, sum, min, max)``（avg 由 sum/count 导出），因此 10 万事件只有
  少量窗口，内存与速度都很稳定。
* 标签组以排序后的 ``(key, value)`` 元组作为字典键直接索引——这是一个扁平的
  多维标签联合索引：按 ``service+instance`` 等声明维度分组时 O(1) 定位标签组；
  查询时标签过滤器（精确/通配）在各窗口的标签组上匹配。
"""

from __future__ import annotations

import fnmatch
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterator, Mapping, Sequence

from .models import MetricEvent, TimeSeriesPoint, round2

EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
AGG_FUNCS = ("sum", "avg", "min", "max", "count")


# --------------------------------------------------------------------------- #
# 配置 / 查询参数
# --------------------------------------------------------------------------- #
@dataclass(frozen=True, slots=True)
class WindowConfig:
    """窗口配置。

    :param size_seconds: 窗口长度（秒）。
    :param slide_seconds: 滑动步长（秒）；等于 ``size_seconds``（默认）时为固定窗口。
    :param group_by: 聚合分组标签键，如 ``("service", "instance")``；
        空元组表示把所有事件聚成一组。
    :param allowed_lateness_seconds: 允许乱序延迟（秒）；超过 watermark 该延迟
        仍会落入正确的历史窗口（若窗口尚在保留期内），否则被丢弃并计数。
    """

    size_seconds: int = 60
    slide_seconds: int | None = None
    group_by: tuple[str, ...] = ()
    allowed_lateness_seconds: int = 300

    def __post_init__(self) -> None:
        if not isinstance(self.size_seconds, int) or self.size_seconds <= 0:
            raise ValueError("size_seconds 必须是正整数")
        slide = self.size_seconds if self.slide_seconds is None else self.slide_seconds
        if not isinstance(slide, int) or slide <= 0:
            raise ValueError("slide_seconds 必须是正整数")
        if slide > self.size_seconds:
            raise ValueError("slide_seconds 不能大于 size_seconds")
        if self.size_seconds % slide != 0:
            raise ValueError("size_seconds 必须能被 slide_seconds 整除")
        if not isinstance(self.allowed_lateness_seconds, int) or self.allowed_lateness_seconds < 0:
            raise ValueError("allowed_lateness_seconds 必须是非负整数")
        object.__setattr__(self, "slide_seconds", slide)
        object.__setattr__(self, "group_by", tuple(self.group_by))

    @property
    def tumbling(self) -> bool:
        return self.slide_seconds == self.size_seconds


@dataclass(frozen=True, slots=True)
class TimeRange:
    """半开查询区间 ``[start, end)``，端点可传 ISO 字符串或 datetime / None。"""

    start: datetime | None = None
    end: datetime | None = None

    def contains(self, dt: datetime) -> bool:
        if self.start is not None and dt < self.start:
            return False
        if self.end is not None and dt >= self.end:
            return False
        return True


class TagFilter:
    """标签过滤器：精确匹配 + ``*`` 通配符。

    构造方式::

        TagFilter(exact={"service": "auth"})
        TagFilter(wild={"region": "cn-*"})

    匹配语义：过滤器内的每个条件都必须满足（AND）；未出现在过滤器中的标签
    不做限制。``*`` 单独作为值时等价于“该标签存在且非空”（由调用方保证）。
    """

    __slots__ = ("exact", "wild")

    def __init__(
        self,
        exact: Mapping[str, str] | None = None,
        wild: Mapping[str, str] | None = None,
    ) -> None:
        self.exact: dict[str, str] = dict(exact or {})
        self.wild: dict[str, str] = dict(wild or {})
        overlap = set(self.exact) & set(self.wild)
        if overlap:
            raise ValueError(f"同一标签键不能同时精确与通配过滤: {sorted(overlap)}")

    @classmethod
    def from_mapping(cls, conditions: Mapping[str, str] | None) -> "TagFilter":
        """从 ``{tag: value_or_glob}`` 自动拆分精确/通配条件。"""
        exact: dict[str, str] = {}
        wild: dict[str, str] = {}
        for key, pattern in (conditions or {}).items():
            if not isinstance(key, str) or not isinstance(pattern, str):
                raise ValueError("标签过滤器的键和值必须都是字符串")
            if "*" in pattern or "?" in pattern or "[" in pattern:
                wild[key] = pattern
            else:
                exact[key] = pattern
        return cls(exact, wild)

    def matches(self, tags: Mapping[str, str]) -> bool:
        for key, value in self.exact.items():
            if tags.get(key) != value:
                return False
        for key, pattern in self.wild.items():
            value = tags.get(key)
            if value is None or not fnmatch.fnmatchcase(value, pattern):
                return False
        return True

    def to_dict(self) -> dict[str, str]:
        merged = dict(self.exact)
        merged.update(self.wild)
        return merged


# --------------------------------------------------------------------------- #
# 部分统计量
# --------------------------------------------------------------------------- #
@dataclass(slots=True)
class _Stats:
    """单窗口单标签组的增量统计量。"""

    count: int = 0
    total: float = 0.0
    minimum: float = float("inf")
    maximum: float = float("-inf")

    def add(self, value: float) -> None:
        self.count += 1
        self.total += value
        if value < self.minimum:
            self.minimum = value
        if value > self.maximum:
            self.maximum = value

    def aggregate(self, func: str) -> float:
        if func == "sum":
            return self.total
        if func == "count":
            return float(self.count)
        if func == "avg":
            return self.total / self.count
        if func == "min":
            return self.minimum
        if func == "max":
            return self.maximum
        raise ValueError(f"未知聚合函数: {func!r}，可选 {AGG_FUNCS}")


# 标签组标识：排序后只取 group_by 声明的键；值统一 str。
GroupKey = tuple[tuple[str, str], ...]
WindowKey = int  # 窗口起点对应的 Unix 秒（epoch seconds）


@dataclass(slots=True)
class _Window:
    start: int
    end: int
    # group_key -> 统计量
    groups: dict[GroupKey, _Stats] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# 聚合器
# --------------------------------------------------------------------------- #
class WindowAggregator:
    """事件时间窗口聚合器。

    用法::

        agg = WindowAggregator(WindowConfig(60, group_by=("service",)))
        agg.add_event(event)
        points = agg.get_query_result(("avg",), TimeRange(...), TagFilter(...))
    """

    def __init__(self, config: WindowConfig) -> None:
        self.config = config
        # metric_name -> {window_start_epoch: _Window}
        self._windows: dict[str, dict[int, _Window]] = {}
        # 观测过的最大事件时间（epoch 秒，浮点保留亚秒），驱动 watermark。
        self._max_event_time: float | None = None
        self.dropped_late_events = 0
        self.total_events = 0

    # ------------------------------------------------------------------ #
    # 写入
    # ------------------------------------------------------------------ #
    def add_event(self, event: MetricEvent) -> list[tuple[int, int]]:
        """加入一个事件，返回它落入的窗口列表 ``[(start_epoch, end_epoch), ...]``。

        乱序事件与正常事件走完全相同的路径：窗口起点由 timestamp 取整得到，
        因此结果与到达顺序无关。已过保留期（watermark - allowedLateness）
        的窗口事件会被丢弃并计入 ``dropped_late_events``。
        """
        self.total_events += 1
        ts = event.timestamp.timestamp()
        if self._max_event_time is None or ts > self._max_event_time:
            self._max_event_time = ts

        size = self.config.size_seconds
        slide = self.config.slide_seconds  # type: ignore[assignment]
        group_key = self._group_key(event.tags)

        # 滑动窗口：事件属于“所有起点 slide 对齐、且 [start,start+size) 覆盖 ts”的窗口。
        last_start = int(ts // slide) * slide
        first_start = last_start - (size - slide)
        placed: list[tuple[int, int]] = []
        metric_windows = self._windows.setdefault(event.metric_name, {})
        for start in range(first_start, last_start + 1, slide):
            if start < 0 or self._is_expired(start):
                self.dropped_late_events += 1
                continue
            window = metric_windows.get(start)
            if window is None:
                window = _Window(start=start, end=start + size)
                metric_windows[start] = window
            stats = window.groups.get(group_key)
            if stats is None:
                stats = _Stats()
                window.groups[group_key] = stats
            stats.add(event.value)
            placed.append((start, start + size))
        return placed

    def _is_expired(self, window_start: int) -> bool:
        """窗口是否已超过乱序保留期而封口。

        watermark = 已观测最大事件时间；当
        ``window_end + allowed_lateness <= watermark`` 时封口，
        迟到事件无法再写入（但不影响其它未封口窗口）。
        """
        if self._max_event_time is None:
            return False
        seal_time = window_start + self.config.size_seconds + self.config.allowed_lateness_seconds
        return seal_time <= self._max_event_time

    def _group_key(self, tags: Mapping[str, str]) -> GroupKey:
        # ("*",) 表示按事件的完整标签集分组（引擎内部按规则过滤标签组时使用）。
        if self.config.group_by == ("*",):
            return tuple(sorted((k, str(v)) for k, v in tags.items()))
        return tuple(sorted((k, str(tags[k])) for k in self.config.group_by if k in tags))

    # ------------------------------------------------------------------ #
    # watermark / 窗口生命周期
    # ------------------------------------------------------------------ #
    @property
    def watermark(self) -> datetime | None:
        """当前 watermark（已观测最大事件时间）。"""
        if self._max_event_time is None:
            return None
        return datetime.fromtimestamp(self._max_event_time, tz=timezone.utc)

    def sealed_window_ends(self) -> list[int]:
        """返回按 watermark - allowedLateness 已经封口、可安全评估的窗口终点。"""
        if self._max_event_time is None:
            return []
        grace = self.config.allowed_lateness_seconds
        # 窗口终点 <= watermark - grace 即封口（与 _is_expired 保持同一判定）。
        seal_boundary = self._max_event_time - grace
        ends: list[int] = []
        for metric_windows in self._windows.values():
            for window in metric_windows.values():
                if window.end <= seal_boundary:
                    ends.append(window.end)
        return sorted(set(ends))

    def purge_expired_windows(self) -> None:
        """物理删除封口窗口，释放内存（评估完成后由引擎调用）。"""
        if self._max_event_time is None:
            return
        grace = self.config.allowed_lateness_seconds
        boundary = self._max_event_time - grace
        for metric, metric_windows in list(self._windows.items()):
            for start in list(metric_windows):
                if start + self.config.size_seconds <= boundary:
                    del metric_windows[start]
            if not metric_windows:
                del self._windows[metric]

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    def get_query_result(
        self,
        funcs: str | Sequence[str],
        time_range: TimeRange | None = None,
        tag_filter: TagFilter | None = None,
        metric_name: str | None = None,
    ) -> list[TimeSeriesPoint]:
        """查询聚合时间序列。

        :param funcs: 单个聚合函数或函数列表（``sum/avg/min/max/count``）。
        :param time_range: 按窗口起点过滤的时间范围；``None`` 表示全部。
        :param tag_filter: 标签过滤器；``None`` 表示不过滤。
        :param metric_name: 仅查某个指标；``None`` 表示所有指标。
        :returns: 按 (指标, 函数, 窗口起点, 标签组) 排序的时间序列点列表。
        """
        if isinstance(funcs, str):
            func_list = [funcs]
        else:
            func_list = list(funcs)
        for f in func_list:
            if f not in AGG_FUNCS:
                raise ValueError(f"未知聚合函数: {f!r}，可选 {AGG_FUNCS}")

        results: list[TimeSeriesPoint] = []
        metrics = [metric_name] if metric_name else sorted(self._windows)
        for metric in metrics:
            for window in sorted((w for w in self._windows.get(metric, {}).values()),
                                 key=lambda w: w.start):
                start_dt = datetime.fromtimestamp(window.start, tz=timezone.utc)
                end_dt = datetime.fromtimestamp(window.end, tz=timezone.utc)
                if time_range is not None and not time_range.contains(start_dt):
                    continue
                for group_key in sorted(window.groups):
                    tags = dict(group_key)
                    if tag_filter is not None and not tag_filter.matches(tags):
                        continue
                    stats = window.groups[group_key]
                    for func in func_list:
                        results.append(
                            TimeSeriesPoint(
                                timestamp=start_dt,
                                tags=tags,
                                value=round2(stats.aggregate(func)),
                                metric_name=metric,
                                func=func,
                                window_start=start_dt,
                                window_end=end_dt,
                            )
                        )
        return results

    def iter_window_slices(
        self,
        window_end: int,
    ) -> Iterator[tuple[str, int, int, Mapping[str, str], _Stats]]:
        """遍历某个已封口窗口终点下所有 (指标, 标签组) 统计量，供告警引擎使用。"""
        for metric, metric_windows in self._windows.items():
            start = window_end - self.config.size_seconds
            window = metric_windows.get(start)
            if window is None:
                continue
            for group_key, stats in window.groups.items():
                yield metric, start, window_end, dict(group_key), stats

    # ------------------------------------------------------------------ #
    # 辅助
    # ------------------------------------------------------------------ #
    def window_starts(self, metric_name: str) -> list[datetime]:
        """某指标现存的全部窗口起点（调试用）。"""
        return [
            datetime.fromtimestamp(start, tz=timezone.utc)
            for start in sorted(self._windows.get(metric_name, {}))
        ]

    @staticmethod
    def floor_to_window(dt: datetime, size_seconds: int) -> datetime:
        """把时间戳向下取整到固定窗口起点（测试与外部复用）。"""
        epoch = int(dt.timestamp())
        return datetime.fromtimestamp(epoch - epoch % size_seconds, tz=timezone.utc)
