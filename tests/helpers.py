"""测试共用的多进程交叉依赖场景构造工具。

事件图（按可追加的因果顺序构造）::

    p1: a1(seq1, {p1:0})
    p2: b1(seq1, {p2:0})
    p1: a2(seq2, {p1:1})
    p2: b2(seq2, {p1:1, p2:1})        依赖 a1, b1
    p1: a3(seq3, {p1:2, p2:2})        依赖 a2, b2(->a1,b1)
    p3: c1(seq1, {p1:3, p2:2, p3:0})  依赖 a3, b2（合并点）
    p3: c2(seq2, {p1:3, p2:2, p3:1})  依赖 c1
"""

from __future__ import annotations

from causal_engine import CausalEngine, Event


def build_three_process_engine() -> CausalEngine:
    """构造一个三进程、带交叉因果依赖的引擎（7 个事件）。"""
    engine = CausalEngine()
    for pid in ("p1", "p2", "p3"):
        engine.register_process(pid)

    engine.append(Event("a1", "p1", 1, {"p1": 0}, {"kind": "local"}))
    engine.append(Event("b1", "p2", 1, {"p2": 0}))
    engine.append(Event("a2", "p1", 2, {"p1": 1}))
    engine.append(Event("b2", "p2", 2, {"p1": 1, "p2": 1}, {"kind": "recv"}))
    engine.append(Event("a3", "p1", 3, {"p1": 2, "p2": 2}))
    engine.append(Event("c1", "p3", 1, {"p1": 3, "p2": 2, "p3": 0}))
    engine.append(Event("c2", "p3", 2, {"p1": 3, "p2": 2, "p3": 1}))
    return engine


# 各事件的完整因果闭包（含自身）
CLOSURES: dict[str, set[str]] = {
    "a1": {"a1"},
    "b1": {"b1"},
    "a2": {"a1", "a2"},
    "b2": {"a1", "b1", "b2"},
    "a3": {"a1", "a2", "b1", "b2", "a3"},
    "c1": {"a1", "a2", "a3", "b1", "b2", "c1"},
    "c2": {"a1", "a2", "a3", "b1", "b2", "c1", "c2"},
}
