"""需求 5：跳过 —— 约束不满足的输入标记跳过并说明原因，不计入通过。"""

from propverify import GenConfig, Registry, Runner
from propverify.domains import IntDomain
from propverify.verdicts import SKIP


def test_constraint_violating_inputs_are_skipped_not_passed():
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", "x >= 0")  # 对所有 x 恒真
    cfg = GenConfig(seed=9, input_count=60)
    cfg.add_field("o", "x", IntDomain(-10, 10))
    cfg.add_constraint("o", "x % 2 == 0")  # 奇数输入会被跳过
    runner = Runner(reg, cfg).run()
    c = runner.conclusion()["inv"]
    skipped = [g for g in runner.inputs.values() if g.skipped]
    assert skipped, "应存在被约束跳过的输入"
    assert c["skip"] == len(skipped)
    assert c["pass"] + c["skip"] + c["fail"] == cfg.input_count
    # 跳过的输入不得计入通过
    for gin in skipped:
        assert gin.values["x"] % 2 == 1
        assert gin.skip_reason and "约束" in gin.skip_reason
    # 判定存档里跳过键的状态确实是 skip 而非 pass
    for gin in skipped:
        v = runner.store.effective(("inv", "o", gin.index))
        assert v.status == SKIP
        assert "约束" in v.reason


def test_precondition_false_is_skipped_with_reason():
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv", "o", "x > 0", when="x != 0")
    cfg = GenConfig(seed=9, input_count=200)
    cfg.add_field("o", "x", IntDomain(0, 0), edge_weight=0.0)  # 恒为 0 → 前置条件恒假
    runner = Runner(reg, cfg).run()
    c = runner.conclusion()["inv"]
    assert c["skip"] == 200 and c["pass"] == 0 and c["fail"] == 0
    v = runner.store.effective(("inv", "o", 0))
    assert "前置条件" in v.reason
