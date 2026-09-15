"""需求 8：导出/重载、损坏报错、失败时内存状态不变。"""

import copy
import json
import unittest

from evo_kernel import BundleError, Kernel, Transform
from evo_kernel.persistence import _checksum

from .scenario import build_kernel, transform_v3


def _v3_transform():
    return Transform("v2->v3: name改名title, status收窄, tags包对象", transform_v3)


class TestBundle(unittest.TestCase):
    def setUp(self):
        self.k = build_kernel()
        self.k.put_record(
            "r1", "v1", {"id": 1, "name": "doc", "status": "published"}
        )
        self.k.migrate_record("r1", "v3")
        self.bundle_text = self.k.export_bundle()

    def test_roundtrip_restores_everything(self):
        k2 = Kernel()
        k2.import_bundle(self.bundle_text, transforms={"v3": _v3_transform()})
        self.assertEqual(k2.versions(), ["v1", "v2", "v3"])
        rec = k2.get_record("r1")
        self.assertEqual(rec["version_id"], "v3")
        self.assertEqual(rec["data"]["status"], "live")
        logs = k2.list_migrations("r1")
        self.assertEqual(len(logs), 1)
        self.assertEqual(logs[0]["target_version"], "v3")
        # 规则也恢复：可继续查询与迁移
        self.assertEqual(k2.field_rule("v3", "status")["enum"], ["draft", "live", "archived"])

    def test_export_is_deterministic(self):
        b1 = self.k.export_bundle()
        b2 = self.k.export_bundle()
        self.assertEqual(b1, b2)

    def test_malformed_json(self):
        k2 = Kernel()
        with self.assertRaises(BundleError):
            k2.import_bundle("{not json")
        with self.assertRaises(BundleError):
            k2.import_bundle("")

    def test_missing_top_level_fields(self):
        bundle = json.loads(self.bundle_text)
        del bundle["migrations"]
        with self.assertRaises(BundleError) as ctx:
            Kernel().import_bundle(json.dumps(bundle))
        self.assertIn("缺少必填字段", str(ctx.exception))

    def test_bad_format_and_version(self):
        bundle = json.loads(self.bundle_text)
        bundle["format"] = "other"
        with self.assertRaises(BundleError):
            Kernel().import_bundle(json.dumps(bundle))

    def test_checksum_detects_tampering(self):
        bundle = json.loads(self.bundle_text)
        bundle["records"][0]["data"]["id"] = 999
        with self.assertRaises(BundleError) as ctx:
            Kernel().import_bundle(json.dumps(bundle, ensure_ascii=False))
        self.assertIn("校验和不匹配", str(ctx.exception))

    def test_semantic_corruption_with_valid_checksum_still_rejected(self):
        bundle = json.loads(self.bundle_text)
        bundle["records"][0]["data"]["status"] = "impossible"
        bundle["checksum_sha256"] = _checksum(bundle)
        with self.assertRaises(BundleError):
            Kernel().import_bundle(
                json.dumps(bundle, ensure_ascii=False),
                transforms={"v3": _v3_transform()},
            )

    def test_dangling_parent_reference_rejected(self):
        bundle = json.loads(self.bundle_text)
        bundle["versions"][0]["version_id"] = "v0-renamed"
        bundle["checksum_sha256"] = _checksum(bundle)
        with self.assertRaises(BundleError):
            Kernel().import_bundle(json.dumps(bundle, ensure_ascii=False))

    def test_dangling_record_version_rejected(self):
        bundle = json.loads(self.bundle_text)
        bundle["records"][0]["version_id"] = "v9"
        bundle["checksum_sha256"] = _checksum(bundle)
        with self.assertRaises(BundleError):
            Kernel().import_bundle(json.dumps(bundle, ensure_ascii=False))

    def test_failed_import_leaves_state_untouched(self):
        k2 = Kernel()
        k2.import_bundle(self.bundle_text, transforms={"v3": _v3_transform()})
        state_versions = k2.versions()
        state_rec = k2.get_record("r1")

        tampered = json.loads(self.bundle_text)
        tampered["records"][0]["data"]["id"] = 999  # 校验和失败
        with self.assertRaises(BundleError):
            k2.import_bundle(json.dumps(tampered, ensure_ascii=False))

        self.assertEqual(k2.versions(), state_versions)
        self.assertEqual(k2.get_record("r1"), state_rec)
        self.assertEqual(k2.list_records(), ["r1"])

    def test_failed_import_on_empty_kernel_stays_empty(self):
        k2 = Kernel()
        tampered = json.loads(self.bundle_text)
        del tampered["versions"][2]["fields"]
        tampered["checksum_sha256"] = _checksum(tampered)
        with self.assertRaises(BundleError):
            k2.import_bundle(json.dumps(tampered, ensure_ascii=False))
        self.assertEqual(k2.versions(), [])
        self.assertEqual(k2.list_records(), [])

    def test_parse_result_inconsistency_detected(self):
        bundle = json.loads(self.bundle_text)
        # 让存储的解析结果 data 与实际 data 不一致，但保持校验和有效
        stored = bundle["records"][0]["parse_result"]
        stored["data"]["status"] = "tampered"
        bundle["checksum_sha256"] = _checksum(bundle)
        with self.assertRaises(BundleError) as ctx:
            Kernel().import_bundle(
                json.dumps(bundle, ensure_ascii=False),
                transforms={"v3": _v3_transform()},
            )
        self.assertIn("不自洽", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
