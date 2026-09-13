"""mvcc 内核与 CLI 的单元测试（unittest，标准库）。"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest

import main
from mvcc import MVCCDatabase, MVCCError, StorageFormatError


class VisibilityTest(unittest.TestCase):
    """快照隔离下的可见性判断。"""

    def test_read_missing_key_returns_none(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        self.assertIsNone(db.get("t1", "nope"))

    def test_read_own_uncommitted_write(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "mine")
        self.assertEqual(db.get("t1", "a"), "mine")

    def test_own_write_shadows_committed_version(self) -> None:
        db = MVCCDatabase()
        db.begin("t0")
        db.put("t0", "a", "old")
        db.commit("t0")
        db.begin("t1")
        db.put("t1", "a", "new")
        self.assertEqual(db.get("t1", "a"), "new")

    def test_own_uncommitted_delete_hides_committed_value(self) -> None:
        db = MVCCDatabase()
        db.begin("t0")
        db.put("t0", "a", "v")
        db.commit("t0")
        db.begin("t1")
        db.delete("t1", "a")
        self.assertIsNone(db.get("t1", "a"))

    def test_snapshot_does_not_see_later_commits(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v1")
        db.commit("t1")
        db.begin("reader")  # snapshot_ts = 1
        db.begin("t2")
        db.put("t2", "a", "v2")
        db.commit("t2")  # commit_ts = 2，晚于 reader 的快照
        self.assertEqual(db.get("reader", "a"), "v1")

    def test_snapshot_does_not_see_other_active_txn_writes(self) -> None:
        db = MVCCDatabase()
        db.begin("writer")
        db.put("writer", "a", "uncommitted")
        db.begin("reader")
        self.assertIsNone(db.get("reader", "a"))

    def test_tombstone_reads_as_none(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v")
        db.commit("t1")
        db.begin("t2")
        db.delete("t2", "a")
        db.commit("t2")
        db.begin("t3")
        self.assertIsNone(db.get("t3", "a"))

    def test_snapshot_before_tombstone_still_sees_value(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v")
        db.commit("t1")
        db.begin("reader")  # 快照在删除之前
        db.begin("t2")
        db.delete("t2", "a")
        db.commit("t2")
        self.assertEqual(db.get("reader", "a"), "v")

    def test_read_set_records_keys(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.get("t1", "a")
        db.get("t1", "b")
        self.assertEqual(db.state("t1")["read_set"], ["a", "b"])


class ConflictTest(unittest.TestCase):
    """写写冲突检测（first-committer-wins）。"""

    def test_later_committer_on_same_key_aborts(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.begin("t2")
        db.put("t1", "a", "1")
        db.put("t2", "a", "2")
        r1 = db.commit("t1")
        r2 = db.commit("t2")
        self.assertTrue(r1.committed)
        self.assertFalse(r2.committed)
        self.assertEqual(r2.conflicts, ["a"])
        self.assertEqual(db.state("t2")["state"], "aborted")

    def test_disjoint_write_sets_both_commit(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.begin("t2")
        db.put("t1", "a", "1")
        db.put("t2", "b", "2")
        self.assertTrue(db.commit("t1").committed)
        self.assertTrue(db.commit("t2").committed)

    def test_delete_vs_put_is_a_conflict(self) -> None:
        db = MVCCDatabase()
        db.begin("t0")
        db.put("t0", "a", "v")
        db.commit("t0")
        db.begin("t1")
        db.begin("t2")
        db.delete("t1", "a")
        db.put("t2", "a", "v2")
        self.assertTrue(db.commit("t1").committed)
        r = db.commit("t2")
        self.assertFalse(r.committed)
        self.assertEqual(r.conflicts, ["a"])

    def test_conflict_reports_all_conflicting_keys(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.begin("t2")
        db.put("t1", "a", "1")
        db.put("t1", "b", "1")
        db.put("t2", "a", "2")
        db.put("t2", "b", "2")
        db.put("t2", "c", "2")
        db.commit("t1")
        r = db.commit("t2")
        self.assertEqual(r.conflicts, ["a", "b"])

    def test_write_after_other_commits_before_snapshot_is_fine(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "1")
        db.commit("t1")
        db.begin("t2")  # 快照在 t1 提交之后
        db.put("t2", "a", "2")
        self.assertTrue(db.commit("t2").committed)

    def test_aborted_txn_writes_nothing(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.begin("t2")
        db.put("t1", "a", "1")
        db.put("t2", "a", "2")
        db.commit("t1")
        db.commit("t2")  # 冲突 abort
        db.begin("t3")
        self.assertEqual(db.get("t3", "a"), "1")


class ReadOnlyAndWriteSkewTest(unittest.TestCase):
    """只读事务与写偏斜语义。"""

    def test_read_only_txn_commits_without_conflict_check(self) -> None:
        db = MVCCDatabase()
        db.begin("reader")
        db.get("reader", "a")
        db.begin("writer")
        db.put("writer", "a", "v")
        db.commit("writer")
        # reader 读的键被别人写了，但只读事务不检查冲突
        r = db.commit("reader")
        self.assertTrue(r.committed)
        self.assertIsNone(r.commit_ts)  # 只读提交不分配 commit_ts

    def test_write_skew_is_allowed_under_snapshot_isolation(self) -> None:
        # 经典写偏斜：两个事务各读对方要写的键，写集合不相交，都能提交
        db = MVCCDatabase()
        db.begin("t0")
        db.put("t0", "x", "100")
        db.put("t0", "y", "100")
        db.commit("t0")
        db.begin("t1")
        db.begin("t2")
        self.assertEqual(db.get("t1", "y"), "100")  # t1 读 y
        self.assertEqual(db.get("t2", "x"), "100")  # t2 读 x
        db.put("t1", "x", "0")  # t1 写 x
        db.put("t2", "y", "0")  # t2 写 y
        self.assertTrue(db.commit("t1").committed)
        self.assertTrue(db.commit("t2").committed)  # SI 允许写偏斜

    def test_read_write_txn_with_read_overlap_commits(self) -> None:
        db = MVCCDatabase()
        db.begin("t0")
        db.put("t0", "shared", "v")
        db.commit("t0")
        db.begin("t1")
        db.begin("t2")
        db.get("t1", "shared")  # 读集合相交
        db.get("t2", "shared")
        db.put("t1", "k1", "1")
        db.put("t2", "k2", "2")  # 写集合不相交
        self.assertTrue(db.commit("t1").committed)
        self.assertTrue(db.commit("t2").committed)


class GcTest(unittest.TestCase):
    """垃圾回收及边界。"""

    def _db_with_versions(self) -> MVCCDatabase:
        db = MVCCDatabase()
        for i in range(1, 4):  # commit_ts 1..3，键 a 的三个版本
            db.begin(f"t{i}")
            db.put(f"t{i}", "a", f"v{i}")
            db.commit(f"t{i}")
        return db

    def test_gc_keeps_newest_visible_version_per_key(self) -> None:
        db = self._db_with_versions()
        db.begin("old")  # snapshot_ts = 3
        db.begin("t4")
        db.put("t4", "a", "v4")
        db.commit("t4")  # commit_ts = 4
        collected = db.gc()
        # 阈值 3：保留 ts=3（<=3 的最新）和 ts=4，清掉 ts=1,2
        self.assertEqual(collected, 2)
        chain = db.dump()["versions"]["a"]
        self.assertEqual([v["commit_ts"] for v in chain], [3, 4])
        # 老事务仍读到 v3
        self.assertEqual(db.get("old", "a"), "v3")

    def test_gc_boundary_snapshot_equals_version_commit_ts(self) -> None:
        # 最老事务的 snapshot_ts 恰好等于某版本的 commit_ts，该版本必须保留
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v1")
        db.commit("t1")  # commit_ts = 1
        db.begin("old")  # snapshot_ts = 1，正好等于版本 1 的 commit_ts
        db.begin("t2")
        db.put("t2", "a", "v2")
        db.commit("t2")  # commit_ts = 2
        collected = db.gc()  # 阈值 = 1，版本 1 是 <=1 的最新版本，保留
        self.assertEqual(collected, 0)
        self.assertEqual(db.get("old", "a"), "v1")

    def test_gc_without_active_txns_keeps_only_latest(self) -> None:
        db = self._db_with_versions()
        collected = db.gc()  # 无 active 事务，阈值 = 3
        self.assertEqual(collected, 2)
        chain = db.dump()["versions"]["a"]
        self.assertEqual([v["commit_ts"] for v in chain], [3])

    def test_gc_does_not_touch_versions_newer_than_threshold(self) -> None:
        db = MVCCDatabase()
        db.begin("old")  # snapshot_ts = 0
        db.begin("t1")
        db.put("t1", "a", "v1")
        db.commit("t1")
        db.begin("t2")
        db.put("t2", "a", "v2")
        db.commit("t2")
        collected = db.gc()  # 阈值 = 0，没有 <=0 的版本，全部保留
        self.assertEqual(collected, 0)
        self.assertEqual(len(db.dump()["versions"]["a"]), 2)

    def test_gc_keeps_tombstone_when_it_is_the_visible_version(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v")
        db.commit("t1")
        db.begin("t2")
        db.delete("t2", "a")
        db.commit("t2")  # 墓碑 ts=2
        db.begin("old")  # snapshot_ts = 2
        collected = db.gc()
        self.assertEqual(collected, 1)  # 清掉 ts=1，保留墓碑
        self.assertIsNone(db.get("old", "a"))

    def test_gc_on_empty_db(self) -> None:
        db = MVCCDatabase()
        self.assertEqual(db.gc(), 0)


class PersistenceTest(unittest.TestCase):
    """save/load 快照往返与一致性校验。"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmp.name, "db.json")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _sample_db(self) -> MVCCDatabase:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v1")
        db.put("t1", "b", "v1")
        db.commit("t1")
        db.begin("t2")
        db.delete("t2", "b")
        db.commit("t2")
        db.begin("active")  # 留一个活跃事务
        db.put("active", "c", "pending")
        db.get("active", "a")
        return db

    def test_save_load_roundtrip_preserves_state(self) -> None:
        db = self._sample_db()
        db.save(self.path)
        loaded = MVCCDatabase.load(self.path)
        self.assertEqual(db.dump(), loaded.dump())

    def test_loaded_db_continues_to_work(self) -> None:
        db = self._sample_db()
        db.save(self.path)
        loaded = MVCCDatabase.load(self.path)
        # 活跃事务继续提交，commit_ts 接着计数
        r = loaded.commit("active")
        self.assertTrue(r.committed)
        self.assertEqual(r.commit_ts, 3)
        loaded.begin("t3")
        self.assertEqual(loaded.get("t3", "c"), "pending")
        self.assertIsNone(loaded.get("t3", "b"))  # 墓碑仍然生效

    def test_load_missing_file(self) -> None:
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(os.path.join(self.tmp.name, "nope.json"))
        self.assertIn("not found", str(ctx.exception))

    def test_load_broken_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            f.write("{not json")
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("invalid JSON", str(ctx.exception))

    def _write_raw(self, data: object) -> None:
        with open(self.path, "w", encoding="utf-8") as f:
            json.dump(data, f)

    def _minimal_valid(self) -> dict:
        return {
            "format": "mvcc-snapshot-v1",
            "commit_ts_counter": 0,
            "start_seq_counter": 0,
            "versions": {},
            "transactions": [],
        }

    def test_load_missing_format_tag(self) -> None:
        data = self._minimal_valid()
        del data["format"]
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("format", str(ctx.exception))

    def test_load_missing_field(self) -> None:
        data = self._minimal_valid()
        del data["versions"]
        self._write_raw(data)
        with self.assertRaises(StorageFormatError):
            MVCCDatabase.load(self.path)

    def test_load_duplicate_txn_id_rejected(self) -> None:
        data = self._minimal_valid()
        txn = {
            "txn_id": "t1",
            "state": "active",
            "snapshot_ts": 0,
            "start_seq": 1,
            "read_set": [],
            "write_set": {},
        }
        data["transactions"] = [txn, dict(txn)]
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("duplicate txn_id", str(ctx.exception))

    def test_load_non_ascending_chain_rejected(self) -> None:
        data = self._minimal_valid()
        data["commit_ts_counter"] = 2
        data["transactions"] = [
            {
                "txn_id": "t1",
                "state": "committed",
                "snapshot_ts": 0,
                "start_seq": 1,
                "read_set": [],
                "write_set": {},
            }
        ]
        data["versions"] = {
            "a": [
                {"commit_ts": 2, "value": "x", "txn_id": "t1"},
                {"commit_ts": 1, "value": "y", "txn_id": "t1"},
            ]
        }
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("ascending", str(ctx.exception))

    def test_load_duplicate_commit_ts_in_chain_rejected(self) -> None:
        data = self._minimal_valid()
        data["commit_ts_counter"] = 1
        data["transactions"] = [
            {
                "txn_id": "t1",
                "state": "committed",
                "snapshot_ts": 0,
                "start_seq": 1,
                "read_set": [],
                "write_set": {},
            }
        ]
        data["versions"] = {
            "a": [
                {"commit_ts": 1, "value": "x", "txn_id": "t1"},
                {"commit_ts": 1, "value": "y", "txn_id": "t1"},
            ]
        }
        self._write_raw(data)
        with self.assertRaises(StorageFormatError):
            MVCCDatabase.load(self.path)

    def test_load_counter_behind_versions_rejected(self) -> None:
        data = self._minimal_valid()
        data["commit_ts_counter"] = 0  # 但版本里已有 commit_ts=5
        data["transactions"] = [
            {
                "txn_id": "t1",
                "state": "committed",
                "snapshot_ts": 0,
                "start_seq": 1,
                "read_set": [],
                "write_set": {},
            }
        ]
        data["versions"] = {
            "a": [{"commit_ts": 5, "value": "x", "txn_id": "t1"}]
        }
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("monotone", str(ctx.exception))

    def test_load_version_referencing_unknown_txn_rejected(self) -> None:
        data = self._minimal_valid()
        data["commit_ts_counter"] = 1
        data["versions"] = {
            "a": [{"commit_ts": 1, "value": "x", "txn_id": "ghost"}]
        }
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("unknown txn_id", str(ctx.exception))

    def test_load_tombstone_with_non_string_value_rejected(self) -> None:
        data = self._minimal_valid()
        data["commit_ts_counter"] = 1
        data["transactions"] = [
            {
                "txn_id": "t1",
                "state": "committed",
                "snapshot_ts": 0,
                "start_seq": 1,
                "read_set": [],
                "write_set": {},
            }
        ]
        data["versions"] = {
            "a": [{"commit_ts": 1, "value": 42, "txn_id": "t1"}]
        }
        self._write_raw(data)
        with self.assertRaises(StorageFormatError) as ctx:
            MVCCDatabase.load(self.path)
        self.assertIn("string or null", str(ctx.exception))


class ErrorHandlingTest(unittest.TestCase):
    """运行时错误处理。"""

    def test_duplicate_txn_id(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        with self.assertRaises(MVCCError):
            db.begin("t1")

    def test_empty_txn_id(self) -> None:
        db = MVCCDatabase()
        with self.assertRaises(MVCCError):
            db.begin("")

    def test_unknown_txn(self) -> None:
        db = MVCCDatabase()
        with self.assertRaises(MVCCError):
            db.get("ghost", "a")
        with self.assertRaises(MVCCError):
            db.commit("ghost")
        with self.assertRaises(MVCCError):
            db.state("ghost")

    def test_operations_after_commit_rejected(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.put("t1", "a", "v")
        db.commit("t1")
        for op in (
            lambda: db.get("t1", "a"),
            lambda: db.put("t1", "b", "v"),
            lambda: db.delete("t1", "a"),
            lambda: db.commit("t1"),
            lambda: db.abort("t1"),
        ):
            with self.assertRaises(MVCCError):
                op()

    def test_operations_after_abort_rejected(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.abort("t1")
        with self.assertRaises(MVCCError):
            db.get("t1", "a")

    def test_delete_nonexistent_key_is_legal(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        db.delete("t1", "nope")
        self.assertTrue(db.commit("t1").committed)
        db.begin("t2")
        self.assertIsNone(db.get("t2", "nope"))

    def test_put_non_string_value_rejected(self) -> None:
        db = MVCCDatabase()
        db.begin("t1")
        with self.assertRaises(MVCCError):
            db.put("t1", "a", 123)  # type: ignore[arg-type]


class CliTest(unittest.TestCase):
    """命令行入口：逐行 JSON 命令。"""

    def run_cli(self, lines: list[str]) -> list[dict]:
        out = io.StringIO()
        main.run(in_stream=io.StringIO("\n".join(lines) + "\n"), out_stream=out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_basic_flow(self) -> None:
        results = self.run_cli(
            [
                '{"cmd": "begin", "txn_id": "t1"}',
                '{"cmd": "put", "txn_id": "t1", "key": "a", "value": "1"}',
                '{"cmd": "commit", "txn_id": "t1"}',
                '{"cmd": "begin", "txn_id": "t2"}',
                '{"cmd": "get", "txn_id": "t2", "key": "a"}',
                '{"cmd": "state", "txn_id": "t1"}',
            ]
        )
        self.assertEqual(results[0], {"ok": True, "txn_id": "t1", "snapshot_ts": 0})
        self.assertEqual(results[1], {"ok": True})
        self.assertEqual(results[2]["status"], "committed")
        self.assertEqual(results[4]["value"], "1")
        self.assertEqual(results[5]["txn"]["state"], "committed")

    def test_conflict_result_shape(self) -> None:
        results = self.run_cli(
            [
                '{"cmd": "begin", "txn_id": "t1"}',
                '{"cmd": "begin", "txn_id": "t2"}',
                '{"cmd": "put", "txn_id": "t1", "key": "a", "value": "1"}',
                '{"cmd": "put", "txn_id": "t2", "key": "a", "value": "2"}',
                '{"cmd": "commit", "txn_id": "t1"}',
                '{"cmd": "commit", "txn_id": "t2"}',
            ]
        )
        self.assertEqual(results[4]["status"], "committed")
        self.assertEqual(results[5]["status"], "aborted")
        self.assertEqual(results[5]["conflicts"], ["a"])

    def test_errors_are_json_and_do_not_stop_processing(self) -> None:
        results = self.run_cli(
            [
                "not json at all",
                '{"cmd": "get", "txn_id": "ghost", "key": "a"}',
                '{"cmd": "bogus"}',
                '{"cmd": "begin", "txn_id": "t1"}',
                '{"cmd": "gc"}',
                '{"cmd": "dump"}',
            ]
        )
        self.assertIn("error", results[0])
        self.assertIn("error", results[1])
        self.assertIn("error", results[2])
        self.assertTrue(results[3]["ok"])
        self.assertEqual(results[4]["collected"], 0)
        self.assertIn("state", results[5])

    def test_save_load_via_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "db.json")
            results = self.run_cli(
                [
                    '{"cmd": "begin", "txn_id": "t1"}',
                    '{"cmd": "put", "txn_id": "t1", "key": "a", "value": "1"}',
                    '{"cmd": "commit", "txn_id": "t1"}',
                    json.dumps({"cmd": "save", "path": path}),
                    json.dumps({"cmd": "load", "path": path}),
                    '{"cmd": "begin", "txn_id": "t2"}',
                    '{"cmd": "get", "txn_id": "t2", "key": "a"}',
                ]
            )
            self.assertTrue(results[3]["ok"])
            self.assertTrue(results[4]["ok"])
            self.assertEqual(results[6]["value"], "1")

    def test_load_bad_file_reports_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as f:
                f.write("{}")
            results = self.run_cli([json.dumps({"cmd": "load", "path": path})])
            self.assertIn("error", results[0])
            self.assertIn("format", results[0]["error"])


if __name__ == "__main__":
    unittest.main()
