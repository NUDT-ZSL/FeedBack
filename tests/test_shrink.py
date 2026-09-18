"""需求 4：反例收缩 —— 每步有依据、结果可复现、收缩后仍违反原不变量。"""

from propverify import GenConfig, Registry, Runner
from propverify.domains import IntDomain, ListDomain
from propverify.shrink import shrink_input


def build(check="x <= 1000000", seed=3, count=30):
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", check)
    cfg = GenConfig(seed=seed, input_count=count)
    cfg.add_field("o", "x", IntDomain(-500, 500))
    return reg, cfg


def test_shrink_steps_have_reasons_and_result_still_violates():
    reg, cfg = build(check="x <= 50")
    runner = Runner(reg, cfg).run()
    conclusion = runner.conclusion()
    assert conclusion["inv"]["fail"] > 0, "应存在违反 x <= 50 的输入"
    for key in conclusion["inv"]["failures"]:
        detail = runner.failures[key]
        shrink = detail.shrink
        assert shrink is not None
        assert shrink.verified, "收缩结果必须复验仍违反原不变量"
        for step in shrink.steps:
            assert step.reason, "每次收缩必须给出依据"
        # 收缩结果不比原始值更“大”
        assert abs(shrink.shrunk["x"] - 0) <= abs(shrink.original["x"] - 0) or shrink.shrunk["x"] == shrink.original["x"]


def test_shrink_is_reproducible():
    reg, cfg = build(check="x <= 50")
    runner = Runner(reg, cfg).run()
    key = runner.conclusion()["inv"]["failures"][0]
    original = runner.failures[key].values
    compiled = runner._compiled["inv"]
    violates = lambda v: not compiled.holds(v) if compiled.applies(v) else False
    s1 = shrink_input(cfg, "o", original, violates)
    s2 = shrink_input(cfg, "o", original, violates)
    assert s1.shrunk == s2.shrunk
    assert [(s.field, s.old, s.new, s.reason) for s in s1.steps] == [
        (s.field, s.old, s.new, s.reason) for s in s2.steps
    ]
    assert s1.verified and s2.verified


def test_shrink_respects_constraints():
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", "x <= 10")
    cfg = GenConfig(seed=11, input_count=50)
    cfg.add_field("o", "x", IntDomain(0, 500))
    cfg.add_constraint("o", "x >= 5")  # 收缩不得越过约束进入“应跳过”的区域
    runner = Runner(reg, cfg).run()
    for key in runner.conclusion()["inv"]["failures"]:
        shrink = runner.failures[key].shrink
        assert shrink.shrunk["x"] >= 5, "收缩结果逃出约束，会被误当作有效反例"
        assert shrink.verified


def test_list_shrinking_toward_shorter():
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", "sum(xs) < 100")
    cfg = GenConfig(seed=5, input_count=40)
    cfg.add_field("o", "xs", ListDomain(IntDomain(0, 50), 0, 8))
    runner = Runner(reg, cfg).run()
    failures = runner.conclusion()["inv"]["failures"]
    if failures:  # 有失败时验证收缩方向
        detail = runner.failures[failures[0]]
        assert detail.shrink.verified
        assert sum(detail.shrink.shrunk["xs"]) >= 100
