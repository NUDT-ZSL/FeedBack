"""演示：在小容量存储上回放一段故障前后的运行线索并输出诊断报告。

离线运行，无第三方依赖：python main.py
"""
from devdiag import BoundedClueStore, Clue, Severity, build_report, render_text


def main() -> None:
    # 设备实际可用存储非常有限，只容得下十几条线索
    store = BoundedClueStore(capacity_bytes=1400)

    # 故障链 FAULT-1：温度失控 -> 阀门关闭 -> 停泵冲突 -> 停机
    c1 = store.add(Clue(1.0, "temp-sensor", Severity.WARNING, "温度持续上升",
                        chain_id="FAULT-1", state={"temp": "80C"}))
    c2 = store.add(Clue(2.0, "temp-sensor", Severity.ERROR, "温度越限",
                        chain_id="FAULT-1", state={"temp": "95C"}))
    store.mark_key_evidence(c2.id)  # 现场人员标记关键证据
    store.add(Clue(3.0, "controller", Severity.ERROR, "安全联锁关闭阀门",
                   chain_id="FAULT-1", state={"valve": "closed"}, caused_by=c2.id))
    # 同一时间点两个来源对泵状态给出矛盾结论，双方都必须保留
    store.add(Clue(4.0, "pump-monitor", Severity.ERROR, "泵仍在运行",
                   chain_id="FAULT-1", state={"pump": "on"}, caused_by=c1.id))
    store.add(Clue(4.0, "operator-log", Severity.WARNING, "记录泵已停止",
                   chain_id="FAULT-1", state={"pump": "off"}))
    store.add(Clue(5.0, "controller", Severity.CRITICAL, "系统停机",
                   chain_id="FAULT-1", state={"system": "halt"}))

    # 后续大量例行心跳挤占存储，最旧的线索被覆盖并留下墓碑
    for i in range(6, 30):
        store.add(Clue(float(i * 10), "heartbeat", Severity.INFO,
                       "例行心跳 #" + str(i), state={"load": "normal"}))

    report = build_report(store)
    print(render_text(report))


if __name__ == "__main__":
    main()
