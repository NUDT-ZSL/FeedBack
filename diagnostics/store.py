"""有限容量线索存储：覆盖策略、关键证据保护、冲突双方保留。"""

from __future__ import annotations

import hashlib
from typing import Iterable

from .models import Clue, ConflictRecord, Severity, Tombstone


class BoundedClueStore:
    """按字节预算管理的线索存储。

    覆盖规则（空间不足时，依次尝试）：
      1. 最旧的普通线索；
      2. 最旧的、所属故障链已被完整确认的关键证据线索；
      3. 冲突记录中尚未解决的参与线索永不覆盖；
      4. 未确认故障链上的关键证据线索永不覆盖（此时拒绝新线索并返回 False）。
    每次覆盖都会留下 Tombstone，供故障链重建时推断被覆盖线索的存在。
    """

    def __init__(self, capacity_bytes: int):
        if capacity_bytes <= 0:
            raise ValueError("capacity_bytes 必须为正数")
        self.capacity_bytes = capacity_bytes
        self._clues: dict[int, Clue] = {}
        self._used = 0
        self.tombstones: list[Tombstone] = []
        self.conflicts: list[ConflictRecord] = []
        self._confirmed_chains: set[str] = set()
        self.rejected: list[Clue] = []

    # ---- 基本属性 ----
    @property
    def used_bytes(self) -> int:
        return self._used

    def __len__(self) -> int:
        return len(self._clues)

    def clues(self) -> list[Clue]:
        return sorted(self._clues.values(), key=lambda c: (c.timestamp, c.id))

    def get(self, clue_id: int) -> Clue | None:
        return self._clues.get(clue_id)

    # ---- 故障链确认 ----
    def confirm_chain(self, chain_id: str) -> None:
        """现场人员或重建器确认某故障链已完整闭环。"""
        self._confirmed_chains.add(chain_id)

    def is_chain_confirmed(self, chain_id: str | None) -> bool:
        return chain_id is not None and chain_id in self._confirmed_chains

    # ---- 写入 ----
    def add(self, clue: Clue) -> bool:
        """写入线索；空间不足时按规则覆盖旧线索。返回是否成功保留。"""
        self._detect_conflicts(clue)
        if clue.resolves_chain and clue.chain_id:
            self._confirmed_chains.add(clue.chain_id)
        need = clue.estimated_size()
        if need > self.capacity_bytes:
            self.rejected.append(clue)
            return False
        while self._used + need > self.capacity_bytes:
            victim = self._pick_victim()
            if victim is None:
                self.rejected.append(clue)
                return False
            self._evict(victim)
        self._clues[clue.id] = clue
        self._used += need
        return True

    def add_many(self, clues: Iterable[Clue]) -> list[bool]:
        return [self.add(c) for c in clues]

    # ---- 覆盖 ----
    def _protected_ids(self) -> set[int]:
        protected = set()
        for conflict in self.conflicts:
            if not conflict.resolved:
                protected.update(conflict.clue_ids)
        return protected

    def _evictable(self, clue: Clue, protected: set[int]) -> bool:
        if clue.id in protected:
            return False
        if clue.key_evidence and not self.is_chain_confirmed(clue.chain_id):
            return False
        return True

    def _pick_victim(self) -> Clue | None:
        protected = self._protected_ids()
        candidates = [c for c in self._clues.values() if self._evictable(c, protected)]
        if not candidates:
            return None
        # 未确认链上的关键证据最后才被覆盖；已确认链上的关键证据
        # 与普通线索同等对待，按时间从最旧开始覆盖。
        candidates.sort(
            key=lambda c: (
                c.key_evidence and not self.is_chain_confirmed(c.chain_id),
                c.timestamp,
                c.id,
            )
        )
        return candidates[0]

    def _evict(self, clue: Clue) -> None:
        digest_src = "|".join(f"{k}={clue.state[k]}" for k in sorted(clue.state))
        self.tombstones.append(
            Tombstone(
                clue_id=clue.id,
                timestamp=clue.timestamp,
                source=clue.source,
                severity=clue.severity,
                chain_id=clue.chain_id,
                state_keys=tuple(sorted(clue.state)),
                state_digest=hashlib.sha1(digest_src.encode("utf-8")).hexdigest()[:12],
            )
        )
        del self._clues[clue.id]
        self._used -= clue.estimated_size()

    # ---- 冲突检测 ----
    def _detect_conflicts(self, incoming: Clue) -> None:
        """同一时间点的线索若对同一状态字段给出矛盾取值，双方保留并记录。"""
        for existing in self._clues.values():
            if existing.timestamp != incoming.timestamp:
                continue
            if existing.source != incoming.source:
                continue
            common = set(existing.state) & set(incoming.state)
            for key in sorted(common):
                if existing.state[key] != incoming.state[key]:
                    self.conflicts.append(
                        ConflictRecord(
                            timestamp=incoming.timestamp,
                            clue_ids=(existing.id, incoming.id),
                            field=key,
                            values=(existing.state[key], incoming.state[key]),
                            reason=(
                                f"来源 {incoming.source} 在 t={incoming.timestamp} "
                                f"对字段 '{key}' 报告了矛盾取值"
                            ),
                        )
                    )

    def resolve_conflict(self, conflict_id: int) -> bool:
        for conflict in self.conflicts:
            if conflict.id == conflict_id:
                conflict.resolved = True
                return True
        return False
