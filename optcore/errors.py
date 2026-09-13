"""内核中使用的异常类型。"""


class OptCoreError(Exception):
    """所有 optcore 异常的基类。"""


class InvalidInputError(OptCoreError):
    """输入数据不合法（字段缺失、取值非法、引用不存在等）。"""


class PersistenceError(OptCoreError):
    """快照文件损坏、格式不符或版本不受支持。"""
