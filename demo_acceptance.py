#!/usr/bin/env python3
"""离线验收演示：多页面多分支交互流。

纯标准库，直接运行：

    python demo_acceptance.py

依次演示：
  1. 条件跳转（按 role 变量走不同页面，兜底分支）；
  2. 提交输入 + 返回恢复（变量快照随历史帧原样恢复）；
  3. 连续快速触发一批动作，中途失败整批回滚（无半迁移）；
  4. 保存成文件并重新载入；载入一个被损坏的文件被清晰拒绝，
     且原有内存状态保持不变。

每一步都打印「预览位置 / 变量快照 / 历史栈深度」，便于与逐步推导比对。
"""

import json
import os
import tempfile

from interflow import (
    PrototypeEngine, TriggerStep,
    Page, PageState, InteractionElement, Action,
    save_to_file, load_from_file,
    BatchAbortedError, BackRejectedError, PersistenceError,
)


def line(title=""):
    print()
    print("=" * 64)
    if title:
        print(title)
        print("-" * 64)


def show(engine, tag):
    page, state = engine.current_position()
    print(f"[{tag}] 位置={page}.{state}  "
          f"变量={json.dumps(engine.get_variables(), ensure_ascii=False)}  "
          f"历史深度={engine.history_depth()}  时钟={engine.clock}")


def build_engine():
    e = PrototypeEngine("home")

    home = Page("home", "s0", [
        PageState("s0", {"role": "guest"}),
        PageState("s_admin", {"role": "admin"}),
    ])
    go = InteractionElement("btn_go")
    go.add_action(Action.branch_goto(
        "go", "role",
        [("guest", "login.s0"), ("vip", "vip.s0"), ("admin", "pay.s0")],
        default_target="denied.s0",
    ))
    home.add_element(go)
    home.add_element(
        _element("btn_set", Action.set_state("become_admin", "s_admin")))
    home.add_element(_back())
    e.add_page(home)

    login = Page("login", "s0", [PageState("s0", {"user": ""})])
    login.add_element(_element(
        "input_name", Action.submit("submit_name", "user", "form", "s0")))
    login.add_element(_back())
    e.add_page(login)

    form = Page("form", "s0", [PageState("s0", {"name": "", "plan": "free"})])
    radio = InteractionElement("radio_plan")
    radio.add_action(Action.submit("set_plan", "plan"))
    radio.add_action(Action.branch_goto(
        "route", "plan",
        [("pro", "pay.s0"), ("free", "result.s0")],
        default_target="form.s0",
    ))
    form.add_element(radio)
    form.add_element(_back())
    e.add_page(form)

    pay = Page("pay", "s0", [PageState("s0", {"amount": 99})])
    pay.add_element(_element("btn_pay", Action.goto("finish", "result", "s0")))
    pay.add_element(_back())
    e.add_page(pay)

    e.add_page(Page("result", "s0", [PageState("s0", {"done": True})]))
    e.add_page(Page("vip", "s0", [PageState("s0", {})]))
    e.add_page(Page("denied", "s0", [PageState("s0", {})]))

    e.validate()
    e.reset()
    return e


def _element(eid, action):
    el = InteractionElement(eid)
    el.add_action(action)
    return el


def _back():
    return _element("back_btn", Action.back("back"))


def demo_conditional():
    line("场景 1：条件分支跳转（互斥 + 兜底）")
    e = build_engine()
    show(e, "初始")
    print("which_branch(role=guest) ->",
          e.which_branch("btn_go", "go", {"role": "guest"})["target_ref"])
    print("which_branch(role=vip)   ->",
          e.which_branch("btn_go", "go", {"role": "vip"})["target_ref"])
    print("which_branch(role=???)   ->",
          e.which_branch("btn_go", "go", {"role": "???"})["target_ref"],
          "（兜底）")
    e.trigger("btn_go", "go")
    show(e, "guest 命中 login")


def demo_back_restore():
    line("场景 2：提交输入、跨页跳转、返回逐帧恢复快照")
    e = build_engine()
    show(e, "初始")
    e.trigger("btn_go", "go")                              # -> login
    show(e, "home -> login")
    e.trigger("input_name", "submit_name", "alice")        # -> form
    show(e, "提交 user=alice -> form")
    e.trigger("radio_plan", "set_plan", "pro")             # 写变量不导航
    show(e, "选择 plan=pro（停留 form）")
    e.trigger("radio_plan", "route")                       # -> pay
    show(e, "条件路由 plan=pro -> pay")
    e.trigger("back_btn", "back")                          # -> form
    show(e, "返回 form（恢复离开时的 plan=pro 快照）")
    e.trigger("back_btn", "back")                          # -> login
    show(e, "返回 login（恢复离开时的 user=alice 快照）")
    e.trigger("back_btn", "back")                          # -> home
    show(e, "返回 home（role 恢复为 guest）")
    try:
        e.trigger("back_btn", "back")
    except BackRejectedError as exc:
        print(f"历史为空时返回被拒绝：{exc}")
    show(e, "被拒绝后位置不变")


def demo_batch_rollback():
    line("场景 3：同一时刻多个动作，稳定排序，失败整批回滚")
    e = build_engine()
    show(e, "批次前")
    steps = [
        TriggerStep("z_ghost", "x"),                    # 排序在后且必失败
        TriggerStep("btn_set", "become_admin"),         # 排序在前、会成功
    ]
    try:
        e.trigger_batch(steps)
    except BatchAbortedError as exc:
        print(f"批次失败：{exc}")
    show(e, "整批回滚后（与批次前完全一致，无半迁移）")
    rec = e.trigger("btn_go", "go")
    print(f"回滚后仍可正常触发，新记录 clock={rec.clock}（时钟无空洞）")
    show(e, "恢复正常导航")


def demo_persistence():
    line("场景 4：单文件保存 / 载入；坏文件被拒绝且内存不变")
    e = build_engine()
    e.trigger("btn_go", "go")
    e.trigger("input_name", "submit_name", "alice")
    e.trigger("radio_plan", "set_plan", "pro")
    show(e, "保存前")

    tmpdir = tempfile.mkdtemp()
    path = os.path.join(tmpdir, "prototype.interflow.json")
    save_to_file(path, e)
    print(f"已写入：{path}")

    loaded = load_from_file(path)
    show(loaded, "重新载入后（位置/变量/历史/日志完全一致）")
    print("迁移日志条数：", len(loaded.migration_log()),
          " 历史帧数：", loaded.history_depth())

    # 制造一个损坏文件：篡改第一条日志的目标页面
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    data["runtime"]["log"][0]["dest"]["page"] = "denied"
    bad_path = os.path.join(tmpdir, "broken.json")
    with open(bad_path, "w", encoding="utf-8") as fh:
        json.dump(data, fh)

    pos_before = e.current_position()
    vars_before = e.get_variables()
    try:
        load_from_file(bad_path)
    except PersistenceError as exc:
        print(f"坏文件载入被拒绝：{exc}")
    assert e.current_position() == pos_before
    assert e.get_variables() == vars_before
    show(e, "载入失败后，原引擎内存状态保持不变")


def demo_reachable_paths():
    line("附：结构可达路径查询（稳定顺序，条件动作展开全部分支）")
    e = build_engine()
    for i, path in enumerate(e.reachable_paths("home")):
        rendered = " -> ".join(f"{p}.{s}" for p, s in path)
        print(f"{i:2d}. {rendered}")


if __name__ == "__main__":
    demo_conditional()
    demo_back_restore()
    demo_batch_rollback()
    demo_persistence()
    demo_reachable_paths()
    line()
    print("全部验收场景演示完成。")
