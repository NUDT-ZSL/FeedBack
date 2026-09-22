"""故障链重建：按时序与因果关系还原故障前后的状态变化路径。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import Clue, ConflictRecord, Tombstone
from .store import BoundedClueStore


@dataclass
class ChainLink:
    """证据链中的一个环节。kind: present / inferred / missing。"""

    kind: str
    clue: Clue | None = None
    tombstone: Tombstone | None = None
    missing_cause_id: int | None = None
    note: str = ""


@dataclass
class FaultChain:
    chain_id: str
    links: list[ChainLink] = field(default_factory=list)
    conflicts: list[ConflictRecord] = field(default_factory=list)
    confirmed: bool = False

    @property
    def present_count(self) -> int:
        return sum(1 for l in self.links if l.kind == "present")

    @property
    def inferred_count(self) -> int:
        return sum(1 for l in self.links if l.kind == "inferred")

    @property
    def missing_count(self) -> int:
        return sum(1 for l in self.links if l.kind == "missing")

    @property
    def completeness(self) -> float:
        """完整程度：在场环节 / (在场 + 可推断 + 完全缺失)。"""
        total = len(self.links)
        if total == 0:
            return 0.0
        return self.present_count / total

    def state_path(self) -> list[tuple[float, str, dict]]:
        """按时间排列的状态变化路径（含被覆盖环节的推断状态键）。"""
        path = []
        for link in self.links:
            if link.kind == "present" and link.clue:
                path.append((link.clue.timestamp, link.clue.source, dict(link.clue.state)))
            elif link.kind == "inferred" and link.tombstone:
                path.append(
                    (
                        link.tombstone.timestamp,
                        link.tombstone.source,
                        {k: "<已覆盖，仅存摘要>" for k in link.tombstone.state_keys},
                    )
                )
        return path


class ChainReconstructor:
    """从存储中的线索、墓碑与冲突记录重建故障链。"""

    def __init__(self, store: BoundedClueStore, temporal_window: float = 30.0):
        self.store = store
        self.temporal_window = temporal_window

    def _assign_chain_ids(self, clues: list[Clue]) -> dict[int, str]:
        """无 chain_id 的线索按因果引用与来源+时间邻近归入故障链。"""
        assignment: dict[int, str] = {}
        for c in clues:
            if c.chain_id:
                assignment[c.id] = c.chain_id
        changed = True
        while changed:
            changed = False
            for c in clues:
                if c.id in assignment:
                    continue
                for cause_id in c.causes:
                    if cause_id in assignment:
                        assignment[c.id] = assignment[cause_id]
                        changed = True
                        break
        auto_idx = 0
        for c in clues:
            if c.id in assignment:
                continue
            group = None
            for other in clues:
                if other.id == c.id or other.id not in assignment:
                    continue
                if other.source == c.source and abs(other.timestamp - c.timestamp) <= self.temporal_window:
                    group = assignment[other.id]
                    break
            if group is None:
                auto_idx += 1
                group = f"auto-{c.source}-{auto_idx}"
            assignment[c.id] = group
        return assignment

    def reconstruct(self) -> list[FaultChain]:
        clues = self.store.clues()
        assignment = self._assign_chain_ids(clues)
        tomb_by_id = {t.clue_id: t for t in self.store.tombstones}
        chains: dict[str, FaultChain] = {}

        def chain_of(cid: str) -> FaultChain:
            if cid not in chains:
                chains[cid] = FaultChain(chain_id=cid)
            return chains[cid]

        for clue in clues:
            chain = chain_of(assignment[clue.id])
            chain.links.append(ChainLink(kind="present", clue=clue))
            if clue.resolves_chain or self.store.is_chain_confirmed(assignment[clue.id]):
                chain.confirmed = True

        # 因果引用指向不在场的线索：有墓碑则可推断，否则标记缺失。
        for clue in clues:
            chain = chain_of(assignment[clue.id])
            for cause_id in clue.causes:
                if self.store.get(cause_id) is not None:
                    continue
                tomb = tomb_by_id.get(cause_id)
                if tomb is not None:
                    chain.links.append(
                        ChainLink(
                            kind="inferred",
                            tombstone=tomb,
                            note=f"线索 #{cause_id} 已被覆盖，依据保留的关键状态摘要推断其存在",
                        )
                    )
                else:
                    chain.links.append(
                        ChainLink(
                            kind="missing",
                            missing_cause_id=cause_id,
                            note=f"线索 #{clue.id} 引用的前因 #{cause_id} 既不在存储中也无覆盖摘要",
                        )
                    )

        # 墓碑自身携带 chain_id 时，即使无人引用也归入对应链。
        for tomb in self.store.tombstones:
            if tomb.chain_id:
                chain = chain_of(tomb.chain_id)
                if not any(l.tombstone and l.tombstone.clue_id == tomb.clue_id for l in chain.links):
                    chain.links.append(
                        ChainLink(kind="inferred", tombstone=tomb, note="被覆盖线索的保留摘要")
                    )

        for conflict in self.store.conflicts:
            for cid in {assignment.get(i) for i in conflict.clue_ids} - {None}:
                chain_of(cid).conflicts.append(conflict)

        for chain in chains.values():
            chain.links.sort(
                key=lambda l: (l.clue.timestamp if l.clue else l.tombstone.timestamp)
                if (l.clue or l.tombstone)
                else float("inf")
            )
        return sorted(chains.values(), key=lambda c: c.chain_id)
