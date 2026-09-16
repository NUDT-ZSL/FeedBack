"""reflow —— 离线阅读重排引擎（纯标准库）。"""

from .engine import (
    BLOCK_TYPES,
    AnchorViolation,
    Block,
    BlockView,
    Geometry,
    Manuscript,
    PlacedBlock,
    ReflowEngine,
    ReflowResult,
    column_count,
    column_width,
    measure,
    verify_anchor_layout,
)
from .errors import (
    AnchorError,
    FlowError,
    LayoutError,
    PersistenceError,
    ValidationError,
)

__all__ = [
    "BLOCK_TYPES",
    "Block",
    "BlockView",
    "Geometry",
    "Manuscript",
    "PlacedBlock",
    "ReflowEngine",
    "ReflowResult",
    "column_count",
    "column_width",
    "measure",
    "AnchorError",
    "FlowError",
    "LayoutError",
    "PersistenceError",
    "ValidationError",
]
