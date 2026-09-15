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


def assert_kernel_state_equal(testcase, a, b):
    """导出/载入前后做一次全量比对：行集合、规则、窗口、可见序列、统计。"""
    # 行集合与字段逐行一致
    testcase.assertEqual(a.row_count, b.row_count)
    for rid in a.rows:
        testcase.assertEqual(b.get_row(rid), a.get_row(rid))
    # 排序 / 筛选规则一致
    testcase.assertEqual([(s.field, s.asc) for s in a.sort_specs],
                         [(s.field, s.asc) for s in b.sort_specs])
    testcase.assertEqual(
        [(f.field, f.op, json.dumps(f.value, sort_keys=True))
         for f in a.filters],
        [(f.field, f.op, json.dumps(f.value, sort_keys=True))
         for f in b.filters])
    # 窗口状态与可见序列一致（含挂起窗口：window 非空但可见行为 0）
    testcase.assertEqual(a.window, b.window)
    testcase.assertEqual(a.visible_count, b.visible_count)
    if a.window is not None:
        testcase.assertEqual(a.visible_ids(), b.visible_ids())
    # 每个存在行的位置/命中结果一致
    for rid in a.rows:
        testcase.assertEqual(a.is_visible(rid), b.is_visible(rid))
        if a.is_visible(rid):
            testcase.assertEqual(a.position_of(rid), b.position_of(rid))
        testcase.assertEqual(a.in_window(rid), b.in_window(rid))
    # 增量统计一致
    testcase.assertEqual(a.stats(), b.stats())


class SnapshotRoundtripTest(unittest.TestCase):
    def test_dict_roundtrip_full_equality(self):
        k = build()
        snap = export_snapshot(k)
        k2 = load_snapshot(copy.deepcopy(snap))
        assert_kernel_state_equal(self, k, k2)

    def test_roundtrip_survives_further_incremental_ops(self):
        k = build()
        k2 = load_snapshot(export_snapshot(k))
        # 载入后继续增量操作，两边结果必须仍逐行一致
        extra = make_rows(5)
        for r in extra:
            r["id"] = "extra-" + r["id"]
        k.add_rows(extra)
        k2.add_rows(copy.deepcopy(extra))
        k.move_to(3)
        k2.move_to(3)
        assert_kernel_state_equal(self, k, k2)

    def test_json_string_roundtrip(self):
        k = build()
        text = json.dumps(export_snapshot(k), ensure_ascii=False)
        k2 = load_snapshot(text)
        self.assertEqual(k2.visible_ids(), k.visible_ids())
        self.assertEqual(k2.window, k.window)

    def test_file_roundtrip(self):
        k = build()
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "snap.json")
            save_snapshot(k, path)
            k2 = load_snapshot_file(path)
        assert_kernel_state_equal(self, k, k2)

    def test_empty_rows_roundtrip_preserves_window_rules_stats(self):
        """空行快照往返：窗口、排序筛选规则、统计必须与导出前完全一致。"""
        cases = [
            ([], []),
            ([("age", True)], []),
            ([("age", False), ("name", True)],
             [{"field": "age", "op": "ge", "value": 0}]),
            ([], [{"field": "active", "op": "eq", "value": True}]),
            ([("score", True)],
             [{"field": "age", "op": "in", "value": [1, 2, 3]}]),
        ]
        for sort, filters in cases:
            with self.subTest(sort=sort, filters=filters):
                k = TableKernel(SCHEMA, [], sort=sort, filters=filters,
                                window_size=10)
                # 构造即产生初始构建计数；载入必须还原这些统计
                self.assertIsNotNone(k.window)  # 空数据窗口挂起保留
                k2 = load_snapshot(export_snapshot(k))
                assert_kernel_state_equal(self, k, k2)
                # 挂起窗口查询返回空区间
                self.assertEqual(k2.visible_ids(), [])

    def test_empty_rows_roundtrip_reattaches_after_add(self):
        """空行快照载入后补数据，窗口应自动挂接且与未经历往返的内核一致。"""
        sort = [("age", False), ("name", True)]
        filters = [{"field": "age", "op": "ge", "value": 1}]
        k = TableKernel(SCHEMA, [], sort=sort, filters=filters,
                        window_size=10)
        k2 = load_snapshot(export_snapshot(k))
        new_rows = make_rows(25)
        k.add_rows(copy.deepcopy(new_rows))
        k2.add_rows(copy.deepcopy(new_rows))
        assert_kernel_state_equal(self, k, k2)
        self.assertEqual(len(k2.visible_ids()), 10)
        # 空数据的挂起窗口尺寸大于将来可见行数时，挂接时应收口到合法区间
        permissive = [{"field": "age", "op": "ge", "value": 0}]
        k3 = TableKernel(SCHEMA, [], sort=sort, filters=permissive,
                         window_size=100)
        k4 = load_snapshot(export_snapshot(k3))
        tiny = make_rows(3)
        k3.add_rows(copy.deepcopy(tiny))
        k4.add_rows(copy.deepcopy(tiny))
        assert_kernel_state_equal(self, k3, k4)
        self.assertEqual(k4.window, (0, 3))  # 尺寸 100 收口到可见行数 3

    def test_suspended_window_via_filters_roundtrip(self):
        """有行但筛选后为空（挂起窗口，start 非零）的往返一致。"""
        k = TableKernel(SCHEMA, make_rows(20),
                        sort=[("age", True)], window_size=5)
        k.move_to(10)
        k.set_filters([{"field": "age", "op": "eq", "value": 999}])
        self.assertEqual(k.visible_count, 0)
        self.assertIsNotNone(k.window)
        k2 = load_snapshot(export_snapshot(k))
        assert_kernel_state_equal(self, k, k2)
        # 恢复筛选后窗口重新挂接，两边一致
        k.set_filters([])
        k2.set_filters([])
        assert_kernel_state_equal(self, k, k2)

    def test_no_window_roundtrip(self):
        k = TableKernel(SCHEMA, make_rows(10))
        self.assertIsNone(k.window)
        k2 = load_snapshot(export_snapshot(k))
        assert_kernel_state_equal(self, k, k2)
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

    def test_structural_self_consistency_corruption(self):
        """结构自洽性被破坏：多余/未知键、显式 null、空串、非整数窗口。"""
        # 各对象上的未知/多余键（静默丢弃会导致载入后状态与导出前不一致）
        _must_fail(self.snap,
                   lambda s: s.__setitem__("unknown_top", 123))
        _must_fail(self.snap,
                   lambda s: s["schema"][0].__setitem__("extra", 1))
        _must_fail(self.snap,
                   lambda s: s["rows"][0].__setitem__("meta", 1))
        _must_fail(self.snap,
                   lambda s: s["sort"][0].__setitem__("extra_kw", 1))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("extra_kw", 1))
        _must_fail(self.snap,
                   lambda s: s["window"].__setitem__("anchor", 0))
        # 各对象缺键（与多余键同属键集合不自洽）
        _must_fail(self.snap,
                   lambda s: s["schema"][0].pop("name"))
        _must_fail(self.snap,
                   lambda s: s["sort"][0].pop("asc"))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].pop("value"))
        _must_fail(self.snap,
                   lambda s: s["window"].pop("start"))
        # 显式 null（与键缺失区别对待，但同样必须拒绝）
        _must_fail(self.snap,
                   lambda s: s["sort"][0].__setitem__("asc", None))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("value", None))
        # 空字符串
        _must_fail(self.snap,
                   lambda s: s["schema"][0].__setitem__("type", ""))
        _must_fail(self.snap,
                   lambda s: s["rows"][0].__setitem__("id", ""))
        # 窗口坐标必须是整数（拒绝浮点与布尔）
        _must_fail(self.snap,
                   lambda s: s["window"].__setitem__("start", 1.5))
        _must_fail(self.snap,
                   lambda s: s["window"].__setitem__("size", 2.0))
        _must_fail(self.snap,
                   lambda s: s["window"].__setitem__("size", True))
        # 容器类型错误
        _must_fail(self.snap, lambda s: s.__setitem__("rows", None))
        _must_fail(self.snap, lambda s: s.__setitem__("rows", {}))
        _must_fail(self.snap, lambda s: s.__setitem__("sort", None))
        _must_fail(self.snap, lambda s: s.__setitem__("filters", {}))
        _must_fail(self.snap, lambda s: s.__setitem__("window", "0,10"))
        # 字段名/操作符为不可哈希或非字符串（历史缺陷：曾抛原始 TypeError）
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("field", ["age"]))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("field", None))
        _must_fail(self.snap,
                   lambda s: s["sort"][0].__setitem__("field", ["age"]))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("op", None))
        _must_fail(self.snap,
                   lambda s: s["window"].__setitem__("start", None))
        # seed / stats 非法
        _must_fail(self.snap, lambda s: s.__setitem__("seed", -1))
        _must_fail(self.snap, lambda s: s.__setitem__("seed", "x"))
        _must_fail(self.snap, lambda s: s.__setitem__("seed", None))
        _must_fail(self.snap, lambda s: s.__setitem__("stats", []))

    def test_filter_value_type_self_consistency(self):
        """筛选值与字段类型不自洽必须在载入阶段拒绝并给出位置。"""
        # in 的值必须是数组，数组元素类型也要与字段匹配
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("value", 1))
        _must_fail(self.snap,
                   lambda s: s["filters"][0].__setitem__("value", [1, "x"]))
        # contains 值必须是字符串
        _must_fail(self.snap,
                   lambda s: s["filters"][1].__setitem__("value", 5))
        # 标量比较值类型必须匹配字段
        _must_fail(self.snap, lambda s: s["filters"].__setitem__(
            0, {"field": "score", "op": "lt", "value": "heavy"}))
        # 布尔字段不支持次序操作
        _must_fail(self.snap, lambda s: s["filters"].__setitem__(
            0, {"field": "active", "op": "lt", "value": True}))
        # contains 不能用于数值字段
        _must_fail(self.snap, lambda s: s["filters"].__setitem__(
            0, {"field": "age", "op": "contains", "value": "1"}))

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
        untouched = build()  # 同一种子同输入，构造确定
        before = k.visible_ids()
        window_before = k.window
        with self.assertRaises(SerializationError):
            load_snapshot({"version": 1})  # 缺字段
        self.assertEqual(k.visible_ids(), before)
        self.assertEqual(k.window, window_before)
        with self.assertRaises(SerializationError):
            load_snapshot_file("definitely-missing-file.json")
        self.assertEqual(k.visible_ids(), before)

    def test_rejection_of_corruption_never_touches_live_kernel(self):
        """对每一类损坏快照尝试载入到同一个存活内核上，拒绝后内核必须
        与从未尝试过载入的对照内核逐字段一致（行集合/可见序列/窗口）。"""
        corruptors = [
            lambda s: s.pop("rows"),
            lambda s: s.__setitem__("unknown_top", 1),
            lambda s: s["rows"][0]["fields"].__setitem__("age", "x"),
            lambda s: s["rows"].append(copy.deepcopy(s["rows"][0])),
            lambda s: s["sort"][0].__setitem__("field", "ghost"),
            lambda s: s["sort"][0].__setitem__("asc", None),
            lambda s: s["sort"][0].__setitem__("extra", 1),
            lambda s: s["filters"][0].__setitem__("op", "bogus"),
            lambda s: s["filters"][0].__setitem__("value", 1),
            lambda s: s["window"].__setitem__("start", 10 ** 9),
            lambda s: s["window"].__setitem__("size", 0),
            lambda s: s["window"].__setitem__("anchor", 0),
            lambda s: s["stats"].__setitem__("rows_inserted", -1),
            lambda s: s["schema"].__setitem__(0, "age"),
        ]
        for corrupt in corruptors:
            k = build()
            ref = build()
            s = copy.deepcopy(self.snap)
            corrupt(s)
            with self.assertRaises(SerializationError):
                load_snapshot(s)
            # 载入失败只返回新对象，绝不触碰 k；全量比对确认无变化
            assert_kernel_state_equal(self, k, ref)
        # JSON 解析失败同样零影响
        k = build()
        ref = build()
        with self.assertRaises(SerializationError):
            load_snapshot("{broken")
        assert_kernel_state_equal(self, k, ref)

    def test_error_message_is_locatable(self):
        """损坏原因必须带可定位路径。"""
        cases = [
            (lambda s: s["rows"][3]["fields"].__setitem__("age", "x"),
             "rows[3]"),
            (lambda s: s["sort"][1].__setitem__("field", "ghost"),
             "sort[1]"),
            (lambda s: s["filters"][0].__setitem__("value", [1, "x"]),
             "filters[0].value[1]"),
            (lambda s: s["window"].__setitem__("size", 0),
             "window.size"),
        ]
        for corrupt, needle in cases:
            s = copy.deepcopy(self.snap)
            corrupt(s)
            try:
                load_snapshot(s)
            except SerializationError as e:
                self.assertIn(needle, str(e),
                              f"错误信息缺少定位 {needle}: {e}")
            else:
                self.fail(f"{needle} 损坏应当被拒绝")


if __name__ == "__main__":
    unittest.main()
