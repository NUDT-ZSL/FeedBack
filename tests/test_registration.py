"""登记层：型号 / 固件 / 能力 / 字段规则的重复与非法输入拒绝（需求 1）。"""

import unittest

from cfgkernel.errors import RegistrationError
from cfgkernel.schema import POLICY_CLAMP

from tests.helpers import build_kernel


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()

    def test_duplicate_capability_rejected(self):
        with self.assertRaises(RegistrationError) as cm:
            self.k.register_capability("wifi", "1.0.0")
        self.assertIn("重复登记", str(cm.exception))

    def test_duplicate_model_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_model("GW-A100")

    def test_duplicate_firmware_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_firmware("GW-A100", "1.0.0")

    def test_duplicate_field_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field("net.tx_power", "int", "1.0.0", default=20)

    def test_duplicate_field_change_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.add_field_change("net.tx_power", "2.0.0", max_value=20)

    def test_bad_type_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field("x.y", "decimal", "1.0.0", default=1)

    def test_bad_policy_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.y", "int", "1.0.0", default=0, range_policy="explode")

    def test_bounds_out_of_order_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.y", "int", "1.0.0", default=5, min_value=10, max_value=1)

    def test_duplicate_enum_member_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.y", "enum", "1.0.0", default="a",
                enum_members=[("a", "1.0.0"), ("a", "1.0.0")])

    def test_enum_expansion_duplicate_member_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.add_field_change(
                "net.wifi_mode", "2.5.0", enum_members_added=[("n", "2.5.0")])

    def test_invalid_default_rejected(self):
        with self.assertRaises(RegistrationError) as cm:
            self.k.register_field(
                "x.y", "int", "1.0.0", default=99, min_value=0, max_value=10)
        self.assertIn("默认值非法", str(cm.exception))

    def test_fallback_requires_valid_member(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.y", "enum", "1.0.0", default="a",
                enum_members=[("a", "1.0.0")],
                range_policy="fallback", degrade_fallback="zzz")

    def test_unknown_capability_reference_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.y", "bool", "1.0.0", default=False,
                required_capability="nope")

    def test_support_before_capability_introduced_rejected(self):
        self.k.register_model("GW-X")
        self.k.register_firmware("GW-X", "1.0.0")
        with self.assertRaises(RegistrationError):
            self.k.register_support("GW-X", "ble_mesh", "1.0.0")

    def test_support_on_unregistered_firmware_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_support("GW-A100", "wifi", "9.9.9")

    def test_duplicate_support_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_support("GW-A100", "wifi", "1.5.0")

    def test_apply_to_unregistered_firmware_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.apply({"system": {"name": "x"}}, "GW-A100", "3.0.0")

    def test_bad_version_format_rejected(self):
        self.k.register_model("GW-TMP")
        for bad in ("1", "v1.0.0", "1.0.x", "1..0", "1.0.0.0"):
            with self.assertRaises(RegistrationError, msg=bad):
                self.k.register_firmware("GW-TMP", bad)

    def test_bad_field_path_rejected(self):
        for bad in ("", "net.", ".net", "1net.x", "net-tx.power"):
            with self.assertRaises(RegistrationError, msg=bad):
                self.k.register_field(bad, "int", "1.0.0", default=0)

    def test_migration_chain_no_fork(self):
        with self.assertRaises(RegistrationError):
            self.k.register_migration_step("1.0.0", "3.0.0")

    def test_migration_step_duplicate_rejected(self):
        with self.assertRaises(RegistrationError):
            self.k.register_migration_step("1.0.0", "1.5.0")

    def test_clamp_policy_default_value_still_validated(self):
        with self.assertRaises(RegistrationError):
            self.k.register_field(
                "x.z", "int", "1.0.0", default=100,
                min_value=0, max_value=10, range_policy=POLICY_CLAMP)


if __name__ == "__main__":
    unittest.main()
