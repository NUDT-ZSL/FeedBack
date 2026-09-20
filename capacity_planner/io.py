from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Iterable

from .models import Record
from .timeutils import parse_timestamp


def load_records(path: str | Path, format: str | None = None) -> list[Record]:
    file_path = Path(path)
    selected = format or file_path.suffix.lower().lstrip(".")
    with file_path.open("r", encoding="utf-8-sig", newline="") as stream:
        text = stream.read()
    if selected == "json":
        return parse_json(text)
    if selected == "csv":
        return parse_csv(text)
    raise ValueError("format must be 'json' or 'csv'")


def parse_json(text: str) -> list[Record]:
    payload = json.loads(text)
    if isinstance(payload, dict):
        raw_records = payload.get("records")
    else:
        raw_records = payload
    if not isinstance(raw_records, list):
        raise ValueError("JSON payload must be a list or an object with a records list")
    return [
        _record_from_mapping(item, index, fallback_id=f"json-{index}")
        for index, item in enumerate(raw_records, start=1)
    ]


def parse_csv(text: str) -> list[Record]:
    reader = csv.DictReader(text.lstrip("\ufeff").splitlines())
    if reader.fieldnames is None:
        raise ValueError("CSV input requires a header row")
    records = []
    for line_number, row in enumerate(reader, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue
        data = {key.strip(): value for key, value in row.items() if key is not None}
        fallback_id = f"csv-line-{line_number}"
        record_data = dict(data)
        action_type = _blank_to_none(record_data.pop("action_type", None))
        if action_type is not None:
            record_data.pop("unit", None)
            record_data["action"] = {
                "type": action_type,
                "amount": _blank_to_none(record_data.pop("action_amount", None)),
                "unit": _blank_to_none(record_data.pop("action_unit", None)),
                "note": _blank_to_none(record_data.pop("action_note", None)),
            }
        for unused in ("action_amount", "action_unit", "action_note"):
            record_data.pop(unused, None)
        records.append(_record_from_mapping(record_data, line_number, fallback_id=fallback_id))
    return records


def _record_from_mapping(raw: Any, position: int, fallback_id: str) -> Record:
    if not isinstance(raw, dict):
        raise ValueError(f"record at position {position} must be an object")
    try:
        data = dict(raw)
        record_id = str(data.pop("record_id", data.pop("id", None)) or fallback_id)
        resource_id = data.pop("resource_id", data.pop("resource", None))
        timestamp = data.pop("timestamp", data.pop("collected_at", None))
        usage = data.pop("usage", data.pop("usage_value", None))
        quota = data.pop("quota", data.pop("quota_value", None))
        return Record(
            record_id=record_id,
            resource_id=str(resource_id),
            timestamp=parse_timestamp(timestamp),
            usage=_number(usage, "usage"),
            quota=_number(quota, "quota"),
            action=data.pop("action", None),
        )
    except (TypeError, ValueError) as exc:
        raise ValueError(f"invalid record at position {position}: {exc}") from exc


def _number(value: Any, name: str) -> float:
    if value in (None, ""):
        raise ValueError(f"{name} is required")
    if isinstance(value, str):
        value = value.strip()
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be numeric") from exc


def _blank_to_none(value: Any) -> Any:
    if value is None:
        return None
    text = str(value).strip()
    return None if text == "" else text
