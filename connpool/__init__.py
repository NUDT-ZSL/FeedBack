"""边缘网关上游连接治理内核：多租户连接池与通道复用。

仅依赖 Python 标准库，不接真实网络，由可注入的逻辑时钟驱动，
可完全离线运行与单元测试。

公开入口：
    PoolKernel        连接池内核
    ManualClock       逻辑时钟
    PoolConfig        池配置
    AcquireResult     借出结果（同步）
    WaitTicket        排队票据
    PoolStats / TenantUsage / ConnectionView  查询视图
    PoolError 及其子类  带原因码的拒绝/校验错误
"""

from .clock import Clock, ManualClock
from .errors import (
    PoolError,
    PoolExistsError,
    PoolNotFoundError,
    InvalidConfigError,
    PoolUnhealthyError,
    PoolSaturatedError,
    TenantQuotaExceededError,
    QueueRejectedError,
    InvalidReleaseError,
    ConnectionNotFoundError,
    SnapshotError,
    Reason,
)
from .model import (
    Connection,
    PoolConfig,
    QueuedRequest,
    AcquireResult,
    WaitTicket,
    PoolStats,
    TenantUsage,
    ConnectionView,
)
from .kernel import PoolKernel
from .snapshot import save_json, load_json

__all__ = [
    "PoolKernel",
    "Clock",
    "ManualClock",
    "PoolConfig",
    "Connection",
    "QueuedRequest",
    "AcquireResult",
    "WaitTicket",
    "PoolStats",
    "TenantUsage",
    "ConnectionView",
    "PoolError",
    "PoolExistsError",
    "PoolNotFoundError",
    "InvalidConfigError",
    "PoolUnhealthyError",
    "PoolSaturatedError",
    "TenantQuotaExceededError",
    "QueueRejectedError",
    "InvalidReleaseError",
    "ConnectionNotFoundError",
    "SnapshotError",
    "Reason",
    "save_json",
    "load_json",
]
