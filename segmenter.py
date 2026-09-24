"""轨迹分割核心算法:漂移点检测、停驻/移动切分、不确定段标记、用户覆盖与自动合并。"""
from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_R = 6371000.0


def haversine(lat1, lon1, lat2, lon2):
    """两点间大圆距离(米)。"""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


DEFAULT_PARAMS = {
    "stay_radius": 60.0,        # 停驻空间聚集半径(米)
    "min_stay_duration": 180.0, # 最短停驻时长(秒)
    "max_speed": 45.0,          # 瞬时速度超过该值视为漂移(米/秒)
    "gap_threshold": 300.0,     # 采样间隔超过该值产生待确认段(秒)
    "default_acc": 25.0,        # 缺失精度时使用的默认精度半径(米)
    "acc_limit": 120.0,         # 精度半径差于该值给出提示(米)
    "min_move_speed": 0.5,      # 移动段平均速度低于该值给出提示(米/秒)
}


@dataclass
class Point:
    t: float                  # Unix 时间戳(秒)
    lat: float
    lon: float
    acc: float | None = None  # 精度半径(米),可空

    def acc_eff(self, params):
        return self.acc if self.acc is not None else params["default_acc"]


def _dist(a: Point, b: Point) -> float:
    return haversine(a.lat, a.lon, b.lat, b.lon)


def detect_drift(points, params):
    """检测漂移/异常点。

    返回 {原始下标: {"excluded": bool, "reasons": [str]}}。
    excluded=True 的点在分段前剔除;精度差但未漂移的点仅提示、仍参与分段。
    """
    flags = {}
    n = len(points)
    vmax = params["max_speed"]
    for i, p in enumerate(points):
        reasons = []
        excluded = False
        if p.acc is not None and p.acc > params["acc_limit"]:
            reasons.append("精度半径 %.0fm,定位质量差" % p.acc)
        prev_ok = i > 0 and points[i - 1].t < p.t
        next_ok = i < n - 1 and points[i + 1].t > p.t
        v_prev = _dist(points[i - 1], p) / (p.t - points[i - 1].t) if prev_ok else 0.0
        v_next = _dist(p, points[i + 1]) / (points[i + 1].t - p.t) if next_ok else 0.0
        if prev_ok and next_ok:
            span = _dist(points[i - 1], points[i + 1])
            if v_prev > vmax and v_next > vmax and span < params["stay_radius"] * 3:
                excluded = True
                reasons.append("瞬移后返回(乒乓漂移),往返速度 %.0f m/s" % max(v_prev, v_next))
        if not excluded and prev_ok and next_ok and min(v_prev, v_next) > vmax:
            excluded = True
            reasons.append("瞬时速度 %.0f m/s 超出合理范围" % min(v_prev, v_next))
        if reasons:
            flags[i] = {"excluded": excluded, "reasons": reasons}
    return flags


def _centroid(pts):
    return (sum(p.lat for p in pts) / len(pts), sum(p.lon for p in pts) / len(pts))


def _extent(pts):
    """点集相对质心的最大散布距离(米)。"""
    clat, clon = _centroid(pts)
    return max(haversine(p.lat, p.lon, clat, clon) for p in pts)


def _eff_radius(pts, params):
    """停驻有效半径:基础半径与点集平均精度取大者,精度差时放宽聚集要求。"""
    mean_acc = sum(p.acc_eff(params) for p in pts) / len(pts)
    return max(params["stay_radius"], mean_acc)


def _classify_run(run, params):
    """对一段采样连续的点序列打 stay/move 标签(滑动窗口 + 时长约束)。"""
    n = len(run)
    labels = ["move"] * n
    i = 0
    while i < n:
        best = -1
        j = i
        while j < n:
            cand = run[i:j + 1]
            if _extent(cand) <= _eff_radius(cand, params):
                if run[j].t - run[i].t >= params["min_stay_duration"]:
                    best = j
                j += 1
            else:
                break
        if best >= 0:
            for k in range(i, best + 1):
                labels[k] = "stay"
            i = best + 1
        else:
            i += 1
    return labels


def compute_stats(seg, pts, params):
    """按 seg 的 [start_idx, end_idx](过滤后点列下标)重算统计量。"""
    sp = pts[seg["start_idx"]:seg["end_idx"] + 1]
    seg["start_time"] = sp[0].t
    seg["end_time"] = sp[-1].t
    seg["duration"] = sp[-1].t - sp[0].t
    seg["distance"] = sum(_dist(sp[k], sp[k + 1]) for k in range(len(sp) - 1))
    seg["avg_speed"] = seg["distance"] / seg["duration"] if seg["duration"] > 0 else 0.0
    seg["extent"] = _extent(sp) if len(sp) > 1 else 0.0
    clat, clon = _centroid(sp)
    seg["center"] = [clat, clon]
    seg["bbox"] = [[min(p.lat for p in sp), min(p.lon for p in sp)],
                   [max(p.lat for p in sp), max(p.lon for p in sp)]]
    seg["point_count"] = len(sp)
    return seg


def check_validity(seg, params):
    """覆盖调整后校验:不满足原判定条件时给出提示(仍保留用户决定)。"""
    warns = []
    if seg["type"] == "stay":
        if seg["duration"] < params["min_stay_duration"]:
            warns.append("时长 %.0f 分钟,不足停驻判定所需的 %.0f 分钟"
                         % (seg["duration"] / 60, params["min_stay_duration"] / 60))
        if seg["extent"] > params["stay_radius"]:
            warns.append("散布范围 %.0fm,超出停驻半径 %.0fm"
                         % (seg["extent"], params["stay_radius"]))
    elif seg["type"] == "move":
        if seg["avg_speed"] < params["min_move_speed"]:
            warns.append("平均速度 %.2f m/s,低于移动判定阈值 %.2f m/s"
                         % (seg["avg_speed"], params["min_move_speed"]))
    return warns


def segment(points, params):
    """主流程:漂移剔除 -> 按采样间隔切块 -> 块内停驻/移动分类 -> 组装分段。

    返回 (segments, drift_flags, kept_indices)。segments 的下标基于过滤后点列。
    """
    flags = detect_drift(points, params)
    kept = [i for i in range(len(points))
            if not (i in flags and flags[i]["excluded"])]
    pts = [points[i] for i in kept]
    gap = params["gap_threshold"]
    # 按大间隔切块,块间生成待确认段
    blocks = []
    start = 0
    for k in range(1, len(pts)):
        if pts[k].t - pts[k - 1].t > gap:
            blocks.append((start, k - 1))
            start = k
    if pts:
        blocks.append((start, len(pts) - 1))
    segments = []
    prev_end = None
    for (b0, b1) in blocks:
        if prev_end is not None:
            gap_s = pts[b0].t - pts[prev_end].t
            seg = {"type": "uncertain", "start_idx": prev_end, "end_idx": b0,
                   "overridden": False,
                   "reasons": ["采样间隔 %.1f 分钟,期间无定位数据,该段归属不确定"
                               % (gap_s / 60)]}
            segments.append(compute_stats(seg, pts, params))
        run = pts[b0:b1 + 1]
        labels = _classify_run(run, params)
        k = 0
        while k < len(run):
            j = k
            while j + 1 < len(run) and labels[j + 1] == labels[k]:
                j += 1
            seg = {"type": labels[k], "start_idx": b0 + k, "end_idx": b0 + j,
                   "overridden": False, "reasons": []}
            segments.append(compute_stats(seg, pts, params))
            k = j + 1
        prev_end = b1
    for idx, seg in enumerate(segments):
        seg["id"] = idx
        seg["warnings"] = []
    return segments, flags, kept


def override_segment(segments, pts, seg_id, new_type, params):
    """用户把某段重新指定为 stay/move:合并相邻同类段、重算统计、校验提示。"""
    if new_type not in ("stay", "move"):
        raise ValueError("只能指定为 stay 或 move")
    seg = next(s for s in segments if s["id"] == seg_id)
    seg["type"] = new_type
    seg["overridden"] = True
    # 相邻同类型段自动合并(可能连锁)
    merged = True
    while merged:
        merged = False
        idx = segments.index(seg)
        for nb in (idx - 1, idx + 1):
            if 0 <= nb < len(segments) and segments[nb]["type"] == seg["type"]:
                other = segments[nb]
                seg["start_idx"] = min(seg["start_idx"], other["start_idx"])
                seg["end_idx"] = max(seg["end_idx"], other["end_idx"])
                seg["overridden"] = seg["overridden"] or other["overridden"]
                seg["reasons"] = list(dict.fromkeys(seg["reasons"] + other["reasons"]))
                segments.remove(other)
                merged = True
                break
    for s in segments:
        compute_stats(s, pts, params)
        s["warnings"] = check_validity(s, params) if s["overridden"] else []
    for idx, s in enumerate(segments):
        s["id"] = idx
    return segments


def summarize(segments, flags):
    """整体统计,用于界面展示调整前后的变化。"""
    by = {"stay": 0.0, "move": 0.0, "uncertain": 0.0}
    dist = 0.0
    for s in segments:
        by[s["type"]] += s["duration"]
        dist += s["distance"]
    return {
        "segment_count": len(segments),
        "stay_duration": by["stay"],
        "move_duration": by["move"],
        "uncertain_duration": by["uncertain"],
        "total_distance": dist,
        "drift_count": sum(1 for f in flags.values() if f["excluded"]),
        "low_acc_count": sum(1 for f in flags.values() if not f["excluded"]),
        "uncertain_count": sum(1 for s in segments if s["type"] == "uncertain"),
    }
