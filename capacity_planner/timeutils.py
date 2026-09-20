from __future__ import annotations

from datetime import datetime, timedelta
import re


def parse_timestamp(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        text = value.strip()
        if text.endswith(("Z", "z")):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError as exc:
            raise ValueError(f"invalid ISO-8601 timestamp: {value}") from exc
    else:
        raise ValueError("timestamp must be an ISO-8601 string or datetime")
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp must include a timezone: {value}")
    return parsed


_DURATION = re.compile(
    r"^\s*(?:(?P<weeks>\d+)\s*w)?"
    r"\s*(?:(?P<days>\d+)\s*d)?"
    r"\s*(?:(?P<hours>\d+)\s*h)?"
    r"\s*(?:(?P<minutes>\d+)\s*m)?\s*$",
    re.IGNORECASE,
)


def parse_duration(value: str | timedelta) -> timedelta:
    if isinstance(value, timedelta):
        return value
    if not isinstance(value, str):
        raise ValueError("duration must be a string or timedelta")
    text = value.strip()
    if text.startswith("P"):
        return _parse_iso_duration(text)
    match = _DURATION.match(text)
    if not match or not any(match.group(name) for name in ("weeks", "days", "hours", "minutes")):
        raise ValueError(f"invalid duration: {value}")
    return timedelta(
        weeks=int(match.group("weeks") or 0),
        days=int(match.group("days") or 0),
        hours=int(match.group("hours") or 0),
        minutes=int(match.group("minutes") or 0),
    )


def _parse_iso_duration(text: str) -> timedelta:
    pattern = re.compile(
        r"^P(?:(?P<weeks>\d+)W)?(?:(?P<days>\d+)D)?"
        r"(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
    )
    match = pattern.match(text)
    if not match or not any(match.group(name) for name in ("weeks", "days", "hours", "minutes", "seconds")):
        raise ValueError(f"invalid ISO duration: {text}")
    return timedelta(
        weeks=int(match.group("weeks") or 0),
        days=int(match.group("days") or 0),
        hours=int(match.group("hours") or 0),
        minutes=int(match.group("minutes") or 0),
        seconds=int(match.group("seconds") or 0),
    )
