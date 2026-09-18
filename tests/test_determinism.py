"""需求 3：确定性 —— 同一配置无论生成顺序如何，判定结论完全一致。"""

import random

from propverify import GenConfig, Registry, Runner
from propverify.domains import ChoiceDomain, IntDomain, ListDomain, StringDomain
from propverify.generator import generate_input


def build(seed=42, count=50):
    reg = Registry()
    reg.register_object("order")
    reg.register_invariant("金额有界", "order", "amount <= 80")
    reg.register_invariant("标签非空", "order", "len(tag) > 0", when="amount > 0")
    cfg = GenConfig(seed=seed, input_count=count)
    cfg.add_field("order", "amount", IntDomain(-100, 100))
    cfg.add_field("order", "tag", StringDomain("ab", 0, 4))
    cfg.add_field("order", "items", ListDomain(IntDomain(0, 9), 0, 5))
    cfg.add_field("order", "kind", ChoiceDomain(["a", "b", "c"], weights=[1, 2, 3]))
    return reg, cfg


def test_same_config_same_conclusion_across_runs():
    r1 = Runner(*build()).run()
    r2 = Runner(*build()).run()
    assert r1.conclusion() == r2.conclusion()
    for key in r1.inputs:
        assert r1.inputs[key].values == r2.inputs[key].values


def test_generation_order_does_not_matter():
    reg, cfg = build()
    indices = list(range(cfg.input_count))
    forward = [generate_input(cfg, "order", i) for i in indices]
    rng = random.Random(0)
    shuffled = indices[:]
    rng.shuffle(shuffled)
    backward = {i: generate_input(cfg, "order", i) for i in shuffled}
    for i, gin in zip(indices, forward):
        assert gin.values == backward[i].values
        assert gin.skip_reason == backward[i].skip_reason


def test_conclusion_independent_of_invariant_registration_order():
    reg1, cfg1 = build()
    reg2 = Registry()
    reg2.register_object("order")
    # 反序登记不变量
    reg2.register_invariant("标签非空", "order", "len(tag) > 0", when="amount > 0")
    reg2.register_invariant("金额有界", "order", "amount <= 80")
    _, cfg2 = build()
    c1 = Runner(reg1, cfg1).run().conclusion()
    c2 = Runner(reg2, cfg2).run().conclusion()
    assert c1 == c2
