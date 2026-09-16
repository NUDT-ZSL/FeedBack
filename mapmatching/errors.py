"""mapmatching.errors —— 统一的业务异常基类。"""


class MapMatchingError(Exception):
    """本模块所有“业务上应被拒绝”的情况的共同基类。"""
