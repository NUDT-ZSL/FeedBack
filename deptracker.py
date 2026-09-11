"""可嵌入的因果依赖追踪内核。

用于配置变更与构建产物的失效判断：

- 上游通过 :meth:`DependencyTracker.add_edge` 注册 “产物—输入” 依赖边（:class:`Edge`）；
- 调用方通过 :meth:`DependencyTracker.report_fingerprint` 报告某个输入的当前指纹，
  内核把直接 / 间接依赖该输入的产物增量地标为失效（菱形依赖去重、与传播顺序无关）；
- 产物本身也可以作为其他产物的输入，失效沿 “产物 → 输入 → 产物” 的链向上游传播；
- :meth:`DependencyTracker.get_rebuild_plan` 返回按拓扑序排列的待重建产物列表；
- :meth:`DependencyTracker.explain_invalid` 给出失效原因链，便于排查；
- :meth:`DependencyTracker.mark_rebuilt` 确认一次重建，使产物恢复干净；
- :meth:`DependencyTracker.save` / :meth:`DependencyTracker.load` 用 JSON 快照持久化全部状态。

只使用 Python 标准库，可离线运行。

失效语义
--------
每个输入有一个 *当前指纹*（调用方算好后传入）和每个消费它的产物各自记录的
*已确认指纹*（该产物上一次被确认重建时、所依据的输入指纹）。

产物 ``A`` 是 **干净** 的，当且仅当对 ``A`` 的每一条依赖边 ``(A, inp)``：

1. ``A`` 对 ``inp`` 的已确认指纹存在且等于 ``inp`` 的当前指纹；并且
2. 若 ``inp`` 本身是产物，则 ``inp`` 也是干净的。

否则 ``A`` 处于 **失效** 状态。失效集合在指纹报告时增量维护（反向 BFS），
在可能“愈合”的事件（指纹改回已确认值、重建确认、加载快照）后做一次全量重算。
"""

from __future__ import annotations

import heapq
import json
from collections import deque
from dataclasses import dataclass
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

__all__ = [
    "Edge",
    "DependencyTracker",
    "DependencyError",
    "CycleError",
    "EdgeLimitError",
    "UnknownArtifactError",
    "SnapshotError",
    "VALID_KINDS",
    "SNAPSHOT_VERSION",
]

#: 合法的输入类型。
VALID_KINDS: Tuple[str, ...] = ("file", "env")

#: 快照文件格式版本。
SNAPSHOT_VERSION: int = 1


# ---------------------------------------------------------------------------
# 异常
# ---------------------------------------------------------------------------


class DependencyError(Exception):
    """内核所有领域错误的基类。"""


class CycleError(DependencyError):
    """注册依赖边时发现环。``cycle`` 为环上的节点序列（首尾相同）。"""

    def __init__(self, cycle: List[str]) -> None:
        self.cycle: List[str] = list(cycle)
        super().__init__("检测到依赖环: " + " -> ".join(self.cycle))


class EdgeLimitError(DependencyError):
    """依赖边数量超过 ``max_edges`` 上限，本次注册被拒绝。"""


class UnknownArtifactError(DependencyError):
    """操作的产物不存在。"""


class SnapshotError(DependencyError):
    """快照文件损坏、字段缺失或一致性校验失败。"""


# ---------------------------------------------------------------------------
# 依赖边
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Edge:
    """一条 “产物—输入” 依赖边。

    :param artifact: 产物标识，非空字符串。
    :param input: 输入标识，非空字符串；可以是另一个产物的标识。
    :param kind: 输入类型，只能是 ``'file'`` 或 ``'env'``。
    :raises ValueError: 字段非法时抛出，错误信息指明具体字段。
    """

    artifact: str
    input: str
    kind: str = "file"

    def __post_init__(self) -> None:
        if not isinstance(self.artifact, str) or not self.artifact:
            raise ValueError(
                f"Edge.artifact 必须是非空字符串, 收到 {self.artifact!r}"
            )
        if not isinstance(self.input, str) or not self.input:
            raise ValueError(f"Edge.input 必须是非空字符串, 收到 {self.input!r}")
        if self.kind not in VALID_KINDS:
            raise ValueError(
                f"Edge.kind 必须是 {VALID_KINDS} 之一, 收到 {self.kind!r}"
            )


# ---------------------------------------------------------------------------
# 追踪内核
# ---------------------------------------------------------------------------


class DependencyTracker:
    """因果依赖追踪内核。

    :param max_edges: 依赖边总数上限。``None`` 表示 *精确模式*（无上限，
        用于小规模对照）；给定整数时，注册新边若会使总数超过上限，
        则拒绝本次注册并抛出 :class:`EdgeLimitError`（不静默丢弃）。
        ``max_edges=0`` 表示禁止注册任何边。
    """

    def __init__(self, max_edges: Optional[int] = None) -> None:
        if max_edges is not None:
            if not isinstance(max_edges, int) or isinstance(max_edges, bool):
                raise ValueError(f"max_edges 必须是 int 或 None, 收到 {max_edges!r}")
            if max_edges < 0:
                raise ValueError(f"max_edges 不能为负数, 收到 {max_edges}")
        self.max_edges: Optional[int] = max_edges

        self._edges: Set[Edge] = set()
        # 普通输入 -> 当前指纹（未报告为 None）
        self._inputs: Dict[str, Optional[str]] = {}
        # 产物 -> 当前指纹（未设置为 None）
        self._artifacts: Dict[str, Optional[str]] = {}
        # 产物 -> {输入: 已确认指纹}
        self._confirmed: Dict[str, Dict[str, str]] = {}
        # 产物 -> 其出边（按注册顺序）
        self._deps: Dict[str, List[Edge]] = {}
        # 节点（输入或产物） -> 直接依赖它的产物集合（反向邻接）
        self._rev: Dict[str, Set[str]] = {}
        # 当前失效的产物集合（对反向可达性封闭）
        self._dirty: Set[str] = set()

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    def _current_fp(self, node: str) -> Optional[str]:
        """节点（输入或产物）的当前指纹；未报告 / 未设置时为 ``None``。"""
        if node in self._artifacts:
            return self._artifacts[node]
        return self._inputs.get(node)

    def _is_input_confirmed(self, artifact: str, node: str) -> bool:
        """``artifact`` 对输入 ``node`` 的已确认指纹是否等于当前指纹。"""
        confirmed = self._confirmed.get(artifact, {})
        return node in confirmed and confirmed[node] == self._current_fp(node)

    def _find_path(self, start: str, target: str) -> Optional[List[str]]:
        """沿 “产物→输入” 边寻找从 ``start`` 到 ``target`` 的路径。

        返回节点序列（含首尾），不存在时返回 ``None``。用于环检测。
        """
        if start == target:
            return [start]
        stack: List[Tuple[str, List[str]]] = [(start, [start])]
        visited: Set[str] = {start}
        while stack:
            node, path = stack.pop()
            for edge in self._deps.get(node, ()):  # 只有产物有出边
                nxt = edge.input
                if nxt == target:
                    return path + [nxt]
                if nxt not in visited:
                    visited.add(nxt)
                    stack.append((nxt, path + [nxt]))
        return None

    def _topo_order(self) -> List[str]:
        """所有产物的拓扑序：任何产物排在其所依赖的产物之后。

        同名并列时按标识字典序，保证输出确定性。图在注册时已保证无环。
        """
        indeg: Dict[str, int] = {a: 0 for a in self._artifacts}
        dependents: Dict[str, List[str]] = {a: [] for a in self._artifacts}
        for artifact, edges in self._deps.items():
            for edge in edges:
                if edge.input in self._artifacts:
                    indeg[artifact] += 1
                    dependents[edge.input].append(artifact)
        heap = [a for a, d in indeg.items() if d == 0]
        heapq.heapify(heap)
        order: List[str] = []
        while heap:
            node = heapq.heappop(heap)
            order.append(node)
            for nxt in dependents[node]:
                indeg[nxt] -= 1
                if indeg[nxt] == 0:
                    heapq.heappush(heap, nxt)
        return order

    def _propagate_invalid(self, node: str) -> List[str]:
        """从 ``node`` 出发沿反向边做 BFS，把可达产物增量标为失效。

        用访问集合去重，菱形依赖下每个产物只标记一次，结果与传播顺序无关。
        返回本次 *新* 标脏的产物列表（排序后）。
        """
        newly: List[str] = []
        queue: Deque[str] = deque([node])
        seen: Set[str] = {node}
        while queue:
            current = queue.popleft()
            for artifact in self._rev.get(current, ()):
                if artifact not in self._dirty:
                    self._dirty.add(artifact)
                    newly.append(artifact)
                if artifact not in seen:
                    seen.add(artifact)
                    queue.append(artifact)
        newly.sort()
        return newly

    def _recompute_dirty(self) -> None:
        """全量重算失效集合。

        失效是单调“变脏”的增量事件（指纹上报）之外，任何可能让产物
        *恢复干净* 的事件（指纹改回已确认值、重建确认、快照加载）之后调用。
        按拓扑序求值，复杂度 O(V + E)。
        """
        dirty: Set[str] = set()
        for artifact in self._topo_order():
            confirmed = self._confirmed.get(artifact, {})
            for edge in self._deps.get(artifact, ()):
                inp = edge.input
                unconfirmed = (
                    inp not in confirmed
                    or confirmed[inp] != self._current_fp(inp)
                )
                if unconfirmed or inp in dirty:
                    dirty.add(artifact)
                    break
        self._dirty = dirty

    def _refresh_after_fingerprint(self, node: str) -> List[str]:
        """节点指纹更新后刷新失效集合。

        若有消费者对该节点的已确认指纹恰好等于新指纹，说明可能“愈合”，
        做一次全量重算；否则只是单向变脏，走增量传播。
        """
        may_heal = any(
            self._confirmed.get(a, {}).get(node) == self._current_fp(node)
            for a in self._rev.get(node, ())
        )
        if may_heal:
            before = set(self._dirty)
            self._recompute_dirty()
            return sorted(self._dirty - before)
        return self._propagate_invalid(node)

    # ------------------------------------------------------------------
    # 依赖注册
    # ------------------------------------------------------------------

    def add_edge(self, artifact: str, input: str, kind: str = "file") -> bool:
        """注册一条依赖边。

        :returns: 新注册返回 ``True``；同一条边重复注册是幂等空操作，返回 ``False``。
        :raises ValueError: 字段非法（空标识、非法 kind）。
        :raises EdgeLimitError: 已达 ``max_edges`` 上限，本次注册被拒绝。
        :raises CycleError: 该边会构成环，错误信息包含环上的节点序列。
        """
        edge = Edge(artifact=artifact, input=input, kind=kind)
        if edge in self._edges:
            return False
        if self.max_edges is not None and len(self._edges) >= self.max_edges:
            raise EdgeLimitError(
                f"依赖边数量已达上限 max_edges={self.max_edges}, "
                f"拒绝注册边 {artifact!r} -> {input!r}"
            )
        # 环检测：若从 input 已可达 artifact，则新边 artifact->input 构成环。
        if input == artifact:
            raise CycleError([artifact, input])
        path = self._find_path(input, artifact)
        if path is not None:
            raise CycleError([artifact] + path)

        self._edges.add(edge)
        # 同名节点一旦成为产物，其指纹来源切换为产物指纹。
        self._inputs.pop(artifact, None)
        self._artifacts.setdefault(artifact, None)
        self._confirmed.setdefault(artifact, {})
        if input not in self._artifacts:
            self._inputs.setdefault(input, None)
        self._deps.setdefault(artifact, []).append(edge)
        self._rev.setdefault(input, set()).add(artifact)
        # 新边意味着该输入尚未被此产物确认 -> 产物失效并向上游传播。
        self._dirty.add(artifact)
        self._propagate_invalid(artifact)
        return True

    def remove_artifact(self, artifact: str) -> int:
        """删除一个产物：移除它的全部出边、指纹与确认状态。

        其他产物指向它的边保留，该标识退化为一个未报告指纹的普通输入
        （因此依赖它的产物会变为失效）。

        :returns: 被移除的依赖边数量。
        :raises UnknownArtifactError: 产物不存在。
        """
        if artifact not in self._artifacts:
            raise UnknownArtifactError(f"产物不存在, 无法删除: {artifact!r}")
        removed = 0
        for edge in self._deps.get(artifact, ()):
            self._edges.discard(edge)
            holders = self._rev.get(edge.input)
            if holders is not None:
                holders.discard(artifact)
                if not holders:
                    del self._rev[edge.input]
            removed += 1
        self._deps.pop(artifact, None)
        self._confirmed.pop(artifact, None)
        self._artifacts.pop(artifact, None)
        self._dirty.discard(artifact)
        self._recompute_dirty()
        return removed

    # ------------------------------------------------------------------
    # 指纹上报与重建确认
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_fingerprint(who: str, fingerprint: str) -> None:
        if not isinstance(fingerprint, str) or not fingerprint:
            raise ValueError(f"{who} 的指纹必须是非空字符串, 收到 {fingerprint!r}")

    def report_fingerprint(self, input: str, fingerprint: str) -> List[str]:
        """报告一个输入的当前指纹。

        若与之前报告的当前指纹相同，则不产生任何失效标记（返回空列表）。
        否则把所有直接或间接依赖该输入的产物标为失效。

        :returns: 本次新标脏的产物列表（排序、去重）。
        :raises ValueError: 指纹为空，或该标识是产物（应改用
            :meth:`set_artifact_fingerprint`）。
        """
        if not isinstance(input, str) or not input:
            raise ValueError(f"input 必须是非空字符串, 收到 {input!r}")
        self._validate_fingerprint(f"输入 {input!r}", fingerprint)
        if input in self._artifacts:
            raise ValueError(
                f"{input!r} 是产物, 请使用 set_artifact_fingerprint 更新其指纹"
            )
        if self._inputs.get(input) == fingerprint:
            return []  # 指纹没变，不产生失效标记
        self._inputs[input] = fingerprint
        return self._refresh_after_fingerprint(input)

    def set_artifact_fingerprint(self, artifact: str, fingerprint: str) -> List[str]:
        """设置产物的当前指纹（通常在重建后由调用方更新）。

        产物指纹变化会使依赖它的下游产物失效（它们确认的是旧指纹）。

        :returns: 本次新标脏的产物列表（排序、去重）。
        :raises ValueError: 指纹为空。
        """
        if not isinstance(artifact, str) or not artifact:
            raise ValueError(f"artifact 必须是非空字符串, 收到 {artifact!r}")
        self._validate_fingerprint(f"产物 {artifact!r}", fingerprint)
        if artifact in self._inputs:
            # 该标识此前被当作普通输入报告过，提升为产物。
            del self._inputs[artifact]
        if self._artifacts.get(artifact) == fingerprint:
            return []
        self._artifacts[artifact] = fingerprint
        self._confirmed.setdefault(artifact, {})
        return self._refresh_after_fingerprint(artifact)

    def mark_rebuilt(self, artifact: str) -> None:
        """把产物标记为已重建：以其输入的当前指纹作为已确认指纹。

        重建成功后产物恢复干净，并可能让下游产物进入可重建计划。

        :raises UnknownArtifactError: 产物不存在。
        :raises DependencyError: 未设置产物指纹、存在未报告指纹的输入，
            或某个产物依赖仍处于失效状态（此时重建没有意义）。
        """
        if artifact not in self._artifacts:
            raise UnknownArtifactError(f"产物不存在, 无法标记重建: {artifact!r}")
        if not self._artifacts[artifact]:
            raise DependencyError(
                f"产物 {artifact!r} 尚未设置指纹, "
                f"请先调用 set_artifact_fingerprint"
            )
        edges = self._deps.get(artifact, [])
        for edge in edges:
            if edge.input in self._dirty:
                raise DependencyError(
                    f"产物 {artifact!r} 依赖的产物 {edge.input!r} 仍处于失效状态, "
                    f"请先重建 {edge.input!r}"
                )
            if self._current_fp(edge.input) is None:
                raise DependencyError(
                    f"产物 {artifact!r} 的输入 {edge.input!r} 尚未报告指纹, "
                    f"无法确认重建"
                )
        self._confirmed[artifact] = {
            edge.input: self._current_fp(edge.input)  # type: ignore[misc]
            for edge in edges
        }
        self._recompute_dirty()

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def is_dirty(self, artifact: str) -> bool:
        """产物当前是否处于失效状态。"""
        return artifact in self._dirty

    def get_rebuild_plan(self) -> List[str]:
        """返回当前需要重建的产物列表（拓扑序）。

        只包含 *所有产物依赖都已确认干净、自身处于失效状态* 的产物；
        任何产物都排在它所依赖的产物之后。空图或无失效时返回空列表。
        """
        order = self._topo_order()
        return [
            a
            for a in order
            if a in self._dirty
            and all(e.input not in self._dirty for e in self._deps.get(a, ()))
        ]

    def explain_invalid(self, artifact: str) -> Dict[str, Any]:
        """解释产物为何失效。

        返回字典：

        - ``artifact`` / ``invalid``：目标产物与是否失效；
        - ``chain``：从该产物到 *最近失效输入* 的路径（BFS 最短，
          并列时按标识字典序），每个元素含 ``node``、``node_type``
          （``'artifact'`` / ``'input'``）、``edge_kind``（指入边的类型，
          首节点为 ``None``）、``current_fingerprint``、
          ``confirmed_fingerprint`` 与 ``status``；
        - ``root_cause`` / ``message``：根因节点与一句话说明。

        产物干净时 ``invalid`` 为 ``False``，``chain`` 为空。

        :raises UnknownArtifactError: 产物不存在。
        """
        if artifact not in self._artifacts:
            raise UnknownArtifactError(f"产物不存在, 无法解释: {artifact!r}")
        if artifact not in self._dirty:
            return {
                "artifact": artifact,
                "invalid": False,
                "chain": [],
                "root_cause": None,
                "message": f"产物 {artifact!r} 处于干净状态",
            }

        queue: Deque[Tuple[str, List[Dict[str, Any]]]] = deque(
            [(artifact, [self._node_info(artifact, None, None)])]
        )
        visited: Set[str] = {artifact}
        while queue:
            node, path = queue.popleft()
            confirmed = self._confirmed.get(node, {})
            for edge in sorted(self._deps.get(node, ()), key=lambda e: e.input):
                inp = edge.input
                mismatch = (
                    inp not in confirmed
                    or confirmed[inp] != self._current_fp(inp)
                )
                if inp in self._artifacts and inp in self._dirty:
                    # 根因在更下游，沿链继续找。
                    if inp not in visited:
                        visited.add(inp)
                        queue.append(
                            (inp, path + [self._node_info(inp, edge, node)])
                        )
                elif mismatch:
                    chain = path + [self._node_info(inp, edge, node)]
                    root = chain[-1]
                    return {
                        "artifact": artifact,
                        "invalid": True,
                        "chain": chain,
                        "root_cause": inp,
                        "message": (
                            f"产物 {artifact!r} 失效, 根因是输入 {inp!r}: "
                            f"{root['status']}"
                        ),
                    }
        # 按失效定义不会走到这里；防御性返回。
        return {
            "artifact": artifact,
            "invalid": True,
            "chain": [],
            "root_cause": None,
            "message": f"产物 {artifact!r} 失效, 但未定位到具体输入",
        }

    def _node_info(
        self, node: str, edge: Optional[Edge], parent: Optional[str]
    ) -> Dict[str, Any]:
        """构造解释链上单个节点的信息。"""
        is_artifact = node in self._artifacts
        current = self._current_fp(node)
        confirmed = (
            self._confirmed.get(parent, {}).get(node) if parent is not None else None
        )
        info: Dict[str, Any] = {
            "node": node,
            "node_type": "artifact" if is_artifact else "input",
            "edge_kind": edge.kind if edge is not None else None,
            "current_fingerprint": current,
            "confirmed_fingerprint": confirmed,
        }
        if is_artifact:
            info["status"] = "dirty" if node in self._dirty else "clean"
        elif current is None:
            info["status"] = "unreported"
        elif confirmed is None:
            info["status"] = "unconfirmed"
        elif confirmed != current:
            info["status"] = "changed"
        else:
            info["status"] = "confirmed"
        return info

    def stats(self) -> Dict[str, Any]:
        """返回内核规模与状态的统计信息。"""
        return {
            "artifacts": len(self._artifacts),
            "inputs": len(self._inputs),
            "edges": len(self._edges),
            "dirty_artifacts": len(self._dirty),
            "clean_artifacts": len(self._artifacts) - len(self._dirty),
            "max_edges": self.max_edges,
            "edge_capacity_remaining": (
                None if self.max_edges is None else self.max_edges - len(self._edges)
            ),
        }

    # ------------------------------------------------------------------
    # 持久化
    # ------------------------------------------------------------------

    def dump(self) -> Dict[str, Any]:
        """导出完整状态为可 JSON 序列化的字典（快照格式）。"""
        referenced_inputs: Set[str] = set(self._inputs)
        for edges in self._deps.values():
            for edge in edges:
                if edge.input not in self._artifacts:
                    referenced_inputs.add(edge.input)
        return {
            "version": SNAPSHOT_VERSION,
            "max_edges": self.max_edges,
            "edges": [
                {"artifact": e.artifact, "input": e.input, "kind": e.kind}
                for e in sorted(self._edges, key=lambda e: (e.artifact, e.input))
            ],
            "inputs": {
                name: {"fingerprint": self._inputs.get(name)}
                for name in sorted(referenced_inputs)
            },
            "artifacts": {
                name: {
                    "fingerprint": self._artifacts[name],
                    "confirmed": dict(sorted(self._confirmed.get(name, {}).items())),
                }
                for name in sorted(self._artifacts)
            },
        }

    def save(self, path: str) -> None:
        """把依赖边、输入指纹、产物指纹与确认状态写入 JSON 快照文件。"""
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(self.dump(), fh, ensure_ascii=False, indent=2)
                fh.write("\n")
        except OSError as exc:
            raise SnapshotError(f"无法写入快照文件 {path!r}: {exc}") from exc

    @classmethod
    def load(cls, path: str) -> "DependencyTracker":
        """从 JSON 快照文件重建状态，并做完整一致性校验。

        校验内容：格式版本、依赖边引用的产物和输入都已声明、无环、
        指纹非空（或为 ``null`` 表示未报告）、确认状态引用真实存在的依赖边、
        边数不超过快照声明的 ``max_edges``。

        :raises SnapshotError: 文件不可读、不是合法 JSON、字段缺失或非法。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.read()
        except OSError as exc:
            raise SnapshotError(f"无法读取快照文件 {path!r}: {exc}") from exc
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"快照文件 {path!r} 不是合法 JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise SnapshotError(f"快照文件 {path!r} 的顶层结构必须是 JSON 对象")
        cls._validate_snapshot(data, path)
        return cls._from_snapshot(data)

    # ------------------------------------------------------------------
    # 快照校验与重建（内部）
    # ------------------------------------------------------------------

    @staticmethod
    def _require(cond: bool, message: str) -> None:
        if not cond:
            raise SnapshotError(message)

    @classmethod
    def _validate_snapshot(cls, data: Dict[str, Any], path: str) -> None:
        """对快照字典做结构 / 引用 / 取值校验，失败抛 :class:`SnapshotError`。"""
        req = cls._require
        req(
            data.get("version") == SNAPSHOT_VERSION,
            f"快照 {path!r} 的 version 必须是 {SNAPSHOT_VERSION}, "
            f"收到 {data.get('version')!r}",
        )
        max_edges = data.get("max_edges")
        req(
            max_edges is None
            or (isinstance(max_edges, int) and not isinstance(max_edges, bool)
                and max_edges >= 0),
            f"快照 {path!r} 的 max_edges 必须是非负整数或 null, 收到 {max_edges!r}",
        )
        for key in ("edges", "inputs", "artifacts"):
            req(key in data, f"快照 {path!r} 缺少必需字段 {key!r}")
        req(isinstance(data["edges"], list), f"快照 {path!r} 的 edges 必须是数组")
        req(isinstance(data["inputs"], dict), f"快照 {path!r} 的 inputs 必须是对象")
        req(
            isinstance(data["artifacts"], dict),
            f"快照 {path!r} 的 artifacts 必须是对象",
        )

        inputs, artifacts = data["inputs"], data["artifacts"]
        req(
            not (set(inputs) & set(artifacts)),
            f"快照 {path!r} 中 inputs 与 artifacts 存在同名节点: "
            f"{sorted(set(inputs) & set(artifacts))}",
        )

        def check_fp(value: Any, where: str) -> None:
            req(
                value is None or (isinstance(value, str) and value != ""),
                f"快照 {path!r} 中 {where} 的指纹必须是非空字符串或 null, "
                f"收到 {value!r}",
            )

        for name, state in inputs.items():
            req(
                isinstance(name, str) and name,
                f"快照 {path!r} 的 inputs 含有非法标识 {name!r}",
            )
            req(
                isinstance(state, dict) and "fingerprint" in state,
                f"快照 {path!r} 的输入 {name!r} 缺少 fingerprint 字段",
            )
            check_fp(state["fingerprint"], f"输入 {name!r}")

        for name, state in artifacts.items():
            req(
                isinstance(name, str) and name,
                f"快照 {path!r} 的 artifacts 含有非法标识 {name!r}",
            )
            req(
                isinstance(state, dict) and "fingerprint" in state,
                f"快照 {path!r} 的产物 {name!r} 缺少 fingerprint 字段",
            )
            check_fp(state["fingerprint"], f"产物 {name!r}")
            req(
                "confirmed" in state and isinstance(state["confirmed"], dict),
                f"快照 {path!r} 的产物 {name!r} 缺少 confirmed 字段或类型非法",
            )
            for inp, fp in state["confirmed"].items():
                req(
                    isinstance(inp, str) and inp,
                    f"快照 {path!r} 的产物 {name!r} 的 confirmed 含有非法输入标识",
                )
                check_fp(fp, f"产物 {name!r} 对输入 {inp!r} 的确认指纹")

        edge_inputs_of: Dict[str, Set[str]] = {}
        for i, edge in enumerate(data["edges"]):
            where = f"edges[{i}]"
            req(
                isinstance(edge, dict),
                f"快照 {path!r} 的 {where} 必须是对象, 收到 {edge!r}",
            )
            for field in ("artifact", "input", "kind"):
                req(
                    field in edge,
                    f"快照 {path!r} 的 {where} 缺少字段 {field!r}",
                )
            req(
                edge["artifact"] in artifacts,
                f"快照 {path!r} 的 {where} 引用了未声明的产物 "
                f"{edge['artifact']!r}",
            )
            req(
                edge["input"] in artifacts or edge["input"] in inputs,
                f"快照 {path!r} 的 {where} 引用了未声明的输入 {edge['input']!r}",
            )
            req(
                edge["kind"] in VALID_KINDS,
                f"快照 {path!r} 的 {where} 的 kind 非法: {edge['kind']!r}",
            )
            edge_inputs_of.setdefault(edge["artifact"], set()).add(edge["input"])

        # 确认状态必须对应真实存在的依赖边。
        for name, state in artifacts.items():
            declared = edge_inputs_of.get(name, set())
            extra = set(state["confirmed"]) - declared
            req(
                not extra,
                f"快照 {path!r} 的产物 {name!r} 的 confirmed 引用了不存在的"
                f"依赖输入: {sorted(extra)}",
            )

    @classmethod
    def _from_snapshot(cls, data: Dict[str, Any]) -> "DependencyTracker":
        """由已校验的快照字典重建追踪器（环 / 边数上限复用注册路径检查）。"""
        tracker = cls(max_edges=data["max_edges"])
        tracker._inputs = {
            name: state["fingerprint"] for name, state in data["inputs"].items()
        }
        tracker._artifacts = {
            name: state["fingerprint"] for name, state in data["artifacts"].items()
        }
        tracker._confirmed = {name: {} for name in tracker._artifacts}
        for edge in data["edges"]:
            try:
                tracker.add_edge(edge["artifact"], edge["input"], edge["kind"])
            except (CycleError, EdgeLimitError, ValueError) as exc:
                raise SnapshotError(f"快照校验失败: {exc}") from exc
        for name, state in data["artifacts"].items():
            tracker._confirmed[name] = dict(state["confirmed"])
        tracker._recompute_dirty()
        return tracker
