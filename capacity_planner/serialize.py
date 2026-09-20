"""JSON-compatible conversion for analysis results."""

from dataclasses import asdict, is_dataclass
from datetime import datetime
from typing import Any, Dict


def to_jsonable(value):
    # type: (Any) -> Any
    if is_dataclass(value):
        return to_jsonable(asdict(value))
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {key: to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    return value


def analysis_to_dict(analysis):
    # type: (Any) -> Dict[str, Any]
    return to_jsonable(analysis)
