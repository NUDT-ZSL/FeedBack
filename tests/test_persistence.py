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


if __name__ == "__main__":
    unittest.main()
