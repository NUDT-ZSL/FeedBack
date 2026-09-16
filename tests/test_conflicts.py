"""需求 6：矛盾配置/结果必须双方保留并生成可读冲突记录。"""

import copy
import unittest

from detexp.errors import ConflictPendingError
from detexp.models import Experiment, Slice, Step
from detexp.registry import ExperimentSystem

from .factories import make_normal_mean, make_pi


class TestConfigConflicts(unittest.TestCase):
    def test_conflicting_config_from_another_source_kept(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        status = sys.register_experiment(
            make_normal_mean(n=50), source="lab-b")
        self.assertEqual(status, "conflict")
        conflicts = sys.list_conflicts(kind="config")
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual(c.experiment_id, "nm")
        self.assertEqual(c.status, "open")
        self.assertEqual({c.source_a, c.source_b}, {"lab-a", "lab-b"})
        # 双方内容都保留
        self.assertEqual(
            c.content_a["experiment"]["steps"][0]["params"]["n"], 100)
        self.assertEqual(
            c.content_b["experiment"]["steps"][0]["params"]["n"], 50)
        # 可读记录必须点名实验、双方、差异
        self.assertIn("nm", c.detail)
        self.assertIn("lab-a", c.detail)
        self.assertIn("lab-b", c.detail)
        self.assertIn("100", c.detail)

    def test_same_source_changes_mind_also_conflicts(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        status = sys.register_experiment(
            make_normal_mean(n=80), source="lab-a")
        self.assertEqual(status, "conflict")
        c = sys.list_conflicts(kind="config")[0]
        self.assertIn("同一来源先后给出", c.detail)

    def test_open_config_conflict_blocks_execution(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        sys.register_experiment(make_normal_mean(n=50), source="lab-b")
        with self.assertRaises(ConflictPendingError) as cm:
            sys.run("nm", seed=1)
        self.assertIn("nm", str(cm.exception))

    def test_resolve_picks_a_or_b(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        sys.register_experiment(make_normal_mean(n=50), source="lab-b")
        cid = sys.list_conflicts(kind="config")[0].conflict_id
        sys.resolve_conflict(cid, "b")
        rec = sys.run("nm", seed=1)
        self.assertEqual(rec.step_records[0].result["n"], 50)
        # 裁决后冲突仍保留，只是状态变化
        c = sys.get_conflict(cid)
        self.assertEqual(c.status, "resolved_b")
        self.assertIsNotNone(c.content_a)

    def test_resolve_a_keeps_first(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        sys.register_experiment(make_normal_mean(n=50), source="lab-b")
        cid = sys.list_conflicts(kind="config")[0].conflict_id
        sys.resolve_conflict(cid, "a")
        rec = sys.run("nm", seed=1)
        self.assertEqual(rec.step_records[0].result["n"], 100)

    def test_cannot_resolve_twice(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        sys.register_experiment(make_normal_mean(n=50), source="lab-b")
        cid = sys.list_conflicts(kind="config")[0].conflict_id
        sys.resolve_conflict(cid, "a")
        with self.assertRaises(Exception):
            sys.resolve_conflict(cid, "b")

    def test_reject_does_not_choose(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        sys.register_experiment(make_normal_mean(n=50), source="lab-b")
        cid = sys.list_conflicts(kind="config")[0].conflict_id
        sys.reject_conflict(cid, reason="差异与本实验无关")
        # reject 后活动配置回落到 canonical（lab-a）
        rec = sys.run("nm", seed=1)
        self.assertEqual(rec.step_records[0].result["n"], 100)

    def test_identical_reregister_is_noop(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=100), source="lab-a")
        self.assertEqual(
            sys.register_experiment(make_normal_mean(n=100),
                                     source="lab-b"), "unchanged")
        self.assertEqual(sys.list_conflicts(kind="config"), [])


class TestResultConflicts(unittest.TestCase):
    def test_external_result_matching_local_no_conflict(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        rec = sys.run("nm", seed=1)
        status = sys.submit_result(
            "nm", seed=1, source="lab-x",
            estimate=rec.estimate)
        self.assertEqual(status, "recorded")
        self.assertEqual(sys.list_conflicts(kind="result"), [])

    def test_external_result_contradicts_local(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        sys.run("nm", seed=1)
        sys.submit_result("nm", seed=1, source="lab-x", estimate=999.0)
        conflicts = sys.list_conflicts(kind="result")
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual({c.source_a, c.source_b}, {"local", "lab-x"})
        self.assertIn("999.0", c.detail)
        # 双方结果都在
        local_est = c.content_a.get("estimate")
        ext_est = c.content_b.get("estimate")
        self.assertEqual(ext_est, 999.0)
        self.assertIsNotNone(local_est)
        self.assertNotEqual(local_est, 999.0)

    def test_two_external_sources_conflict(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        sys.submit_result("nm", seed=2, source="lab-x", estimate=1.0)
        sys.submit_result("nm", seed=2, source="lab-y", estimate=2.0)
        conflicts = sys.list_conflicts(kind="result")
        self.assertEqual(len(conflicts), 1)
        self.assertIn("lab-x", conflicts[0].detail)
        self.assertIn("lab-y", conflicts[0].detail)

    def test_same_source_updates_result_conflict(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        sys.submit_result("nm", seed=3, source="lab-x", estimate=1.0)
        status = sys.submit_result(
            "nm", seed=3, source="lab-x", estimate=1.5)
        self.assertEqual(status, "recorded")
        conflicts = sys.list_conflicts(kind="result")
        self.assertEqual(len(conflicts), 1)
        self.assertIn("同一来源先后给出", conflicts[0].detail)

    def test_status_disagreement_is_conflict(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        sys.run("nm", seed=5)
        sys.submit_result("nm", seed=5, source="lab-z", status="failed",
                          estimate=None)
        self.assertEqual(len(sys.list_conflicts(kind="result")), 1)

    def test_local_source_name_reserved(self):
        sys = ExperimentSystem()
        sys.register_experiment(make_normal_mean(n=20))
        with self.assertRaises(ValueError):
            sys.submit_result("nm", seed=1, source="local", estimate=1.0)


if __name__ == "__main__":
    unittest.main()
