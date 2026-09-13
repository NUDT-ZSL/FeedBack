"""节点数据模型与操作结果类型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set


@dataclass
class Node:
    """文档树中的一个节点。

    不变量（由 :class:`~doctree.tree.DocumentTree` 维护）：

    - ``node_id`` 为非空字符串且全局唯一；
    - 根节点 ``parent_id is None``，其余节点 ``parent_id`` 指向存在的节点；
    - ``parent_id`` 与父节点 ``children`` 双向一致；
    - ``children`` 为有序列表，顺序即展示顺序；
    - ``kind`` 为非空字符串；
    - ``refs`` 为集合：不含自身、不重复、（按悬空策略）指向存在的节点。

    使用 ``dataclass`` 而非普通 dict，是为了让字段名与类型在静态检查和
    序列化时保持单一事实来源。
    """

    node_id: str
    parent_id: Optional[str]
    kind: str
    content: str = ""
    children: List[str] = field(default_factory=list)
    refs: Set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if not isinstance(self.node_id, str) or not self.node_id:
            raise ValueError("node_id must be a non-empty string")
        if not isinstance(self.kind, str) or not self.kind:
            raise ValueError("kind must be a non-empty string")
        if self.parent_id is not None and not isinstance(self.parent_id, str):
            raise ValueError("parent_id must be a str or None")
        if not isinstance(self.content, str):
            raise ValueError("content must be a string")
        self.children = list(self.children)
        self.refs = set(self.refs)
        if self.node_id in self.refs:
            raise ValueError(f"node {self.node_id!r} cannot reference itself")

    # -- 序列化 -----------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """转为可 JSON 化的普通 dict；``refs`` 排序输出以保证稳定。"""
        return {
            "node_id": self.node_id,
            "parent_id": self.parent_id,
            "kind": self.kind,
            "content": self.content,
            "children": list(self.children),
            "refs": sorted(self.refs),
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Node":
        """从 dict 构造节点；字段缺失或类型错误时抛 :class:`ValueError`。"""
        if not isinstance(data, dict):
            raise ValueError("node must be a JSON object")
        required = ("node_id", "parent_id", "kind")
        missing = [k for k in required if k not in data]
        if missing:
            raise ValueError(f"node {data.get('node_id', '?')!r} missing fields: {missing}")
        raw_refs = data.get("refs", [])
        if not isinstance(raw_refs, (list, set, tuple)):
            raise ValueError(f"node {data.get('node_id', '?')!r}: refs must be a list")
        raw_children = data.get("children", [])
        if not isinstance(raw_children, (list, set, tuple)):
            raise ValueError(f"node {data.get('node_id', '?')!r}: children must be a list")
        if len(list(raw_refs)) != len(set(raw_refs)):
            raise ValueError(f"node {data.get('node_id', '?')!r}: refs contain duplicates")
        try:
            return cls(
                node_id=data["node_id"],
                parent_id=data["parent_id"],
                kind=data["kind"],
                content=data.get("content", ""),
                children=list(raw_children),
                refs=set(raw_refs),
            )
        except ValueError:
            raise


@dataclass
class MoveResult:
    """``move`` 成功时的结果。

    属性：
        moved_ids: 被移动子树的所有 node_id，按**前序**排列（含被移动节点自身）。
        old_path:  移动前从根到被移动节点的 node_id 列表。
        new_path:  移动后从根到被移动节点的 node_id 列表。
        affected_refs: 受本次移动影响的引用。子树整体移动不会改变 refs 的
            指向关系，因此这里只列出“悬空状态可能被关注”的边界引用——
            即一端在被移动子树内、另一端在子树外的引用
            （``[{"owner": ..., "target": ..., "direction": "out"|"in"}]``）。
    """

    moved_ids: List[str]
    old_path: List[str]
    new_path: List[str]
    affected_refs: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """序列化为普通 dict。"""
        return {
            "moved_ids": list(self.moved_ids),
            "old_path": list(self.old_path),
            "new_path": list(self.new_path),
            "affected_refs": list(self.affected_refs),
        }
