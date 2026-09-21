"""Allocation of multiplexed uplinks among isolated business channels."""

from .model import (
    AllocationPlan,
    Assignment,
    Channel,
    ChannelState,
    Link,
    LinkState,
    LinkUsage,
    Rejection,
    RejectionReason,
)
from .scheduler import allocate
from .manager import AllocationEvent, ConnectionRelay, EventType

__all__ = [
    "AllocationEvent",
    "AllocationPlan",
    "Assignment",
    "Channel",
    "ChannelState",
    "ConnectionRelay",
    "EventType",
    "Link",
    "LinkState",
    "LinkUsage",
    "Rejection",
    "RejectionReason",
    "allocate",
]
