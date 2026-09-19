# -*- coding: utf-8 -*-
import copy
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logchain.adjudication import AdjudicationStore
from logchain.chain import (BAD_FORMAT, DANGLING, MISMATCH, MISSING, OK,
                            Chain)
from logchain.model import Basis, LogRecord


def make_records(n=10):
    recs = [LogRecord(seq=i, timestamp="2026-09-20T09:%02d:00" % i,
                      source="web-01", body="event %d" % i,
                      prev_seq=None if i == 1 else i - 1)
            for i in range(1, n + 1)]
    chain = Chain(recs)
    prev = ""
    for r in recs:
        r.checksum = r.compute_checksum(chain.basis, prev)
        prev = r.checksum
    return recs


def statuses(chain):
    return [r["status"] for r in chain.results]


class TestChain(unittest.TestCase):
    def test_clean_chain_ok(self):
        c = Chain(make_records())
        c.verify(full=True)
        self.assertEqual(statuses(c), [OK] * 10)
        self.assertIsNone(c.first_fault())

    def test_tamper_detected_with_impact(self):
        recs = make_records()
        recs[3].body = "forged"
        c = Chain(recs)
        c.verify(full=True)
        self.assertEqual(c.results[3]["status"], MISMATCH)
        self.assertEqual(c.first_fault()["index"], 3)
        self.assertEqual(c.impact_of(3), list(range(3, 10)))

    def test_suspicious_kinds(self):
        recs = make_records()
        recs[1].checksum = None
        recs[2].checksum = "xyz"
        recs[3].prev_seq = 777
        c = Chain(recs)
        c.verify(full=True)
        self.assertEqual(c.results[1]["status"], MISSING)
        self.assertEqual(c.results[2]["status"], BAD_FORMAT)
        self.assertEqual(c.results[3]["status"], DANGLING)
        self.assertEqual(len(c.suspicious()), 3)

    def test_incremental_matches_full_and_is_minimal(self):
        recs = make_records()
        c = Chain(copy.deepcopy(recs))
        c.verify(full=True)
        c.edit_record(seq=5, body="edited body")
        inc = [dict(r) for r in c.results]
        self.assertEqual(c.last_recomputed, [4])  # 只有 seq=5 被重算
        c2 = Chain(copy.deepcopy(recs))
        c2.edit_record(seq=5, body="edited body")
        c2.verify(full=True)
        self.assertEqual(inc, c2.results)  # 增量结论 == 全量结论

    def test_checksum_edit_affects_successor(self):
        c = Chain(make_records())
        c.verify(full=True)
        c.edit_record(seq=5, checksum="0" * 64)
        self.assertEqual(sorted(c.last_recomputed), [4, 5])
        self.assertEqual(c.results[4]["status"], MISMATCH)

    def test_basis_change_recomputes_all_and_stays_consistent(self):
        recs = make_records()
        c = Chain(copy.deepcopy(recs))
        c.verify(full=True)
        c.set_basis(Basis(algorithm="sha1"))
        self.assertEqual(len(c.last_recomputed), 10)
        c2 = Chain(copy.deepcopy(recs), Basis(algorithm="sha1"))
        c2.verify(full=True)
        self.assertEqual(c.results, c2.results)


class TestAdjudication(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "adj.json")

    def test_reevaluate_updates_only_affected(self):
        recs = make_records()
        recs[3].body = "forged"   # seq=4 mismatch
        recs[6].checksum = None   # seq=7 missing
        c = Chain(recs)
        c.verify(full=True)
        store = AdjudicationStore(self.path)
        store.rule(4, "tampered", "确认篡改", c.records[3].to_dict(), "mismatch")
        store.rule(7, "false_positive", "运维补录", c.records[6].to_dict(),
                   "missing_checksum")
        snap = copy.deepcopy(store.rulings)

        # 修复 seq=4 的正文 -> 只有 seq=4 的裁决结论应更新
        c.edit_record(seq=4, body="event 4")
        updated = store.re_evaluate(c.results)
        self.assertEqual(updated, [4])
        self.assertEqual(store.rulings[4]["conclusion"],
                         "tampered_but_now_consistent")
        self.assertEqual(store.rulings[7], snap[7])  # 其余裁决保持不变

        # 依据变为 sha1: seq=4 的存储校验值(64位hex)变为格式异常 -> 仅它更新
        c.set_basis(Basis(algorithm="sha1"))
        updated = store.re_evaluate(c.results)
        self.assertEqual(updated, [4])
        self.assertEqual(store.rulings[7], snap[7])  # 其余裁决仍保持不变

    def test_persistence(self):
        store = AdjudicationStore(self.path)
        store.rule(1, "pending", "note", {"seq": 1}, "mismatch")
        store2 = AdjudicationStore(self.path)
        self.assertEqual(store2.rulings[1]["note"], "note")


if __name__ == "__main__":
    unittest.main()
