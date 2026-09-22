# -*- coding: utf-8 -*-
"""数据模型与依赖图：清单加载、隐式依赖识别、循环检测、确定性优先级。"""
from __future__ import annotations

import json
from dataclasses import dataclass, field


@dataclass
class Material:
    id: str
    name: str
    version: int = 1


@dataclass
class Machine:
    id: str
    name: str
    type: str = "any"
    windows: list = field(default_factory=list)  # [(start, end)]，模拟秒

    def window_fit(self, now, duration):
        """当前处于某可用时段且剩余时长可容纳整个任务时，返回 True。"""
        for start, end in self.windows:
            if start <= now < end and end - now >= duration:
                return True
        return False


@dataclass
class Task:
    id: str
    name: str
    duration: int
    uses: list = field(default_factory=list)        # 取用的素材 id
    depends_on: list = field(default_factory=list)  # 显式先后依赖（任务 id）
    produces: list = field(default_factory=list)    # 产出的素材 id
    machine_type: str = "any"


def load_manifest(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    materials = {m["id"]: Material(m["id"], m.get("name", m["id"]), m.get("version", 1))
                 for m in data.get("materials", [])}
    machines = {}
    for m in data.get("machines", []):
        machines[m["id"]] = Machine(m["id"], m.get("name", m["id"]), m.get("type", "any"),
                                    [tuple(w) for w in m.get("windows", [[0, 10 ** 9]])])
    tasks = {}
    for t in data.get("tasks", []):
        if "duration" not in t:
            raise ValueError(f"任务 {t.get('id')} 缺少 duration")
        tasks[t["id"]] = Task(t["id"], t.get("name", t["id"]), int(t["duration"]),
                              list(t.get("uses", [])), list(t.get("depends_on", [])),
                              list(t.get("produces", [])), t.get("machine_type", "any"))
    return materials, machines, tasks


def build_dependencies(tasks):
    """合并显式 depends_on 与素材产出-取用隐式依赖，返回 {任务id: set(前置任务id)}。"""
    producer = {}
    for t in tasks.values():
        for mat in t.produces:
            producer[mat] = t.id
    deps = {tid: set(t.depends_on) for tid, t in tasks.items()}
    for tid, t in tasks.items():
        for mat in t.uses:
            p = producer.get(mat)
            if p and p != tid:
                deps[tid].add(p)
    for tid, ds in deps.items():
        for d in ds:
            if d not in tasks:
                raise ValueError(f"任务 {tid} 依赖了不存在的任务 {d}")
            if d == tid:
                raise ValueError(f"任务 {tid} 依赖了自身")
    return deps


def detect_cycle(deps):
    """Kahn 拓扑排序检测循环；有环时抛出 ValueError 并列出环上的任务。"""
    indeg = {k: len(v) for k, v in deps.items()}
    rdeps = {k: set() for k in deps}
    for tid, ds in deps.items():
        for d in ds:
            rdeps[d].add(tid)
    queue = sorted(k for k, v in indeg.items() if v == 0)
    seen = 0
    while queue:
        n = queue.pop(0)
        seen += 1
        for m in sorted(rdeps[n]):
            indeg[m] -= 1
            if indeg[m] == 0:
                queue.append(m)
    if seen != len(deps):
        cyc = sorted(k for k, v in indeg.items() if v > 0)
        raise ValueError("检测到循环依赖，涉及任务: " + ", ".join(cyc))


def downstream_map(deps):
    """{任务id: set(直接后继)}"""
    down = {k: set() for k in deps}
    for tid, ds in deps.items():
        for d in ds:
            down[d].add(tid)
    return down


def transitive_closure(start, down):
    """start 的全部下游任务（不含自身）。"""
    seen, stack = set(), list(down.get(start, ()))
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(down.get(n, ()))
    return seen


def priorities(tasks, deps):
    """确定性调度优先级：关键路径长度降序、任务 id 升序。
    返回 {任务id: 排序键}，键越小越先排。"""
    down = downstream_map(deps)
    memo = {}

    def depth(tid):
        if tid in memo:
            return memo[tid]
        memo[tid] = 0  # 占位（此前已确认无环）
        memo[tid] = 1 + max((depth(n) for n in down.get(tid, ())), default=-1)
        return memo[tid]

    for tid in tasks:
        depth(tid)
    return {tid: (-memo[tid], tid) for tid in tasks}
