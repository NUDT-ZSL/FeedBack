"""游戏控制器：回合执行、环境变化重规划、失败恢复与手动干预（需求 3-6）。"""
import random

from .models import GameState, Unit, Skill, T_WALL, T_COVER_LOW, T_COVER_HIGH
from .planner import generate_candidates, plan_valid
from .pathfinding import find_path, has_los, dist


def build_default_state():
    s = GameState(12, 10)
    for (x, y) in [(4, 2), (4, 3), (7, 6), (7, 7), (5, 5)]:
        s.grid[y][x] = T_WALL
    for (x, y) in [(3, 6), (6, 3), (8, 4), (5, 8), (9, 2)]:
        s.grid[y][x] = T_COVER_LOW
    for (x, y) in [(6, 6), (3, 3)]:
        s.grid[y][x] = T_COVER_HIGH
    s.objective = (10, 4)
    rifle = Skill("rifle", "突击步枪", "attack", 2, 5, 30)
    sniper = Skill("sniper", "狙击枪", "attack", 2, 8, 45)
    smg = Skill("smg", "冲锋枪", "attack", 2, 4, 25)
    medkit = Skill("medkit", "医疗包", "heal", 2, 3, 35)
    players = [
        Unit("P1", "突击手", "player", 1, 2, 100, 100, 4, 4, 6, [rifle]),
        Unit("P2", "狙击手", "player", 1, 5, 80, 80, 4, 4, 8, [sniper]),
        Unit("P3", "医疗兵", "player", 2, 7, 90, 90, 4, 4, 6,
             [Skill("pistol", "手枪", "attack", 1, 3, 15), medkit]),
        Unit("P4", "侦察兵", "player", 1, 8, 90, 90, 5, 5, 7, [smg]),
    ]
    erifle = Skill("erifle", "步枪", "attack", 2, 4, 20)
    enemies = [
        Unit("E1", "敌兵A", "enemy", 9, 2, 70, 70, 4, 4, 5, [erifle]),
        Unit("E2", "敌兵B", "enemy", 10, 6, 70, 70, 4, 4, 5, [erifle]),
        Unit("E3", "敌兵C", "enemy", 8, 8, 70, 70, 4, 4, 5, [erifle]),
    ]
    for u in players + enemies:
        s.units[u.uid] = u
    return s


class GameController:
    def __init__(self, seed=None):
        self.rng = random.Random(seed)
        self.state = build_default_state()
        self.candidates = {}   # uid -> [Plan]
        self.active = {}       # uid -> Plan
        self.failed = {}       # uid -> [pid] 已失败的计划

    # ---------- 需求 1/2：生成候选并选优 ----------
    def plan_all(self):
        st = self.state
        for u in st.units.values():
            if u.alive and u.side == "player":
                cands = generate_candidates(st, u)
                self.candidates[u.uid] = cands
                if cands:
                    best = cands[0]
                    best.status = "active"
                    self.active[u.uid] = best
                    st.add_log("plan",
                               f"{u.name} 选定计划[{best.summary()}]：{best.reason}")
        return self.to_dict()

    # ---------- 需求 5：执行与失败恢复 ----------
    def execute_turn(self):
        st = self.state
        if st.winner:
            return self.to_dict()
        for u in list(st.units.values()):
            if u.alive and u.side == "player":
                u.overwatch = False
                plan = self.active.get(u.uid)
                if plan:
                    self._exec_plan(u, plan)
        self._enemy_phase()
        self._check_end()
        if not st.winner:
            st.turn += 1
            for u in st.units.values():
                if u.alive:
                    u.ap = u.max_ap
            self.plan_all()
        return self.to_dict()

    def _exec_plan(self, unit, plan):
        st = self.state
        for action in plan.actions:
            ok, reason = self._exec_action(unit, action)
            if not ok:
                plan.status = "failed"
                plan.fail_reason = reason
                self.failed.setdefault(unit.uid, []).append(plan.pid)
                st.add_log("fail", f"{unit.name} 动作[{action.desc or action.kind}]"
                                   f"失败：{reason}")
                nxt = self._fallback(unit)
                if nxt is None:
                    st.add_log("fail", f"{unit.name} 无可用备选计划，原地待命")
                    return
                st.add_log("plan", f"{unit.name} 启用备选计划[{nxt.summary()}]")
                self._exec_plan(unit, nxt)
                return
        plan.status = "completed"

    def _fallback(self, unit):
        cands = generate_candidates(self.state, unit)
        tried = set(self.failed.get(unit.uid, []))
        for p in cands:
            if p.pid not in tried and p.ap_cost <= unit.ap:
                p.status = "active"
                self.active[unit.uid] = p
                self.candidates[unit.uid] = cands
                return p
        self.active.pop(unit.uid, None)
        return None

    def _exec_action(self, unit, a):
        st = self.state
        if a.ap_cost > unit.ap:
            return False, "AP不足"
        if a.kind == "move":
            for step in a.path:
                if st.tile(*step) == T_WALL:
                    return False, "路径被障碍阻挡"
                occ = st.unit_at(*step)
                if occ and occ.uid != unit.uid:
                    return False, f"路径被{occ.name}占据"
            if a.path:
                unit.x, unit.y = a.path[-1]
            st.add_log("act", f"{unit.name} 移动到({unit.x},{unit.y})")
        elif a.kind == "attack":
            t = st.units.get(a.target)
            skill = unit.skill("attack")
            if not t or not t.alive:
                return False, "目标已不存在"
            if dist(unit.pos, t.pos) > skill.rng or not has_los(st, unit.pos, t.pos):
                return False, "目标不在射程或视线内"
            cover = st.tile(*t.pos)
            hit = 0.85 - (0.15 if cover == T_COVER_LOW else
                          0.3 if cover == T_COVER_HIGH else 0)
            if self.rng.random() > hit:
                unit.ap -= a.ap_cost
                return False, "攻击未命中"
            t.hp = max(0, t.hp - skill.power)
            st.add_log("act", f"{unit.name} 命中 {t.name}，造成{skill.power}伤害"
                              + (f"，{t.name}阵亡" if not t.alive else ""))
        elif a.kind == "heal":
            t = st.units.get(a.target)
            skill = unit.skill("heal")
            if not t or not t.alive:
                return False, "治疗目标不存在"
            if dist(unit.pos, t.pos) > skill.rng:
                return False, "目标超出治疗范围"
            t.hp = min(t.max_hp, t.hp + skill.power)
            st.add_log("act", f"{unit.name} 治疗 {t.name} {skill.power}点")
        elif a.kind == "overwatch":
            unit.overwatch = True
            st.add_log("act", f"{unit.name} 进入警戒状态")
        unit.ap -= a.ap_cost
        return True, ""

    # ---------- 敌方回合与警戒反应 ----------
    def _enemy_phase(self):
        st = self.state
        players = [u for u in st.units.values() if u.alive and u.side == "player"]
        for e in [u for u in st.units.values() if u.alive and u.side == "enemy"]:
            if not players:
                break
            atk = e.skill("attack")
            target = min(players, key=lambda p: dist(e.pos, p.pos))
            if dist(e.pos, target.pos) <= atk.rng and has_los(st, e.pos, target.pos):
                if self.rng.random() < 0.7:
                    target.hp = max(0, target.hp - atk.power)
                    st.add_log("enemy", f"{e.name} 命中 {target.name}，"
                                        f"造成{atk.power}伤害"
                                        + (f"，{target.name}阵亡" if not target.alive else ""))
                else:
                    st.add_log("enemy", f"{e.name} 攻击 {target.name} 未命中")
            else:
                path = find_path(st, e.pos, target.pos, max_len=60)
                if path:
                    steps = path[:3]
                    for sp in steps:
                        if st.walkable(*sp):
                            e.x, e.y = sp
                    st.add_log("enemy", f"{e.name} 移动到({e.x},{e.y})")
                    self._overwatch_react(e)
            players = [u for u in st.units.values() if u.alive and u.side == "player"]

    def _overwatch_react(self, enemy):
        st = self.state
        for u in st.units.values():
            if u.alive and u.side == "player" and u.overwatch:
                atk = u.skill("attack")
                if atk and dist(u.pos, enemy.pos) <= atk.rng \
                        and has_los(st, u.pos, enemy.pos):
                    if self.rng.random() < 0.6:
                        enemy.hp = max(0, enemy.hp - atk.power)
                        st.add_log("act", f"{u.name} 警戒射击命中 {enemy.name}，"
                                          f"造成{atk.power}伤害"
                                          + ("，目标阵亡" if not enemy.alive else ""))
                    else:
                        st.add_log("act", f"{u.name} 警戒射击未命中 {enemy.name}")
                    u.overwatch = False
                    if not enemy.alive:
                        return

    def _check_end(self):
        st = self.state
        players = [u for u in st.units.values() if u.alive and u.side == "player"]
        enemies = [u for u in st.units.values() if u.alive and u.side == "enemy"]
        if not enemies:
            st.winner = "player"
            st.add_log("sys", "全部敌人被消灭，任务成功！")
        elif not players:
            st.winner = "enemy"
            st.add_log("sys", "小队全灭，任务失败。")
        elif any(u.pos == st.objective for u in players):
            st.winner = "player"
            st.add_log("sys", "已占领目标点，任务成功！")

    # ---------- 需求 3：环境变化后重新评估与重规划 ----------
    def apply_event(self, etype, **kw):
        st = self.state
        if etype == "obstacle":
            x, y = int(kw["x"]), int(kw["y"])
            if st.tile(x, y) != T_WALL and not st.unit_at(x, y) \
                    and (x, y) != st.objective:
                st.grid[y][x] = T_WALL
                self._replan_after_change(f"环境变化：({x},{y})出现新障碍")
        elif etype == "enemy_move":
            enemies = [u for u in st.units.values()
                       if u.alive and u.side == "enemy"]
            if enemies:
                e = self.rng.choice(enemies)
                spots = [(e.x + dx, e.y + dy)
                         for dx in range(-3, 4) for dy in range(-3, 4)
                         if st.walkable(e.x + dx, e.y + dy)]
                if spots:
                    e.x, e.y = self.rng.choice(spots)
                    st.add_log("enemy", f"{e.name} 移动到({e.x},{e.y})")
                    self._replan_after_change(
                        f"环境变化：敌人{e.name}移动到({e.x},{e.y})")
        elif etype == "random":
            self.apply_event(self.rng.choice(["obstacle", "enemy_move"]),
                             x=self.rng.randrange(st.width),
                             y=self.rng.randrange(st.height))
        return self.to_dict()

    def _replan_after_change(self, trigger):
        """重规划：计划仍有效则保持（行为连贯），否则生成新计划。"""
        st = self.state
        st.add_log("replan", f"触发重评估——{trigger}")
        for u in st.units.values():
            if not (u.alive and u.side == "player"):
                continue
            plan = self.active.get(u.uid)
            if not plan:
                continue
            ok, why = plan_valid(st, u, plan)
            if ok:
                st.add_log("replan", f"{u.name} 原计划仍然有效，继续执行"
                                     f"[{plan.summary()}]")
            else:
                plan.status = "failed"
                plan.fail_reason = why
                cands = generate_candidates(st, u)
                self.candidates[u.uid] = cands
                if cands:
                    best = cands[0]
                    best.status = "active"
                    self.active[u.uid] = best
                    st.add_log("replan",
                               f"{u.name} 原计划失效（{why}），新计划"
                               f"[{best.summary()}]：{best.reason}")
                else:
                    self.active.pop(u.uid, None)
                    st.add_log("replan", f"{u.name} 原计划失效（{why}），"
                                         f"暂无新计划，原地待命")

    # ---------- 需求 6：手动干预 ----------
    def override_plan(self, uid, pid):
        st = self.state
        u = st.units.get(uid)
        if not u or not u.alive:
            return self.to_dict()
        for p in self.candidates.get(uid, []):
            if p.pid == pid:
                old = self.active.get(uid)
                if old and old.pid != pid:
                    old.status = "candidate"
                p.status = "active"
                self.active[uid] = p
                st.add_log("manual", f"手动干预：{u.name} 改用计划"
                                     f"[{p.summary()}]，立即生效")
                break
        return self.to_dict()

    def cancel_plan(self, uid):
        st = self.state
        u = st.units.get(uid)
        plan = self.active.pop(uid, None)
        if u and plan:
            plan.status = "candidate"
            st.add_log("manual", f"手动干预：取消 {u.name} 的当前计划，原地待命")
        return self.to_dict()

    # ---------- 序列化 ----------
    def to_dict(self):
        d = self.state.to_dict()
        d["candidates"] = {uid: [p.to_dict() for p in ps]
                           for uid, ps in self.candidates.items()}
        d["active"] = {uid: p.pid for uid, p in self.active.items()}
        return d

