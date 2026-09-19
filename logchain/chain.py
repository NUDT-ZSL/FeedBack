# -*- coding: utf-8 -*-
"""链式校验引擎：全量校验、增量校验与影响范围分析。"""
from .model import GENESIS, LogRecord, checksum_format_ok, compute_checksum

OK = "ok"
MISMATCH = "mismatch"    # 校验值与依据不一致
SUSPICIOUS = "suspicious"  # 缺失/格式异常/悬空引用等
AFFECTED = "affected"    # 本身一致，但受前序断点影响

BAD_STATUS = (MISMATCH, SUSPICIOUS)


class LogChain(object):
    def __init__(self, records, path=None):
        self.records = list(records)
        self.path = path
        self._reindex()
        self.results = None  # 最近一次校验结论（与 self.records 对齐）

    # ---- 载入与保存 ----
    @classmethod
    def from_text(cls, text, path=None):
        records = []
        for n, line in enumerate(text.splitlines(), 1):
            if line.strip():
                records.append(LogRecord.from_json_line(line, n))
        return cls(records, path=path)

    @classmethod
    def from_file(cls, path):
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_text(fh.read(), path=path)

    def save(self, path=None):
        path = path or self.path
        with open(path, "w", encoding="utf-8") as fh:
            for rec in self.records:
                fh.write(rec.to_json_line() + "\n")
        self.path = path

    def _reindex(self):
        self.by_seq = {}
        self.pos_by_seq = {}
        self.duplicate_seqs = set()
        for i, rec in enumerate(self.records):
            if rec.seq is None:
                continue
            if rec.seq in self.by_seq:
                self.duplicate_seqs.add(rec.seq)
            else:
                self.by_seq[rec.seq] = rec
                self.pos_by_seq[rec.seq] = i

    # ---- 单条校验（只依赖记录自身与前序存储的校验值，全量/增量结果一致）----
    def _verify_one(self, index):
        rec = self.records[index]
        res = {"index": index, "seq": rec.seq, "status": OK, "reasons": [],
               "expected_checksum": None, "actual_checksum": rec.checksum,
               "impacted_by": None}
        if rec.parse_error:
            res["status"] = SUSPICIOUS
            res["reasons"].append(rec.parse_error)
            return res
        if rec.seq is None:
            res["status"] = SUSPICIOUS
            res["reasons"].append("缺少有效顺序号")
            return res
        if rec.seq in self.duplicate_seqs:
            res["status"] = SUSPICIOUS
            res["reasons"].append("顺序号 %s 在链中重复出现" % rec.seq)
            return res
        if rec.checksum is None or rec.checksum == "":
            res["status"] = SUSPICIOUS
            res["reasons"].append("校验值缺失")
            return res
        if not checksum_format_ok(rec.checksum):
            res["status"] = SUSPICIOUS
            res["reasons"].append("校验值格式异常（应为 64 位十六进制）: %r" % rec.checksum)
            return res
        prev_checksum = GENESIS
        if rec.prev_seq is not None:
            target = self.by_seq.get(rec.prev_seq)
            if target is None:
                res["status"] = SUSPICIOUS
                res["reasons"].append("前序引用指向不存在的顺序号 %s" % rec.prev_seq)
                return res
            if self.pos_by_seq[rec.prev_seq] >= index:
                res["status"] = SUSPICIOUS
                res["reasons"].append("前序引用 seq=%s 不在本记录之前" % rec.prev_seq)
                return res
            if not checksum_format_ok(target.checksum):
                res["status"] = AFFECTED
                res["reasons"].append("前序记录 seq=%s 校验值缺失或异常，无法独立验证" % target.seq)
                res["impacted_by"] = target.seq
                return res
            prev_checksum = target.checksum
        expected = compute_checksum(rec.seq, rec.time, rec.source, rec.body,
                                    prev_checksum)
        res["expected_checksum"] = expected
        if expected != rec.checksum:
            res["status"] = MISMATCH
            res["reasons"].append("校验值与依据不一致（记录内容或顺序可能被改动）")
        return res

    def _apply_impact(self, results):
        """首个断点之后、本身校验通过的记录标记为受影响。"""
        first_bad = None
        for res in results:
            if res["status"] in BAD_STATUS:
                first_bad = res
                break
        if first_bad is None:
            return
        for res in results[first_bad["index"] + 1:]:
            if res["status"] == OK:
                res["status"] = AFFECTED
                res["impacted_by"] = first_bad["seq"]
                res["reasons"].append(
                    "本身校验通过，但链条在 seq=%s 处已断裂，结论依赖该断点的处置"
                    % first_bad["seq"])

    # ---- 全量校验 ----
    def verify_full(self):
        results = [self._verify_one(i) for i in range(len(self.records))]
        self._apply_impact(results)
        self.results = results
        report = self.build_report(results)
        report["recomputed"] = len(results)
        report["reused"] = 0
        return report

    # ---- 增量校验：只重算 [start_index, 末尾]，前面复用上次结论 ----
    def verify_from(self, start_index):
        if self.results is None or start_index <= 0:
            return self.verify_full()
        start_index = min(start_index, len(self.records))
        kept = self.results[:start_index]
        recomputed = [self._verify_one(i)
                      for i in range(start_index, len(self.records))]
        results = kept + recomputed
        self._apply_impact(results)
        self.results = results
        report = self.build_report(results)
        report["recomputed"] = len(recomputed)
        report["reused"] = len(kept)
        return report

    # ---- 修改记录：正文 / 顺序号 / 校验依据 ----
    def update_record(self, seq, body=None, new_seq=None, checksum=None,
                      recompute=False, recompute_chain=False):
        if seq not in self.pos_by_seq:
            raise KeyError("顺序号 %s 不存在" % seq)
        index = self.pos_by_seq[seq]
        rec = self.records[index]
        if body is not None:
            rec.body = body
        if new_seq is not None:
            rec.seq = new_seq
        if checksum is not None:
            rec.checksum = checksum
        self._reindex()
        if recompute or recompute_chain:
            end = len(self.records) if recompute_chain else index + 1
            for i in range(index, end):
                r = self.records[i]
                prev = GENESIS
                if r.prev_seq is not None and r.prev_seq in self.by_seq:
                    stored = self.by_seq[r.prev_seq].checksum
                    prev = stored if checksum_format_ok(stored) else GENESIS
                r.checksum = compute_checksum(r.seq, r.time, r.source,
                                              r.body, prev)
        return index

    # ---- 报告 ----
    def build_report(self, results):
        counts = {OK: 0, MISMATCH: 0, SUSPICIOUS: 0, AFFECTED: 0}
        first_bad = None
        for res in results:
            counts[res["status"]] += 1
            if first_bad is None and res["status"] in BAD_STATUS:
                first_bad = res
        report = {"total": len(results), "counts": counts,
                  "first_bad_seq": first_bad["seq"] if first_bad else None,
                  "first_bad_index": first_bad["index"] if first_bad else None,
                  "affected_range": None, "results": results}
        if first_bad is not None:
            report["affected_range"] = {
                "from_seq": first_bad["seq"],
                "to_seq": results[-1]["seq"],
                "count": len(results) - first_bad["index"],
            }
        return report
