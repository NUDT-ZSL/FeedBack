from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
import math
from typing import Any


class ActionType(str, Enum):
    EXPAND = "expand"
    SHRINK = "shrink"


ACTION_ALIASES = {
    "expand": ActionType.EXPAND,
    "scale_up": ActionType.EXPAND,
    "scaleup": ActionType.EXPAND,
    "add_capacity": ActionType.EXPAND,
    "扩容": ActionType.EXPAND,
    "shrink": ActionType.SHRINK,
    "scale_down": ActionType.SHRINK,
    "scaledown": ActionType.SHRINK,
    "缩容": ActionType.SHRINK,
}


def _finite_number(value: Any, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    if isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError as exc:
            raise ValueError(f"{name} must be a number") from exc
    elif isinstance(value, (int, float)):
        number = float(value)
    else:
        raise ValueError(f"{name} must be a number")
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{name} must be a finite non-negative number")
    return number


@dataclass(frozen=True)
class Action:
    type: ActionType
    amount: float | None = None
    unit: str = "units"
    note: str | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.type, ActionType):
            raise ValueError("action type must be ActionType")
        if self.amount is not None:
            object.__setattr__(self, "amount", _finite_number(self.amount, "action amount"))

    @classmethod
    def from_value(cls, value: Any) -> "Action | None":
        if value is None or value == "":
            return None
        if isinstance(value, Action):
            return value
        if isinstance(value, str):
            kind = ACTION_ALIASES.get(value.strip().lower())
            if kind is None:
                raise ValueError(f"unsupported action type: {value}")
            return cls(kind)
        if not isinstance(value, dict):
            raise ValueError("action must be an object or string")
        raw_type = value.get("type") or value.get("action_type")
        if raw_type in (None, ""):
            return None
        kind = ACTION_ALIASES.get(str(raw_type).strip().lower())
        if kind is None:
            raise ValueError(f"unsupported action type: {raw_type}")
        amount = value.get("amount", value.get("action_amount"))
        return cls(
            kind,
            None if amount in (None, "") else amount,
            str(value.get("unit") or value.get("action_unit") or "units"),
            value.get("note") or value.get("action_note"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type.value, "amount": self.amount, "unit": self.unit, "note": self.note}


@dataclass(frozen=True)
class Record:
    record_id: str
    resource_id: str
    timestamp: datetime
    usage: float
    quota: float
    action: Action | None = None
    ingestion_order: int | None = field(default=None, compare=False)

    def __post_init__(self) -> None:
        if not isinstance(self.record_id, str) or not self.record_id:
            raise ValueError("record_id must be a non-empty string")
        if not isinstance(self.resource_id, str) or not self.resource_id:
            raise ValueError("resource_id must be a non-empty string")
        if not isinstance(self.timestamp, datetime):
            raise ValueError("timestamp must be a datetime")
        if self.timestamp.tzinfo is None:
            raise ValueError("timestamp must include a timezone, such as Z or +08:00")
        object.__setattr__(self, "usage", _finite_number(self.usage, "usage"))
        object.__setattr__(self, "quota", _finite_number(self.quota, "quota"))
        object.__setattr__(self, "action", Action.from_value(self.action))

    def to_dict(self) -> dict[str, Any]:
        return {
            "record_id": self.record_id,
            "resource_id": self.resource_id,
            "timestamp": self.timestamp.isoformat(),
            "usage": self.usage,
            "quota": self.quota,
            "action": None if self.action is None else self.action.to_dict(),
        }


@dataclass(frozen=True)
class PredictionWindow:
    horizon: timedelta
    interval: timedelta

    def __post_init__(self) -> None:
        if self.horizon <= timedelta(0):
            raise ValueError("horizon must be positive")
        if self.interval <= timedelta(0):
            raise ValueError("interval must be positive")
        if self.interval > self.horizon:
            raise ValueError("interval must not be greater than horizon")

    @property
    def step_count(self) -> int:
        return int(self.horizon // self.interval)

    def points_from(self, origin: datetime) -> list[datetime]:
        points = [origin + self.interval * index for index in range(1, self.step_count + 1)]
        endpoint = origin + self.horizon
        if not points or points[-1] != endpoint:
            points.append(endpoint)
        return points

    @property
    def fingerprint(self) -> tuple[float, float]:
        return (self.horizon.total_seconds(), self.interval.total_seconds())


@dataclass(frozen=True)
class Conflict:
    timestamp: datetime
    record_ids: list[str]
    usage_values: dict[str, float]
    quota_values: dict[str, float]
    conflicting_fields: list[str]
    severity: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "record_ids": list(self.record_ids),
            "usage_values": dict(self.usage_values),
            "quota_values": dict(self.quota_values),
            "conflicting_fields": list(self.conflicting_fields),
            "severity": self.severity,
        }
