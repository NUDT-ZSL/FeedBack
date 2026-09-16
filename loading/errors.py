"""异常体系。所有错误都携带可读信息，部分错误精确定位到位置/层。"""


class LoadingError(Exception):
    """所有装载编排相关错误的基类。"""


class ValidationError(LoadingError):
    """货物或车厢配置非法。

    location 用于指出错误位置，例如 "cargo[2].height"、"vehicle V1.blocked[0].y"。
    """

    def __init__(self, message, location=None):
        self.location = location
        if location:
            full = f"{message}（位置: {location}）"
        else:
            full = message
        super().__init__(full)


class PlacementError(LoadingError):
    """所有车厢都无法容纳某个货物。"""


class StackRuleError(LoadingError):
    """堆叠规则被违反。level 为 1 起的超限层号。"""

    def __init__(self, message, level=None):
        self.level = level
        if level is not None:
            full = f"{message}（第 {level} 层超限）"
        else:
            full = message
        super().__init__(full)


class PersistenceError(LoadingError):
    """JSON 文件损坏、字段缺失或载入校验失败。"""
