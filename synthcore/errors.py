"""合成系统内核的异常类型。"""


class SynthError(Exception):
    """所有合成系统错误的基类。"""


class ValidationError(SynthError):
    """输入数据非法(数量非正整数、标识为空/重复、引用不存在等)。

    消息中总是包含出错位置,例如 ``配方 'r1' inputs[2]: 数量必须为正整数``。
    """


class NotFoundError(SynthError):
    """引用的物品或配方不存在。"""


class CycleError(ValidationError):
    """严格模式载入时发现未消解的配方环。"""
