"""引擎抛出的错误类型。

所有校验类错误都携带 location（出错位置，如 "register_group(group_id='g1')"）
与 field（出错字段），满足"拒绝并指出位置"的验收要求。
"""

from __future__ import annotations

from typing import Optional


class EngineError(Exception):
    """引擎所有错误的基类。"""


class ValidationError(EngineError):
    """输入校验失败。message 中说明原因，field/location 指出位置。"""

    def __init__(
        self,
        message: str,
        *,
        field: Optional[str] = None,
        location: Optional[str] = None,
    ) -> None:
        self.field = field
        self.location = location
        parts = []
        if location:
            parts.append(f"位置 {location}")
        if field:
            parts.append(f"字段 {field}")
        suffix = f"（{', '.join(parts)}）" if parts else ""
        super().__init__(f"{message}{suffix}")


class DuplicateGroupError(EngineError):
    """分组标识重复。"""

    def __init__(self, group_id: str, location: str) -> None:
        self.group_id = group_id
        self.location = location
        super().__init__(
            f"分组标识重复: {group_id!r} 已登记（位置 {location}）"
        )


class UnknownDomainError(EngineError):
    """所属域未登记。"""

    def __init__(self, domain_id: str, location: str) -> None:
        self.domain_id = domain_id
        self.location = location
        super().__init__(
            f"域未登记: {domain_id!r} 尚未注册（位置 {location}）"
        )


class UnknownGroupError(EngineError):
    """分组未登记。"""

    def __init__(self, group_id: str, location: str) -> None:
        self.group_id = group_id
        self.location = location
        super().__init__(
            f"分组未登记: {group_id!r}（位置 {location}）"
        )


class UnknownEventError(EngineError):
    """事件标识不存在。"""

    def __init__(self, event_id: str, location: str) -> None:
        self.event_id = event_id
        self.location = location
        super().__init__(
            f"事件不存在: {event_id!r}（位置 {location}）"
        )
