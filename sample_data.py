"""内置示例轨迹:覆盖停驻、移动、漂移点、长间隔丢点、精度差等场景。"""
from __future__ import annotations

import math
import random

from segmenter import Point

BASE_LAT, BASE_LON = 31.2304, 121.4737  # 上海市中心附近


def _jitter(rng, lat, lon, radius_m):
    dlat = rng.uniform(-1, 1) * radius_m / 111320.0
    dlon = rng.uniform(-1, 1) * radius_m / (111320.0 * math.cos(math.radians(lat)))
    return lat + dlat, lon + dlon


def _stay(rng, pts, t0, minutes, lat, lon, step_s=30, acc=15.0):
    n = int(minutes * 60 / step_s)
    for k in range(n):
        la, lo = _jitter(rng, lat, lon, 25)
        pts.append(Point(t=t0 + k * step_s, lat=la, lon=lo,
                         acc=acc + rng.uniform(-5, 10)))
    return t0 + n * step_s


def _move(rng, pts, t0, lat0, lon0, lat1, lon1, minutes, step_s=20, acc=12.0):
    n = max(2, int(minutes * 60 / step_s))
    for k in range(n):
        f = k / (n - 1)
        la, lo = _jitter(rng, lat0 + (lat1 - lat0) * f,
                         lon0 + (lon1 - lon0) * f, 8)
        pts.append(Point(t=t0 + k * step_s, lat=la, lon=lo,
                         acc=acc + rng.uniform(-4, 8)))
    return t0 + n * step_s


def build():
    rng = random.Random(20260924)
    pts = []
    t = 1758700000.0  # 固定起点时间
    home = (BASE_LAT, BASE_LON)
    cafe = (BASE_LAT + 0.008, BASE_LON + 0.012)
    office = (BASE_LAT - 0.010, BASE_LON + 0.020)
    # 1) 在家停驻 40 分钟,中间混入一个乒乓漂移点和一个精度极差点
    t = _stay(rng, pts, t, 40, *home)
    drift_t = pts[len(pts) // 2].t + 5
    pts.append(Point(t=drift_t, lat=home[0] + 0.05, lon=home[1] + 0.06, acc=30))
    pts.append(Point(t=pts[-2].t + 8, lat=home[0], lon=home[1], acc=260))
    # 2) 步行去咖啡馆 12 分钟
    t = _move(rng, pts, t, *home, *cafe, 12)
    # 3) 咖啡馆停驻 25 分钟
    t = _stay(rng, pts, t, 25, *cafe)
    # 4) 去办公室 15 分钟,途中设备丢点 14 分钟(产生待确认段)
    t = _move(rng, pts, t, *cafe,
              cafe[0] - 0.009, cafe[1] + 0.004, 8)
    t += 14 * 60  # 丢点间隔
    t = _move(rng, pts, t, cafe[0] - 0.012, cafe[1] + 0.006, *office, 7)
    # 5) 办公室停驻 60 分钟,采样稀疏(90 秒)且精度一般
    t = _stay(rng, pts, t, 60, *office, step_s=90, acc=45)
    # 6) 返程 18 分钟
    t = _move(rng, pts, t, *office, *home, 18)
    # 7) 到家停驻 20 分钟
    _stay(rng, pts, t, 20, *home)
    pts.sort(key=lambda p: p.t)
    return pts
