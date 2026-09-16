"""ThemeOracle —— 设计系统视觉变量与多主题继承编排模块。

仅依赖 Python 标准库，可完全离线运行。

公开入口：
    DesignSystem        编排核心（变量、主题、继承、覆盖、解析、查询）
    Variable            视觉变量定义（唯一标识 / 取值类型 / 默认值）
    Theme               主题
    ValueType           内置取值类型（STRING/INTEGER/NUMBER/BOOLEAN/COLOR/LENGTH）
    ResolvedValue       某主题下某变量的最终取值与来源
    ConflictRecord      继承链上的取值矛盾记录
    errors.*            各类校验异常（均带可定位信息）

典型用法见 ``examples/demo.py``，持久化格式见 ``persistence`` 模块。
"""

from .errors import (
    ThemeOracleError,
    DuplicateVariableError,
    VariableNotFoundError,
    DuplicateThemeError,
    ThemeNotFoundError,
    InvalidValueError,
    ParentThemeNotFoundError,
    InheritanceCycleError,
    SerializationError,
)
from .valuetypes import ValueType, Color, Length
from .model import Variable, Theme, ResolvedValue, ConflictRecord
from .core import DesignSystem
from . import persistence

__all__ = [
    "DesignSystem",
    "Variable",
    "Theme",
    "ValueType",
    "Color",
    "Length",
    "ResolvedValue",
    "ConflictRecord",
    "persistence",
    "ThemeOracleError",
    "DuplicateVariableError",
    "VariableNotFoundError",
    "DuplicateThemeError",
    "ThemeNotFoundError",
    "InvalidValueError",
    "ParentThemeNotFoundError",
    "InheritanceCycleError",
    "SerializationError",
]

__version__ = "1.0.0"
