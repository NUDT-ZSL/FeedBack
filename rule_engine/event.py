"""
Device event model definition.
"""
from dataclasses import dataclass
from typing import Optional
import re


METRIC_PATTERN = re.compile(r'^[a-zA-Z0-9_]+$')


@dataclass
class DeviceEvent:
    """
    Represents a single device event from IoT data stream.

    Attributes:
        event_id: Unique identifier for the event
        tenant_id: The tenant ID that owns this device
        device_id: Device identifier
        metric: The metric being measured (e.g. 'temperature', 'humidity')
        value: The numeric value of the measurement
        timestamp: ISO 8601 formatted timestamp in UTC
    """
    event_id: str
    tenant_id: str
    device_id: str
    metric: str
    value: float
    timestamp: str

    @classmethod
    def from_dict(cls, data: dict) -> 'DeviceEvent':
        """
        Create a DeviceEvent from a dictionary, with validation.

        Args:
            data: Dictionary containing the event fields.

        Returns:
            Validated DeviceEvent instance.

        Raises:
            ValueError: If validation fails.
        """
        event_id = data.get('event_id')
        tenant_id = data.get('tenant_id')
        device_id = data.get('device_id')
        metric = data.get('metric')
        value = data.get('value')
        timestamp = data.get('timestamp')

        # Validation
        if not event_id or not isinstance(event_id, str):
            raise ValueError("event_id must be a non-empty string")
        if not tenant_id or not isinstance(tenant_id, str):
            raise ValueError("tenant_id must be a non-empty string")
        if not device_id or not isinstance(device_id, str):
            raise ValueError("device_id must be a non-empty string")
        if not metric or not isinstance(metric, str):
            raise ValueError("metric must be a non-empty string")
        if not METRIC_PATTERN.match(metric):
            raise ValueError("metric can only contain letters, numbers, and underscores")
        if value is None or not isinstance(value, (int, float)):
            raise ValueError("value must be a number")
        if not timestamp or not isinstance(timestamp, str):
            raise ValueError("timestamp must be an ISO 8601 string")

        return cls(
            event_id=str(event_id),
            tenant_id=str(tenant_id),
            device_id=str(device_id),
            metric=str(metric),
            value=float(value),
            timestamp=str(timestamp)
        )
