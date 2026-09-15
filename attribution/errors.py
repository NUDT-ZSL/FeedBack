"""引擎抛出的异常类型。

所有配置 / 快照校验错误都使用 :class:`ValidationError`，它带一个 ``path``
字段（用 JSON 指针风格指出出错位置，例如 ``revisions[2].items[0]``），
满足“非法配置要拒绝并指出位置”的要求。
"""

from typing import Any, Optional


class AttributionError(Exception):
    """归因引擎领域错误的基类。"""


class ValidationError(AttributionError):
    """非法配置 / 损坏快照。

    :param message: 人类可读的错误说明。
    :param path:    出错位置（JSON 指针风格），可能为 ``None``。
    :param conflict: 可选的冲突详情载荷（如观测值冲突），任意对象。
    """

    def __init__(self, message: str, path: Optional[str] = None,
                 conflict: Any = None):
        self.message = message
        self.path = path
        self.conflict = conflict
        if path:
            full = f"{path}: {message}"
        else:
            full = message
        super().__init__(full)

    def at(self, path: str) -> "ValidationError":
        """返回一个补上（或替换）位置的新异常，便于在嵌套校验中传递。"""
        return ValidationError(self.message, path, self.conflict)


class ConsistencyError(AttributionError):
    """内部不变量 / 守恒关系被破坏（正常使用下不应出现）。"""


def require(condition: Any, message: str, path: Optional[str] = None) -> None:
    """条件不成立时抛出 :class:`ValidationError`。"""
    if not condition:
        raise ValidationError(message, path)
