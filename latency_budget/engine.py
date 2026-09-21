"""Stateless latency attribution engine.

The engine uses only the Python standard library and keeps no global analysis
state.  Numeric timestamps and durations are interpreted as milliseconds.
ISO-8601 strings are also accepted, but a single request cannot mix the two.

Attribution method:
* Time covered by exactly one active distinct stage is "exclusive" time.
* Time covered by ``n`` concurrently active distinct stages is common
  occupancy.  That wall time is counted once and allocated 1/n to each stage.
* Gaps are attributed to idle/unattributed end-to-end time.
* A stage's actual occupancy is the union of all of that stage's intervals, so
  overlapping fragments belonging to the same stage are not double counted.

Nested intervals and inverted timestamps are hard errors.  Such a request is
marked invalid and receives no attribution totals, preventing misleading
numbers from being displayed as fact.
"""

from __future__ import annotations

import json
import math
import heapq
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _round_ms(value: float | None) -> float | None:
    if value is None:
        return None
    return round(float(value), 3)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _issue(code: str, message: str, severity: str = "error", **extra: Any) -> dict[str, Any]:
    result = {"code": code, "severity": severity, "message": message}
    result.update(extra)
    return result


def _parse_time(value: Any) -> float:
    """Parse a millisecond number or ISO-8601 timestamp to epoch ms."""
    if _is_number(value):
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("numeric timestamp must be finite")
        return number
    if isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError("timestamp is empty")
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.timestamp() * 1000.0
    raise ValueError("timestamp must be a number or ISO-8601 string")


def _time_kind(value: Any) -> str:
    return "numeric" if _is_number(value) else "iso"


def load_json_file(path: str | Path) -> Any:
    """Load a JSON input file using UTF-8 encoding."""
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _normalize_records(payload: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    if isinstance(payload, dict) and isinstance(payload.get("requests"), list):
        raw_records = payload["requests"]
    elif isinstance(payload, list):
        raw_records = payload
    else:
        return [], [_issue("INVALID_BATCH", "Input must be a list or an object containing a requests list.")]

    records: list[dict[str, Any]] = []
    for index, record in enumerate(raw_records):
        if not isinstance(record, dict):
            errors.append(_issue("INVALID_REQUEST", "Each request must be an object.", request_index=index))
            continue
        copied = dict(record)
        if copied.get("id") is None:
            copied["id"] = f"request-{index + 1}"
        records.append(copied)
    return records, errors


def _normalize_budgets(raw_budgets: Any) -> tuple[dict[str, float], list[dict[str, Any]]]:
    if raw_budgets is None:
        return {}, []
    if not isinstance(raw_budgets, dict):
        return {}, [_issue("INVALID_BUDGET", "Stage budgets must be provided as an object mapping stage names to milliseconds.")]

    budgets: dict[str, float] = {}
    errors: list[dict[str, Any]] = []
    for stage, value in raw_budgets.items():
        if not isinstance(stage, str) or not stage.strip():
            errors.append(_issue("INVALID_BUDGET", "Budget stage names must be non-empty strings.", stage=str(stage)))
            continue
        if isinstance(value, str):
            try:
                value = float(value.strip())
            except ValueError:
                value = float("nan")
        if not _is_number(value) or not math.isfinite(float(value)) or float(value) < 0:
            errors.append(_issue("INVALID_BUDGET", "Budget must be a finite non-negative number of milliseconds.", stage=stage, value=value))
            continue
        budgets[stage] = float(value)
    return budgets, errors


def _first_present(mapping: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def _normalize_fragments(
    record: dict[str, Any], request_index: int
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], str | None]:
    raw_fragments = _first_present(record, ("fragments", "segments", "phases", "spans"))
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    fragments: list[dict[str, Any]] = []

    if raw_fragments is None or (isinstance(raw_fragments, list) and len(raw_fragments) == 0):
        errors.append(_issue("MISSING_FRAGMENTS", "Request does not contain a fragments list.", request_index=request_index))
        return fragments, errors, warnings, None
    if not isinstance(raw_fragments, list):
        errors.append(_issue("INVALID_FRAGMENTS", "Fragments must be a list.", request_index=request_index))
        return fragments, errors, warnings, None

    timestamp_kind: str | None = None
    for index, raw_fragment in enumerate(raw_fragments):
        if not isinstance(raw_fragment, dict):
            errors.append(_issue("INVALID_FRAGMENT", "Each fragment must be an object.", request_index=request_index, fragment_index=index))
            continue
        stage = _first_present(raw_fragment, ("stage", "stage_name", "name", "phase"))
        if not isinstance(stage, str) or not stage.strip():
            errors.append(
                _issue("MISSING_STAGE_NAME", "Fragment is missing a non-empty stage name.",
                       request_index=request_index, fragment_index=index, fragment_id=raw_fragment.get("id"))
            )
            continue
        stage = stage.strip()
        raw_start = _first_present(raw_fragment, ("start", "start_time", "startTime", "begin", "begin_time", "from"))
        raw_end = _first_present(raw_fragment, ("end", "end_time", "endTime", "finish", "finish_time", "to"))
        if raw_start is None or raw_end is None:
            errors.append(
                _issue("MISSING_TIMESTAMP", "Fragment must have both start and end timestamps.",
                       request_index=request_index, fragment_index=index, fragment_id=raw_fragment.get("id"), stage=stage)
            )
            continue
        kinds = {_time_kind(raw_start), _time_kind(raw_end)}
        if len(kinds) > 1:
            errors.append(
                _issue("MIXED_TIMESTAMP_TYPES", "Fragment start and end must use the same timestamp type.",
                       request_index=request_index, fragment_index=index, fragment_id=raw_fragment.get("id"), stage=stage)
            )
            continue
        fragment_kind = next(iter(kinds))
        if timestamp_kind is None:
            timestamp_kind = fragment_kind
        elif fragment_kind != timestamp_kind:
            errors.append(
                _issue("MIXED_TIMESTAMP_TYPES", "All fragments in a request must use the same timestamp type.",
                       request_index=request_index, fragment_index=index, fragment_id=raw_fragment.get("id"), stage=stage)
            )
            continue
        try:
            start_ms = _parse_time(raw_start)
            end_ms = _parse_time(raw_end)
        except ValueError as exc:
            errors.append(
                _issue("INVALID_TIMESTAMP", str(exc), request_index=request_index,
                       fragment_index=index, fragment_id=raw_fragment.get("id"), stage=stage)
            )
            continue
        fragment_id = raw_fragment.get("id") if raw_fragment.get("id") is not None else f"f{index + 1}"
        normalized = {
            "id": str(fragment_id), "stage": stage, "start_ms": start_ms, "end_ms": end_ms,
            "raw_start": raw_start, "raw_end": raw_end, "fragment_index": index,
        }
        if end_ms < start_ms:
            errors.append(_issue("TIME_INVERSION", f"Fragment '{stage}' ends before it starts.",
                                 request_index=request_index, fragment_index=index,
                                 fragment_id=normalized["id"], stage=stage,
                                 start_ms=_round_ms(start_ms), end_ms=_round_ms(end_ms)))
        elif end_ms == start_ms:
            warnings.append(_issue("ZERO_DURATION", f"Fragment '{stage}' has zero duration and is excluded from attribution.",
                                   severity="warning", request_index=request_index, fragment_index=index,
                                   fragment_id=normalized["id"], stage=stage))
        fragments.append(normalized)
    return fragments, errors, warnings, timestamp_kind


def _find_nested_intervals(fragments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Detect strict nesting in O(n log n); touching and exact overlaps are allowed."""
    intervals = sorted(
        (item for item in fragments if item["end_ms"] > item["start_ms"]),
        key=lambda item: (item["start_ms"], item["end_ms"], item["id"]),
    )
    errors: list[dict[str, Any]] = []
    nested: set[str] = set()
    max_heap: list[tuple[float, str, dict[str, Any]]] = []
    active_ids: set[str] = set()

    group_start = 0
    while group_start < len(intervals):
        group_end = group_start + 1
        start = intervals[group_start]["start_ms"]
        while group_end < len(intervals) and intervals[group_end]["start_ms"] == start:
            group_end += 1
        group = intervals[group_start:group_end]

        while max_heap and max_heap[0][1] not in active_ids:
            heapq.heappop(max_heap)
        while max_heap and -max_heap[0][0] <= start:
            _end, expired_id, _fragment = heapq.heappop(max_heap)
            active_ids.discard(expired_id)
        while max_heap and max_heap[0][1] not in active_ids:
            heapq.heappop(max_heap)

        for fragment in group:
            if max_heap and -max_heap[0][0] > fragment["end_ms"]:
                outer = max_heap[0][2]
                nested.add(fragment["id"])
                errors.append(
                    _issue(
                        "NESTED_FRAGMENT",
                        f"Fragment '{fragment['stage']}' is nested inside '{outer['stage']}'.",
                        fragment_id=fragment["id"],
                        nested_in_fragment_id=outer["id"],
                        stage=fragment["stage"],
                        outer_stage=outer["stage"],
                    )
                )

        max_end = max(item["end_ms"] for item in group)
        longest = next(item for item in group if item["end_ms"] == max_end)
        for fragment in group:
            if fragment["end_ms"] < max_end and fragment["id"] not in nested:
                nested.add(fragment["id"])
                errors.append(
                    _issue(
                        "NESTED_FRAGMENT",
                        f"Fragment '{fragment['stage']}' starts with and ends inside '{longest['stage']}'.",
                        fragment_id=fragment["id"],
                        nested_in_fragment_id=longest["id"],
                        stage=fragment["stage"],
                        outer_stage=longest["stage"],
                    )
                )

        for fragment in group:
            active_ids.add(fragment["id"])
            heapq.heappush(max_heap, (-fragment["end_ms"], fragment["id"], fragment))
        group_start = group_end
    return errors


def _same_stage_overlap_warnings(fragments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events: list[tuple[float, int, str, str]] = []
    for fragment in fragments:
        if fragment["end_ms"] <= fragment["start_ms"]:
            continue
        events.append((fragment["start_ms"], 1, fragment["stage"], fragment["id"]))
        events.append((fragment["end_ms"], 0, fragment["stage"], fragment["id"]))
    events.sort(key=lambda item: (item[0], item[1]))

    warnings: list[dict[str, Any]] = []
    active: dict[str, set[str]] = defaultdict(set)
    warned: set[str] = set()
    previous_time = None
    for time, kind, stage, fragment_id in events:
        if previous_time is not None and time > previous_time:
            for name, ids in active.items():
                if len(ids) > 1 and name not in warned:
                    warned.add(name)
                    warnings.append(
                        _issue(
                            "SAME_STAGE_OVERLAP",
                            f"Multiple fragments for stage '{name}' overlap; its occupancy is measured as a union.",
                            severity="warning",
                            stage=name,
                            fragment_ids=sorted(ids),
                        )
                    )
        if kind == 1:
            active[stage].add(fragment_id)
        else:
            active[stage].discard(fragment_id)
        previous_time = time
    return warnings


def _attribute_fragments(fragments: list[dict[str, Any]]) -> dict[str, Any]:
    positive = [item for item in fragments if item["end_ms"] > item["start_ms"]]
    min_start = min((item["start_ms"] for item in positive), default=0.0)
    max_end = max((item["end_ms"] for item in positive), default=0.0)

    events: list[tuple[float, int, str, str]] = []
    gross_by_stage: dict[str, float] = defaultdict(float)
    counts_by_stage: dict[str, int] = defaultdict(int)
    for fragment in positive:
        events.append((fragment["start_ms"], 1, fragment["stage"], fragment["id"]))
        events.append((fragment["end_ms"], 0, fragment["stage"], fragment["id"]))
        gross_by_stage[fragment["stage"]] += fragment["end_ms"] - fragment["start_ms"]
        counts_by_stage[fragment["stage"]] += 1
    events.sort(key=lambda item: (item[0], item[1]))

    active: dict[str, set[str]] = defaultdict(set)
    previous_time: float | None = None
    exclusive_total = shared_wall_total = idle_total = active_wall_total = 0.0
    stages = sorted(gross_by_stage)
    zeros = {stage: 0.0 for stage in stages}
    union_by_stage = dict(zeros)
    exclusive_by_stage = dict(zeros)
    shared_wall_by_stage = dict(zeros)
    allocated_shared_by_stage = dict(zeros)

    for time, kind, stage, fragment_id in events:
        if previous_time is not None and time > previous_time:
            delta = time - previous_time
            active_stages = {name for name, ids in active.items() if ids}
            active_count = len(active_stages)
            if active_count == 0:
                idle_total += delta
            else:
                active_wall_total += delta
                for name in active_stages:
                    union_by_stage[name] += delta
                if active_count == 1:
                    name = next(iter(active_stages))
                    exclusive_total += delta
                    exclusive_by_stage[name] += delta
                else:
                    shared_wall_total += delta
                    allocation = delta / active_count
                    for name in active_stages:
                        shared_wall_by_stage[name] += delta
                        allocated_shared_by_stage[name] += allocation
        if kind == 1:
            active[stage].add(fragment_id)
        else:
            active[stage].discard(fragment_id)
        previous_time = time

    stage_stats = {}
    for stage in stages:
        stage_stats[stage] = {
            "stage": stage,
            "fragment_count": counts_by_stage[stage],
            "gross_fragment_duration": gross_by_stage[stage],
            "actual_occupied_duration": union_by_stage[stage],
            "exclusive_duration": exclusive_by_stage[stage],
            "shared_wall_duration": shared_wall_by_stage[stage],
            "allocated_shared_duration": allocated_shared_by_stage[stage],
            "e2e_contribution_duration": exclusive_by_stage[stage] + allocated_shared_by_stage[stage],
        }

    return {
        "timestamp_origin_ms": min_start,
        "end_to_end_duration": max_end - min_start if positive else 0.0,
        "active_duration": active_wall_total,
        "idle_duration": idle_total,
        "exclusive_duration": exclusive_total,
        "shared_wall_duration": shared_wall_total,
        "stage_stats": stage_stats,
    }


def _public_fragment(fragment: dict[str, Any], origin: float) -> dict[str, Any]:
    return {
        "id": fragment["id"],
        "stage": fragment["stage"],
        "start_ms": _round_ms(fragment["start_ms"] - origin),
        "end_ms": _round_ms(fragment["end_ms"] - origin),
        "duration_ms": _round_ms(fragment["end_ms"] - fragment["start_ms"]),
        "raw_start": fragment["raw_start"],
        "raw_end": fragment["raw_end"],
        "fragment_index": fragment["fragment_index"],
    }


def _apply_budgets(
    attribution: dict[str, Any], budgets: dict[str, float]
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    stage_stats = attribution["stage_stats"]
    for stage in budgets:
        if stage not in stage_stats:
            stage_stats[stage] = {
                "stage": stage,
                "fragment_count": 0,
                "gross_fragment_duration": 0.0,
                "actual_occupied_duration": 0.0,
                "exclusive_duration": 0.0,
                "shared_wall_duration": 0.0,
                "allocated_shared_duration": 0.0,
                "e2e_contribution_duration": 0.0,
            }

    total_budget = total_actual = total_contribution = total_overrun = 0.0
    overruns: list[dict[str, Any]] = []
    for stage, stat in stage_stats.items():
        budget = budgets.get(stage)
        actual = stat["actual_occupied_duration"]
        contribution = stat["e2e_contribution_duration"]
        overrun = max(0.0, actual - budget) if budget is not None else None
        headroom = max(0.0, budget - actual) if budget is not None else None
        utilization = actual / budget if budget not in (None, 0.0) and budget > 0 else None
        stat.update(
            {
                "budget_ms": budget,
                "overrun_ms": overrun,
                "headroom_ms": headroom,
                "budget_utilization_ratio": utilization,
            }
        )
        if budget is not None:
            total_budget += budget
            total_actual += actual
            total_contribution += contribution
            total_overrun += max(0.0, overrun or 0.0)
            if overrun and overrun > 0:
                overruns.append(
                    {
                        "stage": stage,
                        "budget_ms": budget,
                        "actual_occupied_duration": actual,
                        "overrun_ms": overrun,
                        "e2e_contribution_duration": contribution,
                        "exclusive_duration": stat["exclusive_duration"],
                        "allocated_shared_duration": stat["allocated_shared_duration"],
                    }
                )

    overruns.sort(key=lambda item: item["overrun_ms"], reverse=True)
    budget_summary = {
        "configured": bool(budgets),
        "total_budget_ms": total_budget,
        "total_actual_occupied_duration": total_actual,
        "total_e2e_contribution_duration": total_contribution,
        "total_stage_overrun_ms": total_overrun,
        "overruns": overruns,
    }
    return budget_summary, []


def _round_deep(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _round_deep(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_round_deep(item) for item in value]
    if isinstance(value, float):
        return round(value, 3)
    return value


def analyze_request(
    record: dict[str, Any],
    budgets: dict[str, Any] | None = None,
    *,
    request_index: int = 0,
    include_segments: bool = True,
) -> dict[str, Any]:
    """Analyze one request. This function is pure and keeps no cached state."""
    if not isinstance(record, dict):
        return {
            "request_index": request_index,
            "id": None,
            "status": "invalid",
            "errors": [_issue("INVALID_REQUEST", "Request must be an object.", request_index=request_index)],
            "warnings": [],
        }

    normalized_budgets, budget_errors = _normalize_budgets(budgets)
    request_id = str(record.get("id") if record.get("id") is not None else f"request-{request_index + 1}")
    fragments, fragment_errors, fragment_warnings, timestamp_kind = _normalize_fragments(record, request_index)
    nesting_errors = []
    if not fragment_errors:
        nesting_errors = _find_nested_intervals(
            [item for item in fragments if item["end_ms"] > item["start_ms"]]
        )
    errors = budget_errors + fragment_errors + nesting_errors
    warnings = list(fragment_warnings)
    origin = min(
        (min(item["start_ms"], item["end_ms"]) for item in fragments),
        default=0.0,
    )

    base = {
        "request_index": request_index,
        "id": request_id,
        "name": record.get("name", request_id),
        "timestamp_type": timestamp_kind,
        "errors": errors,
        "warnings": warnings,
        "fragment_count": len(_first_present(record, ("fragments", "segments", "phases", "spans")) or []),
    }
    if include_segments:
        base["segments"] = [_public_fragment(item, origin) for item in fragments]

    if errors:
        base["status"] = "invalid"
        return _round_deep(base)

    overlap_warnings = _same_stage_overlap_warnings(fragments)
    warnings.extend(overlap_warnings)
    attribution = _attribute_fragments(fragments)
    budget_summary, unused_warnings = _apply_budgets(attribution, normalized_budgets)
    warnings.extend(unused_warnings)

    base.update(
        {
            "status": "warning" if warnings else "valid",
            "end_to_end_duration_ms": attribution["end_to_end_duration"],
            "active_duration_ms": attribution["active_duration"],
            "idle_duration_ms": attribution["idle_duration"],
            "exclusive_duration_ms": attribution["exclusive_duration"],
            "shared_wall_duration_ms": attribution["shared_wall_duration"],
            "stage_attribution": attribution["stage_stats"],
            "budget_summary": budget_summary,
        }
    )
    return _round_deep(base)


def analyze_batch(
    payload: Any,
    budgets: dict[str, Any] | None = None,
    *,
    include_segments: bool = False,
) -> dict[str, Any]:
    """Analyze a batch and return a fresh result derived only from arguments."""
    records, batch_errors = _normalize_records(payload)
    normalized_budgets, budget_errors = _normalize_budgets(budgets)
    all_errors = batch_errors + budget_errors
    if all_errors:
        return {
            "status": "invalid",
            "request_count": len(records),
            "valid_count": 0,
            "warning_count": 0,
            "invalid_count": len(records),
            "batch_errors": all_errors,
            "requests": [],
        }

    results = [
        analyze_request(record, normalized_budgets, request_index=index, include_segments=include_segments)
        for index, record in enumerate(records)
    ]
    valid_count = sum(1 for item in results if item["status"] == "valid")
    warning_count = sum(1 for item in results if item["status"] == "warning")
    invalid_count = sum(1 for item in results if item["status"] == "invalid")
    return {
        "status": "invalid" if invalid_count else ("warning" if warning_count else "valid"),
        "request_count": len(results),
        "valid_count": valid_count,
        "warning_count": warning_count,
        "invalid_count": invalid_count,
        "batch_errors": [],
        "requests": results,
    }
