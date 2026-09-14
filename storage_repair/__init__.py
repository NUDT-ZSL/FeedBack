"""离线分布式存储修复内核（仅 Python 标准库）。

公开模块：

* :mod:`storage_repair.coding`    GF(256) 与 Cauchy 系统型 Reed-Solomon；
* :mod:`storage_repair.models`    数据模型、状态枚举与异常；
* :mod:`storage_repair.diagnosis` 候选裁决与最小损坏集诊断；
* :mod:`storage_repair.engine`    存储修复引擎（逐条操作）；
* :mod:`storage_repair.persistence` JSON 导出/导入；
* :mod:`storage_repair.cli`       逐条 JSON 请求命令行。
"""

from __future__ import annotations

from .coding import ReedSolomonCodec
from .engine import StorageEngine
from .models import (
    BlockStatus,
    Candidate,
    RepairRecord,
    Stripe,
    StorageRepairError,
    VerificationReport,
)

__all__ = [
    "ReedSolomonCodec",
    "StorageEngine",
    "BlockStatus",
    "Candidate",
    "RepairRecord",
    "Stripe",
    "StorageRepairError",
    "VerificationReport",
]
