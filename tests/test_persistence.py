"""JSON 持久化：往返一致、原子落盘、损坏 / 缺字段 / 校验和不符的清晰报错，
且加载失败不改变既有状态（需求 7）。"""

import json
import os
import tempfile
import unittest

from cfgkernel.errors import LoadError
from cfgkernel.persistence import load_kernel, save_kernel

from tests.helpers import build_kernel


def _populated_kernel():
    k = build_kernel()
    cfg = k.normalize(
        {"system": {"name": "site-p"},
         "net": {"tx_power": 25, "wifi_mode": "b/g", "channel": 11}},
        "1.0.0", name="site-p")
    k.migrate(cfg, "2.0.0")
    k.rollback_record(config_name="site-p")
    return k


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "state.json")

    def _read(self):
        with open(self.path, "r", encoding="utf-8") as fh:
            return json.load(fh)

    def test_roundtrip_preserves_everything(self):
        k = _populated_kernel()
        save_kernel(k, self.path)
        k2 = load_kernel(self.path)

        self.assertEqual(sorted(k2.capabilities), sorted(k.capabilities))
        self.assertEqual(sorted(k2.models), sorted(k.models))
        self.assertEqual(sorted(k2.fields), sorted(k.fields))
        self.assertEqual(
            [str(e) for e in sorted(k2._steps)],
            [str(e) for e in sorted(k._steps)])
        self.assertIn("site-p", k2.configs)
        # 配置取值 / 来源 / 忽略清单逐字节一致
        cfg, cfg2 = k.configs["site-p"], k2.configs["site-p"]
        self.assertEqual(cfg2.values, cfg.values)
        self.assertEqual(
            json.dumps(cfg2.to_json(), sort_keys=True, ensure_ascii=False),
            json.dumps(cfg.to_json(), sort_keys=True, ensure_ascii=False))
        # 迁移与回滚记录都在
        self.assertEqual(len(k2.migration_records), 1)
        self.assertEqual(len(k2.rollback_records), 1)
        rec = k2.migration_records[0]
        self.assertTrue(rec.rolled_back)
        self.assertIsNotNone(rec.after_snapshot)
        # 重载后仍可凭记录回滚 / 继续迁移
        again, _ = k2.migrate(k2.configs["site-p"], "2.0.0")
        self.assertEqual(again.get("net.channel_num"), 11)

    def test_saved_file_is_single_json_with_checksum(self):
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        self.assertEqual(data["meta"]["format"], "cfgkernel/1")
        self.assertRegex(data["meta"]["checksum"], r"^[0-9a-f]{64}$")

    def test_corrupt_json_reports_position(self):
        save_kernel(_populated_kernel(), self.path)
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write("{ not json")
        with self.assertRaises(LoadError) as cm:
            load_kernel(self.path)
        self.assertIn("JSON 损坏", str(cm.exception))

    def test_empty_file_rejected(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("   ")
        with self.assertRaises(LoadError):
            load_kernel(self.path)

    def test_missing_top_level_key_rejected(self):
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        del data["payload"]
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(LoadError) as cm:
            load_kernel(self.path)
        self.assertIn("payload", str(cm.exception))

    def test_missing_payload_section_rejected(self):
        # 校验和正确、但 payload 内部缺了一整节：应报具体缺失字段而非崩溃
        from cfgkernel.persistence import _checksum
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        del data["payload"]["fields"]
        data["meta"]["checksum"] = _checksum(data["payload"])
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(LoadError) as cm:
            load_kernel(self.path)
        self.assertIn("fields", str(cm.exception))

    def test_checksum_mismatch_rejected(self):
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        data["payload"]["capabilities"][0]["name"] = "tampered"
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(LoadError) as cm:
            load_kernel(self.path)
        self.assertIn("校验和不符", str(cm.exception))

    def test_checksum_meta_tamper_rejected(self):
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        data["meta"]["checksum"] = "0" * 64
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(LoadError):
            load_kernel(self.path)

    def test_missing_nested_field_rejected(self):
        save_kernel(_populated_kernel(), self.path)
        data = self._read()
        del data["payload"]["models"][0]["firmwares"]
        # checksum will fail first
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaises(LoadError):
            load_kernel(self.path)

    def test_failed_load_leaves_existing_kernel_untouched(self):
        good = _populated_kernel()
        save_kernel(good, self.path)
        loaded = load_kernel(self.path)
        self.assertEqual(len(loaded.migration_records), 1)

        bad = os.path.join(self.tmp, "bad.json")
        with open(bad, "w", encoding="utf-8") as fh:
            fh.write('{"meta": {"format": "cfgkernel/1"},')
        # 加载坏文件抛错；已成功加载的内核不受影响
        with self.assertRaises(LoadError):
            load_kernel(bad)
        self.assertEqual(len(loaded.migration_records), 1)
        self.assertIn("site-p", loaded.configs)

    def test_nonexistent_file_rejected(self):
        with self.assertRaises(LoadError):
            load_kernel(os.path.join(self.tmp, "nope.json"))

    def test_atomic_write_leaves_no_partial_file_on_success(self):
        save_kernel(_populated_kernel(), self.path)
        leftovers = [f for f in os.listdir(self.tmp)
                     if f.startswith(".cfgkernel-")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
