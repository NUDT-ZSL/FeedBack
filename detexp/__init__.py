"""离线确定性随机实验复现框架（detexp）。

仅依赖 Python 标准库，所有随机数均可随机访问、跨平台按位复现。
"""

from .errors import (
    DetexpError,
    ValidationError,
    MultiValidationError,
    StreamExhaustedError,
    StepExecutionError,
    ConflictPendingError,
    IntegrityError,
)
from .rng import DeterministicStream, RandomWindow, normalize_seed, splitmix64
from .models import (
    Experiment,
    Step,
    ParameterSpec,
    Slice,
    RunRecord,
    StepRecord,
    BatchSummary,
    ConflictRecord,
)
from .engine import Executor
from .analysis import analyze_estimates, t_critical, build_seed_list
from .registry import ExperimentSystem

__all__ = [
    "DetexpError",
    "ValidationError",
    "MultiValidationError",
    "StreamExhaustedError",
    "StepExecutionError",
    "ConflictPendingError",
    "IntegrityError",
    "DeterministicStream",
    "RandomWindow",
    "normalize_seed",
    "splitmix64",
    "Experiment",
    "Step",
    "ParameterSpec",
    "Slice",
    "RunRecord",
    "StepRecord",
    "BatchSummary",
    "ConflictRecord",
    "Executor",
    "ExperimentSystem",
    "analyze_estimates",
    "t_critical",
    "build_seed_list",
]

__version__ = "1.0.0"
