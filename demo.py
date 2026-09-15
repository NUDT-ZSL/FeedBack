"""端到端演示：离线设备配置适配内核。

运行（无需任何第三方包、无需联网）：

    python demo.py

脚本依次演示需求 1~8：登记设备/字段/迁移规则、适配旧配置到新设备（默认补齐）、
新配置到旧设备（安全降级）、取舍原因查询、迁移路径查询、断链报错、
导出/损坏载入/原子失败。
"""

from __future__ import annotations

import io

from device_config import (
    ConfigKernel,
    CorruptStateError,
    MigrationChainError,
    MissingFieldError,
    VersionError,
    dump_json,
    export_state,
    load_json,
)


def hr(title):
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def show_decisions(record):
    print(f"  {'字段':<14}{'结论':<6}{'来源':<10}原因")
    for d in record["decisions"]:
        verdict = "保留" if d["kept"] else "裁掉"
        print(f"  {d['field']:<14}{verdict:<6}{d['source'] or '-':<10}{d['detail']}")


def main():
    k = ConfigKernel()

    # ---- 需求 2：字段定义（名字/类型/引入版本/默认值） -------------------
    hr("需求 1/2：登记字段定义与设备")
    k.register_field("ssid", "string", "1.0")
    k.register_field("timeout_ms", "int", "1.0", default=1000)
    # 2.0 起字段改名并改类型；timeout_s 是为改名登记的新字段
    k.register_field("timeout_s", "float", "2.0", default=1.0)
    k.register_field("power_save", "bool", "2.0", default=False)
    # 3.0 的蓝牙字段需要 bt 能力；interval 必填且有默认
    k.register_field("bt_name", "string", "3.0", required=False,
                     required_capabilities={"bt"})
    k.register_field("interval", "int", "3.0", default=60)

    # ---- 需求 5：迁移规则（改名 + 改类型） -------------------------------
    k.register_migration_rule(
        "1.0", "2.0",
        renames=[("timeout_ms", "timeout_s")],
        type_changes=[("timeout_ms", "float")],
    )
    k.register_migration_rule("2.0", "3.0")  # 纯字段新增版本

    # ---- 需求 1：设备（唯一标识/型号/固件/能力集合） ----------------------
    k.register_device("dev-old", "Sensor-A", "1.0.0", {"wifi"})
    k.register_device("dev-mid", "Sensor-A", "2.0.0", {"wifi"})
    k.register_device("dev-new", "Sensor-B", "3.0.0", {"wifi", "bt"})

    # ---- 两份配置：旧版 v1 与新版 v3 --------------------------------------
    k.register_config("cfg-old", "1.0.0",
                      {"ssid": "home", "timeout_ms": 500})
    k.register_config("cfg-new", "3.0.0",
                      {"ssid": "home", "timeout_s": 2.0,
                       "power_save": True, "bt_name": "node", "interval": 30})

    print(f"已登记 {len(k.list_devices())} 台设备、"
          f"{len(k.list_fields())} 个字段、"
          f"{len(k.list_migration_rules())} 条迁移规则。")

    # 非法版本号要拒绝并指出位置
    try:
        k.register_device("bad", "X", "1.o.0", set())
    except VersionError as exc:
        print(f"非法版本被拒绝：{exc}")

    # ---- 需求 4：旧配置 -> 新设备，默认补齐 -------------------------------
    hr("需求 4：旧配置 cfg-old@1.0 适配到新设备 dev-new@3.0（默认补齐）")
    rec = k.adapt("cfg-old", "dev-new")
    print("迁移路径：", " -> ".join(
        f"{p['from']}→{p['to']}" + ("（无变更）" if p["identity"] else "")
        for p in rec["migration_path"]))
    print("生效配置：", rec["effective_config"])
    show_decisions(rec)

    # ---- 需求 3：新配置 -> 旧设备，安全降级 --------------------------------
    hr("需求 3：新配置 cfg-new@3.0 适配到旧设备 dev-old@1.0（安全降级）")
    rec_old = k.adapt("cfg-new", "dev-old")
    print("生效配置：", rec_old["effective_config"])
    show_decisions(rec_old)

    # ---- 缺能力裁剪 --------------------------------------------------------
    hr("需求 3：同版本但缺 bt 能力的设备裁剪 bt_name")
    k.register_device("dev-btless", "Sensor-B", "3.0.0", {"wifi"})
    rec_btless = k.adapt("cfg-new", "dev-btless")
    why = k.field_decision(rec_btless["record_id"], "bt_name")
    print(f"bt_name：保留={why['kept']}，原因码={why['reason']}")
    print(f"说明：{why['detail']}")

    # ---- 必填无默认 -> 拒绝并指出字段名 ------------------------------------
    hr("需求 4：必填字段无默认且缺失 -> 拒绝并指出字段名")
    k2 = ConfigKernel()
    k2.register_field("ssid", "string", "1.0")
    k2.register_field("interval", "int", "2.0", required=True)  # 必填、无默认
    k2.register_device("d", "M", "2.0.0", set())
    k2.register_config("c", "1.0.0", {"ssid": "home"})
    try:
        k2.adapt("c", "d")
    except MissingFieldError as exc:
        print(f"适配被拒绝：{exc}")

    # ---- 需求 5：断链报错并指出断点版本 ------------------------------------
    hr("需求 5：迁移链断裂 -> 指出断点版本")
    k3 = ConfigKernel()
    k3.register_field("a", "int", "1.0")
    k3.register_field("b", "int", "2.0", required=False)
    k3.register_field("c", "int", "4.0", required=False)
    k3.register_migration_rule("1.0", "2.0")
    k3.register_migration_rule("3.0", "4.0")  # 2.0 与 3.0 之间断链
    k3.register_device("d", "M", "4.0.0", set())
    k3.register_config("c", "1.0.0", {"a": 1})
    try:
        k3.adapt("c", "d")
    except MigrationChainError as exc:
        print(f"断点版本={exc.breakpoint_version}，目标={exc.target_version}")
        print(f"完整错误：{exc}")

    # ---- 需求 7：查询 ------------------------------------------------------
    hr("需求 7：查询生效配置 / 字段取舍原因 / 完整迁移路径")
    k.adapt("cfg-new", "dev-mid")  # 先为 dev-mid 生成适配记录
    print("dev-mid 当前生效配置：", k.effective_config("dev-mid"))
    rid = rec_old["record_id"]
    print("timeout_ms 的取舍：", k.field_decision(rid, "timeout_ms")["detail"])
    print("power_save 的取舍：", k.field_decision(rid, "power_save")["detail"])
    print("1.0.0 -> 3.0.0 完整迁移路径：")
    for step in k.describe_migration_path("1.0.0", "3.0.0"):
        extra = []
        if step["renames"]:
            extra.append("改名 " + ", ".join(f"{a}->{b}" for a, b in step["renames"]))
        if step["type_changes"]:
            extra.append("改类型 " + ", ".join(f"{f}:{t}" for f, t in step["type_changes"]))
        print(f"  {step['from']} -> {step['to']}  {'; '.join(extra) or '（无结构变更）'}")

    # ---- 需求 6：确定性 ----------------------------------------------------
    hr("需求 6：重复适配结果完全相同（含记录 ID）")
    again = k.adapt("cfg-new", "dev-old")
    print(f"首次记录 ID：{rid}")
    print(f"再次记录 ID：{again['record_id']}")
    print("内容完全一致：", again == rec_old)

    # ---- 需求 8：导出 / 重新载入 / 损坏报错 / 失败状态不变 -----------------
    hr("需求 8：导出 JSON、损坏检测、载入失败状态不变")
    text = dump_json(k)
    restored = load_json(text)
    print(f"导出 {len(text)} 字符；重新载入后再次导出逐字符相同：",
          dump_json(restored) == text)

    state = export_state(k)
    state["devices"][0]["firmware"] = "1.x"  # 篡改出版本错误
    buf = io.StringIO()
    before = len(k.list_devices())
    try:
        load_json(__import__("json").dumps(state))
    except (CorruptStateError, VersionError) as exc:
        print(f"损坏存档被拒绝：{str(exc)[:80]}...")
    print(f"载入失败后原内核设备数仍为 {len(k.list_devices())}（载入前 {before}），状态不变。")

    print("\n演示完成。")


if __name__ == "__main__":
    main()
