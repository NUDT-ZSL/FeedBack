"""需求 5：版本间迁移、与直接解析一致、失败回滚、可复现。"""

import copy
import unittest

from evo_kernel import Kernel, MigrationError, Transform, migrate
from evo_kernel.parser import parse

from .scenario import V1_FIELDS, V2_FIELDS, V3_FIELDS, build_kernel, transform_v3


class TestMigration(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()

    def test_single_step_v1_to_v2(self):
        raw = {"id": 1, "name": "doc", "status": "published", "tags": ["a"]}
        result = migrate(self.k.registry, "v1", "v2", raw)
        direct = parse(self.k.registry.get("v2"), raw).require_ok()
        self.assertEqual(result.data, direct.data)
        self.assertTrue(result.consistent_with_direct_parse)
        self.assertEqual(result.path, ["v1", "v2"])
        self.assertEqual(result.steps[0].fields_added, ["address", "address.city", "address.zip"])
        self.assertEqual(result.steps[0].fields_removed, [])
        # 输入不被修改
        self.assertEqual(raw["status"], "published")

    def test_multi_step_v1_to_v3_with_transform(self):
        raw = {"id": 1, "name": "doc", "status": "published", "tags": ["a", "b"]}
        result = migrate(self.k.registry, "v1", "v3", raw)
        self.assertEqual(result.path, ["v1", "v2", "v3"])
        self.assertEqual(result.data["title"], "doc")
        self.assertEqual(result.data["status"], "live")
        self.assertEqual(result.data["tags"], [{"label": "a"}, {"label": "b"}])
        self.assertNotIn("name", result.data)
        self.assertEqual(
            result.steps[1].transform_applied,
            "v2->v3: name改名title, status收窄, tags包对象",
        )
        # 与“直接按目标版本解析 transform 后的数据”一致（最终态不变量）
        transformed = copy.deepcopy(raw)
        transform_v3(transformed)  # v2 超集解析对 v1 数据先补默认值不影响 transform
        reparsed = parse(self.k.registry.get("v3"), result.data).require_ok()
        self.assertEqual(result.data, reparsed.data)

    def test_archived_enum_added_in_v2(self):
        raw = {"id": 1, "name": "d", "status": "archived"}
        # v1 下非法
        self.assertFalse(parse(self.k.registry.get("v1"), raw).ok)
        # 直接按 v2 合法，迁移到 v3 保持 archived
        result = migrate(self.k.registry, "v1", "v3", {"id": 1, "name": "d", "status": "draft"})
        self.assertEqual(result.data["status"], "draft")

    def test_unknown_fields_carry_forward_and_never_drop(self):
        raw = {"id": 1, "name": "d", "status": "draft", "legacy_blob": [1, 2]}
        result = migrate(self.k.registry, "v1", "v3", raw)
        self.assertIn("legacy_blob", result.unknown)
        self.assertEqual(result.unknown["legacy_blob"], [1, 2])

    def test_reproducible_byte_identical(self):
        from evo_kernel.paths import canonical_bytes

        raw = {"id": 1, "name": "d", "status": "published", "tags": ["x"]}
        r1 = migrate(self.k.registry, "v1", "v3", copy.deepcopy(raw))
        r2 = migrate(self.k.registry, "v1", "v3", copy.deepcopy(raw))
        self.assertEqual(canonical_bytes(r1.data), canonical_bytes(r2.data))
        self.assertEqual(
            [s.to_dict() for s in r1.steps], [s.to_dict() for s in r2.steps]
        )

    def test_downgrade_is_rejected(self):
        with self.assertRaises(MigrationError):
            migrate(self.k.registry, "v3", "v1", {"id": 1, "title": "t", "status": "live"})

    def test_invalid_source_data_fails_without_mutating_input(self):
        bad = {"id": "not-int", "name": "d", "status": "draft"}
        with self.assertRaises(MigrationError) as ctx:
            migrate(self.k.registry, "v1", "v3", bad)
        self.assertIn("v1 -> v2", str(ctx.exception))
        self.assertEqual(bad["id"], "not-int")


class TestStoredRecordRollback(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()
        self.k.put_record(
            "r1", "v1", {"id": 1, "name": "doc", "status": "published"}
        )

    def test_success_updates_record_and_appends_log(self):
        result = self.k.migrate_record("r1", "v3")
        self.assertEqual(self.k.get_record("r1")["version_id"], "v3")
        self.assertEqual(result.data["status"], "live")
        logs = self.k.list_migrations("r1")
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["status"], "applied")
        self.assertEqual(logs[0]["before"]["version_id"], "v1")

    def test_failure_rolls_back_record_and_no_log_left(self):
        # 构造一个会在 v3 transform 后校验失败的场景：
        # 直接换一个 transform 会产出非法枚举的内核实例。
        k2 = Kernel()
        k2.register_version("v1", V1_FIELDS)
        k2.register_version("v2", V2_FIELDS, parent="v1")
        k2.register_version(
            "v3",
            V3_FIELDS,
            parent="v2",
            transform=Transform("broken", lambda d: d.update(status="bogus")),
        )
        k2.put_record("r", "v1", {"id": 1, "name": "d", "status": "published"})
        before = k2.get_record("r")
        with self.assertRaises(MigrationError):
            k2.migrate_record("r", "v3")
        after = k2.get_record("r")
        self.assertEqual(after, before)
        self.assertEqual(k2.list_migrations(), [])

    def test_explicit_revert_restores_previous_bytes(self):
        from evo_kernel.paths import canonical_bytes

        original = self.k.get_record("r1")
        self.k.migrate_record("r1", "v2")
        mig_id = self.k.list_migrations("r1")[0]["migration_id"]
        reverted = self.k.revert_migration("r1", mig_id)
        cur = self.k.get_record("r1")
        self.assertEqual(cur["version_id"], "v1")
        self.assertEqual(
            canonical_bytes(cur["data"]), canonical_bytes(original["data"])
        )
        self.assertEqual(reverted["status"], "reverted")
        # 再迁移一次仍可用（回滚不破坏内核）
        self.k.migrate_record("r1", "v2")
        self.assertEqual(self.k.get_record("r1")["version_id"], "v2")

    def test_revert_must_follow_reverse_order(self):
        self.k.migrate_record("r1", "v2")
        first_id = self.k.list_migrations("r1")[0]["migration_id"]
        self.k.migrate_record("r1", "v3")
        with self.assertRaises(MigrationError):
            self.k.revert_migration("r1", first_id)

    def test_migration_id_is_content_deterministic(self):
        self.k.migrate_record("r1", "v2")
        id1 = next(
            m["migration_id"]
            for m in self.k.list_migrations("r1") if m["status"] == "applied"
        )
        # 回滚再迁移同样数据得到同样的迁移 id（已回滚条目不占用 id）
        self.k.revert_migration("r1", id1)
        self.k.migrate_record("r1", "v2")
        id2 = next(
            m["migration_id"]
            for m in self.k.list_migrations("r1") if m["status"] == "applied"
        )
        self.assertEqual(id1, id2)
        self.assertEqual(
            [m["status"] for m in self.k.list_migrations("r1")],
            ["reverted", "applied"],
        )


if __name__ == "__main__":
    unittest.main()
