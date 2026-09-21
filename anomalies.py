"""Anomaly flagging for raw position points.

Flags are attached to points and never cause silent drops:
  - out_of_order: timestamp goes backwards relative to arrival order
  - duplicate:    same target reported at the same timestamp more than once
  - drift:        implied speed from the previous (time-sorted) point is
                  physically implausible, or two distinct positions share
                  one timestamp
"""


def flag_target_points(points, drift_speed_mps):
    """Flag anomalies on one target's points (list of dicts, mutated).

    `seq` is the global arrival order; `t` is epoch seconds.
    """
    for p in points:
        p["flags"] = []

    by_arrival = sorted(points, key=lambda p: p["seq"])
    max_t = None
    for p in by_arrival:
        if max_t is not None and p["t"] < max_t - 1e-9:
            p["flags"].append("out_of_order")
        max_t = p["t"] if max_t is None else max(max_t, p["t"])

    by_time = {}
    for p in points:
        by_time.setdefault(round(p["t"], 3), []).append(p)
    for group in by_time.values():
        if len(group) > 1:
            for p in group:
                p["flags"].append("duplicate")

    from geo import haversine_m
    prev = None
    for p in sorted(points, key=lambda x: (x["t"], x["seq"])):
        if prev is not None:
            dt = p["t"] - prev["t"]
            d = haversine_m(prev["lat"], prev["lon"], p["lat"], p["lon"])
            if (dt > 0 and d / dt > drift_speed_mps) or (dt == 0 and d > 1.0):
                p["flags"].append("drift")
        prev = p
