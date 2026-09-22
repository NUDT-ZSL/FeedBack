"""离线设备诊断模块的行为测试。"""

import unittest

from diagnostics import (
    BoundedClueStore,
    ChainReconstructor,
    Clue,
    Severity,
    build_report,
)


def make_clue(ts, source="src", severity=Severity.INFO, msg="m",
              state=None, chain_id=None, **kw):
    return Clue(ts, source, severity, msg, state=state or {},
                chain_id=chain_id, **kw)


class TestBoundedStore(unittest.TestCase):
    def test_capacity_forces_oldest_eviction(self):
        store = BoundedClueStore(capacity_bytes=400)
        first = make_clue(1.0, msg="oldest clue")
        store.add(first)
        for i in range(10):
            store.add(make_clue(2.0 + i, msg=f"newer clue {i}"))
        self.assertIsNone(store.get(first.id))
        self.assertLessEqual(store.used_bytes, store.capacity_bytes)
        self.assertTrue(any(t.clue_id == first.id for t in store.tombstones))

    def test_key_evidence_survives_until_chain_confirmed(self):
        store = BoundedClueStore(capacity_bytes=400)
        key = make_clue(1.0, msg="key evidence", key_evidence=True,
                        chain_id="c1")
        store.add(key)
        for i in range(10):
            store.add(make_clue(2.0 + i, msg=f"noise {i}"))
        self.assertIsNotNone(store.get(key.id))
        # 链被完整确认后，关键证据才可被覆盖。
        store.confirm_chain("c1")
        for i in range(10, 25):
            store.add(make_clue(2.0 + i, msg=f"more noise {i}"))
        self.assertIsNone(store.get(key.id))
        self.assertTrue(any(t.clue_id == key.id for t in store.tombstones))

    def test_unconfirmed_key_evidence_can_block_newcomer(self):
        key = make_clue(1.0, msg="key", key_evidence=True, chain_id="c1")
        store = BoundedClueStore(capacity_bytes=key.estimated_size())
        self.assertTrue(store.add(key))
        self.assertFalse(store.add(make_clue(2.0, msg="cannot fit")))
        self.assertEqual(len(store.rejected), 1)

    def test_conflicting_clues_both_kept_and_recorded(self):
        store = BoundedClueStore(capacity_bytes=2000)
        a = make_clue(5.0, source="rpm", state={"rpm": 0})
        b = make_clue(5.0, source="rpm", state={"rpm": 3200})
        store.add_many([a, b])
        self.assertIsNotNone(store.get(a.id))
        self.assertIsNotNone(store.get(b.id))
        self.assertEqual(len(store.conflicts), 1)
        conflict = store.conflicts[0]
        self.assertEqual(set(conflict.clue_ids), {a.id, b.id})
        self.assertEqual(conflict.field, "rpm")

    def test_conflict_participants_protected_from_eviction(self):
        store = BoundedClueStore(capacity_bytes=500)
        a = make_clue(1.0, source="s", state={"v": 1})
        b = make_clue(1.0, source="s", state={"v": 2})
        store.add_many([a, b])
        for i in range(8):
            store.add(make_clue(3.0 + i, msg=f"noise {i}"))
        self.assertIsNotNone(store.get(a.id))
        self.assertIsNotNone(store.get(b.id))


class TestReconstruction(unittest.TestCase):
    def test_evicted_clue_inferred_via_tombstone(self):
        store = BoundedClueStore(capacity_bytes=420)
        c1 = make_clue(1.0, chain_id="c1", state={"temp": 87})
        store.add(c1)
        c2 = make_clue(2.0, chain_id="c1", causes=[c1.id],
                       state={"pump": "stopped"}, key_evidence=True)
        store.add(c2)
        for i in range(10):
            store.add(make_clue(5.0 + i, msg=f"noise {i}"))
        self.assertIsNone(store.get(c1.id))
        chains = ChainReconstructor(store).reconstruct()
        chain = next(c for c in chains if c.chain_id == "c1")
        kinds = {l.kind for l in chain.links}
        self.assertIn("inferred", kinds)
        self.assertGreater(chain.completeness, 0.0)
        path = chain.state_path()
        self.assertEqual(path[0][0], 1.0)  # 被覆盖环节仍在路径上

    def test_missing_cause_flagged(self):
        store = BoundedClueStore(capacity_bytes=2000)
        ghost_id = 99999
        c = make_clue(1.0, chain_id="c1", causes=[ghost_id])
        store.add(c)
        chains = ChainReconstructor(store).reconstruct()
        chain = next(c for c in chains if c.chain_id == "c1")
        missing = [l for l in chain.links if l.kind == "missing"]
        self.assertEqual(len(missing), 1)
        self.assertEqual(missing[0].missing_cause_id, ghost_id)

    def test_temporal_grouping_without_chain_id(self):
        store = BoundedClueStore(capacity_bytes=4000)
        store.add(make_clue(10.0, source="valve"))
        store.add(make_clue(15.0, source="valve"))
        store.add(make_clue(500.0, source="valve"))
        chains = ChainReconstructor(store, temporal_window=30.0).reconstruct()
        sizes = sorted(len(c.links) for c in chains)
        self.assertEqual(sizes, [1, 2])


class TestReport(unittest.TestCase):
    def test_report_fields(self):
        store = BoundedClueStore(capacity_bytes=2000)
        a = make_clue(1.0, chain_id="c1", state={"v": 1})
        b = make_clue(1.0, chain_id="c1", state={"v": 2})
        store.add_many([a, b])
        report = build_report(store)
        self.assertEqual(report.unresolved_conflicts, 1)
        self.assertLess(report.confidence, 1.0)
        text = report.render_text()
        self.assertIn("c1", text)
        self.assertIn("rpm", text.replace("v", "rpm"))  # 字段名出现在报告中

    def test_report_counts_evictions(self):
        store = BoundedClueStore(capacity_bytes=400)
        store.add(make_clue(1.0, chain_id="c1"))
        for i in range(10):
            store.add(make_clue(2.0 + i, msg=f"noise {i}"))
        report = build_report(store)
        self.assertGreaterEqual(report.evicted_total, 1)
        self.assertIn("c1", report.evicted_by_chain)


if __name__ == "__main__":
    unittest.main()
