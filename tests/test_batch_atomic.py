"""批量导入原子性与挂起窗口挂接的回归测试。

覆盖：
* 批量导入中任意一行非法 / 标识重复 -> 整体拒绝，导入前后行集合、
  可见序列、窗口状态、增量统计逐项一致；
* 校验通过后的提交阶段若意外失败（故障注入）-> 回滚到导入前，
  Treap 不变量保持完整、内核仍可继续使用；删除路径同理；
* 空数据 / 筛选清空导致的挂起窗口，补入通过筛选的数据后自动挂接，
  可见行与「直接在有数据时设置同窗口」逐行一致；补入的行全被过滤
  时窗口继续挂起、返回空区间；
* 快照载入的挂起窗口补数据后同样挂接。
"""

import copy
import unittest

from table_kernel.errors import BatchValidationError, WindowError
from table_kernel.kernel import TableKernel
from table_kernel.treap import Treap
from table_kernel import export_snapshot, load_snapshot

SCHEMA = {"age": "int", "name": "str", "score": "float", "ok": "bool"}


def row(i, rid=None, **over):
    fields = {"age": i % 5, "name": f"n{i % 3}", "score": i * 0.5,
              "ok": i % 2 == 0}
    fields.update(over)
    return {"id": rid or f"r{i:04d}", "fields": fields}


def state_sig(k):
    """导入/删除前后用于全等比对的状态指纹。"""
    return (
        k.row_count,
        tuple(sorted(k.rows)),
        k.window,
        tuple(k.visible_ids()) if k.window is not None else None,
        tuple(p.id for p in k._full_treap.iter_payloads()),
        tuple(p.id for p in k._visible_treap.iter_payloads()),
        dict(k.stats()),
    )


def assert_state_unchanged(tc, k, before):
    tc.assertEqual(k.row_count, before[0])
    tc.assertEqual(tuple(sorted(k.rows)), before[1])
    tc.assertEqual(k.window, before[2])
    tc.assertEqual(tuple(k.visible_ids())
                   if k.window is not None else None, before[3])
    tc.assertEqual(tuple(p.id for p in k._full_treap.iter_payloads()),
                   before[4])
    tc.assertEqual(tuple(p.id for p in k._visible_treap.iter_payloads()),
                   before[5])
    tc.assertEqual(dict(k.stats()), before[6])


class BatchImportAtomicityTest(unittest.TestCase):
    def _kernel(self, n=40):
        k = TableKernel(SCHEMA, [row(i) for i in range(n)],
                        sort=[("age", True), ("name", True)],
                        filters=[], window_size=8)
        k.move_to(4)
        return k

    def test_bad_type_at_every_position_rejects_whole_batch(self):
        for pos in range(10):
            k = self._kernel()
            before = state_sig(k)
            batch = [row(100 + j) for j in range(10)]
            batch[pos]["fields"]["age"] = "not-an-int"
            with self.assertRaises(BatchValidationError) as cm:
                k.add_rows(batch)
            # 错误带位置
            self.assertTrue(any(e.index == pos for e in cm.exception.errors))
            assert_state_unchanged(self, k, before)

    def test_duplicate_ids_reject_whole_batch(self):
        # 批内重复
        k = self._kernel()
        before = state_sig(k)
        batch = [row(100 + j) for j in range(10)]
        batch[7]["id"] = batch[2]["id"]
        with self.assertRaises(BatchValidationError):
            k.add_rows(batch)
        assert_state_unchanged(self, k, before)

        # 与已有行重复（现有行为 r0000..r0039）
        k = self._kernel()
        before = state_sig(k)
        batch = [row(100 + j) for j in range(10)]
        batch[4]["id"] = "r0003"
        with self.assertRaises(BatchValidationError):
            k.add_rows(batch)
        assert_state_unchanged(self, k, before)

    def test_multiple_errors_collected_and_nothing_committed(self):
        k = self._kernel()
        before = state_sig(k)
        batch = [row(100 + j) for j in range(10)]
        batch[0]["fields"]["name"] = 7          # 类型非法
        batch[3]["fields"]["score"] = True      # bool 混入 float
        batch[9]["id"] = "r0001"                # 与已有重复
        with self.assertRaises(BatchValidationError) as cm:
            k.add_rows(batch)
        self.assertGreaterEqual(len(cm.exception.errors), 3)
        assert_state_unchanged(self, k, before)

    def test_empty_batch_is_noop(self):
        k = self._kernel()
        before = state_sig(k)
        k.add_rows([])
        assert_state_unchanged(self, k, before)

    def test_malformed_rows_rejected_atomically(self):
        k = self._kernel()
        before = state_sig(k)
        for bad_batch in (
            ["not-a-dict"],
            [{"fields": {"age": 1, "name": "a", "score": 1.0, "ok": True}}],
            [{"id": "x"}],
            [{"id": 9, "fields": {"age": 1, "name": "a",
                                  "score": 1.0, "ok": True}}],
        ):
            with self.assertRaises(BatchValidationError):
                k.add_rows(bad_batch)
            assert_state_unchanged(self, k, before)

    # ------------------------------------------------------------------
    # 提交阶段故障注入：校验通过后、逐行提交中途抛异常必须回滚
    # ------------------------------------------------------------------

    def _patch_fail(self, k, treap_name, method, fail_at):
        target = getattr(k, treap_name)
        counter = {"n": 0}
        original = getattr(Treap, method)

        def patched(self, *a, **kw):
            if self is target:
                counter["n"] += 1
                if counter["n"] == fail_at:
                    raise RuntimeError("注入的提交中途故障")
            return original(self, *a, **kw)

        setattr(Treap, method, patched)
        return lambda: setattr(Treap, method, original)

    def test_add_rows_rolls_back_on_mid_commit_failure(self):
        for fail_at in (1, 2, 5, 9):
            k = self._kernel()
            before = state_sig(k)
            restore = self._patch_fail(k, "_visible_treap", "insert",
                                       fail_at)
            try:
                with self.assertRaises(RuntimeError):
                    k.add_rows([row(100 + j) for j in range(10)])
            finally:
                restore()
            assert_state_unchanged(self, k, before)
            # 树结构完整、回滚后内核仍正常可用
            k._full_treap.verify()
            k._visible_treap.verify()
            k.add_rows([row(200)])
            self.assertEqual(
                k.visible_ids(),
                k.reference_visible(*k.window))
            k._full_treap.verify()
            k._visible_treap.verify()

    def test_full_treap_mid_commit_failure_rolls_back(self):
        k = self._kernel()
        before = state_sig(k)
        restore = self._patch_fail(k, "_full_treap", "insert", 6)
        try:
            with self.assertRaises(RuntimeError):
                k.add_rows([row(100 + j) for j in range(10)])
        finally:
            restore()
        assert_state_unchanged(self, k, before)
        k._full_treap.verify()
        k._visible_treap.verify()

    def test_remove_rows_rolls_back_on_mid_commit_failure(self):
        for fail_at in (1, 4, 8):
            k = self._kernel()
            before = state_sig(k)
            restore = self._patch_fail(k, "_visible_treap", "remove",
                                       fail_at)
            try:
                with self.assertRaises(RuntimeError):
                    k.remove_rows([f"r{i:04d}" for i in range(10)])
            finally:
                restore()
            assert_state_unchanged(self, k, before)
            k._full_treap.verify()
            k._visible_treap.verify()

    def test_successful_import_full_state_matches_reference(self):
        """成功导入后窗口/可见序列与全量参考逐行一致，统计正确增加。"""
        k = self._kernel()
        added = [row(100 + j) for j in range(20)]
        k.add_rows(added)
        self.assertEqual(k.row_count, 60)
        self.assertEqual(k.stats()["rows_inserted"], 20)
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(*k.window))
        # 窗口内已可见行相对顺序不因尾部插入而跳动
        before_window = self._kernel()
        ids_before = before_window.visible_ids()
        before_window.add_rows(
            [row(900 + j, age=9) for j in range(5)])
        common_before = [x for x in ids_before]
        common_after = [x for x in before_window.visible_ids()
                        if x in set(ids_before)]
        self.assertEqual(common_before, common_after)


class SuspendedWindowReattachTest(unittest.TestCase):
    def test_empty_data_suspended_window_reattaches_on_add(self):
        for size, n in ((5, 1), (5, 3), (5, 8), (10, 50), (100, 2)):
            with self.subTest(size=size, n=n):
                # 经历「空数据挂起 -> 补数据」的内核
                k = TableKernel(SCHEMA, [], sort=[("age", True)],
                                window_size=size)
                self.assertEqual(k.window, (0, size))
                added = [row(1000 + j) for j in range(n)]
                k.add_rows(copy.deepcopy(added))
                # 对照：直接在有数据时设置同窗口
                direct = TableKernel(SCHEMA, [], sort=[("age", True)])
                direct.add_rows(copy.deepcopy(added))
                direct.set_window(0, min(size, n))
                self.assertEqual(k.window, direct.window)
                self.assertEqual(k.visible_ids(), direct.visible_ids())
                self.assertTrue(len(k.visible_ids()) > 0)

    def test_add_all_filtered_rows_keeps_window_suspended(self):
        k = TableKernel(SCHEMA, [], sort=[("age", True)],
                        filters=[("age", "ge", 2)], window_size=10)
        k.add_rows([{"id": "f1", "fields": {"age": 0, "name": "a",
                                            "score": 1.0, "ok": True}}])
        self.assertEqual(k.visible_count, 0)
        self.assertEqual(k.visible_ids(), [])
        self.assertIsNotNone(k.window)  # 仍挂起，未销毁
        # 随后补入通过筛选的行 -> 自动挂接
        k.add_rows([{"id": f"p{j}", "fields": {"age": 3, "name": "b",
                                               "score": 1.0, "ok": True}}
                    for j in range(4)])
        self.assertEqual(k.window, (0, 4))
        self.assertEqual(k.visible_ids(),
                         k.reference_visible(0, 4))

    def test_nonzero_start_suspended_window_reattaches_and_clamps(self):
        # 用户滚到中部 (10,5)，随后筛选清空挂起，补入 6 行通过筛选数据
        k = TableKernel(SCHEMA, [row(i) for i in range(40)],
                        sort=[("age", True)], window_size=5)
        k.move_to(10)
        k.set_filters([("age", "eq", 999)])
        self.assertEqual(k.visible_ids(), [])
        suspended = k.window
        new = [{"id": f"new{j}", "fields": {"age": 999, "name": "m",
                                            "score": 1.0, "ok": True}}
               for j in range(6)]
        k.add_rows(copy.deepcopy(new))
        # 6 行放不下 (10,5)：回退贴右边界到 (1,5)，绝不再返回空区间
        self.assertEqual(k.window, (1, 5))
        self.assertEqual(len(k.visible_ids()), 5)
        self.assertEqual(k.visible_ids(), k.reference_visible(1, 5))
        self.assertNotEqual(k.window, suspended)  # 已挂接收口

    def test_suspended_window_reattach_after_snapshot_load(self):
        k = TableKernel(SCHEMA, [], sort=[("age", True)],
                        filters=[("age", "ge", 1)], window_size=10)
        loaded = load_snapshot(export_snapshot(k))
        self.assertIsNotNone(loaded.window)
        loaded.add_rows([row(i) for i in range(10)])
        # 10 行里 8 行 age>=1
        self.assertEqual(loaded.visible_count, 8)
        self.assertEqual(loaded.window, (0, 8))
        self.assertEqual(loaded.visible_ids(),
                         loaded.reference_visible(0, 8))

    def test_window_set_before_data_then_data_arrives(self):
        # 无窗口 -> 不允许查询；空数据上显式 set_window 按需求 6 拒绝
        k = TableKernel(SCHEMA, [], sort=[("name", False)])
        with self.assertRaises(WindowError):
            k.visible_ids()
        with self.assertRaises(WindowError):
            k.set_window(0, 3)
        self.assertIsNone(k.window)
        # 挂起窗口经由构造器产生，补数据后自动挂接
        k2 = TableKernel(SCHEMA, [], sort=[("name", False)],
                         window_size=3)
        self.assertEqual(k2.window, (0, 3))
        self.assertEqual(k2.visible_ids(), [])
        k2.add_rows([row(i) for i in range(20)])
        self.assertEqual(k2.window, (0, 3))
        self.assertEqual(k2.visible_ids(), k2.reference_visible(0, 3))


if __name__ == "__main__":
    unittest.main()
