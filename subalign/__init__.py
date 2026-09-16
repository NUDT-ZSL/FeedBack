"""subalign —— 离线多语言字幕时间轴对齐工具包。

对外主要入口：

* :class:`subalign.AlignConfig`  容差/匹配/拟合配置
* :class:`subalign.SubtitleSystem`  基准时间轴 + 候选轨 + 对齐/查询/持久化
* :class:`subalign.AlignmentReport`  对齐结果（参数、锚点、缺失区间、依据）
* :class:`subalign.Conflict`  两条轨之间的矛盾校正记录
"""

from .errors import SubalignError, ValidationError, AlignmentError, PersistenceError
from .model import (
    Entry,
    SubtitleTrack,
    Reference,
    Anchor,
    Segment,
    MissingInterval,
    ToleranceReport,
    SegmentQuery,
    Conflict,
    AlignmentReport,
    AlignConfig,
)
from .persistence import to_json, from_json, from_json_text, to_dict, from_dict
from .system import SubtitleSystem

__all__ = [
    "SubalignError",
    "ValidationError",
    "AlignmentError",
    "PersistenceError",
    "Entry",
    "SubtitleTrack",
    "Reference",
    "Anchor",
    "Segment",
    "MissingInterval",
    "ToleranceReport",
    "SegmentQuery",
    "Conflict",
    "AlignmentReport",
    "AlignConfig",
    "SubtitleSystem",
    "to_json",
    "from_json",
    "from_json_text",
    "to_dict",
    "from_dict",
]

__version__ = "1.0.0"
