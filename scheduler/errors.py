"""排班引擎异常定义。"""


class ScheduleError(Exception):
    """排班引擎基础异常。"""


class ValidationError(ScheduleError):
    """数据校验失败（非法输入或导入文件损坏/字段缺失）。"""


class NotFoundError(ScheduleError):
    """引用的实体（门店/班次/员工）不存在。"""
