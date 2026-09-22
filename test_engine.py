# -*- coding: utf-8 -*-
"""Engine tests: multi-rule evidence, incremental re-derivation, untrusted cases."""
import copy
import json
import os

from engine import Engine, split_chapters, full_recheck, normalize

BASE = os.path.dirname(os.path.abspath(__file__))


def load():
    with open(os.path.join(BASE, "data", "document.md"), encoding="utf-8") as f:
        chapters = split_chapters(f.read())
    with open(os.path.join(BASE, "data", "rules.json"), encoding="utf-8") as f:
        rules = json.load(f)["rules"]
    return chapters, rules


def test_multi_rule_same_location():
    chapters, rules = load()
    results, _ = Engine().evaluate(rules, chapters)
    # "使用者" in ch1 must trigger BOTH T1 (terminology) and C1 (consistency)
    t1 = [r for r in results if r["rule_id"] == "T1" and r["chapter_id"] == "ch1"][0]
    c1 = [r for r in results if r["rule_id"] == "C1" and r["chapter_id"] == "ch1"][0]
    t1_spans = {(v["start"], v["end"]) for v in t1["violations"] if v["matched"] == "使用者"}
    c1_spans = {(v["start"], v["end"]) for v in c1["violations"] if v["matched"] == "使用者"}
    assert t1_spans and t1_spans == c1_spans, "同一位置的多条规范依据必须全部保留"
    print("PASS multi-rule evidence preserved at same location")


def test_incremental_matches_full():
    chapters, rules = load()
    engine = Engine()
    engine.evaluate(rules, chapters)
    # modify one rule only
    rules2 = copy.deepcopy(rules)
    for r in rules2:
        if r["id"] == "T1":
            r["forbidden"] = ["使用者", "客户", "消费者"]
    results, stats = engine.evaluate(rules2, chapters)
    # only T1 pairs (5 chapters) should be recomputed; everything else reused
    assert stats["recomputed"] == 5, stats
    assert stats["reused"] > 0, stats
    assert normalize(results) == normalize(full_recheck(rules2, chapters)), \
        "增量重推必须与整体重推一致"
    print("PASS incremental re-derivation (edit) == full re-run, recomputed=%d reused=%d"
          % (stats["recomputed"], stats["reused"]))
    # delete one rule: nothing recomputed, results still equal full re-run
    rules3 = [r for r in rules2 if r["id"] != "O2"]
    results3, stats3 = engine.evaluate(rules3, chapters)
    assert stats3["recomputed"] == 0, stats3
    assert all(r["rule_id"] != "O2" for r in results3)
    assert normalize(results3) == normalize(full_recheck(rules3, chapters))
    print("PASS incremental re-derivation (delete) == full re-run, recomputed=0")


def test_untrusted_cases():
    chapters, rules = load()
    results, _ = Engine().evaluate(rules, chapters)
    t9 = [r for r in results if r["rule_id"] == "T9"]
    assert t9 and all(r["status"] == "untrusted" for r in t9)
    assert any("ch9" in r["reason"] for r in t9), "缺失章节必须说明原因"
    c9 = [r for r in results if r["rule_id"] == "C9"]
    assert c9 and all(r["status"] == "untrusted" for r in c9)
    assert any("云同步" in r["reason"] for r in c9), "目标不存在必须说明原因"
    print("PASS untrusted conclusions flagged with reasons")


def test_violation_locations():
    chapters, rules = load()
    results, _ = Engine().evaluate(rules, chapters)
    o1 = [r for r in results if r["rule_id"] == "O1" and r["chapter_id"] == "ch1"][0]
    assert o1["status"] == "violation"
    v = o1["violations"][0]
    assert v["chapter_title"] and v["snippet"] and v["matched"] in "！!"
    c2 = [r for r in results if r["rule_id"] == "C2" and r["chapter_id"] == "ch3"][0]
    assert c2["status"] == "violation", "ch3 缺少小结应判违反"
    c2_ok = [r for r in results if r["rule_id"] == "C2" and r["chapter_id"] == "ch1"][0]
    assert c2_ok["status"] == "pass"
    print("PASS violation locations carry chapter + context snippet")


if __name__ == "__main__":
    test_multi_rule_same_location()
    test_incremental_matches_full()
    test_untrusted_cases()
    test_violation_locations()
    print("ALL TESTS PASSED")
