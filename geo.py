"""Geographic and time helpers (stdlib only)."""
import math


def haversine_m(lat1, lon1, lat2, lon2):
    """Great-circle distance in meters."""
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def interp_point(sorted_pts, t):
    """Linear interpolation of lat/lon at time t over time-sorted points.

    Returns (lat, lon) or None when t is outside the covered range.
    """
    if not sorted_pts or t < sorted_pts[0]["t"] or t > sorted_pts[-1]["t"]:
        return None
    prev = sorted_pts[0]
    for cur in sorted_pts[1:]:
        if cur["t"] >= t:
            if cur["t"] == prev["t"]:
                return (cur["lat"], cur["lon"])
            f = (t - prev["t"]) / (cur["t"] - prev["t"])
            return (prev["lat"] + f * (cur["lat"] - prev["lat"]),
                    prev["lon"] + f * (cur["lon"] - prev["lon"]))
        prev = cur
    last = sorted_pts[-1]
    return (last["lat"], last["lon"])
