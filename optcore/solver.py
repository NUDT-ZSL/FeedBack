"""统一求解入口：装箱与排程独立求解、互不影响。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .models import (
    BinSpec,
    Item,
    PackingResult,
    ScheduleResult,
    SolveResult,
    Task,
)
from .packing import pack_items
from .scheduling import schedule_tasks
from .validation import (
    normalize_bins,
    normalize_items,
    normalize_resource_windows,
    normalize_resources,
    normalize_tasks,
    validate_task_references,
)


@dataclass
class Problem:
    """一次求解的完整输入：物品、箱子、任务、资源。

    :param resources: 显式登记的资源 id（任务引用未登记资源不算错误）。
    :param resource_windows: resource_id -> 合并排序后的可用时间窗
        ``[(start, end), ...]``（半开区间）；缺省资源全天可用。
    """

    items: List[Item] = field(default_factory=list)
    bins: List[BinSpec] = field(default_factory=list)
    tasks: List[Task] = field(default_factory=list)
    resources: List[str] = field(default_factory=list)
    resource_windows: Dict[str, List[Tuple[int, int]]] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """序列化为快照字典。

        带时间窗的资源输出为 ``{"resource": id, "windows": [...]}``，
        其余输出为纯字符串。
        """
        serialized_resources: List[Any] = []
        for rid in self.resources:
            if rid in self.resource_windows:
                serialized_resources.append({
                    "resource": rid,
                    "windows": [list(w) for w in self.resource_windows[rid]],
                })
            else:
                serialized_resources.append(rid)
        listed = set(self.resources)
        for rid in sorted(self.resource_windows):
            if rid not in listed:
                serialized_resources.append({
                    "resource": rid,
                    "windows": [list(w) for w in self.resource_windows[rid]],
                })
        return {
            "items": [item.to_dict() for item in self.items],
            "bins": [bin_spec.to_dict() for bin_spec in self.bins],
            "tasks": [task.to_dict() for task in self.tasks],
            "resources": serialized_resources,
        }

    @classmethod
    def from_raw(
        cls,
        items: Optional[Sequence[Any]] = None,
        bins: Optional[Sequence[Any]] = None,
        tasks: Optional[Sequence[Any]] = None,
        resources: Optional[Sequence[Any]] = None,
    ) -> "Problem":
        """从宽松输入（dict/模型混合）构造并做全部前置校验。"""
        norm_tasks = normalize_tasks(tasks)
        validate_task_references(norm_tasks)
        return cls(
            items=normalize_items(items),
            bins=normalize_bins(bins),
            tasks=norm_tasks,
            resources=normalize_resources(resources),
            resource_windows=normalize_resource_windows(resources),
        )


def solve_problem(problem: Problem) -> SolveResult:
    """对 :class:`Problem` 求解；装箱与排程相互独立。

    * 没有物品时不进行装箱（结果中 ``packing`` 为 None）；
    * 没有任务时不进行排程（``schedule`` 为 None）；
    * 一侧不可行或一侧求解异常都不影响另一侧。
    """
    packing: Optional[PackingResult] = None
    schedule: Optional[ScheduleResult] = None
    reasons: List[str] = []

    if problem.items:
        packing = pack_items(problem.items, problem.bins)
        if not packing.feasible:
            reasons.extend(f"[packing] {r}" for r in packing.reasons)

    if problem.tasks:
        schedule = schedule_tasks(
            problem.tasks, resource_windows=problem.resource_windows
        )
        if not schedule.feasible:
            reasons.extend(f"[schedule] {r}" for r in schedule.reasons)

    feasible = (packing is None or packing.feasible) and (
        schedule is None or schedule.feasible
    )
    return SolveResult(
        packing=packing,
        schedule=schedule,
        feasible=feasible,
        reasons=reasons,
    )


def solve(
    items: Optional[Sequence[Any]] = None,
    bins: Optional[Sequence[Any]] = None,
    tasks: Optional[Sequence[Any]] = None,
    resources: Optional[Sequence[Any]] = None,
) -> SolveResult:
    """统一入口：归一化输入后同时求解装箱与排程。

    两类问题独立求解、互不影响；全部输入为空时两侧均为 None、
    ``feasible=True``。输入格式错误抛
    :class:`~optcore.errors.InvalidInputError`；问题本身不可行不抛异常，
    通过结果中的 ``feasible`` / ``reasons`` 表达。

    :param items: 物品（Item 或 dict）。
    :param bins: 箱子（BinSpec、dict 或裸容量数值）。
    :param tasks: 任务（Task 或 dict，可选 ``deadline`` 字段）。
    :param resources: 资源登记；可附带可用时间窗，形如
        ``{"resource": "r", "windows": [[0, 10]]}``。
    """
    problem = Problem.from_raw(items, bins, tasks, resources)
    return solve_problem(problem)
