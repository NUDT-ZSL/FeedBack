"""result_stream_kernel 的自动化单元测试。

运行方式::

    python -m unittest test_result_stream_kernel -v

仅使用标准库，可完全离线、可重复执行。
"""

from __future__ import annotations

import json
import random
import tempfile
import unittest
from pathlib import Path

from result_stream_kernel import (
    BatchRejectedError,
    DuplicatePlanError,
    ImportValidationError,
    InvalidItemError,
    InvalidPlanError,
    PlanStatus,
    ResultItem,
    ResultStreamKernel,
    UnknownOperationError,
    UnknownPlanError,
)


def item(item_id: str, sort_key, payload=None) -> ResultItem:
    """构造测试用结果项的便捷函数。"""
    return ResultItem(item_id=item_id, sort_key=sort_key, payload=payload)


def ids(items) -> list:
    """提取结果项标识列表，便于断言顺序。"""
    return [it.item_id for it in items]


class RegistrationTests(unittest.TestCase):
    """计划注册相关行为。"""

    def test_register_plan_defaults_to_running(self):
        kernel = ResultStreamKernel()
        plan = kernel.register_plan("p1", "status = 200")
        self.assertEqual(plan.status, PlanStatus.RUNNING)
        self.assertEqual(kernel.list_plan_ids(), ["p1"])
        self.assertIsNone(kernel.current_plan_id)

    def test_duplicate_plan_id_rejected(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        with self.assertRaises(DuplicatePlanError) as ctx:
            kernel.register_plan("p1", "other")
        self.assertIn("p1", str(ctx.exception))

    def test_empty_plan_id_and_description_rejected(self):
        kernel = ResultStreamKernel()
        with self.assertRaises(InvalidPlanError):
            kernel.register_plan("", "q")
        with self.assertRaises(InvalidPlanError):
            kernel.register_plan("p1", "")
        with self.assertRaises(InvalidPlanError):
            kernel.register_plan("p1", "   ")


class BatchMergeTests(unittest.TestCase):
    """批次合并、去重与稳定排序。"""

    def setUp(self):
        self.kernel = ResultStreamKernel()
        self.kernel.register_plan("p1", "q")

    def test_out_of_order_batch_is_sorted(self):
        self.kernel.receive_batch("p1", [
            item("c", 3), item("a", 1), item("b", 2),
        ])
        self.assertEqual(ids(self.kernel.get_plan_results("p1")), ["a", "b", "c"])

    def test_cross_batch_order_independent(self):
        """任意批次切分与批次内顺序下，最终可见序列一致。"""
        expected = ["a", "b", "c", "d", "e"]
        all_items = [item("a", 1), item("b", 2), item("c", 3),
                     item("d", 4), item("e", 5)]
        for seed in range(20):
            kernel = ResultStreamKernel()
            kernel.register_plan("p1", "q")
            shuffled = all_items[:]
            random.Random(seed).shuffle(shuffled)
            # 随机切成若干批次喂入。
            cursor = 0
            rng = random.Random(seed + 1000)
            while cursor < len(shuffled):
                step = rng.randint(1, 3)
                kernel.receive_batch("p1", shuffled[cursor:cursor + step])
                cursor += step
            self.assertEqual(ids(kernel.get_plan_results("p1")), expected)

    def test_tie_break_by_item_id(self):
        """排序键相同时按结果项标识字典序排列。"""
        self.kernel.receive_batch("p1", [
            item("z", 5), item("m", 5), item("a", 5), item("b", 1),
        ])
        self.assertEqual(ids(self.kernel.get_plan_results("p1")),
                         ["b", "a", "m", "z"])

    def test_duplicates_within_and_across_batches(self):
        report1 = self.kernel.receive_batch("p1", [
            item("a", 1, "first"), item("a", 1, "dup-in-batch"), item("b", 2),
        ])
        self.assertEqual((report1.received, report1.added, report1.duplicates),
                         (3, 2, 1))
        report2 = self.kernel.receive_batch("p1", [
            item("a", 1, "dup-cross-batch"), item("c", 3),
        ])
        self.assertEqual((report2.received, report2.added, report2.duplicates),
                         (2, 1, 1))
        results = self.kernel.get_plan_results("p1")
        self.assertEqual(ids(results), ["a", "b", "c"])
        # 去重规则：先到达者胜出，保留第一次出现的载荷。
        self.assertEqual(results[0].payload, "first")
        stats = self.kernel.plan_stats("p1")
        self.assertEqual(stats["batches_received"], 2)
        self.assertEqual(stats["duplicates_dropped"], 2)
        self.assertEqual(stats["visible_count"], 3)

    def test_empty_batch_counts_but_changes_nothing(self):
        report = self.kernel.receive_batch("p1", [])
        self.assertEqual((report.received, report.added, report.duplicates), (0, 0, 0))
        self.assertEqual(self.kernel.plan_stats("p1")["batches_received"], 1)
        self.assertEqual(self.kernel.get_plan_results("p1"), [])

    def test_all_duplicate_batch(self):
        self.kernel.receive_batch("p1", [item("a", 1)])
        report = self.kernel.receive_batch("p1", [item("a", 1), item("a", 1)])
        self.assertEqual((report.added, report.duplicates), (0, 2))
        self.assertEqual(ids(self.kernel.get_plan_results("p1")), ["a"])

    def test_batch_atomicity_on_invalid_item(self):
        """批次内任一结果项非法则整个批次被拒绝，计划状态不变。"""
        self.kernel.receive_batch("p1", [item("a", 1)])
        with self.assertRaises(InvalidItemError) as ctx:
            self.kernel.receive_batch("p1", [
                item("b", 2),
                {"item_id": "", "sort_key": 3},  # 非法：空标识
            ])
        self.assertIn("p1", str(ctx.exception))
        # 批次原子性：b 不应被并入。
        self.assertEqual(ids(self.kernel.get_plan_results("p1")), ["a"])
        self.assertEqual(self.kernel.plan_stats("p1")["batches_received"], 1)

    def test_mixed_sort_key_kinds_rejected(self):
        self.kernel.receive_batch("p1", [item("a", 1)])
        with self.assertRaises(InvalidItemError):
            self.kernel.receive_batch("p1", [item("b", "text-key")])
        # 空计划上批次内种类不一致同样被拒绝。
        kernel2 = ResultStreamKernel()
        kernel2.register_plan("p2", "q")
        with self.assertRaises(InvalidItemError):
            kernel2.receive_batch("p2", [item("a", 1), item("b", "text")])
        self.assertEqual(kernel2.get_plan_results("p2"), [])

    def test_invalid_sort_keys_rejected(self):
        with self.assertRaises(InvalidItemError):
            item("a", True)  # bool 非法
        with self.assertRaises(InvalidItemError):
            item("a", float("nan"))
        with self.assertRaises(InvalidItemError):
            item("a", float("inf"))
        with self.assertRaises(InvalidItemError):
            item("a", [1, 2])

    def test_float_and_int_keys_interleave(self):
        self.kernel.receive_batch("p1", [
            item("a", 1), item("b", 1.5), item("c", 2),
        ])
        self.assertEqual(ids(self.kernel.get_plan_results("p1")), ["a", "b", "c"])

    def test_text_sort_keys(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("t", "q")
        kernel.receive_batch("t", [item("x", "pear"), item("y", "apple")])
        self.assertEqual(ids(kernel.get_plan_results("t")), ["y", "x"])


class PlanIsolationTests(unittest.TestCase):
    """计划之间的隔离性。"""

    def test_same_item_id_in_two_plans_counted_independently(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q1")
        kernel.register_plan("p2", "q2")
        kernel.receive_batch("p1", [item("shared", 1), item("only1", 2)])
        kernel.receive_batch("p2", [item("shared", 9, "other-payload")])
        # 各自独立：同一标识在两个计划中都计为首次出现，不算去重。
        self.assertEqual(kernel.plan_stats("p1")["duplicates_dropped"], 0)
        self.assertEqual(kernel.plan_stats("p2")["duplicates_dropped"], 0)
        self.assertEqual(ids(kernel.get_plan_results("p1")), ["shared", "only1"])
        self.assertEqual(ids(kernel.get_plan_results("p2")), ["shared"])
        # 载荷互不影响。
        self.assertEqual(kernel.get_plan_results("p2")[0].payload, "other-payload")
        # 归属查询返回两个计划，按字典序稳定排列。
        self.assertEqual(kernel.locate_item("shared"), ["p1", "p2"])
        self.assertEqual(kernel.locate_item("only1"), ["p1"])
        self.assertEqual(kernel.locate_item("ghost"), [])

    def test_non_current_plan_batches_never_leak_into_current(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("old", "q-old")
        kernel.register_plan("new", "q-new")
        kernel.switch_current_plan("new")
        # 非当前计划继续接收批次。
        kernel.receive_batch("old", [item("x", 1), item("y", 2)])
        kernel.receive_batch("new", [item("y", 2), item("z", 3)])
        # 当前计划可见序列只包含自己的结果。
        self.assertEqual(ids(kernel.get_current_results()), ["y", "z"])
        self.assertEqual(ids(kernel.get_plan_results("old")), ["x", "y"])


class LateBatchTests(unittest.TestCase):
    """迟到批次与未知计划批次的拒绝。"""

    def test_batch_to_cancelled_plan_rejected(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.receive_batch("p1", [item("a", 1)])
        kernel.cancel_plan("p1")
        before = kernel.snapshot()
        with self.assertRaises(BatchRejectedError) as ctx:
            kernel.receive_batch("p1", [item("b", 2)])
        message = str(ctx.exception)
        self.assertIn("p1", message)
        self.assertIn("cancelled", message)
        # 状态完全不变。
        self.assertEqual(kernel.snapshot(), before)

    def test_batch_to_failed_plan_rejected(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.fail_plan("p1")
        with self.assertRaises(BatchRejectedError) as ctx:
            kernel.receive_batch("p1", [item("a", 1)])
        self.assertIn("failed", str(ctx.exception))
        self.assertEqual(kernel.get_plan_results("p1"), [])

    def test_batch_to_completed_plan_accepted(self):
        """已完成不是终态拒绝：文档规定仅取消/失败拒绝批次。"""
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.complete_plan("p1")
        report = kernel.receive_batch("p1", [item("a", 1)])
        self.assertEqual(report.added, 1)

    def test_batch_to_unknown_plan_rejected_no_autocreate(self):
        kernel = ResultStreamKernel()
        with self.assertRaises(UnknownPlanError) as ctx:
            kernel.receive_batch("ghost", [item("a", 1)])
        self.assertIn("ghost", str(ctx.exception))
        # 不静默丢弃，也不自动创建计划。
        self.assertEqual(kernel.list_plan_ids(), [])

    def test_complete_and_fail_transitions_validated(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.cancel_plan("p1")
        with self.assertRaises(InvalidPlanError):
            kernel.complete_plan("p1")
        with self.assertRaises(InvalidPlanError):
            kernel.fail_plan("p1")


class CurrentPlanSwitchTests(unittest.TestCase):
    """当前计划切换。"""

    def test_current_plan_unique_and_switching(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q1")
        kernel.register_plan("p2", "q2")
        self.assertTrue(kernel.switch_current_plan("p1"))
        self.assertEqual(kernel.current_plan_id, "p1")
        self.assertTrue(kernel.switch_current_plan("p2"))
        self.assertEqual(kernel.current_plan_id, "p2")
        # 旧计划仍保留数据且可继续接收批次。
        kernel.receive_batch("p1", [item("a", 1)])
        self.assertEqual(ids(kernel.get_plan_results("p1")), ["a"])

    def test_repeated_switch_is_idempotent(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.switch_current_plan("p1")
        before = kernel.snapshot()
        for _ in range(5):
            self.assertFalse(kernel.switch_current_plan("p1"))
        self.assertEqual(kernel.current_plan_id, "p1")
        self.assertEqual(kernel.snapshot(), before)

    def test_switch_to_unknown_plan_rejected(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.switch_current_plan("p1")
        with self.assertRaises(UnknownPlanError) as ctx:
            kernel.switch_current_plan("ghost")
        self.assertIn("ghost", str(ctx.exception))
        self.assertEqual(kernel.current_plan_id, "p1")

    def test_cancel_idempotent_and_unknown_cancel_rejected(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        self.assertTrue(kernel.cancel_plan("p1"))
        before = kernel.snapshot()
        for _ in range(3):
            self.assertFalse(kernel.cancel_plan("p1"))
        self.assertEqual(kernel.snapshot(), before)
        with self.assertRaises(UnknownPlanError):
            kernel.cancel_plan("ghost")

    def test_cancel_then_batch_matches_late_batch_rule(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.cancel_plan("p1")
        kernel.cancel_plan("p1")  # 幂等
        with self.assertRaises(BatchRejectedError):
            kernel.receive_batch("p1", [item("a", 1)])


class QueryTests(unittest.TestCase):
    """各类查询在边界条件下的行为。"""

    def test_empty_system(self):
        kernel = ResultStreamKernel()
        self.assertEqual(kernel.get_current_results(), [])
        self.assertIsNone(kernel.current_plan_id)
        self.assertEqual(kernel.list_plan_ids(), [])
        self.assertEqual(kernel.locate_item("x"), [])
        with self.assertRaises(UnknownPlanError):
            kernel.get_plan_results("p1")
        with self.assertRaises(UnknownPlanError):
            kernel.plan_stats("p1")

    def test_stats_and_results_queries(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "q")
        kernel.receive_batch("p1", [item("b", 2), item("a", 1), item("a", 1)])
        stats = kernel.plan_stats("p1")
        self.assertEqual(stats, {
            "plan_id": "p1",
            "status": "running",
            "batches_received": 1,
            "duplicates_dropped": 1,
            "visible_count": 2,
        })
        self.assertEqual(ids(kernel.get_plan_results("p1")), ["a", "b"])


class ExportImportTests(unittest.TestCase):
    """导出 / 导入往返与损坏文件处理。"""

    def build_busy_kernel(self) -> ResultStreamKernel:
        kernel = ResultStreamKernel()
        kernel.register_plan("p1", "筛选: 状态码 200")
        kernel.register_plan("p2", "筛选: 状态码 500")
        kernel.register_plan("p3", "空计划")
        kernel.switch_current_plan("p2")
        kernel.receive_batch("p1", [item("a", 1, {"v": 1}), item("b", 2)])
        kernel.receive_batch("p2", [item("b", 2), item("c", 3), item("c", 3)])
        kernel.receive_batch("p1", [item("a", 1, {"v": "迟到重复"}), item("d", 4)])
        kernel.cancel_plan("p3")
        return kernel

    def test_roundtrip_preserves_state(self):
        kernel = self.build_busy_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            kernel.export_to_file(path)
            restored = ResultStreamKernel()
            restored.import_from_file(path)
        self.assertEqual(restored.to_dict(), kernel.to_dict())
        self.assertEqual(restored.snapshot(), kernel.snapshot())
        self.assertEqual(restored.current_plan_id, "p2")
        self.assertEqual(
            ids(restored.get_plan_results("p1")), ["a", "b", "d"])
        # 往返后仍可继续工作。
        restored.receive_batch("p1", [item("e", 5)])
        self.assertEqual(ids(restored.get_plan_results("p1")),
                         ["a", "b", "d", "e"])

    def test_export_file_is_valid_json_with_unicode(self):
        kernel = self.build_busy_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            kernel.export_to_file(path)
            data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["current_plan_id"], "p2")
        self.assertEqual(len(data["plans"]), 3)

    def test_import_corrupted_json(self):
        kernel = self.build_busy_kernel()
        before = kernel.snapshot()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.json"
            path.write_text("{not valid json", encoding="utf-8")
            with self.assertRaises(ImportValidationError):
                kernel.import_from_file(path)
            # 文件不存在同样报清晰错误。
            with self.assertRaises(ImportValidationError):
                kernel.import_from_file(Path(tmp) / "missing.json")
        self.assertEqual(kernel.snapshot(), before)

    def test_import_validation_failures_keep_state(self):
        """各种非法结构都必须报错且内存状态不变。"""
        kernel = self.build_busy_kernel()
        before = kernel.snapshot()
        valid = kernel.to_dict()

        def broken(mutate) -> dict:
            data = json.loads(json.dumps(valid))  # 深拷贝
            mutate(data)
            return data

        cases = {
            "缺少字段": broken(lambda d: d.pop("plans")),
            "版本不符": broken(lambda d: d.update(version=999)),
            "计划标识重复": broken(
                lambda d: d["plans"].append(dict(d["plans"][0]))),
            "计划内结果项重复": broken(
                lambda d: d["plans"][0]["items"].append(
                    dict(d["plans"][0]["items"][0]))),
            "排序键类型非法": broken(
                lambda d: d["plans"][0]["items"][0].update(sort_key=True)),
            "排序键非有限值": broken(
                lambda d: d["plans"][0]["items"][0].update(
                    sort_key=float("nan"))),
            "状态取值非法": broken(
                lambda d: d["plans"][0].update(status="bogus")),
            "批次引用未知计划": broken(
                lambda d: d["batches"].append(
                    {"plan_id": "ghost", "sequence": 1, "received": 0,
                     "added": 0, "duplicates": 0})),
            "批次计数不自洽": broken(
                lambda d: d["batches"][0].update(received=99)),
            "当前计划未知": broken(lambda d: d.update(current_plan_id="ghost")),
            "缺失结果项字段": broken(
                lambda d: d["plans"][0]["items"][0].pop("sort_key")),
            "排序键种类不一致": broken(
                lambda d: d["plans"][0]["items"][0].update(sort_key="text")),
        }
        for name, data in cases.items():
            with self.subTest(case=name):
                with self.assertRaises(ImportValidationError,
                                       msg=f"用例 {name!r} 应抛出 ImportValidationError"):
                    ResultStreamKernel.from_dict(data)
                self.assertEqual(kernel.snapshot(), before)

    def test_import_error_messages_identify_plan_or_item(self):
        valid = ResultStreamKernel()
        valid.register_plan("p1", "q")
        valid.receive_batch("p1", [item("dup", 1)])
        data = valid.to_dict()
        data["plans"][0]["items"].append(
            {"item_id": "dup", "sort_key": 2, "payload": None})
        with self.assertRaises(ImportValidationError) as ctx:
            ResultStreamKernel.from_dict(data)
        message = str(ctx.exception)
        self.assertIn("p1", message)
        self.assertIn("dup", message)


class ApplyOperationTests(unittest.TestCase):
    """逐条操作请求入口。"""

    def test_full_operation_flow(self):
        kernel = ResultStreamKernel()
        r = kernel.apply_operation({"op": "register_plan", "plan_id": "p1",
                                    "description": "q1"})
        self.assertEqual(r["status"], "running")
        kernel.apply_operation({"op": "register_plan", "plan_id": "p2",
                                "description": "q2"})
        r = kernel.apply_operation({"op": "switch_plan", "plan_id": "p2"})
        self.assertEqual(r, {"current_plan_id": "p2", "changed": True})
        r = kernel.apply_operation({"op": "switch_plan", "plan_id": "p2"})
        self.assertFalse(r["changed"])
        r = kernel.apply_operation({
            "op": "receive_batch", "plan_id": "p1",
            "items": [{"item_id": "a", "sort_key": 1},
                      {"item_id": "a", "sort_key": 1},
                      {"item_id": "b", "sort_key": 2}],
        })
        self.assertEqual((r["received"], r["added"], r["duplicates"]), (3, 2, 1))
        r = kernel.apply_operation({"op": "get_plan_results", "plan_id": "p1"})
        self.assertEqual([it["item_id"] for it in r], ["a", "b"])
        r = kernel.apply_operation({"op": "get_current_plan"})
        self.assertEqual(r["current_plan_id"], "p2")
        r = kernel.apply_operation({"op": "get_current_results"})
        self.assertEqual(r, [])
        r = kernel.apply_operation({"op": "locate_item", "item_id": "a"})
        self.assertEqual(r["plan_ids"], ["p1"])
        r = kernel.apply_operation({"op": "plan_stats", "plan_id": "p1"})
        self.assertEqual(r["duplicates_dropped"], 1)
        r = kernel.apply_operation({"op": "cancel_plan", "plan_id": "p2"})
        self.assertTrue(r["changed"])
        r = kernel.apply_operation({"op": "cancel_plan", "plan_id": "p2"})
        self.assertFalse(r["changed"])
        snap = kernel.apply_operation({"op": "snapshot"})
        self.assertEqual(snap["current_plan_id"], "p2")
        self.assertEqual(len(snap["batches"]), 1)

    def test_export_import_operations(self):
        kernel = ResultStreamKernel()
        kernel.apply_operation({"op": "register_plan", "plan_id": "p1",
                                "description": "q"})
        kernel.apply_operation({"op": "receive_batch", "plan_id": "p1",
                                "items": [{"item_id": "a", "sort_key": 1}]})
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "s.json")
            kernel.apply_operation({"op": "export", "path": path})
            other = ResultStreamKernel()
            other.apply_operation({"op": "import", "path": path})
            self.assertEqual(other.to_dict(), kernel.to_dict())

    def test_unknown_operation_and_missing_op(self):
        kernel = ResultStreamKernel()
        with self.assertRaises(UnknownOperationError):
            kernel.apply_operation({"op": "explode"})
        with self.assertRaises(UnknownOperationError):
            kernel.apply_operation({"plan_id": "p1"})

    def test_operation_errors_identify_plan(self):
        kernel = ResultStreamKernel()
        with self.assertRaises(UnknownPlanError) as ctx:
            kernel.apply_operation({"op": "receive_batch", "plan_id": "ghost",
                                    "items": []})
        self.assertIn("ghost", str(ctx.exception))


class InterleavedAcceptanceTests(unittest.TestCase):
    """验收场景：多计划交错接收乱序批次、重复项与迟到批次。

    将同一组按稳定规则串行处理的操作流，以不同的交错顺序喂入，
    最终每个计划的可见序列、去重统计与当前计划标识必须一致，
    且导出导入后状态不变。
    """

    def build_operation_streams(self):
        """构造每个计划各自有序的操作流（含重复项与迟到批次）。"""
        plan_a_batches = [
            [item("a1", 1, "v1"), item("a2", 2), item("a3", 3)],
            [item("a2", 2, "dup"), item("a4", 4)],          # 跨批次重复
            [item("a0", 0), item("a1", 1, "dup"), item("a5", 5)],
        ]
        plan_b_batches = [
            [item("b2", 2), item("b1", 1)],                  # 批次内乱序
            [item("b1", 1, "dup"), item("b3", 3)],
        ]
        plan_c_batches = [
            [item("c1", 1)],
            [item("c2", 2)],  # 该批次将在 c 取消后迟到，应被拒绝
        ]
        return plan_a_batches, plan_b_batches, plan_c_batches

    def run_interleaving(self, seed: int) -> dict:
        """按给定种子交错执行操作流，返回最终状态字典。"""
        a_batches, b_batches, c_batches = self.build_operation_streams()
        kernel = ResultStreamKernel()
        kernel.register_plan("A", "计划 A")
        kernel.register_plan("B", "计划 B")
        kernel.register_plan("C", "计划 C")

        # 每个计划内部保持批次顺序；跨计划的交错顺序由 seed 决定。
        streams = {
            "A": list(a_batches),
            "B": list(b_batches[:1]),   # B 的第二批在切换后到达
            "C": list(c_batches[:1]),
        }
        rng = random.Random(seed)
        kernel.switch_current_plan("A")
        while any(streams.values()):
            pid = rng.choice([p for p, s in streams.items() if s])
            kernel.receive_batch(pid, streams[pid].pop(0))
            if not streams["A"] and kernel.current_plan_id == "A":
                kernel.switch_current_plan("B")
                kernel.switch_current_plan("B")  # 重复切换：幂等
                streams["B"].extend(b_batches[1:])
        # 取消 C 后迟到批次必须被拒绝，且不影响任何状态。
        kernel.cancel_plan("C")
        kernel.cancel_plan("C")
        with self.assertRaises(BatchRejectedError):
            kernel.receive_batch("C", c_batches[1])
        state = kernel.to_dict()
        # 批次记录的全局顺序取决于交错顺序，按 (计划, 计划内序号) 规范化后比较；
        # 计划可见序列、去重统计与当前计划标识必须与交错顺序无关。
        state["batches"] = sorted(
            state["batches"], key=lambda b: (b["plan_id"], b["sequence"]))
        return state

    def test_interleavings_converge_to_serial_reference(self):
        reference = self.run_interleaving(seed=0)
        for seed in range(1, 30):
            with self.subTest(seed=seed):
                self.assertEqual(self.run_interleaving(seed=seed), reference)

        # 与期望的稳定结果逐项核对。
        plans = {p["plan_id"]: p for p in reference["plans"]}
        self.assertEqual([it["item_id"] for it in plans["A"]["items"]],
                         ["a0", "a1", "a2", "a3", "a4", "a5"])
        self.assertEqual(plans["A"]["duplicates_dropped"], 2)
        self.assertEqual(plans["A"]["batches_received"], 3)
        self.assertEqual([it["item_id"] for it in plans["B"]["items"]],
                         ["b1", "b2", "b3"])
        self.assertEqual(plans["B"]["duplicates_dropped"], 1)
        self.assertEqual([it["item_id"] for it in plans["C"]["items"]], ["c1"])
        self.assertEqual(plans["C"]["status"], "cancelled")
        self.assertEqual(plans["C"]["batches_received"], 1)
        self.assertEqual(reference["current_plan_id"], "B")
        # 先到达者胜出：a1 保留第一次出现的载荷。
        a1 = next(it for it in plans["A"]["items"] if it["item_id"] == "a1")
        self.assertEqual(a1["payload"], "v1")

    def test_export_import_roundtrip_after_interleaving(self):
        kernel = ResultStreamKernel()
        kernel.register_plan("A", "计划 A")
        kernel.register_plan("B", "计划 B")
        kernel.switch_current_plan("A")
        kernel.receive_batch("A", [item("x", 1), item("y", 2)])
        kernel.switch_current_plan("B")
        kernel.receive_batch("A", [item("x", 1, "dup"), item("z", 3)])
        kernel.receive_batch("B", [item("x", 1)])  # 同标识，独立计数
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "state.json"
            kernel.export_to_file(path)
            restored = ResultStreamKernel()
            restored.import_from_file(path)
            # 再次导出，文件内容应逐字节一致。
            path2 = Path(tmp) / "state2.json"
            restored.export_to_file(path2)
            self.assertEqual(path.read_text(encoding="utf-8"),
                             path2.read_text(encoding="utf-8"))
        self.assertEqual(restored.current_plan_id, "B")
        self.assertEqual(ids(restored.get_plan_results("A")), ["x", "y", "z"])
        self.assertEqual(restored.plan_stats("A")["duplicates_dropped"], 1)
        self.assertEqual(restored.plan_stats("B")["duplicates_dropped"], 0)


if __name__ == "__main__":
    unittest.main()
