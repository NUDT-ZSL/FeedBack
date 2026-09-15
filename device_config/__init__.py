"""离线设备配置适配内核。

仅使用 Python 标准库，可完全离线运行与单元测试。

公开入口见 :class:`device_config.kernel.ConfigKernel`。
"""

from .errors import (
    KernelError,
    VersionError,
    ValidationError,
    DuplicateError,
    NotFoundError,
    MigrationChainError,
    MissingFieldError,
    CorruptStateError,
)
from .version import Version, parse_version
from .values import VALUE_TYPES, check_value_type, convert_value
from .kernel import ConfigKernel, Device, FieldDef, MigrationRule, FieldDecision
from .persistence import export_state, import_state, dump_json, load_json

__all__ = [
    "ConfigKernel",
    "Device",
    "FieldDef",
    "MigrationRule",
    "FieldDecision",
    "Version",
    "parse_version",
    "VALUE_TYPES",
    "check_value_type",
    "convert_value",
    "export_state",
    "import_state",
    "dump_json",
    "load_json",
    "KernelError",
    "VersionError",
    "ValidationError",
    "DuplicateError",
    "NotFoundError",
    "MigrationChainError",
    "MissingFieldError",
    "CorruptStateError",
]
