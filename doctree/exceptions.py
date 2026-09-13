"""内核使用的异常类型。

所有异常都继承自 :class:`DocumentTreeError`，调用方可以用它统一捕获；
:attr:`DocumentTreeError.code` 是稳定的机器可读错误码，CLI 会原样输出。
"""

from __future__ import annotations

from typing import Optional


class DocumentTreeError(Exception):
    """所有内核错误的基类。"""

    #: 机器可读错误码（如 ``"node_not_found"``）。
    code: str = "error"

    def __init__(self, message: str = "", *, code: Optional[str] = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code

    @property
    def message(self) -> str:
        """错误描述文本。"""
        return str(self.args[0]) if self.args else ""

    def to_dict(self) -> dict:
        """序列化为 ``{"error", "code"}`` 形式，供 CLI 输出。"""
        return {"error": self.message, "code": self.code}


class NodeNotFoundError(DocumentTreeError):
    """node_id 不存在。"""

    code = "node_not_found"

    def __init__(self, node_id: str) -> None:
        super().__init__(f"node not found: {node_id!r}")
        self.node_id = node_id


class ValidationError(DocumentTreeError):
    """输入数据或树不变量被破坏（环、孤儿、双向不一致、字段缺失等）。"""

    code = "validation_error"


class DanglingReferenceError(DocumentTreeError):
    """strict 策略下，操作会产生或发现悬空引用。"""

    code = "dangling_reference"

    def __init__(self, message: str, dangling: Optional[list] = None) -> None:
        super().__init__(message)
        #: 悬空引用明细：``[{"owner": node_id, "target": node_id}, ...]``
        self.dangling: list = list(dangling or [])


class InvalidChangeError(DocumentTreeError):
    """重放变更记录时某条变更非法。

    :attr:`change_index` 为 0 基的变更下标，:attr:`change_no` 为记录里的 1 基序号。
    """

    code = "invalid_change"

    def __init__(
        self,
        message: str,
        change_index: Optional[int] = None,
        *,
        change_no: Optional[int] = None,
    ) -> None:
        if change_index is not None:
            no = change_no if change_no is not None else change_index + 1
            message = f"change #{no} (index {change_index}): {message}"
        super().__init__(message)
        self.change_index = change_index
        self.change_no = change_no if change_index is None else (change_no or change_index + 1)


class VersionNotFoundError(DocumentTreeError):
    """回滚 / diff 时指定的版本号不存在。"""

    code = "version_not_found"

    def __init__(self, version: int) -> None:
        super().__init__(f"version not found: {version}")
        self.version = version
