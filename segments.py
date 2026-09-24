"""Segment building: stop/move/uncertain splitting and per-segment stats."""
from engine import (GAP_THRESHOLD_S, haversine_m, effective_radius,
                    find_stops)


def make_segment(points, s, e, seg_type, reasons=None, overridden=False):
    pts = points[s:e + 1]
    duration = max(pts[-1]["t"] - pts[0]["t"], 0.0)
    clat = sum(p["lat"] for p in pts) / len(pts)
    clon = sum(p["lon"] for p in pts) / len(pts)
    range_m = max((haversine_m(p["lat"], p["lon"], clat, clon) for p in pts),
                  default=0.0)
    dist = sum(haversine_m(pts[k]["lat"], pts[k]["lon"],
                           pts[k + 1]["lat"], pts[k + 1]["lon"])
               for k in range(len(pts) - 1))
    speed = dist / duration * 3.6 if duration > 0 else 0.0
    return {
        "type": seg_type, "start_idx": s, "end_idx": e,
        "start_time": pts[0]["t"], "end_time": pts[-1]["t"],
        "duration_s": duration, "center": {"lat": clat, "lon": clon},
        "range_m": range_m, "distance_m": dist, "avg_speed_kmh": speed,
        "point_count": len(pts), "reasons": list(reasons or []),
        "warnings": [], "overridden": overridden,
    }


def build_move_segments(points, a, b):
    """Move segments for points[a..b]; long gaps become 'uncertain'."""
    segs = []
    start = a
    k = a
    while k < b:
        gap = points[k + 1]["t"] - points[k]["t"]
        if gap > GAP_THRESHOLD_S:
            if k >= start:
                segs.append(make_segment(points, start, k, "move"))
            d = haversine_m(points[k]["lat"], points[k]["lon"],
                            points[k + 1]["lat"], points[k + 1]["lon"])
            reasons = ["相邻两点间隔 %.0f 分钟，超过阈值 %.0f 分钟，期间疑似丢点，"
                       "归属无法可靠判定" % (gap / 60, GAP_THRESHOLD_S / 60)]
            if d > effective_radius(points, k, k + 1):
                reasons.append("断档两端位移约 %.0f m，期间可能发生了移动，"
                               "也可能包含停驻" % d)
            segs.append(make_segment(points, k, k + 1, "uncertain",
                                     reasons=reasons))
            start = k + 1
        k += 1
    if b >= start:
        segs.append(make_segment(points, start, b, "move"))
    return segs


def build_segments(points):
    segs = []
    prev = 0
    for s, e in find_stops(points):
        if s > prev:
            segs.extend(build_move_segments(points, prev, s - 1))
        segs.append(make_segment(points, s, e, "stop"))
        prev = e + 1
    if prev < len(points):
        segs.extend(build_move_segments(points, prev, len(points) - 1))
    segs = insert_gap_segments(points, segs)
    segs = merge_adjacent(points, segs)
    return segs


def insert_gap_segments(points, segs):
    """Mark long silences at segment boundaries as 'uncertain' too."""
    out = []
    for s in segs:
        if out:
            prev = out[-1]
            a, b = points[prev["end_idx"]], points[s["start_idx"]]
            gap = b["t"] - a["t"]
            if gap > GAP_THRESHOLD_S:
                d = haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
                reasons = ["相邻两点间隔 %.0f 分钟，超过阈值 %.0f 分钟，期间疑似丢点，"
                           "归属无法可靠判定" % (gap / 60, GAP_THRESHOLD_S / 60)]
                if d > effective_radius(points, prev["end_idx"], s["start_idx"]):
                    reasons.append("断档两端位移约 %.0f m，期间可能发生了移动，"
                                   "也可能包含停驻" % d)
                out.append(make_segment(points, prev["end_idx"], s["start_idx"],
                                        "uncertain", reasons=reasons))
        out.append(s)
    return out


def merge_adjacent(points, segs):
    """Merge neighbouring same-type segments (uncertain never merges)."""
    out = []
    for s in segs:
        if (out and out[-1]["type"] == s["type"] and s["type"] != "uncertain"
                and out[-1]["end_idx"] + 1 >= s["start_idx"]):
            prev = out.pop()
            out.append(make_segment(points, prev["start_idx"], s["end_idx"],
                                    s["type"],
                                    overridden=prev["overridden"] or s["overridden"]))
        else:
            out.append(s)
    return out


def assign_ids(segments):
    for i, s in enumerate(segments):
        s["id"] = i
