"""Trajectory segmentation engine: drift detection, stop/move splitting,
uncertain-gap marking, and manual override with auto-merge + validation."""
import math

MIN_STOP_DURATION_S = 240.0    # minimum stop duration
BASE_STOP_RADIUS_M = 60.0      # base stop spatial radius (m)
ACC_RADIUS_FACTOR = 2.0        # accuracy radius amplification factor
GAP_THRESHOLD_S = 300.0        # sampling gap above this is suspicious
MAX_PLAUSIBLE_SPEED_MS = 55.0  # ~200 km/h, faster means drift
LOW_ACCURACY_M = 80.0          # accuracy radius above this gets a notice


def haversine_m(lat1, lon1, lat2, lon2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def detect_drift(points):
    """Return {index: reason} for obvious drift points (excluded from segmentation)."""
    drift = {}
    n = len(points)
    for i in range(n):
        p = points[i]
        prev = points[i - 1] if i > 0 else None
        nxt = points[i + 1] if i < n - 1 else None
        if prev and nxt:
            d_in = haversine_m(prev["lat"], prev["lon"], p["lat"], p["lon"])
            d_out = haversine_m(p["lat"], p["lon"], nxt["lat"], nxt["lon"])
            dt_in = max(p["t"] - prev["t"], 1e-6)
            dt_out = max(nxt["t"] - p["t"], 1e-6)
            v_in, v_out = d_in / dt_in, d_out / dt_out
            d_skip = haversine_m(prev["lat"], prev["lon"], nxt["lat"], nxt["lon"])
            # spike: jumps out and back, both legs implausibly fast
            if (max(v_in, v_out) > MAX_PLAUSIBLE_SPEED_MS
                    and min(v_in, v_out) > MAX_PLAUSIBLE_SPEED_MS * 0.7
                    and d_skip < 0.6 * (d_in + d_out)):
                drift[i] = ("漂移点：与前后点距离 %.0fm / %.0fm，隐含速度 "
                            "%.0f / %.0f km/h，超出合理范围"
                            % (d_in, d_out, v_in * 3.6, v_out * 3.6))
        else:
            other = nxt or prev
            if other:
                d = haversine_m(p["lat"], p["lon"], other["lat"], other["lon"])
                dt = max(abs(other["t"] - p["t"]), 1e-6)
                if d / dt > MAX_PLAUSIBLE_SPEED_MS * 1.5:
                    drift[i] = ("漂移点：与相邻点距离 %.0fm，隐含速度 %.0f km/h"
                                % (d, d / dt * 3.6))
    return drift


def effective_radius(points, i, j):
    """Stop radius: max of base radius and amplified median accuracy."""
    accs = sorted(p["acc"] for p in points[i:j + 1] if p.get("acc"))
    med = accs[len(accs) // 2] if accs else 0.0
    return max(BASE_STOP_RADIUS_M, ACC_RADIUS_FACTOR * med)


def find_stops(points):
    """Growing-window stop clusters [(start_idx, end_idx)].

    A cluster qualifies only when its spatial spread stays within the
    effective radius AND its duration meets the minimum stop time.
    """
    n = len(points)
    stops = []
    i = 0
    while i < n - 1:
        cx, cy = points[i]["lat"], points[i]["lon"]
        j = i
        while j + 1 < n:
            k = j + 1
            if points[k]["t"] - points[j]["t"] > GAP_THRESHOLD_S:
                break  # long silence: never let a stop cluster span a gap
            cnt = k - i + 1
            ncx = (cx * (cnt - 1) + points[k]["lat"]) / cnt
            ncy = (cy * (cnt - 1) + points[k]["lon"]) / cnt
            r = effective_radius(points, i, k)
            ok = True
            for m in range(i, k + 1):
                if haversine_m(points[m]["lat"], points[m]["lon"], ncx, ncy) > r:
                    ok = False
                    break
            if not ok:
                break
            cx, cy = ncx, ncy
            j = k
        if j > i and points[j]["t"] - points[i]["t"] >= MIN_STOP_DURATION_S:
            stops.append((i, j))
            i = j + 1
        else:
            i += 1
    return stops
