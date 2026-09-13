"""文档树核心：节点增删改、跨层拖拽、引用维护、查询与变更历史。

仅依赖标准库。所有改变状态的操作都遵循同一顺序：

1. 完整参数与不变量校验（非法操作**先报错、状态不变**）；
2. 必要时创建基准快照；
3. 执行修改；
4. 追加一条带 ``base_version`` / ``version`` 的可重放变更记录。

顺序约定（见 README）：

- ``children`` 顺序即展示顺序；
- 所有“返回一批节点”的查询按**前序（pre-order）**排列；
- 集合类结果（``refs`` / 悬空引用 / diff 明细）按字典序输出，跨平台稳定。

版本与分段模型：

- 每个分段（segment）= 一个基准快照 + 顺序的变更包装；当前内存状态由
  “当前分段”重放得到，并同时以增量结构（节点 dict + 反向索引）实时维护。
- :meth:`DocumentTree.rollback` 会开启一个**新分段**（起点为回滚目标版本
  的快照）；此后新变更的版本号继续全局单调递增（``max_version + 1``），
  不复用、不覆盖被回滚分支的版本号，因此版本号可能跳号。
- 旧分段原样保留，所以加载后仍可 diff / 回滚到文件里的任何历史版本。
"""

from __future__ import annotations

import copy
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from doctree.exceptions import (
    DanglingReferenceError,
    NodeNotFoundError,
    ValidationError,
    VersionNotFoundError,
)
from doctree.model import MoveResult, Node

#: 删除节点 / 引用目标缺失时的三种策略：
#:
#: - ``cascade``（默认）：级联清理所有悬空 / 入边引用并记录；
#: - ``strict``：出现悬空引用即报错，操作回滚；
#: - ``lenient``：保留悬空引用，解析结果中打 ``dangling`` 标记。
POLICY_CASCADE = "cascade"
POLICY_STRICT = "strict"
POLICY_LENIENT = "lenient"
POLICIES = (POLICY_CASCADE, POLICY_STRICT, POLICY_LENIENT)


class RemoveResult:
    """``remove`` 的结果。

    属性：
        removed_ids: 被删除子树的全部 node_id（前序，含被删节点自身）。
        removed_refs: 被级联清理掉的“子树外 -> 子树内”引用，
            ``[{"owner": node_id, "target": node_id}, ...]``；
            strict 下操作直接报错，lenient 下引用保留，此列表为空。
    """

    def __init__(self, removed_ids: List[str], removed_refs: List[Dict[str, str]]) -> None:
        self.removed_ids = removed_ids
        self.removed_refs = removed_refs

    def to_dict(self) -> Dict[str, Any]:
        """序列化为普通 dict。"""
        return {"removed_ids": list(self.removed_ids), "removed_refs": list(self.removed_refs)}


class DocumentTree:
    """可嵌套文档树。一棵至多一个根（``parent_id is None``），空树没有根。"""

    def __init__(self, ref_policy: str = POLICY_CASCADE) -> None:
        if ref_policy not in POLICIES:
            raise ValidationError(f"unknown ref policy: {ref_policy!r}")
        self._nodes: Dict[str, Node] = {}
        self._root_id: Optional[str] = None
        #: target_id -> 引用它的 owner_id 集合（反向索引，随操作增量维护）。
        self._referrers: Dict[str, Set[str]] = {}
        self._policy: str = ref_policy

        # -- 版本 / 分段历史 ---------------------------------------------
        # 每个分段：{"snapshot": dict, "changes": [wrapper, ...],
        #           "persisted": 已落盘的 changes 条数,
        #           "snapshot_persisted": 快照记录是否已落盘}
        # 懒创建：第一次变更时以“变更前状态”建立第一个分段。
        self._segments: List[Dict[str, Any]] = []
        self._version: int = 0          # 当前内存状态版本
        self._max_version: int = 0      # 历史上分配过的最大版本号（只增不减）
        # 持久化记账（persistence 层维护）。
        self._journal_path: Optional[str] = None
        self._persisted_seq: int = 0

    # ================================================================ 基本属性

    @property
    def version(self) -> int:
        """当前内存状态的版本号。"""
        return self._version

    @property
    def ref_policy(self) -> str:
        """当前悬空引用策略（``cascade`` / ``strict`` / ``lenient``）。"""
        return self._policy

    @property
    def root_id(self) -> Optional[str]:
        """根节点 id；空树为 ``None``。"""
        return self._root_id

    @property
    def journal_path(self) -> Optional[str]:
        """最近一次 save/load 绑定的日志文件路径。"""
        return self._journal_path

    def __len__(self) -> int:
        return len(self._nodes)

    def __contains__(self, node_id: object) -> bool:
        return isinstance(node_id, str) and node_id in self._nodes

    def history(self) -> List[int]:
        """当前文件/会话中可回放的全部版本号（升序、去重；回滚后可能跳号）。"""
        seen: Set[int] = set()
        versions: List[int] = []
        for seg in self._segments:
            base = seg["snapshot"]["version"]
            if base not in seen:
                seen.add(base)
                versions.append(base)
            for w in seg["changes"]:
                if w["version"] not in seen:
                    seen.add(w["version"])
                    versions.append(w["version"])
        versions.sort()
        return versions

    def get_node(self, node_id: str) -> Node:
        """返回节点对象；不存在抛 :class:`NodeNotFoundError`。"""
        node = self._nodes.get(node_id)
        if node is None:
            raise NodeNotFoundError(node_id)
        return node

    # ================================================================ 增

    def add(
        self,
        node_id: str,
        parent_id: Optional[str],
        kind: str,
        content: str = "",
        refs: Optional[Iterable[str]] = None,
    ) -> Node:
        """新增叶子节点并挂到 ``parent_id`` 的 children 末尾。

        - ``parent_id is None`` 表示根节点，仅空树允许；
        - ``refs`` 不得含自身、不得重复；cascade/strict 下目标必须存在，
          lenient 下允许引用尚不存在的节点（自动成为悬空引用）。
        """
        self._check_id(node_id)
        if node_id in self._nodes:
            raise ValidationError(f"duplicate node_id: {node_id!r}")
        if not isinstance(kind, str) or not kind:
            raise ValidationError("kind must be a non-empty string")
        if not isinstance(content, str):
            raise ValidationError("content must be a string")
        if parent_id is not None:
            if not isinstance(parent_id, str) or not parent_id:
                raise ValidationError("parent_id must be a non-empty string or None")
            if parent_id not in self._nodes:
                raise NodeNotFoundError(parent_id)
        elif self._root_id is not None:
            raise ValidationError(f"root already exists: {self._root_id!r}")

        ref_set = self._check_refs_input(refs, owner_id=node_id)

        self._ensure_segment()
        node = Node(node_id=node_id, parent_id=parent_id, kind=kind, content=content)
        self._nodes[node_id] = node
        if parent_id is None:
            self._root_id = node_id
        else:
            self._nodes[parent_id].children.append(node_id)
        for target in sorted(ref_set):
            self._add_ref_raw(node_id, target)

        self._record({"op": "add", "node": node.to_dict()})
        return node

    # ================================================================ 删

    def remove(self, node_id: str) -> RemoveResult:
        """删除节点及其整棵子树，按当前策略处理入边引用。

        - cascade：清理所有“子树外 -> 子树内”的引用并在结果中记录；
        - strict：只要存在入边引用就抛 :class:`DanglingReferenceError`，状态不变；
        - lenient：保留入边引用（成为悬空引用），可由 :meth:`get_dangling_refs` 查出。

        子树内部互指的引用随节点一同消失，不属于外部引用。
        """
        node = self.get_node(node_id)
        subtree_ids = self.get_subtree(node_id)
        subtree_set = set(subtree_ids)
        incoming = self._incoming_edges(subtree_set)

        if self._policy == POLICY_STRICT and incoming:
            raise DanglingReferenceError(
                f"cannot remove {node_id!r}: {len(incoming)} inbound reference(s) "
                "under strict policy",
                dangling=incoming,
            )

        self._ensure_segment()
        removed_refs: List[Dict[str, str]] = []
        if self._policy == POLICY_CASCADE:
            for edge in incoming:  # 已按字典序
                self._remove_ref_raw(edge["owner"], edge["target"])
                removed_refs.append(dict(edge))
                self._record(
                    {"op": "ref_remove", "owner": edge["owner"], "target": edge["target"]}
                )
        self._remove_subtree_raw(subtree_ids)
        change: Dict[str, Any] = {
            "op": "remove",
            "node_id": node_id,
        }
        if self._policy == POLICY_LENIENT:
            # 记录被删子树 id，便于审计与重放时核对悬空来源。
            change["policy"] = POLICY_LENIENT
            change["removed_subtree"] = subtree_ids
        self._record(change)
        return RemoveResult(subtree_ids, removed_refs)

    def _remove_subtree_raw(self, subtree_ids: List[str]) -> None:
        """物理删除子树节点并摘除父子边与反向索引（不记日志）。"""
        subtree_set = set(subtree_ids)
        root_id = subtree_ids[0]
        old_parent = self._nodes[root_id].parent_id
        if old_parent is not None and old_parent in self._nodes:
            children = self._nodes[old_parent].children
            if root_id in children:
                children.remove(root_id)
        if self._root_id == root_id:
            self._root_id = None
        # 被删节点发出的引用：从目标的 owner 集合里摘除。
        for nid in subtree_ids:
            node = self._nodes[nid]
            for target in node.refs:
                self._referrers.get(target, set()).discard(nid)
        # 指向被删节点的入边索引：移除子树内部 owner；若仍有子树外 owner
        # （lenient 保留的悬空引用），保留该 target 键以维持索引一致。
        for nid in subtree_ids:
            owners = self._referrers.get(nid)
            if owners is not None:
                owners.difference_update(subtree_set)
                if not owners:
                    del self._referrers[nid]
            del self._nodes[nid]

    # ================================================================ 跨层拖拽

    def move(
        self,
        node_id: str,
        new_parent_id: str,
        index: Optional[int] = None,
    ) -> MoveResult:
        """把节点（及其整棵子树）拖到 ``new_parent_id`` children 的 ``index`` 处。

        ``index`` 以“先把该节点从旧位置摘下之后”的目标 children 为准，
        合法范围 ``0..len(目标 children)``；``None`` 表示追加到末尾。

        拒绝：目标父节点不存在、index 越界、移到自身、移进自己的子树（成环）。
        成功返回 :class:`MoveResult`。
        """
        node = self.get_node(node_id)
        if not isinstance(new_parent_id, str) or not new_parent_id:
            raise ValidationError("new_parent_id must be a non-empty string")
        new_parent = self._nodes.get(new_parent_id)
        if new_parent is None:
            raise NodeNotFoundError(new_parent_id)

        subtree_ids = self.get_subtree(node_id)
        subtree_set = set(subtree_ids)
        if new_parent_id == node_id or new_parent_id in subtree_set:
            raise ValidationError(
                f"cannot move {node_id!r} into its own subtree (would create a cycle)"
            )

        same_parent = node.parent_id == new_parent_id
        max_index = len(new_parent.children) - (1 if same_parent else 0)
        if index is None:
            index = max_index
        if not isinstance(index, int) or isinstance(index, bool) or not (0 <= index <= max_index):
            raise ValidationError(f"index out of range: {index!r} (allowed 0..{max_index})")

        old_path = self.get_path(node_id)
        old_parent_id = node.parent_id
        old_index = (
            self._nodes[old_parent_id].children.index(node_id)
            if old_parent_id is not None
            else None
        )
        affected = self._boundary_edges(subtree_set)

        self._ensure_segment()
        self._nodes[old_parent_id].children.remove(node_id)
        new_parent.children.insert(index, node_id)
        node.parent_id = new_parent_id

        new_path = self.get_path(node_id)
        self._record(
            {
                "op": "move",
                "node_id": node_id,
                "old_parent_id": old_parent_id,
                "old_index": old_index,
                "new_parent_id": new_parent_id,
                "index": index,
            }
        )
        return MoveResult(
            moved_ids=self.get_subtree(node_id),
            old_path=old_path,
            new_path=new_path,
            affected_refs=affected,
        )

    def _boundary_edges(self, subtree_set: Set[str]) -> List[Dict[str, str]]:
        """跨子树边界的引用边（一端在子树内、另一端在外），稳定排序。"""
        edges: List[Dict[str, str]] = []
        for nid in subtree_set:
            for target in self._nodes[nid].refs:
                if target not in subtree_set:
                    edges.append({"owner": nid, "target": target, "direction": "out"})
            for owner in self._referrers.get(nid, ()):
                if owner not in subtree_set:
                    edges.append({"owner": owner, "target": nid, "direction": "in"})
        edges.sort(key=lambda e: (e["owner"], e["target"], e["direction"]))
        return edges

    def _incoming_edges(self, target_set: Set[str]) -> List[Dict[str, str]]:
        """所有 owner 在集合外、target 在集合内的引用边，按字典序。"""
        edges: List[Dict[str, str]] = []
        for nid in target_set:
            for owner in self._referrers.get(nid, ()):
                if owner not in target_set:
                    edges.append({"owner": owner, "target": nid})
        edges.sort(key=lambda e: (e["owner"], e["target"]))
        return edges

    # ================================================================ 内容与引用

    def update_content(self, node_id: str, content: str) -> Node:
        """替换节点 content；新旧内容相同则不变更、不涨版本号。"""
        node = self.get_node(node_id)
        if not isinstance(content, str):
            raise ValidationError("content must be a string")
        if node.content == content:
            return node
        self._ensure_segment()
        old = node.content
        node.content = content
        self._record({"op": "content", "node_id": node_id, "old": old, "new": content})
        return node

    def add_ref(self, owner_id: str, target_id: str) -> None:
        """增加一条 ``owner_id -> target_id`` 引用。

        拒绝：节点不存在、自引用、重复引用；cascade/strict 下目标不存在拒绝，
        lenient 下允许（悬空引用）。
        """
        owner = self.get_node(owner_id)
        self._require_existing_target(target_id)
        if target_id == owner_id:
            raise ValidationError(f"node {owner_id!r} cannot reference itself")
        if target_id in owner.refs:
            raise ValidationError(f"duplicate ref: {owner_id!r} -> {target_id!r}")
        self._ensure_segment()
        self._add_ref_raw(owner_id, target_id)
        self._record({"op": "ref_add", "owner": owner_id, "target": target_id})

    def remove_ref(self, owner_id: str, target_id: str) -> None:
        """删除一条引用；引用不存在抛 :class:`ValidationError`。"""
        owner = self.get_node(owner_id)
        if not isinstance(target_id, str) or not target_id:
            raise ValidationError("target_id must be a non-empty string")
        if target_id not in owner.refs:
            raise ValidationError(f"no such ref: {owner_id!r} -> {target_id!r}")
        self._ensure_segment()
        self._remove_ref_raw(owner_id, target_id)
        self._record({"op": "ref_remove", "owner": owner_id, "target": target_id})

    def set_ref_policy(self, policy: str) -> List[Dict[str, str]]:
        """切换悬空引用策略，返回因切换而被清理的引用边（已按字典序）。

        - -> ``lenient``：现状不变（cascade/strict 下本就没有悬空引用）；
        - -> ``strict``：当前若有悬空引用则报错且**不切换**；
        - -> ``cascade``：立即清理全部悬空引用（逐条记入变更日志）。
        """
        if policy not in POLICIES:
            raise ValidationError(f"unknown ref policy: {policy!r}")
        if policy == self._policy:
            return []
        if policy == POLICY_STRICT:
            dangling = self.get_dangling_refs()
            if dangling:
                raise DanglingReferenceError(
                    "cannot switch to strict policy while dangling references exist",
                    dangling=dangling,
                )
        self._ensure_segment()
        cleaned: List[Dict[str, str]] = []
        if policy == POLICY_CASCADE:
            for edge in self.get_dangling_refs():  # 已排序
                self._remove_ref_raw(edge["owner"], edge["target"])
                cleaned.append(edge)
                self._record(
                    {"op": "ref_remove", "owner": edge["owner"], "target": edge["target"]}
                )
        old = self._policy
        self._policy = policy
        self._record({"op": "policy", "old": old, "new": policy})
        return cleaned

    def _add_ref_raw(self, owner_id: str, target_id: str) -> None:
        self._nodes[owner_id].refs.add(target_id)
        self._referrers.setdefault(target_id, set()).add(owner_id)

    def _remove_ref_raw(self, owner_id: str, target_id: str) -> None:
        self._nodes[owner_id].refs.discard(target_id)
        owners = self._referrers.get(target_id)
        if owners is not None:
            owners.discard(owner_id)
            if not owners:
                del self._referrers[target_id]

    # ================================================================ 查询

    def get_path(self, node_id: str) -> List[str]:
        """返回根 -> 该节点的 node_id 列表（含两端）；节点不存在则报错。"""
        self.get_node(node_id)
        path: List[str] = []
        current: Optional[str] = node_id
        seen: Set[str] = set()
        while current is not None:
            if current in seen:  # validate 已保证无环，这里双保险。
                raise ValidationError(f"cycle detected while building path at {current!r}")
            seen.add(current)
            path.append(current)
            current = self._nodes[current].parent_id
        path.reverse()
        return path

    def get_subtree(self, node_id: str, max_depth: Optional[int] = None) -> List[str]:
        """返回子树节点 id 的**前序**列表（含自身）。

        ``max_depth``：0 只含自身，1 再多一层…… ``None`` 不限深度。
        """
        self.get_node(node_id)
        if max_depth is not None:
            if isinstance(max_depth, bool) or not isinstance(max_depth, int) or max_depth < 0:
                raise ValidationError("max_depth must be a non-negative int or None")
        result: List[str] = []
        stack: List[Tuple[str, int]] = [(node_id, 0)]
        while stack:
            current, depth = stack.pop()
            result.append(current)
            if max_depth is None or depth < max_depth:
                for child in reversed(self._nodes[current].children):
                    stack.append((child, depth + 1))
        return result

    def find_by_kind(self, kind: str) -> List[Node]:
        """返回所有 kind 等于 ``kind`` 的节点，按全树前序排列。"""
        if not isinstance(kind, str) or not kind:
            raise ValidationError("kind must be a non-empty string")
        if self._root_id is None:
            return []
        return [self._nodes[nid] for nid in self._preorder_ids() if self._nodes[nid].kind == kind]

    def resolve_refs(self, node_id: str) -> List[Dict[str, Any]]:
        """返回节点每条引用的目标详情，按 target 字典序。

        每项 ``{"target", "exists", "dangling", "node"}``；目标不存在时
        ``node`` 为 ``None`` 且 ``dangling`` 为 ``True``。
        """
        node = self.get_node(node_id)
        resolved: List[Dict[str, Any]] = []
        for target in sorted(node.refs):
            target_node = self._nodes.get(target)
            resolved.append(
                {
                    "target": target,
                    "exists": target_node is not None,
                    "dangling": target_node is None,
                    "node": target_node.to_dict() if target_node is not None else None,
                }
            )
        return resolved

    def get_dangling_refs(self) -> List[Dict[str, str]]:
        """返回全部悬空引用边 ``[{"owner", "target"}]``，按字典序。"""
        edges: List[Dict[str, str]] = []
        for nid, node in self._nodes.items():
            for target in node.refs:
                if target not in self._nodes:
                    edges.append({"owner": nid, "target": target})
        edges.sort(key=lambda e: (e["owner"], e["target"]))
        return edges

    def preorder_ids(self) -> List[str]:
        """全树前序 node_id 列表；空树返回 ``[]``。"""
        return self._preorder_ids()

    def _preorder_ids(self) -> List[str]:
        if self._root_id is None:
            return []
        result: List[str] = []
        stack = [self._root_id]
        while stack:
            current = stack.pop()
            result.append(current)
            for child in reversed(self._nodes[current].children):
                stack.append(child)
        return result

    # ================================================================ 一致性校验

    def validate(self) -> None:
        """完整校验内存状态，破坏任一不变量即抛 :class:`ValidationError`。

        检查：根唯一且存在、node_id/kind 非空、parent/children 双向一致、
        无孤儿、children 无重复、无环、refs 无重复/无自引用、
        悬空引用与策略一致、反向引用索引一致。
        """
        if self._root_id is None:
            if self._nodes:
                raise ValidationError("nodes exist but root_id is None (orphan nodes)")
        else:
            if self._root_id not in self._nodes:
                raise ValidationError(f"root_id {self._root_id!r} does not exist")
            if self._nodes[self._root_id].parent_id is not None:
                raise ValidationError(f"root {self._root_id!r} has a non-None parent_id")

        roots = sorted(nid for nid, n in self._nodes.items() if n.parent_id is None)
        if len(roots) > 1:
            raise ValidationError(f"multiple root nodes: {roots}")

        for nid, node in self._nodes.items():
            if not isinstance(nid, str) or not nid:
                raise ValidationError("node_id must be a non-empty string")
            if not isinstance(node.kind, str) or not node.kind:
                raise ValidationError(f"node {nid!r}: kind must be a non-empty string")
            if not isinstance(node.content, str):
                raise ValidationError(f"node {nid!r}: content must be a string")
            if node.parent_id is not None:
                parent = self._nodes.get(node.parent_id)
                if parent is None:
                    raise ValidationError(
                        f"node {nid!r}: parent {node.parent_id!r} missing (orphan)"
                    )
                if nid not in parent.children:
                    raise ValidationError(
                        f"node {nid!r}: parent {node.parent_id!r} does not list it in children"
                    )
            if len(node.children) != len(set(node.children)):
                raise ValidationError(f"node {nid!r}: duplicate children ids")
            for child in node.children:
                child_node = self._nodes.get(child)
                if child_node is None:
                    raise ValidationError(f"node {nid!r}: child {child!r} does not exist")
                if child_node.parent_id != nid:
                    raise ValidationError(
                        f"node {child!r}: parent_id is {child_node.parent_id!r}, expected {nid!r}"
                    )
            if nid in node.refs:
                raise ValidationError(f"node {nid!r}: self-reference in refs")
            for target in node.refs:
                if not isinstance(target, str) or not target:
                    raise ValidationError(f"node {nid!r}: refs must be non-empty strings")

        # 无环 + 可达性：从根做三色迭代 DFS。
        WHITE, GRAY, BLACK = 0, 1, 2
        color = {nid: WHITE for nid in self._nodes}
        if self._root_id is not None:
            stack: List[Tuple[str, int]] = [(self._root_id, 0)]
            color[self._root_id] = GRAY
            while stack:
                nid, child_index = stack[-1]
                children = self._nodes[nid].children
                if child_index < len(children):
                    child = children[child_index]
                    stack[-1] = (nid, child_index + 1)
                    if color[child] == GRAY:
                        raise ValidationError(f"cycle detected involving node {child!r}")
                    if color[child] == WHITE:
                        color[child] = GRAY
                        stack.append((child, 0))
                else:
                    color[nid] = BLACK
                    stack.pop()
        unreachable = sorted(nid for nid, c in color.items() if c != BLACK)
        if unreachable:
            raise ValidationError(f"unreachable/orphan nodes: {unreachable}")

        dangling_targets = {
            target for node in self._nodes.values() for target in node.refs
            if target not in self._nodes
        }
        if self._policy in (POLICY_CASCADE, POLICY_STRICT) and dangling_targets:
            raise ValidationError(
                f"dangling refs exist under {self._policy} policy: {sorted(dangling_targets)}"
            )

        expected: Dict[str, Set[str]] = {}
        for nid, node in self._nodes.items():
            for target in node.refs:
                expected.setdefault(target, set()).add(nid)
        if expected != self._referrers:
            raise ValidationError("internal referrer index is out of sync")

    # ================================================================ 快照 / 分段

    def _snapshot_state(self, version: int) -> Dict[str, Any]:
        """把当前状态序列化为快照 dict（深拷贝，与后续编辑隔离）。"""
        return {
            "version": version,
            "root_id": self._root_id,
            "policy": self._policy,
            "nodes": {nid: copy.deepcopy(node.to_dict()) for nid, node in self._nodes.items()},
        }

    def _ensure_segment(self) -> None:
        """首次变更前以“变更前状态”建立第一个分段（懒创建）。"""
        if not self._segments:
            self._segments.append(
                {
                    "snapshot": self._snapshot_state(self._version),
                    "changes": [],
                    "persisted": 0,
                    "snapshot_persisted": False,
                }
            )

    def _record(self, change: Dict[str, Any]) -> None:
        """向当前分段追加变更并分配版本号（回滚后可能跳号，保证全局单调）。"""
        seg = self._segments[-1]
        new_version = max(self._max_version, self._version) + 1
        wrapper = {"base_version": self._version, "version": new_version, "change": change}
        seg["changes"].append(wrapper)
        self._version = new_version
        self._max_version = new_version

    def dump_state(self) -> Dict[str, Any]:
        """当前完整状态（版本 / 策略 / 前序 / 悬空引用 / 历史），供 CLI ``dump``。"""
        snap = self._snapshot_state(self._version)
        snap["preorder"] = self._preorder_ids()
        snap["dangling_refs"] = self.get_dangling_refs()
        snap["history"] = self.history()
        return snap

    # -------------------------------------------- 供 persistence 使用的接口

    def _journal_segments(self) -> List[Dict[str, Any]]:
        """分段历史的深拷贝（persistence 据此决定写哪些记录）。"""
        return copy.deepcopy(self._segments)

    def _mark_saved(
        self,
        path: str,
        last_seq: int,
        persisted_counts: List[int],
        max_version: int,
    ) -> None:
        """save 成功后回写记账信息。"""
        self._journal_path = path
        self._persisted_seq = last_seq
        self._max_version = max(self._max_version, max_version)
        for seg, count in zip(self._segments, persisted_counts):
            seg["persisted"] = count
            seg["snapshot_persisted"] = True

    def _adopt_segments(
        self,
        segments: List[Dict[str, Any]],
        live: "DocumentTree",
        max_version: int,
        path: str,
        last_seq: int,
        version: Optional[int] = None,
    ) -> None:
        """load 后用文件重建的状态替换自身并接管分段历史。"""
        self._nodes = live._nodes
        self._root_id = live._root_id
        self._referrers = live._referrers
        self._policy = live._policy
        self._segments = segments
        if version is not None:
            self._version = version
        else:
            last_seg = segments[-1]
            self._version = (
                last_seg["changes"][-1]["version"]
                if last_seg["changes"]
                else last_seg["snapshot"]["version"]
            )
        self._max_version = max(max_version, self._version)
        self._journal_path = path
        self._persisted_seq = last_seq

    def apply_change(self, change: Dict[str, Any]) -> None:
        """应用（重放）一条内核变更。引用 / 成环等约束照常校验。"""
        op = change.get("op")
        method = {
            "add": self._replay_add,
            "remove": self._replay_remove,
            "move": self._replay_move,
            "content": self._replay_content,
            "ref_add": self._replay_ref_add,
            "ref_remove": self._replay_ref_remove,
            "policy": self._replay_policy,
        }.get(op)
        if method is None:
            raise ValidationError(f"unknown change op: {op!r}")
        method(change)

    def _replay_add(self, ch: Dict[str, Any]) -> None:
        data = ch.get("node")
        if not isinstance(data, dict):
            raise ValidationError("add change missing node object")
        node = Node.from_dict(data)
        if node.node_id in self._nodes:
            raise ValidationError(f"add change: node_id already exists: {node.node_id!r}")
        if node.parent_id is not None and node.parent_id not in self._nodes:
            raise ValidationError(f"add change: parent {node.parent_id!r} does not exist")
        if node.parent_id is None:
            if self._root_id is not None:
                raise ValidationError("add change: a root already exists")
            self._root_id = node.node_id
        else:
            self._nodes[node.parent_id].children.append(node.node_id)
        stored_children = list(node.children)
        node.children = []  # 子节点由各自的 add 记录挂载。
        self._nodes[node.node_id] = node
        for target in sorted(node.refs):
            if target not in self._nodes and self._policy != POLICY_LENIENT:
                raise DanglingReferenceError(
                    f"add change: ref target {target!r} does not exist"
                )
            self._add_ref_raw(node.node_id, target)
        # add 记录若携带 children（正常应为空），必须与重放状态一致才接受。
        for child in stored_children:
            if child not in self._nodes or self._nodes[child].parent_id != node.node_id:
                raise ValidationError(
                    f"add change: node {node.node_id!r} carries an invalid children list"
                )
            node.children.append(child)

    def _replay_remove(self, ch: Dict[str, Any]) -> None:
        node_id = ch.get("node_id")
        if not isinstance(node_id, str) or node_id not in self._nodes:
            raise ValidationError(f"remove change: node {node_id!r} does not exist")
        subtree = self.get_subtree(node_id)
        removed_subtree = ch.get("removed_subtree")
        if removed_subtree is not None and removed_subtree != subtree:
            raise ValidationError(
                f"remove change: recorded removed_subtree does not match actual subtree "
                f"of {node_id!r}"
            )
        self._remove_subtree_raw(subtree)

    def _replay_move(self, ch: Dict[str, Any]) -> None:
        node_id = ch.get("node_id")
        new_parent_id = ch.get("new_parent_id")
        index = ch.get("index")
        if not isinstance(node_id, str) or node_id not in self._nodes:
            raise ValidationError(f"move change: node {node_id!r} does not exist")
        if not isinstance(new_parent_id, str) or new_parent_id not in self._nodes:
            raise ValidationError(f"move change: new parent {new_parent_id!r} does not exist")
        subtree = set(self.get_subtree(node_id))
        if new_parent_id in subtree:
            raise ValidationError(
                f"move change: moving {node_id!r} into its own subtree creates a cycle"
            )
        node = self._nodes[node_id]
        same_parent = node.parent_id == new_parent_id
        max_index = len(self._nodes[new_parent_id].children) - (1 if same_parent else 0)
        if not isinstance(index, int) or isinstance(index, bool) or not (0 <= index <= max_index):
            raise ValidationError(f"move change: index {index!r} out of range 0..{max_index}")
        self._nodes[node.parent_id].children.remove(node_id)
        self._nodes[new_parent_id].children.insert(index, node_id)
        node.parent_id = new_parent_id

    def _replay_content(self, ch: Dict[str, Any]) -> None:
        node_id = ch.get("node_id")
        if not isinstance(node_id, str) or node_id not in self._nodes:
            raise ValidationError(f"content change: node {node_id!r} does not exist")
        new = ch.get("new")
        if not isinstance(new, str):
            raise ValidationError("content change: 'new' must be a string")
        self._nodes[node_id].content = new

    def _replay_ref_add(self, ch: Dict[str, Any]) -> None:
        owner_id, target_id = ch.get("owner"), ch.get("target")
        if not isinstance(owner_id, str) or owner_id not in self._nodes:
            raise ValidationError(f"ref_add change: owner {owner_id!r} does not exist")
        if not isinstance(target_id, str) or not target_id:
            raise ValidationError("ref_add change: target must be a non-empty string")
        if target_id == owner_id:
            raise ValidationError("ref_add change: self-reference")
        if target_id not in self._nodes and self._policy != POLICY_LENIENT:
            raise DanglingReferenceError(
                f"ref_add change: target {target_id!r} does not exist"
            )
        if target_id in self._nodes[owner_id].refs:
            raise ValidationError(
                f"ref_add change: duplicate ref {owner_id!r} -> {target_id!r}"
            )
        self._add_ref_raw(owner_id, target_id)

    def _replay_ref_remove(self, ch: Dict[str, Any]) -> None:
        owner_id, target_id = ch.get("owner"), ch.get("target")
        if not isinstance(owner_id, str) or owner_id not in self._nodes:
            raise ValidationError(f"ref_remove change: owner {owner_id!r} does not exist")
        if target_id not in self._nodes[owner_id].refs:
            raise ValidationError(
                f"ref_remove change: no such ref {owner_id!r} -> {target_id!r}"
            )
        self._remove_ref_raw(owner_id, target_id)

    def _replay_policy(self, ch: Dict[str, Any]) -> None:
        new = ch.get("new")
        if new not in POLICIES:
            raise ValidationError(f"policy change: unknown policy {new!r}")
        if new == POLICY_STRICT and self.get_dangling_refs():
            raise DanglingReferenceError(
                "policy change: cannot switch to strict while dangling refs exist"
            )
        self._policy = new

    # ================================================================ 版本回滚与 diff

    def _locate_version(self, version: int) -> Tuple[int, int]:
        """返回版本 ``version`` 所在的（分段下标, 分段内变更条数）。"""
        for seg_idx, seg in enumerate(self._segments):
            base = seg["snapshot"]["version"]
            if version == base:
                return seg_idx, 0
            expected = base
            for i, wrapper in enumerate(seg["changes"]):
                if wrapper["base_version"] != expected:
                    raise ValidationError(
                        f"segment {seg_idx} change #{i + 1}: base_version "
                        f"{wrapper['base_version']} != expected {expected}"
                    )
                expected = wrapper["version"]
                if version == wrapper["version"]:
                    return seg_idx, i + 1
        raise VersionNotFoundError(version)

    def state_at_version(self, version: int) -> "DocumentTree":
        """重放历史构造指定版本的状态树（不影响当前内存状态）。

        版本不在 :meth:`history` 中时抛 :class:`VersionNotFoundError`。
        """
        if isinstance(version, bool) or not isinstance(version, int):
            raise ValidationError("version must be an int")
        if not self._segments:
            if version != self._version:
                raise VersionNotFoundError(version)
            return DocumentTree._from_snapshot(self._snapshot_state(self._version))
        seg_idx, prefix_len = self._locate_version(version)
        seg = self._segments[seg_idx]
        tree = DocumentTree._from_snapshot(seg["snapshot"])
        expected = seg["snapshot"]["version"]
        for i, wrapper in enumerate(seg["changes"][:prefix_len]):
            if wrapper["base_version"] != expected:
                raise ValidationError(
                    f"segment {seg_idx} change #{i + 1}: base_version "
                    f"{wrapper['base_version']} != expected {expected}"
                )
            try:
                tree.apply_change(wrapper["change"])
            except Exception as exc:
                raise ValidationError(
                    f"segment {seg_idx} change #{i + 1}: replay failed: {exc}"
                ) from exc
            expected = wrapper["version"]
        tree.validate()
        return tree

    def rollback(self, version: int) -> "DocumentTree":
        """把内存状态恢复到指定版本（从变更记录重放）。

        会开启一个以目标版本为起点的**新分段**并丢弃其后的当前分支变更；
        此后新编辑的版本号继续全局单调递增，不复用、不覆盖旧版本号。
        版本不存在抛 :class:`VersionNotFoundError`。
        """
        if version == self._version:
            return self  # 已是目标版本：不产生冗余分段。
        target = self.state_at_version(version)
        new_segment = {
            "snapshot": target._snapshot_state(version),
            "changes": [],
            "persisted": 0,
            "snapshot_persisted": False,
        }
        self._nodes = target._nodes
        self._root_id = target._root_id
        self._referrers = target._referrers
        self._policy = target._policy
        self._segments.append(new_segment)
        self._version = version
        # _max_version 不变，新变更从 max+1 继续编号。
        return self

    def diff_versions(self, v1: int, v2: int) -> "VersionDiff":
        """比较两个版本，返回 :class:`~doctree.persistence.VersionDiff`。"""
        from doctree.persistence import VersionDiff

        t1 = self.state_at_version(v1)
        t2 = self.state_at_version(v2)
        return VersionDiff.compute(v1, v2, t1, t2)

    # ================================================================ 装载 / 输入校验

    @classmethod
    def _from_snapshot(cls, snapshot: Dict[str, Any]) -> "DocumentTree":
        """从快照 dict 直接构造树（校验不通过会抛错）。"""
        policy = snapshot.get("policy", POLICY_CASCADE)
        if policy not in POLICIES:
            raise ValidationError(f"snapshot: unknown policy {policy!r}")
        tree = cls(ref_policy=policy)
        tree._root_id = snapshot.get("root_id")
        if not isinstance(snapshot.get("version", 0), int) or isinstance(
            snapshot.get("version"), bool
        ):
            raise ValidationError("snapshot version must be an int")

        nodes_raw = snapshot.get("nodes")
        if not isinstance(nodes_raw, dict):
            raise ValidationError("snapshot: nodes must be an object")
        # 两阶段装载：先建节点，再统一补父子边，容忍字典任意顺序。
        for nid, data in nodes_raw.items():
            if not isinstance(data, dict):
                raise ValidationError(f"snapshot node {nid!r}: must be an object")
            if data.get("node_id") != nid:
                raise ValidationError(
                    f"snapshot node key {nid!r} != node_id {data.get('node_id')!r}"
                )
            node = Node.from_dict(data)
            tree._nodes[nid] = node
            for target in node.refs:
                tree._referrers.setdefault(target, set()).add(nid)
        for nid, node in tree._nodes.items():
            if node.parent_id is not None:
                parent = tree._nodes.get(node.parent_id)
                if parent is None:
                    raise ValidationError(f"snapshot node {nid!r}: missing parent")
                if nid not in parent.children:
                    parent.children.append(nid)
        tree.validate()
        return tree

    @staticmethod
    def _check_id(node_id: object) -> None:
        if not isinstance(node_id, str) or not node_id:
            raise ValidationError("node_id must be a non-empty string")

    def _check_refs_input(self, refs: Optional[Iterable[str]], *, owner_id: str) -> Set[str]:
        ref_list = list(refs) if refs is not None else []
        if any(not isinstance(r, str) or not r for r in ref_list):
            raise ValidationError("refs must be non-empty strings")
        if len(ref_list) != len(set(ref_list)):
            raise ValidationError("refs contain duplicates")
        ref_set = set(ref_list)
        if owner_id in ref_set:
            raise ValidationError(f"node {owner_id!r} cannot reference itself")
        missing = sorted(r for r in ref_set if r not in self._nodes)
        if missing and self._policy != POLICY_LENIENT:
            raise DanglingReferenceError(
                f"refs target missing nodes: {missing}",
                dangling=[{"owner": owner_id, "target": t} for t in missing],
            )
        return ref_set

    def _require_existing_target(self, target_id: object) -> None:
        if not isinstance(target_id, str) or not target_id:
            raise ValidationError("target_id must be a non-empty string")
        if target_id not in self._nodes and self._policy != POLICY_LENIENT:
            raise DanglingReferenceError(f"ref target does not exist: {target_id!r}")
