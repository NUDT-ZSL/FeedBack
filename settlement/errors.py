"""异常类型。

所有面向配置/快照的错误都携带 ``path``（出错位置，如 ``coupons[C1].threshold``），
便于调用方定位并向用户报告。
"""
from __future__ import annotations

from typing import Any, Iterable


def format_path(path: str | Iterable[str] | None) -> str:
    """把位置片段渲染成可读字符串。"""
    if path is None:
        return ""
    if isinstance(path, str):
        return path
    out = ""
    for seg in path:
        if seg == "":
            continue
        if isinstance(seg, int) or (isinstance(seg, str) and seg.isdigit()):
            out += f"[{seg}]"
        else:
            out += ("." if out and not out.endswith("[") else "") + seg
    return out


class ConfigError(Exception):
    """配置/数据类错误的基类。"""

    def __init__(self, message: str, path: str | Iterable[str] | None = None):
        self.path = format_path(path)
        if self.path:
            message = f"{self.path}: {message}"
        super().__init__(message)

    @property
    def raw_path(self) -> str:
        return self.path


class ValidationError(ConfigError):
    """新增券/商品行等实时配置不合法。"""


class ConstraintViolation(ConfigError):
    """违反引擎状态约束（重复发放、对无冲突券裁决、引用不存在对象等）。"""


class PersistError(Exception):
    """快照写入/读取失败的基类。"""


class SnapshotFormatError(PersistError):
    """快照内容损坏、字段缺失或不自洽。"""

    def __init__(self, message: str, path: str | Iterable[str] | None = None):
        self.path = format_path(path)
        if self.path:
            message = f"{self.path}: {message}"
        super().__init__(message)


def ensure(condition: Any, message: str, path: str | Iterable[str] | None = None) -> None:
    """条件不满足时抛 :class:`ValidationError`。"""
    if not condition:
        raise ValidationError(message, path)
