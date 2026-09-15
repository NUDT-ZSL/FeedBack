"""版本内核：版本登记 / 解析 / 迁移 / 差异 / 导入导出。

仅使用 Python 标准库，可完全离线运行。

入口类：:class:`evo_kernel.kernel.Kernel`。
"""

from .errors import (
    EvoKernelError,
    RuleDefinitionError,
    VersionError,
    ParseError,
    FieldValidationError,
    MigrationError,
    BundleError,
)
from .rules import FieldRule, TYPES
from .versions import Transform, Version, VersionRegistry
from .parser import ParseResult, FieldError, parse
from .migration import MigrationResult, MigrationStep, migrate
from .diff import version_diff, data_diff, FieldDiff
from .kernel import Kernel

__all__ = [
    "Kernel",
    "FieldRule",
    "TYPES",
    "Transform",
    "Version",
    "VersionRegistry",
    "ParseResult",
    "FieldError",
    "parse",
    "MigrationResult",
    "MigrationStep",
    "migrate",
    "version_diff",
    "data_diff",
    "FieldDiff",
    "EvoKernelError",
    "RuleDefinitionError",
    "VersionError",
    "ParseError",
    "FieldValidationError",
    "MigrationError",
    "BundleError",
]
