"""规格错误：携带出错位置，便于测试同学定位。"""

from __future__ import annotations


class SpecError(Exception):
    """声明（不变量 / 取值域 / 约束）非法时抛出。

    attributes:
        path: 出错位置，例如 "invariant[余额非负]" 或 "object[order].field[amount].domain"。
        reason: 人类可读的原因说明。
    """

    def __init__(self, path: str, reason: str):
        self.path = path
        self.reason = reason
        super().__init__(f"{path}: {reason}")
