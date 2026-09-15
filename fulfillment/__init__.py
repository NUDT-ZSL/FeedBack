"""供应链履约协同模块（纯标准库，可离线运行）。

对外暴露：
    FulfillmentSystem —— 需求拆分、节点承接、依赖推进、改派、查询、持久化
    Demand / Batch / Node —— 数据模型与状态常量
    异常体系 —— FulfillmentError 及其子类
"""

from .errors import (
    CapacityError,
    FulfillmentError,
    NotFoundError,
    PersistenceError,
    StateError,
    ValidationError,
)
from .models import (
    STATUS_COMPLETED,
    STATUS_IN_PROGRESS,
    STATUS_PENDING,
    STATUS_READY,
    STATUSES,
    Batch,
    Demand,
    Node,
)
from .system import FulfillmentSystem

__all__ = [
    "FulfillmentSystem",
    "Demand",
    "Batch",
    "Node",
    "STATUS_PENDING",
    "STATUS_READY",
    "STATUS_IN_PROGRESS",
    "STATUS_COMPLETED",
    "STATUSES",
    "FulfillmentError",
    "ValidationError",
    "NotFoundError",
    "CapacityError",
    "StateError",
    "PersistenceError",
]
