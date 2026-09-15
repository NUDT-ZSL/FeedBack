"""离线表格视窗内核。

只依赖 Python 标准库，可完全离线运行。快速上手::

    from table_kernel import TableKernel

    k = TableKernel(
        {"age": "int", "name": "str"},
        rows=[{"id": "r1", "fields": {"age": 10, "name": "a"}}],
        sort=[("age", True)],
        filters=[{"field": "age", "op": "ge", "value": 0}],
        window_size=50,
    )
    k.visible_ids()          # 当前窗口可见行
    k.position_of("r1")      # 行的稳定位置
    k.in_window("r1")        # 是否命中窗口
"""

from .errors import (
    BatchValidationError,
    DuplicateRowError,
    KernelError,
    RuleError,
    SerializationError,
    UnknownRowError,
    ValidationError,
    WindowError,
)
from .kernel import OPERATORS, Filter, Row, RowFilteredError, SortSpec, TableKernel
from .schema import FIELD_TYPES, FieldSpec, Schema
from .serde import (
    SNAPSHOT_VERSION,
    export_snapshot,
    load_snapshot,
    load_snapshot_file,
    save_snapshot,
)
from .treap import Treap

__all__ = [
    "TableKernel",
    "Row",
    "SortSpec",
    "Filter",
    "Schema",
    "FieldSpec",
    "FIELD_TYPES",
    "Treap",
    "OPERATORS",
    "KernelError",
    "ValidationError",
    "BatchValidationError",
    "DuplicateRowError",
    "UnknownRowError",
    "WindowError",
    "RuleError",
    "RowFilteredError",
    "SerializationError",
    "export_snapshot",
    "import_snapshot",
    "load_snapshot",
    "save_snapshot",
    "load_snapshot_file",
    "SNAPSHOT_VERSION",
]

# 语义化别名：import_snapshot == load_snapshot
import_snapshot = load_snapshot
