"""需求 2：生成配置校验 —— 空取值域 / 非法权重 / 约束互相排斥，拒绝并说明原因。"""

import pytest

from propverify import GenConfig, SpecError
from propverify.domains import ChoiceDomain, Domain, IntDomain, ListDomain, StringDomain


def make_cfg():
    return GenConfig(seed=7, input_count=10)


def test_empty_int_domain_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "x", IntDomain(5, 3))
    assert "取值域为空" in str(exc.value)
    assert "field[x]" in str(exc.value)


def test_empty_choice_domain_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "x", ChoiceDomain([]))
    assert "取值域为空" in str(exc.value)


def test_all_zero_weights_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "x", ChoiceDomain(["a", "b"], weights=[0, 0]))
    assert "权重" in str(exc.value)


def test_weight_length_mismatch_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "x", ChoiceDomain(["a", "b"], weights=[1]))
    assert "不一致" in str(exc.value)


def test_empty_string_alphabet_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "s", StringDomain("", 1, 4))
    assert "取值域为空" in str(exc.value)


def test_list_length_inversion_rejected():
    with pytest.raises(SpecError) as exc:
        make_cfg().add_field("o", "l", ListDomain(IntDomain(0, 1), 5, 2))
    assert "取值域为空" in str(exc.value)


def test_mutually_exclusive_constraints_rejected():
    cfg = make_cfg()
    cfg.add_field("o", "x", IntDomain(0, 10))
    cfg.add_constraint("o", "x > 8")
    with pytest.raises(SpecError) as exc:
        cfg.add_constraint("o", "x < 2")
    assert "互相排斥" in str(exc.value)
    assert "x > 8" in str(exc.value) and "x < 2" in str(exc.value)


def test_satisfiable_constraints_accepted():
    cfg = make_cfg()
    cfg.add_field("o", "x", IntDomain(0, 10))
    cfg.add_field("o", "y", IntDomain(0, 10))
    cfg.add_constraint("o", "x + y >= 5")
    cfg.add_constraint("o", "x <= 8")


def test_constraint_on_undeclared_field_rejected():
    cfg = make_cfg()
    cfg.add_field("o", "x", IntDomain(0, 10))
    with pytest.raises(SpecError) as exc:
        cfg.add_constraint("o", "z > 1")
    assert "z" in str(exc.value)


def test_unknown_domain_type_rejected():
    with pytest.raises(SpecError) as exc:
        Domain.from_spec({"type": "uuid"}, "p")
    assert "未知取值域类型" in str(exc.value)
