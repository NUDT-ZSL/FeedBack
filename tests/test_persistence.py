"""环检测与 JSON 快照持久化测试。"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from depgraph.engine import (
    DIRTY,
    PENDING,
    CycleError,
    DependencyGraph,
    SnapshotError,
)


def build_chain() -> DependencyGraph:
    g = DependencyGraph()
    g.add_node("a", "ha")
    g.add_node("b", "hb", deps=["a"])
    g.add_node("c", "hc", deps=["b"])
    return g


class CycleDetectionTests(unittest.TestCase):
    """增量注册天然保持 DAG，环只能通过坏快照引入，因此这里直接构造
    会成环的快照来验证加载期的环检测与错误信息。"""

    def _cycle_snapshot(self) -> dict:
        return {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["b"]},
                {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["c"]},
                {"id": "c", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["a"]},
            ],
        }

    def test_cyclic_snapshot_rejected_with_cycle_path(self) -> None:
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(self._cycle_snapshot())
        message = str(ctx.exception)
        self.assertIn("环", message)
        # 三个环节点都应出现在错误信息里。
        for nid in ("a", "b", "c"):
            self.assertIn(nid, message)

    def test_cycleerror_carries_node_list(self) -> None:
        # 通过内部连边路径直接触发 CycleError，校验 cycle 字段闭合。
        g = DependencyGraph()
        g.add_node("a", "1")
        g.add_node("b", "1", deps=["a"])
        node_a = g._nodes["a"]  # noqa: SLF001 - 白盒构造环
        try:
            g._wire_deps(node_a, ["b"])  # noqa: SLF001
        except CycleError as exc:
            cycle = exc.cycle
        else:
            self.fail("应当检测到环")
        self.assertEqual(cycle[0], cycle[-1])
        self.assertEqual(set(cycle), {"a", "b"})
        # 失败连边必须回滚，图仍可用。
        self.assertEqual(g.get_status("a")["deps"], [])

    def test_self_dependency_snapshot_rejected(self) -> None:
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["a"]},
            ],
        }
        with self.assertRaises(SnapshotError):
            DependencyGraph.from_dict(snap)


class SnapshotRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _path(self, name: str) -> str:
        return os.path.join(self.tmpdir, name)

    def test_save_load_roundtrip_preserves_everything(self) -> None:
        g = build_chain()
        g.add_node("d", "hd", deps=["b"])  # 菱形：b 被 c、d 依赖
        g.update_fingerprint("a", "ha2")
        # 确认 a，让 b/d 保持 PENDING，覆盖多种状态。
        g.mark_clean("a")
        self.assertEqual(g.get_status("b")["state"], PENDING)

        path = self._path("snap.json")
        g.save(path)
        restored = DependencyGraph.load(path)

        self.assertEqual(restored.list_nodes(), g.list_nodes())
        for nid in g.list_nodes():
            self.assertEqual(restored.get_status(nid), g.get_status(nid))
        self.assertEqual(restored.get_plan(), g.get_plan())
        self.assertEqual(restored.get_plan(), ["b"])
        # 继续推进，行为与原图一致。
        restored.mark_clean("b")
        self.assertEqual(restored.get_plan(), ["c", "d"])

    def test_roundtrip_clean_graph_empty_plan(self) -> None:
        g = build_chain()
        path = self._path("clean.json")
        g.save(path)
        restored = DependencyGraph.load(path)
        self.assertEqual(restored.get_plan(), [])

    def test_save_creates_parent_directory(self) -> None:
        path = self._path(os.path.join("nested", "deep", "s.json"))
        build_chain().save(path)
        self.assertTrue(os.path.isfile(path))

    def test_dump_is_sorted_json(self) -> None:
        g = build_chain()
        data = g.to_dict()
        ids = [n["id"] for n in data["nodes"]]
        self.assertEqual(ids, ["a", "b", "c"])
        # 可以直接被标准 json 序列化。
        json.dumps(data)

    def test_load_missing_file_clear_error(self) -> None:
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.load(self._path("nope.json"))
        self.assertIn("不存在", str(ctx.exception))

    def test_load_corrupt_json_clear_error(self) -> None:
        path = self._path("bad.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write("{not valid json")
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.load(path)
        self.assertIn("合法 JSON", str(ctx.exception))

    def test_load_wrong_top_level_type(self) -> None:
        path = self._path("top.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump([1, 2, 3], fh)
        with self.assertRaises(SnapshotError):
            DependencyGraph.load(path)

    def test_missing_fields_rejected(self) -> None:
        base = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": []},
            ],
        }
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(base)
        self.assertIn("fingerprint", str(ctx.exception))

    def test_missing_nodes_field_rejected(self) -> None:
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict({"format_version": 1})
        self.assertIn("nodes", str(ctx.exception))

    def test_bad_format_version_rejected(self) -> None:
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict({"format_version": 99, "nodes": []})
        self.assertIn("版本", str(ctx.exception))

    def test_missing_dependency_target_rejected(self) -> None:
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["ghost"]},
            ],
        }
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("ghost", str(ctx.exception))

    def test_duplicate_id_in_snapshot_rejected(self) -> None:
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": []},
                {"id": "a", "fingerprint": "2", "confirmed_fingerprint": "2",
                 "state": "clean", "deps": []},
            ],
        }
        with self.assertRaises(SnapshotError):
            DependencyGraph.from_dict(snap)

    def test_state_fingerprint_mismatch_rejected(self) -> None:
        # 标 clean 但两个指纹不一致。
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "2", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": []},
            ],
        }
        with self.assertRaises(SnapshotError) as ctx:
            DependencyGraph.from_dict(snap)
        self.assertIn("不一致", str(ctx.exception))

    def test_pending_without_dirty_source_is_valid_intermediate(self) -> None:
        # 黏性 PENDING：脏源 a 已确认，但下游 b 尚未重算确认。
        # 这是链式重算的正常中间态，快照应能加载并继续推进。
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "2", "confirmed_fingerprint": "2",
                 "state": "clean", "deps": []},
                {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "pending", "deps": ["a"]},
            ],
        }
        g = DependencyGraph.from_dict(snap)
        self.assertEqual(g.get_status("b")["state"], PENDING)
        self.assertEqual(g.get_plan(), ["b"])
        g.mark_clean("b")
        self.assertEqual(g.get_plan(), [])

    def test_clean_node_downstream_of_dirty_rejected(self) -> None:
        # a 脏，但直接依赖它的 b 却标 clean（应为 pending）。
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "2", "confirmed_fingerprint": "1",
                 "state": "dirty", "deps": []},
                {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "state": "clean", "deps": ["a"]},
            ],
        }
        with self.assertRaises(SnapshotError):
            DependencyGraph.from_dict(snap)

    def test_state_field_optional_derived(self) -> None:
        # 不带 state 的快照应从指纹派生，且能正常加载。
        snap = {
            "format_version": 1,
            "nodes": [
                {"id": "a", "fingerprint": "2", "confirmed_fingerprint": "1",
                 "deps": []},
                {"id": "b", "fingerprint": "1", "confirmed_fingerprint": "1",
                 "deps": ["a"]},
            ],
        }
        g = DependencyGraph.from_dict(snap)
        self.assertEqual(g.get_status("a")["state"], DIRTY)
        self.assertEqual(g.get_status("b")["state"], PENDING)

    def test_empty_snapshot_roundtrip(self) -> None:
        path = self._path("empty.json")
        DependencyGraph().save(path)
        restored = DependencyGraph.load(path)
        self.assertEqual(restored.list_nodes(), [])
        self.assertEqual(restored.get_plan(), [])

    def test_conservative_dirty_roundtrip(self) -> None:
        # 指纹改回已确认值时节点保守地保持 dirty（只有 mark_clean 解除）。
        # 这种状态必须能保存并原样加载，不能被自己的校验拒绝。
        g = DependencyGraph()
        g.add_node("a", "h1")
        g.update_fingerprint("a", "h2")
        g.update_fingerprint("a", "h1")  # 回到已确认值，仍 dirty
        self.assertEqual(g.get_status("a")["state"], DIRTY)
        path = self._path("conservative.json")
        g.save(path)
        restored = DependencyGraph.load(path)
        self.assertEqual(restored.get_status("a")["state"], DIRTY)
        self.assertEqual(restored.get_plan(), ["a"])


if __name__ == "__main__":
    unittest.main()
