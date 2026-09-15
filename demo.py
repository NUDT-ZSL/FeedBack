#!/usr/bin/env python3
"""端到端演示：把测试固件（tests/helpers.py 中的三版本故事）跑一遍并打印结果。

完全离线、仅标准库：

    python demo.py
"""

from __future__ import annotations

import json
import os
import tempfile

from cfgkernel.errors import MigrationError, ValidationError
from cfgkernel.persistence import load_kernel, save_kernel
from tests.helpers import build_kernel


def line(title: str) -> None:
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def main() -> None:
    k = build_kernel()

    old_config = {
        "system": {"name": "site-demo"},
        "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11,
                "legacy_opt": "fast"},
    }

    # 1. 老设备（GW-A100 / 1.0.0）读新配置 --------------------------------
    line("1. 老设备 GW-A100@1.0.0 读一份 2.0.0 新配置")
    new_config = {
        "system": {"name": "site-demo"},
        "net": {"tx_power": 18, "wifi_mode": "ax", "channel_num": 11},
        "ble_mesh": {"enable": True},
    }
    applied = k.apply(new_config, "GW-A100", "1.0.0",
                      version="2.0.0", name="demo-old-reads-new")
    print("活动取值:", json.dumps(applied.values, ensure_ascii=False, sort_keys=True))
    for e in applied.ignored():
        print(f"  忽略字段 {e.path}={e.value!r} 原因={e.reason} "
              f"说明={e.detail.get('note', '')}")

    # 2. 新设备（GW-A200 / 2.0.0）读老配置 --------------------------------
    line("2. 新设备 GW-A200@2.0.0 读一份 1.0.0 老配置（自动沿链迁移）")
    applied = k.apply(old_config, "GW-A200", "2.0.0",
                      version="1.0.0", name="demo-new-reads-old")
    print("活动取值:", json.dumps(applied.values, ensure_ascii=False, sort_keys=True))
    for p in sorted(applied.values):
        src = applied.source_of(p)
        print(f"  {p:20s}={applied.get(p)!r:<10} 状态={src.status:10s} "
              f"来源版本={src.origin_version} {src.reason}")

    # 3. 显式迁移 + 与直接解析比对 ----------------------------------------
    line("3. 显式迁移 1.0.0 -> 2.0.0，并与直接按 2.0.0 解析比对")
    cfg = k.normalize(old_config, "1.0.0", name="demo-migrate")
    migrated, record = k.migrate(cfg, "2.0.0")
    direct = k.normalize(old_config, "2.0.0", version="1.0.0")
    print("迁移结果:", json.dumps(migrated.values, ensure_ascii=False, sort_keys=True))
    print("直接解析:", json.dumps(direct.values, ensure_ascii=False, sort_keys=True))
    assert migrated.values == direct.values
    print("=> 两者逐字段一致；迁移记录 id =", record.id[:16], "…")

    # 4. 回滚 -------------------------------------------------------------
    line("4. 按迁移记录回滚到 1.0.0")
    restored, rb = k.rollback_record(record.id)
    print("回滚后版本:", restored.schema_version)
    print("回滚后取值:", json.dumps(restored.values, ensure_ascii=False, sort_keys=True))
    print("回滚记录: migration=", rb.migration_id[:16], "… restored_to=",
          rb.restored_to)

    # 5. 中途失败整体回滚（演示） -----------------------------------------
    line("5. 迁移中途失败：整体回滚，不留半新半旧")
    from cfgkernel.migrate import MigrationOp, MigrationStep
    from cfgkernel.version import Version
    k2 = build_kernel()
    bad_cfg = k2.normalize(old_config, "1.0.0", name="bad")
    k2.migrate(bad_cfg, "1.5.0")
    k2._steps[(Version("1.5.0"), Version("2.0.0"))] = MigrationStep(
        "1.5.0", "2.0.0", [MigrationOp.set_value("net.channel_num", 99)])
    try:
        k2.migrate(bad_cfg, "2.0.0")
    except MigrationError as exc:
        print(str(exc))
        print("失败后配置版本仍为:", bad_cfg.schema_version,
              " net.channel_num =", bad_cfg.get("net.channel_num"))

    # 6. 硬校验错误报告 ----------------------------------------------------
    line("6. 类型 / 范围硬错误（一次性报告字段路径、期望、实际）")
    try:
        k.normalize({"net": {"tx_power": "MAX"}}, "2.0.0")
    except ValidationError as exc:
        for p in exc.problems:
            print(f"  路径={p.path} 类别={p.kind} 期望={p.expected} "
                  f"实际={p.actual!r}")

    # 7. 落盘 / 重载 -------------------------------------------------------
    line("7. 整体状态写成单个 JSON 文件并重新载入")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "kernel.json")
        save_kernel(k, path)
        k3 = load_kernel(path)
        print("文件:", path)
        print("重载: 型号", sorted(k3.models), "字段数", len(k3.fields),
              "迁移记录", len(k3.migration_records), "回滚记录",
              len(k3.rollback_records))

    print("\n演示完成。")


if __name__ == "__main__":
    main()
