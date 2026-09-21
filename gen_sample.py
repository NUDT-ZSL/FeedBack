"""Deterministic sample dataset used by tests.py and sample_data.csv.

Scenario (times are minutes from BASE):
  A: stay L1 (0-60), move (60-90), stay L2 (90-180)
  B: stay near L1 (10-60) -> stable co-travel with A; then leaves to L3
  C: passes through A's moving path near minute 70 -> occasional approach
  D: few points plus injected anomalies (out-of-order, duplicate, drift)
"""
from datetime import datetime

BASE = datetime(2026, 9, 22, 8, 0, 0).timestamp()
L1 = (30.6600, 104.0600)
L2 = (30.6700, 104.0750)
L3 = (30.7000, 104.1000)
L4 = (30.6550, 104.0500)
L5 = (30.6400, 104.0400)
L6 = (30.6500, 104.0700)


def _lerp(p, q, f):
    return (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)


def sample_rows():
    rows = []

    def add(target, minute, lat, lon):
        rows.append({"target": target, "t": BASE + minute * 60,
                     "lat": round(lat, 6), "lon": round(lon, 6)})

    jit = lambda i: ((i % 3) - 1) * 0.0002  # ~20 m sampling jitter

    for i, m in enumerate(range(0, 61, 5)):
        add("A", m, L1[0] + jit(i), L1[1] + jit(i + 1))
    for m in range(65, 90, 5):
        p = _lerp(L1, L2, (m - 60) / 30.0)
        add("A", m, p[0], p[1])
    for i, m in enumerate(range(90, 181, 10)):
        add("A", m, L2[0] + jit(i), L2[1] + jit(i))

    near_l1 = (L1[0] + 0.0005, L1[1] + 0.0003)  # ~60 m from A's stay
    for i, m in enumerate(range(10, 61, 5)):
        add("B", m, near_l1[0] + jit(i), near_l1[1] + jit(i + 1))
    for m in range(65, 100, 5):
        p = _lerp(near_l1, L3, (m - 60) / 40.0)
        add("B", m, p[0], p[1])
    for i, m in enumerate(range(100, 181, 10)):
        add("B", m, L3[0] + jit(i), L3[1] + jit(i + 1))

    cross = _lerp(L1, L2, 10 / 30.0)  # exactly where A is at minute 70
    for i, m in enumerate(range(0, 61, 10)):
        add("C", m, L4[0] + jit(i), L4[1] + jit(i))
    add("C", 65, *_lerp(L4, cross, 0.5))
    add("C", 70, *cross)
    for m in (75, 80, 85):
        add("C", m, *_lerp(cross, L5, (m - 70) / 20.0))
    for i, m in enumerate(range(90, 181, 15)):
        add("C", m, L5[0] + jit(i), L5[1] + jit(i + 1))

    # D: normal points, then anomalies in arrival order
    for m in (0, 10, 20, 30):
        add("D", m, L6[0], L6[1])
    add("D", 15, L6[0], L6[1])          # out_of_order (arrives late)
    add("D", 20, L6[0], L6[1])          # duplicate of minute 20
    add("D", 40, 31.0000, 105.0000)     # drift: ~150 km teleport
    add("D", 50, L6[0], L6[1])          # return leg also exceeds speed cap
    return rows


if __name__ == "__main__":
    import csv, sys
    from datetime import datetime as dt
    w = csv.writer(sys.stdout, lineterminator="\n")
    w.writerow(["target", "time", "lat", "lon"])
    for r in sample_rows():
        w.writerow([r["target"], dt.fromtimestamp(r["t"]).strftime("%Y-%m-%d %H:%M:%S"),
                    r["lat"], r["lon"]])
