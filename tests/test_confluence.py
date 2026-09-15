import unittest

from narrative import Engine, migrate_save
from tests.helpers import build_graph, build_schema
from tests.test_merge import LOG_A, LOG_B  # help-path / rob-path 两条路径的累积变更
from tests.test_migration import v1_save


def fresh_engine():
    engine = Engine(build_schema(), build_graph())
    engine.enter("n0")
    engine.enter("n1")
    return engine


class TestConfluenceOrderIndependence(unittest.TestCase):
    """两条路径以不同顺序到达汇合点，合并结论必须一致。"""

    def arrive_both(self, order):
        engine = fresh_engine()
        for branch, log in order:
            engine.arrive_at("n3", log, branch)
        return engine

    def test_merge_outcome_independent_of_arrival_order(self):
        e1 = self.arrive_both([("help-path", LOG_A), ("rob-path", LOG_B)])
        e2 = self.arrive_both([("rob-path", LOG_B), ("help-path", LOG_A)])
        self.assertEqual(e1.state, e2.state)
        self.assertEqual([c.to_dict() for c in e1.conflicts],
                         [c.to_dict() for c in e2.conflicts])
        self.assertEqual(e1.unresolved_conflicts(), e2.unresolved_conflicts())

    def test_sequential_arrival_equals_one_shot_merge(self):
        seq = self.arrive_both([("rob-path", LOG_B), ("help-path", LOG_A)])
        one_shot = fresh_engine()
        one_shot.apply_merge(LOG_A, LOG_B, "help-path", "rob-path", at="n3")
        self.assertEqual(seq.state, one_shot.state)
        self.assertEqual([c.to_dict() for c in seq.conflicts],
                         [c.to_dict() for c in one_shot.conflicts])

    def test_late_arrival_does_not_clobber_winner(self):
        # help-path（字典序小，胜出）先到，rob-path 后到不得覆盖 trust
        e1 = fresh_engine()
        e1.arrive_at("n3", LOG_A, "help-path")
        self.assertEqual(e1.state["trust"], 3)
        e1.arrive_at("n3", LOG_B, "rob-path")
        self.assertEqual(e1.state["trust"], 3, "后到分支不得覆盖胜出方")
        # rob-path 先到时 trust=-1 先生效，help-path 到达后必须纠正为胜出值
        e2 = fresh_engine()
        e2.arrive_at("n3", LOG_B, "rob-path")
        self.assertEqual(e2.state["trust"], -1)
        e2.arrive_at("n3", LOG_A, "help-path")
        self.assertEqual(e2.state["trust"], 3, "胜出方到达后生效值必须收敛到规则结果")
        self.assertEqual(e1.state, e2.state)


class TestConflictConsistency(unittest.TestCase):
    """冲突记录与当前生效值自洽；未解决时取值可解释。"""

    def setUp(self):
        self.engine = fresh_engine()
        self.engine.arrive_at("n3", LOG_B, "rob-path")
        self.engine.arrive_at("n3", LOG_A, "help-path")

    def test_conflict_record_matches_effective_value(self):
        conflicts = self.engine.unresolved_conflicts()
        self.assertEqual(len(conflicts), 1)
        c = conflicts[0]
        self.assertEqual(c["variable"], "trust")
        # 记录中的生效值 == 状态中的实际值 == 胜出方的值
        self.assertEqual(c["effective_value"], self.engine.state["trust"])
        self.assertEqual(c["effective_value"], c["value_a"])  # help-path 胜出
        self.assertEqual(c["effective_source"], "help-path")
        self.assertEqual(c["status"], "unresolved")
        # 双方来源都保留
        self.assertEqual(c["sources_a"], ["节点n2a/变更c2"])
        self.assertEqual(c["sources_b"], ["节点n2b/变更c2"])

    def test_variable_status_explains_value(self):
        st = self.engine.variable_status("trust")
        self.assertEqual(st["status"], "unresolved")
        self.assertEqual(st["source"], "help-path")
        self.assertEqual(st["value"], 3)
        self.assertEqual(self.engine.variable_status("gold")["status"], "normal")

    def test_resolution_sticks_across_recompute(self):
        self.engine.resolve_conflict("trust", "rob-path")
        self.assertEqual(self.engine.state["trust"], -1)
        # 再次到达（触发重算）后，解决结果仍然保持
        self.engine.arrive_at("n3", LOG_A, "help-path")
        self.assertEqual(self.engine.state["trust"], -1)
        st = self.engine.variable_status("trust")
        self.assertEqual(st["status"], "resolved")
        self.assertEqual(self.engine.unresolved_conflicts(), [])


class TestConfluenceRollback(unittest.TestCase):
    """回退链路：汇合之后产生的痕迹（含冲突记录）必须一并回退。"""

    def setUp(self):
        self.engine = Engine(build_schema(), build_graph())
        self.engine.enter("n0")
        self.engine.enter("n1")
        self.engine.enter("n2a")   # 路径 A：met_ally=True, trust=3
        self.pre_merge_state = dict(self.engine.state)  # n3 进入前的状态
        self.pre_merge_log_len = len(self.engine.change_log)
        self.engine.enter("n3")    # 到达汇合节点
        self.engine.arrive_at("n3", LOG_A, "help-path")
        self.engine.arrive_at("n3", LOG_B, "rob-path")

    def test_rollback_removes_all_confluence_traces(self):
        self.assertEqual(len(self.engine.conflicts), 1)  # 汇合后确有冲突
        self.engine.rollback_to("n3")
        e = self.engine
        self.assertEqual(e.confluences, {}, "汇合点状态必须随快照回退")
        self.assertEqual(e.conflicts, [], "冲突记录不得残留")
        self.assertEqual(e.unresolved_conflicts(), [])
        self.assertEqual(e.state, self.pre_merge_state)
        self.assertEqual(len(e.change_log), self.pre_merge_log_len,
                         "合并产生的变更日志不得残留")
        self.assertEqual(e.progress, 3)
        self.assertEqual(e.unlocked, {"n0", "n1", "n2a"})
        self.assertEqual(e.branch_attribution(), "n1:help")
        self.assertEqual(e.current_node, "n2a")

    def test_rewalk_other_path_reproduces_first_time_result(self):
        # 参照：全新引擎首次走路径 B
        reference = Engine(build_schema(), build_graph())
        reference.enter("n0")
        reference.enter("n1")
        reference.enter("n2b")
        reference.enter("n3")
        reference.arrive_at("n3", LOG_B, "rob-path")

        e = self.engine
        e.rollback_to("n1")          # 回退到分叉前
        e.enter("n1")
        e.enter("n2b")               # 改走路径 B
        e.enter("n3")
        e.arrive_at("n3", LOG_B, "rob-path")
        self.assertEqual(e.state, reference.state)
        self.assertEqual(e.branch_attribution(), reference.branch_attribution())
        self.assertEqual(e.progress, reference.progress)
        self.assertEqual([c.to_dict() for c in e.conflicts],
                         [c.to_dict() for c in reference.conflicts])
        # 再让另一条路径到达，结论与首次双路径合并一致
        e.arrive_at("n3", LOG_A, "help-path")
        self.assertEqual(e.state["trust"], 3)
        self.assertEqual(len(e.unresolved_conflicts()), 1)

    def test_save_load_after_merge_then_rollback(self):
        data = self.engine.save()
        clone = Engine.load(data, build_schema(), build_graph())
        self.assertEqual([c.to_dict() for c in clone.conflicts],
                         [c.to_dict() for c in self.engine.conflicts])
        clone.rollback_to("n3")
        self.assertEqual(clone.confluences, {})
        self.assertEqual(clone.state, self.pre_merge_state)


class TestMigrationKeepsMergeBehavior(unittest.TestCase):
    """迁移旧存档后，合并行为与冲突查询不变。"""

    def test_merge_after_migration_matches_fresh_engine(self):
        from tests.helpers import build_schema as bs
        from narrative import VariableDef
        schema_v2 = bs(extra=[VariableDef("karma", "int", 5)])
        migrated = Engine.load(migrate_save(v1_save()), schema_v2, build_graph())
        migrated.arrive_at("n3", LOG_B, "rob-path")
        migrated.arrive_at("n3", LOG_A, "help-path")

        fresh = Engine(bs(extra=[VariableDef("karma", "int", 5)]), build_graph())
        fresh.arrive_at("n3", LOG_A, "help-path")
        fresh.arrive_at("n3", LOG_B, "rob-path")

        for var in ("trust", "gold", "met_ally"):
            self.assertEqual(migrated.state[var], fresh.state[var])
        self.assertEqual(migrated.unresolved_conflicts(),
                         fresh.unresolved_conflicts())

    def test_legacy_flat_conflicts_survive_load(self):
        # v2 之前风格的存档：只有扁平 conflicts，没有 confluences 字段
        save = fresh_engine().save()
        save["confluences"] = {}
        save.pop("confluences")
        save["conflicts"] = [{
            "variable": "trust", "branch_a": "help-path", "value_a": 3,
            "sources_a": ["节点n2a/变更c2"], "branch_b": "rob-path",
            "value_b": -1, "sources_b": ["节点n2b/变更c2"],
            "winner": "help-path", "resolved": False,
        }]
        engine = Engine.load(save, build_schema(), build_graph())
        unresolved = engine.unresolved_conflicts()
        self.assertEqual(len(unresolved), 1)
        self.assertEqual(unresolved[0]["effective_value"], 3)
        self.assertEqual(unresolved[0]["effective_source"], "help-path")
        self.assertEqual(engine.variable_status("trust")["status"], "unresolved")


if __name__ == "__main__":
    unittest.main()
