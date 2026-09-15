"""台账异常体系。所有业务错误都是 LedgerError 的子类，消息为中文可读文本。"""


class LedgerError(Exception):
    """所有台账业务异常的基类。"""


class ValidationError(LedgerError):
    """输入数据不合法（字段缺失、权重非正、标识重复等）。"""


class NotFoundError(LedgerError):
    """引用的决策 / 依据 / 结果 / 经验不存在。"""


class StateFlowError(LedgerError):
    """决策状态机的非法流转。"""


class ConflictError(LedgerError):
    """数据冲突（例如同一决策下依据标识重复）。"""
