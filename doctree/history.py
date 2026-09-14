"""撤销/重做历史命令。

每条命令同时知道如何“正向应用”和“逆向还原”，并且可序列化为 JSON，
使撤销/重做历史能够随文档一起落盘、重新载入后继续工作。

命令本身只承载数据，所有结构性变异原语（``_detach`` / ``_attach`` /
子树快照恢复等）都定义在 :class:`doctree.tree.DocumentTree` 上，
以保证不变量校验只在一个地方实现。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

from .model import DanglingPolicy, Node

if TYPE_CHECKING:  # 仅类型检查期导入，避免循环导入。
    from .tree import DocumentTree


class Command(ABC):
    """历史命令的抽象基类。"""

    kind: str = "command"

    @abstractmethod
    def apply(self, tree: "DocumentTree") -> str:
        """正向应用命令，返回受影响的主节点标识。"""

    @abstractmethod
    def revert(self, tree: "DocumentTree") -> str:
        """逆向还原命令，返回受影响的主节点标识。"""

    @abstractmethod
    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的普通字典。"""

    @staticmethod
    def from_dict(data: Dict[str, Any]) -> "Command":
        """根据 ``to_dict`` 产生的字典重建命令。

        :raises SerializationError: ``kind`` 未知或字段缺失。
        """
        from .errors import SerializationError

        kind = data.get("kind")
        if kind == "move":
            return MoveCommand(
                node_id=data["node_id"],
                old_parent=data["old_parent"],
                old_index=data["old_index"],
                new_parent=data["new_parent"],
                new_index=data["new_index"],
            )
        if kind == "delete":
            nodes: List[Node] = []
            for raw in data["detached_nodes"]:
                nodes.append(
                    Node(
                        id=raw["id"],
                        parent=raw["parent"],
                        children=tuple(raw["children"]),
                        references=tuple(raw["references"]),
                    )
                )
            surviving = {
                src: tuple(tgts) for src, tgts in data["surviving_refs"].items()
            }
            surviving_after = {
                src: tuple(tgts)
                for src, tgts in data["surviving_refs_after"].items()
            }
            return DeleteCommand(
                root_id=data["root_id"],
                old_parent=data["old_parent"],
                old_index=data["old_index"],
                detached_nodes=tuple(nodes),
                policy=DanglingPolicy(data["policy"]),
                surviving_refs=surviving,
                surviving_refs_after=surviving_after,
            )
        if kind == "set_policy":
            return SetPolicyCommand(
                old_policy=DanglingPolicy(data["old_policy"]),
                new_policy=DanglingPolicy(data["new_policy"]),
                purged_refs={
                    src: tuple(tgts) for src, tgts in data.get("purged_refs", {}).items()
                },
                purged_refs_after={
                    src: tuple(tgts)
                    for src, tgts in data.get("purged_refs_after", {}).items()
                },
            )
        if kind == "add_node":
            return AddNodeCommand(
                node_id=data["node_id"],
                parent=data["parent"],
                index=data["index"],
            )
        if kind == "reference":
            return ReferenceCommand(
                source=data["source"],
                target=data["target"],
                adding=data["adding"],
                index=data.get("index", -1),
            )
        raise SerializationError(f"未知的历史命令类型: {kind!r}")


class MoveCommand(Command):
    """把节点从旧父节点的指定位置移到新父节点的指定位置。

    下标语义：``old_index`` 是摘下前在旧父节点子列表中的位置；
    ``new_index`` 是**摘下后**在新父节点当前子列表中的插入位置，
    因此正向/逆向都可精确复现，不受同父节点重排的歧义影响。
    """

    kind = "move"

    def __init__(
        self,
        node_id: str,
        old_parent: Optional[str],
        old_index: int,
        new_parent: Optional[str],
        new_index: int,
    ) -> None:
        self.node_id = node_id
        self.old_parent = old_parent
        self.old_index = old_index
        self.new_parent = new_parent
        self.new_index = new_index

    def apply(self, tree: "DocumentTree") -> str:
        tree._detach(self.node_id)
        tree._attach(self.node_id, self.new_parent, self.new_index)
        return self.node_id

    def revert(self, tree: "DocumentTree") -> str:
        tree._detach(self.node_id)
        tree._attach(self.node_id, self.old_parent, self.old_index)
        return self.node_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "node_id": self.node_id,
            "old_parent": self.old_parent,
            "old_index": self.old_index,
            "new_parent": self.new_parent,
            "new_index": self.new_index,
        }


class DeleteCommand(Command):
    """删除一棵以 ``root_id`` 为根的子树，并按策略处理引用。

    :param detached_nodes: 被删子树全部节点删除前的快照（前序）。
    :param surviving_refs: 级联策略下，幸存来源节点删除前的完整出链列表
        （仅记录至少损失了一条出链的来源），用于精确撤销。
    :param surviving_refs_after: 同样节点在删除后的出链列表，用于重做。
    """

    kind = "delete"

    def __init__(
        self,
        root_id: str,
        old_parent: Optional[str],
        old_index: int,
        detached_nodes: Tuple[Node, ...],
        policy: DanglingPolicy,
        surviving_refs: Dict[str, Tuple[str, ...]],
        surviving_refs_after: Dict[str, Tuple[str, ...]],
    ) -> None:
        self.root_id = root_id
        self.old_parent = old_parent
        self.old_index = old_index
        self.detached_nodes = detached_nodes
        self.policy = policy
        self.surviving_refs = surviving_refs
        self.surviving_refs_after = surviving_refs_after

    def apply(self, tree: "DocumentTree") -> str:
        tree._execute_delete(self)
        return self.root_id

    def revert(self, tree: "DocumentTree") -> str:
        tree._restore_delete(self)
        return self.root_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "root_id": self.root_id,
            "old_parent": self.old_parent,
            "old_index": self.old_index,
            "policy": self.policy.value,
            "detached_nodes": [
                {
                    "id": n.id,
                    "parent": n.parent,
                    "children": list(n.children),
                    "references": list(n.references),
                }
                for n in self.detached_nodes
            ],
            "surviving_refs": {s: list(t) for s, t in self.surviving_refs.items()},
            "surviving_refs_after": {
                s: list(t) for s, t in self.surviving_refs_after.items()
            },
        }


class SetPolicyCommand(Command):
    """切换悬空引用策略。

    切换到 ``CASCADE`` 时会顺带清除现存悬空引用，清除前后的出链列表
    一并记录，保证撤销可把这些悬空引用精确放回原位。
    """

    kind = "set_policy"

    def __init__(
        self,
        old_policy: DanglingPolicy,
        new_policy: DanglingPolicy,
        purged_refs: Optional[Dict[str, Tuple[str, ...]]] = None,
        purged_refs_after: Optional[Dict[str, Tuple[str, ...]]] = None,
    ) -> None:
        self.old_policy = old_policy
        self.new_policy = new_policy
        self.purged_refs = purged_refs or {}
        self.purged_refs_after = purged_refs_after or {}

    def apply(self, tree: "DocumentTree") -> str:
        tree._execute_set_policy(self, forward=True)
        return ""

    def revert(self, tree: "DocumentTree") -> str:
        tree._execute_set_policy(self, forward=False)
        return ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "old_policy": self.old_policy.value,
            "new_policy": self.new_policy.value,
            "purged_refs": {s: list(t) for s, t in self.purged_refs.items()},
            "purged_refs_after": {
                s: list(t) for s, t in self.purged_refs_after.items()
            },
        }


class AddNodeCommand(Command):
    """新建一个叶子节点并挂到指定父节点的指定位置。

    撤销时直接摘除该节点；线性撤销顺序保证它被撤销时已没有子节点
    （后续挂到它下面的移动都会先于它被撤销）。
    """

    kind = "add_node"

    def __init__(self, node_id: str, parent: Optional[str], index: int) -> None:
        self.node_id = node_id
        self.parent = parent
        self.index = index

    def apply(self, tree: "DocumentTree") -> str:
        tree._execute_add_node(self)
        return self.node_id

    def revert(self, tree: "DocumentTree") -> str:
        tree._revert_add_node(self)
        return self.node_id

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "node_id": self.node_id,
            "parent": self.parent,
            "index": self.index,
        }


class ReferenceCommand(Command):
    """增加或删除一条引用。

    :param adding: ``True`` 表示建立引用，``False`` 表示删除引用；
        撤销时执行相反动作。
    :param index: 被操作引用在来源出链列表中的位置；新增时记录插入位，
        删除时记录原位置以便撤销精确插回；``-1`` 表示末尾追加。
    """

    kind = "reference"

    def __init__(self, source: str, target: str, adding: bool, index: int = -1) -> None:
        self.source = source
        self.target = target
        self.adding = adding
        self.index = index

    def apply(self, tree: "DocumentTree") -> str:
        tree._execute_reference_change(self, self.adding)
        return self.source

    def revert(self, tree: "DocumentTree") -> str:
        tree._execute_reference_change(self, not self.adding)
        return self.source

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kind": self.kind,
            "source": self.source,
            "target": self.target,
            "adding": self.adding,
            "index": self.index,
        }
