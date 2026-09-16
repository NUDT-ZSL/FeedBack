"""mapmatching.geometry —— 平面近似坐标下的几何计算。

坐标约定：本模块的坐标 x/y 为同一度量单位（例如经局部横轴墨卡托投影
得到的“米”）。模块也提供 lon/lat 经纬度 -> 米制平面近似的工具函数
:func:`great_circle_meters`，演示数据使用它构造坐标。

设计上不依赖任何第三方库，只用标准库 math。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Tuple


@dataclass(frozen=True)
class Point:
    """一个采样/节点坐标。单位约定见模块文档字符串。"""

    x: float
    y: float

    def distance_to(self, other: "Point") -> float:
        return math.hypot(self.x - other.x, self.y - other.y)


class Geometry:
    """无状态的几何工具集合，全部为静态方法。"""

    @staticmethod
    def distance_point_to_segment(p: Point, a: Point, b: Point) -> float:
        """点 p 到线段 ab 的垂直（最短）距离。"""
        dx, dy = b.x - a.x, b.y - a.y
        length_sq = dx * dx + dy * dy
        if length_sq == 0.0:
            return p.distance_to(a)
        t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length_sq
        t = max(0.0, min(1.0, t))
        proj_x = a.x + t * dx
        proj_y = a.y + t * dy
        return math.hypot(p.x - proj_x, p.y - proj_y)

    @staticmethod
    def project_on_segment(p: Point, a: Point, b: Point) -> Tuple[float, float, Point]:
        """点 p 在线段 ab 上的投影。

        返回 ``(t, distance, projected)``：
        * ``t`` —— 投影位置在路段上的比例，``[0,1]``；
        * ``distance`` —— 点到线段的最短距离；
        * ``projected`` —— 垂足坐标（夹紧到端点）。
        """
        dx, dy = b.x - a.x, b.y - a.y
        length_sq = dx * dx + dy * dy
        if length_sq == 0.0:
            return 0.0, p.distance_to(a), Point(a.x, a.y)
        t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / length_sq
        t_clamped = max(0.0, min(1.0, t))
        projected = Point(a.x + t_clamped * dx, a.y + t_clamped * dy)
        return t_clamped, p.distance_to(projected), projected

    @staticmethod
    def segment_length(a: Point, b: Point) -> float:
        return a.distance_to(b)


def great_circle_meters(lon: float, lat: float, lon0: float = 0.0, lat0: float = 0.0) -> Point:
    """把经纬度换算为相对原点 ``(lon0, lat0)`` 的米制平面坐标（局部等距近似）。

    这是一个足够离线演示/验收使用的局部投影：东西方向按原点纬度修正
    经度周长，南北方向按每度 111_320 米。坐标单位为米，因此匹配阈值、
    路段长度等都可以直接用米表达。
    """
    lat_rad = math.radians(lat0)
    meters_per_deg_lon = 111_320.0 * math.cos(lat_rad)
    meters_per_deg_lat = 111_320.0
    return Point(
        x=(lon - lon0) * meters_per_deg_lon,
        y=(lat - lat0) * meters_per_deg_lat,
    )
