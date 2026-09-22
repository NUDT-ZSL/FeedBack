"""有限容量线索存储。

- 容量由设备实际可用字节数决定；
- 空间不足时覆盖最旧线索，并为故障链线索留下墓碑；
- 关键证据与冲突双方受保护，关键证据在所属故障链被完整确认后解除保护。
"""
from __future__ import annotations

import itertools
from typing import Dict, Iterator, List, Optional, Set

from .models import Clue, ConflictParticipant, ConflictRecord, Tombstone


class StorageFullError(RuntimeError):
    """所有线索均受保护、无法继续覆盖时抛出。"""


class BoundedClueStore:
    def __init__(self, capacity_bytes: int):
        if capacity_bytes <= 0:
            raise ValueError("capacity_bytes 必须为正数")
        self.capacity_bytes = capacity_bytes
        self._clues: Dict[int, Clue] = {}
        self._order: List[int] = []  # 插入顺序，头部最旧
        self._used = 0
        self.tombstones: List[Tombstone] = []
        self.conflicts: List[ConflictRecord] = []
        self.overwritten_count = 0
        self._conflict_ids = itertools.count(1)
        self._pinned: Set[int] = set()
        self._confirmed_chains: Set[str] = set()

    # ---------- 基本访问 ----------
    @property
    def used_bytes(self) -> int:
        return self._used

    def __len__(self) -> int:
        return len(self._clues)

    def __iter__(self) -> Iterator[Clue]:
        return iter([self._clues[i] for i in self._order])

    def get(self, clue_id: int) -> Optional[Clue]:
        return self._clues.get(clue_id)

    # ---------- 写入与标记 ----------
    def add(self, clue: Clue) -> Clue:
        self._detect_conflicts(clue)
        if clue.key_evidence:
            self._pinned.add(clue.id)
        self._clues[clue.id] = clue
        self._order.append(clue.id)
        self._used += clue.size
        self._evict_until_fits()
        return clue

    def mark_key_evidence(self, clue_id: int) -> bool:
        """现场人员标记关键证据，存储压力下优先保留。"""
        clue = self._clues.get(clue_id)
        if clue is None:
            return False
        clue.key_evidence = True
        self._pinned.add(clue_id)
        return True

    def confirm_chain(self, chain_id: str) -> None:
        """标记故障链已完整确认，其关键证据解除优先保留。"""
        self._confirmed_chains.add(chain_id)

    def is_chain_confirmed(self, chain_id: str) -> bool:
        return chain_id in self._confirmed_chains

    # ---------- 内部 ----------
    def _is_protected(self, clue: Clue) -> bool:
        if clue.id not in self._pinned:
            return False
        if (
            clue.key_evidence
            and clue.chain_id is not None
            and clue.chain_id in self._confirmed_chains
        ):
            return False
        return True

    def _evict_until_fits(self) -> None:
        while self._used > self.capacity_bytes:
            victim = next(
                (
                    self._clues[cid]
                    for cid in self._order
                    if not self._is_protected(self._clues[cid])
                ),
                None,
            )
            if victim is None:
                raise StorageFullError(
                    "存储已满且所有线索均受保护（关键证据/冲突双方），无法覆盖"
                )
            self._evict(victim)

    def _evict(self, clue: Clue) -> None:
        del self._clues[clue.id]
        self._order.remove(clue.id)
        self._used -= clue.size
        self._pinned.discard(clue.id)
        self.overwritten_count += 1
        if clue.chain_id is not None:
            self.tombstones.append(
                Tombstone(
                    clue_id=clue.id,
                    chain_id=clue.chain_id,
                    timestamp=clue.timestamp,
                    source=clue.source,
                    severity=clue.severity,
                    state=dict(clue.state),
                    digest=clue.digest(),
                )
            )

    def _detect_conflicts(self, incoming: Clue) -> None:
        """同一时间点、不同来源对同一状态键给出不同取值 => 冲突，双方保留。"""
        if not incoming.state:
            return
        for other in list(self._clues.values()):
            if other.timestamp != incoming.timestamp or other.source == incoming.source:
                continue
            for key in sorted(set(other.state) & set(incoming.state)):
                if str(other.state[key]) == str(incoming.state[key]):
                    continue
                self.conflicts.append(
                    ConflictRecord(
                        id=next(self._conflict_ids),
                        timestamp=incoming.timestamp,
                        state_key=key,
                        participants=[
                            ConflictParticipant(other.id, other.source, str(other.state[key])),
                            ConflictParticipant(
                                incoming.id, incoming.source, str(incoming.state[key])
                            ),
                        ],
                        note="同一时间点状态取值冲突，双方均已保留",
                    )
                )
                self._pinned.add(other.id)
                self._pinned.add(incoming.id)
