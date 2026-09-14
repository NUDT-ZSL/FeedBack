"""树形文档内核的全部异常类型。"""

from __future__ import annotations


class DocumentTreeError(Exception):
    """所有树形文档内核异常的基类。"""


class NodeNotFoundError(DocumentTreeError):
    """引用的节点不存在（悬空节点标识）。"""


class InvalidPositionError(DocumentTreeError):
    """移动时插入位置越界，或参数不合法。"""


class CycleError(DocumentTreeError):
    """操作会在父子层级中制造环（例如把节点移进自己的子树）。"""


class DuplicateIdError(DocumentTreeError):
    """新增/导入的节点标识与既有节点重复。"""


class ReferenceValidationError(DocumentTreeError):
    """引用关系不合法：自引用、重复引用或目标缺失（且策略不允许悬空）。"""


class PolicyError(DocumentTreeError):
    """悬空引用策略取值非法。"""


class UndoRedoError(DocumentTreeError):
    """撤销栈或重做栈为空时仍尝试撤销/重做。"""


class SerializationError(DocumentTreeError):
    """JSON 文件损坏、字段缺失或未通过一致性校验。"""
