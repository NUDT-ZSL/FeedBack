"""需求 1：不变量登记 —— 重复标识 / 未登记对象 / 未知字段，拒绝并指出位置。"""

import pytest

from propverify import GenConfig, Registry, SpecError
from propverify.domains import IntDomain
from propverify.loader import load_config


def test_duplicate_invariant_id_rejected_with_location():
    reg = Registry()
    reg.register_object("counter")
    reg.register_invariant("非负", "counter", "x >= 0")
    with pytest.raises(SpecError) as exc:
        reg.register_invariant("非负", "counter", "x > 0")
    assert "invariant[非负]" in str(exc.value)
    assert "重复" in str(exc.value)


def test_unknown_target_rejected_with_location():
    reg = Registry()
    reg.register_object("counter")
    with pytest.raises(SpecError) as exc:
        reg.register_invariant("inv1", "ghost", "x >= 0")
    assert "invariant[inv1]" in str(exc.value)
    assert "ghost" in str(exc.value)
    assert "未登记" in str(exc.value)


def test_expression_referencing_undeclared_field_rejected():
    reg = Registry()
    reg.register_object("counter")
    reg.register_invariant("inv1", "counter", "y >= 0")
    cfg = GenConfig(seed=1, input_count=10)
    cfg.add_field("counter", "x", IntDomain(0, 5))
    with pytest.raises(SpecError) as exc:
        Registry.compile(reg.invariant("inv1"), set(cfg.fields_of("counter")))
    assert "y" in str(exc.value)


def test_loader_reports_json_position():
    data = {
        "objects": ["a"],
        "objects_config": {"a": {"fields": {"x": {"type": "int", "min": 0, "max": 1}}}},
        "invariants": [
            {"id": "ok", "target": "a", "check": "x >= 0"},
            {"id": "ok", "target": "a", "check": "x <= 1"},
        ],
    }
    with pytest.raises(SpecError) as exc:
        load_config(data)
    assert "invariants[1]" in str(exc.value)
    assert "重复" in str(exc.value)


def test_unsafe_expression_rejected():
    reg = Registry()
    reg.register_object("a")
    with pytest.raises(SpecError):
        reg.register_invariant("bad", "a", "__import__('os').system('echo hi')")
