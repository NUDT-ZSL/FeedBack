"""第二轮修复的回归测试。

四个场景全部按缺陷报告中的原始触发步骤构造：

1. 链式 a -> b -> c：a 变脏后只确认 a，b/c 必须仍脏且计划非空；
2. 菱形 a -> {b,d} -> c：只确认 a 后汇合点 c 不得进入计划；
3. 三态（dirty/pending/clean）在 save/load 往返后，
   get_plan / get_affected / explain_dirty / 各节点状态完全一致；
4. 加载“依赖指向不存在节点”的快照必须报错，并指出两个节点 id。
"""

from __future__ import annotations

import os
import tempfile
import unittest

from depgraph.engine import (
    CLEAN,
    DIRTY,
    PENDING,
    DependencyGraph,
    SnapshotError,
)


def build_chain() -> DependencyGraph:
    g = DependencyGraph()
    g.add_node("a", "ha")
    g.add_node("b", "hb", deps=["a"])
    g.add_node("c", "hc", deps=["b"])
    return g


def build_diamond() -> DependencyGraph:
    # a 分叉到 b、d，b、d 汇合到 c。
    g = DependencyGraph()
    g.add_node("a", "ha")
    g.add_node("b", "hb", deps=["a"])
    g.add_node("d", "hd", deps=["a"])
    g.add_node("c", "hc", deps=["b", "d"])
    return g


class StickyDirtyStateTests(unittest.TestCase):
    def test_chain_clean_upstream_keeps_downstream_dirty(self) -> None:
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        self.assertEqual(
            [g.get_status(n)["state"] for n in ("a", "b", "c")],
            [DIRTY, PENDING, PENDING],
        )

        g.mark_clean("a")

        # mark_clean 只影响 a 自己：下游仍是待定，计划绝不可以变空。
        self.assertEqual(g.get_status("a")["state"], CLEAN)
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.get_status("c")["state"], PENDING)
        self.assertEqual(g.get_plan(), ["b"])

        # 继续按拓扑逐个确认，计划才会推进。
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["c"])
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_diamond_clean_source_does_not_schedule_join_early(self) -> None:
        g = build_diamond()
        g.update_fingerprint("a", "ha2")
        g.mark_clean("a")

        # 汇合点 c 的两个依赖 b、d 都还没确认，c 不得进入计划。
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.get_status("d")["state"], PENDING)
        self.assertEqual(g.get_status("c")["state"], PENDING)
        self.assertEqual(g.get_plan(), ["b", "d"])

        # 只确认一个分支也不够：c 继续等待另一个分支。
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), ["d"])
        g.mark_clean("d")
        self.assertEqual(g.get_plan(), ["c"])
        g.mark_clean("c")
        self.assertEqual(g.get_plan(), [])

    def test_mark_clean_never_cleans_downstream_indirectly(self) -> None:
        # 宽链确认中间节点：其上游脏源与下游待定都不应被改变。
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        # 直接确认待定的 b（调用方掌握时机）只解除 b 自己。
        g.mark_clean("b")
        self.assertEqual(g.get_status("a")["state"], DIRTY)
        self.assertEqual(g.get_status("b")["state"], CLEAN)
        self.assertEqual(g.get_status("c")["state"], PENDING)


class SnapshotRoundTripStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _full_observation(self, g: DependencyGraph) -> dict:
        """用三类查询 + 全部节点状态做完整比对。"""
        return {
            "nodes": g.list_nodes(),
            "plan": g.get_plan(),
            "affected_a": g.get_affected("a"),
            "explain": {n: g.explain_dirty(n) for n in g.list_nodes()},
            "status": {n: g.get_status(n) for n in g.list_nodes()},
        }

    def test_all_three_states_round_trip(self) -> None:
        g = build_chain()
        g.add_node("z", "hz")  # 完全无关的干净节点
        g.update_fingerprint("a", "ha2")
        # 此刻：a=dirty，b/c=pending，z=clean —— 三态同时存在。
        self.assertEqual(g.get_status("a")["state"], DIRTY)
        self.assertEqual(g.get_status("z")["state"], CLEAN)

        path = os.path.join(self.tmpdir, "three-state.json")
        g.save(path)
        restored = DependencyGraph.load(path)

        before = self._full_observation(g)
        after = self._full_observation(restored)
        self.assertEqual(after, before)
        # 显式断言关键查询，避免只靠字典比较时看不出口径。
        self.assertEqual(restored.get_plan(), ["a"])
        self.assertEqual(restored.get_affected("a"), ["a", "b", "c"])
        self.assertEqual(restored.explain_dirty("c"), [["c", "b", "a"]])
        self.assertEqual(restored.explain_dirty("a"), [["a"]])
        self.assertEqual(restored.explain_dirty("z"), [])

    def test_sticky_pending_round_trip_after_source_cleaned(self) -> None:
        # 脏源已确认、下游保持黏性待定的中间态也要能完整往返。
        g = build_chain()
        g.update_fingerprint("a", "ha2")
        g.mark_clean("a")
        self.assertEqual(g.get_plan(), ["b"])

        path = os.path.join(self.tmpdir, "sticky.json")
        g.save(path)
        restored = DependencyGraph.load(path)

        self.assertEqual(restored.get_status("a")["state"], CLEAN)
        self.assertEqual(restored.get_status("b")["state"], PENDING)
        self.assertEqual(restored.get_status("c")["state"], PENDING)
        self.assertEqual(restored.get_plan(), ["b"])
        # 加载后可以继续推进到全干净。
        restored.mark_clean("b")
        restored.mark_clean("c")
        self.assertEqual(restored.get_plan(), [])

    def test_round_trip_to_new_instance_not_mutating_source(self) -> None:
        # 必须能用“新实例”load，而不是只在原对象上成立。
        g = build_diamond()
        g.update_fingerprint("a", "ha2")
        path = os.path.join(self.tmpdir, "diamond.json")
        g.save(path)

        fresh = DependencyGraph()
        self.assertEqual(fresh.list_nodes(), [])
        loaded = DependencyGraph.load(path)
        self.assertIsNot(loaded, g)
        self.assertEqual(loaded.get_plan(), g.get_plan())
        self.assertEqual(loaded.get_affected("a"), g.get_affected("a"))
        self.assertEqual(loaded.explain_dirty("c"), g.explain_dirty("c"))


class MissingDependencySnapshotTests(unittest.TestCase):
    def test_missing_dependency_target_raises_with_both_ids(self) -> None:
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["ghost"]},
            ],
        }
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        message = str(ctx.exception)
        self.assertIn("a", message)
        self.assertIn("ghost", message)
        self.assertIn("不存在", message)

    def test_missing_dependency_deep_in_graph_raises(self) -> None:
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": []},
                {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["a", "missing-node"]},
            ],
        }
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        message = str(ctx.exception)
        self.assertIn("b", message)
        self.assertIn("missing-node", message)

    def test_missing_dependency_file_load_raises(self) -> None:
        import json
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "bad-deps.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(
                    {
                        "format_version": 1,
                        "nodes": [
                            {"id": "x", "fingerprint": "1",
                             "confirmed_fingerprint": "1", "state": "clean",
                             "deps": ["nope"]}
                        ],
                    },
                    fh,
                )
            with self.assertRaises(SnapshotError) as ctx:
                DependencyGraph.load(path)
            self.assertIn("x", str(ctx.exception))
            self.assertIn("nope", str(ctx.exception))

    def test_valid_graph_still_loads_after_hardening(self) -> None:
        # 防护不能误伤正常快照：含全部三态的合法快照照常加载。
        g = build_diamond()
        g.update_fingerprint("a", "ha2")
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "ok.json")
            g.save(path)
            restored = DependencyGraph.load(path)
        self.assertEqual(
            [restored.get_status(n)["state"] for n in ("a", "b", "d", "c")],
            [DIRTY, PENDING, PENDING, PENDING],
        )


if __name__ == "__main__":
    unittest.main()
