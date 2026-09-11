"""deptracker 内核与 main 命令行入口的单元测试。

运行方式::

    python -m unittest test_deptracker -v
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest

import main
from deptracker import (
    CycleError,
    DependencyError,
    DependencyTracker,
    Edge,
    EdgeLimitError,
    SnapshotError,
    UnknownArtifactError,
)


def build_chain_tracker() -> DependencyTracker:
    """构造 f -> B -> A 的两级链（A 依赖产物 B，B 依赖文件 f）。"""
    t = DependencyTracker()
    t.add_edge("B", "f", "file")
    t.add_edge("A", "B", "file")
    return t


def rebuild(tracker: DependencyTracker, artifact: str, fingerprint: str) -> None:
    """模拟一次重建：先设置产物指纹，再确认重建。"""
    tracker.set_artifact_fingerprint(artifact, fingerprint)
    tracker.mark_rebuilt(artifact)


class EdgeValidationTest(unittest.TestCase):
    """Edge dataclass 的字段校验。"""

    def test_valid_edge(self) -> None:
        edge = Edge(artifact="a", input="b", kind="env")
        self.assertEqual(edge.artifact, "a")
        self.assertEqual(edge.kind, "env")

    def test_default_kind_is_file(self) -> None:
        self.assertEqual(Edge(artifact="a", input="b").kind, "file")

    def test_empty_artifact_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "artifact"):
            Edge(artifact="", input="b")

    def test_empty_input_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "input"):
            Edge(artifact="a", input="")

    def test_non_string_rejected(self) -> None:
        with self.assertRaises(ValueError):
            Edge(artifact=None, input="b")  # type: ignore[arg-type]

    def test_invalid_kind_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "kind"):
            Edge(artifact="a", input="b", kind="network")

    def test_add_edge_propagates_validation(self) -> None:
        t = DependencyTracker()
        with self.assertRaisesRegex(ValueError, "kind"):
            t.add_edge("a", "b", "socket")


class EmptyAndSingleTest(unittest.TestCase):
    """空图与单产物单输入。"""

    def test_empty_graph(self) -> None:
        t = DependencyTracker()
        self.assertEqual(t.get_rebuild_plan(), [])
        self.assertEqual(t.stats()["edges"], 0)
        self.assertEqual(t.stats()["dirty_artifacts"], 0)

    def test_single_artifact_single_input(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        # 新边的输入未确认 -> 产物失效，且没有产物依赖 -> 进入计划。
        self.assertEqual(t.get_rebuild_plan(), ["a"])
        t.report_fingerprint("f", "v1")
        rebuild(t, "a", "h1")
        self.assertFalse(t.is_dirty("a"))
        self.assertEqual(t.get_rebuild_plan(), [])

    def test_dependency_on_unreported_input(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "ghost")
        self.assertTrue(t.is_dirty("a"))
        # 未报告指纹的输入无法确认重建。
        t.set_artifact_fingerprint("a", "h1")
        with self.assertRaisesRegex(DependencyError, "尚未报告指纹"):
            t.mark_rebuilt("a")
        # 报告后可以重建。
        t.report_fingerprint("ghost", "v1")
        t.mark_rebuilt("a")
        self.assertFalse(t.is_dirty("a"))

    def test_report_unknown_input_is_registered(self) -> None:
        t = DependencyTracker()
        self.assertEqual(t.report_fingerprint("free", "v1"), [])
        self.assertEqual(t.stats()["inputs"], 1)


class DuplicateAndRemoveTest(unittest.TestCase):
    """重复注册与删除产物。"""

    def test_duplicate_edge_is_idempotent(self) -> None:
        t = DependencyTracker()
        self.assertTrue(t.add_edge("a", "f"))
        self.assertFalse(t.add_edge("a", "f"))
        self.assertEqual(t.stats()["edges"], 1)

    def test_remove_artifact(self) -> None:
        t = build_chain_tracker()
        self.assertEqual(t.remove_artifact("B"), 1)
        self.assertEqual(t.stats()["edges"], 1)
        # B 退化为未报告的普通输入，A 因此失效。
        self.assertTrue(t.is_dirty("A"))

    def test_remove_missing_artifact(self) -> None:
        t = DependencyTracker()
        with self.assertRaisesRegex(UnknownArtifactError, "不存在"):
            t.remove_artifact("nope")


class InvalidationPropagationTest(unittest.TestCase):
    """失效传播：链式、菱形去重、指纹未变不标脏、改回已确认值可愈合。"""

    def test_chain_propagation(self) -> None:
        t = build_chain_tracker()
        t.report_fingerprint("f", "v1")
        rebuild(t, "B", "hb1")
        rebuild(t, "A", "ha1")
        self.assertEqual(t.get_rebuild_plan(), [])
        # f 变化 -> B、A 都失效。
        invalidated = t.report_fingerprint("f", "v2")
        self.assertEqual(invalidated, ["A", "B"])
        self.assertTrue(t.is_dirty("A"))
        self.assertTrue(t.is_dirty("B"))

    def test_no_change_report_marks_nothing(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        t.report_fingerprint("f", "v1")
        rebuild(t, "a", "h1")
        self.assertEqual(t.report_fingerprint("f", "v1"), [])
        self.assertFalse(t.is_dirty("a"))

    def test_diamond_propagation_dedup(self) -> None:
        # 菱形：f -> B, f -> C, B -> A, C -> A。
        t = DependencyTracker()
        t.add_edge("B", "f")
        t.add_edge("C", "f")
        t.add_edge("A", "B")
        t.add_edge("A", "C")
        t.report_fingerprint("f", "v1")
        rebuild(t, "B", "hb")
        rebuild(t, "C", "hc")
        rebuild(t, "A", "ha")
        invalidated = t.report_fingerprint("f", "v2")
        # 每个产物只标记一次。
        self.assertEqual(sorted(invalidated), ["A", "B", "C"])
        self.assertEqual(len(invalidated), len(set(invalidated)))

    def test_propagation_order_independent(self) -> None:
        # 边的注册顺序不同，最终失效集合一致。
        def build(order: int) -> DependencyTracker:
            t = DependencyTracker()
            edges = [("B", "f"), ("C", "f"), ("A", "B"), ("A", "C")]
            if order == 1:
                edges.reverse()
            for a, i in edges:
                t.add_edge(a, i)
            t.report_fingerprint("f", "v1")
            for art, fp in (("B", "hb"), ("C", "hc"), ("A", "ha")):
                rebuild(t, art, fp)
            t.report_fingerprint("f", "v2")
            return t

        t1, t2 = build(0), build(1)
        self.assertEqual(t1.get_rebuild_plan(), t2.get_rebuild_plan())

    def test_fingerprint_revert_heals(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        t.report_fingerprint("f", "v1")
        rebuild(t, "a", "h1")
        t.report_fingerprint("f", "v2")
        self.assertTrue(t.is_dirty("a"))
        # 指纹改回已确认值 -> 产物恢复干净。
        t.report_fingerprint("f", "v1")
        self.assertFalse(t.is_dirty("a"))

    def test_env_and_file_kinds_propagate_alike(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "CFG", "env")
        t.add_edge("a", "src.c", "file")
        t.report_fingerprint("CFG", "debug")
        t.report_fingerprint("src.c", "c1")
        rebuild(t, "a", "h1")
        t.report_fingerprint("CFG", "release")
        self.assertTrue(t.is_dirty("a"))


class RebuildPlanTest(unittest.TestCase):
    """重建计划的成员资格与拓扑序。"""

    def test_plan_excludes_artifacts_with_dirty_deps(self) -> None:
        t = build_chain_tracker()
        t.report_fingerprint("f", "v1")
        # A、B 都失效，但只有 B 的依赖干净 -> 计划只含 B。
        self.assertEqual(t.get_rebuild_plan(), ["B"])
        rebuild(t, "B", "hb1")
        # B 重建后 A 进入计划。
        self.assertEqual(t.get_rebuild_plan(), ["A"])
        rebuild(t, "A", "ha1")
        self.assertEqual(t.get_rebuild_plan(), [])

    def test_plan_topological_order_multi_level(self) -> None:
        # 三层：f -> c0,c1 -> b0,b1 -> top；分别污染不同叶子，分轮重建。
        t = DependencyTracker()
        t.add_edge("c0", "f0")
        t.add_edge("c1", "f1")
        t.add_edge("b0", "c0")
        t.add_edge("b1", "c0")
        t.add_edge("b1", "c1")
        t.add_edge("top", "b0")
        t.add_edge("top", "b1")
        t.report_fingerprint("f0", "1")
        t.report_fingerprint("f1", "1")
        for art in ("c0", "c1", "b0", "b1", "top"):
            rebuild(t, art, "h_" + art)
        self.assertEqual(t.get_rebuild_plan(), [])

        t.report_fingerprint("f0", "2")
        self.assertEqual(t.get_rebuild_plan(), ["c0"])
        rebuild(t, "c0", "h_c0_v2")
        # b0、b1 都失效且依赖已干净；top 仍被阻塞。
        plan = t.get_rebuild_plan()
        self.assertEqual(plan, ["b0", "b1"])
        rebuild(t, "b0", "h_b0_v2")
        rebuild(t, "b1", "h_b1_v2")
        self.assertEqual(t.get_rebuild_plan(), ["top"])

    def test_plan_order_property_large_graph(self) -> None:
        # 几十个产物、多层依赖：验证计划中任何产物都排在其依赖之后。
        t = DependencyTracker()
        levels = 4
        width = 8
        prev = []
        for level in range(levels):
            current = []
            for i in range(width):
                name = f"L{level}_N{i}"
                if level == 0:
                    t.add_edge(name, f"leaf_{i}")
                else:
                    # 每个产物依赖上一层的两个相邻产物。
                    t.add_edge(name, prev[i % width])
                    t.add_edge(name, prev[(i + 1) % width])
                current.append(name)
            prev = current
        for i in range(width):
            t.report_fingerprint(f"leaf_{i}", "v1")
        # 自底向上逐层重建，验证每轮计划的拓扑性质。
        for level in range(levels):
            plan = t.get_rebuild_plan()
            position = {name: idx for idx, name in enumerate(plan)}
            planned = set(plan)
            edges = t.dump()["edges"]
            for name in planned:
                for edge in edges:
                    if edge["artifact"] == name and edge["input"] in planned:
                        self.assertLess(position[edge["input"]], position[name])
            self.assertTrue(plan)  # 每层都应有可重建产物
            for name in plan:
                rebuild(t, name, "h_" + name)
        self.assertEqual(t.get_rebuild_plan(), [])

    def test_new_artifact_enters_plan(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        self.assertEqual(t.get_rebuild_plan(), ["a"])


class ExplainTest(unittest.TestCase):
    """失效解释链。"""

    def test_explain_clean_artifact(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        t.report_fingerprint("f", "v1")
        rebuild(t, "a", "h1")
        result = t.explain_invalid("a")
        self.assertFalse(result["invalid"])
        self.assertEqual(result["chain"], [])

    def test_explain_unknown_artifact(self) -> None:
        t = DependencyTracker()
        with self.assertRaises(UnknownArtifactError):
            t.explain_invalid("nope")

    def test_explain_direct_file_change(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "src.c", "file")
        t.report_fingerprint("src.c", "v1")
        rebuild(t, "a", "h1")
        t.report_fingerprint("src.c", "v2")
        result = t.explain_invalid("a")
        self.assertTrue(result["invalid"])
        self.assertEqual(result["root_cause"], "src.c")
        self.assertEqual([n["node"] for n in result["chain"]], ["a", "src.c"])
        leaf = result["chain"][-1]
        self.assertEqual(leaf["edge_kind"], "file")
        self.assertEqual(leaf["confirmed_fingerprint"], "v1")
        self.assertEqual(leaf["current_fingerprint"], "v2")
        self.assertEqual(leaf["status"], "changed")

    def test_explain_chain_through_artifact(self) -> None:
        # f -> B -> A：A 的解释链应穿过 B 到达 f。
        t = build_chain_tracker()
        t.report_fingerprint("f", "v1")
        rebuild(t, "B", "hb")
        rebuild(t, "A", "ha")
        t.report_fingerprint("f", "v2")
        result = t.explain_invalid("A")
        self.assertEqual(result["root_cause"], "f")
        self.assertEqual([n["node"] for n in result["chain"]], ["A", "B", "f"])
        kinds = [n["edge_kind"] for n in result["chain"]]
        self.assertEqual(kinds, [None, "file", "file"])

    def test_explain_env_input_kind(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "MODE", "env")
        t.report_fingerprint("MODE", "dev")
        result = t.explain_invalid("a")
        self.assertEqual(result["chain"][-1]["edge_kind"], "env")
        self.assertEqual(result["chain"][-1]["status"], "unconfirmed")

    def test_explain_unreported_input(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "ghost")
        result = t.explain_invalid("a")
        self.assertEqual(result["root_cause"], "ghost")
        self.assertEqual(result["chain"][-1]["status"], "unreported")


class CycleDetectionTest(unittest.TestCase):
    """环检测：注册时报错并指出环上的节点序列。"""

    def test_self_loop(self) -> None:
        t = DependencyTracker()
        with self.assertRaises(CycleError) as ctx:
            t.add_edge("a", "a")
        self.assertEqual(ctx.exception.cycle, ["a", "a"])

    def test_two_node_cycle(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "b")
        with self.assertRaises(CycleError) as ctx:
            t.add_edge("b", "a")
        cycle = ctx.exception.cycle
        self.assertEqual(cycle[0], cycle[-1])
        self.assertIn("a", cycle)
        self.assertIn("b", cycle)
        self.assertIn("->", str(ctx.exception))

    def test_long_cycle_reports_node_sequence(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "b")
        t.add_edge("b", "c")
        t.add_edge("c", "d")
        with self.assertRaises(CycleError) as ctx:
            t.add_edge("d", "a")
        cycle = ctx.exception.cycle
        # 环上的节点序列首尾相同（d -> a -> b -> c -> d）。
        self.assertEqual(cycle[0], "d")
        self.assertEqual(cycle[-1], "d")
        self.assertEqual(set(cycle), {"a", "b", "c", "d"})

    def test_failed_cycle_edge_not_registered(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "b")
        with self.assertRaises(CycleError):
            t.add_edge("b", "a")
        self.assertEqual(t.stats()["edges"], 1)

    def test_diamond_is_not_a_cycle(self) -> None:
        t = DependencyTracker()
        t.add_edge("b", "f")
        t.add_edge("c", "f")
        t.add_edge("a", "b")
        t.add_edge("a", "c")  # 不应报环
        self.assertEqual(t.stats()["edges"], 4)


class EdgeLimitTest(unittest.TestCase):
    """max_edges 内存上限策略：超限拒绝注册并报错，不静默丢弃。"""

    def test_limit_rejects_overflow(self) -> None:
        t = DependencyTracker(max_edges=2)
        t.add_edge("a", "f1")
        t.add_edge("a", "f2")
        with self.assertRaisesRegex(EdgeLimitError, "max_edges=2"):
            t.add_edge("a", "f3")
        # 被拒绝的边没有静默进入图里。
        self.assertEqual(t.stats()["edges"], 2)
        self.assertEqual(t.stats()["edge_capacity_remaining"], 0)

    def test_zero_limit_rejects_everything(self) -> None:
        t = DependencyTracker(max_edges=0)
        with self.assertRaises(EdgeLimitError):
            t.add_edge("a", "f")
        self.assertEqual(t.stats()["edges"], 0)

    def test_duplicate_edge_does_not_consume_quota(self) -> None:
        t = DependencyTracker(max_edges=1)
        t.add_edge("a", "f")
        self.assertFalse(t.add_edge("a", "f"))  # 幂等，不触发上限

    def test_precise_mode_is_unlimited(self) -> None:
        t = DependencyTracker(max_edges=None)
        for i in range(500):
            t.add_edge(f"a{i}", f"f{i}")
        self.assertEqual(t.stats()["edges"], 500)
        self.assertIsNone(t.stats()["edge_capacity_remaining"])

    def test_negative_limit_rejected(self) -> None:
        with self.assertRaises(ValueError):
            DependencyTracker(max_edges=-1)


class MarkRebuiltTest(unittest.TestCase):
    """重建确认的前置条件。"""

    def test_mark_rebuilt_unknown_artifact(self) -> None:
        t = DependencyTracker()
        with self.assertRaises(UnknownArtifactError):
            t.mark_rebuilt("nope")

    def test_mark_rebuilt_requires_fingerprint(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        t.report_fingerprint("f", "v1")
        with self.assertRaisesRegex(DependencyError, "set_artifact_fingerprint"):
            t.mark_rebuilt("a")

    def test_mark_rebuilt_with_dirty_dependency(self) -> None:
        t = build_chain_tracker()
        t.report_fingerprint("f", "v1")
        t.set_artifact_fingerprint("A", "ha")
        with self.assertRaisesRegex(DependencyError, "仍处于失效状态"):
            t.mark_rebuilt("A")

    def test_set_artifact_fingerprint_invalidates_dependents(self) -> None:
        t = build_chain_tracker()
        t.report_fingerprint("f", "v1")
        rebuild(t, "B", "hb1")
        rebuild(t, "A", "ha1")
        # B 重建出新指纹 -> A 失效（A 确认的是旧指纹）。
        invalidated = t.set_artifact_fingerprint("B", "hb2")
        self.assertEqual(invalidated, ["A"])
        self.assertFalse(t.is_dirty("B"))
        self.assertTrue(t.is_dirty("A"))

    def test_empty_fingerprint_rejected(self) -> None:
        t = DependencyTracker()
        t.add_edge("a", "f")
        with self.assertRaises(ValueError):
            t.report_fingerprint("f", "")
        with self.assertRaises(ValueError):
            t.set_artifact_fingerprint("a", "")


class SnapshotTest(unittest.TestCase):
    """快照保存 / 加载往返与损坏文件的错误处理。"""

    def setUp(self) -> None:
        self.tmpdir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.tmpdir.name, "state.json")

    def tearDown(self) -> None:
        self.tmpdir.cleanup()

    def _sample_tracker(self) -> DependencyTracker:
        t = DependencyTracker(max_edges=100)
        t.add_edge("B", "f", "file")
        t.add_edge("A", "B", "file")
        t.add_edge("A", "MODE", "env")
        t.report_fingerprint("f", "v1")
        t.report_fingerprint("MODE", "dev")
        rebuild(t, "B", "hb1")
        rebuild(t, "A", "ha1")
        t.report_fingerprint("f", "v2")  # 留下一些失效状态
        return t

    def test_roundtrip_preserves_state(self) -> None:
        t = self._sample_tracker()
        t.save(self.path)
        loaded = DependencyTracker.load(self.path)
        self.assertEqual(loaded.dump(), t.dump())
        self.assertEqual(loaded.get_rebuild_plan(), t.get_rebuild_plan())
        self.assertEqual(loaded.stats(), t.stats())

    def test_roundtrip_allows_continued_operation(self) -> None:
        t = self._sample_tracker()
        t.save(self.path)
        loaded = DependencyTracker.load(self.path)
        self.assertEqual(loaded.get_rebuild_plan(), ["B"])
        rebuild(loaded, "B", "hb2")
        self.assertEqual(loaded.get_rebuild_plan(), ["A"])

    def test_load_missing_file(self) -> None:
        with self.assertRaisesRegex(SnapshotError, "无法读取"):
            DependencyTracker.load(os.path.join(self.tmpdir.name, "nope.json"))

    def test_load_corrupted_json(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{not json")
        with self.assertRaisesRegex(SnapshotError, "不是合法 JSON"):
            DependencyTracker.load(self.path)

    def test_load_missing_field(self) -> None:
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump({"version": 1, "max_edges": None, "edges": []}, fh)
        with self.assertRaisesRegex(SnapshotError, "缺少必需字段"):
            DependencyTracker.load(self.path)

    def test_load_edge_with_unknown_node(self) -> None:
        data = {
            "version": 1,
            "max_edges": None,
            "edges": [{"artifact": "a", "input": "ghost", "kind": "file"}],
            "inputs": {},
            "artifacts": {"a": {"fingerprint": None, "confirmed": {}}},
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(SnapshotError, "未声明的输入"):
            DependencyTracker.load(self.path)

    def test_load_cycle_detected(self) -> None:
        data = {
            "version": 1,
            "max_edges": None,
            "edges": [
                {"artifact": "a", "input": "b", "kind": "file"},
                {"artifact": "b", "input": "a", "kind": "file"},
            ],
            "inputs": {},
            "artifacts": {
                "a": {"fingerprint": None, "confirmed": {}},
                "b": {"fingerprint": None, "confirmed": {}},
            },
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(SnapshotError, "环"):
            DependencyTracker.load(self.path)

    def test_load_empty_fingerprint_rejected(self) -> None:
        data = {
            "version": 1,
            "max_edges": None,
            "edges": [],
            "inputs": {"f": {"fingerprint": ""}},
            "artifacts": {},
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(SnapshotError, "指纹"):
            DependencyTracker.load(self.path)

    def test_load_invalid_confirmed_reference(self) -> None:
        data = {
            "version": 1,
            "max_edges": None,
            "edges": [{"artifact": "a", "input": "f", "kind": "file"}],
            "inputs": {"f": {"fingerprint": "v1"}, "g": {"fingerprint": "v2"}},
            "artifacts": {"a": {"fingerprint": "h", "confirmed": {"g": "v2"}}},
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(SnapshotError, "不存在的"):
            DependencyTracker.load(self.path)

    def test_load_bad_kind(self) -> None:
        data = {
            "version": 1,
            "max_edges": None,
            "edges": [{"artifact": "a", "input": "f", "kind": "net"}],
            "inputs": {"f": {"fingerprint": None}},
            "artifacts": {"a": {"fingerprint": None, "confirmed": {}}},
        }
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(data, fh)
        with self.assertRaisesRegex(SnapshotError, "kind"):
            DependencyTracker.load(self.path)

    def test_load_respects_snapshot_max_edges(self) -> None:
        t = DependencyTracker(max_edges=1)
        t.add_edge("a", "f")
        t.save(self.path)
        loaded = DependencyTracker.load(self.path)
        with self.assertRaises(EdgeLimitError):
            loaded.add_edge("b", "g")


class CliTest(unittest.TestCase):
    """命令行入口：逐行 JSON 命令与错误输出。"""

    def run_cli(self, commands: list, argv: list = None) -> list:
        stdin_text = "\n".join(json.dumps(c) for c in commands) + "\n"
        out = io.StringIO()
        main.run(io.StringIO(stdin_text), out)
        return [json.loads(line) for line in out.getvalue().splitlines()]

    def test_full_workflow(self) -> None:
        results = self.run_cli([
            {"cmd": "add_edge", "artifact": "a", "input": "f", "kind": "file"},
            {"cmd": "report", "input": "f", "fingerprint": "v1"},
            {"cmd": "plan"},
            {"cmd": "set_artifact", "artifact": "a", "fingerprint": "h1"},
            {"cmd": "rebuilt", "artifact": "a"},
            {"cmd": "plan"},
            {"cmd": "stats"},
        ])
        self.assertTrue(all(r["ok"] for r in results))
        self.assertEqual(results[2]["plan"], ["a"])
        self.assertEqual(results[5]["plan"], [])
        self.assertEqual(results[6]["edges"], 1)

    def test_error_results_have_error_field(self) -> None:
        results = self.run_cli([
            {"cmd": "add_edge", "artifact": "a", "input": "b"},
            {"cmd": "add_edge", "artifact": "b", "input": "a"},  # 环
            {"cmd": "explain", "artifact": "nope"},
            {"cmd": "frobnicate"},
            {"cmd": "report", "input": "x"},  # 缺参数
        ])
        self.assertTrue(results[0]["ok"])
        for r in results[1:]:
            self.assertIn("error", r)
            self.assertFalse(r["ok"])
        self.assertEqual(results[1]["error_type"], "CycleError")

    def test_bad_json_line(self) -> None:
        out = io.StringIO()
        main.run(io.StringIO("{oops\n"), out)
        result = json.loads(out.getvalue().strip())
        self.assertIn("error", result)
        self.assertEqual(result["error_type"], "BadJson")

    def test_save_load_dump_via_cli(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            results = self.run_cli([
                {"cmd": "add_edge", "artifact": "a", "input": "f"},
                {"cmd": "report", "input": "f", "fingerprint": "v1"},
                {"cmd": "save", "path": path},
                {"cmd": "load", "path": path},
                {"cmd": "dump"},
            ])
            self.assertTrue(all(r["ok"] for r in results))
            self.assertEqual(results[4]["state"]["edges"][0]["artifact"], "a")

    def test_explain_via_cli(self) -> None:
        results = self.run_cli([
            {"cmd": "add_edge", "artifact": "a", "input": "f", "kind": "env"},
            {"cmd": "explain", "artifact": "a"},
        ])
        self.assertTrue(results[1]["invalid"])
        self.assertEqual(results[1]["root_cause"], "f")


if __name__ == "__main__":
    unittest.main()
