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

    :attr:`change_index` 为 0 基的变更下标（跨全文件计数），
    :attr:`change_no` 为 1 基“第几条变更”；:attr:`line_no` 为文件行号；
    :attr:`op` / :attr:`node_id` 为出错记录涉及的操作与节点（若可知）。
    """

    code = "invalid_change"

    def __init__(
        self,
        message: str,
        change_index: Optional[int] = None,
        *,
        change_no: Optional[int] = None,
        line_no: Optional[int] = None,
        op: Optional[str] = None,
        node_id: Optional[str] = None,
    ) -> None:
        if change_index is not None:
            no = change_no if change_no is not None else change_index + 1
            location = f"change #{no} (index {change_index})"
            if line_no is not None:
                location += f" at line {line_no}"
            message = f"{location}: {message}"
        elif line_no is not None:
            message = f"line {line_no}: {message}"
        details = []
        if op is not None:
            details.append(f"op={op!r}")
        if node_id is not None:
            details.append(f"node_id={node_id!r}")
        if details:
            message = f"{message} [{', '.join(details)}]"
        super().__init__(message)
        self.change_index = change_index
        self.change_no = change_no if change_index is None else (change_no or change_index + 1)
        self.line_no = line_no
        self.op = op
        self.node_id = node_id

    def to_dict(self) -> dict:
        """序列化为 ``{"error", "code", ...}``，错误定位字段全部带上。"""
        data = super().to_dict()
        if self.change_no is not None:
            data["change_no"] = self.change_no
        if self.change_index is not None:
            data["change_index"] = self.change_index
        if self.line_no is not None:
            data["line_no"] = self.line_no
        if self.op is not None:
            data["op"] = self.op
        if self.node_id is not None:
            data["node_id"] = self.node_id
        return data


class VersionNotFoundError(DocumentTreeError):
    """回滚 / diff 时指定的版本号不存在。"""

    code = "version_not_found"

    def __init__(self, version: int) -> None:
        super().__init__(f"version not found: {version}")
        self.version = version
