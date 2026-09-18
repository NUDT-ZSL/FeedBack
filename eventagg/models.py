"""对外可见的数据模型。"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


@dataclass(frozen=True)
class Event:
    """一条待聚合事件。

    - event_id: 全局唯一标识（同一标识重复到达按幂等处理）
    - group_id: 所属分组（必须已登记）
    - event_time: 事件时间（不得晚于 arrival_time）
    - arrival_time: 到达时间
    - value: 数值（必须为有限实数）
    - source: 来源标识，用于冲突记录中区分双方
    """

    event_id: str
    group_id: str
    event_time: float
    arrival_time: float
    value: float
    source: str = "default"


@dataclass
class WindowStats:
    """单个窗口的统计值。"""

    window_start: float
    count: int = 0
    late_count: int = 0
    total: float = 0.0
    minimum: float = math.inf
    maximum: float = -math.inf

    @property
    def mean(self) -> Optional[float]:
        return self.total / self.count if self.count else None

    def add(self, value: float, late: bool) -> None:
        self.count += 1
        self.total += value
        self.minimum = min(self.minimum, value)
        self.maximum = max(self.maximum, value)
        if late:
            self.late_count += 1


@dataclass(frozen=True)
class WindowEntryView:
    """窗口内单条事件的明细视图。"""

    event: Event
    late: bool
    lateness_excess: Optional[float]  # 迟到时超出允许范围的量，准时为 None


@dataclass
class ConflictRecord:
    """同一事件被多个来源给出矛盾取值时生成的可读冲突记录。

    双方（或多方）版本都被保留在 versions 中。
    """

    event_id: str
    group_id: str
    detected_at: float
    versions: List[Event]

    def __str__(self) -> str:
        lines = [
            f"冲突: 事件 {self.event_id!r}（分组 {self.group_id!r}）"
            f"存在 {len(self.versions)} 个互相矛盾的版本（检测于 t={self.detected_at}）:"
        ]
        for v in self.versions:
            lines.append(
                f"  来源 {v.source!r}: event_time={v.event_time}, "
                f"value={v.value}, arrival_time={v.arrival_time}"
            )
        return "\n".join(lines)


@dataclass
class Correction:
    """一次对已有结果的修正轨迹记录。

    before/after 为 None 分别表示窗口此前不存在 / 修正后窗口消失。
    """

    group_id: str
    window_start: float
    reason: str  # "late-event" | "conflict-resolution"
    event_id: str
    before: Optional[WindowStats]
    after: Optional[WindowStats]
    lateness_excess: Optional[float]
    recorded_at: float


class IngestStatus(Enum):
    ACCEPTED = "accepted"    # 准时接受
    LATE = "late"            # 迟到但仍计入（并产生修正记录）
    DUPLICATE = "duplicate"  # 幂等去重，未重复计入
    CONFLICT = "conflict"    # 与已有版本矛盾，已保留双方并记录冲突


@dataclass
class IngestResult:
    status: IngestStatus
    event_id: str
    group_id: str
    window_start: Optional[float] = None
    late: bool = False
    lateness_excess: Optional[float] = None
    message: str = ""


@dataclass
class Snapshot:
    """某分组某时刻的整体视图：水位线 + 各窗口统计值。"""

    group_id: str
    watermark: Optional[float]
    windows: Dict[float, WindowStats]
