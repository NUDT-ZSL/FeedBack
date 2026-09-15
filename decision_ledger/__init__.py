"""离线决策台账（Decision Ledger）。

只依赖 Python 标准库。模块划分：

- models  领域对象与状态机
- engine  台账核心逻辑（校验、结论推导、冲突检测、经验固化）
- store   JSON 文件持久化
- cli     中文命令行
"""

from .errors import LedgerError, NotFoundError, ValidationError, ConflictError, StateFlowError
from .models import Decision, Evidence, Outcome, ConclusionEntry, ConflictRecord, Lesson
from .engine import Ledger

__all__ = [
    "Ledger",
    "Decision",
    "Evidence",
    "Outcome",
    "ConclusionEntry",
    "ConflictRecord",
    "Lesson",
    "LedgerError",
    "NotFoundError",
    "ValidationError",
    "ConflictError",
    "StateFlowError",
]
