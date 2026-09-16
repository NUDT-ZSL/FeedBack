"""离线年度资金分配引擎。

公开入口：
    model       -- 数据模型（Project / AllocationPlan）
    errors      -- 带位置信息的错误类型
    Registry    -- 项目与依赖的注册表（含无环校验）
    Solver      -- 可复现的分配求解器
    Engine      -- 全量/增量重算与查询
    persistence -- 文件保存 / 载入（原子写、失败状态不变）
"""

from .errors import (
    AllocationError,
    ValidationError,
    DependencyError,
    PlanError,
    PersistenceError,
)
from .models import Project, AllocationPlan, MONEY_QUANT, money
from .registry import Registry
from .solver import Solver, SolveRequest
from .engine import Engine
from . import persistence

__all__ = [
    "AllocationError",
    "ValidationError",
    "DependencyError",
    "PlanError",
    "PersistenceError",
    "Project",
    "AllocationPlan",
    "MONEY_QUANT",
    "money",
    "Registry",
    "Solver",
    "SolveRequest",
    "Engine",
    "persistence",
]
