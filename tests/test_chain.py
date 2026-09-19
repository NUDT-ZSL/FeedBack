# -*- coding: utf-8 -*-
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from logchain.chain import AFFECTED, LogChain, MISMATCH, OK, SUSPICIOUS
from logchain.store import AdjudicationStore
from sample_data import build_records, write_sample


def make_chain(count=30, tamper=False):
    lines = [json.dumps(r, ensure_ascii=False)
             for r in build_records(count=count, tamper=tamper)]
    return LogChain.from_text("\n".join(lines))


class TestFullVerify(unittest.TestCase):
    def test_clean_chain_all_ok(self):
        report = make_chain().verify_full()
        self.assertEqual(report["counts"][OK], 30)
        self.assertIsNone(report["first_bad_seq"])
        self.assertIsNone(report["affected_range"])

    def test_tampered_body_detected_with_impact_range(self):
        chain = make_chain()
        chain.update_record(1005, body="forged entry")
        report = chain.verify_full()
        self.assertEqual(report["first_bad_seq"], 1005)
        self.assertEqual(report["results"][4]["status"], MISMATCH)
        # 首个断点之后的记录全部落入影响范围
        self.assertEqual(report["affected_range"]["from_seq"], 1005)
        self.assertEqual(report["affected_range"]["count"], 30 - 4)
        self.assertEqual(report["results"][5]["status"], AFFECTED)

    def test_suspicious_missing_malformed_dangling(self):
        chain = make_chain()
        chain.update_record(1007, checksum="")            # 缺失
        chain.update_record(1009, checksum="not-hex")     # 格式异常
        rec = chain.records[12]
        rec.prev_seq = 424242                             # 悬空引用
        chain._reindex()
        report = chain.verify_full()
        by_seq = {r["seq"]: r for r in report["results"]}
        self.assertEqual(by_seq[1007]["status"], SUSPICIOUS)
        self.assertIn("缺失", by_seq[1007]["reasons"][0])
        self.assertEqual(by_seq[1009]["status"], SUSPICIOUS)
        self.assertIn("格式异常", by_seq[1009]["reasons"][0])
        self.assertEqual(by_seq[1013]["status"], SUSPICIOUS)
        self.assertIn("不存在的顺序号", by_seq[1013]["reasons"][0])

    def test_sample_data_flags_four_bad_records(self):
        report = make_chain(count=40, tamper=True).verify_full()
        bad = [r for r in report["results"]
               if r["status"] in (MISMATCH, SUSPICIOUS)]
        self.assertEqual(len(bad), 4)
        self.assertEqual(report["first_bad_seq"], 1012)


class TestIncrementalVerify(unittest.TestCase):
    def test_incremental_matches_full_after_body_edit(self):
        chain = make_chain()
        chain.verify_full()
        index = chain.update_record(1010, body="edited body")
        incr = chain.verify_from(index)
        self.assertEqual(incr["recomputed"], 30 - index)
        self.assertEqual(incr["reused"], index)
        full = make_chain()
        full.update_record(1010, body="edited body")
        full_report = full.verify_full()
        self.assertEqual(incr["results"], full_report["results"])
        self.assertEqual(incr["first_bad_seq"], full_report["first_bad_seq"])

    def test_incremental_matches_full_after_seq_edit(self):
        chain = make_chain()
        chain.verify_full()
        index = chain.update_record(1015, new_seq=9999)
        incr = chain.verify_from(index)
        full = make_chain()
        full.update_record(1015, new_seq=9999)
        self.assertEqual(incr["results"], full.verify_full()["results"])

    def test_incremental_matches_full_after_checksum_edit(self):
        chain = make_chain()
        chain.verify_full()
        index = chain.update_record(1020, checksum="ab" * 32)
        incr = chain.verify_from(index)
        full = make_chain()
        full.update_record(1020, checksum="ab" * 32)
        self.assertEqual(incr["results"], full.verify_full()["results"])

    def test_recompute_chain_repairs(self):
        chain = make_chain()
        chain.update_record(1005, body="corrected content", recompute_chain=True)
        report = chain.verify_full()
        self.assertEqual(report["counts"][OK], 30)


class TestAdjudication(unittest.TestCase):
    def test_adjudications_survive_basis_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "logs.jsonl")
            write_sample(path, count=30, tamper=True)
            chain = LogChain.from_file(path)
            store = AdjudicationStore(path + ".adjudications.json")
            chain.verify_full()
            store.set(1012, "confirmed_tampered", "admin 账号来源异常")
            store.set(1020, "accepted", "值班长确认")
            # 校验依据变化：修改一条记录并增量校验
            index = chain.update_record(1005, body="changed")
            chain.verify_from(index)
            # 裁决全部保留，未被重算覆盖
            store2 = AdjudicationStore(path + ".adjudications.json")
            self.assertEqual(store2.get(1012)["verdict"], "confirmed_tampered")
            self.assertEqual(store2.get(1012)["note"], "admin 账号来源异常")
            self.assertEqual(store2.get(1020)["verdict"], "accepted")

    def test_unaffected_prefix_results_unchanged(self):
        chain = make_chain()
        before = chain.verify_full()
        index = chain.update_record(1025, body="late edit")
        after = chain.verify_from(index)
        # 受影响区间之前的结论逐条保持一致（只更新了受影响区间）
        self.assertEqual(before["results"][:index], after["results"][:index])
        self.assertEqual(after["reused"], index)


if __name__ == "__main__":
    unittest.main()
