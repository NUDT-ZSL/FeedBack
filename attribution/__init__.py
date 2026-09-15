"""改版体验归因引擎（纯标准库、可离线运行）。

模块划分：
- errors:  带字段位置（与可选冲突载荷）的校验异常
- clock:   可注入的逻辑时钟
- records: 改版 / 分群 / 构成纪元等不可变记录
- engine:  注册、观测冲突拒绝、迁移台账、成员来源、归因分解与来源链
- store:   JSON 快照持久化与载入校验
"""

from .clock import LogicalClock
from .engine import (
    AttributionEngine,
    AttributionReport,
    AssignmentConflict,
    ChainSegment,
    ItemRevisionAttribution,
    ItemSourceChain,
    MemberFlow,
    MigrationRecord,
    ObservationConflict,
    SegmentAttribution,
)
from .errors import AttributionError, ConsistencyError, ValidationError
from .records import Epoch, Revision, Segment
from . import store

__all__ = [
    "LogicalClock",
    "AttributionEngine",
    "AttributionReport",
    "AssignmentConflict",
    "ChainSegment",
    "ItemRevisionAttribution",
    "ItemSourceChain",
    "MemberFlow",
    "MigrationRecord",
    "ObservationConflict",
    "SegmentAttribution",
    "AttributionError",
    "ConsistencyError",
    "ValidationError",
    "Epoch",
    "Revision",
    "Segment",
    "store",
]

__version__ = "1.1.0"
