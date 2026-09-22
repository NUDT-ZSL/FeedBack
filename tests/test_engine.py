"""引擎核心逻辑测试：候选生成、选优、重规划、失败恢复、手动干预。"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.game import GameController
from engine.models import T_WALL
from engine.planner import generate_candidates, plan_valid


class TestPlanner(unittest.TestCase):
    def setUp(self):
        self.g = GameController(seed=42)

    def test_generates_multiple_candidates_with_expected(self):
        self.g.plan_all()
        for uid, cands in self.g.candidates.items():
            self.assertGreaterEqual(len(cands), 2, f"{uid} 候选计划不足")
            for p in cands:
                self.assertTrue(p.actions, "计划必须包含动作序列")
                self.assertIn("end_pos", p.expected)
                self.assertTrue(p.reason, "计划必须给出评分理由")

    def test_best_plan_selected_with_reason(self):
        self.g.plan_all()
        for uid, plan in self.g.active.items():
            cands = self.g.candidates[uid]
            self.assertEqual(plan.pid, cands[0].pid)
            self.assertGreaterEqual(plan.score, cands[-1].score)
            self.assertEqual(plan.status, "active")

    def test_replan_on_obstacle_keeps_or_replaces(self):
        self.g.plan_all()
        # 找一个带移动动作的计划，在其路径上放障碍
        victim, step = None, None
        for uid, plan in self.g.active.items():
            for a in plan.actions:
                if a.kind == "move" and a.path:
                    victim, step = uid, a.path[len(a.path) // 2]
                    break
            if victim:
                break
        self.assertIsNotNone(victim, "测试场景应存在移动计划")
        self.g.apply_event("obstacle", x=step[0], y=step[1])
        self.assertEqual(self.g.state.grid[step[1]][step[0]], T_WALL)
        logs = [e["text"] for e in self.g.state.log if e["kind"] == "replan"]
        self.assertTrue(any("重评估" in t for t in logs), "应记录重规划触发原因")
        # 受影响单位要么换了有效新计划，要么明确待命
        unit = self.g.state.units[victim]
        new_plan = self.g.active.get(victim)
        if new_plan:
            ok, _ = plan_valid(self.g.state, unit, new_plan)
            self.assertTrue(ok, "新计划必须可行")

    def test_coherent_when_plan_still_valid(self):
        self.g.plan_all()
        # 在远离所有计划路径的角落放障碍，原计划应保持
        self.g.apply_event("obstacle", x=11, y=9)
        logs = [e["text"] for e in self.g.state.log if e["kind"] == "replan"]
        self.assertTrue(any("仍然有效" in t for t in logs))

    def test_failure_fallback(self):
        self.g.plan_all()
        uid, plan = next(iter(self.g.active.items()))
        unit = self.g.state.units[uid]
        # 人为制造失败：把计划第一步路径设为墙
        for a in plan.actions:
            if a.kind == "move" and a.path:
                x, y = a.path[0]
                self.g.state.grid[y][x] = T_WALL
                break
        else:  # 无移动动作则直接耗尽 AP 制造失败
            unit.ap = 0
        self.g._exec_plan(unit, plan)
        self.assertEqual(plan.status, "failed")
        self.assertTrue(plan.fail_reason, "必须记录失败原因")
        fails = [e for e in self.g.state.log if e["kind"] == "fail"]
        self.assertTrue(fails, "失败必须写入日志")

    def test_manual_override_and_cancel(self):
        self.g.plan_all()
        uid = next(iter(self.g.candidates))
        cands = self.g.candidates[uid]
        if len(cands) > 1:
            other = cands[1]
            self.g.override_plan(uid, other.pid)
            self.assertEqual(self.g.active[uid].pid, other.pid)
            self.assertEqual(self.g.active[uid].status, "active")
        self.g.cancel_plan(uid)
        self.assertNotIn(uid, self.g.active)
        manual = [e for e in self.g.state.log if e["kind"] == "manual"]
        self.assertTrue(manual, "手动干预必须写入日志")

    def test_execute_turn_progresses(self):
        self.g.plan_all()
        ap_before = {u.uid: u.ap for u in self.g.state.units.values()}
        self.g.execute_turn()
        st = self.g.state
        self.assertTrue(st.turn == 2 or st.winner, "回合应推进或分出胜负")
        acted = [e for e in st.log if e["kind"] in ("act", "enemy", "fail")]
        self.assertTrue(acted, "回合执行应产生动作记录")

    def test_full_game_terminates(self):
        g = GameController(seed=7)
        g.plan_all()
        for _ in range(60):
            if g.state.winner:
                break
            g.execute_turn()
        self.assertIsNotNone(g.state.winner, "对局应在有限回合内结束")


if __name__ == "__main__":
    unittest.main()

