"""PlanExecutor 的离线验收测试（标准库 unittest）。"""

import unittest

from plan_executor import PlanError, PlanExecutor


def make_catalog():
    return {
        "users": [
            {"id": 1, "name": "a", "age": 30, "city": "bj", "score": 10},
            {"id": 2, "name": "b", "age": 25, "city": "sh", "score": 20},
            {"id": 3, "name": "c", "age": 35, "city": "bj", "score": 15},
            {"id": 4, "name": "d", "age": 28, "city": "sh", "score": 30},
            {"id": 5, "name": "e", "age": 40, "city": "bj", "score": 25},
        ],
        "nums": [
            {"g": "x", "v": 1},
            {"g": "x", "v": 2},
            {"g": "y", "v": 3},
            {"g": "y", "v": 4},
        ],
        "floats": [
            {"v": 1.5},
            {"v": 2.5},
        ],
        "empty": [],
    }


def collect_all(executor, first_page, batch_size=2):
    """从第一页开始把后续页全部拼起来。"""
    rows = list(first_page["rows"])
    page = first_page
    while not page["done"]:
        self_page = executor.fetch(page["next_cursor"], batch_size)
        rows.extend(self_page["rows"])
        page = self_page
    return rows


class TestEndToEnd(unittest.TestCase):
    def test_nested_plan_filter_project_sort_limit(self):
        plan = {
            "op": "limit",
            "limit": 2,
            "children": [
                {
                    "op": "sort",
                    "keys": [{"column": "years", "desc": True}, "id"],
                    "children": [
                        {
                            "op": "project",
                            "columns": ["id", "name", {"column": "age", "as": "years"}],
                            "children": [
                                {
                                    "op": "filter",
                                    "predicate": {
                                        "and": [
                                            {"col": "age", "op": "ge", "value": 28},
                                            {"col": "city", "op": "eq", "value": "bj"},
                                        ]
                                    },
                                    "children": [
                                        {"op": "scan", "table": "users", "children": []}
                                    ],
                                }
                            ],
                        }
                    ],
                }
            ],
        }
        page = PlanExecutor(make_catalog()).execute(plan)
        self.assertTrue(page["done"])
        self.assertIsNone(page["next_cursor"])
        self.assertEqual(
            page["rows"],
            [
                {"id": 5, "name": "e", "years": 40},
                {"id": 3, "name": "c", "years": 35},
            ],
        )

    def test_aggregate_grouped(self):
        plan = {
            "op": "sort",
            "keys": ["g"],
            "children": [
                {
                    "op": "aggregate",
                    "group_by": ["g"],
                    "aggregates": [
                        {"func": "count", "as": "n"},
                        {"func": "sum", "column": "v", "as": "total"},
                        {"func": "min", "column": "v", "as": "lo"},
                        {"func": "max", "column": "v", "as": "hi"},
                        {"func": "avg", "column": "v", "as": "mean"},
                    ],
                    "children": [{"op": "scan", "table": "nums", "children": []}],
                }
            ],
        }
        page = PlanExecutor(make_catalog()).execute(plan)
        self.assertEqual(
            page["rows"],
            [
                {"g": "x", "n": 2, "total": 3, "lo": 1, "hi": 2, "mean": 1.5},
                {"g": "y", "n": 2, "total": 7, "lo": 3, "hi": 4, "mean": 3.5},
            ],
        )


class TestPagination(unittest.TestCase):
    def setUp(self):
        self.plan = {
            "op": "sort",
            "keys": ["id"],
            "children": [{"op": "scan", "table": "users", "children": []}],
        }

    def test_batched_fetch_equals_full_fetch(self):
        full = PlanExecutor(make_catalog(), default_batch_size=100).execute(self.plan)
        self.assertTrue(full["done"])

        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        rows = collect_all(ex, ex.execute(self.plan), batch_size=2)
        self.assertEqual(rows, full["rows"])
        self.assertEqual(len(rows), 5)

    def test_next_cursor_none_iff_done(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        page = ex.execute(self.plan)
        seen_pages = 0
        while True:
            seen_pages += 1
            self.assertEqual(page["next_cursor"] is None, page["done"])
            if page["done"]:
                break
            page = ex.fetch(page["next_cursor"], 2)
        self.assertEqual(seen_pages, 3)  # 5 行 / 每页 2 行 -> 2,2,1

    def test_same_token_repeated_fetch_returns_same_batch(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        first = ex.execute(self.plan)
        token = first["next_cursor"]
        a = ex.fetch(token, 2)
        b = ex.fetch(token, 2)
        self.assertEqual(a, b)
        self.assertEqual(a["rows"], [{"id": 3, "name": "c", "age": 35, "city": "bj",
                                      "score": 15},
                                     {"id": 4, "name": "d", "age": 28, "city": "sh",
                                      "score": 30}])
        # 返回的是副本，调用方改rows不影响缓存页
        a["rows"][0]["id"] = 999
        c = ex.fetch(token, 2)
        self.assertEqual(c["rows"][0]["id"], 3)

    def test_execute_with_cursor_resumes(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        first = ex.execute(self.plan)
        resumed = ex.execute(self.plan, {"token": first["next_cursor"],
                                         "batch_size": 2})
        direct = ex.fetch(first["next_cursor"], 2)
        self.assertEqual(resumed, direct)

    def test_unknown_token_and_bad_batch_size(self):
        ex = PlanExecutor(make_catalog())
        with self.assertRaises(ValueError):
            ex.fetch("no-such-token", 2)
        page = ex.execute(self.plan)
        with self.assertRaises(ValueError):
            ex.fetch(page["next_cursor"], 0)


class TestSortStability(unittest.TestCase):
    def test_equal_keys_keep_input_order(self):
        plan = {
            "op": "sort",
            "keys": ["g"],
            "children": [{"op": "scan", "table": "nums", "children": []}],
        }
        page = PlanExecutor(make_catalog()).execute(plan)
        self.assertEqual([r["v"] for r in page["rows"]], [1, 2, 3, 4])

    def test_equal_keys_keep_input_order_desc(self):
        catalog = {"t": [{"k": 1, "seq": i} for i in range(6)]}
        catalog["t"][2]["k"] = 0  # 乱序 key，同 key 行多个
        catalog["t"][5]["k"] = 0
        plan = {
            "op": "sort",
            "keys": [{"column": "k", "desc": True}],
            "children": [{"op": "scan", "table": "t", "children": []}],
        }
        page = PlanExecutor(catalog).execute(plan)
        self.assertEqual([r["seq"] for r in page["rows"]], [0, 1, 3, 4, 2, 5])


class TestAggregateEdgeCases(unittest.TestCase):
    def test_avg_empty_input_returns_none(self):
        plan = {
            "op": "aggregate",
            "group_by": [],
            "aggregates": [
                {"func": "avg", "column": "age", "as": "a"},
                {"func": "count", "as": "n"},
                {"func": "sum", "column": "age", "as": "s"},
            ],
            "children": [
                {
                    "op": "filter",
                    "predicate": {"col": "age", "op": "gt", "value": 1000},
                    "children": [{"op": "scan", "table": "users", "children": []}],
                }
            ],
        }
        page = PlanExecutor(make_catalog()).execute(plan)
        # 分组键为空：零输入行也产出一行；avg 为 None 而不是除零
        self.assertEqual(page["rows"], [{"a": None, "n": 0, "s": None}])

    def test_int_float_types_preserved(self):
        plan_int = {
            "op": "aggregate",
            "group_by": [],
            "aggregates": [
                {"func": "sum", "column": "v", "as": "s"},
                {"func": "avg", "column": "v", "as": "a"},
                {"func": "min", "column": "v", "as": "lo"},
            ],
            "children": [{"op": "scan", "table": "nums", "children": []}],
        }
        row = PlanExecutor(make_catalog()).execute(plan_int)["rows"][0]
        self.assertEqual(row["s"], 10)
        self.assertIs(type(row["s"]), int)  # int 不被强转成 float
        self.assertIs(type(row["lo"]), int)
        self.assertEqual(row["a"], 2.5)
        self.assertIs(type(row["a"]), float)

        plan_float = {
            "op": "aggregate",
            "group_by": [],
            "aggregates": [{"func": "sum", "column": "v", "as": "s"}],
            "children": [{"op": "scan", "table": "floats", "children": []}],
        }
        row = PlanExecutor(make_catalog()).execute(plan_float)["rows"][0]
        self.assertEqual(row["s"], 4.0)
        self.assertIs(type(row["s"]), float)


class TestPlanErrors(unittest.TestCase):
    def setUp(self):
        self.ex = PlanExecutor(make_catalog())

    def assert_path(self, plan, expected_path):
        with self.assertRaises(PlanError) as ctx:
            self.ex.execute(plan)
        self.assertEqual(ctx.exception.path, expected_path)
        self.assertIn(" -> ".join(expected_path), str(ctx.exception))

    def test_unknown_op(self):
        self.assert_path({"op": "join", "children": []}, ["join"])

    def test_children_arity_mismatch(self):
        scan = {"op": "scan", "table": "users", "children": []}
        self.assert_path(
            {"op": "scan", "table": "users", "children": [scan]}, ["scan"])
        self.assert_path({"op": "limit", "limit": 1, "children": []}, ["limit"])

    def test_unknown_table(self):
        self.assert_path({"op": "scan", "table": "nope", "children": []}, ["scan"])

    def test_unknown_column_in_filter(self):
        plan = {
            "op": "filter",
            "predicate": {"col": "nosuch", "op": "eq", "value": 1},
            "children": [{"op": "scan", "table": "users", "children": []}],
        }
        # 路径从根到出错节点：filter 是根
        self.assert_path(plan, ["filter"])

    def test_unknown_column_in_project(self):
        plan = {
            "op": "project",
            "columns": ["id", "nosuch"],
            "children": [{"op": "scan", "table": "users", "children": []}],
        }
        self.assert_path(plan, ["project"])

    def test_unknown_sort_column_nested_path(self):
        plan = {
            "op": "limit",
            "limit": 5,
            "children": [
                {
                    "op": "sort",
                    "keys": ["nosuch"],
                    "children": [
                        {
                            "op": "filter",
                            "predicate": {"col": "id", "op": "gt", "value": 0},
                            "children": [
                                {"op": "scan", "table": "users", "children": []}
                            ],
                        }
                    ],
                }
            ],
        }
        # 路径从根到出错节点
        self.assert_path(plan, ["limit", "sort"])

    def test_negative_limit(self):
        plan = {
            "op": "limit",
            "limit": -1,
            "children": [{"op": "scan", "table": "users", "children": []}],
        }
        self.assert_path(plan, ["limit"])

    def test_unknown_aggregate_function(self):
        plan = {
            "op": "aggregate",
            "group_by": [],
            "aggregates": [{"func": "median", "column": "v", "as": "m"}],
            "children": [{"op": "scan", "table": "nums", "children": []}],
        }
        self.assert_path(plan, ["aggregate"])

    def test_column_removed_by_project_not_visible_upstream(self):
        plan = {
            "op": "sort",
            "keys": ["age"],
            "children": [
                {
                    "op": "project",
                    "columns": ["id"],
                    "children": [{"op": "scan", "table": "users", "children": []}],
                }
            ],
        }
        self.assert_path(plan, ["sort"])


class TestSnapshotRestore(unittest.TestCase):
    def setUp(self):
        self.plan = {
            "op": "sort",
            "keys": ["id"],
            "children": [{"op": "scan", "table": "users", "children": []}],
        }

    def test_snapshot_restore_roundtrip(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        first = ex.execute(self.plan)            # 行 1,2
        second = ex.fetch(first["next_cursor"])  # 行 3,4
        token = second["next_cursor"]

        snap = ex.snapshot(token)
        self.assertIsInstance(snap, bytes)

        # 不中断继续执行
        expected_rest = collect_all(ex, {"rows": [], "next_cursor": token,
                                         "done": False})
        # 恢复出的游标继续 fetch，剩余行序列必须完全一致
        restored = ex.restore(snap)
        self.assertIsInstance(restored, str)
        actual_rest = collect_all(ex, {"rows": [], "next_cursor": restored,
                                       "done": False})
        self.assertEqual(actual_rest, expected_rest)
        self.assertEqual([r["id"] for r in actual_rest], [5])

    def test_snapshot_before_any_fetch_replays_whole_stream(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=2)
        first = ex.execute(self.plan)
        snap = ex.snapshot(first["next_cursor"])
        restored = ex.restore(snap)
        a = collect_all(ex, {"rows": [], "next_cursor": restored, "done": False})
        b = collect_all(ex, {"rows": [], "next_cursor": first["next_cursor"],
                             "done": False})
        self.assertEqual(a, b)
        self.assertEqual(len(a), 3)

    def test_snapshot_of_done_cursor_restores_done(self):
        ex = PlanExecutor(make_catalog(), default_batch_size=100)
        page = ex.execute(self.plan)
        self.assertTrue(page["done"])
        # execute 的首 token 本身不可见，用快照验证 done 状态可恢复：
        # 先小批跑到最后一页
        ex2 = PlanExecutor(make_catalog(), default_batch_size=2)
        p = ex2.execute(self.plan)
        while not p["done"]:
            last_token = p["next_cursor"]
            p = ex2.fetch(last_token)
        # p 是 done 页；对它对应的 token 做 snapshot
        snap = ex2.snapshot(last_token)
        restored = ex2.restore(snap)
        again = ex2.fetch(restored, 2)
        self.assertTrue(again["done"])
        self.assertIsNone(again["next_cursor"])
        self.assertEqual(again["rows"], p["rows"])

    def test_snapshot_mid_sort_buffer(self):
        # sort 节点处于吐行阶段时快照，恢复后顺序不变
        ex = PlanExecutor(make_catalog(), default_batch_size=1)
        plan = {
            "op": "sort",
            "keys": [{"column": "age", "desc": True}],
            "children": [{"op": "scan", "table": "users", "children": []}],
        }
        p1 = ex.execute(plan)
        p2 = ex.fetch(p1["next_cursor"])
        snap = ex.snapshot(p2["next_cursor"])
        restored = ex.restore(snap)
        rest_a = collect_all(ex, {"rows": [], "next_cursor": restored,
                                  "done": False}, batch_size=1)
        rest_b = collect_all(ex, {"rows": [], "next_cursor": p2["next_cursor"],
                                  "done": False}, batch_size=1)
        self.assertEqual(rest_a, rest_b)
        # 已吐出 40、35，剩余为 30, 28, 25
        self.assertEqual([r["age"] for r in rest_a], [30, 28, 25])


class TestLaziness(unittest.TestCase):
    def test_limit_does_not_materialize_whole_table(self):
        pulled = []

        class CountingList(list):
            def __getitem__(self, item):
                result = super().__getitem__(item)
                if isinstance(item, slice):
                    pulled.append(len(result))
                return result

        catalog = make_catalog()
        catalog["users"] = CountingList(catalog["users"])
        plan = {
            "op": "limit",
            "limit": 1,
            "children": [
                {"op": "scan", "table": "users", "batch_size": 2, "children": []}
            ],
        }
        ex = PlanExecutor(catalog, default_batch_size=1)
        page = ex.execute(plan)
        self.assertEqual(len(page["rows"]), 1)
        # scan 只拉了一个批（2 行），没有把 5 行整表物化
        self.assertEqual(sum(pulled), 2)


if __name__ == "__main__":
    unittest.main()
