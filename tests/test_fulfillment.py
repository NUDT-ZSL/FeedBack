"""履约协同模块单元测试，对应 8 条验收要求。

运行方式（仓库根目录）：
    python -m unittest discover -s tests -t . -v
"""

import json
import os
import tempfile
import unittest

from fulfillment import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    STATUS_PENDING,
    STATUS_READY,
    CapacityError,
    FulfillmentSystem,
    NotFoundError,
    PersistenceError,
    StateError,
    ValidationError,
)


def make_diamond_system():
    """构造菱形依赖：A -> B,C -> D（数量 10+20+30+40=100）。"""
    s = FulfillmentSystem()
    s.create_demand("D1", 100)
    s.add_node("N1", 10)
    s.split_demand(
        "D1",
        [
            {"id": "A", "quantity": 10},
            {"id": "B", "quantity": 20, "prerequisites": ["A"]},
            {"id": "C", "quantity": 30, "prerequisites": ["A"]},
            {"id": "D", "quantity": 40, "prerequisites": ["B", "C"]},
        ],
    )
    return s


class TestDemandAndSplit(unittest.TestCase):
    """要求 1、2：批次合法性、拆分守恒、确定性。"""

    def test_demand_total_must_be_positive(self):
        s = FulfillmentSystem()
        for bad in (0, -5, 1.5, "10", None, True):
            with self.assertRaises(ValidationError, msg=f"total={bad!r}"):
                s.create_demand("D1", bad)

    def test_duplicate_demand_rejected(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        with self.assertRaises(ValidationError):
            s.create_demand("D1", 10)

    def test_batch_quantity_must_be_positive(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        for bad in (0, -1, 2.5, "5", None):
            with self.assertRaises(ValidationError, msg=f"qty={bad!r}"):
                s.split_demand("D1", [{"id": "A", "quantity": bad}])

    def test_split_sum_must_equal_demand_total(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        with self.assertRaises(ValidationError):  # 少了
            s.split_demand("D1", [{"id": "A", "quantity": 4},
                                  {"id": "B", "quantity": 5}])
        with self.assertRaises(ValidationError):  # 多了
            s.split_demand("D1", [{"id": "A", "quantity": 6},
                                  {"id": "B", "quantity": 5}])
        # 失败的拆分不留任何批次
        self.assertEqual(s.demand_batches("D1"), [])

    def test_prerequisite_must_exist(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        with self.assertRaises(NotFoundError):
            s.split_demand(
                "D1",
                [{"id": "A", "quantity": 5},
                 {"id": "B", "quantity": 5, "prerequisites": ["ZZ"]}],
            )

    def test_self_prerequisite_rejected(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        with self.assertRaises(ValidationError):
            s.split_demand("D1", [{"id": "A", "quantity": 10, "prerequisites": ["A"]}])

    def test_cycle_rejected(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 30)
        with self.assertRaises(ValidationError) as ctx:
            s.split_demand(
                "D1",
                [
                    {"id": "A", "quantity": 10, "prerequisites": ["C"]},
                    {"id": "B", "quantity": 10, "prerequisites": ["A"]},
                    {"id": "C", "quantity": 10, "prerequisites": ["B"]},
                ],
            )
        self.assertIn("环", str(ctx.exception))
        self.assertEqual(s.demand_batches("D1"), [])

    def test_duplicate_batch_id_rejected(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        with self.assertRaises(ValidationError):
            s.split_demand("D1", [{"id": "A", "quantity": 5},
                                  {"id": "A", "quantity": 5}])

    def test_batch_id_globally_unique(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        s.create_demand("D2", 10)
        s.split_demand("D1", [{"id": "A", "quantity": 10}])
        with self.assertRaises(ValidationError):
            s.split_demand("D2", [{"id": "A", "quantity": 10}])

    def test_split_evenly_is_deterministic(self):
        def build():
            s = FulfillmentSystem()
            s.create_demand("D", 10)
            s.split_evenly("D", 3)
            return [(b.id, b.quantity, b.prerequisites) for b in s.demand_batches("D")]

        first, second = build(), build()
        self.assertEqual(first, second)
        self.assertEqual([q for _, q, _ in first], [4, 3, 3])
        self.assertEqual([i for i, _, _ in first], ["D-B001", "D-B002", "D-B003"])

    def test_split_evenly_rejects_too_many_parts(self):
        s = FulfillmentSystem()
        s.create_demand("D", 3)
        with self.assertRaises(ValidationError):
            s.split_evenly("D", 5)

    def test_resplit_same_plan_is_idempotent(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        plan = [{"id": "A", "quantity": 4}, {"id": "B", "quantity": 6}]
        first = s.split_demand("D1", plan)
        event_count = len(s.events)
        second = s.split_demand("D1", plan)
        self.assertEqual([b.id for b in first], [b.id for b in second])
        self.assertEqual(len(s.demand_batches("D1")), 2)
        self.assertEqual(len(s.events), event_count)  # 幂等，不重复记录

    def test_resplit_different_plan_rejected(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        s.split_demand("D1", [{"id": "A", "quantity": 10}])
        with self.assertRaises(ValidationError):
            s.split_demand("D1", [{"id": "B", "quantity": 10}])

    def test_split_with_node_assignment_validates_capacity_first(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 10)
        s.add_node("N1", 1)
        with self.assertRaises(CapacityError):
            s.split_demand(
                "D1",
                [{"id": "A", "quantity": 5, "node_id": "N1"},
                 {"id": "B", "quantity": 5, "node_id": "N1"}],
            )
        # 预校验失败，批次不应被创建
        self.assertEqual(s.demand_batches("D1"), [])


class TestNodeCapacity(unittest.TestCase):
    """要求 3：容量上限、拒绝说明剩余量、拒绝不改变已有承接。"""

    def setUp(self):
        self.s = FulfillmentSystem()
        self.s.create_demand("D1", 30)
        self.s.add_node("N1", 1)
        self.s.split_demand(
            "D1",
            [{"id": "A", "quantity": 10},
             {"id": "B", "quantity": 20}],
        )

    def test_assign_within_capacity(self):
        self.s.assign_batch("A", "N1")
        st = self.s.node_status("N1")
        self.assertEqual(st["load"], 1)
        self.assertEqual(st["remaining"], 0)

    def test_over_capacity_rejected_with_remaining_and_no_side_effect(self):
        self.s.assign_batch("A", "N1")
        before = json.dumps(self.s.dump(), sort_keys=True)
        with self.assertRaises(CapacityError) as ctx:
            self.s.assign_batch("B", "N1")
        self.assertIn("剩余可承接量 0", str(ctx.exception))
        self.assertEqual(ctx.exception.remaining, 0)
        # 拒绝不得改变任何已有承接与日志
        self.assertEqual(json.dumps(self.s.dump(), sort_keys=True), before)
        self.assertIsNone(self.s.batch_info("B")["node_id"])
        self.assertEqual(self.s.node_status("N1")["batches"], ["A"])

    def test_assign_to_unknown_node(self):
        with self.assertRaises(NotFoundError):
            self.s.assign_batch("A", "NOPE")

    def test_double_assign_rejected(self):
        self.s.add_node("N2", 1)
        self.s.assign_batch("A", "N1")
        with self.assertRaises(StateError):
            self.s.assign_batch("A", "N2")

    def test_completion_does_not_reduce_cumulative_load(self):
        # 累计口径：批次完成后已承接量不回落，剩余容量不释放
        self.s.assign_batch("A", "N1")
        self.s.start_batch("A")
        self.s.complete_batch("A")
        st = self.s.node_status("N1")
        self.assertEqual(st["load"], 1)
        self.assertEqual(st["remaining"], 0)
        self.assertEqual(st["batches"], [])  # 在途列表为空
        with self.assertRaises(CapacityError):  # 剩余 0，新批次进不来
            self.s.assign_batch("B", "N1")


class TestAdvancement(unittest.TestCase):
    """要求 4：前置完成才能开始；只推进直接后继；与从头推导一致。"""

    def assert_ready_consistent(self, s, demand_id):
        """任意时刻 ready/pending 集合必须等于从头推导的结果。"""
        batches = {b.id: b for b in s.demand_batches(demand_id)}
        for b in batches.values():
            prereqs_done = all(
                batches[p].status == STATUS_COMPLETED for p in b.prerequisites
            )
            if b.status == STATUS_READY:
                self.assertTrue(prereqs_done, f"{b.id} 前置未完成却是 ready")
            elif b.status == STATUS_PENDING:
                self.assertFalse(prereqs_done, f"{b.id} 前置已完成却仍 pending")

    def test_initial_status(self):
        s = make_diamond_system()
        status = {b.id: b.status for b in s.demand_batches("D1")}
        self.assertEqual(status["A"], STATUS_READY)
        self.assertEqual(status["B"], STATUS_PENDING)
        self.assertEqual(status["C"], STATUS_PENDING)
        self.assertEqual(status["D"], STATUS_PENDING)

    def test_cannot_start_before_prerequisites(self):
        s = make_diamond_system()
        s.assign_batch("B", "N1")
        with self.assertRaises(StateError) as ctx:
            s.start_batch("B")
        self.assertIn("A", str(ctx.exception))

    def test_chain_promotes_only_direct_successors(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 60)
        s.add_node("N1", 10)
        s.split_demand(
            "D1",
            [{"id": "A", "quantity": 10},
             {"id": "B", "quantity": 20, "prerequisites": ["A"]},
             {"id": "C", "quantity": 30, "prerequisites": ["B"]}],
        )
        for bid in ("A", "B", "C"):
            s.assign_batch(bid, "N1")
        s.start_batch("A")
        promoted = s.complete_batch("A")
        self.assertEqual([b.id for b in promoted], ["B"])
        # C 只是间接受 A 约束，不应被推进
        self.assertEqual(s.batch_info("C")["status"], STATUS_PENDING)
        self.assert_ready_consistent(s, "D1")

    def test_diamond_promotion_and_consistency(self):
        s = make_diamond_system()
        for bid in ("A", "B", "C", "D"):
            s.assign_batch(bid, "N1")
        s.start_batch("A")
        promoted = s.complete_batch("A")
        self.assertEqual([b.id for b in promoted], ["B", "C"])
        self.assert_ready_consistent(s, "D1")

        s.start_batch("B")
        self.assertEqual(s.complete_batch("B"), [])  # D 还在等 C
        self.assertEqual(s.batch_info("D")["status"], STATUS_PENDING)
        self.assert_ready_consistent(s, "D1")

        s.start_batch("C")
        promoted = s.complete_batch("C")
        self.assertEqual([b.id for b in promoted], ["D"])
        self.assert_ready_consistent(s, "D1")

        s.start_batch("D")
        s.complete_batch("D")
        self.assertTrue(
            all(b.status == STATUS_COMPLETED for b in s.demand_batches("D1"))
        )

    def test_execution_order_matches_from_scratch_derivation(self):
        s = make_diamond_system()
        for bid in ("A", "B", "C", "D"):
            s.assign_batch(bid, "N1")
        executed = []
        # 按系统推进顺序执行：每步从 ready 批次中选标识最小者
        while True:
            ready = sorted(
                b.id for b in s.demand_batches("D1") if b.status == STATUS_READY
            )
            if not ready:
                break
            bid = ready[0]
            s.start_batch(bid)
            s.complete_batch(bid)
            executed.append(bid)
        self.assertEqual(executed, s.executable_order("D1"))
        self.assertEqual(executed, ["A", "B", "C", "D"])

    def test_complete_requires_in_progress(self):
        s = make_diamond_system()
        with self.assertRaises(StateError):
            s.complete_batch("A")


class TestReassign(unittest.TestCase):
    """要求 5：节点下线/容量不足时的改派。"""

    def setUp(self):
        self.s = FulfillmentSystem()
        self.s.create_demand("D1", 100)
        self.s.add_node("N1", 2)
        self.s.add_node("N2", 1)
        self.s.add_node("N3", 5)
        self.s.split_demand(
            "D1",
            [{"id": "A", "quantity": 40, "node_id": "N1"},
             {"id": "B", "quantity": 60, "prerequisites": ["A"], "node_id": "N1"}],
        )

    def test_offline_node_blocks_start_then_reassign(self):
        s = self.s
        s.set_node_online("N1", False)
        with self.assertRaises(StateError):
            s.start_batch("A")
        s.reassign_batch("A", "N3")
        # 归属唯一：A 只挂在 N3 名下，N1 的在途列表不再持有它
        self.assertEqual(s.batch_info("A")["node_id"], "N3")
        self.assertEqual(s.node_status("N1")["batches"], ["B"])
        self.assertEqual(s.node_status("N3")["batches"], ["A"])
        holders = [
            n for n in ("N1", "N2", "N3") if "A" in s.node_status(n)["batches"]
        ]
        self.assertEqual(holders, ["N3"])
        # 累计口径：N1 承接过 A、B，改派出 A 不扣减
        self.assertEqual(s.node_status("N1")["load"], 2)
        self.assertEqual(s.node_status("N3")["load"], 1)
        s.start_batch("A")  # 改派后可以开工
        self.assertEqual(s.batch_info("A")["status"], STATUS_IN_PROGRESS)

    def test_reassign_keeps_quantity_and_prerequisites(self):
        s = self.s
        s.reassign_batch("B", "N3")
        info = s.batch_info("B")
        self.assertEqual(info["quantity"], 60)
        self.assertEqual(info["prerequisites"], ["A"])

    def test_batch_never_on_two_nodes(self):
        s = self.s
        s.reassign_batch("A", "N2")
        holders = [
            nid
            for nid in ("N1", "N2", "N3")
            if "A" in s.node_status(nid)["batches"]
        ]
        self.assertEqual(holders, ["N2"])

    def test_reassign_to_full_node_rejected(self):
        s = self.s
        s.create_demand("D2", 5)
        s.split_demand("D2", [{"id": "X", "quantity": 5, "node_id": "N2"}])  # N2 满
        before = json.dumps(s.dump(), sort_keys=True)
        with self.assertRaises(CapacityError):
            s.reassign_batch("A", "N2")
        self.assertEqual(json.dumps(s.dump(), sort_keys=True), before)
        self.assertEqual(s.batch_info("A")["node_id"], "N1")

    def test_reassign_to_offline_node_rejected(self):
        s = self.s
        s.set_node_online("N3", False)
        with self.assertRaises(StateError):
            s.reassign_batch("A", "N3")

    def test_completed_batch_cannot_be_reassigned(self):
        s = self.s
        s.start_batch("A")
        s.complete_batch("A")
        with self.assertRaises(StateError):
            s.reassign_batch("A", "N3")

    def test_auto_reassign_picks_most_remaining_then_smallest_id(self):
        s = self.s
        # N2 剩余 1，N3 剩余 5 -> 选 N3
        moved = s.auto_reassign("A")
        self.assertEqual(moved.node_id, "N3")
        # N3 容量改为与 N2 相同 -> 并列时选标识最小者
        s2 = FulfillmentSystem()
        s2.create_demand("D", 10)
        s2.add_node("M1", 1)
        s2.add_node("M2", 2)
        s2.add_node("M3", 2)
        s2.split_demand("D", [{"id": "A", "quantity": 10, "node_id": "M1"}])
        self.assertEqual(s2.auto_reassign("A").node_id, "M2")

    def test_auto_reassign_no_candidate(self):
        s = FulfillmentSystem()
        s.create_demand("D", 10)
        s.add_node("ONLY", 1)
        s.split_demand("D", [{"id": "A", "quantity": 10, "node_id": "ONLY"}])
        s.set_node_online("ONLY", False)
        with self.assertRaises(CapacityError):
            s.auto_reassign("A")

    def test_cumulative_load_monotonic_across_operations(self):
        s = self.s
        history = []

        def snapshot():
            history.append({n: s.node_status(n)["load"] for n in ("N1", "N2", "N3")})

        snapshot()
        s.start_batch("A")
        s.complete_batch("A")          # 完成不扣减
        snapshot()
        s.reassign_batch("B", "N3")    # 改派出不扣减，新节点 +1
        snapshot()
        s.set_node_online("N1", False)
        s.auto_reassign("B")           # N1 已下线，B 被改派到唯一有余量的 N2
        snapshot()

        for prev, cur in zip(history, history[1:]):
            for node_id in prev:
                self.assertGreaterEqual(
                    cur[node_id], prev[node_id],
                    f"节点 {node_id} 已承接量出现回落: {prev} -> {cur}",
                )
        # 任意时刻剩余容量与累计口径自洽
        for node_id in ("N1", "N2", "N3"):
            st = s.node_status(node_id)
            self.assertEqual(st["remaining"], st["capacity"] - st["load"])
            self.assertGreaterEqual(st["remaining"], 0)


class TestQueries(unittest.TestCase):
    """要求 6：各类查询与稳定顺序。"""

    def test_demand_batches_sorted(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 60)
        s.split_demand(
            "D1",
            [{"id": "C", "quantity": 20},
             {"id": "A", "quantity": 20},
             {"id": "B", "quantity": 20}],
        )
        self.assertEqual([b.id for b in s.demand_batches("D1")], ["A", "B", "C"])

    def test_batch_info(self):
        s = make_diamond_system()
        info = s.batch_info("D")
        self.assertEqual(
            info,
            {"id": "D", "demand_id": "D1", "quantity": 40,
             "status": STATUS_PENDING, "node_id": None,
             "prerequisites": ["B", "C"]},
        )

    def test_node_status(self):
        s = make_diamond_system()
        s.assign_batch("A", "N1")
        s.assign_batch("B", "N1")
        st = s.node_status("N1")
        self.assertEqual(st["capacity"], 10)
        self.assertEqual(st["load"], 2)
        self.assertEqual(st["remaining"], 8)
        self.assertTrue(st["online"])
        self.assertEqual(st["batches"], ["A", "B"])

    def test_prerequisite_chain_to_root(self):
        s = make_diamond_system()
        self.assertEqual(s.prerequisite_chain("D"), ["A", "B", "C"])
        self.assertEqual(s.prerequisite_chain("B"), ["A"])
        self.assertEqual(s.prerequisite_chain("A"), [])

    def test_prerequisite_chain_deep_dag_stable(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 100)
        s.split_demand(
            "D1",
            [{"id": "R1", "quantity": 25},
             {"id": "R2", "quantity": 25},
             {"id": "M", "quantity": 25, "prerequisites": ["R1", "R2"]},
             {"id": "Z", "quantity": 25, "prerequisites": ["M", "R2"]}],
        )
        chain = s.prerequisite_chain("Z")
        self.assertEqual(chain, ["R1", "R2", "M"])  # 根在前的堆序拓扑，稳定
        self.assertEqual(chain, s.prerequisite_chain("Z"))  # 重复查询一致

    def test_unknown_ids_raise_not_found(self):
        s = FulfillmentSystem()
        with self.assertRaises(NotFoundError):
            s.demand_batches("NOPE")
        with self.assertRaises(NotFoundError):
            s.batch_info("NOPE")
        with self.assertRaises(NotFoundError):
            s.node_status("NOPE")
        with self.assertRaises(NotFoundError):
            s.prerequisite_chain("NOPE")


class TestPersistence(unittest.TestCase):
    """要求 7：JSON 存取、载入校验、失败不污染现状。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = os.path.join(self.tmp.name, "state.json")

    def _write(self, data):
        with open(self.path, "w", encoding="utf-8") as fh:
            if isinstance(data, str):
                fh.write(data)
            else:
                json.dump(data, fh, ensure_ascii=False)

    def _loaded_dict(self):
        s = make_diamond_system()
        s.assign_batch("A", "N1")
        s.start_batch("A")
        s.complete_batch("A")
        return s, s.dump()

    def test_round_trip_preserves_everything(self):
        s = make_diamond_system()
        s.add_node("N2", 3)
        s.assign_batch("A", "N1")
        s.assign_batch("B", "N1")
        s.reassign_batch("B", "N2")  # N1 累计 2（改派出不扣减），N2 累计 1
        s.start_batch("A")
        s.complete_batch("A")        # 完成也不扣减
        s.save(self.path)
        loaded = FulfillmentSystem.load(self.path)
        self.assertEqual(
            json.dumps(s.dump(), sort_keys=True),
            json.dumps(loaded.dump(), sort_keys=True),
        )
        # 累计承接量经往返保持不变
        self.assertEqual(loaded.node_status("N1")["load"], 2)
        self.assertEqual(loaded.node_status("N1")["remaining"], 8)
        self.assertEqual(loaded.node_status("N2")["load"], 1)
        # 载入后可以继续推进，事件序号连续
        loaded.start_batch("B")
        loaded.complete_batch("B")
        seqs = [e["seq"] for e in loaded.events]
        self.assertEqual(seqs, list(range(1, len(seqs) + 1)))

    def test_save_does_not_leave_tmp_file(self):
        make_diamond_system().save(self.path)
        self.assertFalse(os.path.exists(self.path + ".tmp"))

    def test_missing_file(self):
        with self.assertRaises(PersistenceError):
            FulfillmentSystem.load(os.path.join(self.tmp.name, "nope.json"))

    def test_corrupt_json(self):
        self._write("{ not valid json")
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("JSON", str(ctx.exception))

    def test_missing_required_field(self):
        _, data = self._loaded_dict()
        del data["batches"]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("batches", str(ctx.exception))

    def test_missing_nested_field(self):
        _, data = self._loaded_dict()
        del data["batches"][0]["quantity"]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("quantity", str(ctx.exception))

    def test_duplicate_ids_rejected(self):
        _, data = self._loaded_dict()
        data["batches"].append(dict(data["batches"][0]))
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("重复", str(ctx.exception))

    def test_quantity_conservation_enforced(self):
        _, data = self._loaded_dict()
        data["batches"][0]["quantity"] += 1
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("不守恒", str(ctx.exception))

    def test_missing_prerequisite_rejected(self):
        _, data = self._loaded_dict()
        for b in data["batches"]:
            if b["id"] == "B":
                b["prerequisites"] = ["GHOST"]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("GHOST", str(ctx.exception))

    def test_cycle_rejected(self):
        _, data = self._loaded_dict()
        for b in data["batches"]:
            if b["id"] == "A":
                b["prerequisites"] = ["D"]  # D 依赖 B,C -> 成环
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("环", str(ctx.exception))

    def test_over_capacity_rejected(self):
        _, data = self._loaded_dict()
        for n in data["nodes"]:
            n["capacity"] = 1
            n["accepted"] = 2  # 累计承接量超过容量上限
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("容量", str(ctx.exception))

    def test_accepted_below_mounted_rejected(self):
        _, data = self._loaded_dict()
        for n in data["nodes"]:
            n["accepted"] = 0  # 但批次 A 仍挂在 N1 名下
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("不一致", str(ctx.exception))

    def test_missing_accepted_field(self):
        _, data = self._loaded_dict()
        del data["nodes"][0]["accepted"]
        self._write(data)
        with self.assertRaises(PersistenceError) as ctx:
            FulfillmentSystem.load(self.path)
        self.assertIn("accepted", str(ctx.exception))

    def test_bad_version_and_bad_event_seq(self):
        _, data = self._loaded_dict()
        data["version"] = 999
        self._write(data)
        with self.assertRaises(PersistenceError):
            FulfillmentSystem.load(self.path)

        _, data = self._loaded_dict()
        data["events"][1]["seq"] = data["events"][0]["seq"]
        self._write(data)
        with self.assertRaises(PersistenceError):
            FulfillmentSystem.load(self.path)

    def test_failed_load_leaves_existing_state_untouched(self):
        s = make_diamond_system()
        before = json.dumps(s.dump(), sort_keys=True)
        self._write("{ broken")
        with self.assertRaises(PersistenceError):
            FulfillmentSystem.load(self.path)
        # 原系统状态不变且仍可正常推进
        self.assertEqual(json.dumps(s.dump(), sort_keys=True), before)
        s.assign_batch("A", "N1")
        s.start_batch("A")
        s.complete_batch("A")
        self.assertEqual(s.batch_info("B")["status"], STATUS_READY)


class TestAcceptanceScenario(unittest.TestCase):
    """要求 8：多批次多节点端到端场景，比对状态、承接量与推进记录。"""

    def test_end_to_end(self):
        s = FulfillmentSystem()
        s.create_demand("D1", 100)
        s.add_node("N1", 2)
        s.add_node("N2", 2)
        s.add_node("N3", 1)

        load_history = []

        def checkpoint():
            """每步校验：剩余容量与累计口径自洽，并记录各节点已承接量。"""
            for n in ("N1", "N2", "N3"):
                st = s.node_status(n)
                self.assertEqual(st["remaining"], st["capacity"] - st["load"])
                self.assertGreaterEqual(st["remaining"], 0)
            load_history.append({n: s.node_status(n)["load"] for n in ("N1", "N2", "N3")})

        def assert_single_ownership():
            """任意时刻同一批次只出现在一个节点的在途列表里。"""
            seen = {}
            for n in ("N1", "N2", "N3"):
                for bid in s.node_status(n)["batches"]:
                    self.assertNotIn(bid, seen, f"批次 {bid} 同时挂在 {seen.get(bid)} 与 {n}")
                    seen[bid] = n
            for b in s.batches:
                if b.status != STATUS_COMPLETED and b.node_id is not None:
                    self.assertEqual(seen.get(b.id), b.node_id)

        batches = s.split_demand(
            "D1",
            [
                {"id": "A", "quantity": 20, "node_id": "N1"},
                {"id": "B", "quantity": 30, "node_id": "N1"},
                {"id": "C", "quantity": 40, "prerequisites": ["A"], "node_id": "N2"},
                {"id": "D", "quantity": 10, "prerequisites": ["B", "C"], "node_id": "N3"},
            ],
        )
        self.assertEqual([b.id for b in batches], ["A", "B", "C", "D"])
        self.assertEqual(sum(b.quantity for b in batches), 100)
        checkpoint()
        assert_single_ownership()

        # 超容量拒绝：N1 已满（A、B），新批次进不来
        s.create_demand("D2", 5)
        s.split_demand("D2", [{"id": "E", "quantity": 5}])
        with self.assertRaises(CapacityError) as ctx:
            s.assign_batch("E", "N1")
        self.assertIn("剩余可承接量 0", str(ctx.exception))
        self.assertIsNone(s.batch_info("E")["node_id"])
        self.assertEqual(s.node_status("N1")["batches"], ["A", "B"])
        checkpoint()

        # 推进 A -> 只有直接后继 C 被解除阻塞
        s.start_batch("A")
        promoted = s.complete_batch("A")
        self.assertEqual([b.id for b in promoted], ["C"])
        self.assertEqual(s.batch_info("C")["status"], STATUS_READY)
        self.assertEqual(s.batch_info("D")["status"], STATUS_PENDING)
        checkpoint()

        # N1 下线 -> B 无法开工 -> 改派到 N2（N2 剩余 1）
        s.set_node_online("N1", False)
        with self.assertRaises(StateError):
            s.start_batch("B")
        s.reassign_batch("B", "N2")
        # 归属唯一：B 只挂在 N2，N1 在途列表为空（A 已完成、B 已改派）
        self.assertEqual(s.node_status("N1")["batches"], [])
        self.assertEqual(s.node_status("N2")["batches"], ["B", "C"])
        assert_single_ownership()
        # 累计口径：N1 承接过 A、B 共 2 个，改派出 B 不扣减；N2 累计 2
        self.assertEqual(s.node_status("N1")["load"], 2)
        self.assertEqual(s.node_status("N2")["load"], 2)
        self.assertEqual(s.node_status("N2")["remaining"], 0)
        checkpoint()
        # 改派不改变数量与前置
        self.assertEqual(s.batch_info("B")["quantity"], 30)
        self.assertEqual(s.batch_info("B")["prerequisites"], [])

        # 继续推进到全部完成
        s.start_batch("B")
        s.start_batch("C")
        self.assertEqual(s.complete_batch("B"), [])  # D 仍等 C
        promoted = s.complete_batch("C")
        self.assertEqual([b.id for b in promoted], ["D"])
        s.start_batch("D")
        s.complete_batch("D")
        self.assertTrue(all(b.status == STATUS_COMPLETED for b in s.demand_batches("D1")))
        checkpoint()
        assert_single_ownership()

        # 各节点已承接量全程单调不减
        for prev, cur in zip(load_history, load_history[1:]):
            for node_id in prev:
                self.assertGreaterEqual(
                    cur[node_id], prev[node_id],
                    f"节点 {node_id} 已承接量回落: {prev} -> {cur}",
                )

        # 推进记录必须与逐步推导一致
        log = [(e["type"], e.get("batch_id")) for e in s.advancement_log()]
        self.assertEqual(
            log,
            [
                ("batch_started", "A"),
                ("batch_completed", "A"),
                ("batch_promoted", "C"),
                ("batch_started", "B"),
                ("batch_started", "C"),
                ("batch_completed", "B"),
                ("batch_completed", "C"),
                ("batch_promoted", "D"),
                ("batch_started", "D"),
                ("batch_completed", "D"),
            ],
        )
        # 可执行顺序与从头推导一致
        self.assertEqual(s.executable_order("D1"), ["A", "B", "C", "D"])
        # 前置链查询
        self.assertEqual(s.prerequisite_chain("D"), ["A", "B", "C"])

        # 持久化往返后状态、承接量、推进记录完全一致
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "acceptance.json")
            s.save(path)
            loaded = FulfillmentSystem.load(path)
        self.assertEqual(
            json.dumps(s.dump(), sort_keys=True),
            json.dumps(loaded.dump(), sort_keys=True),
        )
        # 导出再导入后各节点数值不变（累计口径：完成/改派不扣减）
        for n in ("N1", "N2", "N3"):
            self.assertEqual(loaded.node_status(n), s.node_status(n))
        self.assertEqual(loaded.node_status("N1")["load"], 2)
        self.assertEqual(loaded.node_status("N2")["load"], 2)
        self.assertEqual(loaded.node_status("N2")["remaining"], 0)
        self.assertEqual(loaded.node_status("N3")["load"], 1)


if __name__ == "__main__":
    unittest.main()
