#!/usr/bin/env python3
"""端到端离线演示：边缘网关多上行链路的会话迁移编排。

直接运行： python demo.py
场景覆盖：确定性选路、故障按业务类别优先级迁出、容量不足拒绝并给出
剩余容量、多来源矛盾健康状态的保留与撤销、恢复后增量重算、全量查询、
以及单文件快照保存/重新载入。
"""

import os
import tempfile

from link_orchestrator import (
    LinkOrchestrator,
    save_state,
    load_state,
)


def line(title=""):
    print("\n" + "=" * 68)
    if title:
        print(title)
        print("-" * 68)


def show_trajectory(o, sid):
    print(f"  会话 {sid} 迁移轨迹：")
    for m in o.get_trajectory(sid):
        frm = m.from_link or "（未承载）"
        to = m.to_link or "（搁浅）"
        print(f"    t={m.time:<2} seq={m.seq:<2} {frm} -> {to}  "
              f"[{m.service_class}] {m.reason}（{m.bytes_sent} 字节）")


def main():
    # 业务类别按注册顺序确定优先级：control > telemetry > bulk
    o = LinkOrchestrator(["control", "telemetry", "bulk"])

    line("1. 建立三条上行链路（优先级 / 带宽上限）")
    o.add_link("WAN-5G", priority=1, bandwidth=1000)
    o.add_link("WAN-FIBER", priority=2, bandwidth=600)
    o.add_link("WAN-LTE", priority=2, bandwidth=600)  # 与 FIBER 同优先级，平局按标识字典序
    for lid in ("WAN-5G", "WAN-FIBER", "WAN-LTE"):
        print(f"  {lid}: {o.get_link_load(lid)}")

    line("2. 接入四个业务会话（不指定链路 → 确定性自动选路）")
    o.add_session("sess-控制信令", "control", 300)
    o.add_session("sess-遥测上报", "telemetry", 400)
    o.add_session("sess-日志回传", "bulk", 200)
    o.add_session("sess-视频回传", "bulk", 100, initial_link="WAN-FIBER")
    for sid in sorted(o.sessions):
        print(f"  {sid:<14} 类别={o.sessions[sid].service_class:<9} "
              f"承载={o.get_carrier(sid)}  在途={o.sessions[sid].bytes_sent}")

    line("3. 同一时刻重复上报按幂等处理；时刻倒退被拒绝并指出位置")
    r = o.report_health("WAN-LTE", 1, True, "探针-东区")
    print("  首次上报 duplicate =", r["duplicate"])
    r = o.report_health("WAN-LTE", 1, True, "探针-东区")
    print("  完全重复上报 duplicate =", r["duplicate"], "（忽略，不新增记录）")
    try:
        o.report_health("WAN-LTE", 0, True, "探针-东区")
    except Exception as e:
        print("  时刻倒退被拒绝：", e)

    line("4. t=5：WAN-5G 被报不可用 → 按业务类别优先级迁出，受容量约束")
    r = o.report_health("WAN-5G", 5, False, "探针-东区")
    for m in r["migrations"]:
        print(f"  迁出: {m.session_id}  {m.from_link} -> {m.to_link}  ({m.reason})")
    for s in r["stranded"]:
        print(f"  拒绝迁移: {s['session_id']} 需要 {s['need']}，"
              f"各链路剩余 {s['free_by_link']}")
    print("  迁出后各链路负载：")
    for lid in sorted(o.links):
        print(f"    {lid}: {o.get_link_load(lid)}")

    line("5. 同一时刻另一来源称 WAN-5G 仍可用 → 矛盾：双方保留、不静默择一")
    r = o.report_health("WAN-5G", 5, True, "设备本机心跳")
    for c in r["conflicts"]:
        print("  " + c.describe())
    print("  撤销动作 undone =", r["undone"],
          "；被迁出的会话按记录精确回迁，其他链路会话不受影响：")
    for sid in sorted(o.sessions):
        print(f"    {sid:<14} -> {o.get_carrier(sid)}")
    print("  未解决冲突：", [c.id for c in o.unresolved_conflicts()])
    # 人工裁决只记录结论，不伪造任何一方的健康上报
    o.resolve_conflict("C0001", "现场复核：5G 模组当时确实闪断，按故障闭环")
    print("  裁决后未解决冲突：", [c.id for c in o.unresolved_conflicts()])

    line("6. t=8 两来源一致认定故障；t=10 一致恢复 → 只重算受影响会话")
    print("  t=8 一致故障：")
    r = o.report_health("WAN-5G", 8, False, "探针-东区")
    for m in r["migrations"]:
        print(f"    {m.session_id}  {m.from_link} -> {m.to_link}")
    o.report_health("WAN-5G", 8, False, "设备本机心跳")
    unaffected_before = o.get_carrier("sess-视频回传")
    print("  t=10 一致恢复（增量重算）：")
    r = o.report_health("WAN-5G", 10, True, "探针-东区")
    for m in r["migrations"]:
        print(f"    {m.session_id}  {m.from_link} -> {m.to_link}  ({m.reason})")
    print(f"  未受影响会话 sess-视频回传 恢复前={unaffected_before} "
          f"恢复后={o.get_carrier('sess-视频回传')}（承载未改变）")
    print("  增量结果与从头重新编排完全一致：", end=" ")
    o.verify_consistency()
    print("是（verify_consistency 通过）")

    line("7. 查询：当前承载 / 迁移轨迹 / 链路负载 / 任意时刻可用集合")
    print("  sess-遥测上报 当前承载：", o.get_carrier("sess-遥测上报"))
    show_trajectory(o, "sess-遥测上报")
    print("  各链路在途与剩余：")
    for lid in sorted(o.links):
        d = o.get_link_load(lid)
        print(f"    {lid:<10} 带宽={d['bandwidth']:<5} 在途={d['inflight']:<5} "
              f"剩余={d['free']:<5} 可用={d['available']}")
    print("  任意时刻可用集合（稳定字典序）：")
    for t in (0, 5, 8, 10):
        print(f"    t={t:<2}: {o.available_links(t)}")
    print("  全部未解决冲突：", o.unresolved_conflicts() or "（无）")

    line("8. 保存为单个文件并重新载入（校验标识/容量/迁移来源/校验和）")
    path = os.path.join(tempfile.gettempdir(), "link_orchestrator_demo.json")
    save_state(path, o)
    print("  快照已写入：", path)
    loaded = load_state(path)
    same = loaded._state_signature() == o._state_signature()
    print("  载入后状态签名与保存前完全一致：", "是" if same else "否")
    loaded.verify_consistency()
    print("  载入后重放一致性校验：通过")

    line("演示完成")
    print("  全部操作可追溯（迁移记录/冲突记录/事件日志）、可复现（确定性选路+重放）、")
    print("  可持久化（单文件快照 + 校验和 + 载入全量校验）。")


if __name__ == "__main__":
    main()
