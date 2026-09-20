"""Offline resource usage trend and capacity forecasting engine."""

from collections import defaultdict
from dataclasses import replace
from datetime import timedelta
from .models import (
    Conflict,
    ForecastPoint,
    ForecastWindow,
    Observation,
    Record,
    Recommendation,
    ResourceAnalysis,
    Trend,
    UsageInterval,
)

DEFAULT_HORIZON = timedelta(days=7)
DEFAULT_STEP = timedelta(hours=1)


def ols(points):
    n = len(points)
    mean_x = sum(x for x, _ in points) / n
    mean_y = sum(y for _, y in points) / n
    var_x = sum((x - mean_x) ** 2 for x, _ in points)
    if var_x == 0:
        return 0.0, mean_y
    slope = sum((x - mean_x) * (y - mean_y) for x, y in points) / var_x
    return slope, mean_y - slope * mean_x


def r_squared(points, slope, intercept):
    if len(points) < 2:
        return None
    mean_y = sum(y for _, y in points) / len(points)
    total = sum((y - mean_y) ** 2 for _, y in points)
    if total == 0:
        return 1.0
    residual = sum((y - (slope * x + intercept)) ** 2 for x, y in points)
    return max(0.0, min(1.0, 1.0 - residual / total))


def ceil2(value):
    from math import ceil, isclose
    value = round(value, 9)
    if isclose(value, round(value), rel_tol=0, abs_tol=1e-9):
        return round(value)
    return ceil(value)


def number_text(value):
    return ("%.9f" % float(value)).rstrip("0").rstrip(".") or "0"


def effective_quota(record):
    if record.action and record.action.quota_after is not None:
        return record.action.quota_after
    return record.quota


class CapacityPlanner(object):
    def __init__(self, default_horizon=DEFAULT_HORIZON, default_step=DEFAULT_STEP):
        if default_horizon <= timedelta(0):
            raise ValueError("default_horizon must be positive")
        if default_step <= timedelta(0):
            raise ValueError("default_step must be positive")
        self.default_horizon = default_horizon
        self.default_step = default_step
        self._records = {}
        self._by_resource = defaultdict(list)
        self._windows = {}
        self._cache = {}
        self._next_auto = 1

    def _auto_id(self):
        while "auto-%d" % self._next_auto in self._records:
            self._next_auto += 1
        value = "auto-%d" % self._next_auto
        self._next_auto += 1
        return value

    def add_record(self, record):
        if not isinstance(record, Record):
            raise TypeError("record must be a Record instance")
        record_id = record.record_id or self._auto_id()
        if record_id in self._records:
            raise ValueError("duplicate record_id: %s" % record_id)
        record = replace(record, record_id=record_id)
        self._records[record_id] = record
        self._by_resource[record.resource_id].append(record_id)
        self._cache.pop(record.resource_id, None)
        return record_id

    def add_records(self, records):
        return [self.add_record(record) for record in records]

    def get_record(self, record_id):
        return self._records[record_id]

    def record_ids(self):
        return tuple(sorted(self._records))

    def resource_ids(self):
        return tuple(sorted(self._by_resource))

    def set_forecast_window(self, resource_id, window):
        if not window.points:
            raise ValueError("forecast window must contain at least one point")
        self._windows[resource_id] = window
        self._cache.pop(resource_id, None)

    def clear_forecast_window(self, resource_id):
        self._windows.pop(resource_id, None)
        self._cache.pop(resource_id, None)

    @staticmethod
    def period_count(horizon, step):
        count = int(horizon // step)
        if horizon % step > timedelta(0):
            count += 1
        return max(1, count)

    def set_forecast_horizon(self, resource_id, horizon, step=None, start=None):
        step = step or self.default_step
        ids = self._by_resource.get(resource_id, ())
        if not ids:
            raise KeyError(resource_id)
        if start is None:
            latest = max(self._records[i].observed_at for i in ids)
            start = latest + step
        self.set_forecast_window(
            resource_id, ForecastWindow.horizon(start, self.period_count(horizon, step), step)
        )

    def default_window_for(self, resource_id):
        ids = self._by_resource.get(resource_id, ())
        if not ids:
            raise KeyError(resource_id)
        latest = max(self._records[i].observed_at for i in ids)
        return ForecastWindow.horizon(
            latest + self.default_step,
            self.period_count(self.default_horizon, self.default_step),
            self.default_step,
        )

    def _window_for(self, resource_id):
        return self._windows.get(resource_id) or self.default_window_for(resource_id)

    def correct_record(self, record_id, changes):
        if "record_id" in changes and changes["record_id"] != record_id:
            raise ValueError("record_id is immutable; correct fields other than record identity")
        old = self._records[record_id]
        values = {
            "resource_id": old.resource_id,
            "observed_at": old.observed_at,
            "usage": old.usage,
            "quota": old.quota,
            "action": old.action,
            "record_id": record_id,
            "ingestion_order": old.ingestion_order,
        }
        values.update(changes)
        new = Record(**values)
        self._records[record_id] = new
        if old.resource_id != new.resource_id:
            self._by_resource[old.resource_id].remove(record_id)
            if not self._by_resource[old.resource_id]:
                del self._by_resource[old.resource_id]
            self._by_resource[new.resource_id].append(record_id)
        self._cache.pop(old.resource_id, None)
        self._cache.pop(new.resource_id, None)
        return new

    @staticmethod
    def same_action(left, right):
        if left is None or right is None:
            return left is right
        return (
            left.kind == right.kind
            and left.amount == right.amount
            and left.quota_after == right.quota_after
            and left.note == right.note
        )

    def timeline(self, resource_id):
        records = [self._records[i] for i in self._by_resource[resource_id]]
        chronological = sorted(
            records, key=lambda r: (r.observed_at, r.ingestion_order, r.record_id)
        )
        grouped = defaultdict(list)
        for record in chronological:
            grouped[record.observed_at].append(record)

        conflicts, links = [], defaultdict(set)
        for timestamp, group in grouped.items():
            if len(group) < 2:
                continue
            ids = tuple(r.record_id for r in group)
            orders = tuple(r.ingestion_order for r in group)
            for record in group:
                links[record.record_id].update(i for i in ids if i != record.record_id)
            conflicts.append(Conflict(
                "duplicate_timestamp", (timestamp,), ids, orders,
                "observed_at", tuple(timestamp.isoformat() for _ in group),
                "same timestamp has multiple records; all records retained",
            ))
            for name, getter in (
                ("usage", lambda r: r.usage),
                ("quota", lambda r: r.quota),
            ):
                values = [getter(r) for r in group]
                if len(set(values)) > 1:
                    conflicts.append(Conflict(
                        "duplicate_timestamp_" + name, (timestamp,), ids, orders,
                        name, tuple(number_text(v) for v in values),
                        "same timestamp has contradictory %s values; all records retained" % name,
                    ))
            actions = [r.action for r in group]
            if not all(self.same_action(actions[0], action) for action in actions[1:]):
                conflicts.append(Conflict(
                    "duplicate_timestamp_action", (timestamp,), ids, orders, "action",
                    tuple("none" if a is None else a.kind for a in actions),
                    "same timestamp has contradictory scale actions; all records retained",
                ))

        out_of_order, latest_time = set(), None
        for record in sorted(records, key=lambda r: r.ingestion_order):
            if latest_time is not None and record.observed_at < latest_time:
                out_of_order.add(record.record_id)
            latest_time = record.observed_at if latest_time is None else max(
                latest_time, record.observed_at
            )
        for record in sorted(records, key=lambda r: r.ingestion_order):
            if record.record_id in out_of_order:
                conflicts.append(Conflict(
                    "out_of_order", (record.observed_at,), (record.record_id,),
                    (record.ingestion_order,), "observed_at",
                    (record.observed_at.isoformat(),),
                    "record arrived after a later timestamp but was retained",
                ))

        observations, previous, seen_times = [], None, set()
        for sequence_index, record in enumerate(chronological):
            observations.append(Observation(
                record.record_id, record.observed_at, record.ingestion_order,
                record.usage, record.quota, record.action,
                record.record_id in out_of_order,
                sequence_index,
                record.observed_at in seen_times,
                previous is not None,
                tuple(sorted(links[record.record_id])),
            ))
            seen_times.add(record.observed_at)
            previous = record.observed_at
        return chronological, observations, conflicts

    @staticmethod
    def fit_trend(records):
        grouped = defaultdict(list)
        for record in records:
            grouped[record.observed_at].append(record)
        groups = []
        for timestamp in sorted(grouped):
            values = [r.usage for r in grouped[timestamp]]
            groups.append((timestamp, min(values), sum(values) / len(values),
                           max(values), len(set(values)) > 1, len(values)))

        action_times = [r.observed_at for r in records if r.action is not None]
        start = max(action_times) if action_times else groups[0][0]
        source_records = [r for r in records if r.observed_at > start]
        selected = [g for g in groups if g[0] > start]
        source = "observations_after_latest_action" if action_times else "all_observations"
        if len(selected) < 2:
            source_records, selected = records, groups
            start, source = groups[0][0], "all_observations_fallback_insufficient_post_action_points"

        series = []
        for column in (1, 2, 3):
            series.append([
                ((g[0] - start).total_seconds() / 3600.0, g[column]) for g in selected
            ])
        low_line, mean_line, high_line = [ols(values) for values in series]
        slope, intercept = mean_line
        growth = "growing" if slope > 1e-12 else ("shrinking" if slope < -1e-12 else "flat")
        trend = Trend(
            slope, intercept, start, selected[-1][0], len(source_records),
            len(selected), r_squared(series[1], slope, intercept), growth,
            source, any(g[4] for g in selected),
        )
        return trend, (low_line, mean_line, high_line)

    @staticmethod
    def quota_interval(records):
        grouped = defaultdict(list)
        for record in records:
            grouped[record.observed_at].append(record)
        values = [effective_quota(r) for r in grouped[max(grouped)]]
        return min(values), max(values), len(set(values)) > 1

    def analyze_raw(self, resource_id):
        records, observations, conflicts = self.timeline(resource_id)
        if not records:
            raise KeyError(resource_id)
        trend, lines = self.fit_trend(records)
        quota_low, quota_high, quota_conflict = self.quota_interval(records)
        forecast, latest = [], records[-1].observed_at
        for timestamp in self._window_for(resource_id).points:
            if timestamp <= latest:
                continue
            hours = (timestamp - trend.source_started_at).total_seconds() / 3600.0
            values = [max(0.0, slope * hours + intercept) for slope, intercept in lines]
            low, expected, high = min(values), sorted(values)[1], max(values)
            forecast.append(ForecastPoint(
                timestamp, low, expected, high, quota_low, quota_high,
                max(0.0, expected - quota_low), max(0.0, high - quota_low),
                high > quota_low,
            ))
        return ResourceAnalysis(
            resource_id, observations, conflicts, trend, forecast,
            self.recommendation(forecast, trend, quota_low, quota_high, quota_conflict),
            quota_low, quota_high, quota_conflict,
        )

    @staticmethod
    def recommendation(forecast, trend, quota_low, quota_high, quota_conflict):
        if not forecast:
            return None
        first_expected = next((p for p in forecast if p.expected > p.quota_low), None)
        first_high = next((p for p in forecast if p.high > p.quota_low), None)
        peak_low = max(p.low for p in forecast)
        peak_expected = max(p.expected for p in forecast)
        peak_high = max(p.high for p in forecast)
        crossing = "ok"
        if first_expected is not None:
            status, action, first = "expand", "expand_capacity", first_expected
            crossing = "expand"
        elif first_high is not None:
            status, action, first = "expand_recommended", "proactively_expand_capacity", first_high
            crossing = "expand_recommended"
        else:
            status, action, first = "ok", "no_expansion_needed", None
        if quota_conflict:
            status, action = "conflict_review", "resolve_quota_conflict_before_scaling"
            if first is None:
                first = first_high

        target = ceil2(max(peak_high, quota_high))
        minimum_additional = max(0, ceil2(peak_expected - quota_high)) if crossing == "expand" else 0
        maximum_additional = max(0, ceil2(peak_high - quota_low))
        r2_text = "n/a" if trend.r_squared is None else "%.3f" % trend.r_squared
        rationale = [
            "forecast source: %s, %d records in %d timestamp groups"
            % (trend.source, trend.source_record_count, trend.source_group_count),
            "linear trend: %.6g usage units/hour, growth=%s, R2=%s"
            % (trend.slope_per_hour, trend.growth, r2_text),
            "forecast peak usage interval: %.6g to %.6g; expected %.6g"
            % (peak_low, peak_high, peak_expected),
        ]
        if first is not None:
            rationale.append("first projected quota crossing: %s" % first.timestamp.isoformat())
        if trend.uses_conflicting_values:
            rationale.append("conflicting same-timestamp usage was retained and represented as an interval")
        if quota_conflict:
            rationale.append("latest timestamp has conflicting effective quota values; resolve before scaling")
        elif status == "ok":
            rationale.append("no projected point exceeds quota in this window")
        return Recommendation(
            status, action, quota_low, quota_high, target, minimum_additional,
            maximum_additional, None if first is None else first.timestamp,
            UsageInterval(peak_low, peak_expected, peak_high), rationale,
        )

    def analyze(self, resource_id, window=None):
        if window is None:
            if resource_id not in self._cache:
                self._cache[resource_id] = self.analyze_raw(resource_id)
            return self._cache[resource_id]
        if not window.points:
            raise ValueError("forecast window must contain at least one point")
        previous_window = self._windows.get(resource_id)
        self._windows[resource_id] = window
        try:
            return self.analyze_raw(resource_id)
        finally:
            if previous_window is None:
                self._windows.pop(resource_id, None)
            else:
                self._windows[resource_id] = previous_window

    def analyze_all(self, window=None):
        return {rid: self.analyze(rid, window) for rid in self.resource_ids()}
