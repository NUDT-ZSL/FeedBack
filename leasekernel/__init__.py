"""leasekernel: 带时限租约调度内核。

在多个逻辑节点之间为命名资源发放带时限的租约，保证同一资源同一时刻
最多只有一个持有者。所有时间判断基于可注入的逻辑时钟，并通过最大时钟
偏差上界在安全（拒绝优先）与可用之间取得平衡。

公开模块：
    clock  -- 可注入的逻辑时钟
    kernel -- 租约内核、状态枚举、事件日志与 JSON 持久化
    cli    -- 基于标准输入 JSON 行的命令行入口
"""

from .clock import ManualClock
from .kernel import (
    Lease,
    LeaseEvent,
    LeaseKernel,
    LeaseState,
    ResourceStatus,
    PersistenceError,
    ValidationError,
)

__all__ = [
    "ManualClock",
    "Lease",
    "LeaseEvent",
    "LeaseKernel",
    "LeaseState",
    "ResourceStatus",
    "PersistenceError",
    "ValidationError",
]

__version__ = "1.0.0"
