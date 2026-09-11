"""引擎实现：节点注册、脏/待定状态传播、计划生成与 JSON 快照。

状态模型
--------

每个节点保存两个指纹和一个显式的待定标记：

``fingerprint`` (当前指纹)
    节点内容的当前指纹，由调用方算好后传入。

``confirmed_fingerprint`` (已确认指纹)
    上一次 :meth:`DependencyGraph.mark_clean` 时确认过的指纹；
    从未确认过为 ``""``。

``pending`` (待定)
    显式维护的粘性标记：上游指纹变化时，传播算法把所有直接/间接依赖者
    加入待定集合；节点只有在自身被 :meth:`mark_clean` 后才离开待定。
    因此 A 确认干净后、B 重新执行并确认之前，B 仍是待定，C 不会进计划。

节点状态：

``dirty``   当前指纹 != 已确认指纹（自身内容变了）
``pending`` 指纹一致，但处于待定集合（上游变化尚未逐级确认）
``clean``   指纹一致且非待定

待定集合用集合运算维护，菱形依赖中同一节点只入集一次，
结果与传播顺序无关。
"""

from __future__ import annotations

import json
import os
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, Iterable, Iterator, List, Optional, Set, Tuple

SNAPSHOT_VERSION = 1

STATUS_CLEAN = "clean"
STATUS_DIRTY = "dirty"
STATUS_PENDING = "pending"
_VALID_STATUSES = (STATUS_CLEAN, STATUS_DIRTY, STATUS_PENDING)


class GraphError(Exception):
    """所有依赖图错误的基类。"""


class ValidationError(GraphError):
    """参数不合法（空 id/指纹、重复依赖、自依赖等）。"""


class DuplicateNodeError(GraphError):
    """重复注册同一 node_id。"""


class NodeNotFoundError(GraphError):
    """引用了不存在的节点。"""


class CyclicDependencyError(GraphError):
    """图中检测到环。

    :ivar cycle: 环上的节点 id 序列，首尾节点相同，例如 ``["a", "b", "c", "a"]``。
    """

    def __init__(self, cycle: List[str]):
        self.cycle: List[str] = list(cycle)
        super().__init__(format_cycle(cycle))


class InvalidSnapshotError(GraphError):
    """快照文件损坏、字段缺失或与引擎语义不一致。"""


@dataclass
class _Node:
    """节点内部表示，不对外暴露。"""

    node_id: str
    fingerprint: str            # 当前指纹
    confirmed_fingerprint: str  # 已确认指纹；从未确认时为 ""
    deps: List[str]             # 正向边：本节点依赖的节点（保留声明顺序）

    @property
    def dirty(self) -> bool:
        """当前指纹与已确认指纹不同即为脏。"""
        return self.fingerprint != self.confirmed_fingerprint


def format_cycle(cycle: Iterable[str]) -> str:
    """把环序列格式化成错误信息。"""
    return "依赖图中检测到环: " + " -> ".join(cycle)


class DependencyGraph:
    """有向无环的依赖图，支持脏标记传播与增量执行计划。

    典型流程::

        g = DependencyGraph()
        g.add_node("a", "fp-a-1", [])
        g.add_node("b", "fp-b-1", ["a"])
        g.add_node("c", "fp-c-1", ["b"])

        g.update_fingerprint("a", "fp-a-2")  # a dirty, b/c pending
        g.get_plan()                         # ["a"]
        g.mark_clean("a")                    # 确认 a 重跑完成
        g.get_plan()                         # ["b"]，c 仍被门控
        g.mark_clean("b")
        g.get_plan()                         # ["c"]
    """

    # ------------------------------------------------------------------ #
    # 构造与基础校验
    # ------------------------------------------------------------------ #

    def __init__(self) -> None:
        self._nodes: Dict[str, _Node] = {}
        self._pending: Set[str] = set()

    @staticmethod
    def _require_non_empty_str(value: object, field: str) -> str:
        if not isinstance(value, str) or value == "":
            raise ValidationError(f"{field}必须是非空字符串")
        return value

    @staticmethod
    def _validate_deps(deps: object) -> List[str]:
        """校验依赖列表形态：字符串列表、无空值、无重复项。存在性另行校验。"""
        if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
            raise ValidationError("deps 必须是 node_id 字符串的列表")
        seen: Set[str] = set()
        result: List[str] = []
        for dep in deps:
            if dep == "":
                raise ValidationError("deps 不能包含空字符串")
            if dep in seen:
                raise ValidationError(f"依赖列表中存在重复项: {dep!r}")
            seen.add(dep)
            result.append(dep)
        return result

    def _check_dependencies_exist(
        self, deps: Iterable[str], self_id: Optional[str] = None
    ) -> None:
        deps = list(deps)
        if self_id is not None and self_id in deps:
            raise ValidationError(f"节点 {self_id!r} 不能依赖自己")
        missing = sorted({d for d in deps if d not in self._nodes})
        if missing:
            raise NodeNotFoundError(f"依赖的节点不存在，缺失的 id: {missing}")

    # ------------------------------------------------------------------ #
    # 注册 / 删除
    # ------------------------------------------------------------------ #

    def add_node(
        self,
        node_id: str,
        fingerprint: str,
        deps: Optional[List[str]] = None,
    ) -> None:
        """注册一个节点。

        新节点从未被确认过，处于 ``dirty`` 状态（已确认指纹为空），
        需要先进入计划执行并 :meth:`mark_clean`。

        :param node_id: 唯一非空节点 id。
        :param fingerprint: 调用方算好的非空指纹。
        :param deps: 依赖的其他节点 id；不能重复、不能自依赖、必须已存在。
        :raises DuplicateNodeError: node_id 已存在。
        :raises ValidationError: 参数非法（含自依赖、重复依赖）。
        :raises NodeNotFoundError: 依赖了不存在的节点，错误信息列出缺失 id。
        :raises CyclicDependencyError: 注册后图成环（正常注册顺序下不可能，
            快照/异常数据场景下兜底，显式找环，不靠递归）。
        """
        self._require_non_empty_str(node_id, "node_id")
        self._require_non_empty_str(fingerprint, "fingerprint")
        if node_id in self._nodes:
            raise DuplicateNodeError(f"节点 {node_id!r} 已存在，不能重复添加")
        clean_deps = self._validate_deps([] if deps is None else deps)
        self._check_dependencies_exist(clean_deps, self_id=node_id)

        self._nodes[node_id] = _Node(
            node_id=node_id,
            fingerprint=fingerprint,
            confirmed_fingerprint="",
            deps=clean_deps,
        )
        # 防御性显式环检查：新节点尚无依赖者，正常不可能引入环，
        # 但不让不变量侥幸成立。
        cycle = self.find_cycle()
        if cycle is not None:  # pragma: no cover - 现有 API 无法触发，纯兜底
            del self._nodes[node_id]
            raise CyclicDependencyError(cycle)

    def remove_node(self, node_id: str) -> bool:
        """删除节点，并把它从所有其他节点的 deps 中摘掉。

        同时清理相关脏/待定状态：删除前先圈定受影响区域（该节点的全部
        反向可达者），删边后以区域外仍然存活的 dirty/pending 节点与剩余
        dirty 节点为源头，在新图上重新传播。只经由被删节点才与脏源连通
        的待定标记被回收（菱形另一分支仍连通则保留）；与本次删除无关的
        粘性待定不受影响。节点自身的 dirty 由指纹决定，不会被删除波及。

        :return: 节点存在并被删除返回 ``True``；节点不存在返回 ``False``，
            调用方可据此区分“删了”和“本来就没有”，绝不静默成功。
        """
        if node_id not in self._nodes:
            return False
        # 先在旧图上圈定受影响区域（唯一会因删边而丢失待定理由的节点集合）。
        region = self._dependents_of({node_id}) | {node_id}
        old_dirty = {nid for nid, node in self._nodes.items() if node.dirty}

        del self._nodes[node_id]
        for node in self._nodes.values():
            if node_id in node.deps:
                node.deps = [d for d in node.deps if d != node_id]

        # 新图上的存活源头：剩余 dirty 节点 + 区域外的粘性待定节点。
        new_dirty = old_dirty - {node_id}
        origins = new_dirty | (self._pending - region)
        reached = origins | self._dependents_of(origins)
        # 删边只会减少路径，reached 不会带入原本 clean 的节点；
        # 区域内未被任何存活源头到达的待定节点随被删边一起回收。
        self._pending = reached - new_dirty
        return True

    # ------------------------------------------------------------------ #
    # 指纹更新与传播
    # ------------------------------------------------------------------ #

    def update_fingerprint(self, node_id: str, fingerprint: str) -> bool:
        """更新节点当前指纹，并沿反向依赖边传播待定状态。

        * 指纹必须非空；节点必须存在。
        * 新指纹与**当前指纹**相同：无操作，不产生任何脏标记。
        * 新指纹与当前不同：节点自身变为 dirty（当且仅当它同时不同于
          已确认指纹），所有直接/间接依赖它的节点进入待定集合。
          集合去重保证菱形依赖只标记一次，集合并集保证结果与传播顺序无关。

        :return: 指纹确实变化返回 ``True``；与当前指纹相同（无操作）返回 ``False``。
        """
        self._require_non_empty_str(fingerprint, "fingerprint")
        node = self._get_node(node_id)
        if fingerprint == node.fingerprint:
            return False
        node.fingerprint = fingerprint
        # 反向 BFS 收集全部依赖者并入待定集合；visited 去重，
        # 菱形依赖中汇合节点只访问一次。
        self._pending |= self._dependents_of({node_id})
        return True

    def mark_clean(self, node_id: str) -> None:
        """确认节点已重新执行完毕：已确认指纹更新为当前指纹，清掉待定标记。

        前提是该节点（传递意义上）依赖的所有节点都已确认干净；否则报错并
        指出哪些依赖还没干净，不允许“先干净”。节点自身 dirty 不是阻碍——
        本方法就是确认重跑结果的动作。

        :raises NodeNotFoundError: 节点不存在。
        :raises GraphError: 尚有 dirty/pending 的上游，异常对象的
            ``blocking`` 属性携带 ``[(id, status), ...]``。
        """
        node = self._get_node(node_id)
        blockers = [
            (ancestor, self.status_of(ancestor))
            for ancestor in self._topo_sorted(self._ancestors(node_id))
            if self.status_of(ancestor) != STATUS_CLEAN
        ]
        if blockers:
            err = GraphError(
                f"节点 {node_id!r} 还有未确认干净的依赖: "
                f"{[f'{nid}({st})' for nid, st in blockers]}"
            )
            err.blocking = blockers  # type: ignore[attr-defined]
            raise err
        node.confirmed_fingerprint = node.fingerprint
        self._pending.discard(node_id)

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #

    def status_of(self, node_id: str) -> str:
        """返回单个节点状态：``clean`` / ``dirty`` / ``pending``。"""
        node = self._get_node(node_id)
        if node.dirty:
            return STATUS_DIRTY
        if node_id in self._pending:
            return STATUS_PENDING
        return STATUS_CLEAN

    def get_status(self) -> Dict[str, str]:
        """返回 ``id -> clean|dirty|pending`` 的全量状态映射（按拓扑序）。"""
        return {nid: self.status_of(nid) for nid in self.topo_sort()}

    def get_plan(self) -> List[str]:
        """返回当前需要重新执行的节点，按拓扑序排列。

        入选条件同时满足：

        1. 节点自身处于 dirty 或 pending；
        2. 它的**直接依赖全部已确认干净**（status == clean）——
           传递性由门控逐级释放保证：A→B→C 中 B 未确认时，C 不会入选。

        计划为空时返回 ``[]``。
        """
        plan: List[str] = []
        for nid in self.topo_sort():
            status = self.status_of(nid)
            if status == STATUS_CLEAN:
                continue
            node = self._nodes[nid]
            if all(self.status_of(d) == STATUS_CLEAN for d in node.deps):
                plan.append(nid)
        return plan

    def get_affected(self, node_id: str) -> List[str]:
        """返回受该节点影响的全部节点（含自身），按拓扑序排列。

        即节点本身 + 沿反向依赖边可达的所有直接/间接依赖者，与脏状态无关。
        """
        self._get_node(node_id)
        affected = self._dependents_of({node_id}) | {node_id}
        return self._topo_sorted(affected)

    def explain_dirty(self, node_id: str) -> List[List[Dict[str, str]]]:
        """解释节点为什么处于 dirty/pending：枚举到“最近根源”的全部路径。

        沿依赖边向上游走（只经过非 clean 节点），路径终止于**根源节点**：
        自身非 clean 且所有依赖都已 clean 的节点——它通常是 dirty 源；
        当 dirty 源已确认、传播余波未逐级确认时，根源也可能是 pending。

        :return: 路径列表，每条路径是 ``[{"node": id, "status": "dirty|pending"}, ...]``，
            从给定节点排到根源；菱形依赖会给出多条路径。
            节点本身为 clean 时返回 ``[]``；自身即根源时返回单节点路径。
        """
        self._get_node(node_id)
        if self.status_of(node_id) == STATUS_CLEAN:
            return []
        sources = self._nonclean_roots(node_id)
        return [
            self._format_path(path)
            for path in self._paths_to_roots(node_id, sources)
        ]

    # ------------------------------------------------------------------ #
    # 拓扑排序与显式环检测（迭代算法，不靠递归深度兜底）
    # ------------------------------------------------------------------ #

    def topo_sort(self) -> List[str]:
        """返回拓扑序（依赖在前，节点在后），同层按注册顺序稳定输出。"""
        order = list(self._nodes.keys())
        indegree = {nid: 0 for nid in order}
        dependents: Dict[str, List[str]] = {nid: [] for nid in order}
        for nid in order:
            for dep in self._nodes[nid].deps:
                indegree[nid] += 1
                dependents[dep].append(nid)
        ready: Deque[str] = deque(nid for nid in order if indegree[nid] == 0)
        result: List[str] = []
        while ready:
            nid = ready.popleft()
            result.append(nid)
            for child in dependents[nid]:
                indegree[child] -= 1
                if indegree[child] == 0:
                    ready.append(child)
        if len(result) != len(self._nodes):
            cycle = self.find_cycle()
            raise CyclicDependencyError(cycle or [])
        return result

    def find_cycle(self) -> Optional[List[str]]:
        """显式查找有向环：迭代式三色 DFS，不使用递归，与栈深度无关。

        :return: 环上节点序列（首尾相同），无环返回 ``None``。
        """
        WHITE, GRAY, BLACK = 0, 1, 2
        color: Dict[str, int] = {nid: WHITE for nid in self._nodes}
        parent: Dict[str, Optional[str]] = {nid: None for nid in self._nodes}

        for root in self._nodes:  # dict 顺序即注册顺序
            if color[root] != WHITE:
                continue
            stack: List[Tuple[str, int]] = [(root, 0)]  # (节点, 下一条边下标)
            color[root] = GRAY
            while stack:
                nid, edge_index = stack[-1]
                deps = self._nodes[nid].deps
                if edge_index < len(deps):
                    nxt = deps[edge_index]
                    stack[-1] = (nid, edge_index + 1)
                    if nxt not in color:  # 快照中可能有缺失依赖，交给存在性校验
                        continue
                    if color[nxt] == GRAY:
                        return self._reconstruct_cycle(nxt, nid, parent)
                    if color[nxt] == WHITE:
                        color[nxt] = GRAY
                        parent[nxt] = nid
                        stack.append((nxt, 0))
                else:
                    color[nid] = BLACK
                    stack.pop()
        return None

    @staticmethod
    def _reconstruct_cycle(
        cycle_start: str, back_edge_from: str, parent: Dict[str, Optional[str]]
    ) -> List[str]:
        """沿 parent 链还原环：cycle_start → … → back_edge_from → cycle_start。"""
        path: List[str] = [back_edge_from]
        cur = back_edge_from
        while cur != cycle_start:
            prev = parent[cur]
            if prev is None:  # 防御性分支，理论不可达
                break
            path.append(prev)
            cur = prev
        path.reverse()
        path.append(cycle_start)
        return path

    # ------------------------------------------------------------------ #
    # 内部集合推导
    # ------------------------------------------------------------------ #

    def _get_node(self, node_id: str) -> _Node:
        if not isinstance(node_id, str) or node_id not in self._nodes:
            raise NodeNotFoundError(f"节点不存在: {node_id!r}")
        return self._nodes[node_id]

    def _reverse_index(self) -> Dict[str, List[str]]:
        """构造反向邻接表：dep -> [直接依赖 dep 的节点]。"""
        reverse: Dict[str, List[str]] = {nid: [] for nid in self._nodes}
        for nid, node in self._nodes.items():
            for dep in node.deps:
                if dep in reverse:
                    reverse[dep].append(nid)
        return reverse

    def _dependents_of(self, starts: Iterable[str]) -> Set[str]:
        """沿反向依赖边 BFS 收集全部依赖者（不含 starts 自身）。

        visited 集合天然完成菱形去重：汇合节点无论从哪条路径到达只入队一次，
        因此传播结果与遍历/传播顺序无关。
        """
        reverse = self._reverse_index()
        starts_set = set(starts)
        visited: Set[str] = set()
        queue: Deque[str] = deque(starts_set)
        while queue:
            cur = queue.popleft()
            for child in reverse.get(cur, []):
                if child not in visited and child not in starts_set:
                    visited.add(child)
                    queue.append(child)
        return visited

    def _ancestors(self, node_id: str) -> Set[str]:
        """沿依赖边收集全部传递祖先，不含自身。"""
        visited: Set[str] = set()
        queue: Deque[str] = deque(self._nodes[node_id].deps)
        while queue:
            cur = queue.popleft()
            if cur in visited or cur not in self._nodes:
                continue
            visited.add(cur)
            queue.extend(self._nodes[cur].deps)
        return visited

    def _topo_sorted(self, subset: Iterable[str]) -> List[str]:
        wanted = set(subset)
        return [nid for nid in self.topo_sort() if nid in wanted]

    def _nonclean_roots(self, start: str) -> Set[str]:
        """从 start 经非 clean 节点可达的“根源节点”集合。

        根源 = 自身非 clean，且依赖中不存在非 clean 节点。
        """
        roots: Set[str] = set()
        queue: Deque[str] = deque([start])
        seen: Set[str] = set()
        while queue:
            cur = queue.popleft()
            if cur in seen:
                continue
            seen.add(cur)
            nonclean_deps = [
                d for d in self._nodes[cur].deps
                if d in self._nodes and self.status_of(d) != STATUS_CLEAN
            ]
            if not nonclean_deps:
                roots.add(cur)
            else:
                queue.extend(nonclean_deps)
        return roots

    def _paths_to_roots(self, start: str, roots: Set[str]) -> List[List[str]]:
        """枚举 start 到任一根源的所有简单路径（DAG 上的 DFS + 回溯）。"""
        paths: List[List[str]] = []

        def dfs(cur: str, trail: List[str], on_path: Set[str]) -> None:
            if cur in roots:
                paths.append(list(trail))
                return
            for dep in self._nodes[cur].deps:
                if dep not in self._nodes or dep in on_path:
                    continue
                if self.status_of(dep) == STATUS_CLEAN:
                    continue  # 只走非 clean 链
                on_path.add(dep)
                trail.append(dep)
                dfs(dep, trail, on_path)
                trail.pop()
                on_path.remove(dep)

        dfs(start, [start], {start})
        paths.sort(key=lambda p: (len(p), p))  # 最近的路径在前，顺序确定
        return paths

    def _format_path(self, path: List[str]) -> List[Dict[str, str]]:
        return [{"node": nid, "status": self.status_of(nid)} for nid in path]

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #

    def to_dict(self) -> dict:
        """导出为可 JSON 序列化的纯数据字典（节点按注册顺序）。"""
        return {
            "version": SNAPSHOT_VERSION,
            "nodes": [
                {
                    "id": node.node_id,
                    "fingerprint": node.fingerprint,
                    "confirmed_fingerprint": node.confirmed_fingerprint,
                    "status": self.status_of(node.node_id),
                    "deps": list(node.deps),
                }
                for node in self._nodes.values()
            ],
        }

    def save(self, path: str) -> None:
        """把图以 JSON 写入文件（先写同目录临时文件再原子替换）。"""
        data = json.dumps(self.to_dict(), ensure_ascii=False, indent=2, sort_keys=True)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(tmp_path, path)

    @classmethod
    def from_dict(cls, data: object) -> "DependencyGraph":
        """从快照字典重建图并做完整一致性校验。

        校验项：根结构、必需字段、字段类型、id/指纹非空、deps 无重复/不自依赖、
        依赖节点存在、无环、脏状态与指纹匹配（dirty ⇔ 两指纹不同）。

        :raises InvalidSnapshotError: 任一校验失败，信息指出具体节点/字段。
        """
        if not isinstance(data, dict):
            raise InvalidSnapshotError("快照根节点必须是 JSON 对象")
        if "nodes" not in data:
            raise InvalidSnapshotError("快照缺少必需字段: nodes")
        raw_nodes = data["nodes"]
        if not isinstance(raw_nodes, list):
            raise InvalidSnapshotError("快照字段 nodes 必须是数组")

        graph = cls()
        staged: List[Tuple[str, str, str, str, List[str]]] = []
        seen_ids: Set[str] = set()

        # 第一遍：逐条做结构校验（不依赖节点存在性）。
        for index, item in enumerate(raw_nodes):
            if not isinstance(item, dict):
                raise InvalidSnapshotError(
                    f"第 {index} 个节点条目必须是对象，实际为: {type(item).__name__}"
                )
            for field in ("id", "fingerprint", "confirmed_fingerprint", "deps"):
                if field not in item:
                    raise InvalidSnapshotError(f"第 {index} 个节点条目缺少字段: {field}")
            nid = item["id"]
            if not isinstance(nid, str) or nid == "":
                raise InvalidSnapshotError(f"第 {index} 个节点的 id 必须是非空字符串")
            if nid in seen_ids:
                raise InvalidSnapshotError(f"快照中节点 id 重复: {nid!r}")
            seen_ids.add(nid)

            fp = item["fingerprint"]
            if not isinstance(fp, str) or fp == "":
                raise InvalidSnapshotError(f"节点 {nid!r} 的 fingerprint 必须是非空字符串")
            confirmed = item["confirmed_fingerprint"]
            if not isinstance(confirmed, str):
                raise InvalidSnapshotError(
                    f"节点 {nid!r} 的 confirmed_fingerprint 必须是字符串"
                )
            raw_deps = item["deps"]
            if not isinstance(raw_deps, list) or not all(isinstance(d, str) for d in raw_deps):
                raise InvalidSnapshotError(f"节点 {nid!r} 的 deps 必须是字符串数组")
            if len(set(raw_deps)) != len(raw_deps):
                dupes = sorted({d for d in raw_deps if raw_deps.count(d) > 1})
                raise InvalidSnapshotError(f"节点 {nid!r} 的 deps 存在重复项: {dupes}")
            if nid in raw_deps:
                raise InvalidSnapshotError(f"节点 {nid!r} 不能依赖自己")

            status = item.get("status", _infer_status(fp, confirmed))
            if status not in _VALID_STATUSES:
                raise InvalidSnapshotError(
                    f"节点 {nid!r} 的 status 非法: {status!r}，"
                    f"应为 {list(_VALID_STATUSES)} 之一"
                )
            _check_status_matches_fingerprints(nid, status, fp, confirmed)
            staged.append((nid, fp, confirmed, status, list(raw_deps)))

        # 第二遍：依赖存在性校验（给出明确缺失 id）。
        for nid, _, _, _, deps in staged:
            missing = sorted({d for d in deps if d not in seen_ids})
            if missing:
                raise InvalidSnapshotError(
                    f"节点 {nid!r} 依赖的节点不存在，缺失的 id: {missing}"
                )

        # 第三遍：按就绪轮询装入，允许快照节点以任意顺序存储。
        remaining = {nid: (fp, confirmed, status, deps) for
                     nid, fp, confirmed, status, deps in staged}
        loaded: Set[str] = set()
        while remaining:
            ready_ids = [
                nid for nid in remaining
                if all(d in loaded for d in remaining[nid][3])
            ]
            if not ready_ids:
                # 依赖都在集合内却无法就绪 → 存在环；具体环序列交给 find_cycle。
                for nid, (fp, confirmed, _status, deps) in remaining.items():
                    graph._nodes[nid] = _Node(nid, fp, confirmed, list(deps))
                cycle = graph.find_cycle()
                raise InvalidSnapshotError(format_cycle(cycle or []))
            for nid in ready_ids:
                fp, confirmed, status, deps = remaining.pop(nid)
                graph._nodes[nid] = _Node(nid, fp, confirmed, list(deps))
                if status == STATUS_PENDING:
                    graph._pending.add(nid)
                loaded.add(nid)

        cycle = graph.find_cycle()
        if cycle is not None:  # 双保险
            raise InvalidSnapshotError(format_cycle(cycle))
        return graph

    @classmethod
    def load(cls, path: str) -> "DependencyGraph":
        """从 JSON 文件加载图并校验一致性。

        :raises InvalidSnapshotError: 文件不存在、无法解析或内容不一致，
            错误信息包含具体原因（JSON 行列号、缺失字段等），不吞异常。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except FileNotFoundError as exc:
            raise InvalidSnapshotError(f"快照文件不存在: {path}") from exc
        except json.JSONDecodeError as exc:
            raise InvalidSnapshotError(
                f"快照文件不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"
            ) from exc
        except OSError as exc:
            raise InvalidSnapshotError(f"无法读取快照文件 {path}: {exc}") from exc
        return cls.from_dict(data)

    # ------------------------------------------------------------------ #
    # 调试辅助
    # ------------------------------------------------------------------ #

    def __len__(self) -> int:
        return len(self._nodes)

    def __contains__(self, node_id: object) -> bool:
        return isinstance(node_id, str) and node_id in self._nodes

    def __iter__(self) -> Iterator[str]:
        return iter(self.topo_sort())

    def __repr__(self) -> str:
        return f"DependencyGraph(nodes={len(self._nodes)}, dirty={sum(1 for n in self._nodes.values() if n.dirty)}, pending={len(self._pending)})"


def _infer_status(fingerprint: str, confirmed: str) -> str:
    """旧快照没有 status 字段时按指纹推导（缺省只可能是 dirty/clean）。"""
    return STATUS_DIRTY if fingerprint != confirmed else STATUS_CLEAN


def _check_status_matches_fingerprints(
    node_id: str, status: str, fingerprint: str, confirmed: str
) -> None:
    """校验落库脏状态与指纹一致：dirty ⇔ 当前指纹 != 已确认指纹。"""
    actually_dirty = fingerprint != confirmed
    if status == STATUS_DIRTY and not actually_dirty:
        raise InvalidSnapshotError(
            f"节点 {node_id!r} 状态标记为 dirty，但当前指纹与已确认指纹相同"
        )
    if status in (STATUS_CLEAN, STATUS_PENDING) and actually_dirty:
        raise InvalidSnapshotError(
            f"节点 {node_id!r} 状态标记为 {status}，但当前指纹与已确认指纹不同"
        )
