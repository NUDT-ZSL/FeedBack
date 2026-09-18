"""需求 6：冲突 —— 多来源矛盾判定双方保留，生成可读冲突记录，不静默择一。"""

from propverify import GenConfig, Registry, Runner
from propverify.domains import IntDomain
from propverify.verdicts import CONFLICT, FAIL, PASS, Verdict


def build():
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", "x >= 0")
    cfg = GenConfig(seed=1, input_count=5)
    cfg.add_field("o", "x", IntDomain(0, 10))
    return Runner(reg, cfg).run()


def test_conflicting_verdicts_are_both_kept():
    runner = build()
    key = ("inv", "o", 0)
    local = runner.store.effective(key)
    assert local.status == PASS
    conflict = runner.submit_external("复核系统", *key, Verdict(FAIL, "外部复核判为违反"))
    assert conflict is not None
    # 双方保留
    sources = runner.store.sources(key)
    assert sources["local"].status == PASS
    assert sources["复核系统"].status == FAIL
    # 对外结论标记为冲突，而非静默择一
    assert runner.store.effective(key).status == CONFLICT
    # 冲突记录可读
    text = conflict.describe()
    assert "local" in text and "复核系统" in text
    assert "pass" in text and "fail" in text
    assert "inv" in text


def test_agreeing_sources_produce_no_conflict():
    runner = build()
    key = ("inv", "o", 1)
    conflict = runner.submit_external("复核系统", *key, Verdict(PASS))
    assert conflict is None
    assert runner.store.effective(key).status == PASS
    assert runner.store.conflicts == []


def test_conflicts_appear_in_conclusion_and_report():
    from propverify.report import build_report

    runner = build()
    runner.submit_external("另一实现", "inv", "o", 2, Verdict(FAIL, "重算结果不一致"))
    c = runner.conclusion()["inv"]
    assert c["conflict"] == 1
    report = build_report(runner)
    assert len(report["conflicts"]) == 1
    assert "另一实现" in report["conflicts"][0]
