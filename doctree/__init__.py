"""树形文档编辑器内核。

仅依赖 Python 标准库，可离线运行。子模块：

- :mod:`doctree.exceptions` -- 异常类型
- :mod:`doctree.model`      -- 节点数据模型与移动结果
- :mod:`doctree.tree`       -- 文档树（增删改、跨层拖拽、引用维护、查询）
- :mod:`doctree.persistence`-- 增量保存 / 加载 / 版本回滚
"""

from doctree.exceptions import (
    DanglingReferenceError,
    DocumentTreeError,
    InvalidChangeError,
    NodeNotFoundError,
    ValidationError,
)
from doctree.model import MoveResult, Node
from doctree.persistence import VersionDiff, load
from doctree.tree import (
    POLICY_CASCADE,
    POLICY_LENIENT,
    POLICY_STRICT,
    DocumentTree,
)

__all__ = [
    "DocumentTree",
    "Node",
    "MoveResult",
    "VersionDiff",
    "load",
    "POLICY_CASCADE",
    "POLICY_STRICT",
    "POLICY_LENIENT",
    "DocumentTreeError",
    "NodeNotFoundError",
    "ValidationError",
    "DanglingReferenceError",
    "InvalidChangeError",
]

__version__ = "1.0.0"
