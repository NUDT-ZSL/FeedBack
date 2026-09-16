"""离线装载编排模块（仅使用 Python 标准库）。

公开接口：
    Cargo, Vehicle, Placement, LoadPlan
    LoadingSystem
    ValidationError, PlacementError, StackRuleError, PersistenceError
    save_to_file, load_from_file
"""

from .errors import (
    LoadingError,
    ValidationError,
    PlacementError,
    StackRuleError,
    PersistenceError,
)
from .models import Cargo, Vehicle, Placement, LoadPlan
from .system import LoadingSystem
from .persistence import save_to_file, load_from_file

__all__ = [
    "Cargo",
    "Vehicle",
    "Placement",
    "LoadPlan",
    "LoadingSystem",
    "LoadingError",
    "ValidationError",
    "PlacementError",
    "StackRuleError",
    "PersistenceError",
    "save_to_file",
    "load_from_file",
]
