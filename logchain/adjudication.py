# -*- coding: utf-8 -*-
"""User adjudications (rulings) on suspicious records.

A ruling is keyed by the record's seq. Each ruling stores the verdict, a
note, and the verification status observed at ruling time. When the basis
(or record data) changes, re_evaluate refreshes only the derived
conclusions of rulings whose underlying record status actually changed;
every other ruling is preserved byte-for-byte.
"""
import json
import os
import time
from typing import Dict, List


class AdjudicationStore:
    def __init__(self, path: str):
        self.path = path
        self.rulings: Dict[int, dict] = {}
        self.last_updated: List[int] = []
        self.load()

    def load(self):
        if os.path.exists(self.path):
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.rulings = {int(k): v for k, v in data.items()}

    def save(self):
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({str(k): v for k, v in sorted(self.rulings.items())},
                      f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)

    @staticmethod
    def _conclusion(verdict: str, status: str) -> str:
        if verdict == "tampered":
            return "confirmed_tampered" if status != "ok" else "tampered_but_now_consistent"
        if verdict == "false_positive":
            return "accepted_despite_%s" % status
        if verdict == "fixed":
            return "fix_verified" if status == "ok" else "fix_not_effective"
        return "pending"

    def rule(self, seq: int, verdict: str, note: str, record_snapshot: dict,
             status: str):
        self.rulings[int(seq)] = {
            "seq": int(seq),
            "verdict": verdict,
            "note": note,
            "record_snapshot": record_snapshot,
            "status_at_ruling": status,
            "current_status": status,
            "conclusion": self._conclusion(verdict, status),
            "ruled_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "updated_at": None,
        }
        self.save()

    def re_evaluate(self, results: List[dict]):
        """Refresh conclusions after re-verification. Only rulings whose
        record status changed are updated; all others are preserved."""
        self.last_updated = []
        by_seq = {r["seq"]: r for r in results}
        for seq, ruling in self.rulings.items():
            res = by_seq.get(seq)
            new_status = res["status"] if res else "record_removed"
            if new_status != ruling["current_status"]:
                ruling["current_status"] = new_status
                ruling["conclusion"] = self._conclusion(
                    ruling["verdict"], new_status)
                ruling["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                self.last_updated.append(seq)
        if self.last_updated:
            self.save()
        return self.last_updated
