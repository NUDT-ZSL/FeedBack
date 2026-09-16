"""错误类型。

所有错误都携带可读信息；与“位置”有关的错误（维度定义、用例登记）
额外提供 index / dimension / case_id 等结构化字段，方便定位。
"""
from __future__ import annotations

from typing import Any, Optional


class EnvCompatError(Exception):
    """本模块所有异常的基类。"""


class DefinitionError(EnvCompatError):
    """维度/取值定义非法。

    location 是人类可读的位置，例如 'dimension[1].values[2]'；
    structured 给出机器可读的定位字段。
    """

    def __init__(self, message: str, location: str = "", structured: Optional[dict] = None):
        self.location = location
        self.structured = structured or {}
        full = f"{message} (位置: {location})" if location else message
        super().__init__(full)


class DuplicateCombinationError(EnvCompatError):
    """笛卡尔积中出现重复组合——通常意味着维度值集合本身有重复元素。"""

    def __init__(self, combination: "tuple[str, ...]", reason: str = "", location: str = ""):
        self.combination = combination
        self.location = location
        msg = f"检测到重复的环境组合 {combination!r}"
        if reason:
            msg += f"：{reason}"
        if location:
            msg += f"（位置: {location}）"
        super().__init__(msg)


class DuplicateCaseError(EnvCompatError):
    """用例唯一标识重复登记。"""

    def __init__(self, case_id: str, first_index: int, duplicate_index: int):
        self.case_id = case_id
        self.first_index = first_index
        self.duplicate_index = duplicate_index
        first_pos = "此前批次" if first_index < 0 else f"cases[{first_index}]"
        super().__init__(
            f"用例标识 {case_id!r} 重复：首次登记于 {first_pos}，"
            f"再次出现于 cases[{duplicate_index}]"
        )


class UnknownGroupError(EnvCompatError):
    """用例引用了未登记的分组。"""

    def __init__(self, case_id: str, group: str, case_index: int, known_groups: list[str]):
        self.case_id = case_id
        self.group = group
        self.case_index = case_index
        self.known_groups = list(known_groups)
        known = ", ".join(repr(g) for g in known_groups) or "<空>"
        super().__init__(
            f"用例 {case_id!r}(cases[{case_index}]) 引用了不存在的分组 "
            f"{group!r}；已登记分组: {known}"
        )


class RegistrationError(EnvCompatError):
    """结果上报本身不合法（例如 outcome 无法识别）。"""

    def __init__(self, message: str, *, case_id: str = "", combination: Any = None,
                 source: str = "", location: str = ""):
        self.case_id = case_id
        self.combination = combination
        self.source = source
        self.location = location
        full = message
        if location:
            full += f"（位置: {location}）"
        super().__init__(full)


class UnknownCaseError(RegistrationError):
    """上报的用例标识未登记。"""

    def __init__(self, case_id: str, known: Optional[list[str]] = None):
        self.known = list(known or [])
        super().__init__(f"用例 {case_id!r} 未登记，无法上报结果", case_id=case_id)


class UnknownCombinationError(RegistrationError):
    """上报的环境组合不在矩阵中。"""

    def __init__(self, combination: Any, matrix: Optional[list] = None):
        self.combination = combination
        known = matrix or []
        tail = ""
        if known:
            tail = f"；矩阵共 {len(known)} 个组合"
        super().__init__(
            f"环境组合 {tuple(combination)!r} 不在环境矩阵中，拒绝上报{tail}",
            combination=combination,
        )
