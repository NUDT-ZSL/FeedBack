import unittest

from narrative import Engine, ValidationError
from tests.helpers import build_graph, build_schema


class TestRollback(unittest.TestCase):
    def setUp(self):
        self.engine = Engine(build_schema(), build_graph())
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2a")   # 分支归属 n1:help
        self.snapshot_before_n1 = {
            "state": {"trust": 0, "gold": 10, "reputation": 0.0,
                      "met_ally": False, "name": "hero"},
            "progress": 1,
            "unlocked": {"n0"},
            "branch": "main",
            "current": "n0",
            "log_len": 1,
        }

    def test_rollback_to_restores_snapshot_completely(self):
        self.engine.rollback_to("n1")
        e = self.engine
        self.assertEqual(e.state, self.snapshot_before_n1["state"])
        self.assertEqual(e.progress, self.snapshot_before_n1["progress"])
        self.assertEqual(e.unlocked, self.snapshot_before_n1["unlocked"])
        self.assertEqual(e.branch_attribution(), self.snapshot_before_n1["branch"])
        self.assertEqual(e.current_node, self.snapshot_before_n1["current"])
        self.assertEqual(len(e.change_log), self.snapshot_before_n1["log_len"])
        # 后续痕迹不残留：再走进 n1 后状态与首次一致
        e.enter("n1")
        self.assertEqual(e.state["trust"], 2)
        self.assertEqual(e.progress, 2)

    def test_rollback_steps(self):
        self.engine.rollback_steps(2)  # 撤销 n2a、n1 两次进入
        self.assertEqual(self.engine.current_node, "n0")
        self.assertEqual(self.engine.progress, 1)
        self.assertEqual(self.engine.unlocked, {"n0"})

    def test_rollback_to_unknown_node_rejected(self):
        with self.assertRaises(ValidationError):
            self.engine.rollback_to("n2b")
        with self.assertRaises(ValidationError):
            self.engine.rollback_steps(99)

    def test_save_load_roundtrip_preserves_everything(self):
        data = self.engine.save()
        clone = Engine.load(data, build_schema(), build_graph())
        self.assertEqual(clone.state, self.engine.state)
        self.assertEqual(clone.progress, self.engine.progress)
        self.assertEqual(clone.unlocked, self.engine.unlocked)
        self.assertEqual(clone.branch_attribution(), self.engine.branch_attribution())
        self.assertEqual(clone.change_log, self.engine.change_log)
        self.assertEqual(clone.current_node, self.engine.current_node)
        # 读档后仍可回退到 n1 进入前
        clone.rollback_to("n1")
        self.assertEqual(clone.state, self.snapshot_before_n1["state"])
        self.assertEqual(clone.branch_attribution(), "main")


if __name__ == "__main__":
    unittest.main()
