"""分层令牌配额内核的 unittest 测试套件。

覆盖：层级约束、同刻竞争父级额度、借用/归还（FIFO、部分偿还、跨级传播、
即借即还）、突发受祖先约束与平滑回落、禁用/删除的回收与核销、导出导入
往返、损坏文件拒绝且状态不变、逻辑时钟回退、空树/零容量/零速率等边界、
拒绝原因链以及确定性重放。
"""

from __future__ import annotations

import io
import json
import math
import os
import tempfile
import unittest

from quota_kernel import (
    ClockRollbackError,
    CycleDetectedError,
    DuplicateNodeError,
    InvalidConfigError,
    NodeDisabledError,
    NodeHasChildrenError,
    NodeNotFoundError,
    QuotaError,
    QuotaImportError,
    QuotaKernel,
    apply_op,
    main,
    process_jsonl,
)


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------


def build_tree() -> QuotaKernel:
    """构建标准三层树::

        root(10, rate1, burst2)
        ├── a(6, rate1, burst2)
        │   └── a1(4, rate1)
        └── b(6, rate1)
    """
    k = QuotaKernel()
    k.create_node("root", 10, 1, burst_capacity=2)
    k.create_node("a", 6, 1, parent_id="root", burst_capacity=2)
    k.create_node("b", 6, 1, parent_id="root")
    k.create_node("a1", 4, 1, parent_id="a")
    return k


def layer_used(status: dict) -> float:
    """按节点状态计算该层已占用额度（含借入即耗部分）。"""
    return (
        status["capacity"]
        - status["available"]
        - status["borrowed_out"]
        + status["burst_used"]
        + status["borrowed_in"]
    )


def assert_invariants(testcase: unittest.TestCase, kernel: QuotaKernel) -> None:
    """每个操作后都必须成立的全套不变量。"""
    state = kernel.internal_state()
    statuses = {n["id"]: kernel.node_status(n["id"]) for n in state["nodes"]}

    # 1) 每个节点：0 <= steady；steady + 未还借出 <= 容量；突发桶不越界。
    for nid, st in statuses.items():
        testcase.assertGreaterEqual(st["available"], -1e-9, f"{nid} steady 为负")
        testcase.assertLessEqual(
            st["available"] + st["borrowed_out"],
            st["capacity"] + 1e-9,
            f"{nid} 剩余+借出超过容量",
        )
        testcase.assertGreaterEqual(st["burst_remaining"], -1e-9, nid)
        testcase.assertLessEqual(
            st["burst_remaining"], st["burst_capacity"] + 1e-9, nid
        )

    # 2) 任一父节点：所有直接子节点该层已用之和 <= 父容量+父突发（核心
    #    验收不变量：子级总和不能打穿父级总额度；父突发也是父级可承担的
    #    一部分，且只可能被链路上的请求用掉）。
    for nid, st in statuses.items():
        kids = st["children"]
        child_used_sum = sum(layer_used(statuses[c]) for c in kids)
        testcase.assertLessEqual(
            child_used_sum,
            st["capacity"] + st["burst_capacity"] + 1e-9,
            f"父节点 {nid} 的子级已用之和 {child_used_sum} 超过父级总额度 "
            f"{st['capacity'] + st['burst_capacity']}",
        )

    # 3) 借出总额 == 借入总额；每笔贷款余额为正。
    total_out = sum(st["borrowed_out"] for st in statuses.values())
    total_in = sum(st["borrowed_in"] for st in statuses.values())
    testcase.assertAlmostEqual(total_out, total_in, places=9)
    for loan in state["loans"]:
        testcase.assertGreater(loan["amount"], 0)
        testcase.assertEqual(
            statuses[loan["borrower_id"]]["parent_id"], loan["lender_id"]
        )

    # 4) total_used 恒等式：全局已用 == 所有桶相对满容量的净减少（借贷抵消）。
    totals = kernel.total_used()
    bucket_deficit = sum(
        st["capacity"] + st["burst_capacity"] - st["available"] - st["burst_remaining"]
        for st in statuses.values()
    )
    testcase.assertAlmostEqual(totals["total_used"], bucket_deficit, places=9)
    testcase.assertAlmostEqual(
        totals["total_used"], sum(totals["per_node"].values()), places=9
    )


# ---------------------------------------------------------------------------
# 1. 层级约束
# ---------------------------------------------------------------------------


class TestHierarchy(unittest.TestCase):
    """节点创建、父子关系、排序、删除的结构规则。"""

    def test_empty_tree(self) -> None:
        k = QuotaKernel()
        self.assertEqual(len(k), 0)
        self.assertIsNone(k.root_id())
        self.assertEqual(k.total_used()["total_used"], 0)
        with self.assertRaises(NodeNotFoundError):
            k.node_status("root")

    def test_root_and_ordering(self) -> None:
        k = build_tree()
        self.assertEqual(k.root_id(), "root")
        self.assertEqual(k.children("root"), ["a", "b"])  # 字典序
        self.assertEqual(k.children("a"), ["a1"])
        self.assertEqual(k.descendants("root"), ["a", "a1", "b"])

    def test_duplicate_and_empty_id(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 1, 1)
        with self.assertRaises(DuplicateNodeError):
            k.create_node("root", 1, 1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("", 1, 1)

    def test_second_root_rejected(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 1, 1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("rogue", 1, 1)

    def test_missing_parent(self) -> None:
        k = QuotaKernel()
        with self.assertRaises(NodeNotFoundError):
            k.create_node("x", 1, 1, parent_id="ghost")

    def test_create_under_disabled_parent(self) -> None:
        k = build_tree()
        k.disable_node("a")
        with self.assertRaises(NodeDisabledError):
            k.create_node("a2", 1, 1, parent_id="a")

    def test_negative_config_rejected(self) -> None:
        k = QuotaKernel()
        with self.assertRaises(InvalidConfigError):
            k.create_node("root", -1, 1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("root", 1, -0.1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("root", 1, 1, burst_capacity=-1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("root", float("nan"), 1)
        with self.assertRaises(InvalidConfigError):
            k.create_node("root", 1, float("inf"))

    def test_delete_non_leaf_and_nonexistent(self) -> None:
        k = build_tree()
        with self.assertRaises(NodeHasChildrenError) as cm:
            k.delete_node("a")
        self.assertEqual(cm.exception.node_id, "a")
        with self.assertRaises(NodeNotFoundError):
            k.delete_node("ghost")
        with self.assertRaises(NodeNotFoundError):
            k.disable_node("ghost")
        with self.assertRaises(NodeNotFoundError):
            k.enable_node("ghost")

    def test_delete_leaves_then_root(self) -> None:
        k = build_tree()
        k.delete_node("a1")
        k.delete_node("a")
        k.delete_node("b")
        self.assertEqual(k.children("root"), [])
        k.delete_node("root")
        self.assertEqual(len(k), 0)
        # 删除后允许重新建根。
        k.create_node("new_root", 1, 1)
        self.assertEqual(k.root_id(), "new_root")

    def test_single_node_boundary(self) -> None:
        k = QuotaKernel()
        k.create_node("solo", 3, 1)
        self.assertTrue(k.request_tokens("solo", 3).ok)
        d = k.request_tokens("solo", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "solo")


# ---------------------------------------------------------------------------
# 2. 令牌桶基础行为与分层扣账
# ---------------------------------------------------------------------------


class TestTokenBucket(unittest.TestCase):
    """稳态桶补充、溢出、零容量、零速率与逐层扣账。"""

    def test_request_deducts_every_layer(self) -> None:
        k = build_tree()
        d = k.request_tokens("a1", 3)
        self.assertTrue(d.ok)
        self.assertEqual(k.node_status("root")["available"], 7)
        self.assertEqual(k.node_status("a")["available"], 3)
        self.assertEqual(k.node_status("a1")["available"], 1)
        assert_invariants(self, k)

    def test_refill_and_overflow(self) -> None:
        k = QuotaKernel()
        k.create_node("x", 5, 10)
        self.assertTrue(k.request_tokens("x", 5).ok)
        k.advance_clock(1)
        # 速率 10 但容量只有 5：补满后溢出，令牌不会凭空超过容量。
        self.assertEqual(k.node_status("x")["available"], 5)

    def test_zero_rate_never_refills(self) -> None:
        k = QuotaKernel()
        k.create_node("x", 5, 0)
        self.assertTrue(k.request_tokens("x", 5).ok)
        k.advance_clock(100)
        self.assertEqual(k.node_status("x")["available"], 0)

    def test_zero_capacity_borrows_entirely(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 10, 0)
        k.create_node("z", 0, 0, parent_id="root")
        d = k.request_tokens("z", 3)  # 自己什么都没有，全部向父借
        self.assertTrue(d.ok)
        self.assertEqual(d.loans_created, ["L1"])
        self.assertEqual(k.node_status("z")["borrowed_in"], 3)
        self.assertEqual(k.node_status("root")["borrowed_out"], 3)
        # 模型 B：root 只出一份钱（借出 3），自身无需再扣 3。
        self.assertEqual(k.node_status("root")["available"], 7)
        # root 只剩 7：再借 8 必然在 root 层被拒。
        d = k.request_tokens("z", 8)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "root")
        assert_invariants(self, k)

    def test_root_exactly_exhausted(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 10, 0)
        k.create_node("a", 10, 0, parent_id="root")
        k.create_node("a1", 0, 0, parent_id="a")
        # a1 借 10：a 全额垫付 10，root 自身记账 10 恰好付清，全部打满。
        d = k.request_tokens("a1", 10)
        self.assertTrue(d.ok)
        self.assertEqual(k.node_status("root")["available"], 0)
        self.assertEqual(k.node_status("a")["available"], 0)
        self.assertEqual(k.node_status("a")["borrowed_out"], 10)
        self.assertEqual(k.node_status("a1")["borrowed_in"], 10)
        # 父级恰好耗尽：多 1 个都不行，瓶颈在直接父节点 a（它已无钱可借）。
        d = k.request_tokens("a1", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "a")
        # 根节点自己再请 1 同样被拒。
        d = k.request_tokens("root", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "root")

    def test_refill_order_independent_of_ids(self) -> None:
        # 两棵同构树：第二棵把父子 ID 的字典序颠倒。补充若依赖 ID 遍历
        # 顺序，两棵树推进时钟后的结果会不同；拓扑序（叶→根）下必须一致。
        def build(root_name: str, child_name: str) -> QuotaKernel:
            k = QuotaKernel()
            k.create_node(root_name, 10, 10, burst_capacity=4)
            k.create_node(child_name, 10, 10, parent_id=root_name)
            # 子请 14：自付 10 借 4；根垫付 4 后自付 10（稳态 6 + 突发 4）。
            d = k.request_tokens(child_name, 14)
            assert d.ok, d.message
            k.advance_clock(1)  # 子补 10 先还 4；根收回后补 10 回到满稳态
            return k

        k1 = build("root", "aaa-child")   # 子 ID 排在父前面
        k2 = build("aaa-root", "zzz-child")  # 父 ID 排在子前面
        snap1 = {"root": k1.node_status("root"),
                 "child": k1.node_status("aaa-child")}
        snap2 = {"root": k2.node_status("aaa-root"),
                 "child": k2.node_status("zzz-child")}
        for role in ("root", "child"):
            for key in ("available", "borrowed_out", "borrowed_in",
                        "burst_remaining"):
                self.assertEqual(snap1[role][key], snap2[role][key])
        self.assertEqual(k1.node_status("root")["available"], 10)
        self.assertEqual(k1.node_status("root")["burst_remaining"], 0)  # 突发不恢复
        self.assertEqual(k1.node_status("aaa-child")["available"], 6)

    def test_request_amount_validation(self) -> None:
        k = build_tree()
        for bad in (0, -1, 1.5, True):
            with self.assertRaises(InvalidConfigError):
                k.request_tokens("a", bad)
        with self.assertRaises(NodeNotFoundError):
            k.request_tokens("ghost", 1)

    def test_clock_rollback_rejected(self) -> None:
        k = build_tree()
        k.advance_clock(5)
        with self.assertRaises(ClockRollbackError):
            k.advance_clock(4)
        # 同刻推进是幂等无操作。
        self.assertEqual(k.advance_clock(5), 5)
        with self.assertRaises(InvalidConfigError):
            k.advance_clock(float("nan"))


# ---------------------------------------------------------------------------
# 3. 同刻竞争
# ---------------------------------------------------------------------------


class TestContention(unittest.TestCase):
    """多个子节点在同一逻辑时刻竞争父级额度。"""

    def test_siblings_compete_same_instant(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 10, 0)
        for name in ("c1", "c2", "c3"):
            k.create_node(name, 10, 0, parent_id="root")
        # 三个子节点各请 4：12 > 10，按到达顺序先到先得。
        d1 = k.request_tokens("c1", 4)
        d2 = k.request_tokens("c2", 4)
        d3 = k.request_tokens("c3", 4)
        self.assertTrue(d1.ok)
        self.assertTrue(d2.ok)
        self.assertFalse(d3.ok)
        self.assertEqual(d3.failing_node_id, "root")
        self.assertEqual(k.node_status("root")["available"], 2)
        assert_invariants(self, k)

    def test_invariant_under_interleaved_burst(self) -> None:
        # 交错突发申请序列，每一步后父级容量约束都必须成立。
        schedule = [
            ("c1", 3), ("c2", 5), ("c1", 2), ("c3", 4),
            ("c2", 1), ("c3", 6), ("c1", 4), ("c2", 3),
        ]
        k = QuotaKernel()
        k.create_node("root", 12, 2, burst_capacity=3)
        for name in ("c1", "c2", "c3"):
            k.create_node(name, 8, 1, parent_id="root", burst_capacity=2)
        accepted = 0
        for name, amount in schedule:
            d = k.request_tokens(name, amount)
            if d.ok:
                accepted += 1
            assert_invariants(self, k)
        self.assertLessEqual(accepted, len(schedule))
        # 不补充时所有子级已用之和不可能超过根容量 12（+根自己的突发）。
        kids_used = sum(
            layer_used(k.node_status(c)) for c in k.children("root")
        )
        root = k.node_status("root")
        self.assertLessEqual(
            kids_used, root["capacity"] + root["burst_capacity"] + 1e-9
        )

    def test_permutation_invariants(self) -> None:
        # 不同到达顺序下结果可以不同，但不变量始终成立、且无异常。
        import itertools

        requests = [("c1", 6), ("c2", 6), ("c3", 6)]
        for perm in itertools.permutations(requests):
            k = QuotaKernel()
            k.create_node("root", 10, 0)
            for name in ("c1", "c2", "c3"):
                k.create_node(name, 10, 0, parent_id="root")
            oks = []
            for name, amount in perm:
                d = k.request_tokens(name, amount)
                oks.append((name, d.ok))
                assert_invariants(self, k)
            self.assertEqual(sum(1 for _, ok in oks if ok), 1)  # 只有一个能成


# ---------------------------------------------------------------------------
# 4. 借用与归还
# ---------------------------------------------------------------------------


class TestBorrowAndRepay(unittest.TestCase):
    """借用记录、FIFO 偿还、部分偿还、链式传播、即借即还。"""

    def setUp(self) -> None:
        self.k = QuotaKernel()
        self.k.create_node("root", 20, 2)
        self.k.create_node("a", 4, 1, parent_id="root")
        self.k.create_node("b", 4, 1, parent_id="root")

    def test_borrow_records_fields(self) -> None:
        k = self.k
        d = k.request_tokens("a", 8)
        self.assertTrue(d.ok)
        self.assertEqual(d.loans_created, ["L1"])
        loan = k.internal_state()["loans"][0]
        self.assertEqual(loan["lender_id"], "root")
        self.assertEqual(loan["borrower_id"], "a")
        self.assertEqual(loan["amount"], 4)
        self.assertEqual(loan["time"], 0)
        # root 只出一份钱：借出 4 + 自身记账 4 = 8。
        self.assertEqual(k.node_status("root")["available"], 12)
        self.assertEqual(k.node_status("root")["borrowed_out"], 4)
        self.assertEqual(k.node_status("a")["borrowed_in"], 4)
        assert_invariants(self, k)

    def test_no_double_lending_near_exhaustion(self) -> None:
        k = self.k
        self.assertTrue(k.request_tokens("a", 8).ok)  # root: 借4+自记4 → 12
        # b 自身付 4 借 4；root 借 4 + 自记 4 → 4。
        self.assertTrue(k.request_tokens("b", 8).ok)
        self.assertEqual(k.node_status("root")["available"], 4)
        self.assertEqual(k.node_status("root")["borrowed_out"], 8)
        # root 实际只剩 4，超额借用必被拒，且同一份令牌不可能借出两次。
        d = k.request_tokens("a", 5)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "root")
        assert_invariants(self, k)

    def test_partial_then_full_fifo_repayment(self) -> None:
        k = self.k
        self.assertTrue(k.request_tokens("a", 8).ok)  # L1 = 4
        k.advance_clock(1)  # a 补充 1，立即还债
        self.assertEqual(k.node_status("a")["borrowed_in"], 3)
        self.assertEqual(k.node_status("a")["available"], 0)  # 补充优先还债
        self.assertEqual(k.node_status("root")["borrowed_out"], 3)
        loan = k.internal_state()["loans"][0]
        self.assertEqual(loan["id"], "L1")
        self.assertEqual(loan["amount"], 3)
        # 再推进 3：a 共补 3 恰好结清，桶仍为 0（没有凭空多出令牌）。
        k.advance_clock(4)
        self.assertEqual(k.internal_state()["loans"], [])
        self.assertEqual(k.node_status("a")["available"], 0)
        # 债务结清后继续补充才注入自己的稳态桶。
        k.advance_clock(5)
        self.assertEqual(k.node_status("a")["available"], 1)
        assert_invariants(self, k)

    def test_fifo_order_across_multiple_loans(self) -> None:
        k = self.k
        # 制造两笔贷款：a 借 4（L1），还清后再借 2（L2）。
        self.assertTrue(k.request_tokens("a", 8).ok)
        k.advance_clock(4)  # L1 结清，a.steady 回 0（供给恰 4）
        self.assertEqual(k.internal_state()["loans"], [])
        self.assertTrue(k.request_tokens("a", 2).ok)  # a 此时为 0 → 借 2
        ids = [loan["id"] for loan in k.internal_state()["loans"]]
        self.assertEqual(ids, ["L2"])

    def test_repayment_propagates_to_grandparent(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 30, 0)
        k.create_node("mid", 8, 0, parent_id="root")
        k.create_node("leaf", 4, 10, parent_id="mid")
        # leaf 请 10：root/mid/leaf 各记账 10。
        # leaf 自付 4 借 6；mid 垫付 6 后自付 2 借 2；root 垫付 2 后自付 8。
        d = k.request_tokens("leaf", 10)
        self.assertTrue(d.ok)
        self.assertEqual(k.node_status("mid")["borrowed_in"], 2)
        self.assertEqual(k.node_status("mid")["borrowed_out"], 6)
        self.assertEqual(k.node_status("leaf")["borrowed_in"], 6)
        self.assertEqual(k.node_status("root")["available"], 20)
        # leaf 补充 10：6 还给 mid；mid 收回的 6 中 2 继续还给 root，
        # 剩 4 成为 mid 的稳态余额；leaf 余 4 注满自己的稳态桶。
        k.advance_clock(1)
        self.assertEqual(k.node_status("leaf")["borrowed_in"], 0)
        self.assertEqual(k.node_status("leaf")["available"], 4)
        self.assertEqual(k.node_status("mid")["borrowed_in"], 0)
        self.assertEqual(k.node_status("mid")["borrowed_out"], 0)
        self.assertEqual(k.node_status("mid")["available"], 4)
        self.assertEqual(k.node_status("root")["available"], 22)
        assert_invariants(self, k)

    def test_immediate_repay_on_disable(self) -> None:
        k = self.k
        # a 请 5：自付 4 借 1。
        self.assertTrue(k.request_tokens("a", 5).ok)
        k.advance_clock(3)  # a 补 3：1 先还债，剩 2 入桶
        self.assertEqual(k.node_status("a")["available"], 2)
        self.assertEqual(k.node_status("a")["borrowed_in"], 0)
        root_before = k.node_status("root")["available"]
        # 此时禁用 a：无债可还，桶内 2 原样保留，root 不受影响。
        result = k.disable_node("a")
        self.assertEqual(result["frozen_debt"], 0)
        self.assertEqual(result["repaid"], [])
        self.assertEqual(k.node_status("a")["available"], 2)
        self.assertEqual(k.node_status("root")["available"], root_before)

    def test_immediate_partial_repay_on_disable(self) -> None:
        k = self.k
        # b 请 8：自付 4 借 4；advance 1：补 1 还债（4→3），桶为 0；
        # 再让 b 无补充地拥有桶余额：换用直接构造 —— b 欠 4、桶 0 时
        # advance 2：补 2，债务 4→2。
        self.assertTrue(k.request_tokens("b", 8).ok)
        k.advance_clock(2)
        self.assertEqual(k.node_status("b")["borrowed_in"], 2)
        # 禁用时桶仍为 0（补充全部优先还债），冻结债务 2。
        result = k.disable_node("b")
        self.assertEqual(result["frozen_debt"], 2)

    def test_frozen_debt_on_disable(self) -> None:
        k = self.k
        self.assertTrue(k.request_tokens("a", 8).ok)  # 欠 4，桶 0
        result = k.disable_node("a")
        self.assertEqual(result["frozen_debt"], 4)
        # 禁用期间不补充、不还债。
        k.advance_clock(10)
        self.assertEqual(k.node_status("a")["borrowed_in"], 4)
        self.assertEqual(k.node_status("a")["available"], 0)
        k.enable_node("a")
        k.advance_clock(14)  # 恢复后补 4 还清，无追补
        self.assertEqual(k.node_status("a")["borrowed_in"], 0)
        assert_invariants(self, k)


# ---------------------------------------------------------------------------
# 5. 突发
# ---------------------------------------------------------------------------


class TestBurst(unittest.TestCase):
    """突发额度、祖先约束、用尽后平滑回落。"""

    def test_burst_allows_over_rate(self) -> None:
        k = QuotaKernel()
        k.create_node("x", 4, 1, burst_capacity=3)
        d = k.request_tokens("x", 7)  # 稳态 4 + 突发 3
        self.assertTrue(d.ok)
        st = k.node_status("x")
        self.assertEqual(st["available"], 0)
        self.assertEqual(st["burst_remaining"], 0)
        self.assertEqual(st["burst_used"], 3)
        # 突发用尽：同刻再请 1 被拒；推进 2 个时间单位后恰好只有 2 个稳态令牌。
        self.assertFalse(k.request_tokens("x", 1).ok)
        k.advance_clock(2)
        self.assertEqual(k.node_status("x")["available"], 2)
        self.assertEqual(k.node_status("x")["burst_remaining"], 0)  # 永不恢复
        self.assertTrue(k.request_tokens("x", 2).ok)
        self.assertFalse(k.request_tokens("x", 1).ok)

    def test_burst_constrained_by_ancestor(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 5, 0)  # 根无突发、只有 5
        k.create_node("c", 100, 0, parent_id="root", burst_capacity=100)
        # 子级突发再多也不能击穿根：整笔 50 在根层就凑不齐。
        d = k.request_tokens("c", 50)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "root")
        # 5 以内可行，其中根只出稳态 5；子级出自己的稳态/突发。
        self.assertTrue(k.request_tokens("c", 5).ok)
        self.assertEqual(k.node_status("root")["available"], 0)
        # 根已耗尽，子级突发剩余再多，多 1 个都不行。
        d = k.request_tokens("c", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "root")
        assert_invariants(self, k)

    def test_burst_zero_is_steady_only(self) -> None:
        k = QuotaKernel()
        k.create_node("x", 2, 0, burst_capacity=0)
        self.assertTrue(k.request_tokens("x", 2).ok)
        d = k.request_tokens("x", 1)
        self.assertFalse(d.ok)
        chain = {layer.node_id: layer for layer in d.layers}
        self.assertEqual(chain["x"].burst_paid, 0)

    def test_burst_used_before_borrow(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 20, 0)
        k.create_node("a", 4, 0, parent_id="root", burst_capacity=3)
        self.assertTrue(k.request_tokens("a", 7).ok)  # 4+3，无需借
        self.assertEqual(k.node_status("a")["borrowed_in"], 0)
        d = k.request_tokens("a", 2)  # 自己空了，向根借 2
        self.assertTrue(d.ok)
        self.assertEqual(k.node_status("a")["borrowed_in"], 2)


# ---------------------------------------------------------------------------
# 6. 禁用与删除回收
# ---------------------------------------------------------------------------


class TestDisableDelete(unittest.TestCase):
    """禁用冻结、子孙拒绝、删除偿还/核销、不影响其他子节点。"""

    def test_disabled_node_rejects_self_and_descendants(self) -> None:
        k = build_tree()
        k.disable_node("a")
        d = k.request_tokens("a", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.reason_code, "node_disabled")
        d = k.request_tokens("a1", 1)
        self.assertFalse(d.ok)
        self.assertEqual(d.failing_node_id, "a")
        self.assertEqual(d.reason_code, "ancestor_disabled")
        # 兄弟分支不受影响。
        self.assertTrue(k.request_tokens("b", 1).ok)

    def test_disable_idempotent_and_no_backfill(self) -> None:
        k = QuotaKernel()
        k.create_node("a", 4, 10)
        self.assertTrue(k.request_tokens("a", 4).ok)
        k.disable_node("a")
        k.advance_clock(5)  # 禁用期间不补
        k.disable_node("a")  # 幂等
        self.assertEqual(k.node_status("a")["available"], 0)
        k.enable_node("a")
        k.enable_node("a")  # 幂等
        k.advance_clock(6)
        self.assertEqual(k.node_status("a")["available"], 4)  # 只补启用后的部分

    def test_repay_passes_through_disabled_node(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 30, 0)
        k.create_node("mid", 8, 0, parent_id="root")
        k.create_node("leaf", 4, 10, parent_id="mid")
        # 同跨级传播场景：leaf 借 6、mid 借 2。
        self.assertTrue(k.request_tokens("leaf", 10).ok)
        k.disable_node("mid")
        # leaf 仍启用：补充 10 后还债，还款穿过被禁用的 mid 继续还给 root。
        k.advance_clock(1)
        self.assertEqual(k.node_status("leaf")["borrowed_in"], 0)
        self.assertEqual(k.node_status("mid")["borrowed_in"], 0)
        self.assertEqual(k.node_status("mid")["borrowed_out"], 0)
        self.assertEqual(k.node_status("mid")["available"], 4)
        self.assertEqual(k.node_status("root")["available"], 22)

    def test_delete_repays_and_forgives_others_unaffected(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 20, 0)
        k.create_node("a", 4, 0, parent_id="root")
        k.create_node("b", 4, 0, parent_id="root")
        self.assertTrue(k.request_tokens("a", 8).ok)  # a 欠 4
        self.assertTrue(k.request_tokens("b", 2).ok)
        root_steady_before = k.node_status("root")["available"]
        result = k.delete_node("a")  # a 桶 0、速率 0：4 全部核销
        self.assertEqual(len(result["forgiven"]), 1)
        self.assertEqual(result["forgiven"][0]["amount"], 4)
        self.assertNotIn("a", k)
        # 核销不凭空补发令牌：root 稳态不变，只是借出账本销记。
        self.assertEqual(k.node_status("root")["available"], root_steady_before)
        self.assertEqual(k.node_status("root")["borrowed_out"], 0)
        # b 完全不受影响，且仍可使用 root 剩余额度。
        self.assertEqual(k.node_status("b")["available"], 2)
        self.assertTrue(k.request_tokens("b", 4).ok)  # b 自付2 + 借 root 2

    def test_delete_with_repayment(self) -> None:
        k = QuotaKernel()
        k.create_node("root", 20, 0)
        k.create_node("a", 4, 10, parent_id="root")
        self.assertTrue(k.request_tokens("a", 8).ok)  # 欠 4
        k.advance_clock(1)  # a 补 10：还 4，剩 6→注满 4（cap-out=4）
        self.assertEqual(k.node_status("a")["borrowed_in"], 0)
        result = k.delete_node("a")
        self.assertEqual(result["forgiven"], [])
        self.assertNotIn("a", k)

    def test_delete_nonexistent_reports_node(self) -> None:
        k = build_tree()
        with self.assertRaises(NodeNotFoundError) as cm:
            k.delete_node("nope")
        self.assertEqual(cm.exception.node_id, "nope")


# ---------------------------------------------------------------------------
# 7. 导出 / 导入
# ---------------------------------------------------------------------------


def _rich_kernel() -> QuotaKernel:
    """构造含部分还贷、突发消耗、禁用节点的复杂状态。"""
    k = QuotaKernel()
    k.create_node("root", 30, 2, burst_capacity=4)
    k.create_node("a", 6, 3, parent_id="root", burst_capacity=2)
    k.create_node("b", 6, 1, parent_id="root")
    k.create_node("a1", 4, 1, parent_id="a")
    k.request_tokens("a", 9)   # a: 稳态6+突发2+借1
    k.request_tokens("b", 8)   # b: 稳态6+借2
    k.request_tokens("a1", 2)
    k.advance_clock(1)         # 部分偿还发生
    k.disable_node("b")
    return k


class TestSerialization(unittest.TestCase):
    """JSON 往返与各种损坏输入。"""

    def test_round_trip_dict(self) -> None:
        k = _rich_kernel()
        data = k.to_dict()
        rebuilt = QuotaKernel.from_dict(data)
        self.assertEqual(rebuilt.to_dict(), data)
        self.assertEqual(rebuilt.clock, k.clock)
        self.assertEqual(rebuilt.internal_state(), k.internal_state())

    def test_round_trip_file(self) -> None:
        k = _rich_kernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snapshot.json")
            k.export_json(path)
            rebuilt = QuotaKernel()
            rebuilt.import_json(path)
            self.assertEqual(rebuilt.to_dict(), k.to_dict())
            # 导入后行为继续可用。
            d1 = rebuilt.request_tokens("a1", 1)
            d2 = k.request_tokens("a1", 1)
            self.assertEqual(d1.ok, d2.ok)

    def test_import_bad_cases(self) -> None:
        good = _rich_kernel().to_dict()
        bad_cases: list[tuple[str, Any]] = []

        bad_cases.append(("顶层不是对象", [1, 2, 3]))
        bad_cases.append(("版本错误", {**good, "version": 99}))
        bad_cases.append(("nodes 缺失", {**good, "nodes": None}))
        d = json.loads(json.dumps(good))
        d["nodes"][0].pop("rate")
        bad_cases.append(("节点缺字段", d))
        d = json.loads(json.dumps(good))
        d["nodes"][1]["id"] = d["nodes"][0]["id"]
        bad_cases.append(("节点标识重复", d))
        d = json.loads(json.dumps(good))
        d["nodes"][1]["id"] = ""
        bad_cases.append(("空标识", d))
        d = json.loads(json.dumps(good))
        d["nodes"][1]["parent_id"] = "ghost"
        bad_cases.append(("孤儿节点", d))
        d = json.loads(json.dumps(good))
        d["nodes"][1]["capacity"] = -3
        bad_cases.append(("负容量", d))
        d = json.loads(json.dumps(good))
        d["nodes"][0]["steady"] = 999
        bad_cases.append(("steady 超容量", d))
        d = json.loads(json.dumps(good))
        d["nodes"][0]["burst"] = 999
        bad_cases.append(("burst 突发容量", d))
        d = json.loads(json.dumps(good))
        d["loans"][0]["amount"] = 0
        bad_cases.append(("借用数量为零", d))
        d = json.loads(json.dumps(good))
        d["loans"][0]["borrower_id"] = "a1"  # a1 的父是 a，不是该贷款的 lender(root)
        bad_cases.append(("借用双方非父子", d))
        d = json.loads(json.dumps(good))
        d["loans"][0]["lender_id"] = "ghost"
        bad_cases.append(("借用引用缺失节点", d))
        d = json.loads(json.dumps(good))
        d["clock"] = -1
        bad_cases.append(("负时钟", d))

        for label, payload in bad_cases:
            with self.subTest(case=label):
                with self.assertRaises(QuotaImportError):
                    QuotaKernel.from_dict(payload)

    def test_import_cycle(self) -> None:
        data = {
            "version": 1,
            "clock": 0,
            "nodes": [
                {"id": "r", "parent_id": None, "capacity": 1, "rate": 1,
                 "burst_capacity": 0, "steady": 1, "burst": 0,
                 "enabled": True, "created_at": 0},
                {"id": "x", "parent_id": "y", "capacity": 1, "rate": 1,
                 "burst_capacity": 0, "steady": 1, "burst": 0,
                 "enabled": True, "created_at": 0},
                {"id": "y", "parent_id": "x", "capacity": 1, "rate": 1,
                 "burst_capacity": 0, "steady": 1, "burst": 0,
                 "enabled": True, "created_at": 0},
            ],
            "loans": [],
        }
        with self.assertRaises(CycleDetectedError):
            QuotaKernel.from_dict(data)

    def test_multiple_roots_rejected(self) -> None:
        data = {
            "version": 1, "clock": 0,
            "nodes": [
                {"id": "r1", "parent_id": None, "capacity": 1, "rate": 1,
                 "burst_capacity": 0, "steady": 1, "burst": 0,
                 "enabled": True, "created_at": 0},
                {"id": "r2", "parent_id": None, "capacity": 1, "rate": 1,
                 "burst_capacity": 0, "steady": 1, "burst": 0,
                 "enabled": True, "created_at": 0},
            ],
            "loans": [],
        }
        with self.assertRaises(QuotaImportError):
            QuotaKernel.from_dict(data)

    def test_failed_import_keeps_state(self) -> None:
        k = _rich_kernel()
        before = k.to_dict()
        for payload in ("not json", {"version": 1}, []):
            with self.assertRaises(QuotaImportError):
                k.import_data(payload)
            self.assertEqual(k.to_dict(), before)

    def test_broken_json_file(self) -> None:
        k = QuotaKernel()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "broken.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not valid json")
            with self.assertRaises(QuotaImportError):
                k.import_json(path)
            with self.assertRaises(QuotaImportError):
                k.import_json(os.path.join(tmp, "missing.json"))
        self.assertEqual(len(k), 0)


# ---------------------------------------------------------------------------
# 8. 拒绝原因链
# ---------------------------------------------------------------------------


class TestReasonChain(unittest.TestCase):
    """原因链顺序、层级状态与最近拒绝查询。"""

    def test_chain_order_and_not_evaluated(self) -> None:
        k = build_tree()
        # a1 请 11：a1 自付 4 需借 7；a 的稳态桶只有 6，突发与借入令牌
        # 不得转贷 → a 层凑不齐 7，拒绝；root 未评估。
        d = k.request_tokens("a1", 11)
        self.assertFalse(d.ok)
        chain = d.to_dict()["reason_chain"]
        self.assertEqual([layer["node_id"] for layer in chain], ["a1", "a", "root"])
        statuses = {layer["node_id"]: layer["status"] for layer in chain}
        self.assertEqual(statuses["a"], "insufficient")
        self.assertEqual(statuses["a1"], "ok")  # 叶层自身记账成功（含 7 的借入需求）
        self.assertEqual(statuses["root"], "not_evaluated")
        self.assertEqual(chain[0]["depth_from_request"], 0)
        self.assertEqual(chain[2]["depth_from_request"], 2)
        # 拒绝不落任何账。
        self.assertEqual(k.node_status("a1")["available"], 4)
        self.assertEqual(k.node_status("a")["available"], 6)
        self.assertEqual(k.node_status("root")["available"], 10)

    def test_rejection_query_cleared_on_success(self) -> None:
        k = build_tree()
        self.assertFalse(k.request_tokens("a", 99).ok)
        self.assertIsNotNone(k.last_rejection("a"))
        self.assertTrue(k.request_tokens("a", 1).ok)
        self.assertIsNone(k.last_rejection("a"))
        with self.assertRaises(NodeNotFoundError):
            k.last_rejection("ghost")

    def test_denied_result_via_op_runner(self) -> None:
        k = build_tree()
        result = apply_op(k, {"op": "request_tokens", "id": "a", "amount": 99})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error_type"], "denied")
        self.assertIn("reason_chain", result)
        queried = apply_op(k, {"op": "query_rejection", "id": "a"})
        self.assertTrue(queried["ok"])
        self.assertIsNotNone(queried["result"]["rejection"])


# ---------------------------------------------------------------------------
# 9. 确定性与操作流
# ---------------------------------------------------------------------------


class TestDeterminismAndOps(unittest.TestCase):
    """同一序列重复执行完全一致；JSONL 与 CLI 行为。"""

    def test_identical_sequence_identical_results(self) -> None:
        ops = [
            {"op": "create_node", "id": "root", "capacity": 10, "rate": 1,
             "burst_capacity": 2},
            {"op": "create_node", "id": "a", "capacity": 6, "rate": 1,
             "parent_id": "root", "burst_capacity": 2},
            {"op": "create_node", "id": "b", "capacity": 6, "rate": 1,
             "parent_id": "root"},
            {"op": "request_tokens", "id": "a", "amount": 8},
            {"op": "request_tokens", "id": "b", "amount": 6},
            {"op": "advance_clock", "time": 1},
            {"op": "request_tokens", "id": "b", "amount": 1},
            {"op": "node_status", "id": "root"},
            {"op": "total_used"},
            {"op": "internal_state"},
            {"op": "query_rejection", "id": "b"},
        ]

        def run() -> list[dict]:
            k = QuotaKernel()
            return [apply_op(k, op) for op in ops]

        first = json.dumps(run(), ensure_ascii=False, sort_keys=True)
        second = json.dumps(run(), ensure_ascii=False, sort_keys=True)
        self.assertEqual(first, second)

    def test_jsonl_runner_and_cli(self) -> None:
        lines = [
            json.dumps({"op": "create_node", "id": "r", "capacity": 3, "rate": 1}),
            "{broken json",
            json.dumps({"op": "request_tokens", "id": "r", "amount": 2}),
            json.dumps({"op": "request_tokens", "id": "r", "amount": 9}),
            json.dumps({"op": "unknown"}),
            json.dumps({"op": "request_tokens", "id": "r"}),  # 缺字段
        ]
        k = QuotaKernel()
        results = process_jsonl(k, lines)
        self.assertEqual(len(results), 6)
        self.assertTrue(results[0]["ok"])
        self.assertEqual(results[1]["error_type"], "MalformedJSON")
        self.assertTrue(results[2]["ok"])
        self.assertFalse(results[3]["ok"])
        self.assertEqual(results[3]["error_type"], "denied")
        self.assertEqual(results[4]["error_type"], "UnknownOp")
        self.assertEqual(results[5]["error_type"], "MissingField")
        # 损坏行没有破坏状态。
        self.assertEqual(k.node_status("r")["available"], 1)

        inp = io.StringIO("\n".join(lines) + "\n")
        out = io.StringIO()
        self.assertEqual(main(stdin=inp, stdout=out), 0)
        cli_lines = [line for line in out.getvalue().splitlines() if line]
        self.assertEqual(len(cli_lines), 6)
        for line in cli_lines:
            json.loads(line)  # 每行都是合法 JSON

    def test_export_import_via_ops(self) -> None:
        k = build_tree()
        k.request_tokens("a", 7)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            exported = apply_op(k, {"op": "export", "path": path})
            self.assertTrue(exported["ok"])
            k2 = QuotaKernel()
            imported = apply_op(k2, {"op": "import", "path": path})
            self.assertTrue(imported["ok"])
            self.assertEqual(k2.to_dict(), k.to_dict())
        # 内嵌 data 导入也可用。
        k3 = QuotaKernel()
        result = apply_op(k3, {"op": "import", "data": k.to_dict()})
        self.assertTrue(result["ok"])
        self.assertEqual(k3.to_dict(), k.to_dict())


# ---------------------------------------------------------------------------
# 10. 随机游走守恒
# ---------------------------------------------------------------------------


class TestRandomWalkInvariants(unittest.TestCase):
    """固定种子的混合操作长序列，逐步检查守恒与分层约束。"""

    def test_walk(self) -> None:
        import random

        rng = random.Random(20260914)
        k = QuotaKernel()
        k.create_node("root", 25, 3, burst_capacity=5)
        names = [f"c{i}" for i in range(5)]
        for i, name in enumerate(names):
            k.create_node(name, rng.randint(4, 9), rng.randint(1, 3),
                          parent_id="root", burst_capacity=rng.randint(0, 3))
            assert_invariants(self, k)

        ticks = 0
        for _ in range(400):
            choice = rng.random()
            if choice < 0.7:
                name = rng.choice(names)
                amount = rng.randint(1, 8)
                d = k.request_tokens(name, amount)
                if not d.ok:
                    # 每次拒绝都必须能给出具体层与规则。
                    self.assertIsNotNone(d.failing_node_id)
                    self.assertTrue(d.reason_code)
            elif choice < 0.9:
                ticks += rng.randint(1, 3)
                k.advance_clock(ticks)
            else:
                st = k.node_status(rng.choice(names))
                self.assertGreaterEqual(st["available"], 0)
            assert_invariants(self, k)


if __name__ == "__main__":
    unittest.main(verbosity=2)
