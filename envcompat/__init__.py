"""环境兼容性验证汇总工具（离线、零外部依赖）。

公开入口：
    Matrix, Dimension          —— 环境维度与环境矩阵（需求 1）
    Group, TestCase            —— 分组与用例（需求 2）
    CompatibilityRunner        —— 结果登记 / 不可用标记 / 汇总 / 增量重算（需求 3-7）
    errors                     —— 各类带位置信息的校验/登记错误
"""
from .errors import (
    EnvCompatError,
    DefinitionError,
    DuplicateCombinationError,
    DuplicateCaseError,
    UnknownGroupError,
    RegistrationError,
    UnknownCaseError,
    UnknownCombinationError,
)
from .models import (
    Outcome,
    Dimension,
    Combination,
    Group,
    TestCase,
    Report,
    Conflict,
    CellState,
)
from .runner import (
    Matrix,
    CompatibilityRunner,
    CaseStat,
    ComboStat,
    Summary,
    FailureDetail,
    NotRunDetail,
    MatrixChange,
)
from .errors import (
    EnvCompatError,
    DefinitionError,
    DuplicateCombinationError,
    DuplicateCaseError,
    UnknownGroupError,
    RegistrationError,
    UnknownCaseError,
    UnknownCombinationError,
)

__all__ = [
    "Outcome",
    "Dimension",
    "Combination",
    "Group",
    "TestCase",
    "Report",
    "Conflict",
    "CellState",
    "Matrix",
    "CompatibilityRunner",
    "CaseStat",
    "ComboStat",
    "Summary",
    "FailureDetail",
    "NotRunDetail",
    "MatrixChange",
    "EnvCompatError",
    "DefinitionError",
    "DuplicateCombinationError",
    "DuplicateCaseError",
    "UnknownGroupError",
    "RegistrationError",
    "UnknownCaseError",
    "UnknownCombinationError",
]
