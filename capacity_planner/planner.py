from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

from .forecast import ResourceForecast, Trend, calculate_trend, forecast_resource
from .models import PredictionWindow, Record
from .series import ResourceSeries, build_series


_UNSET = object()


@dataclass(frozen=True)
class ResourceAnalysis:
    series: ResourceSeries
    forecast: ResourceForecast

    def to_dict(self) -> dict[str, Any]:
        return {
            "resource_id": self.series.resource_id,
            "forecast": self.forecast.to_dict(),
            "conflicts": [conflict.to_dict() for conflict in self.series.conflicts],
            "out_of_order_record_ids": list(self.series.out_of_order_record_ids),
            "actions": [
                {
                    "timestamp": action.timestamp.isoformat(),
                    "record_id": action.record_id,
                    "type": action.type.value,
                    "amount": action.amount,
                    "unit": action.unit,
                    "note": action.note,
                }
                for action in self.series.actions
            ],
            "retained_records": [record.to_dict() for record in self.series.records],
        }


@dataclass(frozen=True)
class AnalysisReport:
    generated_at: datetime
    window: PredictionWindow
    resources: tuple[ResourceAnalysis, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "generated_at": self.generated_at.isoformat(),
            "window": {
                "horizon_seconds": self.window.horizon.total_seconds(),
                "interval_seconds": self.window.interval.total_seconds(),
            },
            "resource_count": len(self.resources),
            "resources": [resource.to_dict() for resource in self.resources],
        }


class CapacityPlanner:
    """In-memory, dependency-free planner with bounded incremental invalidation."""

    def __init__(self, default_window: PredictionWindow | None = None) -> None:
        self._records: dict[str, Record] = {}
        self._record_resources: dict[str, str] = {}
        self._resource_ids: dict[str, set[str]] = {}
        self._default_window = default_window
        self._windows: dict[str, PredictionWindow] = {}
        self._series_cache: dict[str, ResourceSeries] = {}
        self._trend_cache: dict[str, Trend] = {}
        self._forecast_cache: dict[str, tuple[tuple[float, float], ResourceForecast]] = {}
        self._ingestion_counter = 0

    @property
    def default_window(self) -> PredictionWindow | None:
        return self._default_window

    def set_default_window(self, window: PredictionWindow) -> None:
        self._default_window = window
        self._forecast_cache.clear()

    def set_window(self, resource_id: str, window: PredictionWindow | None) -> None:
        if window is None:
            existed = resource_id in self._windows
            self._windows.pop(resource_id, None)
            if existed:
                self._forecast_cache.pop(resource_id, None)
            return
        old = self._windows.get(resource_id)
        self._windows[resource_id] = window
        if old != window:
            self._forecast_cache.pop(resource_id, None)

    def add_records(self, records: Iterable[Record]) -> None:
        for record in records:
            self.upsert_record(record)

    def upsert_record(self, record: Record) -> None:
        old_resource = self._record_resources.get(record.record_id)
        if old_resource is None:
            self._ingestion_counter += 1
            object.__setattr__(record, "ingestion_order", self._ingestion_counter)
        else:
            object.__setattr__(record, "ingestion_order", self._records[record.record_id].ingestion_order)
        self._records[record.record_id] = record
        self._record_resources[record.record_id] = record.resource_id
        self._resource_ids.setdefault(record.resource_id, set()).add(record.record_id)
        self._invalidate(record.resource_id)
        if old_resource and old_resource != record.resource_id:
            self._resource_ids.setdefault(old_resource, set()).discard(record.record_id)
            self._invalidate(old_resource)

    def delete_record(self, record_id: str) -> None:
        record = self._records.pop(record_id, None)
        self._record_resources.pop(record_id, None)
        if record is not None:
            self._resource_ids.setdefault(record.resource_id, set()).discard(record_id)
            self._invalidate(record.resource_id)

    def get_record(self, record_id: str) -> Record:
        return self._records[record_id]

    def list_records(self, resource_id: str | None = None) -> list[Record]:
        records = list(self._records.values())
        if resource_id is not None:
            records = [record for record in records if record.resource_id == resource_id]
        return sorted(records, key=lambda item: (item.resource_id, item.timestamp, item.record_id))

    def _invalidate(self, resource_id: str) -> None:
        self._series_cache.pop(resource_id, None)
        self._trend_cache.pop(resource_id, None)
        self._forecast_cache.pop(resource_id, None)
        ids = self._resource_ids.get(resource_id)
        if ids is not None and not ids:
            self._resource_ids.pop(resource_id, None)
            self._windows.pop(resource_id, None)

    def correct_record(
        self,
        record_id: str,
        *,
        resource_id: str | None = None,
        timestamp: datetime | str | None = None,
        usage: float | None = None,
        quota: float | None = None,
        action: Any = _UNSET,
    ) -> Record:
        if record_id not in self._records:
            raise KeyError(f"unknown record_id: {record_id}")
        current = self._records[record_id]
        from .timeutils import parse_timestamp

        updated = Record(
            record_id=current.record_id,
            resource_id=current.resource_id if resource_id is None else resource_id,
            timestamp=current.timestamp if timestamp is None else parse_timestamp(timestamp),
            usage=current.usage if usage is None else usage,
            quota=current.quota if quota is None else quota,
            action=current.action if action is _UNSET else action,
        )
        self.upsert_record(updated)
        return updated

    def _window_for(self, resource_id: str) -> PredictionWindow:
        window = self._windows.get(resource_id) or self._default_window
        if window is None:
            raise ValueError("a prediction window is required")
        return window

    def get_series(self, resource_id: str) -> ResourceSeries:
        if resource_id not in self._resource_ids:
            raise KeyError(f"unknown resource_id: {resource_id}")
        cached = self._series_cache.get(resource_id)
        if cached is not None:
            return cached
        records = [record for record in self._records.values() if record.resource_id == resource_id]
        series = build_series(resource_id, records)
        self._series_cache[resource_id] = series
        return series

    def get_trend(self, resource_id: str) -> Trend:
        cached = self._trend_cache.get(resource_id)
        if cached is not None:
            return cached
        trend = calculate_trend(self.get_series(resource_id))
        self._trend_cache[resource_id] = trend
        return trend

    def get_forecast(self, resource_id: str, window: PredictionWindow | None = None) -> ResourceForecast:
        selected = window or self._window_for(resource_id)
        cached = self._forecast_cache.get(resource_id)
        if window is None and cached is not None and cached[0] == selected.fingerprint:
            return cached[1]
        forecast = forecast_resource(self.get_series(resource_id), selected)
        if window is None:
            self._forecast_cache[resource_id] = (selected.fingerprint, forecast)
        return forecast

    def analyze(
        self,
        window: PredictionWindow | None = None,
        *,
        resource_ids: Iterable[str] | None = None,
        generated_at: datetime | None = None,
    ) -> AnalysisReport:
        effective = window or self._default_window
        if effective is None:
            raise ValueError("a prediction window is required")
        known = set(self._resource_ids)
        selected_ids = sorted(known if resource_ids is None else set(resource_ids))
        unknown = sorted(set(selected_ids) - known)
        if unknown:
            raise KeyError(f"unknown resource_id(s): {', '.join(unknown)}")

        resources = []
        for resource_id in selected_ids:
            per_resource_window = self._windows.get(resource_id)
            selected_window = effective if window is not None else per_resource_window or effective
            series = self.get_series(resource_id)
            forecast = self.get_forecast(resource_id, selected_window if window is not None else None)
            resources.append(ResourceAnalysis(series=series, forecast=forecast))

        if generated_at is None:
            generated_at = datetime.now().astimezone()
        elif generated_at.tzinfo is None:
            raise ValueError("generated_at must include a timezone")
        return AnalysisReport(generated_at, effective, tuple(resources))
