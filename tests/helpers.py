"""测试共用：构建一个跨三个固件版本（1.0.0 / 1.5.0 / 2.0.0）的验收内核。

演进故事：

- 能力 ``wifi`` 自 1.0.0 存在；新能力 ``ble_mesh`` 自 2.0.0 引入。
- 型号 ``GW-A100``：固件 1.0.0/1.5.0/2.0.0 都有，1.0.0 起支持 wifi，
  **不**支持 ble_mesh（用于“老设备读新配置”）。
- 型号 ``GW-A200``：只有固件 2.0.0，支持 wifi + ble_mesh（“新设备”）。

字段：

- ``system.name``        str，长度 [1,16]，全版本。
- ``net.tx_power``       int，1.0.0 范围 [0,30]；2.0.0 **收紧**为 [0,20]，
                         clamp 策略（超范围夹取并标记 degraded）。
- ``net.wifi_mode``      enum：1.0.0 合法 {b,g,b/g}；1.5.0 **扩值** n；
                         2.0.0 移除 b/g、新增 ax，fallback 策略兜底 ax。
- ``net.channel``        int，1.0.0 引入，1.5.0 改名为 ``net.channel_num``
                         （rename 迁移，值与来源版本保留）。
- ``ble_mesh.enable``    bool，2.0.0 引入，默认 False，依赖能力 ble_mesh
                         （新设备读老配置时补默认；老设备上忽略）。
- ``net.legacy_opt``     str，1.0.0 引入、1.5.0 废弃，2.0.0 起 drop 归档。
"""

from __future__ import annotations

from cfgkernel.kernel import ConfigKernel
from cfgkernel.migrate import MigrationOp
from cfgkernel.schema import POLICY_CLAMP, POLICY_FALLBACK


def build_kernel() -> ConfigKernel:
    k = ConfigKernel()

    # -- 能力 ---------------------------------------------------------------
    k.register_capability("wifi", "1.0.0")
    k.register_capability("ble_mesh", "2.0.0")

    # -- 型号 / 固件 --------------------------------------------------------
    a100 = k.register_model("GW-A100")
    for fw in ("1.0.0", "1.5.0", "2.0.0"):
        k.register_firmware("GW-A100", fw)
    k.register_support("GW-A100", "wifi", "1.0.0")  # A100 永远没有 ble_mesh

    a200 = k.register_model("GW-A200")
    k.register_firmware("GW-A200", "2.0.0")
    k.register_support("GW-A200", "wifi", "2.0.0")
    k.register_support("GW-A200", "ble_mesh", "2.0.0")

    # -- 字段 ---------------------------------------------------------------
    k.register_field(
        "system.name", "str", "1.0.0", default="gateway",
        min_length=1, max_length=16,
    )

    k.register_field(
        "net.tx_power", "int", "1.0.0", default=20,
        min_value=0, max_value=30, range_policy=POLICY_CLAMP,
    )
    k.add_field_change(
        "net.tx_power", "2.0.0", min_value=0, max_value=20,
        range_policy=POLICY_CLAMP,
    )

    k.register_field(
        "net.wifi_mode", "enum", "1.0.0", default="b/g",
        enum_members=[("b", "1.0.0"), ("g", "1.0.0"), ("b/g", "1.0.0")],
        range_policy=POLICY_FALLBACK, degrade_fallback="b/g",
    )
    k.add_field_change(
        "net.wifi_mode", "1.5.0",
        enum_members_added=[("n", "1.5.0")],
        range_policy=POLICY_FALLBACK, degrade_fallback="n",
    )
    k.add_field_change(
        "net.wifi_mode", "2.0.0", default="ax",
        enum_members_added=[("ax", "2.0.0")],
        enum_members_removed=["b/g"],
        range_policy=POLICY_FALLBACK, degrade_fallback="ax",
    )

    k.register_field("net.channel", "int", "1.0.0", default=6,
                     min_value=1, max_value=14)
    k.add_field_change("net.channel", "1.5.0", deprecated=True)
    k.register_field("net.channel_num", "int", "1.5.0", default=6,
                     min_value=1, max_value=14)

    k.register_field(
        "ble_mesh.enable", "bool", "2.0.0", default=False,
        required_capability="ble_mesh",
    )

    k.register_field("net.legacy_opt", "str", "1.0.0", default="off",
                     min_length=0, max_length=8)
    k.add_field_change("net.legacy_opt", "1.5.0", deprecated=True)

    # -- 演进链 -------------------------------------------------------------
    k.register_migration_step("1.0.0", "1.5.0", [
        MigrationOp.rename("net.channel", "net.channel_num"),
    ])
    k.register_migration_step("1.5.0", "2.0.0", [
        MigrationOp.map_enum("net.wifi_mode", {"b/g": "ax"}),
        MigrationOp.drop("net.legacy_opt"),
    ])

    return k
