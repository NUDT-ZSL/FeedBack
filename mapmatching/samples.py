"""mapmatching.samples —— 带误差定位序列的登记。

登记规则（对应需求 2）
----------------------
* 每个采样点 :class:`Observation` 带：逻辑时刻 ``tick``（整数/可比较的
  标量）、坐标 :class:`~mapmatching.geometry.Point`、来源标识 ``source``
  与来源内序号 ``seq``。
* 同一轨迹 :class:`Track` 内，同一来源的时刻必须单调不减；
  出现倒退直接拒绝（:class:`SampleValidationError`），问题点与上一点
  都会写进异常，方便定位。
* ``(source, seq)`` 唯一：重复上报按幂等处理——内容相同则直接忽略，
  并在 :attr:`Track.duplicates` 中留痕；内容不同视为“同源自相矛盾”
  （同一次上报不可能给两个坐标），拒绝接收，不静默覆盖。
* 不同来源在同一逻辑时刻可以各自上报一个点（多源冗余），登记时各自
  独立维护，后续由冲突检测模块处理（见 :mod:`mapmatching.tracker`）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from .errors import MapMatchingError
from .geometry import Point


class SampleValidationError(MapMatchingError):
    """采样点不满足登记约束（时刻倒退、同源矛盾等）。"""


@dataclass(frozen=True)
class DuplicateIgnored:
    """一次被幂等忽略的重复上报留痕。"""

    source: str
    seq: int
    tick: int
    reason: str = "identical_resubmission"


@dataclass(frozen=True)
class Observation:
    """一个带误差的定位采样点。

    属性：
        tick: 逻辑时刻（越大越晚，允许相等，表示同一时刻的不同来源）。
        point: 采样坐标。
        source: 来源标识（设备 / 供应商 / 算法通道名）。
        seq: 该来源内的上报序号，用于幂等判重。
    """

    tick: int
    point: Point
    source: str
    seq: int

    def key(self) -> Tuple[str, int]:
        return self.source, self.seq


class Track:
    """同一目标（车辆）的一条登记轨迹，可含多个来源的点。"""

    def __init__(self, track_id: str):
        self.track_id = track_id
        # 保持登记顺序的全部采样点
        self._observations: List[Observation] = []
        # (source, seq) -> 已接收的点
        self._by_source_seq: Dict[Tuple[str, int], Observation] = {}
        # source -> 该来源最后一个点的 tick（单调不减校验）
        self._last_tick: Dict[str, int] = {}
        # 幂等忽略留痕
        self.duplicates: List[DuplicateIgnored] = []

    # ------------------------------------------------------------------ #
    # 登记
    # ------------------------------------------------------------------ #
    def add(
        self,
        tick: int,
        point: Point,
        source: str,
        seq: int,
    ) -> Optional[Observation]:
        """登记一个采样点。

        * 返回 :class:`Observation` 表示新接收；
        * 返回 ``None`` 表示重复且内容一致，已幂等忽略（留痕见
          :attr:`duplicates`）；
        * 时刻倒退或同源同序号内容冲突时抛
          :class:`SampleValidationError`。
        """
        obs = Observation(tick=tick, point=point, source=source, seq=seq)

        previous = self._by_source_seq.get(obs.key())
        if previous is not None:
            if previous.point == point and previous.tick == tick:
                self.duplicates.append(
                    DuplicateIgnored(
                        source=source,
                        seq=seq,
                        tick=tick,
                        reason="identical_resubmission",
                    )
                )
                return None
            raise SampleValidationError(
                f"来源 {source} 的序号 {seq} 重复但内容矛盾："
                f"首次上报 tick={previous.tick} 坐标{self._fmt(previous.point)}，"
                f"重复上报 tick={tick} 坐标{self._fmt(point)}；"
                f"同源同序号必须一致，幂等接口不允许静默覆盖"
            )

        last_tick = self._last_tick.get(source)
        if last_tick is not None and tick < last_tick:
            raise SampleValidationError(
                f"来源 {source} 时刻必须单调不减：序号 {seq} 的 tick={tick} "
                f"早于该来源上一点 tick={last_tick}"
            )

        self._observations.append(obs)
        self._by_source_seq[obs.key()] = obs
        self._last_tick[source] = tick
        return obs

    def add_many(self, observations: List[Observation]) -> List[Optional[Observation]]:
        return [self.add(o.tick, o.point, o.source, o.seq) for o in observations]

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #
    @property
    def observations(self) -> List[Observation]:
        """按登记顺序返回全部采样点。"""
        return list(self._observations)

    def sources(self) -> List[str]:
        return sorted(self._last_tick.keys())

    def by_source(self, source: str) -> List[Observation]:
        """某来源的全部点，按登记（即 tick 不减）顺序。"""
        return [o for o in self._observations if o.source == source]

    def by_tick(self) -> Dict[int, List[Observation]]:
        """按逻辑时刻分组（同 tick 下可有多个来源的点）。"""
        grouped: Dict[int, List[Observation]] = {}
        for obs in sorted(self._observations, key=lambda o: (o.tick, o.source)):
            grouped.setdefault(obs.tick, []).append(obs)
        return grouped

    def tick_range(self) -> Tuple[Optional[int], Optional[int]]:
        if not self._observations:
            return None, None
        ticks = [o.tick for o in self._observations]
        return min(ticks), max(ticks)

    def __len__(self) -> int:
        return len(self._observations)

    @staticmethod
    def _fmt(p: Point) -> str:
        return f"({p.x:.2f}, {p.y:.2f})"
