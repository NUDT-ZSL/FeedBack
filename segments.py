"""Stay / move segmentation along each target's time-ordered trajectory.

A stay segment requires BOTH:
  - spatial clustering: a run of points within `stay_radius_m` of the
    run's anchor point, and
  - temporal persistence: the run spans at least `stay_min_seconds`.

Drift-flagged points are kept in the data but excluded from clustering
so a single teleporting report cannot break or fabricate a stay.
Everything between stays becomes a move segment.
"""
from geo import haversine_m


def _clean(points):
    return sorted((p for p in points if "drift" not in p["flags"]),
                  key=lambda p: (p["t"], p["seq"]))


def compute_segments(target, points, params):
    """Return the stay/move segment list for one target."""
    radius = params["stay_radius_m"]
    min_sec = params["stay_min_seconds"]
    pts = _clean(points)
    stays = []
    i, n = 0, len(pts)
    while i < n:
        j = i + 1
        while j < n and haversine_m(pts[i]["lat"], pts[i]["lon"],
                                    pts[j]["lat"], pts[j]["lon"]) <= radius:
            j += 1
        if j - 1 > i and pts[j - 1]["t"] - pts[i]["t"] >= min_sec:
            run = pts[i:j]
            stays.append({
                "target": target,
                "kind": "stay",
                "start": run[0]["t"],
                "end": run[-1]["t"],
                "point_ids": [p["id"] for p in run],
                "center": {
                    "lat": sum(p["lat"] for p in run) / len(run),
                    "lon": sum(p["lon"] for p in run) / len(run),
                },
                "params_used": {"stay_radius_m": radius,
                                "stay_min_seconds": min_sec},
            })
            i = j
        else:
            i += 1

    segments = []
    cursor = None  # last time covered
    for s in stays:
        move_pts = [p for p in pts
                    if (cursor is None or p["t"] > cursor)
                    and p["t"] < s["start"]]
        if move_pts:
            segments.append(_move(target, move_pts, params))
        cursor = s["end"]
        segments.append(s)
    tail = [p for p in pts if cursor is None or p["t"] > cursor]
    if tail:
        segments.append(_move(target, tail, params))
    segments.sort(key=lambda s: s["start"])
    for idx, s in enumerate(segments):
        s["id"] = "%s#%d" % (target, idx)
    return segments


def _move(target, pts, params):
    dist = 0.0
    for a, b in zip(pts, pts[1:]):
        dist += haversine_m(a["lat"], a["lon"], b["lat"], b["lon"])
    return {
        "target": target,
        "kind": "move",
        "start": pts[0]["t"],
        "end": pts[-1]["t"],
        "point_ids": [p["id"] for p in pts],
        "distance_m": round(dist, 1),
        "params_used": {"stay_radius_m": params["stay_radius_m"],
                        "stay_min_seconds": params["stay_min_seconds"]},
    }
