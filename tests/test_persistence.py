"""持久化测试：往返一致、校验和、损坏/缺字段报错清晰且失败后状态不变。"""

import json
import os
import tempfile
import unittest

from experience_graph import CorruptSnapshot, ExperienceGraph
from experience_graph import persistence


def build_sample():
    g = ExperienceGraph()
    g.create_entry("a", "主题A", "段0\n段1\n段2", "alice", "创建A")
    g.create_entry("b", "主题B", "B正文", "bob", "创建B")
    g.add_reference("a", "b")
    g.submit_revision("a", "carol", 0, "段0\n段1改\n段2", "改段1")
    # 制造一条冲突记录
    g.integrate_revisions("b", [
        {"author": "x", "base_version": 0, "body": "BX", "change": "x"},
        {"author": "y", "base_version": 0, "body": "BY", "change": "y"},
    ], strict=False)
    return g


class RoundTripTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snap.json")

    def test_roundtrip_preserves_all_state(self):
        g = build_sample()
        persistence.save(g, self.path)
        g2 = persistence.load(self.path)
        self.assertEqual(g2.to_dict(), g.to_dict())
        self.assertEqual(g2.clock, g.clock)
        self.assertEqual(g2.get_entry("a")["body"], g.get_entry("a")["body"])
        self.assertEqual(g2.backlinks("b"), ["a"])
        self.assertEqual(len(g2.list_conflicts("b")), 1)
        self.assertEqual(g2.revision_chain("a")[1]["authors"], ["carol"])

    def test_reload_into_existing_keeps_state_on_success(self):
        g = build_sample()
        persistence.save(g, self.path)
        target = ExperienceGraph()
        target.create_entry("zzz", "z", "z", "z")
        persistence.load(self.path, into=target)
        self.assertEqual(target.list_entries(), ["a", "b"])

    def test_single_file_is_created(self):
        g = build_sample()
        persistence.save(g, self.path)
        self.assertTrue(os.path.isfile(self.path))
        # 无残留临时文件
        leftovers = [f for f in os.listdir(self.tmp) if f.startswith(".eg-")]
        self.assertEqual(leftovers, [])


class CorruptionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "snap.json")
        self.good = build_sample()
        persistence.save(self.good, self.path)
        # 一个已有内容的目标对象，用于验证失败后状态不变
        self.target = build_sample()
        self.before = self.target.to_dict()

    def _load_expect_failure(self):
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path, into=self.target)

    def _check_state_unchanged(self):
        self.assertEqual(self.target.to_dict(), self.before)

    def test_bad_json(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{不是合法 json")
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_missing_top_level_field(self):
        with open(self.path, encoding="utf-8") as fh:
            env = json.load(fh)
        del env["checksum"]
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(env, fh)
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_checksum_mismatch_on_tamper(self):
        with open(self.path, encoding="utf-8") as fh:
            env = json.load(fh)
        env["payload"]["entries"]["a"]["topic"] = "被篡改"
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(env, fh)
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_missing_entry_field(self):
        with open(self.path, encoding="utf-8") as fh:
            env = json.load(fh)
        del env["payload"]["versions"]["a"][0]["body"]
        env["checksum"] = persistence._checksum(env["payload"])
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(env, fh)
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_dangling_edge_rejected(self):
        with open(self.path, encoding="utf-8") as fh:
            env = json.load(fh)
        env["payload"]["edges"].append(["a", "ghost"])
        env["checksum"] = persistence._checksum(env["payload"])
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(env, fh)
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_nonversioned_numbers_rejected(self):
        with open(self.path, encoding="utf-8") as fh:
            env = json.load(fh)
        env["payload"]["versions"]["a"][0]["number"] = 5
        env["checksum"] = persistence._checksum(env["payload"])
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(env, fh)
        self._load_expect_failure()
        self._check_state_unchanged()

    def test_missing_file_clear_error(self):
        with self.assertRaises(CorruptSnapshot):
            persistence.load(os.path.join(self.tmp, "nope.json"))

    def test_error_message_is_readable(self):
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("garbage")
        try:
            persistence.load(self.path)
        except CorruptSnapshot as exc:
            self.assertIn("JSON", str(exc))
        else:
            self.fail("应当抛出 CorruptSnapshot")


def build_split_sample():
    g = ExperienceGraph()
    g.create_entry("a", "主题A", "段0\n段1", "alice")
    g.create_entry("b", "主题B", "B", "bob")
    g.add_reference("b", "a")
    g.split_entry("a", [
        {"id": "a1", "topic": "A1", "body": "段0", "author": "alice"},
        {"id": "a2", "topic": "A2", "body": "段1", "author": "alice"},
    ])
    return g


class SplitArchiveIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "split.json")

    def _envelope(self, payload):
        return {
            "format": persistence.FORMAT,
            "version": persistence.ENVELOPE_VERSION,
            "payload": payload,
            "checksum": persistence._checksum(payload),
        }

    def test_split_snapshot_roundtrips(self):
        g = build_split_sample()
        persistence.save(g, self.path)
        loaded = persistence.load(self.path)
        self.assertEqual(loaded.to_dict(), g.to_dict())
        self.assertEqual(loaded.get_entry("a")["status"], "split")

    def test_edge_touching_archived_entry_rejected(self):
        g = build_split_sample()
        payload = g.to_dict()
        payload["edges"].append(["b", "a"])        # a 已归档，不得持边
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self._envelope(payload), fh)
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path)

    def test_split_target_missing_rejected(self):
        g = build_split_sample()
        payload = g.to_dict()
        # 删掉分片 a2，却仍让归档 a 指向它
        del payload["entries"]["a2"]
        del payload["versions"]["a2"]
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(self._envelope(payload), fh)
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path)


def _write_payload(payload, path):
    env = {
        "format": persistence.FORMAT,
        "version": persistence.ENVELOPE_VERSION,
        "payload": payload,
        "checksum": persistence._checksum(payload),
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(env, fh)


class LegacySnapshotInferenceTests(unittest.TestCase):
    """早期快照没有 status / splits 字段：导入时按拆分记录推断并补齐归档状态。"""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "legacy.json")
        self.current = build_split_sample().to_dict()

    def _legacy_payload(self, *, drop_parent_into=False):
        # 旧格式：保留 split_into / split_from / split_from_version 结构关系，
        # 仅缺少 status、split_clock 与整份 splits 事件账。
        payload = json.loads(json.dumps(self.current))
        for meta in payload["entries"].values():
            meta.pop("status", None)
            meta.pop("split_clock", None)
        if drop_parent_into:
            payload["entries"]["a"].pop("split_into", None)
        payload.pop("splits", None)
        return payload

    def test_legacy_snapshot_infers_archive_state(self):
        for drop_parent_into in (False, True):
            path = os.path.join(self.tmp, f"legacy_{drop_parent_into}.json")
            _write_payload(self._legacy_payload(drop_parent_into=drop_parent_into), path)
            loaded = persistence.load(path)
            self.assertEqual(loaded.get_entry("a")["status"], "split")
            self.assertEqual(loaded.get_entry("a")["split_into"], ["a1", "a2"])
            self.assertEqual(loaded.get_entry("a1")["split_from"], "a")
            self.assertEqual(loaded.get_entry("a1")["split_from_version"], 0)
            # 归档条目从活跃列表隐藏、可在全量列表中找到
            self.assertNotIn("a", loaded.list_entries())
            self.assertIn("a", loaded.list_entries(include_archived=True))

    def test_legacy_snapshot_normalizes_to_current_format(self):
        _write_payload(self._legacy_payload(), self.path)
        loaded = persistence.load(self.path)
        # 导入结果与"当前格式导出再导入"完全一致
        self.assertEqual(loaded.to_dict(), self.current)
        # splits 事件账已补齐
        self.assertEqual(loaded.to_dict()["splits"], self.current["splits"])
        # 再次保存/载入稳定
        again_path = os.path.join(self.tmp, "again.json")
        persistence.save(loaded, again_path)
        self.assertEqual(persistence.load(again_path).to_dict(), self.current)

    def test_archived_revision_rejected_after_legacy_import(self):
        _write_payload(self._legacy_payload(), self.path)
        loaded = persistence.load(self.path)
        chain_before = [c["new_version"] for c in loaded.revision_chain("a")]
        with self.assertRaises(Exception):
            loaded.submit_revision("a", "z", 0, "HACK", "改旧归档")
        self.assertEqual(
            [c["new_version"] for c in loaded.revision_chain("a")], chain_before)

    def test_legacy_split_from_missing_source_rejected(self):
        payload = self._legacy_payload()
        payload["entries"]["a1"]["split_from"] = "ghost"
        _write_payload(payload, self.path)
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path)

    def test_ledger_parent_missing_rejected(self):
        payload = self.current
        payload["splits"][0]["parent"] = "ghost"
        _write_payload(payload, self.path)
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path)

    def test_active_with_split_into_rejected(self):
        # 显式 active 却声明分片：自相矛盾，按损坏拒绝
        payload = self.current
        payload["entries"]["a"]["status"] = "active"
        _write_payload(payload, self.path)
        with self.assertRaises(CorruptSnapshot):
            persistence.load(self.path)

    def test_declared_part_order_preserved_on_roundtrip(self):
        # 分片按非字母顺序声明时，当前格式往返必须原样保留声明顺序
        g = ExperienceGraph()
        g.create_entry("p", "T", "L0\nL1", "u")
        g.create_entry("x", "X", "x", "v")
        g.add_reference("x", "p")
        g.split_entry("p", [
            {"id": "zzz", "topic": "z", "body": "L0", "author": "u"},
            {"id": "aaa", "topic": "a", "body": "L1", "author": "u"},
        ])
        path = os.path.join(self.tmp, "order.json")
        persistence.save(g, path)
        loaded = persistence.load(path)
        self.assertEqual(loaded.to_dict(), g.to_dict())
        self.assertEqual(loaded.get_entry("p")["split_into"], ["zzz", "aaa"])

    def test_child_only_backref_rebuild_deterministic(self):
        # 旧快照仅靠子片 split_from 回指重建父归档（父侧无 split_into/status）
        g = ExperienceGraph()
        g.create_entry("p", "T", "L0\nL1", "u")
        g.split_entry("p", [
            {"id": "zzz", "topic": "z", "body": "L0", "author": "u"},
            {"id": "aaa", "topic": "a", "body": "L1", "author": "u"},
        ])
        payload = g.to_dict()
        for meta in payload["entries"].values():
            meta.pop("status", None)
            meta.pop("split_clock", None)
        payload["entries"]["p"].pop("split_into", None)
        payload.pop("splits", None)
        path = os.path.join(self.tmp, "childonly.json")
        _write_payload(payload, path)
        loaded = persistence.load(path)
        self.assertEqual(loaded.get_entry("p")["status"], "split")
        # 无权威顺序时按字典序确定化
        self.assertEqual(loaded.get_entry("p")["split_into"], ["aaa", "zzz"])
        with self.assertRaises(Exception):
            loaded.submit_revision("p", "z", 0, "nope", "c")


if __name__ == "__main__":
    unittest.main()
