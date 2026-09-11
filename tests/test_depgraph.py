"""DependencyGraph 引擎单元测试。

覆盖：基础校验、显式环检测、脏标记传播（含菱形去重与顺序无关）、
计划门控与排序、受影响集合、解释链、节点删除、快照往返与坏快照、
边界情况，以及 main.py 的逐行 JSON 协议端到端测试。
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from depgraph import (  # noqa: E402
    CyclicDependencyError,
    DependencyGraph,
    DuplicateNodeError,
    GraphError,
    InvalidSnapshotError,
    NodeNotFoundError,
    ValidationError,
)
import main as cli  # noqa: E402


def make_chain() -> DependencyGraph:
    """构造 A→B→C 并全部确认干净。"""
    g = DependencyGraph()
    g.add_node("a", "fa1", [])
    g.add_node("b", "fb1", ["a"])
    g.add_node("c", "fc1", ["b"])
    g.mark_clean("a")
    g.mark_clean("b")
    g.mark_clean("c")
    return g


def make_diamond() -> DependencyGraph:
    """构造菱形 a → {b, c} → d，并全部确认干净。"""
    g = DependencyGraph()
    g.add_node("a", "fa", [])
    g.add_node("b", "fb", ["a"])
    g.add_node("c", "fc", ["a"])
    g.add_node("d", "fd", ["b", "c"])
    for nid in ("a", "b", "c", "d"):
        g.mark_clean(nid)
    return g


class RegistrationValidationTest(unittest.TestCase):
    """需求 1、11：注册校验与边界情况。"""

    def test_empty_graph_plan_is_empty(self) -> None:
        self.assertEqual(DependencyGraph().get_plan(), [])
        self.assertEqual(DependencyGraph().get_status(), {})
        self.assertEqual(DependencyGraph().topo_sort(), [])

    def test_single_node_lifecycle(self) -> None:
        g = DependencyGraph()
        g.add_node("x", "fx", [])
        self.assertEqual(g.status_of("x"), "dirty")  # 新节点从未确认
        self.assertEqual(g.get_plan(), ["x"])
        g.mark_clean("x")
        self.assertEqual(g.status_of("x"), "clean")
        self.assertEqual(g.get_plan(), [])

    def test_empty_id_or_fingerprint_rejected(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(ValidationError):
            g.add_node("", "f", [])
        with self.assertRaises(ValidationError):
            g.add_node("x", "", [])
        with self.assertRaises(ValidationError):
            g.update_fingerprint("x", "")

    def test_wrong_types_rejected(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(ValidationError):
            g.add_node(123, "f", [])  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            g.add_node("x", "f", "a")  # type: ignore[arg-type]
        with self.assertRaises(ValidationError):
            g.add_node("x", "f", [1])  # type: ignore[list-item]

    def test_duplicate_node_raises(self) -> None:
        g = DependencyGraph()
        g.add_node("x", "f1", [])
        with self.assertRaises(DuplicateNodeError) as ctx:
            g.add_node("x", "f2", [])
        self.assertIn("x", str(ctx.exception))

    def test_missing_dependency_lists_missing_ids(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(NodeNotFoundError) as ctx:
            g.add_node("x", "fx", ["nope", "ghost"])
        message = str(ctx.exception)
        self.assertIn("ghost", message)
        self.assertIn("nope", message)

    def test_duplicate_dep_rejected(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "fa", [])
        with self.assertRaises(ValidationError):
            g.add_node("b", "fb", ["a", "a"])

    def test_self_dependency_rejected(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(ValidationError):
            g.add_node("loop", "fl", ["loop"])


class CycleDetectionTest(unittest.TestCase):
    """需求 2：显式环检测，给出环上节点序列，不依赖递归。"""

    def _build_two_node_cycle_snapshot(self) -> dict:
        return {
            "version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "fa", "confirmed_fingerprint": "fa",
                 "status": "clean", "deps": ["b"]},
                {"id": "b", "fingerprint": "fb", "confirmed_fingerprint": "fb",
                 "status": "clean", "deps": ["a"]},
            ],
        }

    def test_find_cycle_returns_node_sequence(self) -> None:
        # 正常注册顺序（依赖必须先存在）无法成环，用快照直接构造 a<->b。
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict(self._build_two_node_cycle_snapshot())
        self.assertIn("环", str(ctx.exception))

    def test_find_cycle_on_live_graph(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "fa", [])
        g.add_node("b", "fb", ["a"])
        # 手工制造 a -> b 的回边，验证迭代式 DFS 能显式找环。
        g._nodes["a"].deps.append("b")
        with self.assertRaises(CyclicDependencyError) as ctx:
            g.topo_sort()
        cycle = ctx.exception.cycle
        self.assertEqual(cycle[0], cycle[-1])
        self.assertEqual(set(cycle), {"a", "b"})

    def test_find_cycle_none_for_dag(self) -> None:
        g = make_diamond()
        self.assertIsNone(g.find_cycle())

    def test_long_cycle_does_not_rely_on_recursion(self) -> None:
        # 500 个节点的大环：递归实现会撞栈，迭代式三色 DFS 必须正常报环。
        n = 500
        nodes = [
            {"id": f"n{i}", "fingerprint": "f", "confirmed_fingerprint": "f",
             "status": "clean", "deps": [f"n{(i + 1) % n}"]}
            for i in range(n)
        ]
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict({"version": 1, "nodes": nodes})
        self.assertIn("环", str(ctx.exception))

    def test_long_dag_toposort_deep_chain(self) -> None:
        # 300 层链：拓扑排序同样不能依赖递归。
        g = DependencyGraph()
        g.add_node("n0", "f", [])
        for i in range(1, 300):
            g.add_node(f"n{i}", "f", [f"n{i - 1}"])
        order = g.topo_sort()
        self.assertEqual(len(order), 300)
        self.assertEqual(order.index("n0"), 0)
        self.assertEqual(order.index("n299"), 299)


class PropagationTest(unittest.TestCase):
    """需求 3：指纹更新、反向传播、菱形去重、顺序无关。"""

    def test_chain_propagation_statuses(self) -> None:
        g = make_chain()
        self.assertTrue(g.update_fingerprint("a", "fa2"))
        self.assertEqual(g.status_of("a"), "dirty")
        self.assertEqual(g.status_of("b"), "pending")
        self.assertEqual(g.status_of("c"), "pending")

    def test_same_fingerprint_is_noop(self) -> None:
        g = make_chain()
        self.assertFalse(g.update_fingerprint("a", "fa1"))
        self.assertEqual(g.get_status(), {"a": "clean", "b": "clean", "c": "clean"})
        self.assertEqual(g.get_plan(), [])

    def test_update_nonexistent_raises(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().update_fingerprint("ghost", "f")

    def test_diamond_propagates_once(self) -> None:
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        # d 同时经由 b、c 两条路径受影响，只能被待定一次——
        # 状态语义上没有计数，反复更新结果应保持 pending 且幂等。
        self.assertEqual(g.status_of("d"), "pending")
        g.update_fingerprint("a", "fa3")
        g.update_fingerprint("a", "fa4")
        self.assertEqual(g.status_of("d"), "pending")
        self.assertEqual(g.get_plan(), ["a"])

    def test_propagation_order_independent(self) -> None:
        """同一批指纹更新，无论按什么顺序到达，最终状态一致。"""
        def build_and_update(order):
            g = make_diamond()
            g.add_node("e", "fe", ["d"])
            g.mark_clean("e")
            for nid in order:
                g.update_fingerprint(nid, f"{nid}-changed")
            return g.get_status()

        statuses_1 = build_and_update(["a", "b", "c"])
        statuses_2 = build_and_update(["c", "a", "b"])
        self.assertEqual(statuses_1, statuses_2)
        self.assertEqual(statuses_1["a"], "dirty")
        self.assertEqual(statuses_1["b"], "dirty")
        self.assertEqual(statuses_1["c"], "dirty")
        self.assertEqual(statuses_1["d"], "pending")
        self.assertEqual(statuses_1["e"], "pending")

    def test_update_downstream_node_only(self) -> None:
        g = make_chain()
        g.update_fingerprint("b", "fb2")
        self.assertEqual(g.status_of("a"), "clean")
        self.assertEqual(g.status_of("b"), "dirty")
        self.assertEqual(g.status_of("c"), "pending")


class PlanTest(unittest.TestCase):
    """需求 4：get_plan 门控语义——A→B→C 核心验收例。"""

    def test_chain_gated_release(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")

        self.assertEqual(g.get_plan(), ["a"])           # 只有 A 可执行
        g.mark_clean("a")
        self.assertEqual(g.get_plan(), ["b"])           # B 未确认，C 不能出现
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["c"])           # C 排在 B 之后才出现
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_plan_is_topo_order_with_deps_first(self) -> None:
        # 多个互相独立的脏节点同时可执行时，顺序仍须满足依赖在前。
        g = DependencyGraph()
        g.add_node("root", "fr", [])
        g.add_node("a", "fa", ["root"])
        g.add_node("b", "fb", ["root"])
        g.add_node("c", "fc", ["a", "b"])
        # 不做任何 mark_clean：全部 dirty，但只有 root 的依赖全干净。
        self.assertEqual(g.get_plan(), ["root"])
        g.mark_clean("root")
        plan = g.get_plan()
        self.assertEqual(set(plan), {"a", "b"})
        self.assertNotIn("c", plan)
        g.mark_clean("a")
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["c"])

    def test_clean_nodes_never_in_plan(self) -> None:
        g = make_chain()
        self.assertEqual(g.get_plan(), [])

    def test_diamond_plan_release(self) -> None:
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        self.assertEqual(g.get_plan(), ["a"])
        g.mark_clean("a")
        self.assertEqual(set(g.get_plan()), {"b", "c"})   # b/c 可并行
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["c"])             # d 仍等 c
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), ["d"])
        g.mark_clean("d")
        self.assertEqual(g.get_plan(), [])


class MarkCleanTest(unittest.TestCase):
    """需求 6：mark_clean 门控与错误信息。"""

    def test_cannot_clean_when_dependency_dirty(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        with self.assertRaises(GraphError) as ctx:
            g.mark_clean("c")
        self.assertIn("a", str(ctx.exception))
        self.assertIn("依赖", str(ctx.exception))
        blockers = getattr(ctx.exception, "blocking", None)
        self.assertTrue(blockers)
        blocker_ids = [nid for nid, _ in blockers]
        self.assertIn("a", blocker_ids)

    def test_cannot_skip_pending_stage(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        g.mark_clean("a")
        # b 现在 pending（指纹相同），仍需先执行；c 还不能确认。
        with self.assertRaises(Exception):
            g.mark_clean("c")

    def test_mark_clean_nonexistent_raises(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().mark_clean("ghost")

    def test_mark_clean_updates_confirmed_fingerprint(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        g.mark_clean("a")
        self.assertEqual(g._nodes["a"].confirmed_fingerprint, "fa2")
        self.assertEqual(g.status_of("a"), "clean")


class AffectedAndExplainTest(unittest.TestCase):
    """需求 5：get_affected / explain_dirty。"""

    def test_get_affected_chain_and_diamond(self) -> None:
        g = make_diamond()
        self.assertEqual(g.get_affected("a"), ["a", "b", "c", "d"])
        self.assertEqual(g.get_affected("b"), ["b", "d"])
        self.assertEqual(g.get_affected("d"), ["d"])

    def test_get_affected_topo_order(self) -> None:
        g = make_chain()
        affected = g.get_affected("a")
        self.assertEqual(affected, ["a", "b", "c"])
        self.assertLess(affected.index("b"), affected.index("c"))

    def test_get_affected_nonexistent_raises(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().get_affected("ghost")

    def test_explain_dirty_direct_source(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        paths = g.explain_dirty("a")
        self.assertEqual(paths, [[{"node": "a", "status": "dirty"}]])

    def test_explain_dirty_chain(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        paths = g.explain_dirty("c")
        self.assertEqual(len(paths), 1)
        path = paths[0]
        self.assertEqual([step["node"] for step in path], ["c", "b", "a"])
        self.assertEqual([step["status"] for step in path],
                         ["pending", "pending", "dirty"])

    def test_explain_dirty_diamond_multiple_paths(self) -> None:
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        paths = g.explain_dirty("d")
        # 菱形：d 可经 b 或 c 到达脏源 a，应给出两条路径。
        self.assertEqual(len(paths), 2)
        node_paths = sorted([[s["node"] for s in p] for p in paths])
        self.assertEqual(node_paths, [["d", "b", "a"], ["d", "c", "a"]])
        for path in paths:
            self.assertEqual(path[-1], {"node": "a", "status": "dirty"})
            self.assertTrue(all(step["status"] in ("dirty", "pending") for step in path))

    def test_explain_clean_node_returns_empty(self) -> None:
        self.assertEqual(make_chain().explain_dirty("c"), [])

    def test_explain_after_partial_confirmation_points_to_pending_root(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        g.mark_clean("a")
        # a 已干净，b 成为最近的非 clean 根源（pending）。
        paths = g.explain_dirty("c")
        self.assertEqual([[s["node"] for s in p] for p in paths], [["c", "b"]])
        self.assertEqual(paths[0][-1]["status"], "pending")

    def test_explain_multiple_dirty_sources(self) -> None:
        g = make_diamond()
        g.update_fingerprint("b", "fb2")
        g.update_fingerprint("c", "fc2")
        paths = g.explain_dirty("d")
        endpoints = sorted(p[-1]["node"] for p in paths)
        self.assertEqual(endpoints, ["b", "c"])


class RemoveNodeTest(unittest.TestCase):
    """需求 7：删除节点、摘除依赖、清理状态、明确返回值。"""

    def test_remove_returns_false_for_missing(self) -> None:
        self.assertFalse(DependencyGraph().remove_node("ghost"))

    def test_remove_unlinks_dependents(self) -> None:
        g = make_chain()
        self.assertTrue(g.remove_node("a"))
        self.assertNotIn("a", g)
        self.assertEqual(g._nodes["b"].deps, [])
        self.assertEqual(g._nodes["c"].deps, ["b"])

    def test_remove_clears_pending_state(self) -> None:
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        self.assertEqual(g.status_of("d"), "pending")
        g.remove_node("a")  # b/c 不再有脏上游
        self.assertEqual(g.status_of("b"), "clean")
        self.assertEqual(g.status_of("c"), "clean")

    def test_remove_middle_node_allows_chain_continue(self) -> None:
        g = make_chain()
        g.update_fingerprint("a", "fa2")
        g.remove_node("b")  # c 对 b 的依赖被摘除
        self.assertEqual(g._nodes["c"].deps, [])
        self.assertNotIn("b", g.get_affected("a"))

    def test_remove_dirty_source_reclaims_only_reachable_pending(self) -> None:
        # a -> b -> d；a -> c -> d。删 a 后 b/c/d 全部失去脏源，待定回收。
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        self.assertTrue(g.remove_node("a"))
        self.assertEqual(g.status_of("b"), "clean")
        self.assertEqual(g.status_of("c"), "clean")
        self.assertEqual(g.status_of("d"), "clean")
        self.assertEqual(g.get_plan(), [])

    def test_remove_branch_keeps_pending_via_other_branch(self) -> None:
        # a 已确认，b/c 仍 pending；此时删掉 b：d 仍经 c 挂在待定链上。
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        g.mark_clean("a")
        self.assertTrue(g.remove_node("b"))
        self.assertEqual(g.status_of("c"), "pending")
        self.assertEqual(g.status_of("d"), "pending")
        self.assertEqual(g._nodes["d"].deps, ["c"])

    def test_remove_unrelated_node_preserves_sticky_pending(self) -> None:
        # 链 x->y 上 a 已确认、y 仍 pending（图中已无 dirty 源）；
        # 删除一个毫无关系的节点不能把 y 洗白。
        g = make_chain()  # a->b->c
        g.add_node("x", "fx", [])
        g.add_node("y", "fy", ["x"])
        g.mark_clean("x")
        g.mark_clean("y")
        g.update_fingerprint("x", "fx2")
        g.mark_clean("x")  # y 仍 pending
        self.assertEqual(g.status_of("y"), "pending")
        self.assertTrue(g.remove_node("c"))  # 与 x/y 无关
        self.assertEqual(g.status_of("y"), "pending")


class SnapshotTest(unittest.TestCase):
    """需求 9：save/load 往返一致性与坏快照报错。"""

    def test_round_trip_preserves_everything(self) -> None:
        g = make_diamond()
        g.update_fingerprint("a", "fa2")
        g.mark_clean("a")
        # 此刻：a clean, b/c pending, d pending
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snap.json")
            g.save(path)
            loaded = DependencyGraph.load(path)
        self.assertEqual(loaded.get_status(), g.get_status())
        self.assertEqual(loaded.get_plan(), g.get_plan())
        self.assertEqual(
            {n: (loaded._nodes[n].fingerprint, loaded._nodes[n].confirmed_fingerprint,
                 loaded._nodes[n].deps) for n in loaded.topo_sort()},
            {n: (g._nodes[n].fingerprint, g._nodes[n].confirmed_fingerprint,
                 g._nodes[n].deps) for n in g.topo_sort()},
        )

    def test_round_trip_empty_graph(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "empty.json")
            DependencyGraph().save(path)
            loaded = DependencyGraph.load(path)
        self.assertEqual(len(loaded), 0)
        self.assertEqual(loaded.get_plan(), [])

    def test_load_missing_file_clear_error(self) -> None:
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.load("definitely-does-not-exist.json")
        self.assertIn("不存在", str(ctx.exception))

    def test_load_corrupt_json_clear_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write("{not valid json")
            with self.assertRaises(InvalidSnapshotError) as ctx:
                DependencyGraph.load(path)
        self.assertIn("JSON", str(ctx.exception))

    def test_load_missing_field_clear_error(self) -> None:
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict({"version": 1})
        self.assertIn("nodes", str(ctx.exception))

    def test_load_node_missing_field(self) -> None:
        snap = {"nodes": [{"id": "a", "fingerprint": "f"}]}
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("confirmed_fingerprint", str(ctx.exception))

    def test_load_missing_dependency_reports_id(self) -> None:
        snap = {"nodes": [{
            "id": "a", "fingerprint": "f", "confirmed_fingerprint": "f",
            "status": "clean", "deps": ["ghost"],
        }]}
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("ghost", str(ctx.exception))

    def test_load_cycle_rejected(self) -> None:
        snap = {"nodes": [
            {"id": "a", "fingerprint": "f", "confirmed_fingerprint": "f",
             "status": "clean", "deps": ["b"]},
            {"id": "b", "fingerprint": "f", "confirmed_fingerprint": "f",
             "status": "clean", "deps": ["a"]},
        ]}
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("环", str(ctx.exception))

    def test_load_empty_fingerprint_rejected(self) -> None:
        snap = {"nodes": [{
            "id": "a", "fingerprint": "", "confirmed_fingerprint": "",
            "status": "dirty", "deps": [],
        }]}
        with self.assertRaises(InvalidSnapshotError):
            DependencyGraph.from_dict(snap)

    def test_load_status_fingerprint_mismatch_rejected(self) -> None:
        # 标记 dirty 但两指纹相同。
        snap = {"nodes": [{
            "id": "a", "fingerprint": "f", "confirmed_fingerprint": "f",
            "status": "dirty", "deps": [],
        }]}
        with self.assertRaises(InvalidSnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("dirty", str(ctx.exception))

        # 标记 clean 但两指纹不同。
        snap["nodes"][0]["confirmed_fingerprint"] = "old"
        snap["nodes"][0]["status"] = "clean"
        with self.assertRaises(InvalidSnapshotError):
            DependencyGraph.from_dict(snap)

    def test_load_duplicate_id_rejected(self) -> None:
        snap = {"nodes": [
            {"id": "a", "fingerprint": "f", "confirmed_fingerprint": "f",
             "status": "clean", "deps": []},
            {"id": "a", "fingerprint": "g", "confirmed_fingerprint": "g",
             "status": "clean", "deps": []},
        ]}
        with self.assertRaises(InvalidSnapshotError):
            DependencyGraph.from_dict(snap)

    def test_load_unordered_nodes_supported(self) -> None:
        # 子节点排在父节点之前（常见的任意存储顺序），也要能重建。
        snap = {"nodes": [
            {"id": "c", "fingerprint": "fc", "confirmed_fingerprint": "fc",
             "status": "clean", "deps": ["b"]},
            {"id": "b", "fingerprint": "fb", "confirmed_fingerprint": "fb",
             "status": "clean", "deps": ["a"]},
            {"id": "a", "fingerprint": "fa", "confirmed_fingerprint": "fa",
             "status": "clean", "deps": []},
        ]}
        g = DependencyGraph.from_dict(snap)
        self.assertEqual(g.topo_sort(), ["a", "b", "c"])

    def test_save_then_update_and_reload(self) -> None:
        g = make_chain()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            g.save(path)
            g.update_fingerprint("a", "changed")
            g.save(path)
            loaded = DependencyGraph.load(path)
        self.assertEqual(loaded.get_plan(), ["a"])
        self.assertEqual(loaded.status_of("c"), "pending")


class LargeGraphAcceptanceTest(unittest.TestCase):
    """需求 12：几十节点、菱形与多层传递的综合验收。"""

    def test_multi_layer_graph_rounds_of_updates(self) -> None:
        g = DependencyGraph()
        # layers: l0(3) -> l1(4) -> l2(3) -> l3(1=sink)，含多父菱形结构。
        layers = [
            [f"l0_{i}" for i in range(3)],
            [f"l1_{i}" for i in range(4)],
            [f"l2_{i}" for i in range(3)],
            ["sink"],
        ]
        prev: list = []
        for depth, layer in enumerate(layers):
            for nid in layer:
                deps = prev if prev else []
                g.add_node(nid, f"fp-{nid}", deps)
            prev = layer

        plan0 = g.get_plan()
        self.assertEqual(set(plan0), set(layers[0]))           # 第一轮只有最底层
        for nid in g.topo_sort():                              # 逐层全部确认
            g.mark_clean(nid)
        self.assertEqual(g.get_plan(), [])

        # 改动一个 l0 节点：全部下游 pending，计划只先释放它。
        g.update_fingerprint("l0_1", "fp-l0_1-v2")
        self.assertEqual(g.get_plan(), ["l0_1"])
        affected = set(g.get_affected("l0_1"))
        self.assertIn("sink", affected)
        self.assertEqual(len(affected), 1 + 4 + 3 + 1)        # 它本身+全部下游

        # 逐层确认直到 sink；任何阶段计划都不得越过未确认层。
        g.mark_clean("l0_1")
        self.assertEqual(set(g.get_plan()), set(layers[1]))
        for nid in layers[1]:
            g.mark_clean(nid)
        self.assertEqual(set(g.get_plan()), set(layers[2]))
        for nid in layers[2]:
            g.mark_clean(nid)
        self.assertEqual(g.get_plan(), ["sink"])
        g.mark_clean("sink")
        self.assertEqual(g.get_plan(), [])

        # 解释链：从 sink 能追溯到改动源（路径已全部确认 → 空）。
        self.assertEqual(g.explain_dirty("sink"), [])


class CliProtocolTest(unittest.TestCase):
    """需求 10：main.py 逐行 JSON 协议。"""

    def run_cli(self, lines: str) -> list:
        out = io.StringIO()
        old_out, old_in = sys.stdout, sys.stdin
        sys.stdout = out
        sys.stdin = io.StringIO(lines)
        try:
            code = cli.main([])
        finally:
            sys.stdout, sys.stdin = old_out, old_in
        self.assertEqual(code, 0)
        return [json.loads(line) for line in out.getvalue().splitlines() if line]

    def test_full_session(self) -> None:
        commands = "\n".join([
            json.dumps({"cmd": "add", "id": "a", "fingerprint": "fa1"}),
            json.dumps({"cmd": "add", "id": "b", "fingerprint": "fb1", "deps": ["a"]}),
            json.dumps({"cmd": "plan"}),
            json.dumps({"cmd": "clean", "id": "a"}),
            json.dumps({"cmd": "update", "id": "a", "fingerprint": "fa2"}),
            json.dumps({"cmd": "plan"}),
            json.dumps({"cmd": "affected", "id": "a"}),
            json.dumps({"cmd": "explain", "id": "b"}),
            json.dumps({"cmd": "status"}),
            json.dumps({"cmd": "dump"}),
        ])
        results = self.run_cli(commands)
        self.assertTrue(all("error" not in r for r in results))
        self.assertEqual(results[2]["plan"], ["a"])       # b 被未确认的 a 门控
        self.assertEqual(results[5]["plan"], ["a"])       # a 更新后只释放 a
        self.assertEqual(results[6]["affected"], ["a", "b"])
        self.assertEqual(
            results[7]["paths"][0][-1], {"node": "a", "status": "dirty"}
        )

    def test_errors_returned_as_json(self) -> None:
        commands = "\n".join([
            json.dumps({"cmd": "add", "id": "x", "fingerprint": "fx"}),
            json.dumps({"cmd": "add", "id": "x", "fingerprint": "fx2"}),       # 重复
            json.dumps({"cmd": "add", "id": "y", "fingerprint": "fy",
                        "deps": ["missing"]}),                                # 缺依赖
            json.dumps({"cmd": "update", "id": "ghost", "fingerprint": "f"}),  # 不存在
            json.dumps({"cmd": "clean", "id": "x"}),                          # x dirty
            json.dumps({"cmd": "frobnicate"}),                                # 未知命令
            "{broken json",                                                    # 坏 JSON
            json.dumps({"cmd": "remove", "id": "ghost"}),                     # 删除不存在
        ])
        results = self.run_cli(commands)
        # 0: add 成功；1: 重复 id；2: 缺依赖；3: 更新不存在；
        # 4: clean x —— x 无依赖，dirty 节点确认重跑合法，应成功；
        # 5: 未知命令；6: 坏 JSON；7: remove 不存在 → removed=false（非错误）。
        self.assertNotIn("error", results[0])
        for index in (1, 2, 3, 5, 6):
            self.assertIn("error", results[index], msg=f"第 {index} 条应报错")
        self.assertNotIn("error", results[4])
        self.assertFalse(results[7]["removed"])

    def test_blank_lines_ignored(self) -> None:
        results = self.run_cli("\n\n   \n" + json.dumps({"cmd": "plan"}) + "\n")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["plan"], [])

    def test_save_load_via_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "cli.json")
            commands = "\n".join([
                json.dumps({"cmd": "add", "id": "a", "fingerprint": "fa"}),
                json.dumps({"cmd": "clean", "id": "a"}),
                json.dumps({"cmd": "save", "path": path}),
                json.dumps({"cmd": "add", "id": "b", "fingerprint": "fb", "deps": ["a"]}),
                json.dumps({"cmd": "load", "path": path}),
                json.dumps({"cmd": "plan"}),
                json.dumps({"cmd": "load", "path": os.path.join(tmp, "nope.json")}),
            ])
            results = self.run_cli(commands)
        self.assertEqual(results[5]["plan"], [])           # load 后回到只有干净 a
        self.assertIn("error", results[6])                 # 加载缺失文件报错不崩

    def test_remove_existing_returns_true(self) -> None:
        results = self.run_cli(json.dumps({"cmd": "remove", "id": "a"}))
        self.assertFalse(results[0]["removed"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
