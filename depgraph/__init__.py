"""增量式依赖图引擎。

对外导出 :class:`DependencyGraph` 以及一组异常类型。
"""

from .engine import (
    CycleError,
    DependencyGraph,
    DepGraphError,
    DuplicateNodeError,
    InvalidNodeError,
    NodeNotFoundError,
    SnapshotError,
)

__all__ = [
    "DependencyGraph",
    "DepGraphError",
    "NodeNotFoundError",
    "DuplicateNodeError",
    "InvalidNodeError",
    "CycleError",
    "SnapshotError",
]

__version__ = "1.0.0"
