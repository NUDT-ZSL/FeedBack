"""设备能力适配与查询：老设备读新配置、新设备读老配置、忽略 / 降级标记、
字段溯源（field_info）与稳定顺序差异报告（diff）——需求 2/6。"""

import unittest

from cfgkernel.config import (
    ST_DEFAULT,
    ST_DEGRADED,
    ST_IGNORED,
    ST_RENAMED,
    ST_SET,
)

from tests.helpers import build_kernel

NEW_CONFIG = {
    "system": {"name": "site-02"},
    "net": {"tx_power": 18, "wifi_mode": "ax", "channel_num": 11},
    "ble_mesh": {"enable": True},
}


class DeviceAdaptationTests(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()

    # -- 老设备读新配置（需求 2） -------------------------------------------

    def test_old_device_reads_new_config_fields_ignored_not_silent(self):
        # A100 @ 1.0.0 读取一份 2.0.0 编写的配置
        applied = self.k.apply(
            NEW_CONFIG, "GW-A100", "1.0.0", version="2.0.0", name="site02")
        # 未来字段不认识 -> extras，明确标记 unknown，原始值保真
        ignored_paths = {e.path: e for e in applied.ignored()}
        self.assertIn("net.channel_num", ignored_paths)
        self.assertEqual(ignored_paths["net.channel_num"].value, 11)
        self.assertIn("ble_mesh.enable", ignored_paths)
        self.assertEqual(ignored_paths["ble_mesh.enable"].value, True)
        # 2.0.0 收紧/新增的枚举值 ax 在 1.0.0 不存在 -> fallback 降级为 b/g
        self.assertEqual(applied.get("net.wifi_mode"), "b/g")
        self.assertEqual(
            applied.source_of("net.wifi_mode").status, ST_DEGRADED)
        # 没有任何字段被静默丢弃：活动值 + extras 覆盖所有输入字段
        all_seen = set(applied.values) | set(ignored_paths)
        for path in ("system.name", "net.tx_power", "net.wifi_mode",
                     "net.channel_num", "ble_mesh.enable"):
            self.assertIn(path, all_seen)

    def test_old_device_missing_capability_marks_ignored(self):
        # 即便固件升到 2.0.0，A100 硬件没有 ble_mesh 能力
        applied = self.k.apply(NEW_CONFIG, "GW-A100", "2.0.0", name="s")
        src = applied.source_of("ble_mesh.enable")
        self.assertEqual(src.status, ST_IGNORED)
        self.assertIn("ble_mesh", src.reason)
        # 设备实际取值为默认占位，真实意图值保真在 extras
        self.assertEqual(applied.get("ble_mesh.enable"), False)
        extra = next(e for e in applied.ignored() if e.path == "ble_mesh.enable")
        self.assertEqual(extra.value, True)
        self.assertEqual(extra.reason, "capability_missing")

    # -- 新设备读老配置 -----------------------------------------------------

    def test_new_device_reads_old_config_fills_defaults(self):
        old_config = {
            "system": {"name": "site-03"},
            "net": {"tx_power": 18, "wifi_mode": "b/g", "channel": 11},
        }
        applied = self.k.apply(old_config, "GW-A200", "2.0.0",
                               version="1.0.0", name="site03")
        # 老字段 channel 经演进链改名
        self.assertEqual(applied.get("net.channel_num"), 11)
        self.assertEqual(
            applied.source_of("net.channel_num").status, ST_RENAMED)
        # 老配置没有的新能力开关 -> 按引入版本默认补齐
        self.assertEqual(applied.get("ble_mesh.enable"), False)
        self.assertEqual(
            applied.source_of("ble_mesh.enable").status, ST_DEFAULT)

    def test_explicit_values_distinguished_from_defaults(self):
        applied = self.k.apply(
            {"system": {"name": "gateway"}}, "GW-A200", "2.0.0")
        # 值等于默认，但因为是显式给的，状态必须是 set 而非 default
        self.assertEqual(
            applied.source_of("system.name").status, ST_SET)

    # -- field_info 查询（需求 6） ------------------------------------------

    def test_field_info_final_value_and_provenance(self):
        applied = self.k.apply(NEW_CONFIG, "GW-A100", "2.0.0", name="s")
        info = self.k.field_info(applied, "ble_mesh.enable",
                                 model_name="GW-A100", fw="2.0.0")
        self.assertEqual(info["value"], False)
        self.assertTrue(info["ignored"])
        self.assertFalse(info["degraded"])
        self.assertEqual(info["original_value"], True)
        self.assertFalse(info["device_capability_ok"])

        info2 = self.k.field_info(applied, "net.wifi_mode",
                                  model_name="GW-A200", fw="2.0.0")
        self.assertEqual(info2["value"], "ax")
        self.assertEqual(info2["origin_version"], "2.0.0")

    def test_field_info_unknown_field_reports_ignored(self):
        applied = self.k.apply(NEW_CONFIG, "GW-A100", "1.0.0",
                               version="2.0.0")
        info = self.k.field_info(applied, "ble_mesh.enable")
        self.assertTrue(info["ignored"])
        self.assertEqual(info["value"], True)
        self.assertEqual(info["status"], "unknown_field")

    # -- diff 差异报告（需求 6，顺序稳定） -----------------------------------

    def test_diff_sorted_and_categorized(self):
        applied = self.k.apply(NEW_CONFIG, "GW-A100", "2.0.0", name="s")
        report = self.k.diff(applied, model_name="GW-A100", fw="2.0.0")
        paths = [e["path"] for e in report]
        self.assertEqual(paths, sorted(paths))  # 顺序稳定

        by_path = {e["path"]: e for e in report}
        self.assertEqual(by_path["ble_mesh.enable"]["category"],
                         "capability_missing")
        self.assertEqual(by_path["system.name"]["category"], "explicit")
        # expected 始终给出目标版本默认值，便于现场比对
        self.assertEqual(by_path["ble_mesh.enable"]["expected"], False)

    def test_diff_against_target_version(self):
        # 一份 1.0.0 配置相对 2.0.0 的差异
        cfg = self.k.normalize(
            {"system": {"name": "x"},
             "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11}},
            "1.0.0")
        report = self.k.diff(cfg, target="2.0.0")
        by_path = {e["path"]: e for e in report}
        # 报告按目标版本规则评价：默认值取目标版本默认
        self.assertEqual(by_path["net.tx_power"]["expected"], 20)
        # 老字段在目标版本已废弃 -> deprecated（规则仍存在，只是废弃）
        self.assertEqual(by_path["net.channel"]["category"], "deprecated")
        # 新字段相对老配置呈现为默认补齐视角
        self.assertIn("ble_mesh.enable", by_path)

    def test_diff_shows_dropped_for_archived_fields(self):
        # 迁移到 2.0.0 后被 drop 的字段 -> dropped，且值可追溯
        cfg = self.k.normalize(
            {"net": {"legacy_opt": "fast"}}, "1.0.0")
        cfg20, _ = self.k.migrate(cfg, "2.0.0")
        report = self.k.diff(cfg20)
        by_path = {e["path"]: e for e in report}
        entry = by_path["net.legacy_opt"]
        self.assertEqual(entry["category"], "dropped")
        self.assertEqual(entry["actual"], "fast")
        self.assertEqual(entry["status"], "field_dropped")

    def test_diff_order_deterministic_across_runs(self):
        reports = []
        for _ in range(3):
            k = build_kernel()
            applied = k.apply(NEW_CONFIG, "GW-A100", "1.0.0",
                              version="2.0.0")
            reports.append([(e["path"], e["category"])
                            for e in k.diff(applied)])
        self.assertEqual(reports[0], reports[1])
        self.assertEqual(reports[1], reports[2])


if __name__ == "__main__":
    unittest.main()
