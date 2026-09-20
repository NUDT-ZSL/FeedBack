"""Core data structures used by the offline capacity planner."""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Sequence


@dataclass(frozen=True)
class ScaleAction:
    """An optional capacity action recorded with an observation."""

    kind: str
    amount: Optional[float] = None
    quota_after: Optional[float] = None
    note: Optional[str] = None


@dataclass(frozen=True)
class Record:
    """A single resource usage observation.

    ``ingestion_order`` preserves arrival order, allowing the analyzer to
    identify out-of-order records while still forecasting in chronological
    order.
    """

    resource_id: str
    observed_at: datetime
    usage: float
    quota: float
    action: Optional[ScaleAction] = None
    record_id: Optional[str] = None
    ingestion_order: int = 0


@dataclass(frozen=True)
class ForecastWindow:
    """A resolved, ordered set of future timestamps."""

    points: Sequence[datetime] = field(default_factory=tuple)

    def __post_init__(self):
        ordered = tuple(sorted(self.points))
        if len(ordered) != len(set(ordered)):
            raise ValueError("forecast window must not contain duplicate timestamps")
        object.__setattr__(self, "points", ordered)

    @staticmethod
    def explicit(points):
        # type: (Sequence[datetime]) -> ForecastWindow
        return ForecastWindow(tuple(points))

    @staticmethod
    def horizon(start, periods, interval):
        # type: (datetime, int, timedelta) -> ForecastWindow
        if periods <= 0:
            raise ValueError("periods must be positive")
        return ForecastWindow(tuple(start + interval * i for i in range(periods)))

    @staticmethod
    def interval(start, end, step):
        # type: (datetime, datetime, timedelta) -> ForecastWindow
        if end < start:
            raise ValueError("forecast end must not precede start")
        if step <= timedelta(0):
            raise ValueError("forecast step must be positive")
        points = []
        cursor = start
        while cursor <= end:
            points.append(cursor)
            cursor += step
        return ForecastWindow(tuple(points))


@dataclass(frozen=True)
class UsageInterval:
    """Expected, conservative-low and conservative-high usage."""

    low: float
    expected: float
    high: float


@dataclass(frozen=True)
class Trend:
    slope_per_hour: float
    intercept_at_source_start: float
    source_started_at: datetime
    source_ended_at: datetime
    source_record_count: int
    source_group_count: int
    r_squared: Optional[float]
    growth: str
    source: str
    uses_conflicting_values: bool


@dataclass(frozen=True)
class ForecastPoint:
    timestamp: datetime
    low: float
    expected: float
    high: float
    quota_low: float
    quota_high: float
    expected_gap: float
    high_gap: float
    exceeds_quota: bool


@dataclass(frozen=True)
class Recommendation:
    status: str
    action: str
    current_quota_low: float
    current_quota_high: float
    target_quota: float
    minimum_additional_quota: float
    maximum_additional_quota: float
    first_exceeds_at: Optional[datetime]
    evidence_usage: Optional[UsageInterval]
    rationale: List[str]


@dataclass(frozen=True)
class Conflict:
    conflict_type: str
    timestamps: Sequence[datetime]
    record_ids: Sequence[str]
    ingestion_orders: Sequence[int]
    field_name: Optional[str] = None
    values: Sequence[str] = field(default_factory=tuple)
    message: str = ""


@dataclass(frozen=True)
class Observation:
    record_id: str
    timestamp: datetime
    ingestion_order: int
    usage: float
    quota: float
    action: Optional[ScaleAction]
    out_of_order: bool
    sequence_index: int = 0
    repeated_timestamp: bool = False
    has_earlier_observation: bool = False
    conflicts_with: Sequence[str] = field(default_factory=tuple)


@dataclass(frozen=True)
class ResourceAnalysis:
    resource_id: str
    observations: List[Observation]
    conflicts: List[Conflict]
    trend: Optional[Trend]
    forecast: List[ForecastPoint]
    recommendation: Optional[Recommendation]
    current_quota_low: float
    current_quota_high: float
    has_quota_conflict: bool
