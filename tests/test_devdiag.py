"""devdiag 单元测试：python -m unittest discover -s tests -v"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from devdiag import (  # noqa: E402
    BoundedClueStore,
    Clue,
    Severity,
    StorageFullError,
    build_report,
    rebuild_chains,
    render_text,
)


def noise(ts, msg="x"):
    return Clue(float(ts), "n", Severity.INFO, msg)


class TestCapacityAndOverwrite(unittest.TestCase):
    def test_oldest_overwritten_when_full(self):
        store = BoundedClueStore(capacity_bytes=200)  # 每条 66 字节，容 3 条
        clues = [store.add(noise(i)) for i in range(4)]
        self.assertEqual(len(store), 3)
        self.assertIsNone(store.get(clues[0].id))
        self.assertIsNotNone(store.get(clues[3].id))
        self.assertEqual(store.overwritten_count, 1)

    def test_tombstone_infers_overwritten_chain_clue(self):
        store = BoundedClueStore(capacity_bytes=100)
        gone = store.add(Clue(1.0, "s", Severity.ERROR, "boom",
                              chain_id="F", state={"x": "1"}))
        store.add(noise(2.0))
        self.assertIsNone(store.get(gone.id))
        self.assertEqual(len(store.tombstones), 1)
        ts = store.tombstones[0]
        self.assertEqual(ts.chain_id, "F")
        self.assertEqual(ts.state, {"x": "1"})
        chains = rebuild_chains(store)
        chain = chains["F"]
        self.assertEqual(chain.events[0].kind, "tombstone")
        self.assertEqual(chain.gaps[0].kind, "overwritten")
        self.assertAlmostEqual(chain.completeness, 0.5)


class TestChainRebuild(unittest.TestCase):
    def test_temporal_causal_path_and_missing_cause(self):
        store = BoundedClueStore(capacity_bytes=10000)
        e1 = store.add(Clue(2.0, "b", Severity.WARNING, "later", chain_id="F"))
        store.add(Clue(1.0, "a", Severity.INFO, "first", chain_id="F"))
        store.add(Clue(3.0, "c", Severity.ERROR, "effect",
                       chain_id="F", caused_by=99999))  # 上游不存在
        chain = rebuild_chains(store)["F"]
        self.assertEqual([e.timestamp for e in chain.events], [1.0, 2.0, 3.0])
        kinds = [g.kind for g in chain.gaps]
        self.assertIn("missing_cause", kinds)
        self.assertAlmostEqual(chain.completeness, 3 / 4)
        self.assertIsNotNone(store.get(e1.id))


class TestConflict(unittest.TestCase):
    def test_both_sides_kept_and_recorded(self):
        store = BoundedClueStore(capacity_bytes=500)
        a = store.add(Clue(4.0, "mon", Severity.ERROR, "pump running",
                           chain_id="F", state={"pump": "on"}))
        b = store.add(Clue(4.0, "op", Severity.WARNING, "pump stopped",
                           chain_id="F", state={"pump": "off"}))
        for i in range(8):
            store.add(noise(10.0 + i))
        self.assertIsNotNone(store.get(a.id))
        self.assertIsNotNone(store.get(b.id))
        self.assertEqual(len(store.conflicts), 1)
        rec = store.conflicts[0]
        self.assertEqual(rec.state_key, "pump")
        self.assertEqual({p.clue_id for p in rec.participants}, {a.id, b.id})
        chain = rebuild_chains(store)["F"]
        self.assertEqual(len(chain.conflicts), 1)


class TestKeyEvidence(unittest.TestCase):
    def test_pinned_until_chain_confirmed(self):
        store = BoundedClueStore(capacity_bytes=200)
        key = store.add(Clue(1.0, "k", Severity.ERROR, "key",
                             chain_id="F", state={"a": "1"}))
        store.mark_key_evidence(key.id)
        for i in range(5):
            store.add(noise(2.0 + i))
        self.assertIsNotNone(store.get(key.id))  # 关键证据被优先保留
        store.confirm_chain("F")                  # 故障链完整确认后解除保护
        for i in range(5):
            store.add(noise(10.0 + i))
        self.assertIsNone(store.get(key.id))
        self.assertTrue(any(t.clue_id == key.id for t in store.tombstones))

    def test_storage_full_when_all_protected(self):
        store = BoundedClueStore(capacity_bytes=70)
        with self.assertRaises(StorageFullError):
            store.add(Clue(1.0, "k", Severity.ERROR, "key",
                           chain_id="F", state={"a": "1"}, key_evidence=True))


class TestReport(unittest.TestCase):
    def test_report_contents(self):
        store = BoundedClueStore(capacity_bytes=400)
        store.add(Clue(1.0, "s", Severity.ERROR, "boom",
                       chain_id="F", state={"x": "1"}))
        store.add(Clue(2.0, "mon", Severity.ERROR, "pump on",
                       chain_id="F", state={"pump": "on"}))
        store.add(Clue(2.0, "op", Severity.WARNING, "pump off",
                       chain_id="F", state={"pump": "off"}))
        for i in range(10):
            store.add(noise(5.0 + i))
        report = build_report(store)
        self.assertGreaterEqual(report.confidence, 0.0)
        self.assertLessEqual(report.confidence, 1.0)
        self.assertGreater(report.overwritten_clues, 0)
        self.assertIn("F", report.overwrite_impact)
        self.assertIn("F", report.chains)
        text = render_text(report)
        self.assertIn("设备诊断报告", text)
        self.assertIn("故障链", text)
        self.assertIn("矛盾环节", text)


if __name__ == "__main__":
    unittest.main()
