"""互动叙事素材编排模块（纯标准库，可完全离线运行）。

公共入口::

    from story_composer import Composer, MaterialUnit, NarrativeGoal, Slot
    from story_composer.errors import (
        DanglingReferenceError, CyclicDependencyError, SlotFillError, ...
    )
"""

from .composer import AUTO_SOURCE, DEFAULT_SOURCE, Composer
from .errors import (
    ComposerError,
    CyclicDependencyError,
    DanglingReferenceError,
    DuplicateIdError,
    SlotConflictError,
    SlotFillError,
    UnknownGoalError,
    UnknownUnitError,
    ValidationError,
)
from .model import (
    ChosenUnit,
    ConflictRecord,
    GoalSequence,
    MaterialUnit,
    NarrativeGoal,
    Selection,
    SequenceEntry,
    Slot,
    SlotResolution,
    UnitReference,
)

__all__ = [
    "Composer",
    "MaterialUnit",
    "NarrativeGoal",
    "Slot",
    "Selection",
    "ChosenUnit",
    "ConflictRecord",
    "SlotResolution",
    "GoalSequence",
    "SequenceEntry",
    "UnitReference",
    "DEFAULT_SOURCE",
    "AUTO_SOURCE",
    "ComposerError",
    "ValidationError",
    "DuplicateIdError",
    "DanglingReferenceError",
    "CyclicDependencyError",
    "SlotFillError",
    "SlotConflictError",
    "UnknownGoalError",
    "UnknownUnitError",
]
