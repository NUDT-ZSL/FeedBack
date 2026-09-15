"""验收场景（需求 8）：老设备读新配置、新设备读老配置、字段类型收紧、
枚举扩值、迁移中途失败——全部按逐步推导手工构造期望值，再与内核输出比对。"""

import copy
import unittest

from cfgkernel.config import (
    ST_DEFAULT,
    ST_DEGRADED,
    ST_IGNORED,
    ST_RENAMED,
    ST_SET,
)
from cfgkernel.errors import MigrationError, ValidationError
from cfgkernel.kernel import ConfigKernel
from cfgkernel.migrate import MigrationOp, MigrationStep
from cfgkernel.schema import POLICY_ERROR
from cfgkernel.version import Version

from tests.helpers import build_kernel


class AcceptanceScenarios(unittest.TestCase):
    # ------------------------------------------------------------------
    # 场景 A：老设备（A100 / 1.0.0）读一份 2.0.0 新配置
    # ------------------------------------------------------------------
    def test_A_old_device_reads_new_config_step_by_step(self):
        k = build_kernel()
        raw_new = {
            "system": {"name": "site-new"},
            "net": {"tx_power": 18, "wifi_mode": "ax", "channel_num": 11},
            "ble_mesh": {"enable": True},
        }

        # 逐步推导 1.0.0 视角：
        #   system.name 三版本都在，str 合法          -> "site-new" (set)
        #   net.tx_power 18 ∈ [0,30]                  -> 18 (set)
        #   net.wifi_mode=ax 在 1.0.0 枚举中不存在     -> fallback b/g (degraded)
        #   net.channel_num 1.5.0 才引入               -> 忽略，原值 11 保真
        #   ble_mesh.enable 2.0.0 才引入               -> 忽略，原值 True 保真
        applied = k.apply(raw_new, "GW-A100", "1.0.0",
                          version="2.0.0", name="site-new")

        expected_values = {
            "system.name": "site-new",
            "net.tx_power": 18,
            "net.wifi_mode": "b/g",
            "net.channel": 6,        # 老字段按 1.0.0 默认补齐
            "net.legacy_opt": "off",
        }
        self.assertEqual(expected_values, applied.values)

        ignored = {e.path: e for e in applied.ignored()}
        self.assertEqual(ignored["net.channel_num"].value, 11)
        self.assertEqual(ignored["net.channel_num"].reason, "unknown_field")
        self.assertEqual(ignored["ble_mesh.enable"].value, True)
        self.assertEqual(
            applied.source_of("net.wifi_mode").status, ST_DEGRADED)
        self.assertEqual(
            applied.source_of("net.wifi_mode").detail["original"], "ax")

        # 差异报告顺序稳定且分类正确
        report = k.diff(applied)
        paths = [e["path"] for e in report]
        self.assertEqual(paths, sorted(paths))
        cats = {e["path"]: e["category"] for e in report}
        self.assertEqual(cats["net.channel_num"], "unknown")
        self.assertEqual(cats["ble_mesh.enable"], "unknown")
        self.assertEqual(cats["net.wifi_mode"], "degraded")

    # ------------------------------------------------------------------
    # 场景 B：新设备（A200 / 2.0.0）读一份 1.0.0 老配置
    # ------------------------------------------------------------------
    def test_B_new_device_reads_old_config_step_by_step(self):
        k = build_kernel()
        raw_old = {
            "system": {"name": "site-old"},
            "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11,
                    "legacy_opt": "fast"},
        }

        # 逐步推导 2.0.0 视角：
        #   1.0.0 -> 1.5.0：channel 重命名为 channel_num=11；legacy_opt 废弃
        #   1.5.0 -> 2.0.0：wifi_mode b/g 映射为 ax；legacy_opt 归档；
        #                  tx_power 上限 20，25 clamp 为 20 (degraded)；
        #                  ble_mesh.enable 补默认 False
        applied = k.apply(raw_old, "GW-A200", "2.0.0",
                          version="1.0.0", name="site-old")

        self.assertEqual(applied.get("system.name"), "site-old")
        self.assertEqual(applied.get("net.channel_num"), 11)
        self.assertEqual(
            applied.source_of("net.channel_num").status, ST_RENAMED)
        self.assertEqual(
            applied.source_of("net.channel_num").origin_version.to_json(),
            "1.0.0")
        self.assertEqual(applied.get("net.wifi_mode"), "ax")
        self.assertEqual(applied.get("net.tx_power"), 20)
        self.assertEqual(
            applied.source_of("net.tx_power").status, ST_DEGRADED)
        self.assertEqual(applied.get("ble_mesh.enable"), False)
        self.assertEqual(
            applied.source_of("ble_mesh.enable").status, ST_DEFAULT)
        dropped = {e.path: e for e in applied.ignored()}
        self.assertEqual(dropped["net.legacy_opt"].value, "fast")

        # 关键验收：沿链迁移 == 直接按 2.0.0 解析
        direct = k.normalize(raw_old, "2.0.0", version="1.0.0")
        self.assertEqual(applied.values, direct.values)

    # ------------------------------------------------------------------
    # 场景 C：枚举扩值（1.5.0 新增 n）——老值保留、扩值在新版本可用
    # ------------------------------------------------------------------
    def test_C_enum_expansion(self):
        k = build_kernel()
        # 老值 b/g 在 1.5.0 仍合法：原样保留，来源不变
        cfg = k.normalize({"net": {"wifi_mode": "b/g"}}, "1.5.0",
                          version="1.0.0")
        self.assertEqual(cfg.get("net.wifi_mode"), "b/g")
        self.assertEqual(cfg.source_of("net.wifi_mode").status, ST_SET)

        # 扩出的新值 n 在 1.0.0 非法（即便 fallback 也只是降级，这里要求硬失败
        # 由 error 策略的字段覆盖；wifi_mode 是 fallback，验证降级为 b/g）
        old = k.normalize({"net": {"wifi_mode": "n"}}, "1.0.0",
                          version="1.5.0")
        self.assertEqual(old.get("net.wifi_mode"), "b/g")
        self.assertEqual(old.source_of("net.wifi_mode").status, ST_DEGRADED)

    # ------------------------------------------------------------------
    # 场景 D：字段类型收紧（int -> str 自动转换；无法表示时失败回滚）
    # ------------------------------------------------------------------
    def _type_kernel(self):
        k = ConfigKernel()
        k.register_field("net.timeout", "int", "1.0.0", default=5,
                         min_value=0, max_value=60)
        k.add_field_change("net.timeout", "2.0.0", ftype="str", default="5",
                           min_length=1, max_length=8)
        k.register_field("net.flags", "list", "1.0.0", default=[],
                         elem_type="int", range_policy=POLICY_ERROR)
        k.add_field_change("net.flags", "2.0.0", ftype="int", default=0,
                           range_policy=POLICY_ERROR)
        k.register_migration_step("1.0.0", "2.0.0", [
            MigrationOp.cast("net.timeout", "str"),
        ])
        return k

    def test_D1_type_tightening_safe_convert(self):
        k = self._type_kernel()
        cfg = k.normalize({"net": {"timeout": 30}}, "1.0.0", name="t")
        cfg20, _ = k.migrate(cfg, "2.0.0")
        self.assertEqual(cfg20.get("net.timeout"), "30")
        # 与直接按 2.0.0 解析一致（自动安全转换）
        direct = k.normalize({"net": {"timeout": 30}}, "2.0.0",
                             version="1.0.0")
        self.assertEqual(cfg20.values, direct.values)

    def test_D2_type_tightening_unrepresentable_rolls_back(self):
        k = self._type_kernel()
        cfg = k.normalize({"net": {"flags": [1, 2, 3]}}, "1.0.0", name="t")
        before = copy.deepcopy(cfg.snapshot())
        with self.assertRaises(MigrationError) as cm:
            k.migrate(cfg, "2.0.0")
        self.assertIn("1.0.0 -> 2.0.0", cm.exception.step)
        # 半新半旧不得存在：仍停在 1.0.0，flags 原样
        self.assertEqual(cfg.schema_version.to_json(), "1.0.0")
        self.assertEqual(cfg.get("net.flags"), [1, 2, 3])
        self.assertTrue(k._snapshot_equal(cfg.snapshot(), before))

    # ------------------------------------------------------------------
    # 场景 E：迁移中途失败（第二步）整体回滚 + 回滚记录恢复
    # ------------------------------------------------------------------
    def test_E_mid_failure_then_explicit_rollback_matches_derivation(self):
        k = build_kernel()
        raw = {"system": {"name": "site-e"},
               "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11}}
        cfg = k.normalize(raw, "1.0.0", name="site-e")

        # 先成功迁移到 1.5.0
        cfg15, rec15 = k.migrate(cfg, "1.5.0")
        self.assertEqual(cfg15.get("net.channel_num"), 11)

        # 第二步被人为改坏：set 一个越界值
        k._steps.pop((Version("1.5.0"), Version("2.0.0")))
        k._steps[(Version("1.5.0"), Version("2.0.0"))] = MigrationStep(
            "1.5.0", "2.0.0",
            [MigrationOp.set_value("net.channel_num", 99)])

        live_before = copy.deepcopy(cfg15.snapshot())
        with self.assertRaises(MigrationError):
            k.migrate(cfg15, "2.0.0")
        # 失败后现场配置仍是完整的 1.5.0，而不是半新半旧
        self.assertEqual(cfg15.schema_version.to_json(), "1.5.0")
        self.assertTrue(k._snapshot_equal(cfg15.snapshot(), live_before))
        self.assertEqual(cfg15.get("net.channel_num"), 11)

        # 用第一条迁移记录回滚，应精确回到 1.0.0 手工推导结果
        restored, rb = k.rollback_record(rec15.id)
        self.assertEqual(restored.schema_version.to_json(), "1.0.0")
        self.assertEqual(restored.get("net.channel"), 11)
        self.assertNotIn("net.channel_num", restored.values)
        self.assertEqual(restored.get("net.wifi_mode"), "b/g")
        self.assertEqual(rb.restored_to.to_json(), "1.0.0")

    # ------------------------------------------------------------------
    # 场景 F：重复迁移完全一致（可复现）
    # ------------------------------------------------------------------
    def test_F_reproducibility(self):
        raw = {"system": {"name": "rep"},
               "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 6}}
        outs = []
        for _ in range(3):
            k = build_kernel()
            cfg = k.normalize(raw, "1.0.0", name="rep")
            out, rec = k.migrate(cfg, "2.0.0")
            import json
            outs.append((
                json.dumps(out.to_json(), sort_keys=True),
                rec.id,
            ))
        self.assertEqual(len({o[1] for o in outs}), 1)  # 记录 id 相同
        self.assertEqual(len({o[0] for o in outs}), 1)  # 输出 JSON 相同

    # ------------------------------------------------------------------
    # 场景 G：硬类型错误在应用时即失败（不被静默忽略）
    # ------------------------------------------------------------------
    def test_G_hard_type_error_fails_fast(self):
        k = build_kernel()
        with self.assertRaises(ValidationError) as cm:
            k.apply({"net": {"tx_power": "MAX"}}, "GW-A200", "2.0.0")
        p = cm.exception.problems[0]
        self.assertEqual(p.path, "net.tx_power")
        self.assertIn("期望", p.message)
        self.assertEqual(p.actual, "MAX")


if __name__ == "__main__":
    unittest.main()
