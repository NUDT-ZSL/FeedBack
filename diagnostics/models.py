"""核心数据模型：线索、墓碑（被覆盖线索的推断依据）、冲突记录。"""

from __future__ import annotations

import enum
import itertools
import time
from dataclasses import dataclass, field
from typing import Any


class Severity(enum.IntEnum):
    DEBUG = 10
    INFO = 20
    WARNING = 30
    ERROR = 40
    CRITICAL = 50


_id_counter = itertools.count(1)


@dataclass
class Clue:
    """一条带时间戳、来源和严重级别的设备运行线索。

    state: 该线索捕获的关键状态快照（如 {"pump": "on", "temp": 87}）。
    causes: 本线索因果上依赖的线索 id 列表。
    chain_id: 所属故障链；为 None 时由重建器按来源/时序推断。
    key_evidence: 现场人员标记的关键证据，存储压力下优先保留。
    resolves_chain: 为 True 时表示该线索确认其故障链已闭环（如恢复正常）。
    """

    timestamp: float
    source: str
    severity: Severity
    message: str
    state: dict[str, Any] = field(default_factory=dict)
    causes: list[int] = field(default_factory=list)
    chain_id: str | None = None
    key_evidence: bool = False
    resolves_chain: bool = False
    id: int = field(default_factory=lambda: next(_id_counter))
    created_at: float = field(default_factory=time.time)

    def estimated_size(self) -> int:
        """估算该线索占用的存储字节数（离线设备按字节预算管理）。"""
        size = 64 + len(self.message.encode("utf-8"))
        size += len(self.source.encode("utf-8"))
        for k, v in self.state.items():
            size += len(str(k).encode("utf-8")) + len(str(v).encode("utf-8")) + 8
        size += 8 * len(self.causes)
        return size


@dataclass
class Tombstone:
    """被覆盖线索留下的紧凑摘要。

    即使原线索被覆盖，故障链中的其他成员可据此推断它曾经存在，
    以及它发生时设备处于哪些关键状态。
    """

    clue_id: int
    timestamp: float
    source: str
    severity: Severity
    chain_id: str | None
    state_keys: tuple[str, ...]
    state_digest: str
    evicted_at: float = field(default_factory=time.time)


@dataclass
class ConflictRecord:
    """同一时间点相互冲突线索的可追溯记录。双方线索均被保留。"""

    timestamp: float
    clue_ids: tuple[int, ...]
    field: str
    values: tuple[Any, ...]
    reason: str
    resolved: bool = False
    id: int = field(default_factory=lambda: next(_id_counter))
