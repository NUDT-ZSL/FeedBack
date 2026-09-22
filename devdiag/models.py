"""数据模型：运行线索、覆盖墓碑、冲突记录。"""
from __future__ import annotations

import hashlib
import itertools
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Dict, List, Optional


class Severity(IntEnum):
    DEBUG = 10
    INFO = 20
    WARNING = 30
    ERROR = 40
    CRITICAL = 50


_id_counter = itertools.count(1)


@dataclass
class Clue:
    """一条带时间戳、来源和严重级别的设备运行线索。"""

    timestamp: float
    source: str
    severity: Severity
    message: str
    chain_id: Optional[str] = None                 # 所属故障链标识
    state: Dict[str, str] = field(default_factory=dict)  # 关键状态快照
    caused_by: Optional[int] = None                # 因果上游线索 id
    key_evidence: bool = False                     # 现场人员标记的关键证据
    id: int = field(default_factory=lambda: next(_id_counter))

    @property
    def size(self) -> int:
        """估算该线索占用的存储字节数。"""
        n = 64 + len(self.message.encode("utf-8")) + len(self.source.encode("utf-8"))
        for k, v in self.state.items():
            n += 16 + len(str(k).encode("utf-8")) + len(str(v).encode("utf-8"))
        return n

    def digest(self) -> str:
        h = hashlib.sha1()
        h.update(
            f"{self.timestamp}|{self.source}|{int(self.severity)}|{self.message}".encode("utf-8")
        )
        for k in sorted(self.state):
            h.update(f"{k}={self.state[k]};".encode("utf-8"))
        return h.hexdigest()[:12]


@dataclass
class Tombstone:
    """被覆盖线索留下的关键状态摘要。

    即使原线索被覆盖，同一故障链仍可通过墓碑推断其存在与大致状态。
    """

    clue_id: int
    chain_id: Optional[str]
    timestamp: float
    source: str
    severity: Severity
    state: Dict[str, str]
    digest: str
    reason: str = "overwritten"


@dataclass
class ConflictParticipant:
    clue_id: int
    source: str
    value: str


@dataclass
class ConflictRecord:
    """同一时间点相互冲突的线索记录，冲突双方均被保留。"""

    id: int
    timestamp: float
    state_key: str
    participants: List[ConflictParticipant]
    note: str = ""
