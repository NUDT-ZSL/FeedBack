"""device_config 内核单元测试（仅标准库 unittest，完全离线）。

运行：
    python -m unittest discover -s tests -v
"""

import json
import unittest

from device_config import (
    ConfigKernel,
    CorruptStateError,
    DuplicateError,
    MigrationChainError,
    MissingFieldError,
    NotFoundError,
    ValidationError,
    VersionError,
    convert_value,
    dump_json,
    export_state,
    import_state,
    load_json,
    parse_version,
)


# ---------------------------------------------------------------------------
# 需求 1：设备登记与版本号
# ---------------------------------------------------------------------------


class VersionTests(unittest.TestCase):
    def test_compare(self):
        self.assertTrue(parse_version("1.10.2") > parse_version("1.9.10"))
        self.assertTrue(parse_version("2.0") >= parse_version("2"))
        self.assertEqual(parse_version("1.2.0"), parse_version("1.2"))
        self.assertTrue(parse_version("1.2") < parse_version("1.2.1"))
        self.assertEqual(hash(parse_version("1.2.0")), hash(parse_version("1.2")))

    def test_invalid_versions_report_position(self):
        cases = [
            ("", 0, None),
            ("1.", 1, 1),
            (".1", 0, 0),
            ("1..2", 2, 1),
            ("1.a.3", 2, 1),
            ("1.2-beta", 3, 1),
            ("v1.2", 0, 0),
            ("1.-2", 2, 1),
        ]
        for text, pos, seg in cases:
            with self.assertRaises(VersionError) as ctx:
                parse_version(text)
            self.assertEqual(ctx.exception.position, pos, text)
            self.assertEqual(ctx.exception.segment, seg, text)

    def test_leading_zeros_and_non_string(self):
        self.assertEqual(parse_version("01.2").parts, (1, 2))
        with self.assertRaises(VersionError):
            parse_version(123)
        with self.assertRaises(VersionError):
            parse_version(None)


class DeviceRegistrationTests(unittest.TestCase):
    def test_register_and_retrieve(self):
        k = ConfigKernel()
        dev = k.register_device("d1", "Sensor-X", "1.4.0", {"wifi", "bt"})
        self.assertEqual(dev.firmware, "1.4.0")
        self.assertEqual(dev.capabilities, frozenset({"wifi", "bt"}))
        self.assertEqual(k.get_device("d1").model, "Sensor-X")

    def test_duplicate_id_rejected(self):
        k = ConfigKernel()
        k.register_device("d1", "M", "1.0.0", [])
        with self.assertRaises(DuplicateError):
            k.register_device("d1", "M2", "2.0.0", [])

    def test_bad_firmware_rejected_with_position_and_state_unchanged(self):
        k = ConfigKernel()
        with self.assertRaises(VersionError) as ctx:
            k.register_device("d1", "M", "1.o", [])
        self.assertEqual(ctx.exception.position, 2)
        self.assertEqual(k.list_devices(), [])

    def test_bad_capabilities(self):
        k = ConfigKernel()
        with self.assertRaises(ValidationError):
            k.register_device("d1", "M", "1.0", "wifi")  # 字符串不可充当集合
        with self.assertRaises(ValidationError):
            k.register_device("d2", "M", "1.0", ["ok", ""])


# ---------------------------------------------------------------------------
# 需求 2：字段定义
# ---------------------------------------------------------------------------


class FieldRegistrationTests(unittest.TestCase):
    def test_basic_field(self):
        k = ConfigKernel()
        fd = k.register_field("ssid", "string", "1.0")
        self.assertEqual(fd.type, "string")
        self.assertTrue(fd.required)
        self.assertFalse(fd.has_default)

    def test_duplicate_field(self):
        k = ConfigKernel()
        k.register_field("ssid", "string", "1.0")
        with self.assertRaises(DuplicateError):
            k.register_field("ssid", "string", "2.0")

    def test_bad_type_or_version(self):
        k = ConfigKernel()
        with self.assertRaises(ValidationError):
            k.register_field("x", "number", "1.0")
        with self.assertRaises(VersionError):
            k.register_field("y", "int", "1.x")

    def test_default_must_match_type_and_bool_is_not_int(self):
        k = ConfigKernel()
        with self.assertRaises(ValidationError):
            k.register_field("retry", "int", "1.0", default=True)
        with self.assertRaises(ValidationError):
            k.register_field("ratio", "float", "1.0", default="1.5")
        k.register_field("retry", "int", "1.0", default=3)
        k.register_field("note", "string", "1.0", default=None, has_default=False)
        self.assertFalse(k.get_field("note").has_default)

    def test_rename_target_must_be_defined_field(self):
        # 改名目标必须是已登记字段；反过来，目标字段一旦在规则中被引用，
        # 再登记同名字段也会被拒绝（重复定义）。
        k = ConfigKernel()
        k.register_field("a", "int", "1.0")
        with self.assertRaises(ValidationError):
            k.register_migration_rule("1.0", "2.0", renames=[("a", "b")])
        k2 = ConfigKernel()
        k2.register_field("a", "int", "1.0")
        k2.register_field("b", "int", "2.0")
        k2.register_migration_rule("1.0", "2.0", renames=[("a", "b")])
        with self.assertRaises(DuplicateError):
            k2.register_field("b", "string", "2.0")


# ---------------------------------------------------------------------------
# 需求 5：迁移规则、改名/改类型、断链
# ---------------------------------------------------------------------------


def build_fields(k, *, interval_default=60, bt_requires=()):
    k.register_field("ssid", "string", "1.0")
    k.register_field("timeout_ms", "int", "1.0", default=1000)
    k.register_field("timeout_s", "float", "2.0", default=1.0)  # 改名+改类型目标
    k.register_field("power_save", "bool", "2.0", default=False)
    k.register_field("bt_name", "string", "3.0", required=False,
                     required_capabilities=bt_requires)
    k.register_field("interval", "int", "3.0", required=True,
                     default=interval_default,
                     has_default=(interval_default is not None))


def build_rules(k):
    k.register_migration_rule(
        "1.0", "2.0",
        renames=[("timeout_ms", "timeout_s")],
        type_changes=[("timeout_ms", "float")],
    )
    k.register_migration_rule("2.0", "3.0", renames=[])


def build_scenario(**kw):
    """跨三版本、能力各异的标准场景。"""
    k = ConfigKernel()
    build_fields(k, **kw)
    build_rules(k)
    k.register_device("dev-old", "Sensor-A", "1.0.0", {"wifi"})
    k.register_device("dev-mid", "Sensor-A", "2.0.0", {"wifi"})
    k.register_device("dev-new", "Sensor-B", "3.0.0", {"wifi", "bt"})
    k.register_config("cfg-old", "1.0.0",
                      {"ssid": "home", "timeout_ms": 500})
    k.register_config("cfg-new", "3.0.0",
                      {"ssid": "home", "timeout_s": 1.5,
                       "power_save": True, "bt_name": "node",
                       "interval": 30})
    k.register_config("cfg-new-int", "3.0.0",
                      {"ssid": "home", "timeout_s": 2.0,
                       "power_save": True, "bt_name": "node",
                       "interval": 30})
    return k


class MigrationRuleTests(unittest.TestCase):
    def setUp(self):
        self.k = ConfigKernel()
        build_fields(self.k)

    def test_valid_rule_path(self):
        build_rules(self.k)
        path = self.k.describe_migration_path("1.0", "3.0")
        self.assertEqual([(p["from"], p["to"]) for p in path],
                         [("1", "2"), ("2", "3")])
        self.assertFalse(path[0]["identity"])

    def test_identity_segments_at_edges(self):
        # 只有 2.0->3.0 规则；1.0->2.0 与 3.0->4.0 是纯加字段空档。
        # 路径版本统一为规范形式（右侧补零去掉）。
        self.k.register_migration_rule("2.0", "3.0")
        path = self.k.describe_migration_path("1.0", "4.0")
        self.assertEqual([(p["from"], p["to"], p["identity"]) for p in path],
                         [("1", "2", True), ("2", "3", False),
                          ("3", "4", True)])

    def test_broken_chain_between_rules(self):
        self.k.register_migration_rule("1.0", "2.0")
        self.k.register_migration_rule("3.0", "4.0")
        with self.assertRaises(MigrationChainError) as ctx:
            self.k.migration_path("1.0", "4.0")
        self.assertEqual(ctx.exception.breakpoint_version, "2")
        self.assertEqual(ctx.exception.target_version, "4")

    def test_overshoot_forward_and_backward(self):
        self.k.register_migration_rule("1.0", "3.0")
        with self.assertRaises(MigrationChainError) as ctx:
            self.k.migration_path("1.0", "2.0")
        self.assertEqual(ctx.exception.breakpoint_version, "1")
        with self.assertRaises(MigrationChainError) as ctx:
            self.k.migration_path("3.0", "2.0")
        self.assertEqual(ctx.exception.breakpoint_version, "1")

    def test_inside_rule_interval_is_break(self):
        self.k.register_migration_rule("1.0", "3.0")
        with self.assertRaises(MigrationChainError):
            self.k.migration_path("2.0", "4.0")

    def test_rule_validation(self):
        with self.assertRaises(ValidationError):
            self.k.register_migration_rule("2.0", "2.0")  # 必须上升
        build_rules(self.k)
        with self.assertRaises(DuplicateError):
            self.k.register_migration_rule("1.0", "2.5")  # 分叉
        with self.assertRaises(ValidationError):
            self.k.register_migration_rule(
                "3.0", "4.0", type_changes=[("ghost", "string")])
        with self.assertRaises(ValidationError):
            self.k.register_migration_rule(
                "3.0", "4.0", type_changes=[("power_save", "int")])  # bool->int
        with self.assertRaises(ValidationError):
            self.k.register_migration_rule(
                "3.0", "4.0", renames=[("bt_name", "ssid")])  # 名字被占用

    def test_rename_type_must_match_target_field(self):
        with self.assertRaises(ValidationError):
            self.k.register_migration_rule(
                "1.0", "2.0",
                renames=[("timeout_ms", "timeout_s")],
                type_changes=[("timeout_ms", "string")])

    def test_forward_and_backward_value_migration(self):
        build_rules(self.k)
        forward = self.k._migrate_values(
            {"ssid": "net", "timeout_ms": 5},
            parse_version("1.0"), parse_version("2.0"))
        self.assertEqual(forward, {"ssid": "net", "timeout_s": 5.0})
        back = self.k._migrate_values(
            forward, parse_version("2.0"), parse_version("1.0"))
        self.assertEqual(back, {"ssid": "net", "timeout_ms": 5})

    def test_backward_float_fraction_rejected(self):
        build_rules(self.k)
        with self.assertRaises(ValidationError):
            self.k._migrate_values(
                {"ssid": "net", "timeout_s": 2.5},
                parse_version("2.0"), parse_version("1.0"))


class ValueConversionTests(unittest.TestCase):
    def test_conversions(self):
        self.assertEqual(convert_value(3, "int", "float"), 3.0)
        self.assertEqual(convert_value(3.0, "float", "int"), 3)
        with self.assertRaises(ValidationError):
            convert_value(3.5, "float", "int")
        self.assertEqual(convert_value(7, "int", "string"), "7")
        self.assertEqual(convert_value("12", "string", "int"), 12)
        self.assertEqual(convert_value("1.5", "string", "float"), 1.5)
        for bad in ("", " 12", "+1", "0x1", "1_00"):
            with self.assertRaises(ValidationError):
                convert_value(bad, "string", "int")
        for bad in ("nan", "Infinity", "1e3", "1.2.3"):
            with self.assertRaises(ValidationError):
                convert_value(bad, "string", "float")
        with self.assertRaises(ValidationError):
            convert_value(True, "bool", "int")


# ---------------------------------------------------------------------------
# 需求 3/4/6：适配——裁剪、默认补齐、必填拒绝、确定性
# ---------------------------------------------------------------------------


class AdaptationTests(unittest.TestCase):
    def setUp(self):
        self.k = build_scenario(bt_requires=("bt",))

    def test_old_config_to_new_device_gets_defaults(self):
        rec = self.k.adapt("cfg-old", "dev-new")
        eff = rec["effective_config"]
        self.assertEqual(eff["timeout_s"], 500.0)          # 改名 + int->float
        self.assertEqual(eff["power_save"], False)         # 默认补齐
        self.assertEqual(eff["interval"], 60)              # 默认补齐
        self.assertEqual(eff["ssid"], "home")
        sources = {d["field"]: d["source"] for d in rec["decisions"]}
        self.assertEqual(sources["power_save"], "default")
        self.assertEqual(sources["timeout_s"], "migrated")

    def test_missing_required_rejected_with_field_names(self):
        k = build_scenario(interval_default=None)
        with self.assertRaises(MissingFieldError) as ctx:
            k.adapt("cfg-old", "dev-new")
        self.assertEqual(ctx.exception.fields, ["interval"])
        # 拒绝后不产生适配记录，内核状态不变
        with self.assertRaises(NotFoundError):
            k.find_adaptation("cfg-old", "dev-new")

    def test_new_config_to_old_device_is_downgraded(self):
        rec = self.k.adapt("cfg-new-int", "dev-old")
        eff = rec["effective_config"]
        self.assertIn("timeout_ms", eff)
        self.assertEqual(eff["timeout_ms"], 2)         # 逆向改名 + float->int
        self.assertNotIn("timeout_s", eff)
        for future in ("power_save", "bt_name", "interval"):
            self.assertNotIn(future, eff)
        reasons = {d["field"]: d for d in rec["decisions"]}
        for future in ("power_save", "bt_name", "interval"):
            self.assertFalse(reasons[future]["kept"])
            self.assertEqual(reasons[future]["reason"], "unsupported_firmware")
            self.assertIn(future, reasons[future]["detail"])

    def test_fractional_second_downgrade_refused(self):
        # timeout_s=1.5 无法无损回到 int，迁移必须报错而不是静默截断
        with self.assertRaises(ValidationError):
            self.k.adapt("cfg-new", "dev-old")

    def test_mid_device_drops_future_field(self):
        rec = self.k.adapt("cfg-new", "dev-mid")
        by_field = {d["field"]: d for d in rec["decisions"]}
        self.assertTrue(by_field["power_save"]["kept"])
        self.assertFalse(by_field["interval"]["kept"])
        self.assertEqual(by_field["interval"]["reason"], "unsupported_firmware")
        self.assertIn("3.0", by_field["interval"]["detail"])

    def test_capability_drop(self):
        self.k.register_device("dev-btless", "Sensor-B", "3.0.0", {"wifi"})
        rec = self.k.adapt("cfg-new", "dev-btless")
        by_field = {d["field"]: d for d in rec["decisions"]}
        self.assertFalse(by_field["bt_name"]["kept"])
        self.assertEqual(by_field["bt_name"]["reason"], "missing_capability")
        self.assertIn("bt", by_field["bt_name"]["detail"])
        # 同版本具备能力的设备上该字段被保留
        rec2 = self.k.adapt("cfg-new", "dev-new")
        self.assertTrue(
            {d["field"]: d for d in rec2["decisions"]}["bt_name"]["kept"])

    def test_missing_optional_capability_field_is_silently_dropped(self):
        # bt_name 可选且需要 bt：缺能力的旧/新设备都不应因它报必填错误
        rec = self.k.adapt("cfg-old", "dev-old")
        self.assertNotIn("bt_name", rec["effective_config"])

    def test_order_independence_and_idempotency(self):
        r1 = self.k.adapt("cfg-new", "dev-new")

        k2 = ConfigKernel()
        build_fields(k2, bt_requires=("bt",))
        build_rules(k2)
        k2.register_device("dev-new", "Sensor-B", "3.0.0", {"bt", "wifi"})
        k2.register_config(
            "cfg-new", "3.0.0",
            {"interval": 30, "bt_name": "node", "power_save": True,
             "timeout_s": 1.5, "ssid": "home"})
        r2 = k2.adapt("cfg-new", "dev-new")

        self.assertEqual(r1["effective_config"], r2["effective_config"])
        self.assertEqual(
            [(d["field"], d["kept"], d["reason"], d["detail"])
             for d in r1["decisions"]],
            [(d["field"], d["kept"], d["reason"], d["detail"])
             for d in r2["decisions"]])
        # 重复适配：同一条记录、同一 ID、内容完全相同、不产生第二条
        r1_again = self.k.adapt("cfg-new", "dev-new")
        self.assertEqual(r1, r1_again)
        self.assertEqual(r1_again["record_id"], r1["record_id"])
        self.assertEqual(len(self.k.list_adaptations()), 1)

    def test_decisions_are_sorted(self):
        rec = self.k.adapt("cfg-new", "dev-new")
        fields = [d["field"] for d in rec["decisions"]]
        self.assertEqual(fields, sorted(fields))

    def test_chain_break_during_adapt(self):
        self.k.register_device("dev-25", "Sensor-A", "2.5.0", {"wifi"})
        with self.assertRaises(MigrationChainError) as ctx:
            self.k.adapt("cfg-old", "dev-25")
        self.assertEqual(ctx.exception.breakpoint_version, "2")


# ---------------------------------------------------------------------------
# 需求 7：查询
# ---------------------------------------------------------------------------


class QueryTests(unittest.TestCase):
    def setUp(self):
        self.k = build_scenario(bt_requires=("bt",))
        self.rec = self.k.adapt("cfg-new", "dev-mid")

    def test_effective_config_query(self):
        eff = self.k.effective_config("dev-mid")
        self.assertEqual(eff, self.rec["effective_config"])
        self.assertEqual(eff["ssid"], "home")
        self.assertTrue(eff["power_save"])

    def test_effective_config_via_adapt(self):
        self.assertEqual(
            self.k.effective_config("dev-mid", "cfg-new-int"),
            self.k.adapt("cfg-new-int", "dev-mid")["effective_config"])

    def test_field_decision_query(self):
        rid = self.rec["record_id"]
        kept = self.k.field_decision(rid, "ssid")
        self.assertTrue(kept["kept"])
        dropped = self.k.field_decision(rid, "interval")
        self.assertFalse(dropped["kept"])
        self.assertEqual(dropped["reason"], "unsupported_firmware")
        with self.assertRaises(NotFoundError):
            self.k.field_decision(rid, "nonexistent")
        with self.assertRaises(NotFoundError):
            self.k.field_decision("deadbeef", "ssid")

    def test_full_migration_path_query(self):
        path = self.k.describe_migration_path("1.0.0", "3.0.0")
        self.assertEqual([p["to"] for p in path], ["2", "3"])
        self.assertEqual(path[0]["renames"], [["timeout_ms", "timeout_s"]])
        self.assertEqual(path[0]["type_changes"], [["timeout_ms", "float"]])

    def test_same_version_path_is_empty(self):
        self.assertEqual(self.k.describe_migration_path("3.0", "3.0.0"), [])


# ---------------------------------------------------------------------------
# 需求 8：导出 / 载入 / 损坏校验 / 原子失败
# ---------------------------------------------------------------------------


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.k = build_scenario(bt_requires=("bt",))
        self.k.adapt("cfg-new", "dev-mid")
        self.k.adapt("cfg-new-int", "dev-old")
        self.k.adapt("cfg-old", "dev-new")

    def test_roundtrip_preserves_everything(self):
        text = dump_json(self.k)
        restored = load_json(text)
        self.assertEqual(export_state(restored), export_state(self.k))
        self.assertEqual(dump_json(restored), text)  # 再导出逐字符相同
        rec = restored.find_adaptation("cfg-new-int", "dev-old")
        self.assertEqual(rec["effective_config"]["timeout_ms"], 2)

    def test_export_is_deterministic(self):
        self.assertEqual(dump_json(self.k), dump_json(self.k))
        state = json.loads(dump_json(self.k))
        self.assertEqual(state["format_version"], "dc-state/1")

    def test_corrupt_json(self):
        with self.assertRaises(CorruptStateError):
            load_json("{not json")

    def test_missing_top_field(self):
        state = export_state(self.k)
        del state["fields"]
        with self.assertRaises(CorruptStateError) as ctx:
            import_state(state)
        self.assertIn("fields", str(ctx.exception))

    def test_duplicate_device_id_on_load(self):
        state = export_state(self.k)
        state["devices"].append(dict(state["devices"][0]))
        with self.assertRaises(CorruptStateError):
            import_state(state)

    def test_bad_version_on_load(self):
        state = export_state(self.k)
        state["devices"][0]["firmware"] = "1.x"
        with self.assertRaises(VersionError):
            import_state(state)

    def test_missing_reference_field_on_load(self):
        state = export_state(self.k)
        state["fields"] = [
            f for f in state["fields"] if f["name"] != "timeout_s"]
        with self.assertRaises((CorruptStateError, ValidationError)):
            import_state(state)

    def test_forked_rule_rejected_on_load(self):
        state = export_state(self.k)
        state["migration_rules"].append(dict(state["migration_rules"][0]))
        with self.assertRaises(CorruptStateError):
            import_state(state)

    def test_bad_type_change_rejected_on_load(self):
        state = export_state(self.k)
        state["migration_rules"][0]["type_changes"][0]["to_type"] = "bool"
        with self.assertRaises((CorruptStateError, ValidationError)):
            import_state(state)

    def test_tampered_adaptation_record_rejected(self):
        state = export_state(self.k)
        state["adaptations"][0]["effective_config"]["ssid"] = "TAMPERED"
        with self.assertRaises(CorruptStateError) as ctx:
            import_state(state)
        self.assertIn("不一致", str(ctx.exception))

    def test_tampered_record_id_rejected(self):
        state = export_state(self.k)
        state["adaptations"][0]["record_id"] = "0000000000000000"
        with self.assertRaises(CorruptStateError):
            import_state(state)

    def test_failed_load_leaves_caller_state_unchanged(self):
        before = dump_json(self.k)
        bad = export_state(self.k)
        bad["devices"][0]["firmware"] = "broken"
        with self.assertRaises(Exception):
            import_state(bad)
        # 原内核对象完全不受影响
        self.assertEqual(dump_json(self.k), before)
        self.assertEqual(len(self.k.list_devices()), 3)

    def test_wrong_format_version(self):
        state = export_state(self.k)
        state["format_version"] = "other/9"
        with self.assertRaises(CorruptStateError):
            import_state(state)

    def test_decision_missing_inner_field(self):
        state = export_state(self.k)
        del state["adaptations"][0]["decisions"][0]["reason"]
        with self.assertRaises(CorruptStateError):
            import_state(state)

    def test_bytes_input(self):
        restored = load_json(dump_json(self.k).encode("utf-8"))
        self.assertEqual(export_state(restored), export_state(self.k))


# ---------------------------------------------------------------------------
# 配置登记的补充校验
# ---------------------------------------------------------------------------


class ConfigRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.k = ConfigKernel()
        build_fields(self.k)

    def test_config_validation(self):
        with self.assertRaises(ValidationError):
            self.k.register_config("c", "1.0", {"ghost": 1})
        with self.assertRaises(VersionError):
            self.k.register_config("c", "1.x", {})
        with self.assertRaises(ValidationError):
            self.k.register_config("c", "1.0", {"power_save": True})  # 未来字段
        with self.assertRaises(ValidationError):
            self.k.register_config("c", "2.0", {"power_save": "yes"})  # 类型不符
        with self.assertRaises(ValidationError):
            self.k.register_config("c", "1.0", True)  # 非字典

    def test_duplicate_config(self):
        self.k.register_config("c", "1.0", {})
        with self.assertRaises(DuplicateError):
            self.k.register_config("c", "1.0", {})

    def test_bool_not_accepted_as_int_value(self):
        with self.assertRaises(ValidationError):
            self.k.register_config("c", "3.0", {"interval": True})


if __name__ == "__main__":
    unittest.main()
