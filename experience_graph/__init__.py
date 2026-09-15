"""experience_graph：离线、仅标准库的经验条目可追溯图谱。

公开入口：

* :class:`ExperienceGraph` —— 图谱核心
* :mod:`experience_graph.persistence` —— 单文件保存 / 载入
* 异常类见 :mod:`experience_graph.errors`
"""

from .errors import (
    CorruptSnapshot,
    EntryExists,
    EntryNotFound,
    GraphError,
    MergeConflict,
    ReferenceError,
    StaleRevision,
)
from .graph import (
    ConflictRecord,
    ExperienceGraph,
    Revision,
    Version,
)
from . import merge, persistence

__all__ = [
    "ExperienceGraph",
    "ConflictRecord",
    "Revision",
    "Version",
    "GraphError",
    "EntryNotFound",
    "EntryExists",
    "ReferenceError",
    "StaleRevision",
    "MergeConflict",
    "CorruptSnapshot",
    "merge",
    "persistence",
]
