"""interflow —— 离线可验收交互原型的页面串联模块（纯标准库）。"""

from .errors import (
    InterflowError,
    DefinitionError,
    DuplicateIdError,
    TargetNotFoundError,
    ConditionError,
    MissingVariablesError,
    BackRejectedError,
    TriggerError,
    BatchAbortedError,
    PersistenceError,
)
from .engine import PrototypeEngine, TriggerStep
from .models import (
    Page,
    PageState,
    InteractionElement,
    Action,
    ConditionBranch,
    HistoryFrame,
    MigrationRecord,
    GOTO,
    BACK,
    SET_STATE,
    SUBMIT,
)
from .persistence import save_to_file, load_from_file

__all__ = [
    "PrototypeEngine",
    "TriggerStep",
    "Page",
    "PageState",
    "InteractionElement",
    "Action",
    "ConditionBranch",
    "HistoryFrame",
    "MigrationRecord",
    "GOTO",
    "BACK",
    "SET_STATE",
    "SUBMIT",
    "save_to_file",
    "load_from_file",
    "InterflowError",
    "DefinitionError",
    "DuplicateIdError",
    "TargetNotFoundError",
    "ConditionError",
    "MissingVariablesError",
    "BackRejectedError",
    "TriggerError",
    "BatchAbortedError",
    "PersistenceError",
]

__version__ = "1.0.0"
