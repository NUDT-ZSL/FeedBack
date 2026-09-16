"""异常类型：所有错误都带机器可读 code 与人类可读中文消息。"""


class FlowError(Exception):
    """引擎领域错误基类。"""

    code = "flow_error"

    def __init__(self, message: str, **details):
        super().__init__(message)
        self.message = message
        self.details = details

    def __str__(self) -> str:  # pragma: no cover - 简单转发
        return self.message


class ValidationError(FlowError):
    """稿件 / 块 / 锚点结构非法。"""

    code = "validation_error"

    def __init__(self, message: str, position=None, **details):
        super().__init__(message, position=position, **details)
        self.position = position


class AnchorError(FlowError):
    """锚点引用不存在、未排序在前、成环或互相冲突。"""

    code = "anchor_error"

    def __init__(self, message: str, cycle=None, sequence=None, **details):
        seq = sequence if sequence is not None else (list(cycle) + [cycle[0]] if cycle else None)
        super().__init__(message, sequence=seq, cycle=cycle, **details)
        self.cycle = cycle
        self.sequence = seq


class LayoutError(FlowError):
    """字号 / 视窗参数非法。"""

    code = "layout_error"


class PersistenceError(FlowError):
    """存档损坏、字段缺失或自洽性校验失败。载入失败不得改变既有状态。"""

    code = "persistence_error"
