"""Feedback store: items, manual pins, op log, deterministic grouping.

The final grouping is ALWAYS recomputed from scratch as a pure
function of (feedback items, pins, threshold). There is no incremental
mutable grouping state, so the result cannot drift and never depends
on the order in which adjustments were applied: pins are resolved by
a deterministic algorithm (sorted keys, fixed tie-breaks).
"""
import json
import os
import time
import uuid

from clustering import cluster_items, describe_cluster
from similarity import VectorSpace

DEFAULT_THRESHOLD = 0.20


class Store(object):
    def __init__(self, path):
        self.path = path
        self.items = {}      # id -> {id, source, time, text, tags}
        self.pins = {}       # item_id -> group key (manual constraint)
        self.ops = []        # manual op log, for traceability
        self.threshold = DEFAULT_THRESHOLD
        self._load()

    # ---------- persistence ----------
    def _load(self):
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.items = data.get("items", {})
            self.pins = data.get("pins", {})
            self.ops = data.get("ops", [])
            self.threshold = data.get("threshold", DEFAULT_THRESHOLD)

    def _save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"items": self.items, "pins": self.pins,
                       "ops": self.ops, "threshold": self.threshold},
                      f, ensure_ascii=False, indent=1)
        os.replace(tmp, self.path)

    # ---------- feedback CRUD ----------
    def add_feedback(self, source, text, tags=None, ts=None):
        iid = uuid.uuid4().hex[:12]
        self.items[iid] = {
            "id": iid,
            "source": source or "unknown",
            "time": ts or time.strftime("%Y-%m-%d %H:%M:%S"),
            "text": text or "",
            "tags": list(tags or []),
        }
        self._save()
        return self.items[iid]

    def update_feedback(self, iid, fields):
        item = self.items[iid]
        for k in ("source", "time", "text"):
            if k in fields:
                item[k] = fields[k]
        if "tags" in fields:
            item["tags"] = list(fields["tags"])
        self._save()
        return item

    def delete_feedback(self, iid):
        self.items.pop(iid, None)
        self.pins.pop(iid, None)
        self._save()

    def set_threshold(self, threshold):
        self.threshold = float(threshold)
        self._save()
    # ---------- deterministic grouping ----------
    def _auto_clusters(self):
        ids = sorted(self.items)
        texts = [self.items[i]["text"] for i in ids]
        return cluster_items(ids, texts, self.threshold)

    def compute_groups(self):
        """Pure function of (items, pins, threshold) -> groups.

        1. Auto-cluster everything deterministically.
        2. Pinned items with the same key are forced together.
        3. An unpinned item joins the pinned group that its auto
           cluster points to (most similar pinned member, ties broken
           by id); otherwise it stays with its auto-cluster peers.
        """
        auto = self._auto_clusters()
        ids = sorted(self.items)
        texts = [self.items[i]["text"] for i in ids]
        vs = auto["vs"]
        idx = auto["id_to_idx"]

        key_of = {}          # item -> final group key
        for iid in ids:
            if iid in self.pins:
                key_of[iid] = "pin:" + self.pins[iid]

        for cluster in auto["clusters"]:
            pinned_keys = {key_of[m] for m in cluster if m in key_of}
            if not pinned_keys:
                for m in cluster:
                    key_of.setdefault(m, "auto:" + cluster[0])
                continue
            for m in cluster:
                if m in key_of:
                    continue
                if len(pinned_keys) == 1:
                    key_of[m] = next(iter(pinned_keys))
                else:
                    # attach to the most similar pinned member's group
                    cands = sorted(p for p in cluster if p in key_of)
                    best = max(cands, key=lambda p: (
                        round(vs.similarity(idx[m], idx[p]), 12),
                        tuple(chr(0x10FFFF - ord(c)) for c in p)))
                    key_of[m] = key_of[best]

        groups = {}
        for iid, key in key_of.items():
            groups.setdefault(key, []).append(iid)
        ordered = [sorted(m) for _, m in
                   sorted(groups.items(), key=lambda kv: min(kv[1]))]
        return ordered, auto, vs, idx, ids, texts

    # ---------- manual operations ----------
    def _group_key(self, members):
        return "k" + min(members)

    def _materialize(self, members, key):
        for m in members:
            self.pins[m] = key

    def move_item(self, iid, source_remaining, target_members):
        # Pin the source remainder too, otherwise unpinned ex-cluster
        # peers would be pulled into the target group via the moved
        # item's auto cluster.
        if source_remaining:
            self._materialize(sorted(source_remaining),
                              self._group_key(sorted(source_remaining)))
        key = self._group_key(list(target_members) + [iid])
        self._materialize(list(target_members) + [iid], key)
        self.ops.append({"op": "move", "item": iid,
                         "target": sorted(target_members),
                         "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        self._save()

    def merge_groups(self, members_a, members_b):
        members = sorted(members_a) + sorted(members_b)
        self._materialize(members, self._group_key(members))
        self.ops.append({"op": "merge", "a": sorted(members_a),
                         "b": sorted(members_b),
                         "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        self._save()

    def split_group(self, remaining, extracted):
        if remaining:
            self._materialize(sorted(remaining),
                              self._group_key(sorted(remaining)))
        self._materialize(sorted(extracted),
                          self._group_key(sorted(extracted)) + ":s")
        self.ops.append({"op": "split", "remaining": sorted(remaining),
                         "extracted": sorted(extracted),
                         "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        self._save()

    def reset_adjustments(self):
        self.pins = {}
        self.ops.append({"op": "reset",
                         "time": time.strftime("%Y-%m-%d %H:%M:%S")})
        self._save()
