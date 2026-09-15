"""快照导出/载入测试：往返一致、损坏拒绝、失败不改变已有状态。"""

import copy
import json
import os
import tempfile
import unittest

from table_kernel.errors import SerializationError
from table_kernel.kernel import TableKernel
from table_kernel.serde import (
    export_snapshot,
    load_snapshot,
    load_snapshot_file,
    save_snapshot,
)

SCHEMA = {"age": "int", "name": "str", "score": "float", "active": "bool"}


def make_rows(n):
    return [{
        "id": f"r{i:05d}",
        "fields": {
            "age": i % 5,
            "name": f"name-{i % 7}",
            "score": i * 0.25,
            "active": i % 2 == 0,
        },
    } for i in range(n)]


def build():
    k = TableKernel(
        SCHEMA, make_rows(60),
        sort=[("age", False), ("name", True)],
        filters=[{"field": "age", "op": "in", "value": [1, 2, 3]},
                 {"field": "name", "op": "contains", "value": "name"}],
        window_size=12, seed=42)
    k.move_to(7)
    return k


class SnapshotRoundtripTest(unittest.TestCase):
    def test_dict_roundtrip(self):
        k = build()
        snap = export_snapshot(k)
        k2 = load_snapshot(copy.deepcopy(snap))
        self.assertEqual(k2.visible_ids(), k.visible_ids())
        self.assertEqual(k2.window, k.window)
        self.assertEqual(k2.stats(), k.stats())
        self.assertEqual(k2.row_count, k.row_count)
        self.assertEqual(k2.visible_count, k.visible_count)
        for rid in k.visible_ids()[:5]:
            self.assertEqual(k2.position_of(rid), k.position_of(rid))
            self.assertEqual(k2.get_row(rid), k.get_row(rid))

    def test_json_string_roundtrip(self):
        k = build()
        text = json.dumps(export_snapshot(k), ensure_ascii=False)
        k2 = load_snapshot(text)
        self.assertEqual(k2.visible_ids(), k.visible_ids())

    def test_file_roundtrip(self):
        k = build()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "snap.json")
            save_snapshot(k, path)
            k2 = load_snapshot_file(path)
        self.assertEqual(k2.visible_ids(), k.visible_ids())
        self.assertEqual(k2.window, k.window)

    def test_empty_rows_roundtrip(self):
        k = TableKernel(SCHEMA, [], sort=[("age", True)],
                        window_size=10)  # 无可见行 -> 窗口挂起
        snap = export_snapshot(k)
        k2 = load_snapshot(snap)
        self.assertEqual(k2.row_count, 0)
        self.assertEqual(k2.visible_ids(), [])
        self.assertIsNotNone(k2.window)

    def test_no_window_roundtrip(self):
        k = TableKernel(SCHEMA, make_rows(10))
        self.assertIsNone(k.window)
        k2 = load_snapshot(export_snapshot(k))
        self.assertIsNone(k2.window)


def _must_fail(snap, mutator):
    s = copy.deepcopy(snap)
    mutator(s)
    try:
        load_snapshot(s)
    except SerializationError:
        return
    raise AssertionError("应当拒绝损坏快照")


class SnapshotCorruptionTest(unittest.TestCase):
    def setUp(self):
        self.snap = export_snapshot(build())

    def test_missing_top_level(self):
        for key in ("version", "schema", "rows", "sort", "filters",
                    "window"):
            s = copy.deepcopy(self.snap)
            del s[key]
            with self.assertRaises(SerializationError):
                load_snapshot(s)

    def test_not_dict_or_bad_json(self):
        with self.assertRaises(SerializationError):
            load_snapshot([1, 2, 3])
        with self.assertRaises(SerializationError):
            load_snapshot("{not json")
        with self.assertRaises(SerializationError):
            load_snapshot(b"\xff\xfe garbage")

    def test_bad_version(self):
        _must_fail(self.snap, lambda s: s.__setitem__("version", 2))
        _must_fail(self.snap, lambda s: s.__setitem__("version", "1"))

    def test_schema_corruption(self):
        _must_fail(self.snap, lambda s: s["schema"].append(
            {"name": "age", "type": "int"}))               # 字段重名
        _must_fail(self.snap, lambda s: s["schema"][0].__setitem__(
            "type", "bigint"))                             # 类型非法
        _must_fail(self.snap, lambda s: s.__setitem__(
            "schema", []))                                 # 空 schema
        _must_fail(self.snap, lambda s: s["schema"].__setitem__(0, "age"))

    def test_rows_corruption(self):
        # 重复标识
        _must_fail(self.snap, lambda s: s["rows"].append(
            copy.deepcopy(s["rows"][0])))
        # 字段类型非法
        _must_fail(self.snap, lambda s:
                   s["rows"][0]["fields"].__setitem__("age", "old"))
        # bool 混入 int
        _must_fail(self.snap, lambda s:
                   s["rows"][1]["fields"].__setitem__("age", True))
        # 缺字段
        _must_fail(self.snap, lambda s:
                   s["rows"][0]["fields"].pop("name"))
        # 多余字段
        _must_fail(self.snap, lambda s:
                   s["rows"][0]["fields"].__setitem__("extra", 1))
        # 缺 id / fields
        _must_fail(self.snap, lambda s: s["rows"].append(
            {"fields": {"age": 1, "name": "n", "score": 1.0,
                        "active": True}}))
        _must_fail(self.snap, lambda s: s["rows"].append(
            {"id": "newx"}))
        # 非字符串 id
        _must_fail(self.snap, lambda s: s["rows"].append(
            {"id": 7, "fields": {"age": 1, "name": "n", "score": 1.0,
                                 "active": True}}))

    def test_non_finite_float_rejected(self):
        import math

        def mutate(s):
            s["rows"][0]["fields"]["score"] = math.nan
        _must_fail(self.snap, mutate)
        _must_fail(self.snap,
                   lambda s: s["rows"][0]["fields"].__setitem__(
                       "score", math.inf))

    def test_rules_corruption(self):
        _must_fail(self.snap, lambda s:
                   s["sort"][0].__setitem__("field", "ghost"))
        _must_fail(self.snap, lambda s:
                   s["sort"].append({"field": "age", "asc": False}))
        _must_fail(self.snap, lambda s:
                   s["sort"][0].__setitem__("asc", "yes"))
        _must_fail(self.snap, lambda s:
                   s["filters"][0].__setitem__("op", "bogus"))
        _must_fail(self.snap, lambda s:
                   s["filters"][0].__setitem__("field", "ghost"))
        _must_fail(self.snap, lambda s:
                   s["filters"][0].__setitem__("value", "not-a-list"))
        _must_fail(self.snap, lambda s:
                   s["filters"].append(
                       {"field": "age", "op": "lt", "value": "young"}))
        _must_fail(self.snap, lambda s:
                   s["filters"].__setitem__(
                       0, {"field": "active", "op": "lt", "value": True}))
        _must_fail(self.snap, lambda s:
                   s["filters"].__setitem__(
                       0, {"field": "score", "op": "lt", "value": "heavy"}))

    def test_window_corruption(self):
        _must_fail(self.snap, lambda s:
                   s["window"].__setitem__("size", 0))
        _must_fail(self.snap, lambda s:
                   s["window"].__setitem__("start", -1))
        _must_fail(self.snap, lambda s:
                   s["window"].__setitem__("start", 10 ** 9))
        _must_fail(self.snap, lambda s:
                   s["window"].pop("size"))

    def test_stats_corruption(self):
        _must_fail(self.snap, lambda s:
                   s["stats"].__setitem__("rows_inserted", -1))
        _must_fail(self.snap, lambda s:
                   s["stats"].__setitem__("unknown_counter", 3))
        # 非必需字段缺失不影响载入
        s = copy.deepcopy(self.snap)
        del s["stats"]
        k = load_snapshot(s)
        self.assertEqual(k.stats()["rows_inserted"], 0)

    def test_collected_errors_reference_positions(self):
        s = copy.deepcopy(self.snap)
        s["window"] = {"start": -5, "size": 0}
        s["seed"] = -1
        with self.assertRaises(SerializationError) as cm:
            load_snapshot(s)
        self.assertIn("window.start", str(cm.exception))
        self.assertIn("window.size", str(cm.exception))
        self.assertIn("seed", str(cm.exception))

    def test_failed_load_leaves_existing_kernel_untouched(self):
        k = build()
        before = k.visible_ids()
        window_before = k.window
        with self.assertRaises(SerializationError):
            load_snapshot({"version": 1})  # 缺字段
        self.assertEqual(k.visible_ids(), before)
        self.assertEqual(k.window, window_before)
        with self.assertRaises(SerializationError):
            load_snapshot_file("definitely-missing-file.json")
        self.assertEqual(k.visible_ids(), before)


if __name__ == "__main__":
    unittest.main()
