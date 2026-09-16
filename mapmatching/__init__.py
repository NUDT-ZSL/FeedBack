"""mapmatching —— 带误差定位序列到路网的离线还原模块。

公开的主要对象：
    Point / Geometry        坐标与几何计算（投影、点到线段距离）
    RoadNetwork             路网：节点、路段、方向与禁行约束
    Observation / Track     带误差采样点与轨迹登记（幂等、单调校验）
    Matcher                 候选匹配与代价
    PathBuilder             合法路径拼接、断点拒绝、缺失补路
    MultiSourceConflict     多来源冲突记录
    TrackReconstructor      总装：逐来源还原 + 冲突检测
    ReconstructionStore     禁行增量重算（只重算受影响片段）

所有业务异常都继承自 MapMatchingError，捕获它即可区分“输入/约束被拒绝”
与普通的程序错误。
"""

from .geometry import Point, Geometry, great_circle_meters
from .network import (
    RoadNetwork,
    Node,
    Edge,
    Direction,
    Traversal,
    EdgeClosedError,
    WrongWayError,
    PathValidationError,
    DuplicateIdError,
    NodeNotFoundError,
    EdgeNotFoundError,
)
from .samples import Observation, Track, SampleValidationError, DuplicateIgnored
from .matching import (
    Matcher,
    Candidate,
    MatchConfig,
    MatchResult,
    MatchStatus,
    UnmatchedSample,
)
from .pathfinding import PathBuilder, PathBuildConfig, Leg, PathBuildDiagnostic
from .tracker import (
    TrackReconstructor,
    Reconstruction,
    MultiSourceConflict,
)
from .store import ReconstructionStore
from .errors import MapMatchingError

__all__ = [
    "Point",
    "Geometry",
    "great_circle_meters",
    "RoadNetwork",
    "Node",
    "Edge",
    "Direction",
    "Traversal",
    "DuplicateIdError",
    "NodeNotFoundError",
    "EdgeNotFoundError",
    "EdgeClosedError",
    "WrongWayError",
    "PathValidationError",
    "Observation",
    "Track",
    "SampleValidationError",
    "DuplicateIgnored",
    "Matcher",
    "Candidate",
    "MatchConfig",
    "MatchResult",
    "MatchStatus",
    "UnmatchedSample",
    "PathBuilder",
    "PathBuildConfig",
    "Leg",
    "PathBuildDiagnostic",
    "TrackReconstructor",
    "Reconstruction",
    "MultiSourceConflict",
    "ReconstructionStore",
    "MapMatchingError",
]
