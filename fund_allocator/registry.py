"""项目注册表与依赖图。

依赖语义：add_dependency(a, b) 表示“a 依赖 b”——b 获得不低于其最低启动额的
拨款后，a 才允许启动。任何时刻图都必须无环、不得引用不存在的项目；
违例抛出 DependencyError 并携带涉及链条。
"""

from __future__ import annotations

import heapq
from typing import Dict, Iterable, List, Mapping, Optional, Set, Tuple

from .errors import DependencyError, ValidationError
from .models import Project


class Registry:
    """项目与前置依赖的注册表。

    内部不变量：
      * _projects 中标识唯一；
      * _prereqs 的每个端点都存在于 _projects；
      * 依赖图始终无环（每次加边即时检测）。
    """

    def __init__(self) -> None:
        self._projects: Dict[str, Project] = {}
        self._prereqs: Dict[str, Set[str]] = {}

    # ---- 项目维护 ----

    def add_project(self, project: Project, *, replace: bool = False) -> None:
        """登记一个项目。标识重复且未指定 replace 时拒绝。"""
        if not isinstance(project, Project):
            raise ValidationError(
                f"add_project 需要 Project 对象，得到 {type(project).__name__}",
                f"projects[{getattr(project, 'project_id', '?')!r}]",
            )
        pid = project.project_id
        if pid in self._projects and not replace:
            raise ValidationError(
                f"项目标识 {pid!r} 重复", f"projects[{pid!r}].id", "id"
            )
        self._projects[pid] = project
        self._prereqs.setdefault(pid, set())

    def remove_project(self, project_id: str) -> None:
        """删除项目；仍被其他项目依赖时拒绝（避免留下悬空引用）。"""
        if project_id not in self._projects:
            raise ValidationError(f"项目 {project_id!r} 不存在", f"projects[{project_id!r}]")
        dependents = self.dependents(project_id)
        if dependents:
            raise DependencyError(
                f"项目 {project_id!r} 仍被 {len(dependents)} 个项目依赖，不能删除"
                f"（请先移除这些依赖或改删依赖方）",
                [dependents[0], project_id],
            )
        del self._projects[project_id]
        del self._prereqs[project_id]
        for pre_set in self._prereqs.values():
            pre_set.discard(project_id)

    def get(self, project_id: str) -> Project:
        if project_id not in self._projects:
            raise ValidationError(f"项目 {project_id!r} 不存在", f"projects[{project_id!r}]")
        return self._projects[project_id]

    def contains(self, project_id: str) -> bool:
        return project_id in self._projects

    def project_ids(self) -> List[str]:
        """全部项目标识，按字典序。"""
        return sorted(self._projects)

    def projects(self) -> Mapping[str, Project]:
        return self._projects

    def __len__(self) -> int:
        return len(self._projects)

    def __contains__(self, project_id: object) -> bool:
        return project_id in self._projects

    # ---- 依赖维护 ----

    def add_dependency(self, project_id: str, prereq_id: str) -> None:
        """声明 project_id 依赖 prereq_id；重复声明视为幂等成功。"""
        if project_id not in self._projects:
            raise DependencyError(
                f"依赖方项目 {project_id!r} 不存在", [project_id, prereq_id]
            )
        if prereq_id not in self._projects:
            raise DependencyError(
                f"被依赖项目 {prereq_id!r} 不存在", [project_id, prereq_id]
            )
        if project_id == prereq_id:
            raise DependencyError("项目不能依赖自身", [project_id, prereq_id])
        if prereq_id in self._prereqs[project_id]:
            return  # 幂等
        # 环检测：若沿已有边能从 prereq_id 到达 project_id，加边即成环。
        path = self._find_path(prereq_id, project_id)
        if path is not None:
            raise DependencyError(
                f"添加依赖 {project_id!r} -> {prereq_id!r} 将形成环",
                [project_id] + path,
            )
        self._prereqs[project_id].add(prereq_id)

    def remove_dependency(self, project_id: str, prereq_id: str) -> None:
        if project_id not in self._prereqs or prereq_id not in self._prereqs[project_id]:
            raise DependencyError(
                f"依赖 {project_id!r} -> {prereq_id!r} 不存在",
                [project_id, prereq_id],
            )
        self._prereqs[project_id].discard(prereq_id)

    def set_prerequisites(self, project_id: str, prereq_ids: Iterable[str]) -> None:
        """整体设置某项目的前置（用于载入）：整体校验通过后才落库。"""
        if project_id not in self._projects:
            raise DependencyError(f"依赖方项目 {project_id!r} 不存在", [project_id])
        wanted = sorted(set(prereq_ids))
        for pre in wanted:
            if pre not in self._projects:
                raise DependencyError(
                    f"被依赖项目 {pre!r} 不存在", [project_id, pre]
                )
            if pre == project_id:
                raise DependencyError("项目不能依赖自身", [project_id, pre])
        # 用“候选新图”做环检测，保证失败时状态不变
        saved = set(self._prereqs[project_id])
        self._prereqs[project_id] = set(wanted)
        cycle = self.find_cycle()
        if cycle is not None:
            self._prereqs[project_id] = saved
            raise DependencyError(
                f"为 {project_id!r} 设置前置将形成环", cycle
            )

    # ---- 依赖查询 ----

    def prerequisites(self, project_id: str) -> Tuple[str, ...]:
        """直接前置，按字典序。"""
        self.get(project_id)
        return tuple(sorted(self._prereqs.get(project_id, ())))

    def dependents(self, project_id: str) -> List[str]:
        """直接依赖该项目的项目（“被哪些项目依赖”），按字典序。"""
        self.get(project_id)
        return sorted(
            pid for pid, pres in self._prereqs.items() if project_id in pres
        )

    def all_dependents(self, project_id: str) -> List[str]:
        """传递依赖该项目的全部项目（下游闭包），按字典序。"""
        return sorted(self.downstream_closure([project_id]))

    def downstream_closure(self, ids: Iterable[str]) -> Set[str]:
        """给定项目集合的全部下游（含传递依赖方），不含入参自身。"""
        seeds = list(ids)
        for x in seeds:
            self.get(x)
        seeds_set = set(seeds)
        result: Set[str] = set()
        frontier = list(seeds)
        while frontier:
            cur = frontier.pop()
            for dep in self.dependents(cur):
                if dep not in result and dep not in seeds_set:
                    result.add(dep)
                    frontier.append(dep)
        return result

    def upstream_closure(self, ids: Iterable[str]) -> Set[str]:
        """给定项目集合的全部上游（含传递前置），不含入参自身。"""
        seeds = list(ids)
        for x in seeds:
            self.get(x)
        result: Set[str] = set()
        seeds_set = set(seeds)
        frontier = list(seeds)
        while frontier:
            cur = frontier.pop()
            for pre in self._prereqs.get(cur, ()):
                if pre not in result and pre not in seeds_set:
                    result.add(pre)
                    frontier.append(pre)
        return result

    # ---- 图算法 ----

    def _find_path(self, src: str, dst: str) -> Optional[List[str]]:
        """沿“依赖边”找 src 到 dst 的字典序最小路径；不可达返回 None。"""
        if src == dst:
            return [src]
        # DFS，邻居按字典序，第一次命中即字典序最小路径之一
        stack: List[Tuple[str, Tuple[str, ...]]] = [(src, (src,))]
        visited = {src}
        while stack:
            node, path = stack.pop()
            for nxt in sorted(self._prereqs.get(node, ()), reverse=True):
                if nxt == dst:
                    return list(path) + [dst]
                if nxt not in visited:
                    visited.add(nxt)
                    stack.append((nxt, path + (nxt,)))
        return None

    def find_cycle(self) -> Optional[List[str]]:
        """若图中有环，返回一条形如 [A, ..., A] 的确定性环链；否则 None。"""
        color: Dict[str, int] = {pid: 0 for pid in sorted(self._projects)}  # 0白1灰2黑
        for root in sorted(self._projects):
            if color[root] != 0:
                continue
            stack: List[Tuple[str, Iterable[str]]] = [(root, iter(sorted(self._prereqs[root])))]
            color[root] = 1
            trail = [root]
            while stack:
                node, it = stack[-1]
                nxt = next(it, None)
                if nxt is None:
                    color[node] = 2
                    stack.pop()
                    trail.pop()
                    continue
                if color.get(nxt, 2) == 1:  # 指向当前灰色路径 -> 环
                    idx = trail.index(nxt)
                    return trail[idx:] + [nxt]
                if color.get(nxt) == 0:
                    color[nxt] = 1
                    stack.append((nxt, iter(sorted(self._prereqs[nxt]))))
                    trail.append(nxt)
        return None

    def topological_order(self) -> List[str]:
        """稳定拓扑序：先按入度（前置数）卡恩，平局取 id 字典序。

        图有环时抛 DependencyError（正常维护流程不会出现）。
        """
        indeg = {pid: len(self._prereqs[pid]) for pid in self._projects}
        ready = [pid for pid, d in indeg.items() if d == 0]
        heapq.heapify(ready)
        order: List[str] = []
        dependents_map: Dict[str, List[str]] = {pid: [] for pid in self._projects}
        for pid, pres in self._prereqs.items():
            for pre in pres:
                dependents_map[pre].append(pid)
        while ready:
            cur = heapq.heappop(ready)
            order.append(cur)
            for dep in dependents_map[cur]:
                indeg[dep] -= 1
                if indeg[dep] == 0:
                    heapq.heappush(ready, dep)
        if len(order) != len(self._projects):
            cycle = self.find_cycle()
            raise DependencyError("依赖图存在环，无法拓扑排序", cycle)
        return order

    # ---- 快照/复制（供求解器与持久化使用） ----

    def snapshot(self) -> Tuple[Dict[str, Project], Dict[str, Tuple[str, ...]]]:
        return (
            dict(self._projects),
            {pid: tuple(sorted(pres)) for pid, pres in self._prereqs.items()},
        )

    def clone(self) -> "Registry":
        other = Registry()
        for pid in sorted(self._projects):
            other.add_project(self._projects[pid])
        for pid in sorted(self._prereqs):
            for pre in sorted(self._prereqs[pid]):
                other.add_dependency(pid, pre)
        return other
