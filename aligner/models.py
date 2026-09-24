"""数据模型：字幕片段、锚点、媒体信息、证据、矛盾与对齐结果。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Segment:
    """一条字幕片段。时间为素材标注的标称时刻（秒）。"""
    id: str
    start: float
    end: float
    text: str
    source: str = ""                # 来源标记（文件/设备/人工等）
    anchor_id: Optional[str] = None  # 该片段声明应对齐到的锚点


@dataclass
class Anchor:
    """媒体时间轴上的关键锚点，media_time 为已确认的媒体时刻（秒）。"""
    id: str
    media_time: float
    label: str = ""


@dataclass
class MediaInfo:
    duration: float
    fps: float


@dataclass
class Evidence:
    """一条推演依据。kind 取值：
    anchor / interp / carry_prev / carry_next / overlap / bounds /
    invert / no_anchor / resolution
    """
    kind: str
    description: str
    offset: Optional[float] = None


@dataclass
class Conflict:
    """一处矛盾。双方依据都保留在 evidences 中，resolution 为用户裁决。"""
    id: str
    kind: str                    # anchor_vs_context / overlap / bounds / invert
    segment_ids: list
    description: str
    evidences: list = field(default_factory=list)  # list[Evidence]
    resolution: Optional[str] = None               # 用户裁决选择


@dataclass
class AlignmentResult:
    """单个片段的对齐结论。"""
    segment_id: str
    offset: Optional[float]      # 相对媒体的偏移量（秒），None 表示无法判定
    aligned_start: Optional[float]
    aligned_end: Optional[float]
    status: str                  # ok / conflict / untrusted
    evidences: list = field(default_factory=list)   # list[Evidence]
    conflict_ids: list = field(default_factory=list)
    drift: Optional[float] = None        # 与上一段偏移之差
    cumulative_drift: Optional[float] = None  # 相对首段的累计漂移
