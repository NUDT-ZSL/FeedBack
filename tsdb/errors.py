"""引擎层异常类型。"""

from __future__ import annotations


class TSDBError(Exception):
    """所有存储引擎错误的基类。"""


class ValidationError(TSDBError):
    """输入数据不满足模型约束（空 metric、非法 tags、非有限浮点数等）。"""


class BlockFormatError(TSDBError):
    """列块字节流格式非法（魔数/版本错、截断、未知编码等）。"""


class CorruptionError(TSDBError):
    """磁盘快照不一致或已损坏（缺文件、校验失败、元信息自相矛盾等）。"""
