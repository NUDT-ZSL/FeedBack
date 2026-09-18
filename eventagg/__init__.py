"""离线事件时间聚合引擎。"""

from .clock import Clock, ManualClock
from .engine import EventTimeEngine
from .errors import (
    DuplicateGroupError,
    EngineError,
    UnknownDomainError,
    UnknownEventError,
    UnknownGroupError,
    ValidationError,
)
from .models import (
    ConflictRecord,
    Correction,
    Event,
    IngestResult,
    IngestStatus,
    Snapshot,
    WindowEntryView,
    WindowStats,
)

__all__ = [
    "Clock",
    "ManualClock",
    "EventTimeEngine",
    "EngineError",
    "ValidationError",
    "DuplicateGroupError",
    "UnknownDomainError",
    "UnknownGroupError",
    "UnknownEventError",
    "Event",
    "WindowStats",
    "WindowEntryView",
    "ConflictRecord",
    "Correction",
    "IngestResult",
    "IngestStatus",
    "Snapshot",
]
