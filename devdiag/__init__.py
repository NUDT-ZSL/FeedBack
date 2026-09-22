"""离线设备诊断模块：有限存储中的运行线索管理与故障链重建。"""
from .chain import ChainEvent, FaultChain, Gap, rebuild_chains
from .models import Clue, ConflictRecord, Severity, Tombstone
from .report import DiagnosticReport, build_report, render_text
from .store import BoundedClueStore, StorageFullError

__all__ = [
    "BoundedClueStore",
    "ChainEvent",
    "Clue",
    "ConflictRecord",
    "DiagnosticReport",
    "FaultChain",
    "Gap",
    "Severity",
    "StorageFullError",
    "Tombstone",
    "build_report",
    "rebuild_chains",
    "render_text",
]
