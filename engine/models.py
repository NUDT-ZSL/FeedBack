"""数据模型：网格地图、角色、技能、动作与行动计划。"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field

# 地形类型
T_FLOOR = 0       # 平地
T_WALL = 1        # 墙体（阻挡移动与视线）
T_COVER_LOW = 2   # 半掩体（可站立，提供少量防御）
T_COVER_HIGH = 3  # 全掩体（可站立，提供较多防御）

COVER_DEFENSE = {T_COVER_LOW: 15, T_COVER_HIGH: 30}

_plan_ids = itertools.count(1)


@dataclass
class Skill:
    sid: str
    name: str
    kind: str        # attack / heal / overwatch
    ap_cost: int
    rng: int         # 射程（曼哈顿距离）
    power: int       # 伤害或治疗量

    def to_dict(self):
        return self.__dict__.copy()


@dataclass
class Unit:
    uid: str
    name: str
    side: str            # player / enemy
    x: int
    y: int
    hp: int
    max_hp: int
    ap: int
    max_ap: int
    vision: int
    skills: list = field(default_factory=list)
    overwatch: bool = False

    @property
    def alive(self):
        return self.hp > 0

    @property
    def pos(self):
        return (self.x, self.y)

    def skill(self, kind):
        for s in self.skills:
            if s.kind == kind:
                return s
        return None

    def to_dict(self):
        return {
            "uid": self.uid, "name": self.name, "side": self.side,
            "x": self.x, "y": self.y, "hp": self.hp, "max_hp": self.max_hp,
            "ap": self.ap, "max_ap": self.max_ap, "vision": self.vision,
            "overwatch": self.overwatch, "alive": self.alive,
            "skills": [s.to_dict() for s in self.skills],
        }


@dataclass
class Action:
    """计划中的单个动作。kind: move / attack / heal / overwatch / cover"""
    kind: str
    ap_cost: int
    path: list = field(default_factory=list)   # move 专用：[(x,y), ...]
    target: str = ""                            # attack/heal 目标 uid
    desc: str = ""

    def to_dict(self):
        return {"kind": self.kind, "ap_cost": self.ap_cost, "path": self.path,
                "target": self.target, "desc": self.desc}


@dataclass
class Plan:
    unit_id: str
    actions: list
    expected: dict          # 预期结果：damage/heal/kills/end_pos/objective_dist 等
    score: float = 0.0
    reason: str = ""        # 评分与选择理由
    status: str = "candidate"   # candidate / active / failed / completed
    fail_reason: str = ""
    pid: int = 0

    def __post_init__(self):
        if not self.pid:
            self.pid = next(_plan_ids)

    @property
    def ap_cost(self):
        return sum(a.ap_cost for a in self.actions)

    def summary(self):
        return " → ".join(a.desc or a.kind for a in self.actions)

    def to_dict(self):
        return {
            "pid": self.pid, "unit_id": self.unit_id, "score": round(self.score, 1),
            "reason": self.reason, "status": self.status,
            "fail_reason": self.fail_reason, "ap_cost": self.ap_cost,
            "expected": self.expected, "summary": self.summary(),
            "actions": [a.to_dict() for a in self.actions],
        }


class GameState:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.grid = [[T_FLOOR] * width for _ in range(height)]
        self.units = {}          # uid -> Unit
        self.objective = None    # (x, y) 目标点
        self.turn = 1
        self.log = []            # [{turn, kind, text}]
        self.winner = None

    def tile(self, x, y):
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.grid[y][x]
        return T_WALL

    def walkable(self, x, y):
        if self.tile(x, y) == T_WALL:
            return False
        for u in self.units.values():
            if u.alive and u.pos == (x, y):
                return False
        return True

    def unit_at(self, x, y):
        for u in self.units.values():
            if u.alive and u.pos == (x, y):
                return u
        return None

    def add_log(self, kind, text):
        self.log.append({"turn": self.turn, "kind": kind, "text": text})
        if len(self.log) > 300:
            self.log = self.log[-300:]

    def to_dict(self):
        return {
            "width": self.width, "height": self.height, "grid": self.grid,
            "units": [u.to_dict() for u in self.units.values()],
            "objective": self.objective, "turn": self.turn,
            "log": self.log[-80:], "winner": self.winner,
        }

