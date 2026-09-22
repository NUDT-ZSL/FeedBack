"""故障链重建：按时序与因果关系还原故障前后的状态变化路径。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .models import ConflictRecord
from .store import BoundedClueStore


@dataclass
class ChainEvent:
    timestamp: float
    kind: str  # "clue" 或 "tombstone"
    source: str
    severity: str
    summary: str
    state: Dict[str, str]
    clue_id: Optional[int] = None


@dataclass
class Gap:
    kind: str  # "overwritten"（被覆盖）或 "missing_cause"（因果上游缺失）
    at_timestamp: float
    detail: str


@dataclass
class FaultChain:
    chain_id: str
    events: List[ChainEvent] = field(default_factory=list)
    gaps: List[Gap] = field(default_factory=list)
    conflicts: List[ConflictRecord] = field(default_factory=list)
    confirmed: bool = False

    @property
    def completeness(self) -> float:
        """完整度：墓碑可推断存在但细节丢失，按半分计。"""
        clues = sum(1 for e in self.events if e.kind == "clue")
        tombstones = sum(1 for e in self.events if e.kind == "tombstone")
        missing = sum(1 for g in self.gaps if g.kind == "missing_cause")
        total = clues + tombstones + missing
        if total == 0:
            return 1.0
        return (clues + 0.5 * tombstones) / total


def rebuild_chains(store: BoundedClueStore) -> Dict[str, FaultChain]:
    chains: Dict[str, FaultChain] = {}

    def _chain(chain_id: str) -> FaultChain:
        if chain_id not in chains:
            chains[chain_id] = FaultChain(
                chain_id=chain_id, confirmed=store.is_chain_confirmed(chain_id)
            )
        return chains[chain_id]

    live_ids = set()
    for clue in store:
        if clue.chain_id is None:
            continue
        live_ids.add(clue.id)
        _chain(clue.chain_id).events.append(
            ChainEvent(
                timestamp=clue.timestamp,
                kind="clue",
                source=clue.source,
                severity=clue.severity.name,
                summary=clue.message,
                state=dict(clue.state),
                clue_id=clue.id,
            )
        )

    tombstone_ids = set()
    for ts in store.tombstones:
        tombstone_ids.add(ts.clue_id)
        if ts.chain_id is None:
            continue
        chain = _chain(ts.chain_id)
        chain.events.append(
            ChainEvent(
                timestamp=ts.timestamp,
                kind="tombstone",
                source=ts.source,
                severity=ts.severity.name,
                summary=f"线索 #{ts.clue_id} 已被覆盖，仅存关键状态摘要 {ts.digest}",
                state=dict(ts.state),
                clue_id=ts.clue_id,
            )
        )
        chain.gaps.append(
            Gap(
                kind="overwritten",
                at_timestamp=ts.timestamp,
                detail=f"线索 #{ts.clue_id}（{ts.source}）因存储压力被覆盖，细节丢失",
            )
        )

    # 因果上游既不在存储中也无墓碑 => 缺失环节
    for clue in store:
        if clue.chain_id is None or clue.caused_by is None:
            continue
        if clue.caused_by in live_ids or clue.caused_by in tombstone_ids:
            continue
        _chain(clue.chain_id).gaps.append(
            Gap(
                kind="missing_cause",
                at_timestamp=clue.timestamp,
                detail=f"线索 #{clue.id} 的因果上游 #{clue.caused_by} 不在存储中，亦无墓碑",
            )
        )

    # 冲突记录归入所属故障链（矛盾环节）
    for conflict in store.conflicts:
        for participant in conflict.participants:
            clue = store.get(participant.clue_id)
            if clue is not None and clue.chain_id is not None:
                chain = _chain(clue.chain_id)
                if conflict not in chain.conflicts:
                    chain.conflicts.append(conflict)

    for chain in chains.values():
        chain.events.sort(key=lambda e: e.timestamp)
        chain.gaps.sort(key=lambda g: g.at_timestamp)
    return chains
