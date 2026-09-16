"""结算求解与解释引擎（离线可验收）。

公开 API：

- :class:`SettlementEngine`  引擎入口：维护品类/订单行/券发放、求解、解释、增删券增量重算、快照存取
- :class:`CouponSpec`        券参数（适用品类、门槛、额度、互斥组、优先级）
- :class:`Issue`             一次发放（来源 + 版次 + 参数）
- :class:`ConflictRecord`    同一逻辑券多来源参数矛盾的可读冲突记录
- :class:`OrderLine` / :class:`Category`
- :class:`SolveResult`       求解结果（选中券及其逐行抵扣、未选候选、摘要、指纹）
- :class:`Application`       一张被选中券的逐行抵扣方案
- :func:`solve`              对一组券与订单行直接求解（纯函数）
- :func:`explain`            为求解结果生成结构化 + 中文文本解释
- :func:`dump_snapshot` / :func:`load_snapshot`  快照持久化
"""
from __future__ import annotations

from .errors import (
    ConfigError,
    ConstraintViolation,
    PersistError,
    SnapshotFormatError,
    ValidationError,
)
from .models import (
    NEUTRAL_PRIORITY,
    NEUTRAL_SOURCE,
    NEUTRAL_VERSION,
    Application,
    Category,
    ComponentSnapshot,
    ConflictRecord,
    CouponSpec,
    CouponStatus,
    Issue,
    OrderLine,
    SolveResult,
)
from .solver import solve
from .engine import SettlementEngine
from .persistence import dump_snapshot, load_snapshot
from .explain import explain, render_text

__all__ = [
    "SettlementEngine",
    "CouponSpec",
    "Issue",
    "OrderLine",
    "Category",
    "ConflictRecord",
    "Application",
    "ComponentSnapshot",
    "CouponStatus",
    "SolveResult",
    "solve",
    "explain",
    "render_text",
    "dump_snapshot",
    "load_snapshot",
    "NEUTRAL_SOURCE",
    "NEUTRAL_VERSION",
    "NEUTRAL_PRIORITY",
    "ValidationError",
    "ConfigError",
    "ConstraintViolation",
    "PersistError",
    "SnapshotFormatError",
]
