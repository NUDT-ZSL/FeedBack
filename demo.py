"""端到端演示：有限存储下的一次泵故障诊断。"""

from diagnostics import BoundedClueStore, Clue, Severity, build_report


def main() -> None:
    # 设备只有约 1.2KB 的线索存储空间。
    store = BoundedClueStore(capacity_bytes=1200)
    c1 = Clue(1000.0, "thermal", Severity.WARNING, "coolant temp over limit",
              state={"temp": 87, "pump": "on"}, chain_id="chain-A")
    c2 = Clue(1005.0, "pump", Severity.ERROR, "pump current overload",
              state={"pump": "overload", "current": 14.2},
              causes=[c1.id], chain_id="chain-A", key_evidence=True)
    c3 = Clue(1010.0, "pump", Severity.CRITICAL, "pump shutdown protection",
              state={"pump": "stopped"}, causes=[c2.id], chain_id="chain-A")
    store.add_many([c1, c2, c3])

    # 同一时间点来自同一来源的冲突线索：转速上报互相矛盾，双方保留。
    c4 = Clue(1010.0, "pump", Severity.ERROR, "rpm sample A",
              state={"rpm": 0}, chain_id="chain-A")
    c5 = Clue(1010.0, "pump", Severity.ERROR, "rpm sample B",
              state={"rpm": 3200}, chain_id="chain-A")
    store.add_many([c4, c5])

    # 大量无关的运行噪音填满存储，触发覆盖。
    for i in range(12):
        store.add(Clue(1020.0 + i, "metrics", Severity.DEBUG,
                       f"periodic sample {i}", state={"tick": i}))

    # 故障链闭环：恢复正常。此后 chain-A 上的关键证据也可被覆盖。
    c6 = Clue(1100.0, "pump", Severity.INFO, "pump recovered",
              state={"pump": "on", "temp": 62},
              causes=[c3.id], chain_id="chain-A", resolves_chain=True)
    store.add(c6)

    report = build_report(store)
    print(report.render_text())


if __name__ == "__main__":
    main()
