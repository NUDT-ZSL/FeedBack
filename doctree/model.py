"""树形文档内核的数据模型。

这些类型大多是不可变的值对象，供上层编辑器读取；可变状态只存在于
:class:`doctree.tree.DocumentTree` 内部，避免上层持有过期数据。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional, Tuple

CONFIG_VERSION: int = 1
"""JSON 文件格式版本号。"""


class DanglingPolicy(str, Enum):
    """被引用节点（或其祖先）被删除时，指向它的引用如何处理。"""

    CASCADE = "cascade"
    """级联清理：删除所有指向被删子树的引用，并记录被清理项。"""

    KEEP_DANGLING = "keep_dangling"
    """保留悬空引用：引用留在源节点上，但被标记为悬空（目标已不存在）。"""


@dataclass(frozen=True)
class Node:
    """文档树节点的只读视图。

    :param id: 全局唯一节点标识。
    :param parent: 父节点标识；根节点为 ``None``。
    :param children: 有序子节点标识元组，顺序即展示顺序。
    :param references: 本节点对外引用的目标节点标识（有序、去重）。
    """

    id: str
    parent: Optional[str]
    children: Tuple[str, ...] = field(default_factory=tuple)
    references: Tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class ReferenceView:
    """单条引用的只读视图。

    :param source: 引用来源节点标识。
    :param target: 引用目标节点标识。
    :param dangling: 目标当前是否已不存在（悬空）。
    """

    source: str
    target: str
    dangling: bool

    def as_tuple(self) -> Tuple[str, str, bool]:
        """返回 ``(来源, 目标, 是否悬空)`` 三元组。"""
        return self.source, self.target, self.dangling


@dataclass(frozen=True)
class AffectedReference:
    """一次移动所影响的引用。

    移动不删除任何节点，因此引用本身不会被清理或变成悬空；
    这里“受影响”指引用的来源或目标位于被移动子树中，其路径发生了变化。

    :param source: 引用来源节点标识。
    :param target: 引用目标节点标识。
    :param source_in_subtree: 来源节点是否在被移动子树内。
    :param target_in_subtree: 目标节点是否在被移动子树内。
    :param source_old_path: 移动前来源节点路径（节点标识元组，含自身）。
    :param source_new_path: 移动后来源节点路径。
    :param target_old_path: 移动前目标节点路径。
    :param target_new_path: 移动后目标节点路径。
    """

    source: str
    target: str
    source_in_subtree: bool
    target_in_subtree: bool
    source_old_path: Tuple[str, ...]
    source_new_path: Tuple[str, ...]
    target_old_path: Tuple[str, ...]
    target_new_path: Tuple[str, ...]


@dataclass(frozen=True)
class MoveResult:
    """一次成功移动的完整报告。

    :param moved_nodes: 被移动子树的全部节点标识（前序，根在前）。
    :param node_id: 被拖动的子树根。
    :param new_parent: 新父节点标识；拖到根层级时为 ``None``。
    :param index: 在新父节点子列表中的插入位置。
    :param old_paths: 每个被移动节点的旧路径（节点标识元组，含自身）。
    :param new_paths: 每个被移动节点的新路径。
    :param affected_references: 受影响引用（稳定排序：先来源后目标）。
    """

    moved_nodes: Tuple[str, ...]
    node_id: str
    new_parent: Optional[str]
    index: int
    old_paths: Dict[str, Tuple[str, ...]]
    new_paths: Dict[str, Tuple[str, ...]]
    affected_references: Tuple[AffectedReference, ...]


@dataclass(frozen=True)
class DeleteResult:
    """一次成功删除的报告。

    :param deleted_nodes: 被删除子树的全部节点标识（前序）。
    :param old_paths: 每个被删节点删除前的路径。
    :param removed_references: 级联策略下被清理的引用，
        每项为 ``(来源, 目标)``；``KEEP_DANGLING`` 策略下为空。
    :param dangling_references: 保留策略下新增的悬空引用，
        每项为 ``(来源, 目标)``；``CASCADE`` 策略下为空。
    """

    deleted_nodes: Tuple[str, ...]
    old_paths: Dict[str, Tuple[str, ...]]
    removed_references: Tuple[Tuple[str, str], ...]
    dangling_references: Tuple[Tuple[str, str], ...]
