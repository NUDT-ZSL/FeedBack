"""Core behavior tests: determinism, constraints, evidence, stability."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from feedback_app.models import Feedback
from feedback_app.store import Store


def fb(fid, text):
    return Feedback(id=fid, source="test", timestamp=1.0, text=text, tags=[])


SAMPLES = [
    ("f1", "登录的时候总是提示密码错误，明明输对了"),
    ("f2", "登录失败，一直说密码不对"),
    ("f3", "密码正确但登录不上，提示密码错误"),
    ("f4", "希望夜间模式，晚上太刺眼"),
    ("f5", "建议增加深色模式，保护眼睛"),
    ("f6", "导出报表经常卡在百分之九十"),
    ("f7", "报表导出到90%就不动了"),
]


def make_store():
    store = Store(path=None, threshold=0.10, band=0.05)
    for fid, text in SAMPLES:
        store.feedbacks[fid] = fb(fid, text)
    store.recompute()
    return store


def grouping(store):
    return sorted(tuple(sorted(c.member_ids)) for c in store.clusters)


class TestAutoCluster(unittest.TestCase):
    def test_similar_feedback_groups_together(self):
        store = make_store()
        groups = grouping(store)
        self.assertIn(("f1", "f2", "f3"), groups)
        self.assertIn(("f4", "f5"), groups)
        self.assertIn(("f6", "f7"), groups)

    def test_cluster_has_label_and_terms(self):
        store = make_store()
        for cl in store.clusters:
            self.assertTrue(cl.label)
            self.assertTrue(cl.representative_id in cl.member_ids)
            self.assertTrue(cl.top_terms)

    def test_deterministic_across_input_order(self):
        store_a = Store(path=None)
        store_b = Store(path=None)
        for fid, text in SAMPLES:
            store_a.feedbacks[fid] = fb(fid, text)
        for fid, text in reversed(SAMPLES):
            store_b.feedbacks[fid] = fb(fid, text)
        store_a.recompute()
        store_b.recompute()
        self.assertEqual(grouping(store_a), grouping(store_b))


class TestManualOps(unittest.TestCase):
    def test_merge_then_matches_from_scratch(self):
        # Path 1: merge two clusters via the manual op.
        store = make_store()
        ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
        ok, _ = store.op_merge(ids[("f4", "f5")], ids[("f6", "f7")])
        self.assertTrue(ok)
        after_op = grouping(store)
        # Path 2: apply the same constraints directly and recompute.
        store2 = make_store()
        store2.must_link = set(store.must_link)
        store2.cannot_link = set(store.cannot_link)
        store2.recompute()
        self.assertEqual(after_op, grouping(store2))
        self.assertIn(("f4", "f5", "f6", "f7"), after_op)

    def test_split_is_order_independent(self):
        def build(op_order):
            store = make_store()
            ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
            login = ids[("f1", "f2", "f3")]
            dark = ids[("f4", "f5")]
            ops = {
                "split": lambda: store.op_split(login, ["f3"]),
                "merge": lambda: store.op_merge(dark, ids[("f6", "f7")]),
            }
            for name in op_order:
                ok, msg = ops[name]()
                assert ok, msg
            return grouping(store)

        self.assertEqual(build(["split", "merge"]), build(["merge", "split"]))

    def test_move_updates_grouping(self):
        store = make_store()
        ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
        ok, _ = store.op_move("f3", ids[("f4", "f5")])
        self.assertTrue(ok)
        groups = grouping(store)
        self.assertIn(("f3", "f4", "f5"), groups)
        self.assertIn(("f1", "f2"), groups)

    def test_reset_restores_auto_grouping(self):
        store = make_store()
        baseline = grouping(store)
        ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
        store.op_merge(ids[("f4", "f5")], ids[("f6", "f7")])
        store.op_reset()
        self.assertEqual(grouping(store), baseline)


class TestEvidence(unittest.TestCase):
    def test_borderline_pairs_keep_evidence(self):
        store = make_store()
        borderline = [e for e in store.evidence if e.borderline]
        self.assertTrue(borderline, "borderline pairs must keep evidence")
        for ev in borderline:
            self.assertTrue(ev.shared_terms)
            self.assertIn(ev.decision, ("merged", "kept_separate"))
            self.assertAlmostEqual(
                abs(ev.similarity - store.threshold) <= store.band, True)

    def test_threshold_nudge_keeps_evidence_trail(self):
        store = make_store()
        before = {(e.a, e.b): e.decision for e in store.evidence}
        self.assertTrue(before)
        # Nudge the threshold slightly: evidence records must remain
        # available for the same pairs so decisions stay auditable.
        store.set_params(threshold=store.threshold + 0.01)
        after = {(e.a, e.b): e.decision for e in store.evidence}
        common = set(before) & set(after)
        self.assertTrue(common, "evidence trail lost after threshold nudge")

    def test_manual_decisions_recorded_in_evidence(self):
        store = make_store()
        ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
        store.op_merge(ids[("f4", "f5")], ids[("f6", "f7")])
        reasons = {e.reason for e in store.evidence}
        self.assertIn("must_link", reasons)


class TestCrud(unittest.TestCase):
    def test_add_edit_delete_feedback(self):
        store = make_store()
        added = store.add_feedback("客服", "登录报错密码错误登不上", ["登录"])
        groups = grouping(store)
        self.assertIn(("f1", "f2", "f3", added.id), groups)
        store.update_feedback(added.id, text="完全无关的内容xyz")
        groups = grouping(store)
        self.assertIn(("f1", "f2", "f3"), groups)
        self.assertTrue(store.delete_feedback(added.id))
        self.assertIn(("f1", "f2", "f3"), grouping(store))

    def test_persistence_roundtrip(self):
        import tempfile
        path = os.path.join(tempfile.mkdtemp(), "data.json")
        store = Store(path=path)
        for fid, text in SAMPLES:
            store.feedbacks[fid] = fb(fid, text)
        store.recompute()
        ids = {tuple(sorted(c.member_ids)): c.id for c in store.clusters}
        store.op_merge(ids[("f4", "f5")], ids[("f6", "f7")])
        expected = grouping(store)
        # Reload from disk: grouping must reproduce exactly.
        store2 = Store(path=path)
        self.assertEqual(grouping(store2), expected)


if __name__ == "__main__":
    unittest.main()
