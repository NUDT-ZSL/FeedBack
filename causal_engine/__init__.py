"""因果一致性快照与部分回放引擎。

仅依赖 Python 标准库，可离线运行。模块组成：

- :mod:`causal_engine.exceptions`：异常体系
- :mod:`causal_engine.engine`：:class:`~causal_engine.engine.Event` 与
  :class:`~causal_engine.engine.CausalEngine` 核心实现
- :mod:`causal_engine.cli`：基于标准输入/输出的逐行 JSON 命令行接口
"""

from causal_engine.engine import CausalEngine, Event
from causal_engine.exceptions import (
    CausalEngineError,
    DuplicateEventError,
    DuplicateProcessError,
    InconsistentSnapshotError,
    InvalidCutError,
    InvalidEventError,
    PersistenceError,
    UnknownEventError,
    UnknownProcessError,
)

__all__ = [
    "CausalEngine",
    "Event",
    "CausalEngineError",
    "DuplicateEventError",
    "DuplicateProcessError",
    "InconsistentSnapshotError",
    "InvalidCutError",
    "InvalidEventError",
    "PersistenceError",
    "UnknownEventError",
    "UnknownProcessError",
]

__version__ = "1.0.0"
