"""异常层次。所有错误都继承自 :class:`EvoKernelError`，消息始终使用中文。"""

from __future__ import annotations

from typing import Any, List, Optional


class EvoKernelError(Exception):
    """版本内核所有异常的基类。"""


class RuleDefinitionError(EvoKernelError):
    """字段规则或版本定义非法。

    :param location: 规则中的错误位置，例如 ``v3/fields/address/fields/city/type``。
    """

    def __init__(self, message: str, location: Optional[str] = None) -> None:
        self.location = location
        text = f"规则非法（位置: {location}）：{message}" if location else f"规则非法：{message}"
        super().__init__(text)


class VersionError(EvoKernelError):
    """版本登记 / 版本链相关错误（重复、缺父版本、成环等）。"""


class FieldValidationError(EvoKernelError):
    """单个字段的校验错误。"""

    def __init__(
        self,
        path: str,
        expected: str,
        actual: Any,
        reason: str = "类型不匹配",
    ) -> None:
        self.path = path
        self.expected = expected
        self.actual = actual
        self.reason = reason
        actual_repr = repr(actual)
        if len(actual_repr) > 60:
            actual_repr = actual_repr[:57] + "..."
        super().__init__(
            f"字段 '{path}' {reason}：期望 {expected}，实际 {actual_repr}"
        )


class ParseError(EvoKernelError):
    """按版本解析数据失败，包含该数据下的全部字段错误（稳定排序）。"""

    def __init__(self, version_id: str, field_errors: List[FieldValidationError]) -> None:
        self.version_id = version_id
        self.field_errors = list(field_errors)
        detail = "; ".join(str(e) for e in self.field_errors)
        super().__init__(f"按版本 '{version_id}' 解析失败：{detail}")


class MigrationError(EvoKernelError):
    """迁移过程中失败（类型不可收紧、枚举值被删除、必填字段无默认值等）。"""


class BundleError(EvoKernelError):
    """导出包损坏、字段缺失、引用不一致或校验和不匹配。"""
