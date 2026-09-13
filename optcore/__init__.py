"""组合优化内核：一维装箱 + 资源约束排程（纯标准库）。

公共 API：
    solve(items, bins, tasks, resources) -> SolveResult
    pack_items(items, bins)             -> PackingResult
    schedule_tasks(tasks, resources)    -> ScheduleResult

命令行入口见仓库根目录的 ``main.py``。
"""

from .errors import OptCoreError, InvalidInputError
from .models import (
    Item,
    BinSpec,
    Task,
    PackingResult,
    ScheduleResult,
    SolveResult,
)
from .packing import pack_items
from .scheduling import schedule_tasks
from .solver import Problem, solve, solve_problem
from .persistence import save_result, load_result, save_problem, load_problem

__all__ = [
    "OptCoreError",
    "InvalidInputError",
    "Item",
    "BinSpec",
    "Task",
    "PackingResult",
    "ScheduleResult",
    "SolveResult",
    "Problem",
    "solve",
    "solve_problem",
    "pack_items",
    "schedule_tasks",
    "save_result",
    "load_result",
    "save_problem",
    "load_problem",
]
