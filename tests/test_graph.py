"""图谱核心测试：覆盖需求 1-6。"""

import unittest

from experience_graph import (
    EntryExists,
    EntryNotFound,
    ExperienceGraph,
    MergeConflict,
    ReferenceError,
    StaleRevision,
)


def make_populated():
    g = ExperienceGraph()
    g.create_entry("a", "主题A", "段0\n段1\n段2", "alice")
    g.create_entry("b", "主题B", "B正文", "bob")
    g.create_entry("c", "主题C", "C正文", "carol")
    return g


class EntryAndReferenceTests(unittest.TestCase):
    def test_create_and_current_version(self):
        g = ExperienceGraph()
        v = g.create_entry("a", "主题", "正文", "alice")
        self.assertEqual(v, 0)
        self.assertEqual(g.current_version("a"), 0)
        self.assertEqual(g.get_entry("a")["body"], "正文")

    def test_duplicate_id_rejected(self):
        g = ExperienceGraph()
        g.create_entry("a", "t", "b", "u")
        with self.assertRaises(EntryExists):
            g.create_entry("a", "t2", "b2", "u2")

    def test_reference_must_target_existing(self):
        g = make_populated()
        with self.assertRaises(EntryNotFound):
            g.add_reference("a", "ghost")
        with self.assertRaises(EntryNotFound):
            g.add_reference("ghost", "a")

    def test_no_self_reference(self):
        g = make_populated()
        with self.assertRaises(ReferenceError):
            g.add_reference("a", "a")

    def test_no_duplicate_reference(self):
        g = make_populated()
        g.add_reference("a", "b")
        with self.assertRaises(ReferenceError):
            g.add_reference("a", "b")

    def test_no_cycle_direct_and_transitive(self):
        g = make_populated()
        g.add_reference("a", "b")
        g.add_reference("b", "c")
        with self.assertRaises(ReferenceError):
            g.add_reference("c", "a")       # 传递成环
        with self.assertRaises(ReferenceError):
            g.add_reference("b", "a")       # 直接成环
        # 拒绝后图未被污染
        self.assertEqual(g.outgoing("b"), ["c"])

    def test_backlinks_stable_order(self):
        g = make_populated()
        g.add_reference("c", "a")
        g.add_reference("b", "a")
        self.assertEqual(g.backlinks("a"), ["b", "c"])


class StaleRevisionTests(unittest.TestCase):
    def test_stale_revision_rejected_with_behind_count(self):
        g = make_populated()
        g.submit_revision("a", "bob", 0, "段0改\n段1\n段2", "bob 修订")
        g.submit_revision("a", "carol", 1, "段0改\n段1\n段2C", "carol 修订")
        self.assertEqual(g.current_version("a"), 2)
        with self.assertRaises(StaleRevision) as ctx:
            g.submit_revision("a", "dave", 0, "陈旧内容", "dave 修订")
        self.assertEqual(ctx.exception.behind, 2)
        self.assertEqual(ctx.exception.current_version, 2)
        # 没有静默覆盖
        self.assertEqual(g.get_entry("a")["body"], "段0改\n段1\n段2C")

    def test_no_change_rejected(self):
        g = make_populated()
        with self.assertRaises(Exception):
            g.submit_revision("a", "bob", 0, "段0\n段1\n段2", "空改动")

    def test_based_on_future_version_rejected(self):
        g = make_populated()
        with self.assertRaises(Exception):
            g.submit_revision("a", "bob", 9, "x", "未来版本")


class ConflictTests(unittest.TestCase):
    def test_same_paragraph_conflict_keeps_both(self):
        g = make_populated()
        with self.assertRaises(MergeConflict) as ctx:
            g.integrate_revisions("a", [
                {"author": "bob", "base_version": 0,
                 "body": "段0-B\n段1\n段2", "change": "bob 改段0"},
                {"author": "carol", "base_version": 0,
                 "body": "段0-C\n段1\n段2", "change": "carol 改段0"},
            ])
        records = ctx.exception.records
        self.assertEqual(len(records), 1)
        rec = records[0]
        self.assertEqual(rec.entry_id, "a")
        self.assertEqual(rec.location, 0)
        self.assertEqual({p["author"] for p in rec.parties}, {"bob", "carol"})
        self.assertIn("段0-B", rec.rendered)
        self.assertIn("段0-C", rec.rendered)
        # 条目不前进版本，不选任何一方
        self.assertEqual(g.current_version("a"), 0)
        self.assertEqual(g.get_entry("a")["body"], "段0\n段1\n段2")
        self.assertEqual(len(g.list_conflicts("a")), 1)

    def test_conflict_non_strict_returns_ids_and_keeps_state(self):
        g = make_populated()
        ids = g.integrate_revisions("a", [
            {"author": "bob", "base_version": 0, "body": "X\n段1\n段2", "change": "b"},
            {"author": "carol", "base_version": 0, "body": "Y\n段1\n段2", "change": "c"},
        ], strict=False)
        self.assertEqual(len(ids), 1)
        self.assertEqual(g.current_version("a"), 0)

    def test_resolve_conflict_advances_version(self):
        g = make_populated()
        ids = g.integrate_revisions("a", [
            {"author": "bob", "base_version": 0, "body": "X\n段1\n段2", "change": "b"},
            {"author": "carol", "base_version": 0, "body": "Y\n段1\n段2", "change": "c"},
        ], strict=False)
        new_v = g.resolve_conflict(ids[0], "editor", "X\n段1\n段2（采纳并补注）", "人工合并")
        self.assertEqual(new_v, 1)
        chain = g.revision_chain("a")
        self.assertEqual(chain[-1]["kind"], "resolve")
        self.assertEqual(chain[-1]["conflict_id"], ids[0])


class AutoMergeTests(unittest.TestCase):
    base = "段0\n段1\n段2\n段3"

    def _fresh(self):
        g = ExperienceGraph()
        g.create_entry("a", "主题", self.base, "alice")
        return g

    def test_disjoint_paragraphs_auto_merge_single_version(self):
        g = self._fresh()
        v = g.integrate_revisions("a", [
            {"author": "bob", "base_version": 0,
             "body": "段0改\n段1\n段2\n段3", "change": "改段0"},
            {"author": "carol", "base_version": 0,
             "body": "段0\n段1\n段2改\n段3", "change": "改段2"},
        ])
        self.assertEqual(v, 1)
        self.assertEqual(g.get_entry("a")["body"], "段0改\n段1\n段2改\n段3")
        self.assertEqual(g.list_conflicts("a"), [])
        # 只产生一条新版本
        self.assertEqual(g.current_version("a"), 1)

    def test_order_independence(self):
        results = set()
        orders = [
            [
                {"author": "bob", "base_version": 0,
                 "body": "段0改\n段1\n段2\n段3", "change": "改段0"},
                {"author": "carol", "base_version": 0,
                 "body": "段0\n段1\n段2改\n段3", "change": "改段2"},
            ],
            [
                {"author": "carol", "base_version": 0,
                 "body": "段0\n段1\n段2改\n段3", "change": "改段2"},
                {"author": "bob", "base_version": 0,
                 "body": "段0改\n段1\n段2\n段3", "change": "改段0"},
            ],
        ]
        for cands in orders:
            g = self._fresh()
            g.integrate_revisions("a", cands)
            results.add(g.get_entry("a")["body"])
        self.assertEqual(len(results), 1)

    def test_merge_matches_serial_application(self):
        from experience_graph import merge as merge_mod
        cands = [
            ("bob", 0, "段0改\n段1\n段2\n段3"),
            ("carol", 0, "段0\n段1\n段2改\n段3"),
        ]
        blocks, _ = merge_mod.integrate(self.base, cands)
        batch = merge_mod.render_blocks(blocks)
        for order in ((0, 1), (1, 0)):
            serial = merge_mod.apply_serially(self.base, cands, list(order))
            self.assertEqual(serial, batch)

    def test_stale_batch_rejected(self):
        g = self._fresh()
        g.submit_revision("a", "x", 0, "段0x\n段1\n段2\n段3", "x")
        with self.assertRaises(StaleRevision) as ctx:
            g.integrate_revisions("a", [
                {"author": "bob", "base_version": 0,
                 "body": "段0B\n段1\n段2\n段3", "change": "b"},
                {"author": "carol", "base_version": 0,
                 "body": "段0\n段1\n段2C\n段3", "change": "c"},
            ])
        self.assertEqual(ctx.exception.behind, 1)
        self.assertEqual(g.current_version("a"), 1)


class DeleteSplitRecomputeTests(unittest.TestCase):
    def _net(self):
        g = make_populated()
        g.add_reference("a", "b")
        g.add_reference("c", "a")
        g.add_reference("c", "b")
        return g

    def test_delete_removes_edges_no_dangling(self):
        g = self._net()
        info = g.delete_entry("b")
        removed = [tuple(e) for e in info["removed_edges"]]
        self.assertEqual(removed, [("a", "b"), ("c", "b")])
        self.assertFalse(g.has_dangling_reference())
        self.assertEqual(g.outgoing("a"), [])
        self.assertEqual(g.backlinks("a"), ["c"])
        with self.assertRaises(EntryNotFound):
            g.current_version("b")

    def test_incremental_equals_full_rebuild(self):
        g = self._net()
        g.delete_entry("b")
        edges_after_delete = set(map(tuple, g.to_dict()["edges"]))
        # 模拟从头重建：手工重建索引后边集合必须一致
        g.rebuild_indexes()
        self.assertEqual(set(map(tuple, g.to_dict()["edges"])), edges_after_delete)

    def test_split_redirects_only_affected_edges(self):
        g = self._net()
        result = g.split_entry("a", [
            {"id": "a1", "topic": "A1", "body": "段0", "author": "alice"},
            {"id": "a2", "topic": "A2", "body": "段1\n段2", "author": "alice"},
        ])
        self.assertEqual(result["redirected_edges"],
                         [("a1", "b"), ("c", "a1")])
        self.assertNotIn("a", g.list_entries())
        self.assertFalse(g.has_dangling_reference())
        self.assertEqual(g.backlinks("a1"), ["c"])
        self.assertEqual(g.outgoing("a1"), ["b"])
        self.assertEqual(g.backlinks("a2"), [])
        # 与从头重建一致
        before = set(map(tuple, g.to_dict()["edges"]))
        g.rebuild_indexes()
        self.assertEqual(set(map(tuple, g.to_dict()["edges"])), before)


class QueryTests(unittest.TestCase):
    def test_revision_chain_and_authors(self):
        g = make_populated()
        g.submit_revision("a", "bob", 0, "段0\n段1\n段2X", "改段2")
        chain = g.revision_chain("a")
        self.assertEqual([c["new_version"] for c in chain], [0, 1])
        self.assertEqual(chain[0]["kind"], "create")
        self.assertEqual(chain[0]["authors"], ["alice"])
        self.assertEqual(chain[1]["authors"], ["bob"])
        self.assertEqual(chain[1]["base_version"], 0)

    def test_diff_versions_stable(self):
        g = make_populated()
        g.submit_revision("a", "bob", 0, "段0\n段1改\n段2", "改段1")
        d = g.diff_versions("a", 0, 1)
        actions = [(op, line) for op, line in d["lines"] if op != "eq"]
        self.assertEqual(actions, [("del", "段1"), ("ins", "段1改")])
        self.assertEqual(d["rendered"], g.diff_versions("a", 0, 1)["rendered"])

    def test_list_entries_sorted(self):
        g = make_populated()
        self.assertEqual(g.list_entries(), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
