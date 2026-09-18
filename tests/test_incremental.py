"""需求 7：增量重判 —— 只重判受影响输入，结果与从头重跑完全一致，未受影响结论不变。"""

from propverify import GenConfig, Registry, Runner
from propverify.domains import ChoiceDomain, IntDomain
from propverify.registry import Invariant


def build(seed=17, count=40, hi=100, check="x <= 1000000"):
    reg = Registry()
    reg.register_object("o")
    reg.register_invariant("inv_x", "o", check)
    reg.register_invariant("inv_y", "o", "y >= -1000000")
    cfg = GenConfig(seed=seed, input_count=count)
    cfg.add_field("o", "x", IntDomain(-50, hi))
    cfg.add_field("o", "y", ChoiceDomain([1, 2, 3]))
    return reg, cfg


def verdict_map(runner):
    return {k: runner.store.effective(k) for k in runner.store.keys()}


def test_invariant_change_only_rejudges_that_invariant():
    reg, cfg = build()
    runner = Runner(reg, cfg).run()
    before = verdict_map(runner)
    other_keys = {k for k in before if k[0] == "inv_y"}
    other_before = {k: id(runner.store.sources(k)["local"]) for k in other_keys}

    summary = runner.update_invariant(Invariant("inv_x", "o", "x <= 0"))
    assert summary.rejudged and all(k[0] == "inv_x" for k in summary.rejudged)

    # 未受影响的不变量：判定对象原样保留（同一实例，未被重算）
    for k in other_keys:
        assert id(runner.store.sources(k)["local"]) == other_before[k]

    # 与从头重跑完全一致
    reg2, cfg2 = build(check="x <= 0")
    fresh = Runner(reg2, cfg2).run()
    assert verdict_map(runner) == verdict_map(fresh)
    assert runner.conclusion() == fresh.conclusion()


def test_domain_change_matches_full_rerun_and_keeps_unaffected():
    reg, cfg = build()
    runner = Runner(reg, cfg).run()
    # y 的取值域不变、x 变窄：部分输入的 x 不变 → 这些键的判定对象必须原样保留
    before_ids = {k: id(runner.store.sources(k)["local"]) for k in runner.store.keys()}

    summary = runner.update_domain("o", "x", IntDomain(-50, 30))
    assert summary.regenerated_inputs, "应有输入被重新生成"
    assert summary.unchanged_verdicts > 0, "应有未受影响的判定被保留"

    affected = {(inv, t, i) for (inv, t, i) in summary.rejudged}
    for key, old_id in before_ids.items():
        if key not in affected:
            assert id(runner.store.sources(key)["local"]) == old_id, f"未受影响键 {key} 被改动"

    # 与用新配置从头跑完全一致
    reg2, cfg2 = build(hi=30)
    fresh = Runner(reg2, cfg2).run()
    assert verdict_map(runner) == verdict_map(fresh)
    assert runner.conclusion() == fresh.conclusion()
    # 收缩结果也一致
    for key, detail in fresh.failures.items():
        assert runner.failures[key].shrink.shrunk == detail.shrink.shrunk


def test_constraint_change_only_rejudges_skip_status_changes():
    reg, cfg = build()
    runner = Runner(reg, cfg).run()
    before = verdict_map(runner)
    summary = runner.update_constraint("o", ["x != 7"])
    changed = {k for k, v in verdict_map(runner).items() if v != before.get(k)}
    # 只有 x == 7 的输入跳过状态变化
    for (inv, t, i) in changed:
        assert runner.inputs[(t, i)].values["x"] == 7
    assert changed == set(summary.rejudged)

    reg2, cfg2 = build()
    cfg2.add_constraint("o", "x != 7")
    fresh = Runner(reg2, cfg2).run()
    assert verdict_map(runner) == verdict_map(fresh)


def test_noop_update_touches_nothing():
    reg, cfg = build()
    runner = Runner(reg, cfg).run()
    ids_before = {k: id(runner.store.sources(k)["local"]) for k in runner.store.keys()}
    summary = runner.update_invariant(Invariant("inv_x", "o", "x <= 1000000"))
    assert not summary.rejudged
    for k, old_id in ids_before.items():
        assert id(runner.store.sources(k)["local"]) == old_id
