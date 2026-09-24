"""Deterministic sample trajectory: stops, moves, drift spikes, a long gap,
low-accuracy points, and two devices."""
import random
from datetime import datetime, timedelta

BASE = datetime(2026, 9, 24, 7, 30)
HOME = (31.2304, 121.4737)
OFFICE = (31.2408, 121.4955)
CAFE = (31.2355, 121.4840)


def _jitter(rng, meters):
    return (rng.uniform(-1, 1) * meters / 111320.0,
            rng.uniform(-1, 1) * meters / 91000.0)


def _stop(points, rng, start, minutes, center, acc=(12, 30), step=30,
          device="phone-A"):
    t = start
    end = start + timedelta(minutes=minutes)
    while t <= end:
        dla, dlo = _jitter(rng, 12)
        points.append({"t": t.timestamp(), "lat": center[0] + dla,
                       "lon": center[1] + dlo,
                       "acc": round(rng.uniform(*acc), 1), "device": device})
        t += timedelta(seconds=step + rng.randint(-8, 8))
    return end


def _move(points, rng, start, minutes, p_from, p_to, acc=(8, 25), step=15,
          device="phone-A", gap_at=None, gap_minutes=0, spikes=()):
    t = start
    end = start + timedelta(minutes=minutes)
    n = max(int(minutes * 60 / step), 1)
    i = 0
    while t <= end:
        frac = min((t - start).total_seconds() / max((end - start).total_seconds(), 1), 1.0)
        lat = p_from[0] + (p_to[0] - p_from[0]) * frac
        lon = p_from[1] + (p_to[1] - p_from[1]) * frac
        dla, dlo = _jitter(rng, 6)
        points.append({"t": t.timestamp(), "lat": lat + dla, "lon": lon + dlo,
                       "acc": round(rng.uniform(*acc), 1), "device": device})
        if i in spikes:  # drift spike: jump ~600m away and come back next point
            points.append({"t": t.timestamp() + 3, "lat": lat + 0.005,
                           "lon": lon + 0.006, "acc": 5.0, "device": device})
        if gap_at is not None and i == gap_at:  # missing points: long silence
            t += timedelta(minutes=gap_minutes)
        t += timedelta(seconds=step + rng.randint(-4, 4))
        i += 1
    return end


def generate():
    rng = random.Random(20260924)
    pts = []
    t = BASE
    t = _stop(pts, rng, t, 40, HOME)                                  # home
    t = _move(pts, rng, t, 25, HOME, OFFICE, spikes=(40,))            # commute + drift
    t = _stop(pts, rng, t, 200, OFFICE, acc=(15, 130))                # office, some low-acc
    t = _move(pts, rng, t, 18, OFFICE, CAFE, device="watch-B")        # to cafe
    t = _stop(pts, rng, t, 45, CAFE, device="watch-B")                # lunch
    # back to office with a 25-minute gap mid-way (lost points)
    t = _move(pts, rng, t, 30, CAFE, OFFICE, gap_at=20, gap_minutes=25)
    t = _stop(pts, rng, t, 280, OFFICE)                               # afternoon
    t = _move(pts, rng, t, 35, OFFICE, HOME, spikes=(70,))            # evening + drift
    _stop(pts, rng, t, 150, HOME)                                     # evening at home
    pts.sort(key=lambda p: p["t"])
    return pts


if __name__ == "__main__":
    pts = generate()
    print("%d points, %s -> %s" % (len(pts),
          datetime.fromtimestamp(pts[0]["t"]), datetime.fromtimestamp(pts[-1]["t"])))
