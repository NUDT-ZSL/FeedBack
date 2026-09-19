# -*- coding: utf-8 -*-
"""Chain verification: full and incremental, with suspicious-record analysis."""
from typing import Dict, List, Optional

from .model import Basis, LogRecord

OK = "ok"
MISMATCH = "mismatch"            # stored checksum != expected checksum
MISSING = "missing_checksum"     # checksum absent
BAD_FORMAT = "bad_format"        # checksum not valid hex of expected length
DANGLING = "dangling_ref"        # prev_seq points to a non-existent record
DUPLICATE = "duplicate_seq"      # sequence number used more than once

SUSPICIOUS_STATUSES = (MISMATCH, MISSING, BAD_FORMAT, DANGLING, DUPLICATE)

_GENESIS = "<genesis>"


class Chain:
    def __init__(self, records: List[LogRecord], basis: Optional[Basis] = None):
        self.records: List[LogRecord] = list(records)
        self.basis: Basis = basis or Basis()
        self._cache: Dict[int, tuple] = {}   # index -> (key, result)
        self.results: List[dict] = []
        self.last_recomputed: List[int] = []  # indices recomputed in last verify

    # -- verification ------------------------------------------------------
    def _prev_stored_checksum(self, index: int):
        """Stored checksum of the record referenced by prev_seq."""
        rec = self.records[index]
        if rec.prev_seq is None:
            return _GENESIS, True
        for r in self.records:
            if r.seq == rec.prev_seq:
                return (r.checksum if r.checksum is not None else _GENESIS), True
        return _GENESIS, False

    def _cache_key(self, index: int):
        rec = self.records[index]
        prev_sum, prev_found = self._prev_stored_checksum(index)
        return (self.basis.basis_id, prev_sum, prev_found, rec.seq,
                rec.timestamp, rec.source, rec.body, rec.prev_seq, rec.checksum)

    def _verify_one(self, index: int) -> dict:
        rec = self.records[index]
        prev_sum, prev_found = self._prev_stored_checksum(index)
        prev_input = "" if prev_sum == _GENESIS else prev_sum
        expected = rec.compute_checksum(self.basis, prev_input)
        reasons = []
        status = OK
        if not prev_found:
            status = DANGLING
            reasons.append("prev_seq=%s 指向不存在的顺序号" % rec.prev_seq)
        dup = [j for j, r in enumerate(self.records)
               if r.seq == rec.seq and j != index]
        if dup and status == OK:
            status = DUPLICATE
            reasons.append("顺序号 %s 被多条记录使用(位置 %s)" % (rec.seq, dup))
        if status == OK:
            if rec.checksum is None or rec.checksum == "":
                status = MISSING
                reasons.append("校验值缺失")
            elif not rec.checksum_format_ok(self.basis):
                status = BAD_FORMAT
                reasons.append("校验值格式异常:应为 %d 位十六进制(%s)"
                               % (self.basis.digest_length, self.basis.algorithm))
            elif rec.checksum.lower() != expected.lower():
                status = MISMATCH
                reasons.append("校验值与依据不一致")
        if status == OK:
            reasons.append("校验通过")
        return {
            "index": index, "seq": rec.seq, "status": status,
            "expected_checksum": expected,
            "actual_checksum": rec.checksum,
            "prev_seq": rec.prev_seq, "prev_found": prev_found,
            "reasons": reasons,
        }

    def verify(self, full: bool = False) -> List[dict]:
        """Verify the chain. Incremental by default: only records whose
        verification inputs changed since the last run are recomputed;
        the conclusion is identical to a full re-verification."""
        if full:
            self._cache.clear()
        results, recomputed = [], []
        for i in range(len(self.records)):
            key = self._cache_key(i)
            cached = self._cache.get(i)
            if cached is not None and cached[0] == key:
                results.append(cached[1])
            else:
                res = self._verify_one(i)
                self._cache[i] = (key, res)
                results.append(res)
                recomputed.append(i)
        self.results = results
        self.last_recomputed = recomputed
        return results

    # -- mutation ----------------------------------------------------------
    def edit_record(self, seq: int, body=None, new_seq=None,
                    checksum=None, prev_seq=...):
        rec = self._find(seq)
        if body is not None:
            rec.body = body
        if new_seq is not None:
            rec.seq = int(new_seq)
        if checksum is not None:
            rec.checksum = checksum
        if prev_seq is not ...:
            rec.prev_seq = prev_seq
        self.verify()
        return rec

    def set_basis(self, basis: Basis):
        self.basis = basis
        self.verify()

    def _find(self, seq: int) -> LogRecord:
        for r in self.records:
            if r.seq == seq:
                return r
        raise KeyError("no record with seq=%s" % seq)

    # -- analysis ----------------------------------------------------------
    def first_fault(self) -> Optional[dict]:
        for r in self.results:
            if r["status"] != OK:
                return r
        return None

    def impact_of(self, index: int) -> List[int]:
        """Indices whose chain trust depends on record `index`: the record
        itself plus every record that (transitively) references it."""
        seq_of = {i: r.seq for i, r in enumerate(self.records)}
        impacted, frontier = {index}, {seq_of[index]}
        changed = True
        while changed:
            changed = False
            for i, r in enumerate(self.records):
                if i not in impacted and r.prev_seq in frontier:
                    impacted.add(i)
                    frontier.add(r.seq)
                    changed = True
        return sorted(impacted)

    def suspicious(self) -> List[dict]:
        return [r for r in self.results if r["status"] != OK]

    def summary(self) -> dict:
        counts = {}
        for r in self.results:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        fault = self.first_fault()
        return {
            "total": len(self.records),
            "counts": counts,
            "first_fault": fault,
            "impact_range": self.impact_of(fault["index"]) if fault else [],
            "last_recomputed": self.last_recomputed,
            "basis": self.basis.to_dict(),
        }
