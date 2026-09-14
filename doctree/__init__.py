"""离线优先树形文档编辑器内核。

公开子模块：

* :mod:`doctree.errors` —— 全部异常类型。
* :mod:`doctree.model` —— 数据模型（节点、引用视图、移动/删除结果、策略枚举）。
* :mod:`doctree.history` —— 撤销/重做命令（移动、删除、策略切换、新增、引用）。
* :mod:`doctree.tree` —— :class:`~doctree.tree.DocumentTree` 主内核。
* :mod:`doctree.persistence` —— JSON 持久化与载入校验。

仅依赖 Python 标准库，可完全离线运行与测试。
"""

from __future__ import annotations

from .errors import (
    DocumentTreeError,
    NodeNotFoundError,
    InvalidPositionError,
    CycleError,
    DuplicateIdError,
    ReferenceValidationError,
    PolicyError,
    UndoRedoError,
    SerializationError,
)
from .model import (
    DanglingPolicy,
    Node,
    ReferenceView,
    AffectedReference,
    MoveResult,
    DeleteResult,
    CONFIG_VERSION,
)
from .history import (
    Command,
    MoveCommand,
    DeleteCommand,
    SetPolicyCommand,
    AddNodeCommand,
    ReferenceCommand,
)
from .tree import DocumentTree
from .persistence import save_to_file, load_from_file, load_into, dumps, loads

__all__ = [
    "DocumentTree",
    "Node",
    "DanglingPolicy",
    "ReferenceView",
    "AffectedReference",
    "MoveResult",
    "DeleteResult",
    "CONFIG_VERSION",
    "Command",
    "MoveCommand",
    "DeleteCommand",
    "SetPolicyCommand",
    "AddNodeCommand",
    "ReferenceCommand",
    "DocumentTreeError",
    "NodeNotFoundError",
    "InvalidPositionError",
    "CycleError",
    "DuplicateIdError",
    "ReferenceValidationError",
    "PolicyError",
    "UndoRedoError",
    "SerializationError",
    "save_to_file",
    "load_from_file",
    "load_into",
    "dumps",
    "loads",
]
