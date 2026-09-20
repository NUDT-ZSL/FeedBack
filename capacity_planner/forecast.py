from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import math
from typing import Any

from .models import PredictionWindow
from .series import ResourceSeries


@dataclass(frozen=True)
class Trend:
    method: str
    slope_units_per_day: float
    expected_at_origin: float
    low_at_origin: float
    high_at_origin: float
    low_slope_units_per_day: float
    high_slope_units_per_day: float
    r_squared: float | None
    residual_std: float
    observation_count: int
    distinct_timestamp_count: int
    first_timestamp: datetime
    last_timestamp: datetime
    source_record_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "slope_units_per_day": self.slope_units_per_day,
            "expected_at_origin": self.expected_at_origin,
            "low_at_origin": self.low_at_origin,
            "high_at_origin": self.high_at_origin,
            "low_slope_units_per_day": self.low_slope_units_per_day,
            "high_slope_units_per_day": self.high_slope_units_per_day,
            "r_squared": self.r_squared,
            "residual_std": self.residual_std,
            "observation_count": self.observation_count,
            "distinct_timestamp_count": self.distinct_timestamp_count,
            "first_timestamp": self.first_timestamp.isoformat(),
            "last_timestamp": self.last_timestamp.isoformat(),
            "source_record_ids": list(self.source_record_ids),
        }


@dataclass(frozen=True)
class PredictionPoint:
    timestamp: datetime
    expected_usage: float
    usage_low: float
    usage_high: float
    quota: float
    quota_gap_expected: float
    quota_gap_low: float
    quota_gap_high: float
    expected_exceeds_quota: bool
    upper_exceeds_quota: bool

    def to_dict(self) -> dict[str, Any]:
        data = vars(self).copy()
        data["timestamp"] = self.timestamp.isoformat()
        return data


@dataclass(frozen=True)
class ExpansionRecommendation:
    recommended_action: str
    status: str
    required_additional_capacity: float
    recommended_quota: float
    first_breach_at: datetime | None
    first_upper_breach_at: datetime | None
    peak_timestamp: datetime
    peak_usage_interval: tuple[float, float]
    breach_usage_interval: tuple[float, float] | None
    trend_source: str
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "recommended_action": self.recommended_action,
            "status": self.status,
            "required_additional_capacity": self.required_additional_capacity,
            "recommended_quota": self.recommended_quota,
            "first_breach_at": None if self.first_breach_at is None else self.first_breach_at.isoformat(),
            "first_upper_breach_at": None if self.first_upper_breach_at is None else self.first_upper_breach_at.isoformat(),
            "peak_timestamp": self.peak_timestamp.isoformat(),
            "peak_usage_interval": list(self.peak_usage_interval),
            "breach_usage_interval": None if self.breach_usage_interval is None else list(self.breach_usage_interval),
            "trend_source": self.trend_source,
            "rationale": self.rationale,
        }


@dataclass(frozen=True)
class ResourceForecast:
    resource_id: str
    window: PredictionWindow
    origin: datetime
    quota: float
    quota_low: float
    quota_high: float
    trend: Trend
    points: tuple[PredictionPoint, ...]
    recommendation: ExpansionRecommendation
    has_conflicts: bool
    conflict_count: int
    has_out_of_order_records: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource_id": self.resource_id,
            "window": {
                "horizon_seconds": self.window.horizon.total_seconds(),
                "interval_seconds": self.window.interval.total_seconds(),
            },
            "origin": self.origin.isoformat(),
            "quota": self.quota,
            "quota_low": self.quota_low,
            "quota_high": self.quota_high,
            "trend": self.trend.to_dict(),
            "points": [point.to_dict() for point in self.points],
            "recommendation": self.recommendation.to_dict(),
            "has_conflicts": self.has_conflicts,
            "conflict_count": self.conflict_count,
            "has_out_of_order_records": self.has_out_of_order_records,
        }


def calculate_trend(series: ResourceSeries) -> Trend:
    groups = series.observation_groups
    origin = series.last_timestamp
    x_values = [(group.timestamp - origin).total_seconds() / 86400.0 for group in groups]
    expected = [(group.usage_low + group.usage_high) / 2.0 for group in groups]
    intercept, slope, r2 = _ols(x_values, expected)
    low_line = _ols(x_values, [group.usage_low for group in groups])
    high_line = _ols(x_values, [group.usage_high for group in groups])
    if len(groups) == 1:
        method = "latest_observation"
        intercept = expected[0]
        slope = 0.0
        low_line = (groups[0].usage_low, 0.0, None)
        high_line = (groups[0].usage_high, 0.0, None)
        r2 = None
    else:
        method = "ordinary_least_squares"
    residual = _residual_std(series, intercept, slope)
    return Trend(
        method=method,
        slope_units_per_day=slope,
        expected_at_origin=intercept,
        low_at_origin=low_line[0],
        high_at_origin=high_line[0],
        low_slope_units_per_day=low_line[1],
        high_slope_units_per_day=high_line[1],
        r_squared=r2,
        residual_std=residual,
        observation_count=len(series.records),
        distinct_timestamp_count=len(groups),
        first_timestamp=series.first_timestamp,
        last_timestamp=series.last_timestamp,
        source_record_ids=tuple(record.record_id for record in series.records),
    )


def _ols(x: list[float], y: list[float]) -> tuple[float, float, float | None]:
    count = len(x)
    mean_x = sum(x) / count
    mean_y = sum(y) / count
    sxx = sum((value - mean_x) ** 2 for value in x)
    if sxx == 0:
        return mean_y, 0.0, None
    sxy = sum((x[index] - mean_x) * (y[index] - mean_y) for index in range(count))
    slope = sxy / sxx
    intercept = mean_y - slope * mean_x
    sse = sum((y[index] - (intercept + slope * x[index])) ** 2 for index in range(count))
    sst = sum((value - mean_y) ** 2 for value in y)
    r2 = None if sst == 0 else max(0.0, min(1.0, 1.0 - sse / sst))
    return intercept, slope, r2


def _residual_std(series: ResourceSeries, intercept: float, slope: float) -> float:
    origin = series.last_timestamp
    errors = []
    for record in series.records:
        days = (record.timestamp - origin).total_seconds() / 86400.0
        errors.append(record.usage - (intercept + slope * days))
    if len(errors) <= 2:
        return 0.0
    return math.sqrt(sum(error * error for error in errors) / (len(errors) - 2))


def forecast_resource(series: ResourceSeries, window: PredictionWindow) -> ResourceForecast:
    trend = calculate_trend(series)
    origin = series.last_timestamp
    groups = series.observation_groups
    mean_days = sum((group.timestamp - origin).total_seconds() / 86400.0 for group in groups) / len(groups)
    sxx = sum(((group.timestamp - origin).total_seconds() / 86400.0 - mean_days) ** 2 for group in groups)

    points: list[PredictionPoint] = []
    for timestamp in window.points_from(origin):
        days = (timestamp - origin).total_seconds() / 86400.0
        expected = max(0.0, trend.expected_at_origin + trend.slope_units_per_day * days)
        low_base = trend.low_at_origin + trend.low_slope_units_per_day * days
        high_base = trend.high_at_origin + trend.high_slope_units_per_day * days
        margin = _prediction_margin(trend, days, mean_days, sxx)
        low = min(expected, max(0.0, low_base - margin))
        high = max(expected, low, high_base + margin)
        quota = series.latest_quota
        points.append(PredictionPoint(
            timestamp=timestamp,
            expected_usage=expected,
            usage_low=low,
            usage_high=high,
            quota=quota,
            quota_gap_expected=max(0.0, expected - quota),
            quota_gap_low=max(0.0, low - quota),
            quota_gap_high=max(0.0, high - quota),
            expected_exceeds_quota=expected > quota,
            upper_exceeds_quota=high > quota,
        ))

    recommendation = _recommendation(series, trend, points, origin, quota=series.latest_quota)
    return ResourceForecast(
        resource_id=series.resource_id,
        window=window,
        origin=origin,
        quota=series.latest_quota,
        quota_low=series.latest_quota_low,
        quota_high=series.latest_quota_high,
        trend=trend,
        points=tuple(points),
        recommendation=recommendation,
        has_conflicts=series.has_conflicts,
        conflict_count=len(series.conflicts),
        has_out_of_order_records=series.has_out_of_order_records,
    )


def _prediction_margin(trend: Trend, days: float, mean_days: float, sxx: float) -> float:
    if trend.residual_std == 0 or trend.distinct_timestamp_count <= 2:
        return 0.0
    leverage = 1.0 + 1.0 / trend.distinct_timestamp_count
    if sxx > 0:
        leverage += ((days - mean_days) ** 2) / sxx
    return 1.2816 * trend.residual_std * math.sqrt(leverage)


def _crossing_time(origin: datetime, intercept: float, slope: float, quota: float) -> datetime | None:
    if intercept > quota:
        return origin
    if slope <= 0:
        return None
    return origin + timedelta(days=(quota - intercept) / slope)


def _recommendation(
    series: ResourceSeries,
    trend: Trend,
    points: list[PredictionPoint],
    origin: datetime,
    quota: float,
) -> ExpansionRecommendation:
    expected_breach = next((point for point in points if point.expected_exceeds_quota), None)
    upper_breach = next((point for point in points if point.upper_exceeds_quota), None)
    first_expected = _crossing_time(origin, trend.expected_at_origin, trend.slope_units_per_day, quota)
    first_upper = _crossing_time(origin, trend.high_at_origin, trend.high_slope_units_per_day, quota)
    current_expected_breach = trend.expected_at_origin > quota
    current_upper_breach = trend.high_at_origin > quota
    future_expected_breach = first_expected is not None and first_expected <= points[-1].timestamp
    future_upper_breach = first_upper is not None and first_upper <= points[-1].timestamp

    if current_expected_breach or future_expected_breach:
        status = "expand_recommended"
    elif current_upper_breach or future_upper_breach:
        status = "at_risk"
    else:
        status = "no_expansion_needed"

    peak_candidates = [
        (trend.low_at_origin, trend.high_at_origin, origin),
        *[(point.usage_low, point.usage_high, point.timestamp) for point in points],
    ]
    peak_low, peak_high, peak_timestamp = max(peak_candidates, key=lambda item: (item[1], item[2]))
    peak_interval = (peak_low, peak_high)
    needed = max(0.0, peak_high - quota)
    recommended = quota + needed
    if status == "expand_recommended":
        interval = (trend.low_at_origin, trend.high_at_origin) if current_expected_breach or expected_breach is None else (expected_breach.usage_low, expected_breach.usage_high)
    elif status == "at_risk":
        interval = (trend.low_at_origin, trend.high_at_origin) if current_upper_breach or upper_breach is None else (upper_breach.usage_low, upper_breach.usage_high)
    else:
        interval = None
    source = (
        f"{trend.method} from {trend.observation_count} retained observations "
        f"at {trend.distinct_timestamp_count} timestamps "
        f"({series.first_timestamp.isoformat()} to {series.last_timestamp.isoformat()})"
    )
    if status == "expand_recommended":
        rationale = (
            f"expected usage exceeds {quota:.6g}; planning quota uses the high estimate "
            f"{peak_interval[1]:.6g} at {peak_timestamp.isoformat()}."
        )
    elif status == "at_risk":
        rationale = (
            f"the upper usage interval exceeds quota while the expected value does not; "
            f"high estimate at {peak_timestamp.isoformat()} is {peak_interval[1]:.6g}."
        )
    else:
        rationale = "neither the expected nor high usage estimate exceeds quota in the requested window."
    if series.has_conflicts:
        rationale += " Conflicting observations were retained and represented by the low/high envelope."
    return ExpansionRecommendation(
        recommended_action="none" if status == "no_expansion_needed" else "expand",
        status=status,
        required_additional_capacity=needed,
        recommended_quota=recommended,
        first_breach_at=first_expected if future_expected_breach or current_expected_breach else None,
        first_upper_breach_at=first_upper if future_upper_breach or current_upper_breach else None,
        peak_timestamp=peak_timestamp,
        peak_usage_interval=peak_interval,
        breach_usage_interval=interval,
        trend_source=source,
        rationale=rationale,
    )
