"""rng_core：离线可验收的确定性随机实验复现工具。

公共入口：
    Registry, AmbiguousReferenceError, UnknownExperimentError, ConflictRecord
    parse_experiment / ValidationError
    Engine, RunResult
    BatchRunner, EstimatorSpec
    save / load / StoreCorruptError
    build_default_registry / HandlerRegistry / StepContext / StepFailure
"""

from .batch import BatchReport, BatchRunner, EstimatorSpec, EstimatorSummary
from .engine import Engine, RunResult, StepRecord, AttemptRecord
from .handlers import (
    HandlerRegistry, StepContext, StepFailure, build_default_registry,
)
from .models import (
    ExperimentSpec, ValidationError, parse_experiment, spec_to_wire,
)
from .persistence import StoreCorruptError, load, save
from .registry import (
    AmbiguousReferenceError, ConflictRecord, Registry, UnknownExperimentError,
)
from .rng import RandomStream, SUPPORTED_TYPES

__all__ = [
    "Registry", "AmbiguousReferenceError", "UnknownExperimentError",
    "ConflictRecord", "parse_experiment", "ValidationError", "ExperimentSpec",
    "spec_to_wire",
    "Engine", "RunResult", "StepRecord", "AttemptRecord",
    "BatchRunner", "BatchReport", "EstimatorSpec", "EstimatorSummary",
    "save", "load", "StoreCorruptError",
    "HandlerRegistry", "StepContext", "StepFailure", "build_default_registry",
    "RandomStream", "SUPPORTED_TYPES",
]

__version__ = "1.0.0"
