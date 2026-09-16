"""链路切换编排模块（link_orchestrator）。

公开 API：
    LinkOrchestrator     编排器
    Link / Session / MigrationRecord / ConflictRecord / HealthReport  数据模型
    OrchestratorError 及子类  各类带位置信息的错误
    save_state / load_state / load_state_parts  单文件持久化
"""

from .errors import (
    OrchestratorError,
    ValidationError,
    DuplicateIdError,
    NotFoundError,
    LinkUnavailableError,
    CapacityExceededError,
    MigrationRejectedError,
    ClockRejectedError,
    PersistenceError,
)
from .models import (
    Link,
    Session,
    HealthReport,
    MigrationRecord,
    ConflictRecord,
    EventEnvelope,
)
from .orchestrator import LinkOrchestrator
from .persistence import save_state, load_state, load_state_parts, load_state_into

__all__ = [
    "LinkOrchestrator",
    "Link",
    "Session",
    "HealthReport",
    "MigrationRecord",
    "ConflictRecord",
    "EventEnvelope",
    "OrchestratorError",
    "ValidationError",
    "DuplicateIdError",
    "NotFoundError",
    "LinkUnavailableError",
    "CapacityExceededError",
    "MigrationRejectedError",
    "ClockRejectedError",
    "PersistenceError",
    "save_state",
    "load_state",
    "load_state_parts",
    "load_state_into",
]
