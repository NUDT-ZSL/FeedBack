"""内核的全部异常类型。

所有异常都带人类可读的中文说明，涉及集合中某个位置的错误（批量
增删行、筛选条件、排序键）都会带 ``index`` 字段，方便上游定位。
"""

from __future__ import annotations


class KernelError(Exception):
    """内核异常基类。"""


class ValidationError(KernelError):
    """输入数据不合法（字段类型、重复标识等）。

    ``index`` 为出错元素在输入集合中的下标（从 0 开始）；
    ``path`` 为出错元素内部的字段路径；不适用时为 ``None``。
    """

    def __init__(self, message: str, *, index: int | None = None,
                 path: str | None = None):
        self.index = index
        self.path = path
        prefix_parts = []
        if index is not None:
            prefix_parts.append(f"第 {index} 项")
        if path is not None:
            prefix_parts.append(f"字段 '{path}'")
        prefix = "".join(f"（{p}）" for p in prefix_parts)
        super().__init__(f"{prefix}{message}")


class BatchValidationError(KernelError):
    """批量操作中存在多个错误时一次性抛出，保证整批原子拒绝。"""

    def __init__(self, message: str, errors: list[ValidationError]):
        self.errors = errors
        detail = "; ".join(str(e) for e in errors)
        super().__init__(f"{message}（共 {len(errors)} 处）: {detail}")


class UnknownRowError(KernelError):
    """引用了不存在的行标识。"""

    def __init__(self, row_id: str):
        self.row_id = row_id
        super().__init__(f"行标识不存在: {row_id!r}")


class DuplicateRowError(KernelError):
    """行标识与已有行或同批数据重复。"""

    def __init__(self, row_id: str):
        self.row_id = row_id
        super().__init__(f"行标识重复: {row_id!r}")


class WindowError(KernelError):
    """窗口越界、尺寸为零等非法窗口操作。"""


class RuleError(KernelError):
    """排序规则或筛选条件非法（字段不存在、操作符不支持、值类型错）。"""


class SerializationError(KernelError):
    """导出快照损坏或字段缺失、类型不自洽；载入失败时原状态保持不变。"""


__all__ = [
    "KernelError",
    "ValidationError",
    "BatchValidationError",
    "UnknownRowError",
    "DuplicateRowError",
    "WindowError",
    "RuleError",
    "SerializationError",
]
