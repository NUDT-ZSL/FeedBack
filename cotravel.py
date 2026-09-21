"""Co-travel (companion) detection between pairs of targets.

Both trajectories are resampled onto a common time grid over their
overlap. Consecutive samples closer than `co_radius_m` form candidate
intervals; gaps shorter than `gap_tolerance_s` are bridged. An interval
lasting at least `co_min_seconds` is a STABLE companion relation,
shorter ones are OCCASIONAL approaches. Confidence combines temporal
coverage and duration.
"""
from geo import haversine_m, interp_point


def _clean(points):
    return sorted((p for p in points if "drift" not in p["flags"]),
                  key=lambda p: (p["t"], p["seq"]))


def compute_pair(target_a, pts_a, target_b, pts_b, params):
    """Return the list of co-travel relations for one target pair."""
    a, b = _clean(pts_a), _clean(pts_b)
    if not a or not b:
        return []
    radius = params["co_radius_m"]
    min_sec = params["co_min_seconds"]
    step = params["sample_step_s"]
    gap_tol = params["gap_tolerance_s"]

    lo, hi = max(a[0]["t"], b[0]["t"]), min(a[-1]["t"], b[-1]["t"])
    if hi <= lo:
        return []

    samples = []  # (t, distance_m or None)
    t = lo
    while t <= hi + 1e-9:
        pa, pb = interp_point(a, t), interp_point(b, t)
        d = None
        if pa and pb:
            d = haversine_m(pa[0], pa[1], pb[0], pb[1])
        samples.append((t, d))
        t += step

    # raw intervals of consecutive close samples
    raw = []
    cur = None
    for t, d in samples:
        close = d is not None and d <= radius
        if close and cur is None:
            cur = [t, t]
        elif close:
            cur[1] = t
        elif cur is not None:
            raw.append(cur)
            cur = None
    if cur is not None:
        raw.append(cur)

    # bridge short gaps
    merged = []
    for iv in raw:
        if merged and iv[0] - merged[-1][1] <= gap_tol:
            merged[-1][1] = iv[1]
        else:
            merged.append(list(iv))

    relations = []
    for start, end in merged:
        dur = end - start
        inside = [(t, d) for t, d in samples if start - 1e-9 <= t <= end + 1e-9]
        close_ds = [d for t, d in inside if d is not None and d <= radius]
        valid = [d for t, d in inside if d is not None]
        coverage = len(close_ds) / len(valid) if valid else 0.0
        mean_d = sum(close_ds) / len(close_ds) if close_ds else None
        kind = "stable" if dur >= min_sec else "occasional"
        conf = round(0.6 * coverage + 0.4 * min(1.0, dur / max(min_sec, 1.0)), 3)
        relations.append({
            "targets": sorted([target_a, target_b]),
            "kind": kind,
            "start": start,
            "end": end,
            "confidence": conf,
            "basis": {
                "duration_s": round(dur, 1),
                "samples": len(valid),
                "close_samples": len(close_ds),
                "coverage": round(coverage, 3),
                "mean_distance_m": round(mean_d, 1) if mean_d is not None else None,
            },
            "params_used": {"co_radius_m": radius,
                            "co_min_seconds": min_sec,
                            "sample_step_s": step,
                            "gap_tolerance_s": gap_tol},
        })
    for idx, r in enumerate(relations):
        r["id"] = "%s|%s#%d" % (r["targets"][0], r["targets"][1], idx)
    return relations


def diff_relations(old, new):
    """Compare two relation lists for one pair; return change events."""
    events = []
    matched_old = set()
    for r in new:
        best, best_ov, best_i = None, -1.0, -1
        for i, o in enumerate(old):
            if i in matched_old:
                continue
            ov = min(r["end"], o["end"]) - max(r["start"], o["start"])
            if ov >= 0 and ov > best_ov:
                best, best_ov, best_i = o, ov, i
        if best is None:
            events.append({"type": "added", "targets": r["targets"], "new": r})
        else:
            matched_old.add(best_i)
            if (abs(best["start"] - r["start"]) > 1.0
                    or abs(best["end"] - r["end"]) > 1.0
                    or best["kind"] != r["kind"]):
                events.append({"type": "changed", "targets": r["targets"],
                               "old": best, "new": r})
    for i, o in enumerate(old):
        if i not in matched_old:
            events.append({"type": "removed", "targets": o["targets"], "old": o})
    return events
