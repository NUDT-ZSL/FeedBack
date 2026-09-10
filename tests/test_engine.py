"""引擎核心逻辑测试：注册/删除、环检测、传播、计划排序、溯源。"""

from __future__ import annotations

import unittest

from depgraph.engine import (
    CLEAN,
    DIRTY,
    PENDING,
    CycleError,
    DependencyGraph,
    DuplicateNodeError,
    InvalidNodeError,
    NodeNotFoundError,
)


def build_chain() -> DependencyGraph:
    """a -> b -> c，全部干净基线。"""
    g = DependencyGraph()
    g.add_node("a", "ha")
    g.add_node("b", "hb", deps=["a"])
    g.add_node("c", "hc", deps=["b"])
    return g


def build_diamond() -> DependencyGraph:
    """x -> m1 -> y, x -> m2 -> y（y 同时依赖 m1、m2）。"""
    g = DependencyGraph()
    g.add_node("x", "hx")
    g.add_node("m1", "hm1", deps=["x"])
    g.add_node("m2", "hm2", deps=["x"])
    g.add_node("y", "hy", deps=["m1", "m2"])
    return g


class RegistrationTests(unittest.TestCase):
    def test_empty_graph_plan_is_empty(self) -> None:
        self.assertEqual(DependencyGraph().get_plan(), [])

    def test_single_node_clean_by_default(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "h")
        self.assertEqual(g.get_plan(), [])
        self.assertEqual(g.get_status("a")["state"], CLEAN)
        self.assertEqual(g.get_affected("a"), ["a"])
        self.assertEqual(g.explain_dirty("a"), [])

    def test_duplicate_add_rejected(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "h")
        with self.assertRaises(DuplicateNodeError):
            g.add_node("a", "h2")

    def test_invalid_id_and_fingerprint(self) -> None:
        g = DependencyGraph()
        for bad_id in ("",):
            with self.assertRaises(InvalidNodeError):
                g.add_node(bad_id, "h")  # type: ignore[arg-type]
        with self.assertRaises(InvalidNodeError):
            g.add_node("a", "")
        with self.assertRaises(InvalidNodeError):
            g.add_node(123, "h")  # type: ignore[arg-type]
        with self.assertRaises(InvalidNodeError):
            g.add_node("a", 42)  # type: ignore[arg-type]

    def test_self_dependency_rejected(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(InvalidNodeError):
            g.add_node("a", "h", deps=["a"])

    def test_duplicate_dependency_rejected(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "h")
        with self.assertRaises(InvalidNodeError):
            g.add_node("b", "h", deps=["a", "a"])

    def test_dependency_must_exist(self) -> None:
        g = DependencyGraph()
        with self.assertRaises(NodeNotFoundError):
            g.add_node("a", "h", deps=["ghost"])
        # 失败的注册不能在图里留下节点。
        self.assertEqual(g.list_nodes(), [])

    def test_deps_cannot_be_plain_string(self) -> None:
        g = DependencyGraph()
        g.add_node("ab", "h")
        with self.assertRaises(InvalidNodeError):
            g.add_node("x", "h", deps="ab")  # type: ignore[arg-type]

    def test_contains_len(self) -> None:
        g = build_chain()
        self.assertEqual(len(g), 3)
        self.assertIn("a", g)
        self.assertNotIn("zzz", g)


class RemovalTests(unittest.TestCase):
    def test_remove_unlinks_from_other_nodes(self) -> None:
        g = build_chain()
        g.remove_node("b")
        self.assertEqual(g.get_status("c")["deps"], [])
        self.assertEqual(set(g.list_nodes()), {"a", "c"})

    def test_remove_nonexistent_raises(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().remove_node("nope")

    def test_remove_dirty_source_keeps_pending_state(self) -> None:
        # 待定状态是黏性的：删掉脏源不代表下游产物自动有效。
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(g.get_status("c")["state"], PENDING)
        g.remove_node("a")
        self.assertEqual(g.get_status("c")["state"], PENDING)
        g.mark_clean("b")
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_failed_add_is_atomic(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "h")
        with self.assertRaises(NodeNotFoundError):
            g.add_node("b", "h", deps=["a", "ghost"])
        # a 的反向表里不能残留 b。
        self.assertEqual(g.get_status("a")["deps"], [])
        self.assertEqual(g.get_affected("a"), ["a"])


class FingerprintAndPropagationTests(unittest.TestCase):
    def test_update_missing_node_raises(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().update_fingerprint("x", "h")

    def test_same_fingerprint_is_noop(self) -> None:
        g = build_chain()
        self.assertFalse(g.update_fingerprint("a", "ha"))
        self.assertEqual(g.get_plan(), [])
        self.assertEqual(g.get_status("a")["state"], CLEAN)

    def test_chain_propagation(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(g.get_status("a")["state"], DIRTY)
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.get_status("c")["state"], PENDING)

    def test_diamond_propagation_dedup(self) -> None:
        g = build_diamond()
        g.update_fingerprint("x", "hx2")
        for nid in ("m1", "m2", "y"):
            self.assertEqual(g.get_status(nid)["state"], PENDING)
        # 受影响集合恰好 4 个节点，y 不会因两条路径出现两次。
        self.assertEqual(g.get_affected("x"), ["x", "m1", "m2", "y"])

    def test_propagation_order_independence(self) -> None:
        # 两张逻辑相同、注册顺序相反的图，传播与计划结果必须一致。
        def build(order: str) -> DependencyGraph:
            g = DependencyGraph()
            g.add_node("x", "hx")
            if order == "forward":
                g.add_node("m1", "hm1", deps=["x"])
                g.add_node("m2", "hm2", deps=["x"])
            else:
                g.add_node("m2", "hm2", deps=["x"])
                g.add_node("m1", "hm1", deps=["x"])
            g.add_node("y", "hy", deps=["m1", "m2"])
            return g

        for order in ("forward", "reverse"):
            g = build(order)
            g.update_fingerprint("x", "hx2")
            self.assertEqual(g.get_affected("x"), ["x", "m1", "m2", "y"])
            self.assertEqual(
                g.explain_dirty("y"),
                [["y", "m1", "x"], ["y", "m2", "x"]],
            )
            self.assertEqual(g.get_plan(), ["x"])

    def test_pending_node_own_change_promotes_to_dirty(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        g.update_fingerprint("b", "hb2")
        self.assertEqual(g.get_status("b")["state"], DIRTY)
        self.assertEqual(g.explain_dirty("b"), [["b"]])


class PlanTests(unittest.TestCase):
    def test_plan_gated_behind_unconfirmed_deps(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(g.get_plan(), ["a"])

        g.mark_clean("a")
        self.assertEqual(g.get_plan(), ["b"])

        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["c"])

        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_plan_diamond_waves(self) -> None:
        g = build_diamond()
        g.update_fingerprint("x", "hx2")
        self.assertEqual(g.get_plan(), ["x"])

        g.mark_clean("x")
        self.assertEqual(g.get_plan(), ["m1", "m2"])

        g.mark_clean("m1")
        # y 还在等 m2。
        self.assertEqual(g.get_plan(), ["m2"])
        g.mark_clean("m2")
        self.assertEqual(g.get_plan(), ["y"])

        g.mark_clean("y")
        self.assertEqual(g.get_plan(), [])

    def test_plan_is_topological(self) -> None:
        # 宽图：l0 -> l1{i} -> l2{i} -> out
        g = DependencyGraph()
        g.add_node("l0", "v0")
        for i in range(4):
            g.add_node(f"l1_{i}", f"v1{i}", deps=["l0"])
        for i in range(4):
            g.add_node(f"l2_{i}", f"v2{i}", deps=[f"l1_{i}"])
        g.add_node("out", "vout", deps=[f"l2_{i}" for i in range(4)])

        g.update_fingerprint("l0", "v0x")
        waves = drain_plan(g)
        self.assertEqual(waves[0], ["l0"])
        self.assertEqual(waves[1], ["l1_0", "l1_1", "l1_2", "l1_3"])
        self.assertEqual(waves[2], ["l2_0", "l2_1", "l2_2", "l2_3"])
        self.assertEqual(waves[3], ["out"])

    def test_mark_clean_does_not_clear_downstream(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        g.mark_clean("a")
        # 只确认 a 不能让 b/c 变干净。
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.get_status("c")["state"], PENDING)

    def test_independent_branch_not_planned(self) -> None:
        g = DependencyGraph()
        g.add_node("a", "ha")
        g.add_node("b", "hb")
        g.add_node("c", "hc", deps=["a"])
        g.update_fingerprint("a", "ha2")
        plan = g.get_plan()
        self.assertNotIn("b", plan)
        self.assertIn("a", plan)


class AffectedTests(unittest.TestCase):
    def test_affected_is_structural_and_includes_self(self) -> None:
        g = build_chain()
        self.assertEqual(g.get_affected("a"), ["a", "b", "c"])
        self.assertEqual(g.get_affected("b"), ["b", "c"])
        self.assertEqual(g.get_affected("c"), ["c"])

    def test_affected_missing_node(self) -> None:
        with self.assertRaises(NodeNotFoundError):
            DependencyGraph().get_affected("x")


class ExplainTests(unittest.TestCase):
    def test_clean_node_has_no_explanation(self) -> None:
        self.assertEqual(build_chain().explain_dirty("c"), [])

    def test_dirty_source_self_path(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(g.explain_dirty("a"), [["a"]])

    def test_pending_node_paths_to_source(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(g.explain_dirty("c"), [["c", "b", "a"]])

    def test_pending_after_source_cleaned_still_planned(self) -> None:
        # 脏源确认后下游保持黏性 PENDING：explain 无脏源可指（[]），
        # 但节点仍在计划中，确认后才干净。
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        g.mark_clean("a")
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.explain_dirty("b"), [])
        self.assertEqual(g.get_plan(), ["b"])
        g.mark_clean("b")
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_multiple_sources_multiple_paths(self) -> None:
        # y -> m1,m2；x 和 m2 同时是脏源：y 应给出两条最近脏源路径。
        g = build_diamond()
        g.update_fingerprint("x", "hx2")   # x=DIRTY，m1/m2/y=PENDING
        g.update_fingerprint("m2", "hm2x")  # m2 自身也变：PENDING -> DIRTY
        paths = g.explain_dirty("y")
        self.assertIn(["y", "m1", "x"], paths)
        self.assertIn(["y", "m2"], paths)
        self.assertEqual(len(paths), 2)


class LargeGraphTests(unittest.TestCase):
    """模拟验收脚本：几十节点、多轮更新与确认。"""

    def _build_layered(self, width: int = 6, depth: int = 5) -> DependencyGraph:
        g = DependencyGraph()
        g.add_node("root", "root0")
        prev = ["root"]
        for layer in range(1, depth + 1):
            current = []
            for i in range(width):
                nid = f"L{layer}_{i}"
                # 每个节点依赖上一层同列和上一列（环形错位也行，仍是 DAG）。
                deps = [prev[i % len(prev)], prev[(i + 1) % len(prev)]]
                g.add_node(nid, f"{nid}:0", deps=list(dict.fromkeys(deps)))
                current.append(nid)
            prev = current
        return g

    def test_full_rebuild_wave_invariants(self) -> None:
        g = self._build_layered()
        total = len(g)
        g.update_fingerprint("root", "root1")

        seen: set[str] = set()
        waves = 0
        while True:
            plan = g.get_plan()
            if not plan:
                break
            waves += 1
            # 波次内节点的所有依赖必须已确认（状态闭包不变量）。
            for nid in plan:
                for dep in g.get_status(nid)["deps"]:
                    self.assertEqual(g.get_status(dep)["state"], CLEAN)
                self.assertNotIn(nid, seen)
                seen.add(nid)
            for nid in plan:
                g.mark_clean(nid)

        # root 变了，所有节点都应恰好重算一次。
        self.assertEqual(len(seen), total)
        self.assertEqual(waves, 6)  # root + 5 层
        self.assertEqual(g.get_plan(), [])

    def test_second_unchanged_update_replans_nothing(self) -> None:
        g = self._build_layered(width=3, depth=2)
        g.update_fingerprint("root", "root1")
        drain_plan(g)
        # 全干净后重复设置相同指纹：无脏标记、无计划。
        self.assertFalse(g.update_fingerprint("root", "root1"))
        self.assertEqual(g.get_plan(), [])


def drain_plan(g: DependencyGraph) -> list[list[str]]:
    """反复取计划并整批确认，返回每一波计划（测试辅助）。"""
    waves: list[list[str]] = []
    while True:
        plan = g.get_plan()
        if not plan:
            return waves
        waves.append(plan)
        for nid in plan:
            g.mark_clean(nid)


if __name__ == "__main__":
    unittest.main()
