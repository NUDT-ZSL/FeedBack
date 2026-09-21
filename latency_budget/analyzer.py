"""Pure, dependency-free latency attribution logic.

Timestamps are numeric values in the same unit (the UI labels them
milliseconds). The analysis functions are stateless: budgets and records are
copied into fresh result objects, so repeated calls cannot influence each
other.
"""

from __future__ import annotations

import json
import math
from bisect import bisect_right
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, Mapping


class AnalysisError(ValueError):
    """Raised when an entire input batch cannot be interpreted."""


def _anomaly(
    code: str,
    message: str,
    severity: str = "error",
    segment_id: Any | None = None,
    segment_ids: Iterable[Any] | None = None,
) -> dict[str, Any]:
    ids = list(segment_ids or [])
    if segment_id is not None:
        ids.append(segment_id)
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "segment_ids": [str(item) for item in ids],
    }


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _empty_stage(name: str) -> dict[str, Any]:
    return {
        "stage": name,
        "gross_duration_ms": 0.0,
        "exclusive_ms": 0.0,
        "shared_wall_ms": 0.0,
        "allocated_shared_ms": 0.0,
        "allocated_ms": 0.0,
        "budget_ms": None,
        "overage_ms": None,
        "e2e_overrun_contribution_ms": None,
        "overrun_hidden_by_overlap_ms": None,
    }


def _normalise_segments(request: Any, fallback_id: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    anomalies: list[dict[str, Any]] = []
    if not isinstance(request, Mapping):
        return [], [_anomaly("invalid_request", f"Request {fallback_id} must be an object.")]

    raw_segments = request.get("segments")
    if not isinstance(raw_segments, list):
        return [], [_anomaly("missing_segments", "Request must contain a 'segments' array.")]

    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_segments):
        fallback_segment_id = str(index + 1)
        if not isinstance(raw, Mapping):
            anomalies.append(_anomaly("malformed_segment", "Each segment must be an object.", segment_id=fallback_segment_id))
            continue

        segment_id = raw.get("id", fallback_segment_id)
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip():
            anomalies.append(_anomaly("invalid_stage_name", "Segment name must be a non-empty string.", segment_id=segment_id))
            continue
        name = name.strip()

        start = raw.get("start_ms", raw.get("start"))
        end = raw.get("end_ms", raw.get("end"))
        if not _is_number(start) or not _is_number(end):
            anomalies.append(_anomaly("invalid_timestamp", "Segment start_ms and end_ms must be finite numbers.", segment_id=segment_id))
            continue

        segment = {"id": str(segment_id), "stage": name, "start_ms": float(start), "end_ms": float(end)}
        if segment["start_ms"] > segment["end_ms"]:
            anomalies.append(
                _anomaly(
                    "time_inversion",
                    f"Segment '{name}' ends before it starts ({start} > {end}).",
                    segment_id=segment["id"],
                )
            )
            continue
        if segment["start_ms"] == segment["end_ms"]:
            anomalies.append(
                _anomaly(
                    "zero_duration",
                    f"Segment '{name}' has zero duration; it is kept as a point event.",
                    severity="warning",
                    segment_id=segment["id"],
                )
            )
        segments.append(segment)

    return segments, anomalies


def _find_nesting(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flag containment, including a point strictly inside an interval."""
    ordered = sorted(
        [item for item in segments if item["start_ms"] < item["end_ms"]],
        key=lambda item: (item["start_ms"], -item["end_ms"], item["id"]),
    )
    anomalies: list[dict[str, Any]] = []
    outer: dict[str, Any] | None = None
    for segment in ordered:
        if outer is not None and segment["start_ms"] < outer["end_ms"] and segment["end_ms"] <= outer["end_ms"]:
            exact = segment["start_ms"] == outer["start_ms"] and segment["end_ms"] == outer["end_ms"]
            anomalies.append(
                _anomaly(
                    "duplicate_segment" if exact else "nested_segment",
                    f"Segment '{segment['stage']}' is identical to '{outer['stage']}'."
                    if exact
                    else f"Segment '{segment['stage']}' is nested inside '{outer['stage']}'.",
                    segment_ids=[outer["id"], segment["id"]],
                )
            )
            continue
        if outer is None or segment["end_ms"] > outer["end_ms"]:
            outer = segment
    positive = [item for item in ordered if item["start_ms"] < item["end_ms"]]
    for point in [item for item in segments if item["start_ms"] == item["end_ms"]]:
        for parent in positive:
            if parent["start_ms"] < point["start_ms"] < parent["end_ms"]:
                anomalies.append(
                    _anomaly(
                        "nested_point",
                        f"Zero-duration segment '{point['stage']}' occurs inside '{parent['stage']}'.",
                        segment_ids=[parent["id"], point["id"]],
                    )
                )
                break
    return anomalies


def _merge_intervals(intervals: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    positive = sorted((start, end) for start, end in intervals if start < end)
    merged: list[tuple[float, float]] = []
    for start, end in positive:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        elif end > merged[-1][1]:
            merged.append((merged.pop()[0], end))
    return merged


def _round(value: Any, digits: int = 6) -> Any:
    if value is None:
        return None
    if isinstance(value, float):
        rounded = round(value, digits)
        return 0.0 if rounded == 0.0 else rounded
    return value


def _round_deep(value: Any) -> Any:
    if isinstance(value, float):
        return _round(value)
    if isinstance(value, list):
        return [_round_deep(item) for item in value]
    if isinstance(value, dict):
        return {key: _round_deep(item) for key, item in value.items()}
    return value


def _stage_summary(name: str) -> dict[str, Any]:
    summary = _empty_stage(name)
    summary["occurrences"] = 0
    return summary


def _valid_request_result(
    request_id: str,
    request: Mapping[str, Any],
    segments: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
    budgets: Mapping[str, float],
    include_timeline: bool,
) -> dict[str, Any]:
    warnings = [item for item in anomalies if item["severity"] == "warning"]
    start = min(item["start_ms"] for item in segments)
    end = max(item["end_ms"] for item in segments)
    e2e = end - start

    names = sorted({item["stage"] for item in segments})
    stages = {name: _stage_summary(name) for name in names}
    intervals_by_stage = {name: [] for name in names}
    for segment in segments:
        stages[segment["stage"]]["occurrences"] += 1
        intervals_by_stage[segment["stage"]].append((segment["start_ms"], segment["end_ms"]))

    # Sweep event boundaries. At every active slice, each distinct active
    # stage receives an equal share of elapsed wall time.
    events: dict[float, dict[str, int]] = {}
    for segment in segments:
        if segment["start_ms"] == segment["end_ms"]:
            continue
        events.setdefault(segment["start_ms"], {})
        events.setdefault(segment["end_ms"], {})
        events[segment["start_ms"]][segment["stage"]] = events[segment["start_ms"]].get(segment["stage"], 0) + 1
        events[segment["end_ms"]][segment["stage"]] = events[segment["end_ms"]].get(segment["stage"], 0) - 1

    active_counts: dict[str, int] = {}
    previous = start
    coverage_slices: list[dict[str, Any]] = []
    for point in sorted(events):
        if point > previous:
            active_names = sorted(name for name, count in active_counts.items() if count > 0)
            duration = point - previous
            if active_names:
                share = duration / len(active_names)
                for name in active_names:
                    stages[name]["gross_duration_ms"] += duration
                    if len(active_names) == 1:
                        stages[name]["exclusive_ms"] += duration
                    else:
                        stages[name]["shared_wall_ms"] += duration
                        stages[name]["allocated_shared_ms"] += share
                    stages[name]["allocated_ms"] += share
            coverage_slices.append(
                {
                    "start_ms": previous,
                    "end_ms": point,
                    "duration_ms": duration,
                    "active_stages": active_names,
                    "type": "gap" if not active_names else ("exclusive" if len(active_names) == 1 else "shared"),
                }
            )
        for name, delta in events[point].items():
            active_counts[name] = active_counts.get(name, 0) + delta
        previous = point

    timeline = (
        [
            {
                "start_ms": _round(item["start_ms"]),
                "end_ms": _round(item["end_ms"]),
                "duration_ms": _round(item["duration_ms"]),
                "active_stages": item["active_stages"],
                "type": item["type"],
            }
            for item in coverage_slices
        ]
        if include_timeline
        else []
    )

    # Prefix integral of one stage's fair allocation. In a k-stage slice the
    # allocation rate is 1/k; gaps contribute zero.
    active_slices = [item for item in coverage_slices if item["active_stages"]]
    slice_starts = [item["start_ms"] for item in active_slices]
    slice_ends = [item["end_ms"] for item in active_slices]
    slice_counts = [len(item["active_stages"]) for item in active_slices]
    allocation_prefix = [0.0]
    for item in active_slices:
        allocation_prefix.append(allocation_prefix[-1] + item["duration_ms"] / len(item["active_stages"]))

    def allocation_at(point: float) -> float:
        index = bisect_right(slice_ends, point)
        if index >= len(active_slices):
            return allocation_prefix[-1]
        if point < slice_starts[index]:
            return allocation_prefix[index]
        return allocation_prefix[index] + (point - slice_starts[index]) / slice_counts[index]

    def allocation_integral(left: float, right: float) -> float:
        return max(allocation_at(right) - allocation_at(left), 0.0) if right > left else 0.0

    for name, summary in stages.items():
        budget = budgets.get(name)
        summary["budget_ms"] = budget
        if budget is None:
            continue
        remaining_budget = float(budget)
        contribution = 0.0
        # Merge this stage's own intervals before consuming its budget. That
        # prevents repeated stage instances which merely touch from hiding a
        # genuine overrun, and remains correct if future inputs allow them to
        # overlap.
        for segment_start, segment_end in _merge_intervals(intervals_by_stage[name]):
            length = segment_end - segment_start
            if remaining_budget >= length:
                remaining_budget -= length
                continue
            tail_start = segment_start + remaining_budget
            contribution += allocation_integral(tail_start, segment_end)
            remaining_budget = 0.0
        summary["e2e_overrun_contribution_ms"] = contribution
        summary["overage_ms"] = max(summary["gross_duration_ms"] - float(budget), 0.0)
        summary["overrun_hidden_by_overlap_ms"] = max(summary["overage_ms"] - contribution, 0.0)

    stage_results = [stages[name] for name in names]
    attributed_ms = sum(item["allocated_ms"] for item in stage_results)
    result = {
        "id": request_id,
        "name": request.get("name", request_id),
        "status": "warning" if warnings else "valid",
        "start_ms": start,
        "end_ms": end,
        "end_to_end_ms": e2e,
        "attributed_ms": attributed_ms,
        "unattributed_gap_ms": max(e2e - attributed_ms, 0.0),
        "segment_count": len(segments),
        "segments": segments,
        "stages": stage_results,
        "budget_overruns": [
            {
                "stage": item["stage"],
                "gross_duration_ms": item["gross_duration_ms"],
                "budget_ms": item["budget_ms"],
                "overage_ms": item["overage_ms"],
                "e2e_overrun_contribution_ms": item["e2e_overrun_contribution_ms"],
                "overrun_hidden_by_overlap_ms": item["overrun_hidden_by_overlap_ms"],
            }
            for item in stage_results
            if item["overage_ms"] and item["overage_ms"] > 0
        ],
        "anomalies": anomalies,
        "timeline": timeline,
    }
    return _round_deep(result)


def _normalise_budgets(budgets: Any) -> dict[str, float]:
    if budgets is None:
        return {}
    if not isinstance(budgets, Mapping):
        raise AnalysisError("Budgets must be an object mapping stage names to non-negative numbers.")
    normalised: dict[str, float] = {}
    for name, value in budgets.items():
        if not isinstance(name, str) or not name.strip() or not _is_number(value) or value < 0:
            raise AnalysisError(f"Budget for stage {name!r} must be a non-negative finite number.")
        normalised[name.strip()] = float(value)
    return normalised


def analyze_request(
    request: Mapping[str, Any],
    budgets: Mapping[str, float] | None = None,
    *,
    include_timeline: bool = True,
) -> dict[str, Any]:
    """Analyze one request and return a plain, JSON-serializable result.

    The function never mutates its arguments. A request with an error-level
    anomaly receives ``status='invalid'`` and no numeric stage attribution.
    """
    safe_budgets = _normalise_budgets(budgets)
    raw_id = request.get("id") if isinstance(request, Mapping) else None
    request_id = str(raw_id if raw_id is not None and str(raw_id).strip() else "unknown")
    segments, anomalies = _normalise_segments(request, request_id)

    fatal = [item for item in anomalies if item["severity"] == "error"]
    if not fatal and not segments:
        anomalies.append(_anomaly("empty_timeline", "Request has no positive-duration segments to attribute."))
        fatal = [anomalies[-1]]

    if not fatal:
        nesting = _find_nesting(segments)
        if nesting:
            anomalies.extend(nesting)
            fatal = [item for item in anomalies if item["severity"] == "error"]

    if fatal:
        raw_segments = []
        if isinstance(request, Mapping) and isinstance(request.get("segments"), list):
            raw_segments = deepcopy(request["segments"])
        return {
            "id": request_id,
            "name": request.get("name", request_id) if isinstance(request, Mapping) else request_id,
            "status": "invalid",
            "start_ms": None,
            "end_ms": None,
            "end_to_end_ms": None,
            "attributed_ms": None,
            "unattributed_gap_ms": None,
            "segment_count": len(raw_segments),
            "segments": segments,
            "input_segments": raw_segments,
            "stages": [],
            "budget_overruns": [],
            "anomalies": anomalies,
            "timeline": [],
        }

    return _valid_request_result(request_id, request, segments, anomalies, safe_budgets, include_timeline)


def analyze_batch(
    records: Any,
    budgets: Mapping[str, float] | None = None,
    *,
    include_timeline: bool = True,
) -> dict[str, Any]:
    """Analyze a batch without retaining any state between invocations."""
    if not isinstance(records, list):
        raise AnalysisError("The batch input must be a list of request records.")
    safe_budgets = _normalise_budgets(budgets)
    results = [
        analyze_request(record, safe_budgets, include_timeline=include_timeline)
        for record in records
    ]
    valid_results = [item for item in results if item["status"] != "invalid"]
    total_e2e = sum(float(item["end_to_end_ms"]) for item in valid_results)
    total_attributed = sum(float(item["attributed_ms"]) for item in valid_results)
    return {
        "summary": {
            "request_count": len(results),
            "valid_count": sum(1 for item in results if item["status"] == "valid"),
            "warning_count": sum(1 for item in results if item["status"] == "warning"),
            "invalid_count": sum(1 for item in results if item["status"] == "invalid"),
            "total_end_to_end_ms": _round(total_e2e),
            "total_attributed_ms": _round(total_attributed),
            "total_unattributed_gap_ms": _round(max(total_e2e - total_attributed, 0.0)),
        },
        "results": results,
    }


def _read_json_text(path: str | Path) -> Any:
    text = Path(path).read_text(encoding="utf-8-sig")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise AnalysisError(f"Could not parse JSON file {path}: {exc}") from exc


def load_records(path: str | Path) -> list[dict[str, Any]]:
    """Load records from a JSON array or an object with a ``requests`` array."""
    payload = _read_json_text(path)
    if isinstance(payload, list):
        return payload
    if isinstance(payload, Mapping) and isinstance(payload.get("requests"), list):
        return payload["requests"]
    raise AnalysisError("Input JSON must be an array or an object containing a 'requests' array.")


def load_budgets(path: str | Path) -> dict[str, float]:
    """Load stage budgets from a JSON object or an object's ``budgets`` key."""
    payload = _read_json_text(path)
    if isinstance(payload, Mapping) and isinstance(payload.get("budgets"), Mapping):
        payload = payload["budgets"]
    return _normalise_budgets(payload)
