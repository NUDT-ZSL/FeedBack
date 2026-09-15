"""需求 1、2：版本登记链与字段规则合法性。"""

import unittest

from evo_kernel import (
    FieldRule,
    Kernel,
    RuleDefinitionError,
    Transform,
    VersionError,
    VersionRegistry,
)


class TestFieldRules(unittest.TestCase):
    def test_valid_minimal_and_roundtrip(self):
        rule = FieldRule.from_dict({"name": "a", "type": "string"})
        self.assertEqual(rule.name, "a")
        self.assertEqual(rule.to_dict(), {"name": "a", "type": "string"})

    def test_unknown_type_points_to_location(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict({"name": "a", "type": "date"})
        self.assertIn("/type", ctx.exception.location)

    def test_name_must_be_nonempty_string(self):
        for bad in [1, "", True, None]:
            with self.assertRaises(RuleDefinitionError):
                FieldRule.from_dict({"name": bad, "type": "string"})
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict({"name": "a.b", "type": "string"})

    def test_enum_only_on_nonempty_unique_strings(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict({"name": "a", "type": "integer", "enum": ["1"]})
        self.assertIn("/enum", ctx.exception.location)
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict({"name": "a", "type": "string", "enum": []})
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict(
                {"name": "a", "type": "string", "enum": ["x", "x"]}
            )

    def test_required_and_default_are_mutually_exclusive(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict(
                {"name": "a", "type": "string", "required": True, "default": "x"}
            )
        self.assertIn("互斥", str(ctx.exception))

    def test_object_requires_fields_and_nested_location(self):
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict({"name": "a", "type": "object"})
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict(
                {
                    "name": "a",
                    "type": "object",
                    "fields": [{"name": "b", "type": "object"}],
                }
            )
        self.assertIn("fields[0]/fields", ctx.exception.location)

    def test_array_requires_item(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict({"name": "a", "type": "array"})
        self.assertIn("/item", ctx.exception.location)

    def test_duplicate_sibling_names_rejected(self):
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict(
                {
                    "name": "a",
                    "type": "object",
                    "fields": [
                        {"name": "b", "type": "string"},
                        {"name": "b", "type": "integer"},
                    ],
                }
            )

    def test_default_must_satisfy_own_rule(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict(
                {"name": "a", "type": "string", "enum": ["x"], "default": "y"}
            )
        self.assertIn("/default", ctx.exception.location)
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict({"name": "a", "type": "integer", "default": True})
        with self.assertRaises(RuleDefinitionError):
            FieldRule.from_dict({"name": "a", "type": "number", "default": float("nan")})

    def test_unknown_rule_keys_rejected(self):
        with self.assertRaises(RuleDefinitionError) as ctx:
            FieldRule.from_dict({"name": "a", "type": "string", "bogus": 1})
        self.assertIn("未知键", str(ctx.exception))


class TestVersionChain(unittest.TestCase):
    def setUp(self):
        self.reg = VersionRegistry()

    def test_root_and_chain(self):
        self.reg.register("v1", [{"name": "a", "type": "integer", "required": True}])
        self.reg.register(
            "v2", [{"name": "a", "type": "integer", "required": True}], parent="v1"
        )
        self.assertEqual(self.reg.chain("v2"), ["v1", "v2"])
        self.assertEqual(self.reg.children_of("v1"), ["v2"])

    def test_parent_must_exist_and_be_registered_first(self):
        with self.assertRaises(VersionError):
            self.reg.register("v2", [], parent="v1")

    def test_duplicate_version_rejected(self):
        self.reg.register("v1", [])
        with self.assertRaises(VersionError):
            self.reg.register("v1", [])

    def test_no_forks(self):
        self.reg.register("v1", [{"name": "a", "type": "integer", "required": True}])
        self.reg.register(
            "v2", [{"name": "a", "type": "integer", "required": True}], parent="v1"
        )
        with self.assertRaises(VersionError) as ctx:
            self.reg.register(
                "v2b", [{"name": "a", "type": "integer", "required": True}], parent="v1"
            )
        self.assertIn("不能分叉", str(ctx.exception))

    def test_new_required_field_needs_default_or_transform(self):
        self.reg.register("v1", [{"name": "a", "type": "integer", "required": True}])
        with self.assertRaises(RuleDefinitionError):
            self.reg.register(
                "v2",
                [
                    {"name": "a", "type": "integer", "required": True},
                    {"name": "b", "type": "string", "required": True},
                ],
                parent="v1",
            )
        # 有 transform 覆盖时放行，运行时仍校验产物。
        self.reg.register(
            "v2",
            [
                {"name": "a", "type": "integer", "required": True},
                {"name": "b", "type": "string", "required": True},
            ],
            parent="v1",
            transform=Transform("make b", lambda d: d.setdefault("b", "x")),
        )

    def test_type_narrowing_and_enum_shrinking_rejected_without_transform(self):
        self.reg.register(
            "v1",
            [
                {"name": "n", "type": "number", "default": 1.0},
                {"name": "s", "type": "string", "enum": ["a", "b"]},
            ],
        )
        with self.assertRaises(RuleDefinitionError):
            self.reg.register(
                "v2",
                [
                    {"name": "n", "type": "integer", "default": 1},
                    {"name": "s", "type": "string", "enum": ["a", "b"]},
                ],
                parent="v1",
            )
        with self.assertRaises(RuleDefinitionError):
            self.reg.register(
                "v2b",
                [
                    {"name": "n", "type": "number", "default": 1.0},
                    {"name": "s", "type": "string", "enum": ["a"]},
                ],
                parent="v1",
            )

    def test_integer_to_number_widening_allowed(self):
        self.reg.register("v1", [{"name": "n", "type": "integer", "required": True}])
        self.reg.register(
            "v2", [{"name": "n", "type": "number", "required": True}], parent="v1"
        )

    def test_multiple_independent_roots_but_cross_chain_path_fails(self):
        self.reg.register("a1", [{"name": "x", "type": "string"}])
        self.reg.register("b1", [{"name": "x", "type": "string"}])
        with self.assertRaises(VersionError):
            self.reg.common_chain("a1", "b1")

    def test_registration_failure_leaves_registry_unchanged(self):
        self.reg.register("v1", [{"name": "a", "type": "string"}])
        before = self.reg.versions()
        with self.assertRaises(RuleDefinitionError):
            self.reg.register(
                "v2",
                [{"name": "a", "type": "bogus"}],
                parent="v1",
            )
        self.assertEqual(self.reg.versions(), before)


if __name__ == "__main__":
    unittest.main()
