"""改版体验归因引擎（纯标准库、可离线运行）。

模块划分：
- errors:  带字段位置的校验异常
- clock:   可注入的逻辑时钟
- records: 改版 / 分群等不可变记录
- engine:  注册、观测、冲突台账、归因分解与来源链
- store:   JSON 快照持久化与载入校验
"""

from .clock import LogicalClock
from .engine import (
    AttributionEngine,
    AttributionReport,
    AssignmentConflict,
    ChainSegment,
    DuplicateObservation,
    ItemRevisionAttribution,
    ItemSourceChain,
    SegmentAttribution,
)
from .errors import AttributionError, ConsistencyError, ValidationError
from .records import Revision, Segment
from . import store

__all__ = [
    "LogicalClock",
    "AttributionEngine",
    "AttributionReport",
    "AssignmentConflict",
    "ChainSegment",
    "DuplicateObservation",
    "ItemRevisionAttribution",
    "ItemSourceChain",
    "SegmentAttribution",
    "AttributionError",
    "ConsistencyError",
    "ValidationError",
    "Revision",
    "Segment",
    "store",
]

__version__ = "1.0.0"
