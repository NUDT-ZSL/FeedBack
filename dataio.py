"""CSV import helpers used by both the API and command-line checks."""

from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

from scheduler import SLOT_MINUTES, SLOTS


def time_to_slot(value: Any) -> int:
    """Accept HH:MM, decimal hours, or an integer five-minute slot index."""
    if value in (None, ""):
        return 0
    text = str(value).strip()
    if ":" in text:
        hour_text, minute_text = text.split(":", 1)
        hours = int(hour_text)
        minutes = int(float(minute_text))
        slot = (hours * 60 + minutes) // SLOT_MINUTES
    else:
        number = float(text)
        slot = int(round(number if number > 24 else number * 60 / SLOT_MINUTES))
    return max(0, min(SLOTS, slot))


def read_csv(text: str) -> List[Dict[str, str]]:
    lines = [line for line in text.replace("\ufeff", "").splitlines() if line.strip()]
    if not lines:
        return []
    return list(csv.DictReader(lines, skipinitialspace=True))


def parse_devices_csv(text: str) -> List[Dict[str, Any]]:
    rows = read_csv(text)
    output = []
    for index, row in enumerate(rows):
        item: Dict[str, Any] = {
            "id": (row.get("id") or row.get("device_id") or f"D{index + 1}").strip(),
            "name": (row.get("name") or "").strip(),
            "modes": (row.get("modes") or "").strip(),
            "shift_start": time_to_slot(row.get("shift_start") or row.get("available_start") or 0),
            "shift_end": time_to_slot(row.get("shift_end") or row.get("available_end") or 24),
            "max_run_slots": int(float(row.get("max_run_slots") or row.get("capacity_limit") or SLOTS)),
        }
        for key, value in row.items():
            if key and "maintenance" in key.lower() and value:
                parsed = []
                for window in str(value).split(";"):
                    if not window.strip():
                        continue
                    raw_start, raw_end = window.split("-", 1) if "-" in window else window.split(",", 1)
                    parsed.append(f"{time_to_slot(raw_start)},{time_to_slot(raw_end)}")
                if parsed:
                    item["maintenance_window"] = ";".join(parsed)
        output.append(item)
    return output


def parse_tasks_csv(text: str) -> List[Dict[str, Any]]:
    output = []
    for index, row in enumerate(read_csv(text)):
        output.append(
            {
                "id": (row.get("id") or row.get("task_id") or f"T{index + 1}").strip(),
                "name": (row.get("name") or "").strip(),
                "quantity": float(row.get("quantity") or row.get("demand") or 0),
                "release": time_to_slot(row.get("release") or 0),
                "deadline": time_to_slot(row.get("deadline") or row.get("due") or 24),
                "priority": int(float(row.get("priority") or 1)),
                "depends_on": (row.get("depends_on") or row.get("dependencies") or "").strip(),
                "allowed_devices": (row.get("allowed_devices") or row.get("devices") or "").strip(),
            }
        )
    return output


def parse_transitions_csv(text: str) -> List[Dict[str, Any]]:
    result = []
    for row in read_csv(text):
        result.append(
            {
                "device_id": row.get("device_id") or row.get("device"),
                "from": row.get("from") or row.get("from_mode") or "OFF",
                "to": row.get("to") or row.get("to_mode"),
                "duration_slots": int(float(row.get("duration_slots") or row.get("slots") or 1)),
                "rate": float(row.get("rate") or row.get("power") or 0),
            }
        )
    return result


def load_sample(base: str | Path = "sample") -> Dict[str, Any]:
    root = Path(base)
    return {
        "devices": parse_devices_csv((root / "devices.csv").read_text(encoding="utf-8")),
        "tasks": parse_tasks_csv((root / "tasks.csv").read_text(encoding="utf-8")),
        "transitions": parse_transitions_csv((root / "transitions.csv").read_text(encoding="utf-8")),
        "tariff": json.loads((root / "tariff.json").read_text(encoding="utf-8"))["tariff"],
    }


def parse_uploaded(files: Dict[str, str]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    devices = parse_devices_csv(files.get("devices", ""))
    tasks = parse_tasks_csv(files.get("tasks", ""))
    transitions = parse_transitions_csv(files.get("transitions", ""))
    return devices, tasks, transitions
