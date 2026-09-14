"""树形文档编辑器内核：层级维护、拖拽移动、引用、删除策略、查询与撤销重做。

设计要点
--------

* 节点的可变状态只存在于 :class:`DocumentTree` 内部的 ``_Node`` 中；
  对外通过不可变的值对象 :class:`~doctree.model.Node` 等暴露快照。
* 所有结构性修改都收敛到两个内部原语 ``_detach`` / ``_attach``，
  历史命令只记录“摘下/挂回”的精确坐标（父节点 + 下标），
  因此正向与逆向都能确定性地精确复现。
* 每个公共变异操作完成后都会运行 :meth:`DocumentTree.check_invariants`，
  一旦父子双向关系、环、孤儿、引用出现任何破坏立即抛出，杜绝部分修改。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterator, List, Optional, Tuple, Union

from .errors import (
    CycleError,
    DuplicateIdError,
    InvalidPositionError,
    NodeNotFoundError,
    PolicyError,
    ReferenceValidationError,
    UndoRedoError,
)
from .history import (
    AddNodeCommand,
    Command,
    DeleteCommand,
    MoveCommand,
    ReferenceCommand,
    SetPolicyCommand,
)
from .model import (
    AffectedReference,
    DanglingPolicy,
    DeleteResult,
    MoveResult,
    Node,
    ReferenceView,
)

Path = Tuple[str, ...]


@dataclass
class _Node:
    """节点的内部可变表示。"""

    id: str
    parent: Optional[str]
    children: List[str]
    references: List[str]


class DocumentTree:
    """可嵌套文档树及其全部操作。

    :param policy: 初始悬空引用策略，默认为级联清理。
    """

    def __init__(self, policy: Union[DanglingPolicy, str] = DanglingPolicy.CASCADE) -> None:
        self._nodes: Dict[str, _Node] = {}
        self._roots: List[str] = []
        self._policy: DanglingPolicy = self._coerce_policy(policy)
        self._undo: List[Command] = []
        self._redo: List[Command] = []

    # ------------------------------------------------------------------ #
    # 基础属性与节点增删
    # ------------------------------------------------------------------ #

    @property
    def policy(self) -> DanglingPolicy:
        """当前悬空引用策略。"""
        return self._policy

    @property
    def roots(self) -> Tuple[str, ...]:
        """根节点标识（有序）。"""
        return tuple(self._roots)

    @property
    def can_undo(self) -> bool:
        """撤销栈是否非空。"""
        return bool(self._undo)

    @property
    def can_redo(self) -> bool:
        """重做栈是否非空。"""
        return bool(self._redo)

    @property
    def undo_depth(self) -> int:
        """可撤销步数。"""
        return len(self._undo)

    @property
    def redo_depth(self) -> int:
        """可重做步数。"""
        return len(self._redo)

    @staticmethod
    def _coerce_policy(policy: Union[DanglingPolicy, str]) -> DanglingPolicy:
        """把字符串或枚举统一转换为 :class:`DanglingPolicy`。"""
        if isinstance(policy, DanglingPolicy):
            return policy
        try:
            return DanglingPolicy(str(policy))
        except ValueError as exc:
            raise PolicyError(f"未知的悬空引用策略: {policy!r}") from exc

    def _require(self, node_id: str) -> _Node:
        """取内部节点，不存在则抛 :class:`NodeNotFoundError`。"""
        try:
            return self._nodes[node_id]
        except KeyError:
            raise NodeNotFoundError(f"节点不存在: {node_id!r}") from None

    def contains(self, node_id: str) -> bool:
        """返回节点是否在树中。"""
        return node_id in self._nodes

    def add_node(
        self,
        node_id: str,
        parent: Optional[str] = None,
        index: Optional[int] = None,
    ) -> Node:
        """新建一个节点并挂到 ``parent`` 下。

        :param node_id: 全局唯一标识，必须是非空字符串。
        :param parent: 父节点标识；``None`` 表示作为根节点。
        :param index: 插入位置；``None`` 表示追加到末尾。
        :returns: 新建节点的只读快照。
        :raises DuplicateIdError: 标识已存在或不合法。
        :raises NodeNotFoundError: 父节点不存在。
        :raises InvalidPositionError: 插入位置越界。
        """
        if not isinstance(node_id, str) or not node_id:
            raise DuplicateIdError("节点标识必须是非空字符串")
        if node_id in self._nodes:
            raise DuplicateIdError(f"节点标识重复: {node_id!r}")
        siblings = self._roots if parent is None else self._require(parent).children
        bound = len(siblings)
        if index is None:
            index = bound
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index <= bound:
            raise InvalidPositionError(
                f"插入位置 {index!r} 越界，合法范围为 0..{bound}（含端点）"
            )
        command = AddNodeCommand(node_id=node_id, parent=parent, index=index)
        command.apply(self)
        self._push(command)
        self.check_invariants()
        return self.node(node_id)

    def _execute_add_node(self, command: AddNodeCommand) -> None:
        """正向执行/重做新建节点。"""
        if command.node_id in self._nodes:  # pragma: no cover - 线性历史保证
            raise DuplicateIdError(f"节点标识重复: {command.node_id!r}")
        node = _Node(id=command.node_id, parent=command.parent, children=[], references=[])
        self._nodes[command.node_id] = node
        siblings = (
            self._roots if command.parent is None else self._nodes[command.parent].children
        )
        siblings.insert(command.index, command.node_id)

    def _revert_add_node(self, command: AddNodeCommand) -> None:
        """撤销新建节点：线性历史保证撤销到它时它仍是叶子。"""
        node = self._nodes[command.node_id]
        if node.children:
            raise AssertionError(
                f"撤销新建时节点 {command.node_id!r} 仍有子节点，历史顺序被破坏"
            )
        self._detach(command.node_id)
        del self._nodes[command.node_id]

    def node(self, node_id: str) -> Node:
        """返回节点的只读快照 :class:`Node`。"""
        n = self._require(node_id)
        return Node(
            id=n.id,
            parent=n.parent,
            children=tuple(n.children),
            references=tuple(n.references),
        )

    def all_node_ids(self) -> Tuple[str, ...]:
        """按展示前序（根依次深度优先）返回全部节点标识。"""
        return tuple(self._iter_preorder())

    def __len__(self) -> int:
        return len(self._nodes)

    def __contains__(self, node_id: object) -> bool:
        return isinstance(node_id, str) and node_id in self._nodes

    # ------------------------------------------------------------------ #
    # 结构原语：仅历史命令与内部流程使用
    # ------------------------------------------------------------------ #

    def _siblings_of(self, node: _Node) -> List[str]:
        """返回容纳该节点的兄弟列表（根列表或父节点的子列表）。"""
        if node.parent is None:
            return self._roots
        return self._nodes[node.parent].children

    def _detach(self, node_id: str) -> None:
        """把节点从当前父节点（或根列表）摘下。

        只断开这一条父子边，子树内部链接保持不变。调用方必须随后
        ``_attach`` 到新位置（删除流程除外）。
        """
        node = self._require(node_id)
        siblings = self._siblings_of(node)
        try:
            siblings.remove(node_id)
        except ValueError:  # pragma: no cover - 不变量保证不会发生
            raise AssertionError(f"内部错误：节点 {node_id!r} 不在其父节点的子列表中")
        node.parent = None

    def _attach(self, node_id: str, parent: Optional[str], index: int) -> None:
        """把节点挂到 ``parent`` 下的 ``index`` 位置。

        :param parent: ``None`` 表示挂为根节点。
        :param index: 相对挂载前目标兄弟列表的位置，合法范围 0..len（含端点）。
        """
        node = self._require(node_id)
        if parent is not None:
            self._require(parent)
        siblings = self._roots if parent is None else self._nodes[parent].children
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index <= len(siblings):
            raise InvalidPositionError(
                f"挂载位置 {index!r} 越界，合法范围为 0..{len(siblings)}（含端点）"
            )
        siblings.insert(index, node_id)
        node.parent = parent

    def _iter_preorder(self) -> Iterator[str]:
        """从所有根出发深度优先前序迭代节点标识。"""
        stack: List[Tuple[str, int]] = []
        for root in reversed(self._roots):
            stack.append((root, 0))
        while stack:
            nid, _ = stack.pop()
            yield nid
            node = self._nodes[nid]
            for child in reversed(node.children):
                stack.append((child, 0))

    def _preorder(self, node_id: str) -> List[str]:
        """返回以某节点为根的子树前序列表（根在最前）。"""
        result: List[str] = []
        stack = [node_id]
        while stack:
            current = stack.pop()
            result.append(current)
            children = self._nodes[current].children
            for child in reversed(children):
                stack.append(child)
        return result

    def subtree_ids(self, node_id: str) -> Tuple[str, ...]:
        """返回某节点整棵子树的标识（前序，根在前）。"""
        self._require(node_id)
        return tuple(self._preorder(node_id))

    def is_ancestor(self, ancestor_id: str, descendant_id: str) -> bool:
        """``ancestor_id`` 是否为 ``descendant_id`` 的祖先（含间接，不含自身）。"""
        self._require(ancestor_id)
        self._require(descendant_id)
        current: Optional[str] = self._nodes[descendant_id].parent
        while current is not None:
            if current == ancestor_id:
                return True
            current = self._nodes[current].parent
        return False

    # ------------------------------------------------------------------ #
    # 路径
    # ------------------------------------------------------------------ #

    def path_of(self, node_id: str) -> Path:
        """返回节点从根到自身的标识路径（含自身）。

        :raises NodeNotFoundError: 节点不存在。
        """
        self._require(node_id)
        return self._path_unchecked(node_id)

    def _path_unchecked(self, node_id: str) -> Path:
        parts: List[str] = []
        current: Optional[str] = node_id
        seen = set()
        while current is not None:
            if current in seen:  # pragma: no cover - 不变量保证无环
                raise CycleError(f"层级中检测到环，涉及节点 {current!r}")
            seen.add(current)
            parts.append(current)
            current = self._nodes[current].parent if current in self._nodes else None
        parts.reverse()
        return tuple(parts)

    def _path_or_empty(self, node_id: str) -> Path:
        """目标可能已删除（悬空）时使用，删除目标返回空路径。"""
        if node_id not in self._nodes:
            return ()
        return self._path_unchecked(node_id)

    # ------------------------------------------------------------------ #
    # 移动（拖拽）
    # ------------------------------------------------------------------ #

    def move(
        self,
        node_id: str,
        new_parent: Optional[str],
        index: int,
    ) -> MoveResult:
        """把 ``node_id`` 连同整棵子树拖到 ``new_parent`` 的 ``index`` 位置。

        下标语义：先把节点从旧位置摘下，再插入目标兄弟列表，因此
        ``index`` 的合法范围是 **摘下之后** 目标列表的 ``0..len``（含端点）。
        同一父节点内重排时，这等同于 Python 的 ``remove`` 再 ``insert``
        语义，例如 ``[a, b, c]`` 中把 ``a`` 移到末尾应传 ``index=2``。

        任何前置校验失败都不会产生部分修改。

        :param node_id: 被拖动的子树根。
        :param new_parent: 新父节点；``None`` 表示拖到根层级。
        :param index: 摘下后在目标兄弟列表中的插入位置。
        :raises NodeNotFoundError: 被移动节点或目标父节点不存在。
        :raises CycleError: 目标是节点自身或位于其子树内。
        :raises InvalidPositionError: 位置越界，或与当前位置完全相同。
        """
        node = self._require(node_id)
        if new_parent is not None:
            self._require(new_parent)

        subtree = self._preorder(node_id)
        subtree_set = set(subtree)

        if new_parent == node_id:
            raise CycleError(f"不能把节点 {node_id!r} 移到自身之下")
        if new_parent is not None and new_parent in subtree_set:
            raise CycleError(
                f"不能把节点 {node_id!r} 移进自己的子树：{new_parent!r} 是其后代"
            )

        old_parent = node.parent
        old_siblings = self._siblings_of(node)
        old_index = old_siblings.index(node_id)
        target_siblings = (
            self._roots if new_parent is None else self._nodes[new_parent].children
        )
        bound = len(target_siblings) - (1 if old_parent == new_parent else 0)
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index <= bound:
            raise InvalidPositionError(
                f"插入位置 {index!r} 越界，合法范围为 0..{bound}（含端点，先摘下再插入）"
            )
        if old_parent == new_parent and index == old_index:
            raise InvalidPositionError(
                f"节点 {node_id!r} 已在父节点 {new_parent!r} 的位置 {index}，无需移动"
            )

        # 移动前的全部路径与受影响引用（此时世界完整）。
        old_paths: Dict[str, Path] = {nid: self._path_unchecked(nid) for nid in subtree}
        affected_before = self._collect_affected(subtree_set)

        command = MoveCommand(
            node_id=node_id,
            old_parent=old_parent,
            old_index=old_index,
            new_parent=new_parent,
            new_index=index,
        )
        command.apply(self)

        new_paths: Dict[str, Path] = {nid: self._path_unchecked(nid) for nid in subtree}
        affected: List[AffectedReference] = []
        for source, target, sin, tin in affected_before:
            affected.append(
                AffectedReference(
                    source=source,
                    target=target,
                    source_in_subtree=sin,
                    target_in_subtree=tin,
                    source_old_path=(old_paths.get(source)
                                     if source in subtree_set else self._path_or_empty(source)),
                    source_new_path=self._path_or_empty(source),
                    target_old_path=(old_paths.get(target)
                                     if target in subtree_set else self._path_or_empty(target)),
                    target_new_path=self._path_or_empty(target),
                )
            )

        self._push(command)
        self.check_invariants()
        return MoveResult(
            moved_nodes=tuple(subtree),
            node_id=node_id,
            new_parent=new_parent,
            index=index,
            old_paths=old_paths,
            new_paths=new_paths,
            affected_references=tuple(affected),
        )

    def _collect_affected(
        self, subtree_set: set
    ) -> List[Tuple[str, str, bool, bool]]:
        """收集来源或目标位于子树内的引用（按展示前序稳定排序）。"""
        found: List[Tuple[str, str, bool, bool]] = []
        for source in self._iter_preorder():
            for target in self._nodes[source].references:
                sin = source in subtree_set
                tin = target in subtree_set
                if sin or tin:
                    found.append((source, target, sin, tin))
        return found

    # ------------------------------------------------------------------ #
    # 引用
    # ------------------------------------------------------------------ #

    def add_reference(self, source: str, target: str) -> None:
        """让 ``source`` 引用 ``target``。

        引用只在两个现存节点之间建立；悬空引用只能由
        “删除 + ``KEEP_DANGLING`` 策略”产生。

        :raises NodeNotFoundError: 任一节点不存在。
        :raises ReferenceValidationError: 自引用或引用已存在。
        """
        self._require(source)
        self._require(target)
        if source == target:
            raise ReferenceValidationError(f"节点不能引用自身: {source!r}")
        refs = self._nodes[source].references
        if target in refs:
            raise ReferenceValidationError(
                f"引用已存在: {source!r} -> {target!r}"
            )
        index = len(refs)  # 新引用追加在出链末尾
        command = ReferenceCommand(source=source, target=target, adding=True, index=index)
        command.apply(self)
        self._push(command)
        self.check_invariants()

    def remove_reference(self, source: str, target: str) -> None:
        """删除一条既有引用。

        可删除普通引用，也可删除悬空引用。该操作可撤销/重做，
        撤销时引用会精确插回原位置。

        :raises NodeNotFoundError: 来源节点不存在。
        :raises ReferenceValidationError: 该引用不存在。
        """
        refs = self._require(source).references
        if target not in refs:
            raise ReferenceValidationError(
                f"引用不存在，无法删除: {source!r} -> {target!r}"
            )
        index = refs.index(target)
        command = ReferenceCommand(source=source, target=target, adding=False, index=index)
        command.apply(self)
        self._push(command)
        self.check_invariants()

    def _execute_reference_change(
        self, command: ReferenceCommand, adding: bool
    ) -> None:
        """正向/逆向应用引用变更。

        线性历史保证执行时来源节点存在、引用的存在性与动作匹配；
        插入位置越界时退化为追加，以容忍与删除命令交错后的边界情形。
        """
        refs = self._nodes[command.source].references
        if adding:
            if command.target in refs:  # pragma: no cover - 线性历史保证
                raise ReferenceValidationError(
                    f"引用已存在: {command.source!r} -> {command.target!r}"
                )
            if 0 <= command.index <= len(refs):
                refs.insert(command.index, command.target)
            else:
                refs.append(command.target)
        else:
            try:
                refs.remove(command.target)
            except ValueError:  # pragma: no cover - 线性历史保证
                raise ReferenceValidationError(
                    f"引用不存在，无法删除: {command.source!r} -> {command.target!r}"
                ) from None

    def outgoing_references(self, node_id: str) -> Tuple[str, ...]:
        """返回节点引用的全部目标标识（存储顺序，可能含悬空目标）。"""
        return tuple(self._require(node_id).references)

    def references_of(self, node_id: str) -> Tuple[ReferenceView, ...]:
        """返回节点的全部出链视图，逐项标注是否悬空。"""
        self._require(node_id)
        return tuple(
            ReferenceView(source=node_id, target=t, dangling=t not in self._nodes)
            for t in self._nodes[node_id].references
        )

    def incoming_references(self, node_id: str) -> Tuple[str, ...]:
        """返回引用了该节点的全部来源节点标识（按展示前序稳定排序）。"""
        self._require(node_id)
        result: List[str] = []
        for source in self._iter_preorder():
            if node_id in self._nodes[source].references:
                result.append(source)
        return tuple(result)

    def referrers_of(self, node_id: str) -> Tuple[ReferenceView, ...]:
        """返回指向该节点的全部入链视图（来源按展示前序稳定排序）。"""
        self._require(node_id)
        result: List[ReferenceView] = []
        for source in self._iter_preorder():
            if node_id in self._nodes[source].references:
                result.append(ReferenceView(source=source, target=node_id, dangling=False))
        return tuple(result)

    def all_references(self) -> Tuple[ReferenceView, ...]:
        """返回当前全部引用（来源按展示前序、同来源按添加顺序）。"""
        result: List[ReferenceView] = []
        for source in self._iter_preorder():
            for target in self._nodes[source].references:
                result.append(
                    ReferenceView(source=source, target=target, dangling=target not in self._nodes)
                )
        return tuple(result)

    def dangling_references(self) -> Tuple[ReferenceView, ...]:
        """返回当前全部悬空引用（稳定顺序，``dangling`` 恒为 ``True``）。"""
        return tuple(view for view in self.all_references() if view.dangling)

    # ------------------------------------------------------------------ #
    # 删除与悬空策略
    # ------------------------------------------------------------------ #

    def delete(self, node_id: str) -> DeleteResult:
        """删除节点及其整棵子树，并按当前策略处理指向被删节点的引用。

        * ``CASCADE``（默认）：幸存节点指向子树内节点的引用被清理，
          清理项记录在结果中，可随撤销恢复。
        * ``KEEP_DANGLING``：引用保留在来源上并成为悬空引用。

        :raises NodeNotFoundError: 节点不存在。
        """
        self._require(node_id)
        subtree = self._preorder(node_id)
        subtree_set = set(subtree)
        root = self._nodes[node_id]
        old_parent = root.parent
        old_siblings = self._siblings_of(root)
        old_index = old_siblings.index(node_id)
        old_paths = {nid: self._path_unchecked(nid) for nid in subtree}

        snapshots = tuple(
            Node(
                id=nid,
                parent=self._nodes[nid].parent,
                children=tuple(self._nodes[nid].children),
                references=tuple(self._nodes[nid].references),
            )
            for nid in subtree
        )

        removed: List[Tuple[str, str]] = []
        dangling: List[Tuple[str, str]] = []
        surviving_before: Dict[str, Tuple[str, ...]] = {}
        surviving_after: Dict[str, Tuple[str, ...]] = {}

        # 只检查幸存来源；被删子树内部的引用随子树一起消失。
        for source in self._iter_preorder():
            if source in subtree_set:
                continue
            refs = self._nodes[source].references
            hit = [t for t in refs if t in subtree_set]
            if not hit:
                continue
            surviving_before[source] = tuple(refs)
            if self._policy is DanglingPolicy.KEEP_DANGLING:
                # 保留悬空：出链原样保留，仅把目标标记为悬空。
                surviving_after[source] = tuple(refs)
            else:
                surviving_after[source] = tuple(t for t in refs if t not in subtree_set)
            for target in hit:
                if self._policy is DanglingPolicy.CASCADE:
                    removed.append((source, target))
                else:
                    dangling.append((source, target))

        command = DeleteCommand(
            root_id=node_id,
            old_parent=old_parent,
            old_index=old_index,
            detached_nodes=snapshots,
            policy=self._policy,
            surviving_refs=surviving_before,
            surviving_refs_after=surviving_after,
        )
        command.apply(self)
        self._push(command)
        self.check_invariants()
        return DeleteResult(
            deleted_nodes=tuple(subtree),
            old_paths=old_paths,
            removed_references=tuple(removed),
            dangling_references=tuple(dangling),
        )

    def _execute_delete(self, command: DeleteCommand) -> None:
        """正向执行/重做删除命令。"""
        # 幸存来源的出链复位为“删除后”状态（首次执行与重做都成立）。
        for source, refs in command.surviving_refs_after.items():
            self._nodes[source].references = list(refs)
        self._detach(command.root_id)
        for snapshot in command.detached_nodes:
            del self._nodes[snapshot.id]

    def _restore_delete(self, command: DeleteCommand) -> None:
        """撤销删除：完整恢复子树、父子边与被清理的引用。"""
        for snapshot in command.detached_nodes:
            if snapshot.id in self._nodes:  # pragma: no cover - 历史线性保证
                raise AssertionError(f"恢复删除时节点已存在: {snapshot.id!r}")
            self._nodes[snapshot.id] = _Node(
                id=snapshot.id,
                parent=snapshot.parent,
                children=list(snapshot.children),
                references=list(snapshot.references),
            )
        # 重新挂回根边（子树内部边已随快照恢复）。
        root = self._nodes[command.root_id]
        root.parent = None  # _attach 前满足“已摘下”前置条件。
        self._attach(command.root_id, command.old_parent, command.old_index)
        # 级联清理掉的引用精确放回。
        for source, refs in command.surviving_refs.items():
            self._nodes[source].references = list(refs)

    def set_dangling_policy(
        self, policy: Union[DanglingPolicy, str]
    ) -> SetPolicyCommand:
        """切换悬空引用策略。

        从 ``KEEP_DANGLING`` 切到 ``CASCADE`` 时，现存悬空引用会被立即
        清理（可整体撤销恢复）；反向切换不改动任何引用。新旧策略相同
        时为空操作，不入历史。

        :returns: 入栈的历史命令；空操作时返回一个尚未入栈的等价命令。
        :raises PolicyError: 策略取值非法。
        """
        new_policy = self._coerce_policy(policy)
        if new_policy is self._policy:
            return SetPolicyCommand(old_policy=self._policy, new_policy=new_policy)

        purged_before: Dict[str, Tuple[str, ...]] = {}
        purged_after: Dict[str, Tuple[str, ...]] = {}
        if new_policy is DanglingPolicy.CASCADE:
            for source in self._iter_preorder():
                refs = self._nodes[source].references
                alive = [t for t in refs if t in self._nodes]
                if len(alive) != len(refs):
                    purged_before[source] = tuple(refs)
                    purged_after[source] = tuple(alive)

        command = SetPolicyCommand(
            old_policy=self._policy,
            new_policy=new_policy,
            purged_refs=purged_before,
            purged_refs_after=purged_after,
        )
        command.apply(self)
        self._push(command)
        self.check_invariants()
        return command

    def _execute_set_policy(self, command: SetPolicyCommand, forward: bool) -> None:
        """正向/逆向应用策略切换。"""
        if forward:
            self._policy = command.new_policy
            for source, refs in command.purged_refs_after.items():
                self._nodes[source].references = list(refs)
        else:
            for source, refs in command.purged_refs.items():
                self._nodes[source].references = list(refs)
            self._policy = command.old_policy

    # ------------------------------------------------------------------ #
    # 撤销 / 重做
    # ------------------------------------------------------------------ #

    def _push(self, command: Command) -> None:
        """命令入撤销栈并清空重做栈（历史发生分叉）。"""
        self._undo.append(command)
        self._redo.clear()

    def undo(self) -> Command:
        """撤销上一次移动、删除或策略切换。

        :returns: 被撤销的历史命令（可读取其 ``kind`` 等信息）。
        :raises UndoRedoError: 撤销栈为空，状态保持不变。
        """
        if not self._undo:
            raise UndoRedoError("撤销栈为空，没有可撤销的操作")
        command = self._undo.pop()
        command.revert(self)
        self._redo.append(command)
        self.check_invariants()
        return command

    def redo(self) -> Command:
        """重做最近被撤销的变更。

        :returns: 被重做的历史命令。
        :raises UndoRedoError: 重做栈为空，状态保持不变。
        """
        if not self._redo:
            raise UndoRedoError("重做栈为空，没有可重做的操作")
        command = self._redo.pop()
        command.apply(self)
        self._undo.append(command)
        self.check_invariants()
        return command

    # ------------------------------------------------------------------ #
    # 不变量自检
    # ------------------------------------------------------------------ #

    def check_invariants(self) -> None:
        """校验全部结构不变量，破坏时抛出对应异常。

        校验内容：标识可哈希且唯一（由字典保证）、父子双向一致、
        无孤儿节点（除根外必有父且在父子列表中）、无环、单一父节点、
        子节点不重复、引用不自引用/不重复，且 ``CASCADE`` 策略下无悬空引用。
        """
        # 1) 根列表与 parent 字段双向一致。
        root_set = set(self._roots)
        if len(root_set) != len(self._roots):
            raise CycleError("根节点列表中存在重复节点")
        for nid, node in self._nodes.items():
            if node.parent is None:
                if nid not in root_set:
                    raise CycleError(f"节点 {nid!r} 无父节点但不在根列表中（孤儿节点）")
            else:
                if nid in root_set:
                    raise CycleError(f"节点 {nid!r} 同时是根节点又有父节点")
                parent = self._nodes.get(node.parent)
                if parent is None:
                    raise CycleError(f"节点 {nid!r} 的父节点 {node.parent!r} 不存在（孤儿节点）")
                if nid not in parent.children:
                    raise CycleError(
                        f"父子关系不一致：节点 {nid!r} 自称父节点为 {node.parent!r}，"
                        f"但对方的子列表中没有它"
                    )
                if parent.children.count(nid) > 1:
                    raise CycleError(f"节点 {nid!r} 在父节点子列表中出现多次")
        for root in self._roots:
            if root not in self._nodes:
                raise CycleError(f"根列表指向不存在的节点: {root!r}")
            if self._nodes[root].parent is not None:
                raise CycleError(f"根节点 {root!r} 仍记录着父节点")

        # 2) 无环 + 无孤岛：从根前序遍历必须恰好覆盖全部节点一次。
        seen: set = set()
        for nid in self._iter_preorder():
            if nid in seen:
                raise CycleError(f"层级中检测到环，节点 {nid!r} 可从多条路径到达")
            seen.add(nid)
        if seen != set(self._nodes):
            orphans = set(self._nodes) - seen
            raise CycleError(f"存在从根不可达的孤儿节点: {sorted(orphans)}")

        # 3) 子列表合法：子节点存在、不重复。
        for nid, node in self._nodes.items():
            child_set = set(node.children)
            if len(child_set) != len(node.children):
                raise CycleError(f"节点 {nid!r} 的子列表中存在重复子节点")
            for child in node.children:
                child_node = self._nodes.get(child)
                if child_node is None:
                    raise CycleError(f"节点 {nid!r} 的子节点 {child!r} 不存在")
                if child_node.parent != nid:
                    raise CycleError(
                        f"父子关系不一致：{child!r} 出现在 {nid!r} 的子列表中，"
                        f"但其 parent 指向 {child_node.parent!r}"
                    )

        # 4) 引用合法。
        for nid, node in self._nodes.items():
            if len(set(node.references)) != len(node.references):
                raise ReferenceValidationError(f"节点 {nid!r} 存在重复引用")
            for target in node.references:
                if target == nid:
                    raise ReferenceValidationError(f"节点 {nid!r} 自引用")
                if self._policy is DanglingPolicy.CASCADE and target not in self._nodes:
                    raise ReferenceValidationError(
                        f"级联策略下出现悬空引用: {nid!r} -> {target!r}"
                    )
