"""State store: feedback CRUD, manual constraints, recompute, persistence.

Manual operations never mutate clusters directly. They are translated
into must-link / cannot-link constraint sets, and the visible grouping
is always produced by a full deterministic recompute. This guarantees
that the final grouping equals a from-scratch recomputation regardless
of the order in which adjustments were made.
"""
from __future__ import annotations

import json
import os
import threading

from . import clustering
from .models import Feedback


class Store:
    def __init__(self, path=None, threshold=clustering.DEFAULT_THRESHOLD,
                 band=clustering.DEFAULT_BAND):
        self.path = path
        self.threshold = threshold
        self.band = band
        self.feedbacks = {}          # id -> Feedback
        self.must_link = set()       # set of (a, b) sorted tuples
        self.cannot_link = set()
        self.clusters = []
        self.evidence = []
        self._lock = threading.RLock()
        if path and os.path.exists(path):
            self._load()
        self.recompute()

    # ---------- persistence ----------
    def _load(self):
        with open(self.path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        self.threshold = data.get("threshold", self.threshold)
        self.band = data.get("band", self.band)
        self.feedbacks = {f["id"]: Feedback.from_dict(f)
                          for f in data.get("feedbacks", [])}
        self.must_link = {tuple(p) for p in data.get("must_link", [])}
        self.cannot_link = {tuple(p) for p in data.get("cannot_link", [])}

    def save(self):
        if not self.path:
            return
        data = {
            "threshold": self.threshold,
            "band": self.band,
            "feedbacks": [self.feedbacks[k].to_dict()
                          for k in sorted(self.feedbacks)],
            "must_link": sorted(list(p) for p in self.must_link),
            "cannot_link": sorted(list(p) for p in self.cannot_link),
        }
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    # ---------- core ----------
    def recompute(self):
        with self._lock:
            alive = set(self.feedbacks)
            self.must_link = {p for p in self.must_link
                              if p[0] in alive and p[1] in alive}
            self.cannot_link = {p for p in self.cannot_link
                                if p[0] in alive and p[1] in alive}
            self.clusters, self.evidence = clustering.cluster_feedback(
                list(self.feedbacks.values()),
                threshold=self.threshold,
                band=self.band,
                must_link=self.must_link,
                cannot_link=self.cannot_link,
            )
            self.save()
            return self.clusters

    @staticmethod
    def _key(a, b):
        return (a, b) if a < b else (b, a)

    # ---------- feedback CRUD ----------
    def add_feedback(self, source, text, tags=None, timestamp=None):
        with self._lock:
            fb = Feedback.create(source, text, tags, timestamp)
            self.feedbacks[fb.id] = fb
            self.recompute()
            return fb

    def update_feedback(self, fb_id, source=None, text=None, tags=None):
        with self._lock:
            fb = self.feedbacks.get(fb_id)
            if fb is None:
                return None
            if source is not None:
                fb.source = source
            if text is not None:
                fb.text = text
            if tags is not None:
                fb.tags = list(tags)
            self.recompute()
            return fb

    def delete_feedback(self, fb_id):
        with self._lock:
            if self.feedbacks.pop(fb_id, None) is None:
                return False
            self.recompute()
            return True

    # ---------- cluster lookup ----------
    def cluster_of(self, fb_id):
        for cl in self.clusters:
            if fb_id in cl.member_ids:
                return cl
        return None

    def get_cluster(self, cluster_id):
        for cl in self.clusters:
            if cl.id == cluster_id:
                return cl
        return None

    # ---------- manual operations -> constraints ----------
    def op_move(self, fb_id, target_cluster_id):
        """Move one feedback into another cluster."""
        with self._lock:
            if fb_id not in self.feedbacks:
                return False, "feedback not found"
            target = self.get_cluster(target_cluster_id)
            if target is None:
                return False, "target cluster not found"
            current = self.cluster_of(fb_id)
            if current and current.id == target.id:
                return True, "already in target cluster"
            if current:
                for other in current.member_ids:
                    if other != fb_id:
                        self.cannot_link.add(self._key(fb_id, other))
            for other in target.member_ids:
                self.must_link.add(self._key(fb_id, other))
            self.recompute()
            return True, "moved"

    def op_merge(self, cluster_a, cluster_b):
        """Merge two clusters."""
        with self._lock:
            ca, cb = self.get_cluster(cluster_a), self.get_cluster(cluster_b)
            if ca is None or cb is None:
                return False, "cluster not found"
            if ca.id == cb.id:
                return True, "same cluster"
            for x in ca.member_ids:
                for y in cb.member_ids:
                    self.must_link.add(self._key(x, y))
            self.recompute()
            return True, "merged"

    def op_split(self, cluster_id, split_off_ids):
        """Split the given feedback ids out of their cluster."""
        with self._lock:
            cl = self.get_cluster(cluster_id)
            if cl is None:
                return False, "cluster not found"
            split_off = [i for i in split_off_ids if i in cl.member_ids]
            if not split_off or len(split_off) == len(cl.member_ids):
                return False, "nothing to split"
            rest = [i for i in cl.member_ids if i not in split_off]
            for x in split_off:
                for y in rest:
                    self.cannot_link.add(self._key(x, y))
            self.recompute()
            return True, "split"

    def op_reset(self):
        """Drop all manual constraints and recompute from scratch."""
        with self._lock:
            self.must_link.clear()
            self.cannot_link.clear()
            self.recompute()
            return True, "constraints cleared"

    def set_params(self, threshold=None, band=None):
        with self._lock:
            if threshold is not None:
                self.threshold = float(threshold)
            if band is not None:
                self.band = float(band)
            self.recompute()

    # ---------- views ----------
    def state(self):
        with self._lock:
            fb = self.feedbacks
            clusters = []
            for cl in self.clusters:
                d = cl.to_dict()
                d["members"] = [fb[i].to_dict() for i in cl.member_ids if i in fb]
                clusters.append(d)
            return {
                "threshold": self.threshold,
                "band": self.band,
                "feedback_count": len(fb),
                "clusters": clusters,
                "evidence": [e.to_dict() for e in self.evidence],
                "constraint_counts": {
                    "must_link": len(self.must_link),
                    "cannot_link": len(self.cannot_link),
                },
            }
