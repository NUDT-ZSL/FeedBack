"""批处理调度器：容量受限、承诺优先的准入控制模块。

只做决策与状态维护，不真正执行任务；由可注入的逻辑时钟驱动，
仅依赖 Python 标准库，可完全离线运行与测试。
"""

from .core import (
    AdmissionResult,
    Resource,
    Scheduler,
    SchedulerError,
    Task,
    REASON_CAPACITY_INSUFFICIENT,
    REASON_DEADLINE_PASSED,
    REASON_DUPLICATE_TASK_ID,
    REASON_RESOURCE_NOT_FOUND,
    STATUS_PENDING,
    STATUS_SCHEDULED,
)
from .persistence import export_state, import_state, state_from_dict, state_to_dict

__all__ = [
    "AdmissionResult",
    "Resource",
    "Scheduler",
    "SchedulerError",
    "Task",
    "REASON_CAPACITY_INSUFFICIENT",
    "REASON_DEADLINE_PASSED",
    "REASON_DUPLICATE_TASK_ID",
    "REASON_RESOURCE_NOT_FOUND",
    "STATUS_PENDING",
    "STATUS_SCHEDULED",
    "export_state",
    "import_state",
    "state_from_dict",
    "state_to_dict",
]
