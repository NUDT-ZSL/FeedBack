"""候选行动计划生成与评分选择（需求 1、2）。"""
import math

from .models import Action, Plan, T_WALL, COVER_DEFENSE
from .pathfinding import find_path, reachable_tiles, has_los, dist

MOVE_PER_AP = 2          # 每 1 AP 可移动格数
W_AP = 2.0               # AP 消耗权重
W_RISK = 1.0             # 风险权重


def _move_ap(steps):
    return max(1, math.ceil(steps / MOVE_PER_AP)) if steps else 0


def _risk_at(state, pos, unit):
    """该位置受到敌方火力的风险值：能看到该格的敌人数量与伤害潜力。"""
    risk = 0
    for e in state.units.values():
        if not e.alive or e.side == unit.side:
            continue
        atk = e.skill("attack")
        if atk and dist(e.pos, pos) <= atk.rng and has_los(state, e.pos, pos):
            risk += atk.power * 0.5
    cover = COVER_DEFENSE.get(state.tile(*pos), 0)
    return max(0, risk - cover * 0.5)


def _finish(state, unit, plan):
    """统一评分并生成选择理由。"""
    exp = plan.expected
    parts, score = [], 0.0
    if exp.get("damage"):
        score += exp["damage"] * 1.5
        parts.append(f"预期伤害{exp['damage']}")
    if exp.get("kill"):
        score += 40
        parts.append(f"可击杀{exp['kill']}")
    if exp.get("heal"):
        score += exp["heal"] * 1.2
        parts.append(f"治疗{exp['heal']}点")
    if exp.get("obj_progress"):
        score += exp["obj_progress"] * 6
        parts.append(f"向目标点推进{exp['obj_progress']}格")
    if exp.get("on_objective"):
        score += 30
        parts.append("抵达目标点")
    if exp.get("cover"):
        score += exp["cover"] * 0.3
        parts.append(f"掩体+{exp['cover']}")
    if exp.get("overwatch"):
        score += 8
        parts.append("进入警戒")
    risk = exp.get("risk", 0)
    score -= risk * W_RISK
    score -= plan.ap_cost * W_AP
    plan.score = round(score, 1)
    if risk > 0:
        parts.append(f"风险{int(risk)}")
    parts.append(f"耗{plan.ap_cost}AP")
    plan.reason = "，".join(parts) if parts else "待机观察"
    return plan


def generate_candidates(state, unit):
    """为单个角色生成多种候选行动计划（每个计划含动作序列与预期结果）。"""
    plans = []
    atk = unit.skill("attack")
    heal = unit.skill("heal")
    enemies = [u for u in state.units.values() if u.alive and u.side != unit.side]
    allies = [u for u in state.units.values()
              if u.alive and u.side == unit.side and u.uid != unit.uid]
    tiles = reachable_tiles(state, unit.pos, unit.ap * MOVE_PER_AP)

    def try_attack_plans(pos, steps):
        if not atk:
            return
        move_ap = _move_ap(steps)
        if move_ap + atk.ap_cost > unit.ap:
            return
        path = find_path(state, unit.pos, pos) if steps else []
        if path is None:
            return
        for e in enemies:
            if dist(pos, e.pos) <= atk.rng and has_los(state, pos, e.pos):
                dmg = min(atk.power, e.hp)
                acts = []
                if path:
                    acts.append(Action("move", move_ap, path=path,
                                       desc=f"移动{steps}格"))
                acts.append(Action("attack", atk.ap_cost, target=e.uid,
                                   desc=f"攻击{e.name}"))
                p = Plan(unit.uid, acts, {
                    "damage": dmg, "end_pos": list(pos),
                    "kill": e.name if dmg >= e.hp else "",
                    "risk": round(_risk_at(state, pos, unit), 1),
                    "cover": COVER_DEFENSE.get(state.tile(*pos), 0),
                })
                plans.append(_finish(state, unit, p))

    # 1) 原地攻击  2) 移动后攻击（对可达格抽样评估）
    try_attack_plans(unit.pos, 0)
    for pos, steps in tiles.items():
        if steps > 0 and (steps % 2 == 0 or steps == 1):
            try_attack_plans(pos, steps)

    # 3) 治疗受伤友军
    if heal:
        for a in allies:
            if a.hp < a.max_hp and dist(unit.pos, a.pos) <= heal.rng \
                    and heal.ap_cost <= unit.ap:
                amount = min(heal.power, a.max_hp - a.hp)
                p = Plan(unit.uid,
                         [Action("heal", heal.ap_cost, target=a.uid,
                                 desc=f"治疗{a.name}")],
                         {"heal": amount, "end_pos": list(unit.pos),
                          "risk": round(_risk_at(state, unit.pos, unit), 1)})
                plans.append(_finish(state, unit, p))

    # 4) 向目标点推进（取使距离最小的可达格）
    if state.objective:
        best, best_d = None, dist(unit.pos, state.objective)
        for pos, steps in tiles.items():
            d = dist(pos, state.objective)
            ap = _move_ap(steps)
            if ap <= unit.ap and d < best_d:
                path = find_path(state, unit.pos, pos)
                if path is not None:
                    best, best_d = (pos, steps, path, ap), d
        if best:
            pos, steps, path, ap = best
            p = Plan(unit.uid,
                     [Action("move", ap, path=path, desc=f"推进{steps}格")],
                     {"obj_progress": dist(unit.pos, state.objective) - best_d,
                      "end_pos": list(pos),
                      "on_objective": best_d == 0,
                      "risk": round(_risk_at(state, pos, unit), 1),
                      "cover": COVER_DEFENSE.get(state.tile(*pos), 0)})
            plans.append(_finish(state, unit, p))

    # 5) 占据掩体并警戒
    ow_cost = 1
    best, best_cov = None, COVER_DEFENSE.get(state.tile(*unit.pos), 0)
    ow_acts = []
    for pos, steps in tiles.items():
        cov = COVER_DEFENSE.get(state.tile(*pos), 0)
        ap = _move_ap(steps)
        if cov > best_cov and ap + ow_cost <= unit.ap:
            path = find_path(state, unit.pos, pos)
            if path is not None:
                best, best_cov = (pos, steps, path, ap), cov
    if best:
        pos, steps, path, ap = best
        ow_acts.append(Action("move", ap, path=path, desc=f"转移{steps}格"))
    if unit.ap - sum(a.ap_cost for a in ow_acts) >= ow_cost:
        ow_acts.append(Action("overwatch", ow_cost, desc="警戒"))
        end = best[0] if best else unit.pos
        p = Plan(unit.uid, ow_acts,
                 {"overwatch": True, "end_pos": list(end),
                  "cover": COVER_DEFENSE.get(state.tile(*end), 0),
                  "risk": round(_risk_at(state, end, unit), 1)})
        plans.append(_finish(state, unit, p))

    # 6) 重伤撤退：远离敌人
    if unit.hp <= unit.max_hp * 0.35 and enemies:
        cur_safe = min(dist(unit.pos, e.pos) for e in enemies)
        best, best_safe = None, cur_safe
        for pos, steps in tiles.items():
            ap = _move_ap(steps)
            if ap > unit.ap:
                continue
            safe = min(dist(pos, e.pos) for e in enemies)
            if safe > best_safe:
                path = find_path(state, unit.pos, pos)
                if path is not None:
                    best, best_safe = (pos, steps, path, ap), safe
        if best:
            pos, steps, path, ap = best
            p = Plan(unit.uid,
                     [Action("move", ap, path=path, desc=f"撤退{steps}格")],
                     {"end_pos": list(pos), "heal": int(unit.max_hp * 0.2),
                      "risk": round(_risk_at(state, pos, unit), 1)})
            plans.append(_finish(state, unit, p))

    plans.sort(key=lambda p: p.score, reverse=True)
    return plans[:8]


def plan_valid(state, unit, plan):
    """环境变化后校验现有计划是否仍然可行（需求 3 的连贯性判断）。"""
    if plan.ap_cost > unit.ap:
        return False, "AP不足"
    pos = unit.pos
    for a in plan.actions:
        if a.kind == "move":
            for step in a.path:
                if state.tile(*step) == T_WALL:
                    return False, "路径被障碍阻挡"
                occ = state.unit_at(*step)
                if occ and occ.uid != unit.uid:
                    return False, "路径被单位占据"
            pos = a.path[-1] if a.path else pos
        elif a.kind in ("attack", "heal"):
            t = state.units.get(a.target)
            if not t or not t.alive:
                return False, "目标已不存在"
            skill = unit.skill(a.kind)
            if skill and dist(pos, t.pos) > skill.rng:
                return False, "目标已离开射程"
    return True, ""
