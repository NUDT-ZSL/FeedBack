"""面向时序数据的小型列式存储引擎（仅依赖 Python 标准库）。

公开接口：

* :class:`~tsdb.model.Point` / :class:`~tsdb.model.QueryResult` —— 数据模型
* :class:`tsdb.engine.ColumnarTSDB` —— 可嵌入的存储内核
* :class:`tsdb.errors.TSDBError` —— 所有引擎层错误的基类
"""

from __future__ import annotations

from .engine import ColumnarTSDB
from .errors import TSDBError, ValidationError, CorruptionError
from .model import Point, QueryResult

__all__ = [
    "ColumnarTSDB",
    "Point",
    "QueryResult",
    "TSDBError",
    "ValidationError",
    "CorruptionError",
]

__version__ = "1.0.0"
