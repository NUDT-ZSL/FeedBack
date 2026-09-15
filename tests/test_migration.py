import unittest

from narrative import (Edge, Engine, Graph, Node, StateChange, ValidationError,
                       VariableDef, migrate_save)
from tests.helpers import build_graph, build_schema


def v1_save():
    """构造一份 v1 格式旧存档：缺 history/conflicts 等新字段，
    引用 v2 中将被移除的节点 n_old，且缺少新版变量。"""
    return {
        "format_version": 1,
        "content_version": "1.0.0",
        "state": {"trust": 2, "gold": 7, "reputation": 0.0,
                  "met_ally": False, "name": "hero"},
        "progress": 3,
        "unlocked": ["n0", "n1", "n_old"],
        "branch_trail": [["n1", "help"]],
        "change_log": [
            {"node": "n0", "change": "c1", "variable": "name",
             "op": "set", "old": "wanderer", "new": "hero", "branch": "main"},
            {"node": "n_old", "change": "c1", "variable": "trust",
             "op": "add", "old": 0, "new": 2, "branch": "n1:help"},
        ],
        "current_node": "n_old",
    }


class TestMigration(unittest.TestCase):
    def setUp(self):
        # v2：新增变量 karma；节点 n_old 被移除
        self.schema_v2 = build_schema(extra=[VariableDef("karma", "int", 5)])
        graph = build_graph()
        self.graph_v2 = Graph(
            [Node("n_new", "ch3",
                  changes=[StateChange("c1", "karma", "add", 1)])] +
            [graph.nodes[n] for n in graph.node_ids()],
            graph.edges + [Edge("n3", "n_new")],
        )

    def test_format_chain_and_content_evolution(self):
        migrated = migrate_save(v1_save())
        self.assertEqual(migrated["format_version"], 2)
        engine = Engine.load(migrated, self.schema_v2, self.graph_v2,
                             content_version="2.0.0")
        # 新版变量补默认值
        self.assertEqual(engine.state["karma"], 5)
        self.assertTrue(any("karma" in n for n in engine.migration_notes))
        # 被移除的节点标记不可用
        self.assertEqual(engine.unavailable_nodes, ["n_old"])
        self.assertTrue(any("n_old" in n for n in engine.migration_notes))
        # 进度与分支归属与迁移前一致
        self.assertEqual(engine.progress, 3)
        self.assertEqual(engine.unlocked, {"n0", "n1", "n_old"})
        self.assertEqual(engine.branch_attribution(), "n1:help")
        self.assertEqual(engine.current_node, "n_old")

    def test_unmigrated_old_save_rejected(self):
        with self.assertRaises(ValidationError):
            Engine.load(v1_save(), self.schema_v2, self.graph_v2)

    def test_unknown_migration_step_rejected(self):
        data = v1_save()
        data["format_version"] = 0
        with self.assertRaises(ValidationError):
            migrate_save(data)

    def test_migrated_save_can_continue_playing(self):
        engine = Engine.load(migrate_save(v1_save()), self.schema_v2, self.graph_v2)
        engine.enter("n0")  # 重进已解锁节点，继续累积
        engine.enter("n1")
        self.assertEqual(engine.state["trust"], 4)
        self.assertEqual(engine.progress, 5)


if __name__ == "__main__":
    unittest.main()
