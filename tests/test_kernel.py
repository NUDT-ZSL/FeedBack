"""内核功能测试：校验拒绝、稳定排序、筛选、窗口、查询、原子性。"""

import unittest

from table_kernel.errors import (
    BatchValidationError,
    RuleError,
    UnknownRowError,
    ValidationError,
    WindowError,
)
from table_kernel.kernel import Filter, RowFilteredError, SortSpec, TableKernel


def make_rows(n, seed=0):
    """生成 n 行：age 故意大量重复以触发平局，name 字符串，score 浮点。"""
    rows = []
    for i in range(n):
        rows.append({
            "id": f"r{i:05d}",
            "fields": {
                "age": i % 4,
                "name": f"name-{i % 11}",
                "score": (i * 7) % 13 + 0.5,
                "active": (i % 3 == 0),
            },
        })
    return rows


SCHEMA = {"age": "int", "name": "str", "score": "float", "active": "bool"}


class KernelBasicTest(unittest.TestCase):
    def test_reject_duplicate_ids_and_bad_types_with_positions(self):
        rows = [
            {"id": "r1", "fields": {"age": 1, "name": "a",
                                    "score": 1.0, "active": True}},
            {"id": "r2", "fields": {"age": "x", "name": "b",
                                    "score": 2.0, "active": False}},
            {"id": "r1", "fields": {"age": 3, "name": "c",
                                    "score": 3.0, "active": True}},
            {"id": "r4", "fields": {"age": 4, "name": 5,
                                    "score": 4.0, "active": True}},
            {"id": "r5", "fields": {"age": 5, "name": "e",
                                    "score": True, "active": True}},
        ]
        with self.assertRaises(BatchValidationError) as cm:
            TableKernel(SCHEMA, rows)
        positions = sorted(e.index for e in cm.exception.errors)
        self.assertEqual(positions, [1, 2, 3, 4])
        paths = {e.index: e.path for e in cm.exception.errors}
        self.assertEqual(paths[1], "age")
        self.assertEqual(paths[2], "id")
        self.assertEqual(paths[3], "name")
        self.assertEqual(paths[4], "score")

    def test_missing_fields_and_malformed_rows(self):
        rows = [
            {"fields": {"age": 1, "name": "a", "score": 1.0, "active": True}},
            {"id": "r2"},
            "not-a-dict",
        ]
        with self.assertRaises(BatchValidationError) as cm:
            TableKernel(SCHEMA, rows)
        self.assertEqual({e.index for e in cm.exception.errors}, {0, 1, 2})

    def test_stable_sort_tie_break_by_id(self):
        # 全部 age 相同；不传排序规则时只按 id 字典序
        rows = make_rows(20)
        k = TableKernel(SCHEMA, rows)
        ids = [k._full_treap.kth_payload(i).id for i in range(len(rows))]
        self.assertEqual(ids, sorted(r["id"] for r in rows))

        # 单键 age 升序，平局按 id 字典序
        k2 = TableKernel(SCHEMA, rows, sort=[("age", True)])
        ref = sorted((r["fields"]["age"], r["id"]) for r in rows)
        got = [(k2._full_treap.kth_payload(i).values["age"],
                k2._full_treap.kth_payload(i).id) for i in range(len(rows))]
        self.assertEqual(got, ref)

        # age 降序，平局仍按 id 字典序（升序）
        k3 = TableKernel(SCHEMA, rows, sort=[SortSpec("age", False)])
        ref3 = sorted((( -r["fields"]["age"], r["id"]) for r in rows))
        got3 = [(k3._full_treap.kth_payload(i).values["age"],
                 k3._full_treap.kth_payload(i).id) for i in range(len(rows))]
        self.assertEqual(got3, [(-a, i) for a, i in ref3])

        # 多键：age 升序、name 降序，平局按 id
        k4 = TableKernel(SCHEMA, rows,
                         sort=[("age", True), ("name", False)])
        ref4 = sorted(rows, key=lambda r: (r["fields"]["age"],
                                           _neg_str(r["fields"]["name"]),
                                           r["id"]))
        got4 = [k4._full_treap.kth_payload(i).id for i in range(len(rows))]
        self.assertEqual(got4, [r["id"] for r in ref4])

    def test_invalid_sort_and_filter_rules(self):
        rows = make_rows(5)
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows, sort=[{"field": "ghost", "asc": True}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows, sort=[{"field": "age", "asc": "yes"}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows, sort=[("age", True), ("age", False)])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "ghost", "op": "eq", "value": 1}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "age", "op": "bogus", "value": 1}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "age", "op": "lt", "value": "1"}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "active", "op": "lt",
                                  "value": True}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "age", "op": "in", "value": 1}])
        with self.assertRaises(ValidationError):
            TableKernel(SCHEMA, rows,
                        filters=[{"field": "age", "op": "contains",
                                  "value": "1"}])
        # 直接构造 Filter/错误操作符
        with self.assertRaises(RuleError):
            Filter("age", "bogus", 1)

    def test_filter_operators(self):
        rows = make_rows(40)
        specs = [
            [("age", "eq", 1)],
            [("age", "ne", 0)],
            [("age", "lt", 2)],
            [("age", "le", 2)],
            [("age", "gt", 1)],
            [("age", "ge", 2)],
            [("age", "in", [1, 3])],
            [("age", "not_in", [0, 2])],
            [("name", "contains", "name-1")],
            [("age", "ge", 1), ("active", "eq", True)],
        ]
        for fspecs in specs:
            k = TableKernel(SCHEMA, rows, filters=[
                {"field": f, "op": op, "value": v}
                for f, op, v in fspecs])
            expected = [r["id"] for r in sorted(rows, key=lambda r: r["id"])
                        if _py_filter(r, fspecs)]
            got = [p.id for p in k._visible_treap.iter_payloads()]
            self.assertEqual(got, expected, fspecs)


def _neg_str(s):
    class _N:
        def __init__(self, v):
            self.v = v

        def __lt__(self, o):
            return self.v > o.v

    return _N(s)


def _py_filter(row, specs):
    for f, op, v in specs:
        x = row["fields"][f]
        if op == "eq" and not x == v:
            return False
        if op == "ne" and not x != v:
            return False
        if op == "lt" and not x < v:
            return False
        if op == "le" and not x <= v:
            return False
        if op == "gt" and not x > v:
            return False
        if op == "ge" and not x >= v:
            return False
        if op == "in" and x not in v:
            return False
        if op == "not_in" and x in v:
            return False
        if op == "contains" and v not in x:
            return False
    return True


class WindowTest(unittest.TestCase):
    def setUp(self):
        self.rows = make_rows(200)
        self.k = TableKernel(SCHEMA, self.rows,
                             sort=[("age", True)],
                             filters=[("age", "ge", 1)],
                             window_size=20)

    def test_window_matches_reference_everywhere(self):
        for start in range(0, self.k.visible_count - 20 + 1, 7):
            self.k.move_to(start)
            self.assertEqual(self.k.visible_ids(),
                             self.k.reference_visible(start, 20))

    def test_window_matches_resize_and_scroll(self):
        self.k.set_window(10, 30)
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(10, 30))
        self.k.scroll(-5)
        self.assertEqual(self.k.window, (5, 30))
        self.k.resize(12)
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(5, 12))

    def test_invalid_window_rejected_atomically(self):
        self.k.set_window(10, 20)
        before = self.k.visible_ids()
        w = self.k.window
        total = self.k.visible_count
        for bad in [(-1, 20), (0, 0), (0, -5), (total - 19, 20),
                    (total, 1), (10, total + 1 - 10), (1.0, 20),
                    (10, True)]:
            with self.assertRaises(WindowError):
                self.k.set_window(*bad)
            self.assertEqual(self.k.window, w)
            self.assertEqual(self.k.visible_ids(), before)
        # scroll 越界同样原子
        with self.assertRaises(WindowError):
            self.k.scroll(-1000)
        self.assertEqual(self.k.window, w)
        self.assertEqual(self.k.visible_ids(), before)

    def test_window_required_before_query(self):
        k = TableKernel(SCHEMA, make_rows(5))
        with self.assertRaises(WindowError):
            k.visible_ids()
        with self.assertRaises(WindowError):
            k.move_to(0)
        k.set_window(0, 3)
        self.assertEqual(len(k.visible_ids()), 3)

    def test_window_at_is_state_free(self):
        self.k.set_window(0, 10)
        ids = self.k.window_at(50, 15)
        self.assertEqual(ids, self.k.reference_visible(50, 15))
        self.assertEqual(self.k.window, (0, 10))  # 未改变
        with self.assertRaises(WindowError):
            self.k.window_at(0, 0)

    def test_visible_rows_content(self):
        rows_out = self.k.visible_rows()
        self.assertEqual([r["id"] for r in rows_out], self.k.visible_ids())
        for r in rows_out:
            self.assertEqual(set(r["fields"]),
                             {"age", "name", "score", "active"})


class PositionQueryTest(unittest.TestCase):
    def setUp(self):
        self.rows = make_rows(120)
        self.k = TableKernel(SCHEMA, self.rows,
                             sort=[("age", False), ("name", True)],
                             filters=[("age", "in", [1, 2, 3])],
                             window_size=10)

    def test_position_consistent_with_order(self):
        ordered = list(self.k._visible_treap.iter_payloads())
        for i, row in enumerate(ordered):
            self.assertEqual(self.k.position_of(row.id), i)
        # full_position 忽略筛选
        full_ordered = list(self.k._full_treap.iter_payloads())
        for i, row in enumerate(full_ordered):
            self.assertEqual(self.k.full_position_of(row.id), i)

    def test_filtered_and_unknown_row(self):
        filtered = [r["id"] for r in self.rows
                    if r["fields"]["age"] == 0]
        self.assertTrue(filtered)
        with self.assertRaises(RowFilteredError):
            self.k.position_of(filtered[0])
        self.assertFalse(self.k.is_visible(filtered[0]))
        with self.assertRaises(UnknownRowError):
            self.k.position_of("ghost")
        with self.assertRaises(UnknownRowError):
            self.k.is_visible("ghost")
        with self.assertRaises(UnknownRowError):
            self.k.get_row("ghost")

    def test_in_window(self):
        self.k.set_window(30, 15)
        ids = self.k.visible_ids()
        for i, rid in enumerate(ids):
            self.assertTrue(self.k.in_window(rid))
        self.k.move_to(50)
        for rid in ids[:5]:
            self.assertFalse(self.k.in_window(rid))
        with self.assertRaises(UnknownRowError):
            self.k.in_window("nope")


class IncrementalTest(unittest.TestCase):
    def setUp(self):
        self.rows = make_rows(150)
        self.k = TableKernel(SCHEMA, self.rows,
                             sort=[("age", True), ("name", True)],
                             window_size=20)
        self.k.set_window(40, 20)

    def test_add_rows_incremental_matches_reference(self):
        new_rows = [
            {"id": "z-new1", "fields": {"age": 1, "name": "name-1",
                                        "score": 9.0, "active": True}},
            {"id": "a-new2", "fields": {"age": 0, "name": "name-0",
                                        "score": 8.0, "active": False}},
            {"id": "m-new3", "fields": {"age": 3, "name": "name-9",
                                        "score": 2.0, "active": True}},
        ]
        self.k.add_rows(new_rows)
        start, size = self.k.window
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(start, size))
        self.assertEqual(self.k.row_count, 153)
        self.assertEqual(self.k.position_of("z-new1"),
                         self.k.reference_visible(0, self.k.visible_count)
                         .index("z-new1"))

    def test_add_rows_batch_atomic_failure(self):
        before_ids = self.k.visible_ids()
        before_count = self.k.row_count
        bad = [
            {"id": "ok-new", "fields": {"age": 1, "name": "n",
                                        "score": 1.0, "active": True}},
            {"id": "ok-new", "fields": {"age": 1, "name": "n",
                                        "score": 1.0, "active": True}},
            {"id": "r00001", "fields": {"age": 1, "name": "n",
                                        "score": 1.0, "active": True}},
            {"id": "bad-type", "fields": {"age": "x", "name": "n",
                                          "score": 1.0, "active": True}},
        ]
        with self.assertRaises(BatchValidationError) as cm:
            self.k.add_rows(bad)
        self.assertGreaterEqual(len(cm.exception.errors), 3)
        self.assertEqual(self.k.row_count, before_count)
        self.assertNotIn("ok-new", self.k.rows)
        self.assertEqual(self.k.visible_ids(), before_ids)

    def test_remove_rows_incremental(self):
        victims = self.k.reference_visible(0, self.k.visible_count)[:30]
        self.k.remove_rows(victims)
        start, size = self.k.window
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(start, size))
        for v in victims:
            with self.assertRaises(UnknownRowError):
                self.k.position_of(v)

    def test_remove_unknown_atomic(self):
        before = self.k.visible_ids()
        with self.assertRaises(BatchValidationError):
            self.k.remove_rows(["r00001", "ghost", "r00001"])
        self.assertEqual(self.k.visible_ids(), before)
        self.assertIn("r00001", self.k.rows)

    def test_remove_accepts_tuple_and_rejects_scalar(self):
        victims = tuple(self.k.reference_visible(0, 5))
        self.k.remove_rows(victims)
        for rid in victims:
            self.assertNotIn(rid, self.k.rows)
        with self.assertRaises(ValidationError):
            self.k.remove_rows("r00010")

    def test_reject_non_finite_float(self):
        import math
        before = self.k.row_count
        with self.assertRaises(BatchValidationError):
            self.k.add_rows([{"id": "nan-row", "fields": {
                "age": 1, "name": "n", "score": math.nan,
                "active": True}}])
        self.assertEqual(self.k.row_count, before)

    def test_visible_rows_relative_order_unchanged(self):
        """窗口内此前已可见的行，增删窗口外的行后相对顺序不得跳动。"""
        ids_before = self.k.visible_ids()
        # 在可见树头部、尾部插入若干不进入当前窗口的行
        self.k.set_window(60, 20)
        head_ids = self.k.visible_ids()
        outside = [
            {"id": f"zzz-{i}", "fields": {"age": 3, "name": f"name-{i%3}",
                                          "score": 1.0, "active": False}}
            for i in range(10)
        ]
        self.k.add_rows(outside)  # 排在很后面，窗口不动
        self.assertEqual(self.k.window[0], 60)
        ids_after = self.k.visible_ids()
        still = [i for i in head_ids if i in set(ids_after)]
        self.assertEqual(still, [i for i in ids_after if i in set(head_ids)])

        # 删除窗口外的行不影响窗口内行的相对顺序
        victims = [r["id"] for r in self.rows[:40]]
        self.k.remove_rows(victims)
        a = self.k.visible_ids()
        # 被删除的行本来就不在窗口 [60,80) 内（删的是排名前段，窗口会
        # 回收到新边界）；检查未删除行彼此相对顺序
        self.assertEqual(a, self.k.reference_visible(*self.k.window))

    def test_sort_change_window_content_matches(self):
        self.k.set_sort([("name", True), ("age", False)])
        start, size = self.k.window
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(start, size))
        # 非法排序规则不改变状态
        with self.assertRaises(ValidationError):
            self.k.set_sort([("ghost", True)])
        self.assertEqual(
            [s.field for s in self.k.sort_specs], ["name", "age"])

    def test_filter_change_incremental(self):
        ids_before = self.k.visible_ids()
        self.k.set_filters([("age", "eq", 2)])
        start, size = self.k.window
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(start, size))
        self.assertTrue(all(self.k.get_row(i)["fields"]["age"] == 2
                            for i in self.k.visible_ids()))
        # 非法筛选不改变状态
        with self.assertRaises(ValidationError):
            self.k.set_filters([("age", "lt", "bad")])
        self.assertEqual(len(self.k.filters), 1)
        # 清空筛选
        self.k.set_filters([])
        start, size = self.k.window
        self.assertEqual(self.k.visible_ids(),
                         self.k.reference_visible(start, size))

    def test_window_clamps_at_tail(self):
        k = TableKernel(SCHEMA, make_rows(100), window_size=30)
        k.set_window(70, 30)  # 正好贴尾
        # 删除最后 40 行 -> 可见行不足，窗口回退
        all_ids = sorted(r["id"] for r in make_rows(100))
        k.remove_rows(all_ids[-40:])
        self.assertLessEqual(k.window[0] + k.window[1], k.visible_count)
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(*k.window))
        self.assertGreaterEqual(k.stats()["window_clamps"], 1)

    def test_window_suspended_when_no_visible_rows(self):
        k = TableKernel(SCHEMA, make_rows(10), window_size=5)
        self.assertEqual(k.window, (0, 5))
        k.set_filters([("age", "eq", 99)])
        self.assertEqual(k.visible_count, 0)
        self.assertEqual(k.visible_ids(), [])
        self.assertIsNotNone(k.window)  # 窗口挂起，不销毁
        # 恢复筛选后自动挂接
        k.set_filters([])
        self.assertEqual(k.visible_ids(), k.reference_visible(0, 5))

    def test_stats_monotonic_counters(self):
        s = self.k.stats()
        for key in ("full_rebuilds", "visible_rebuilds", "rows_inserted",
                    "rows_removed", "window_moves", "window_resizes",
                    "window_refreshes", "window_clamps"):
            self.assertIn(key, s)
            self.assertIsInstance(s[key], int)


if __name__ == "__main__":
    unittest.main()
