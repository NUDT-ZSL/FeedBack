"""subalign 的异常层次。

所有异常的 ``message`` 均为中文可读信息；涉及具体位置的校验错误会在
消息中给出索引/标识，结构化位置由异常上的属性携带。
"""

from __future__ import annotations

from typing import Any, List, Optional, Tuple


class SubalignError(Exception):
    """本包所有异常的基类。"""


class ValidationError(SubalignError):
    """配置/数据非法（标识冲突、时刻不单调、参数不自洽等）。

    :param message: 可读错误信息。
    :param location: 可选的结构化位置，形如 ``("track", "en", "entry", 3)``。
    """

    def __init__(self, message: str, location: Optional[Tuple[Any, ...]] = None):
        if location:
            message = f"{message}（位置：{'/'.join(str(p) for p in location)}）"
        super().__init__(message)
        self.location: Optional[Tuple[Any, ...]] = location


class AlignmentError(SubalignError):
    """对齐过程无法进行（例如锚点不足、锚点间隔全相等导致速率不可辨识）。"""


class PersistenceError(SubalignError):
    """导出文件损坏、字段缺失或载入校验失败。

    :param problems: 收集到的全部问题（载入时会一次性校验完再报错）。
    """

    def __init__(self, message: str, problems: Optional[List[str]] = None):
        self.problems: List[str] = list(problems or [])
        if self.problems:
            message = message + "\n  - " + "\n  - ".join(self.problems)
        super().__init__(message)
