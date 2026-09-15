"""异常体系：所有报错都是清晰、可读的中文消息。"""

from __future__ import annotations


class GraphError(Exception):
    """经验图谱相关错误的基类。"""


class EntryNotFound(GraphError):
    """条目不存在（含引用目标不存在 / 悬空引用）。"""


class EntryExists(GraphError):
    """唯一标识冲突。"""


class ReferenceError(GraphError):
    """非法引用：自引用、重复引用或会成环。"""


class StaleRevision(GraphError):
    """基于过期版本的修订。

    属性 ``behind`` 为落后的版本数（``当前版本 - 基准版本``）。
    """

    def __init__(self, message: str, *, behind: int, current_version: int, base_version: int):
        super().__init__(message)
        self.behind = behind
        self.current_version = current_version
        self.base_version = base_version


class MergeConflict(GraphError):
    """同段互斥修订导致的冲突（默认严格模式抛出，可读记录见异常属性）。"""

    def __init__(self, message: str, *, records: list):
        super().__init__(message)
        self.records = records


class CorruptSnapshot(GraphError):
    """持久化文件损坏、校验和不符或字段缺失。"""
