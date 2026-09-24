"""Manual override (auto-merge + validation) and the full analysis pipeline."""
from engine import (MIN_STOP_DURATION_S, LOW_ACCURACY_M, detect_drift,
                    effective_radius)
from segments import make_segment, build_segments, assign_ids


def validate_segment(seg, points):
    """Check a (usually user-overridden) segment against the stop criteria."""
    w = []
    r = effective_radius(points, seg["start_idx"], seg["end_idx"])
    if seg["type"] == "stop":
        if seg["duration_s"] < MIN_STOP_DURATION_S:
            w.append("时长 %.0f 分钟，低于停驻最短时长 %.0f 分钟"
                     % (seg["duration_s"] / 60, MIN_STOP_DURATION_S / 60))
        if seg["range_m"] > r:
            w.append("覆盖范围 %.0f m，超出停驻半径阈值 %.0f m"
                     % (seg["range_m"], r))
    elif seg["type"] == "move":
        if seg["duration_s"] >= MIN_STOP_DURATION_S and seg["range_m"] <= r:
            w.append("该段时长与空间范围满足停驻判定条件，实际可能为停驻")
    seg["warnings"] = w


def merge_two(points, first, second):
    return make_segment(points, first["start_idx"], second["end_idx"],
                        first["type"],
                        overridden=first["overridden"] or second["overridden"])


def apply_override(points, segments, seg_id, new_type):
    """Set segment type, auto-merge adjacent same-type segments, validate.

    The user's decision is always kept; criteria violations only add warnings.
    """
    idx = next((i for i, s in enumerate(segments) if s["id"] == seg_id), None)
    if idx is None:
        raise KeyError("segment not found: %r" % seg_id)
    seg = segments[idx]
    seg["type"] = new_type
    seg["overridden"] = True
    seg["reasons"] = []
    validate_segment(seg, points)
    early_warnings = list(seg["warnings"])
    while idx > 0 and segments[idx - 1]["type"] == new_type:
        prev = segments.pop(idx - 1)
        idx -= 1
        seg = merge_two(points, prev, seg)
    while idx + 1 < len(segments) and segments[idx + 1]["type"] == new_type:
        seg = merge_two(points, seg, segments.pop(idx + 1))
    segments[idx] = seg
    validate_segment(seg, points)
    for w in early_warnings:
        if w not in seg["warnings"]:
            seg["warnings"].append(w)
    assign_ids(segments)
    return seg


def compute_stats(segments):
    def total(t, key):
        return sum(s[key] for s in segments if s["type"] == t)
    return {
        "stop_count": sum(1 for s in segments if s["type"] == "stop"),
        "move_count": sum(1 for s in segments if s["type"] == "move"),
        "uncertain_count": sum(1 for s in segments if s["type"] == "uncertain"),
        "total_stop_s": total("stop", "duration_s"),
        "total_move_s": total("move", "duration_s"),
        "total_move_m": total("move", "distance_m"),
        "uncertain_s": total("uncertain", "duration_s"),
        "overridden_count": sum(1 for s in segments if s["overridden"]),
    }


def analyze(raw_points):
    """Full pipeline. raw_points: time-sorted list of {t, lat, lon, acc, device}."""
    drift = detect_drift(raw_points)
    clean = [p for i, p in enumerate(raw_points) if i not in drift]
    segments = build_segments(clean)
    assign_ids(segments)
    notices = []
    if drift:
        notices.append("识别到 %d 个明显漂移点，已在分析中剔除（地图上以红色 × 标出）"
                       % len(drift))
    low_acc = sum(1 for p in clean if p.get("acc") and p["acc"] > LOW_ACCURACY_M)
    if low_acc:
        notices.append("%d 个定位点精度半径超过 %.0f m，相关段判定可信度较低"
                       % (low_acc, LOW_ACCURACY_M))
    return {
        "points": clean,
        "drift": [{"lat": raw_points[i]["lat"], "lon": raw_points[i]["lon"],
                   "t": raw_points[i]["t"], "reason": r}
                  for i, r in sorted(drift.items())],
        "notices": notices,
        "segments": segments,
        "stats": compute_stats(segments),
    }
