"""Central state + incremental recomputation.

Dependency model:
  - anomaly flags depend on the point's target (arrival order + neighbors)
  - stay/move segments depend on one target's points + stay params
  - co-travel relations depend on a target pair's points + co params

Edits therefore only recompute the affected targets / pairs; a
full_recompute() is kept for cross-checking that incremental results
match a from-scratch run.
"""
import itertools
import time

import anomalies
import cotravel
import segments as seg_mod

DEFAULT_PARAMS = {
    "stay_radius_m": 150.0,
    "stay_min_seconds": 600.0,
    "co_radius_m": 200.0,
    "co_min_seconds": 600.0,
    "drift_speed_mps": 60.0,
    "sample_step_s": 60.0,
    "gap_tolerance_s": 120.0,
}
STAY_KEYS = {"stay_radius_m", "stay_min_seconds"}
CO_KEYS = {"co_radius_m", "co_min_seconds", "sample_step_s", "gap_tolerance_s"}


class Store(object):
    def __init__(self):
        self.points = {}          # id -> point dict
        self.params = dict(DEFAULT_PARAMS)
        self.segments = {}        # target -> [segment]
        self.relations = {}       # (a,b) sorted tuple -> [relation]
        self.events = []          # diff events from the latest update
        self._next_id = 1
        self._next_seq = 1

    # ---- data ingestion -------------------------------------------------
    def add_points(self, raw_points):
        targets = set()
        for rp in raw_points:
            pid = "p%d" % self._next_id
            self._next_id += 1
            p = {
                "id": pid,
                "target": str(rp["target"]),
                "t": float(rp["t"]),
                "lat": float(rp["lat"]),
                "lon": float(rp["lon"]),
                "seq": self._next_seq,
                "flags": [],
            }
            self._next_seq += 1
            self.points[pid] = p
            targets.add(p["target"])
        self._refresh(sorted(targets), reflag_all=False)

    def update_point(self, pid, fields):
        p = self.points[pid]
        for k in ("t", "lat", "lon"):
            if k in fields and fields[k] is not None:
                p[k] = float(fields[k])
        if fields.get("target"):
            p["target"] = str(fields["target"])
        self._refresh([p["target"]], reflag_all=False)

    def delete_point(self, pid):
        target = self.points[pid]["target"]
        del self.points[pid]
        self._refresh([target], reflag_all=False)

    def set_params(self, updates):
        changed = {k for k, v in updates.items()
                   if k in self.params and float(v) != self.params[k]}
        for k in changed:
            self.params[k] = float(updates[k])
        if "drift_speed_mps" in changed:
            self._refresh(self._targets(), reflag_all=True)
            return
        targets = self._targets() if changed & STAY_KEYS else []
        pairs = self._pairs() if changed & CO_KEYS else []
        self._recompute(targets, pairs)

    # ---- incremental engine ---------------------------------------------
    def _targets(self):
        return sorted({p["target"] for p in self.points.values()})

    def _pairs(self):
        return [tuple(sorted(ab)) for ab in itertools.combinations(self._targets(), 2)]

    def _refresh(self, targets, reflag_all):
        if reflag_all:
            targets = self._targets()
        for t in targets:
            anomalies.flag_target_points(
                [p for p in self.points.values() if p["target"] == t],
                self.params["drift_speed_mps"])
        pairs = [key for key in self._pairs() if key[0] in targets or key[1] in targets]
        self._recompute(targets, pairs)

    def _recompute(self, targets, pairs):
        for t in targets:
            pts = [p for p in self.points.values() if p["target"] == t]
            self.segments[t] = seg_mod.compute_segments(t, pts, self.params)
        self.events = []
        for key in pairs:
            a, b = key
            new = cotravel.compute_pair(
                a, [p for p in self.points.values() if p["target"] == a],
                b, [p for p in self.points.values() if p["target"] == b],
                self.params)
            old = self.relations.get(key, [])
            self.events.extend(cotravel.diff_relations(old, new))
            self.relations[key] = new
        live = set(self._pairs())
        for key in list(self.relations):
            if key not in live:
                for o in self.relations.pop(key):
                    self.events.append({"type": "removed",
                                        "targets": list(key), "old": o})

    # ---- verification ----------------------------------------------------
    def full_recompute(self):
        """From-scratch recompute on a scratch copy of the data."""
        import copy
        pts = copy.deepcopy(list(self.points.values()))
        for p in pts:
            p["flags"] = []
        by_target = {}
        for p in pts:
            by_target.setdefault(p["target"], []).append(p)
        for t, group in by_target.items():
            anomalies.flag_target_points(group, self.params["drift_speed_mps"])
        flags = {p["id"]: p["flags"] for p in pts}
        segs = {t: seg_mod.compute_segments(t, g, self.params)
                for t, g in by_target.items()}
        rels = {}
        for a, b in itertools.combinations(sorted(by_target), 2):
            rels[(a, b)] = cotravel.compute_pair(
                a, by_target[a], b, by_target[b], self.params)
        return flags, segs, rels

    def verify(self):
        flags, segs, rels = self.full_recompute()
        problems = []
        for pid, p in self.points.items():
            if p["flags"] != flags.get(pid):
                problems.append("flags:%s" % pid)
        for t in set(list(segs) + list(self.segments)):
            if segs.get(t, []) != self.segments.get(t, []):
                problems.append("segments:%s" % t)
        for key in set(list(rels) + list(self.relations)):
            if rels.get(key, []) != self.relations.get(key, []):
                problems.append("relations:%s" % (key,))
        return {"ok": not problems, "problems": problems,
                "checked_at": time.time()}
