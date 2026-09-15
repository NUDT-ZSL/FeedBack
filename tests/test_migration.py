"""迁移：逐版本演进、默认补齐、等价性、幂等、中途失败整体回滚（需求 4/5）。"""

import copy
import unittest

from cfgkernel.config import (
    ST_DEFAULT,
    ST_DEGRADED,
    ST_RENAMED,
)
from cfgkernel.errors import (
    KernelError,
    MigrationError,
    RollbackError,
    ValidationError,
)
from cfgkernel.migrate import MigrationOp
from cfgkernel.schema import POLICY_ERROR

from tests.helpers import build_kernel

V1 = {"system": {"name": "site-01"},
      "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11,
              "legacy_opt": "fast"}}


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()
        self.cfg = self.k.normalize(V1, "1.0.0", name="site1")

    def test_step_1_to_15_rename_and_deprecation(self):
        cfg15, rec = self.k.migrate(self.cfg, "1.5.0")
        self.assertEqual(cfg15.schema_version.to_json(), "1.5.0")
        # rename：值与来源版本都保留
        self.assertEqual(cfg15.get("net.channel_num"), 11)
        src = cfg15.source_of("net.channel_num")
        self.assertEqual(src.status, ST_RENAMED)
        self.assertEqual(src.renamed_from, "net.channel")
        self.assertEqual(src.origin_version.to_json(), "1.0.0")
        # 老路径不在活动值中，但原始值归档保留
        self.assertNotIn("net.channel", cfg15.values)
        archived = next(e for e in cfg15.ignored() if e.path == "net.channel")
        self.assertEqual(archived.value, 11)
        # 废弃字段：值保留、状态 deprecated
        self.assertEqual(cfg15.get("net.legacy_opt"), "fast")
        self.assertEqual(cfg15.source_of("net.legacy_opt").status, "deprecated")

    def test_step_15_to_20_enum_map_and_drop(self):
        cfg15, _ = self.k.migrate(self.cfg, "1.5.0")
        cfg20, rec = self.k.migrate(cfg15, "2.0.0")
        self.assertEqual(cfg20.get("net.wifi_mode"), "ax")  # b/g -> ax
        self.assertNotIn("net.legacy_opt", cfg20.values)
        dropped = next(e for e in cfg20.ignored() if e.path == "net.legacy_opt")
        self.assertEqual(dropped.value, "fast")
        # 新字段补默认
        self.assertEqual(cfg20.get("ble_mesh.enable"), False)
        self.assertEqual(
            cfg20.source_of("ble_mesh.enable").status, ST_DEFAULT)

    def test_migration_equals_direct_parse(self):
        # 需求 4：沿链迁移结果必须与直接按目标版本解析一致
        migrated, _ = self.k.migrate(
            self.k.normalize(V1, "1.0.0"), "2.0.0")
        direct = self.k.normalize(V1, "2.0.0", version="1.0.0", name="site1")
        self.assertEqual(migrated.values, direct.values)
        self.assertEqual(
            {p: (s.status, s.origin_version.to_json(), s.renamed_from)
             for p, s in migrated.sources.items()},
            {p: (s.status, s.origin_version.to_json(), s.renamed_from)
             for p, s in direct.sources.items()},
        )
        self.assertEqual(
            sorted((e.path, e.value, e.reason) for e in migrated.ignored()),
            sorted((e.path, e.value, e.reason) for e in direct.ignored()),
        )

    def test_idempotent_same_version(self):
        cfg20, rec1 = self.k.migrate(self.cfg, "2.0.0")
        snap = cfg20.snapshot()
        again, rec2 = self.k.migrate(cfg20, "2.0.0")
        self.assertIsNone(rec2)
        self.assertEqual(again.values, cfg20.values)
        # 重复迁移结果完全一致（含来源与忽略清单）
        self.assertEqual(
            self.k._snapshot_equal(again.snapshot(), snap), True)

    def test_repeated_migration_byte_identical(self):
        results = []
        for _ in range(3):
            k = build_kernel()
            cfg = k.normalize(copy.deepcopy(V1), "1.0.0", name="site1")
            out, rec = k.migrate(cfg, "2.0.0")
            results.append((out.to_json(), rec.id))
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1], results[2])

    def test_type_range_tightening_clamps_and_marks_degraded(self):
        # 1.0.0 下 tx_power=25 合法；2.0.0 上限收紧为 20 -> clamp 降级
        cfg20, _ = self.k.migrate(self.cfg, "2.0.0")
        self.assertEqual(cfg20.get("net.tx_power"), 20)
        src = cfg20.source_of("net.tx_power")
        self.assertEqual(src.status, ST_DEGRADED)
        self.assertEqual(src.detail["original"], 25)
        self.assertIn("clamp", src.reason)

    def test_enum_expansion_value_kept(self):
        # 1.5.0 扩出的 n，在 2.0.0 仍合法，不得被改动
        cfg = self.k.normalize({"net": {"wifi_mode": "n"}}, "1.5.0")
        cfg20, _ = self.k.migrate(cfg, "2.0.0")
        self.assertEqual(cfg20.get("net.wifi_mode"), "n")

    def test_enum_contraction_fallback_degrade(self):
        # 无显式 map 操作时，被移除的枚举值按 fallback 策略降级
        k = build_kernel()
        from cfgkernel.migrate import MigrationStep
        from cfgkernel.version import Version
        # 去掉 2.0.0 边的 b/g 映射，模拟“迁移规则忘了处理枚举收紧”
        k._steps.pop((Version("1.5.0"), Version("2.0.0")))
        k._steps[(Version("1.5.0"), Version("2.0.0"))] = MigrationStep(
            "1.5.0", "2.0.0", [MigrationOp.drop("net.legacy_opt")])
        cfg = k.normalize({"net": {"wifi_mode": "b/g"}}, "1.5.0")
        cfg20, _ = k.migrate(cfg, "2.0.0")
        self.assertEqual(cfg20.get("net.wifi_mode"), "ax")
        self.assertEqual(
            cfg20.source_of("net.wifi_mode").status, ST_DEGRADED)

    def test_mid_migration_failure_rolls_back_entirely(self):
        # 第二步迁移中把 error 策略字段 net.channel_num（范围 [1,14]）
        # 用 set 操作写成 99 -> finalize 校验失败 -> 整体回滚到 1.0.0
        from cfgkernel.migrate import MigrationStep
        from cfgkernel.version import Version
        self.k._steps.pop((Version("1.5.0"), Version("2.0.0")))
        self.k._steps[(Version("1.5.0"), Version("2.0.0"))] = MigrationStep(
            "1.5.0", "2.0.0",
            [MigrationOp.set_value("net.channel_num", 99)])

        before_snapshot = self.cfg.snapshot()
        with self.assertRaises(MigrationError) as cm:
            self.k.migrate(self.cfg, "2.0.0")
        err = cm.exception
        self.assertTrue(err.rollback_ok)
        self.assertIn("1.5.0 -> 2.0.0", err.step)
        # 输入对象必须回到迁移前：版本、取值逐字节不变
        self.assertEqual(self.cfg.schema_version.to_json(), "1.0.0")
        self.assertTrue(self.k._snapshot_equal(
            self.cfg.snapshot(), before_snapshot))
        self.assertEqual(self.cfg.get("net.tx_power"), 25)
        self.assertNotIn("ble_mesh.enable", self.cfg.values)
        # 失败的迁移不留记录
        self.assertEqual(self.k.migration_records, [])

    def test_error_policy_aborts_without_partial_state(self):
        # 独立小内核：取值收紧 + error 策略，迁移必须失败且配置原地不动
        from cfgkernel.kernel import ConfigKernel
        kk = ConfigKernel()
        kk.register_field(
            "net.timeout", "int", "1.0.0", default=30,
            min_value=0, max_value=60)  # 默认 error 策略
        kk.add_field_change(
            "net.timeout", "2.0.0", default=30, min_value=0, max_value=30)
        kk.register_migration_step("1.0.0", "2.0.0", [])
        cfg = kk.normalize({"net": {"timeout": 60}}, "1.0.0", name="t")
        with self.assertRaises(MigrationError):
            kk.migrate(cfg, "2.0.0")
        self.assertEqual(cfg.schema_version.to_json(), "1.0.0")
        self.assertEqual(cfg.get("net.timeout"), 60)

    def test_rollback_record_restores_before_state(self):
        cfg20, rec = self.k.migrate(self.cfg, "2.0.0")
        self.assertEqual(cfg20.schema_version.to_json(), "2.0.0")
        restored, rb = self.k.rollback_record(rec.id)
        self.assertEqual(restored.schema_version.to_json(), "1.0.0")
        self.assertEqual(restored.values, {
            "system.name": "site-01",
            "net.tx_power": 25,
            "net.wifi_mode": "b/g",
            "net.channel": 11,
            "net.legacy_opt": "fast",
        })
        self.assertTrue(rec.rolled_back)
        self.assertEqual(rb.migration_id, rec.id)

    def test_rollback_rejected_after_divergence(self):
        _cfg20, rec = self.k.migrate(self.cfg, "2.0.0")
        # 现场手动改了迁移后的配置
        live = self.k.configs["site1"]
        live.set_value("net.tx_power", 1, "set", "2.0.0")
        with self.assertRaises(RollbackError):
            self.k.rollback_record(rec.id)

    def test_downgrade_directly_is_rejected_use_rollback(self):
        self.k.migrate(self.cfg, "2.0.0")
        with self.assertRaises(KernelError):
            self.k.migrate(self.cfg, "1.5.0")


if __name__ == "__main__":
    unittest.main()
