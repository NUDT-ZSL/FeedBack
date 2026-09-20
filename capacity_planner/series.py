from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .models import ActionType, Conflict, Record


@dataclass(frozen=True)
class ObservationGroup:
    timestamp: datetime
    record_ids: tuple[str, ...]
    usage_low: float
    usage_high: float
    quota_low: float
    quota_high: float


@dataclass(frozen=True)
class CapacityAction:
    timestamp: datetime
    record_id: str
    type: ActionType
    amount: float | None
    unit: str
    note: str | None


@dataclass(frozen=True)
class ResourceSeries:
    resource_id: str
    records: tuple[Record, ...]
    observation_groups: tuple[ObservationGroup, ...]
    conflicts: tuple[Conflict, ...]
    actions: tuple[CapacityAction, ...]
    out_of_order_record_ids: tuple[str, ...]
    has_out_of_order_records: bool
    first_timestamp: datetime
    last_timestamp: datetime
    latest_quota: float
    latest_quota_low: float
    latest_quota_high: float

    @property
    def has_conflicts(self) -> bool:
        return bool(self.conflicts)


def build_series(resource_id: str, records: list[Record]) -> ResourceSeries:
    ordered = sorted(records, key=lambda item: (item.timestamp, item.record_id))
    by_time: dict[datetime, list[Record]] = {}
    for record in ordered:
        by_time.setdefault(record.timestamp, []).append(record)

    groups: list[ObservationGroup] = []
    conflicts: list[Conflict] = []
    for timestamp, items in by_time.items():
        usages = {item.record_id: item.usage for item in items}
        quotas = {item.record_id: item.quota for item in items}
        fields = []
        if len(set(usages.values())) > 1:
            fields.append("usage")
        if len(set(quotas.values())) > 1:
            fields.append("quota")
        ids = tuple(item.record_id for item in items)
        groups.append(ObservationGroup(
            timestamp, ids,
            min(usages.values()), max(usages.values()),
            min(quotas.values()), max(quotas.values()),
        ))
        if len(items) > 1:
            severity = "contradiction" if fields else "duplicate"
            conflicts.append(Conflict(
                timestamp, list(ids), usages, quotas, fields, severity
            ))

    actions = tuple(
        CapacityAction(
            item.timestamp, item.record_id, item.action.type, item.action.amount,
            item.action.unit, item.action.note,
        )
        for item in ordered if item.action is not None
    )
    out_of_order = _out_of_order_ids(records)
    last_items = by_time[ordered[-1].timestamp]
    latest_quotas = [item.quota for item in last_items]
    return ResourceSeries(
        resource_id, tuple(ordered), tuple(groups), tuple(conflicts), actions,
        tuple(out_of_order), bool(out_of_order),
        ordered[0].timestamp, ordered[-1].timestamp,
        min(latest_quotas), min(latest_quotas), max(latest_quotas),
    )


def _out_of_order_ids(records: list[Record]) -> list[str]:
    marked: list[str] = []
    latest: datetime | None = None
    for record in sorted(records, key=lambda item: (item.ingestion_order is None, item.ingestion_order, item.record_id)):
        if latest is not None and record.timestamp < latest:
            marked.append(record.record_id)
        if latest is None or record.timestamp > latest:
            latest = record.timestamp
    return marked
