"""依赖图引擎核心实现。

本模块只用 Python 标准库，维护一个有向无环图（DAG），并在节点指纹
变化时增量地计算受影响集合与重算计划。

状态模型
--------

每个节点保存两个指纹和一个三态状态：

- ``fingerprint``：节点当前内容的指纹（调用方计算后传入）；
- ``confirmed``：调用方最近一次确认“已按当时内容重算完毕”时的指纹；
- 状态：

  - ``CLEAN``：干净，无需重算；
  - ``DIRTY``：**脏源**，当前指纹与已确认指纹不同，节点自身内容变了；
  - ``PENDING``：**待定**，自身指纹未必变化，但传递依赖中存在脏源。

为什么待定状态要显式存储、并且是“黏性”的
------------------------------------------

考虑链条 ``A -> B -> C``：A 变化时 A=DIRTY、B/C=PENDING。调用方重算 A
并 :meth:`DependencyGraph.mark_clean` 之后，如果待定状态只是“从脏源沿
边现算”，那么 B、C 会瞬间被当作干净 —— 可它们明明还没用新的 A 重算。
因此传播是一次性的、单向的：

- :meth:`DependencyGraph.update_fingerprint` 让节点变 DIRTY，并沿 *反向*
  依赖边做一次 BFS，把可达的 CLEAN 节点全部置为 PENDING；
- :meth:`DependencyGraph.mark_clean` 只把 *这一个* 节点置回 CLEAN，
  下游的 PENDING 保持不变，直到它们各自被重算、被确认。

传播的两条确定性保证：

1. **菱形依赖不重复**：BFS 用 visited 集合去重，一个节点无论能从脏源
   经多少条路径到达，状态只改变一次；
2. **与传播顺序无关**：BFS 遍历沿全部反向边进行（DIRTY/PENDING 节点
   照样穿过，只是状态不再改变），最终结果就是“脏源反向可达闭包”，
   与边的遍历顺序无关。

重算计划 :meth:`DependencyGraph.get_plan` 返回陈旧集合（DIRTY ∪
PENDING）的“就绪前沿”：所有依赖都已 CLEAN 的节点，按拓扑序排列
（依赖在前）。调用方按计划重算、逐个 mark_clean，计划就沿拓扑推进。
"""

from __future__ import annotations

import json
import os
from collections import deque
from heapq import heappop, heappush
from typing import Any, Deque, Dict, Iterable, List, Optional, Set, Tuple


SNAPSHOT_FORMAT_VERSION = 1

# 节点状态常量。直接用字符串而不是 Enum，方便 JSON 快照与 CLI 输出。
CLEAN = "clean"
DIRTY = "dirty"
PENDING = "pending"
_VALID_STATES = frozenset({CLEAN, DIRTY, PENDING})


class DepGraphError(Exception):
    """引擎所有异常的基类。"""


class NodeNotFoundError(DepGraphError):
    """引用了图中不存在的节点。"""


class DuplicateNodeError(DepGraphError):
    """重复添加同一节点 id。"""


class InvalidNodeError(DepGraphError):
    """参数不合法（空 id、空指纹、自依赖、重复依赖、错误类型等）。"""


class CycleError(DepGraphError):
    """添加依赖后图中出现了环。

    :ivar cycle: 环上的节点 id 列表，相邻节点之间有依赖边，
        且 ``cycle[0] == cycle[-1]``；例如 ``["a", "b", "c", "a"]``
        表示 ``a -> b -> c -> a``（前者依赖后者）。
    """

    def __init__(self, cycle: List[str], message: Optional[str] = None) -> None:
        self.cycle: List[str] = list(cycle)
        if message is None:
            message = "依赖图中检测到环: " + " -> ".join(self.cycle)
        super().__init__(message)


class SnapshotError(DepGraphError):
    """快照文件损坏、字段缺失或与图的一致性约束冲突。"""


class _Node:
    """单个节点的内部记录，对外不暴露。"""

    __slots__ = ("node_id", "fingerprint", "confirmed", "state", "deps", "rdeps")

    def __init__(
        self,
        node_id: str,
        fingerprint: str,
        confirmed: str,
        state: str = CLEAN,
    ) -> None:
        self.node_id = node_id
        self.fingerprint = fingerprint
        self.confirmed = confirmed
        self.state = state
        #: 正向边：本节点直接依赖的节点（有序、无重复）。
        self.deps: List[str] = []
        #: 反向邻接表：依赖本节点的节点集合。
        self.rdeps: Set[str] = set()


class DependencyGraph:
    """增量式依赖图。

    典型用法::

        g = DependencyGraph()
        g.add_node("a", "hash-a")
        g.add_node("b", "hash-b", deps=["a"])
        g.mark_clean("a")
        g.mark_clean("b")           # 建立干净基线

        g.update_fingerprint("a", "hash-a2")
        g.get_plan()                # ["a"]：b 还在等 a
        g.mark_clean("a")
        g.get_plan()                # ["b"]：a 已干净，b 就绪
        g.mark_clean("b")
        g.get_plan()                # []
    """

    # ------------------------------------------------------------------ #
    # 基础操作
    # ------------------------------------------------------------------ #

    def __init__(self) -> None:
        self._nodes: Dict[str, _Node] = {}

    def __len__(self) -> int:
        return len(self._nodes)

    def __contains__(self, node_id: object) -> bool:
        return isinstance(node_id, str) and node_id in self._nodes

    def add_node(
        self,
        node_id: str,
        fingerprint: str,
        deps: Optional[Iterable[str]] = None,
    ) -> None:
        """注册一个新节点。

        新节点的当前指纹与已确认指纹相同，状态为 CLEAN —— 调用方通过
        “传入什么指纹就确认什么指纹”来断言节点与现状一致。若需要脏
        基线，先全部注册再调用 :meth:`update_fingerprint`，或从快照加载。

        :param node_id: 非空字符串，节点唯一 id。
        :param fingerprint: 非空字符串，节点内容指纹，由调用方计算。
        :param deps: 直接依赖的节点 id；被依赖节点必须已存在，列表中
            不能有重复项，也不能包含节点自己；加入后图仍须是 DAG。
        :raises DuplicateNodeError: ``node_id`` 已存在。
        :raises InvalidNodeError: id/指纹非法、自依赖或依赖重复。
        :raises NodeNotFoundError: 某个依赖节点不存在。
        :raises CycleError: 这些依赖会使图中出现环（异常带环节点列表）。
        """
        self._validate_id(node_id)
        self._validate_fingerprint(fingerprint)
        if node_id in self._nodes:
            raise DuplicateNodeError(f"节点已存在: {node_id!r}")

        dep_list = self._normalize_deps(deps)

        # 先落节点再连边；连边失败时整体回滚，图不会留下半成品状态。
        node = _Node(node_id, fingerprint, fingerprint, CLEAN)
        self._nodes[node_id] = node
        try:
            self._wire_deps(node, dep_list)
        except BaseException:
            # _wire_deps 失败时已自行摘边；这里兜底删除新节点。
            self._nodes.pop(node_id, None)
            raise

    def remove_node(self, node_id: str) -> None:
        """删除节点，并把它从所有节点的依赖列表中摘掉。

        被其他节点依赖时，相关依赖边整条删除（其余节点不会变成“缺
        依赖”）。脏/待定状态不因删除而自动改变：如果被删节点是某些
        PENDING 节点的唯一脏源，这些节点仍保持 PENDING，需要调用方
        重算后 :meth:`mark_clean` —— 引擎不替调用方判断“这次删除是否
        影响了下游产物”。

        :raises NodeNotFoundError: 节点不存在。
        """
        node = self._require_node(node_id)

        for dep_id in node.deps:
            self._nodes[dep_id].rdeps.discard(node_id)

        for dependent_id in node.rdeps:
            dependent = self._nodes[dependent_id]
            dependent.deps = [d for d in dependent.deps if d != node_id]

        del self._nodes[node_id]

    def update_fingerprint(self, node_id: str, fingerprint: str) -> bool:
        """更新节点的当前指纹，并增量标脏。

        - 新指纹与当前指纹相同：无操作，返回 ``False``，不产生脏标记；
        - 否则更新当前指纹；若它与已确认指纹不同且节点当前是 CLEAN，
          节点成为 DIRTY；PENDING 节点自身指纹也变了时升格为 DIRTY；
        - 随后沿反向依赖边传播：所有传递依赖它的 CLEAN 节点进入
          PENDING（菱形依赖去重，结果与传播顺序无关）。

        :return: 指纹是否确实发生了变化。
        :raises NodeNotFoundError: 节点不存在。
        :raises InvalidNodeError: 指纹不是非空字符串。
        """
        node = self._require_node(node_id)
        self._validate_fingerprint(fingerprint)
        if fingerprint == node.fingerprint:
            return False

        node.fingerprint = fingerprint
        if node.fingerprint != node.confirmed and node.state in (CLEAN, PENDING):
            # CLEAN：自身内容首次变化，成为脏源；
            # PENDING：本来被下游连累待定，现在自身内容也变了，升格为脏源。
            node.state = DIRTY
        # 已是 DIRTY 则保持 DIRTY。即便指纹恰好改回已确认值也不自动
        # 降级 —— 状态只由 mark_clean 解除，规则单一可预测；传播闭包
        # 无法廉价地“部分撤销”，保守地多算一次也不错算。

        self._propagate_from(node_id)
        return True

    def mark_clean(self, node_id: str) -> None:
        """确认节点已按当前内容重算完毕。

        把已确认指纹对齐到当前指纹，并把 *本节点* 置为 CLEAN。下游的
        PENDING 不会被连带解除 —— 它们要等自己被重算、被确认。在依赖
        尚未干净时也允许调用（调用方掌握重算时机），但 :meth:`get_plan`
        不会提前调度这种节点。

        :raises NodeNotFoundError: 节点不存在。
        """
        node = self._require_node(node_id)
        node.confirmed = node.fingerprint
        node.state = CLEAN

    # ------------------------------------------------------------------ #
    # 查询
    # ------------------------------------------------------------------ #

    def get_plan(self) -> List[str]:
        """返回当前需要重新执行的节点，按拓扑序排列。

        入选节点同时满足：

        1. 自身状态为 DIRTY 或 PENDING；
        2. **所有** 直接依赖的状态都是 CLEAN（即调用方已经处理完）。

        因此返回的是陈旧集合的“就绪前沿”：脏节点的依赖还没确认时，
        它不会出现在计划里。顺序保证每个节点排在其全部依赖之后；并列
        时按节点 id 升序，输出确定、与注册/传播顺序无关。

        典型用法循环：``get_plan()`` → 重算并 :meth:`mark_clean` →
        再次 ``get_plan()``，直到返回空列表。

        :return: 节点 id 列表；图全干净时为空列表。
        """
        ready: Set[str] = set()
        for nid, node in self._nodes.items():
            if node.state == CLEAN:
                continue
            if all(self._nodes[d].state == CLEAN for d in node.deps):
                ready.add(nid)
        return self._topo_sort(ready)

    def get_affected(self, node_id: str) -> List[str]:
        """查询“如果节点 ``node_id`` 变化，会影响哪些节点”。

        沿反向依赖边收集所有直接或间接依赖它的节点，**包含它自己**，
        菱形依赖只计一次。这是基于图结构的假设性查询，与该节点当前
        是否真的脏无关。结果按拓扑序排列（依赖在前），并列按 id 升序。

        :raises NodeNotFoundError: 节点不存在。
        """
        self._require_node(node_id)
        affected = self._reverse_reachable({node_id})
        return self._topo_sort(affected)

    def explain_dirty(self, node_id: str) -> List[List[str]]:
        """解释节点为什么脏：枚举它到最近脏源的解释路径。

        每条路径形如 ``[node_id, ..., 脏源]``：相邻节点间有依赖边
        （前者依赖后者），终点是一个 DIRTY 节点，路径上其余节点都不
        是 DIRTY（即最近的脏源，不会穿过一个脏源再继续往下找）。

        - 节点自身是 DIRTY：返回 ``[[node_id]]``；
        - 节点 CLEAN：返回 ``[]``；
        - 节点 PENDING：返回一条或多条路径（多依赖、菱形情况下可能
          有多个脏源或多条到达路径）；
        - 一种特殊中间态：脏源已被 :meth:`mark_clean` 确认、但本节点
          还保持黏性 PENDING（自己尚未重算确认），此时图中已无当前
          脏源可指，返回 ``[]``。该节点仍会出现在 :meth:`get_plan`
          里，确认后即干净 —— ``[]`` 表达的是“没有可指认的脏源”，
          不是“这个节点不需要重算”。

        路径按稳定字典序输出。为避免在稠密图上爆炸，路径枚举为简单
        路径（不重复经过同一节点）；图本身是 DAG。

        :raises NodeNotFoundError: 节点不存在。
        """
        node = self._require_node(node_id)
        if node.state == DIRTY:
            return [[node_id]]
        if node.state == CLEAN:
            return []

        results: List[List[str]] = []

        def dfs(current_id: str, prefix: List[str], on_path: Set[str]) -> None:
            current = self._nodes[current_id]
            if current.state == DIRTY:
                results.append(list(prefix))
                return
            for dep_id in sorted(current.deps):
                if dep_id in on_path:
                    continue
                on_path.add(dep_id)
                prefix.append(dep_id)
                dfs(dep_id, prefix, on_path)
                prefix.pop()
                on_path.discard(dep_id)

        dfs(node_id, [node_id], {node_id})
        return results

    def get_status(self, node_id: str) -> Dict[str, Any]:
        """返回单个节点的状态信息（供 CLI/诊断使用）。

        :return: 包含 ``id``、``fingerprint``、``confirmed_fingerprint``、
            ``state``（``"dirty"`` / ``"pending"`` / ``"clean"``）、
            ``deps`` 的字典。
        :raises NodeNotFoundError: 节点不存在。
        """
        node = self._require_node(node_id)
        return {
            "id": node.node_id,
            "fingerprint": node.fingerprint,
            "confirmed_fingerprint": node.confirmed,
            "state": node.state,
            "deps": list(node.deps),
        }

    def list_nodes(self) -> List[str]:
        """返回全部节点 id，按 id 升序。"""
        return sorted(self._nodes)

    # ------------------------------------------------------------------ #
    # 持久化
    # ------------------------------------------------------------------ #

    def to_dict(self) -> Dict[str, Any]:
        """把完整状态序列化为可 JSON 化的字典（节点按 id 排序）。"""
        nodes = []
        for nid in sorted(self._nodes):
            node = self._nodes[nid]
            nodes.append(
                {
                    "id": node.node_id,
                    "fingerprint": node.fingerprint,
                    "confirmed_fingerprint": node.confirmed,
                    "state": node.state,
                    "deps": list(node.deps),
                }
            )
        return {"format_version": SNAPSHOT_FORMAT_VERSION, "nodes": nodes}

    def save(self, path: str) -> None:
        """把完整状态保存为 UTF-8 JSON 文件（原子写入）。

        先写同目录临时文件再 :func:`os.replace` 替换，避免写到一半进程
        退出留下损坏快照；父目录不存在时自动创建。

        :raises OSError: 文件无法写入。
        """
        data = self.to_dict()
        parent = os.path.dirname(os.path.abspath(path))
        os.makedirs(parent, exist_ok=True)
        tmp_path = os.path.join(
            parent, f".{os.path.basename(path)}.tmp.{os.getpid()}"
        )
        try:
            with open(tmp_path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
                fh.write("\n")
            os.replace(tmp_path, path)
        except BaseException:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            raise

    @classmethod
    def load(cls, path: str) -> "DependencyGraph":
        """从 JSON 快照文件加载并重建图。

        加载时执行与构建时相同的完整校验：JSON 合法性、必需字段与
        类型、id/指纹非空、依赖存在、无重复依赖/自依赖、无环，以及
        脏状态与传播闭包的一致性。任何一项不过都抛 :class:`SnapshotError`，
        错误信息指出具体节点/字段，绝不静默忽略。

        :raises SnapshotError: 文件不存在、损坏或一致性校验失败。
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = json.load(fh)
        except FileNotFoundError as exc:
            raise SnapshotError(f"快照文件不存在: {path!r}") from exc
        except json.JSONDecodeError as exc:
            raise SnapshotError(
                f"快照文件不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"
            ) from exc
        except OSError as exc:
            raise SnapshotError(f"无法读取快照文件 {path!r}: {exc}") from exc

        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: object) -> "DependencyGraph":
        """从快照字典重建图，校验逻辑与 :meth:`load` 相同。

        :raises SnapshotError: 结构或一致性校验失败。
        """
        if not isinstance(raw, dict):
            raise SnapshotError("快照顶层必须是 JSON 对象")
        if "format_version" not in raw:
            raise SnapshotError("快照缺少字段: format_version")
        if raw["format_version"] != SNAPSHOT_FORMAT_VERSION:
            raise SnapshotError(
                f"不支持的快照格式版本: {raw['format_version']!r}，"
                f"当前仅支持版本 {SNAPSHOT_FORMAT_VERSION}"
            )
        if "nodes" not in raw:
            raise SnapshotError("快照缺少字段: nodes")
        records_raw = raw["nodes"]
        if not isinstance(records_raw, list):
            raise SnapshotError("快照字段 nodes 必须是数组")

        # 第一步：逐条解析并做单记录校验。
        records: Dict[str, Tuple[str, str, str, List[str]]] = {}
        derived_state: Set[str] = set()  # 未显式给 state、需派生的节点。
        for index, item in enumerate(records_raw):
            where = f"nodes[{index}]"
            if not isinstance(item, dict):
                raise SnapshotError(f"{where} 必须是对象")

            node_id = _require_str_field(item, "id", where)
            fingerprint = _require_str_field(item, "fingerprint", where)
            confirmed = _require_str_field(
                item, "confirmed_fingerprint", where
            )

            state: str
            if "state" in item:
                state_value = item["state"]
                if not isinstance(state_value, str) or state_value not in _VALID_STATES:
                    raise SnapshotError(
                        f"{where}.state 必须是 clean/dirty/pending 之一"
                    )
                state = state_value
            else:
                # 兼容不带 state 的产物：先按自身指纹粗派生，连边完成后
                # 再按脏源的反向可达闭包修正 pending（见第四步）。
                state = DIRTY if fingerprint != confirmed else CLEAN
                derived_state.add(node_id)

            deps_raw = item.get("deps", [])
            if not isinstance(deps_raw, list) or not all(
                isinstance(d, str) for d in deps_raw
            ):
                raise SnapshotError(f"{where}.deps 必须是字符串数组")
            if any(not d for d in deps_raw):
                raise SnapshotError(f"{where}.deps 中存在空 id")
            if len(set(deps_raw)) != len(deps_raw):
                raise SnapshotError(f"{where}.deps 存在重复依赖")
            if node_id in deps_raw:
                raise SnapshotError(f"{where}: 节点不能依赖自己")

            if node_id in records:
                raise SnapshotError(f"节点 id 重复: {node_id!r}")
            records[node_id] = (fingerprint, confirmed, state, list(deps_raw))

        # 第二步：跨记录校验依赖存在性。
        for node_id, (_, _, _, deps) in records.items():
            for dep in deps:
                if dep not in records:
                    raise SnapshotError(
                        f"节点 {node_id!r} 依赖了不存在的节点 {dep!r}"
                    )

        # 第三步：先建全部节点（无环顺序问题），再逐条连边走环检测。
        graph = cls()
        for nid in sorted(records):
            fp, confirmed, state, _deps = records[nid]
            graph._nodes[nid] = _Node(nid, fp, confirmed, state)

        for nid in sorted(records):
            _fp, _confirmed, _state, deps = records[nid]
            node = graph._nodes[nid]
            try:
                graph._wire_deps(node, deps)
            except CycleError as exc:
                raise SnapshotError(
                    "快照中的依赖关系存在环: " + " -> ".join(exc.cycle)
                ) from exc

        # 第四步：状态一致性校验。对缺 state 字段的记录，先用全部脏源的
        # 反向可达闭包把粗派生的 CLEAN 修正为 pending，再统一校验。
        if derived_state:
            dirty_sources = {
                nid for nid, node in graph._nodes.items() if node.state == DIRTY
            }
            for nid in graph._reverse_reachable(dirty_sources):
                if nid in derived_state and graph._nodes[nid].state == CLEAN:
                    graph._nodes[nid].state = PENDING

        graph._validate_states()
        return graph

    def _validate_states(self) -> None:
        """校验节点状态与指纹、传播闭包一致（供快照加载使用）。

        状态机在实时引擎中的不变量：

        - CLEAN：当前指纹 == 已确认指纹；
        - DIRTY：自身是脏源。指纹通常 != 已确认指纹；但若调用方把指纹
          改回已确认值，引擎保守地保持 DIRTY（只有 mark_clean 能解除），
          因此这里不强制两指纹不等；
        - PENDING：当前指纹 == 已确认指纹（自身内容没变，只是被连累）。

        传播闭包只在一个方向上是硬性不变量：当前脏源反向可达的节点
        绝不可以是 CLEAN。反方向不成立 —— PENDING 是“黏性”的：脏源
        被 mark_clean 之后、下游尚未逐个确认之前，图里可以存在没有
        当前脏源的 PENDING 节点（链式重算的正常中间态）。
        """
        dirty_sources: Set[str] = set()
        for nid, node in self._nodes.items():
            if node.state == CLEAN and node.fingerprint != node.confirmed:
                raise SnapshotError(
                    f"快照状态不一致：节点 {nid!r} 标记为 clean，"
                    "但当前指纹与已确认指纹不同"
                )
            if node.state == PENDING and node.fingerprint != node.confirmed:
                raise SnapshotError(
                    f"快照状态不一致：节点 {nid!r} 标记为 pending，"
                    "但当前指纹与已确认指纹不同（指纹不同时应为 dirty）"
                )
            if node.state == DIRTY:
                dirty_sources.add(nid)

        expected_stale = self._reverse_reachable(dirty_sources)
        for nid in expected_stale:
            if self._nodes[nid].state == CLEAN:
                raise SnapshotError(
                    f"快照状态不一致：节点 {nid!r} 标记为 clean，"
                    "但它传递依赖了脏源，应为 pending"
                )

    # ------------------------------------------------------------------ #
    # 内部：参数校验与连边
    # ------------------------------------------------------------------ #

    @staticmethod
    def _validate_id(node_id: str) -> None:
        if not isinstance(node_id, str) or not node_id:
            raise InvalidNodeError("节点 id 必须是非空字符串")

    @staticmethod
    def _validate_fingerprint(fingerprint: str) -> None:
        if not isinstance(fingerprint, str) or not fingerprint:
            raise InvalidNodeError("指纹必须是非空字符串")

    @staticmethod
    def _normalize_deps(deps: Optional[Iterable[str]]) -> List[str]:
        """把 deps 规范化为有序、去重的列表并做静态校验。"""
        if deps is None:
            return []
        # 字符串本身可迭代，显式挡掉，防止把 "ab" 误当成 ["a", "b"]。
        if isinstance(deps, str):
            raise InvalidNodeError("deps 必须是节点 id 的可迭代对象，不能是字符串")

        result: List[str] = []
        seen: Set[str] = set()
        for dep in deps:
            if not isinstance(dep, str) or not dep:
                raise InvalidNodeError("依赖 id 必须是非空字符串")
            if dep in seen:
                raise InvalidNodeError(f"依赖列表中存在重复项: {dep!r}")
            seen.add(dep)
            result.append(dep)
        return result

    def _wire_deps(self, node: _Node, dep_list: List[str]) -> None:
        """接入 node -> dep 的边，逐条做自依赖/存在性/成环校验。

        任何一条失败都回滚本次已经接入的边（正反向都摘干净）。
        """
        if node.node_id in dep_list:
            raise InvalidNodeError(f"节点不能依赖自己: {node.node_id!r}")

        added: List[str] = []
        for dep_id in dep_list:
            dep = self._nodes.get(dep_id)
            if dep is None:
                self._rollback_wire(node, added)
                raise NodeNotFoundError(
                    f"节点 {node.node_id!r} 依赖了不存在的节点 {dep_id!r}"
                )
            # node 是全新节点（或快照重建中尚未连边的节点），自身还没有
            # 正向出边；若 dep 沿已有边能到达 node，加入 node -> dep 即成环。
            if self._can_reach(dep_id, node.node_id):
                self._rollback_wire(node, added)
                raise CycleError(self._extract_cycle(node.node_id, dep_id))

            node.deps.append(dep_id)
            dep.rdeps.add(node.node_id)
            added.append(dep_id)

    def _rollback_wire(self, node: _Node, added: List[str]) -> None:
        """摘掉本次 _wire_deps 已接入的边（正反向同时清理）。"""
        for dep_id in added:
            node.deps.remove(dep_id)
            dep = self._nodes.get(dep_id)
            if dep is not None:
                dep.rdeps.discard(node.node_id)

    def _can_reach(self, source: str, target: str) -> bool:
        """沿正向依赖边 BFS：source 能否到达 target。"""
        if source == target:
            return True
        seen: Set[str] = {source}
        queue: Deque[str] = deque([source])
        while queue:
            current = self._nodes[queue.popleft()]
            for dep_id in current.deps:
                if dep_id == target:
                    return True
                if dep_id not in seen:
                    seen.add(dep_id)
                    queue.append(dep_id)
        return False

    def _extract_cycle(self, source: str, target: str) -> List[str]:
        """在 ``source -> target`` 会成环时构造环路径。

        已知 target 沿正向边可到达 source。BFS 求一条
        ``target -> ... -> source`` 的路径，再把新边接回头部，得到
        ``[source, ..., target, source]``。
        """
        parent: Dict[str, Optional[str]] = {target: None}
        queue: Deque[str] = deque([target])
        while queue:
            current_id = queue.popleft()
            for dep_id in self._nodes[current_id].deps:
                if dep_id in parent:
                    continue
                parent[dep_id] = current_id
                if dep_id == source:
                    queue.clear()
                    break
                queue.append(dep_id)

        path_back: List[str] = []
        cursor: Optional[str] = source
        while cursor is not None:
            path_back.append(cursor)
            cursor = parent.get(cursor)
        return path_back + [source]

    # ------------------------------------------------------------------ #
    # 内部：传播与拓扑
    # ------------------------------------------------------------------ #

    def _require_node(self, node_id: str) -> _Node:
        node = self._nodes.get(node_id)
        if node is None:
            raise NodeNotFoundError(f"节点不存在: {node_id!r}")
        return node

    def _propagate_from(self, source_id: str) -> None:
        """从 source 沿反向边 BFS：可达的 CLEAN 节点全部置 PENDING。

        遍历不看状态（脏节点也要穿过去继续向上游走），只有“改状态”
        这一步跳过非 CLEAN 节点。visited 去重保证菱形只处理一次，
        闭包语义保证与邻接表的遍历顺序无关。
        """
        seen: Set[str] = {source_id}
        queue: Deque[str] = deque([source_id])
        while queue:
            current = self._nodes[queue.popleft()]
            for dependent_id in current.rdeps:
                if dependent_id in seen:
                    continue
                seen.add(dependent_id)
                dependent = self._nodes[dependent_id]
                if dependent.state == CLEAN:
                    dependent.state = PENDING
                queue.append(dependent_id)

    def _reverse_reachable(self, sources: Set[str]) -> Set[str]:
        """sources 沿反向边可达的全部节点（包含 sources 自身）。"""
        seen: Set[str] = set(sources)
        queue: Deque[str] = deque(sources)
        while queue:
            current = self._nodes[queue.popleft()]
            for dependent_id in current.rdeps:
                if dependent_id not in seen:
                    seen.add(dependent_id)
                    queue.append(dependent_id)
        return seen

    def _topo_sort(self, subset: Set[str]) -> List[str]:
        """对 subset 内节点做 Kahn 拓扑排序（依赖在前），并列按 id 升序。

        只统计 subset 内部的边，subset 不构成依赖闭包时也能正确排序。
        """
        indegree: Dict[str, int] = {nid: 0 for nid in subset}
        forward: Dict[str, List[str]] = {nid: [] for nid in subset}
        for nid in subset:
            for dep_id in self._nodes[nid].deps:
                if dep_id in subset:
                    forward[dep_id].append(nid)
                    indegree[nid] += 1

        heap: List[str] = [nid for nid, deg in indegree.items() if deg == 0]
        heap.sort()
        ordered: List[str] = []
        while heap:
            current = heappop(heap)
            ordered.append(current)
            for nxt in forward[current]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    heappush(heap, nxt)
        return ordered


def _require_str_field(item: Dict[str, Any], field: str, where: str) -> str:
    """从快照记录取一个必须存在且为非空字符串的字段。"""
    if field not in item:
        raise SnapshotError(f"{where} 缺少字段: {field}")
    value = item[field]
    if not isinstance(value, str):
        raise SnapshotError(f"{where}.{field} 必须是字符串")
    if not value:
        raise SnapshotError(f"{where}.{field} 必须是非空字符串")
    return value
