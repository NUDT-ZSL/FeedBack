"""性能测试：10 万行规模下的构建、滚动、增删、定位与排序切换。

断言的耗时上限按「普通开发机、纯 Python 标准库实现」留了充足余量，
只防止性能退化到不可用，不追求压测极限。可用
``python tests/test_perf.py`` 直接查看实际耗时。
"""

import random
import time
import unittest

from table_kernel.kernel import TableKernel

N = 100_000
SCHEMA = {"a": "int", "b": "str", "c": "float", "d": "bool"}


def build_rows(n, seed=0):
    rng = random.Random(seed)
    rows = [None] * n
    for i in range(n):
        rows[i] = {
            "id": f"r{i:07d}",
            "fields": {
                "a": rng.randrange(1000),
                "b": f"bucket-{rng.randrange(50)}",
                "c": rng.random() * 1000,
                "d": rng.random() < 0.5,
            },
        }
    return rows


class PerformanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.rows = build_rows(N)
        cls.timings = {}

    def _time(self, name, fn):
        t0 = time.perf_counter()
        result = fn()
        self.timings[name] = time.perf_counter() - t0
        return result

    def test_01_construct_and_build(self):
        def do():
            return TableKernel(
                SCHEMA, self.rows,
                sort=[("a", True), ("b", False)],
                filters=[{"field": "a", "op": "ge", "value": 100}],
                window_size=100, seed=1)
        k = self._time(f"构建 {N} 行（排序+筛选）", do)
        self.assertEqual(k.row_count, N)
        self.assertEqual(len(k.visible_ids()), 100)
        # 初次窗口与全量参考结果逐行一致
        self.assertEqual(k.visible_ids(), k.reference_visible(0, 100))
        # 10 万行纯 Python 构建应在 4 秒内完成
        self.assertLess(self.timings[f"构建 {N} 行（排序+筛选）"], 4.0)
        type(self)._kernel = k

    def test_02_window_scroll_is_cheap(self):
        k = type(self)._kernel
        total = k.visible_count

        def do():
            for start in range(100, total - 100, 5000):
                k.move_to(start)
                assert len(k.visible_ids()) == 100
        self._time("20+ 次窗口平移", do)
        # 每次窗口移动只截取 100 行，全程应很快
        self.assertLess(self.timings["20+ 次窗口平移"], 0.5)

    def test_03_position_and_hit_queries(self):
        k = type(self)._kernel

        def do():
            for i in range(0, N, 997):
                rid = f"r{i:07d}"
                k.full_position_of(rid)
                if k.is_visible(rid):
                    pos = k.position_of(rid)
                    # 该位置反查回来必须就是本行
                    assert k.window_at(pos, 1) == [rid]
                    k.in_window(rid)
        self._time("约 100 次位置/命中查询", do)
        self.assertLess(self.timings["约 100 次位置/命中查询"], 0.2)

    def test_04_incremental_add_remove(self):
        k = type(self)._kernel
        new_rows = build_rows(200, seed=7)
        for r in new_rows:
            r["id"] = "new-" + r["id"]
        before = k.visible_ids()

        def do_add():
            k.add_rows(new_rows)
        self._time("增量插入 200 行", do_add)
        self.assertEqual(k.row_count, N + 200)
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(*k.window))
        # 原窗口内可见行相对顺序不变
        self.assertEqual(
            [x for x in before if x in set(k.visible_ids())],
            [x for x in k.visible_ids() if x in set(before)])
        self.assertLess(self.timings["增量插入 200 行"], 0.5)

        def do_remove():
            k.remove_rows([r["id"] for r in new_rows])
        self._time("增量删除 200 行", do_remove)
        self.assertEqual(k.row_count, N)
        self.assertEqual(k.visible_ids(), before)
        self.assertLess(self.timings["增量删除 200 行"], 0.5)

    def test_05_sort_change(self):
        k = type(self)._kernel

        def do():
            k.set_sort([("c", False), ("a", True)])
        self._time("全量切换排序规则", do)
        start, size = k.window
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(start, size))
        # 全量重排 10 万行纯 Python，给 5 秒上限
        self.assertLess(self.timings["全量切换排序规则"], 5.0)

    def test_06_filter_change(self):
        k = type(self)._kernel

        def do():
            k.set_filters([{"field": "b", "op": "contains",
                            "value": "bucket-1"}])
        self._time("切换筛选（重建可见树）", do)
        start, size = k.window
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(start, size))
        self.assertLess(self.timings["切换筛选（重建可见树）"], 5.0)

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "timings") and cls.timings:
            print("\n性能数据（10 万行）:")
            for name, dt in cls.timings.items():
                print(f"  {name}: {dt * 1000:8.1f} ms")


if __name__ == "__main__":
    unittest.main(verbosity=2)
