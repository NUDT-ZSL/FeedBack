"""Offline JSON/CSV import helpers.

Only Python's standard library is used, so analysis works without network
access or installed third-party packages.
"""

import csv
import io
import json
import math
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

from .models import Record, ScaleAction

_ACTION_ALIASES = {
    "expand": "expand",
    "scale_up": "expand",
    "scale-up": "expand",
    "scaleout": "expand",
    "scale_out": "expand",
    "scale-out": "expand",
    "increase": "expand",
    "扩容": "expand",
    "shrink": "shrink",
    "scale_down": "shrink",
    "scale-down": "shrink",
    "scalein": "shrink",
    "scale_in": "shrink",
    "scale-in": "shrink",
    "decrease": "shrink",
    "缩容": "shrink",
}


def parse_datetime(value):
    # type: (Any) -> datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
    else:
        raise ValueError("timestamp must be a datetime or ISO-8601 string")
    if parsed.tzinfo is None:
        # Naive inputs are interpreted as UTC to make mixed batches explicit
        # and deterministic in an offline tool.
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _number(data, names, required=True, default=None):
    for name in names:
        if name in data and data[name] not in (None, ""):
            value = float(data[name])
            if not math.isfinite(value):
                raise ValueError("%s must be finite" % name)
            return value
    if required:
        raise ValueError("missing numeric field: %s" % names[0])
    return default


def parse_action(value, amount=None, quota_after=None, note=None):
    # type: (Any, Any, Any, Any) -> Optional[ScaleAction]
    if value in (None, "") and amount in (None, "") and quota_after in (None, ""):
        return None
    kind = ""
    action_note = note
    action_amount = amount
    action_quota_after = quota_after
    if isinstance(value, dict):
        kind = str(value.get("kind", value.get("action", ""))).strip().lower()
        action_amount = value.get("amount", action_amount)
        action_quota_after = value.get("quota_after", action_quota_after)
        action_note = value.get("note", action_note)
    elif value not in (None, ""):
        kind = str(value).strip().lower()
        if ":" in kind and action_amount in (None, ""):
            kind, action_amount = kind.rsplit(":", 1)
            kind = kind.strip()
    normalized = _ACTION_ALIASES.get(kind.replace(" ", "_"))
    if not normalized:
        raise ValueError("unknown scale action: %r" % kind)
    amount_value = _number({"v": action_amount}, ("v",), False) if action_amount not in (None, "") else None
    quota_after_value = (
        _number({"v": action_quota_after}, ("v",), False)
        if action_quota_after not in (None, "")
        else None
    )
    return ScaleAction(normalized, amount_value, quota_after_value, action_note)


def record_from_mapping(data, ingestion_order=0):
    # type: (Dict[str, Any], int) -> Record
    if not isinstance(data, dict):
        raise ValueError("each record must be an object")
    get = lambda *names: next((data[n] for n in names if n in data and data[n] not in (None, "")), None)
    resource_id = get("resource_id", "resource", "resourceId")
    if not resource_id:
        raise ValueError("record is missing resource_id")
    timestamp = parse_datetime(get("observed_at", "timestamp", "collected_at", "time"))
    usage = _number(data, ("usage", "used", "usage_value"))
    quota = _number(data, ("quota", "limit", "capacity"))
    if usage < 0:
        raise ValueError("usage must be non-negative")
    if quota <= 0:
        raise ValueError("quota must be positive")
    action = parse_action(
        get("action", "scale_action"),
        get("action_amount", "amount"),
        get("quota_after", "action_quota_after"),
        get("note"),
    )
    if action and action.amount is not None and action.amount < 0:
        raise ValueError("action amount must be non-negative; encode shrink as action='shrink'")
    if action and action.quota_after is not None and action.quota_after <= 0:
        raise ValueError("action quota_after must be positive")
    return Record(
        str(resource_id),
        timestamp,
        usage,
        quota,
        action,
        str(get("record_id", "recordId")) if get("record_id", "recordId") is not None else None,
        int(ingestion_order),
    )


def records_from_dicts(rows):
    # type: (Iterable[Dict[str, Any]]) -> List[Record]
    return [record_from_mapping(row, i) for i, row in enumerate(rows)]


def records_from_json_text(text):
    # type: (str) -> List[Record]
    payload = json.loads(text)
    if isinstance(payload, dict) and isinstance(payload.get("records"), list):
        rows = payload["records"]
    elif isinstance(payload, list):
        rows = payload
    else:
        raise ValueError("JSON input must be a list or an object with a records list")
    return records_from_dicts(rows)


def records_from_csv_text(text):
    # type: (str) -> List[Record]
    reader = csv.DictReader(io.StringIO(text))
    return records_from_dicts(dict(row) for row in reader)
