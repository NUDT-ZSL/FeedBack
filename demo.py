"""离线演示：依次展示焦点顺序引擎对应 7 条需求的关键行为。

运行::

    python demo.py

不依赖任何第三方包，仅打印结果，退出码恒为 0（断言内置，失败会抛异常）。
"""

import sys

from focus_order import FocusEngine, FocusError, ErrorCode, RejectCode

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def section(title):
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def main():
    # 需求 1：元素与方向关系维护；重复配置被拒绝并指出冲突方向
    section("需求 1：维护元素与顺序关系，拒绝同方向重复配置")
    engine = FocusEngine()
    for spec in [
        ("a", "form"),
        ("b", "form"),
        ("c", "form"),
        ("ok", "form"),
    ]:
        engine.add_element(*spec)
    engine.add_element("disabled-btn", "form", disabled=True)
    engine.add_element("hidden", "form", focusable=False)
    engine.add_relation("a", "right", "b")
    engine.add_relation("b", "right", "c")
    try:
        engine.add_relation("a", "right", "ok")  # a 在 right 上已指向 b
    except FocusError as err:
        print(f"拒绝重复配置: [{err.code}] {err.message}")
        assert err.context["direction"] == "right"

    # 需求 2：方向推进；非法目标拒绝并说明原因，焦点不变
    section("需求 2：方向键推进，非法目标拒绝且焦点保持")
    engine.set_focus("a")
    print("a 按 right ->", engine.advance("right").target)  # b
    engine.add_relation("b", "down", "disabled-btn")
    result = engine.advance("down")
    print("b 按 down ->", f"拒绝({result.code})", "| 焦点仍为:", engine.current_focus)
    assert not result.accepted and engine.current_focus == "b"
    print("最近一次拒绝原因:", engine.last_rejection["message"])

    # 需求 3：可预测——同状态重复推进一致
    section("需求 3：可预测推进（同元素同方向结果恒定）")
    again1 = engine.advance("up")  # b 没有 up 关系
    again2 = engine.advance("up")
    print("连续两次 up:", again1.code, again2.code, "| 焦点:", engine.current_focus)
    assert again1.code == again2.code == RejectCode.NO_RELATION

    # 需求 4：成环检测与报告
    section("需求 4：环检测——列出环序列，拒绝环路推进")
    engine.add_relation("c", "right", "a")  # a->b->c->a 成环
    cycles = engine.find_cycles()
    for cycle in cycles:
        print(f"发现环（方向 {cycle.direction}）:", " -> ".join(cycle.nodes), "-> ...")
    result = engine.advance("right")  # b 在环上
    print("b 按 right:", f"拒绝({result.code})", "| 环:",
          " -> ".join(result.rejection.cycle), "| 焦点仍为:", engine.current_focus)
    assert result.code == RejectCode.CYCLE

    # 需求 5：容器接管（弹层焦点陷阱）
    section("需求 5：容器接管，方向键不逃逸，结束后焦点恢复")
    engine.add_element("d1", "dialog")
    engine.add_element("d2", "dialog")
    engine.add_relation("d1", "right", "d2")
    engine.add_relation("d2", "right", "b")       # 逃逸边：dialog -> form
    engine.enter_scope("dialog")
    print("进入弹层，焦点:", engine.current_focus, "| 接管容器:", engine.active_container)
    moved = engine.advance("right")
    print(f"d1 按 right -> {moved.target}（accepted={moved.accepted}）")  # d2
    escape = engine.advance("right")  # d2 -> b 逃逸
    print("d2 按 right:", f"拒绝({escape.code})", "| 焦点仍在弹层:", engine.current_focus)
    assert escape.code == RejectCode.SCOPE_ESCAPE and engine.current_focus == "d2"
    print("结束接管，焦点恢复为:", engine.exit_scope())  # b

    # 需求 6：动态删除，只清受影响关系，无悬空边，回退最近可用
    section("需求 6：动态删除/禁用——增量结果与重建一致")
    print("完整性检查（删除前）:", engine.validate_integrity() or "无问题")
    engine.set_focus("c")
    engine.remove_element("c")  # 当前焦点被删
    print("删除当前焦点 c 后，回退到:", engine.current_focus)  # 同容器最近前驱 b
    print("b 的 right 目标（原指向 c，应已清空）:", engine.get_target("b", "right"))
    print("完整性检查（删除后）:", engine.validate_integrity() or "无问题")
    rebuilt = engine.rebuild()
    print("快照重建与增量状态一致:", rebuilt.graph_snapshot() == engine.graph_snapshot())
    assert rebuilt.graph_snapshot() == engine.graph_snapshot()

    # 需求 7：稳定查询、历史与最近拒绝
    section("需求 7：稳定查询 / 焦点历史 / 最近拒绝原因")
    ids = [e["id"] for e in engine.list_elements()]
    print("元素稳定排序:", ids)
    print("当前焦点:", engine.current_focus)
    print("a 的各方向目标:", engine.targets("a"))
    print("最近一次拒绝:", engine.last_rejection["code"], "-",
          engine.last_rejection["message"])
    print("焦点历史（最近 5 条）:")
    for entry in engine.history()[-5:]:
        extra = f" via {entry['direction']}" if entry["direction"] else ""
        print(f"  #{entry['seq']:>2} {entry['kind']:<12} "
              f"{entry['source']!r} -> {entry['target']!r}{extra}")
    assert ids == sorted(ids, key=lambda x: (1, x))  # 字符串 id 字典序

    # 附加：完整导出/导入往返（接管栈、历史、最近拒绝都保留）
    section("附加：导出 / 导入往返（to_json / from_json）")
    text = engine.to_json()
    cloned = FocusEngine.from_json(text)
    print("往返后焦点一致:", cloned.current_focus == engine.current_focus)
    print("往返后接管容器一致:", cloned.active_container == engine.active_container)
    print("往返后历史一致:", cloned.history() == engine.history())
    print("往返后最近拒绝一致:", cloned.last_rejection == engine.last_rejection)
    print("再次导出字节一致:", cloned.to_json() == text)
    assert cloned.export_state() == engine.export_state()

    print("\n全部 7 个场景断言通过。")


if __name__ == "__main__":
    main()
