"""数据模型：物品、箱子、任务以及三类求解结果。

模型全部使用 ``dataclass``，并提供 ``to_dict`` / ``from_dict`` 以便
JSON 持久化。输入侧的宽松形式（dict、缺省字段）由
:mod:`optcore.validation` 负责归一化，本模块只处理已经合法的数据。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class Item:
    """待装箱物品。

    :param item_id: 非空、全局唯一的标识。
    :param size: 正的体积/尺寸。
    :param group: 非空分组标识；同组物品必须装入同一个箱子。
    """

    item_id: str
    size: float
    group: str

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的普通字典。"""
        return {"item_id": self.item_id, "size": self.size, "group": self.group}


@dataclass(frozen=True)
class BinSpec:
    """箱子规格。

    :param bin_id: 箱子标识。
    :param capacity: 正的容量。
    """

    bin_id: str
    capacity: float

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的普通字典。"""
        return {"bin_id": self.bin_id, "capacity": self.capacity}


@dataclass(frozen=True)
class Task:
    """排程任务。

    :param task_id: 非空、全局唯一的标识。
    :param duration: 正整数时长。
    :param resource: 非空资源标识；同一资源上任务不可时间重叠。
    :param deps: 前置任务 id 集合；任务必须等所有前置完成后才能开始。
    :param release: 最早开始时间（整数）。
    :param deadline: 可选截止时间（正整数，半开区间，任务须在该时刻前
        完成）；``None`` 表示无上界。
    """

    task_id: str
    duration: int
    resource: str
    deps: frozenset = field(default_factory=frozenset)
    release: int = 0
    deadline: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        """序列化为可 JSON 化的普通字典（deps 排序输出，保证稳定）。"""
        return {
            "task_id": self.task_id,
            "duration": self.duration,
            "resource": self.resource,
            "deps": sorted(self.deps),
            "release": self.release,
            "deadline": self.deadline,
        }


def _as_str_list(value: Any, field_name: str) -> List[str]:
    """校验并拷贝一个字符串列表，失败时给出字段定位。"""
    if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
        raise ValueError(f"结果字段 {field_name} 必须是字符串列表")
    return list(value)


@dataclass
class PackingResult:
    """装箱结果。

    :param bins: bin_id -> 该箱内的 item_id 列表（仅包含已使用的箱子）。
    :param used_bins: 使用的箱子数。
    :param optimal: 启发式解是否经分支定界证明为最优。
    :param lower_bound: 箱子数下界（体积下界与分组数下界的较大者）。
    :param feasible: 是否存在可行装箱。
    :param reasons: 不可行原因描述（可行时为空）。
    :param infeasible_groups: 总尺寸超过单个箱子容量的分组。
    """

    bins: Dict[str, List[str]] = field(default_factory=dict)
    used_bins: int = 0
    optimal: bool = True
    lower_bound: int = 0
    feasible: bool = True
    reasons: List[str] = field(default_factory=list)
    infeasible_groups: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """转为 JSON 友好字典；``bins`` 的键排序输出，保证稳定。"""
        return {
            "bins": {k: list(self.bins[k]) for k in sorted(self.bins)},
            "used_bins": self.used_bins,
            "optimal": self.optimal,
            "lower_bound": self.lower_bound,
            "feasible": self.feasible,
            "reasons": list(self.reasons),
            "infeasible_groups": list(self.infeasible_groups),
        }

    @classmethod
    def from_dict(cls, data: Any) -> "PackingResult":
        """从持久化字典重建结果。"""
        if not isinstance(data, dict):
            raise ValueError("packing result 必须是对象")
        bins_raw = data.get("bins", {})
        if not isinstance(bins_raw, dict):
            raise ValueError("packing result 字段 bins 必须是对象")
        bins: Dict[str, List[str]] = {}
        for bin_id, items in bins_raw.items():
            bins[str(bin_id)] = _as_str_list(items, f"bins.{bin_id}")
        return cls(
            bins=bins,
            used_bins=int(data.get("used_bins", 0)),
            optimal=bool(data.get("optimal", True)),
            lower_bound=int(data.get("lower_bound", 0)),
            feasible=bool(data.get("feasible", True)),
            reasons=[str(x) for x in data.get("reasons", [])],
            infeasible_groups=_as_str_list(
                data.get("infeasible_groups", []), "infeasible_groups"
            ),
        )


@dataclass
class ScheduleResult:
    """排程结果。

    :param assignments: task_id -> (start, end)。
    :param makespan: 最大结束时间。
    :param critical_path: 一条最长依赖链上的 task_id 序列。
    :param feasible: 是否存在可行排程。
    :param reasons: 不可行原因描述（可行时为空）。
    :param cycle: 依赖成环时环上的 task_id 序列，否则为 None。
    :param resource_conflicts: 资源冲突时间窗列表，元素为
        ``(resource, start, end, [task_id, ...])``。由构造合法调度的求解器
        产生时该列表恒为空；持久化往返或外部校验时可能非空。
    :param infeasibility_type: 不可行类型标识：``"cycle"``（依赖成环）、
        ``"window_overload"``（release/deadline/资源时间窗内任务总时长
        超出可用时长）；可行时为 None。
    :param window_conflicts: 时间窗不可行证明，每项为字典
        ``{"resource", "window": [start, end], "available", "required",
        "tasks"}``：在资源 resource 的 [start,end) 区间内，可用时长
        available 容纳不下 tasks 的总需求时长 required。
    """

    assignments: Dict[str, Tuple[int, int]] = field(default_factory=dict)
    makespan: int = 0
    critical_path: List[str] = field(default_factory=list)
    feasible: bool = True
    reasons: List[str] = field(default_factory=list)
    cycle: Optional[List[str]] = None
    resource_conflicts: List[Tuple[str, int, int, List[str]]] = field(
        default_factory=list
    )
    infeasibility_type: Optional[str] = None
    window_conflicts: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """转为 JSON 友好字典（时间区间元组序列化为两元素列表）。"""
        return {
            "assignments": {
                tid: [start, end]
                for tid, (start, end) in sorted(self.assignments.items())
            },
            "makespan": self.makespan,
            "critical_path": list(self.critical_path),
            "feasible": self.feasible,
            "reasons": list(self.reasons),
            "cycle": list(self.cycle) if self.cycle is not None else None,
            "resource_conflicts": [
                {
                    "resource": resource,
                    "start": start,
                    "end": end,
                    "tasks": list(tasks),
                }
                for resource, start, end, tasks in self.resource_conflicts
            ],
            "infeasibility_type": self.infeasibility_type,
            "window_conflicts": [dict(c) for c in self.window_conflicts],
        }

    @classmethod
    def from_dict(cls, data: Any) -> "ScheduleResult":
        """从持久化字典重建结果。"""
        if not isinstance(data, dict):
            raise ValueError("schedule result 必须是对象")
        assignments_raw = data.get("assignments", {})
        if not isinstance(assignments_raw, dict):
            raise ValueError("schedule result 字段 assignments 必须是对象")
        assignments: Dict[str, Tuple[int, int]] = {}
        for tid, span in assignments_raw.items():
            if (
                not isinstance(span, list)
                or len(span) != 2
                or not all(isinstance(x, int) for x in span)
            ):
                raise ValueError(f"assignments.{tid} 必须是 [start, end] 整数对")
            assignments[str(tid)] = (int(span[0]), int(span[1]))
        cycle_raw = data.get("cycle")
        cycle = _as_str_list(cycle_raw, "cycle") if cycle_raw is not None else None
        conflicts: List[Tuple[str, int, int, List[str]]] = []
        for c in data.get("resource_conflicts", []):
            if not isinstance(c, dict):
                raise ValueError("resource_conflicts 元素必须是对象")
            conflicts.append(
                (
                    str(c["resource"]),
                    int(c["start"]),
                    int(c["end"]),
                    _as_str_list(c.get("tasks", []), "resource_conflicts.tasks"),
                )
            )
        window_conflicts: List[Dict[str, Any]] = []
        for c in data.get("window_conflicts", []):
            if not isinstance(c, dict):
                raise ValueError("window_conflicts 元素必须是对象")
            window = c.get("window")
            if not (
                isinstance(window, list)
                and len(window) == 2
                and all(isinstance(x, int) for x in window)
            ):
                raise ValueError("window_conflicts.window 必须是 [start, end]")
            entry = {
                "resource": str(c["resource"]),
                "window": [int(window[0]), int(window[1])],
                "available": int(c["available"]),
                "required": int(c["required"]),
                "tasks": _as_str_list(c.get("tasks", []), "window_conflicts.tasks"),
            }
            if "proven_by" in c:
                entry["proven_by"] = str(c["proven_by"])
            window_conflicts.append(entry)
        infeasibility_type = data.get("infeasibility_type")
        return cls(
            assignments=assignments,
            makespan=int(data.get("makespan", 0)),
            critical_path=_as_str_list(data.get("critical_path", []), "critical_path"),
            feasible=bool(data.get("feasible", True)),
            reasons=[str(x) for x in data.get("reasons", [])],
            cycle=cycle,
            resource_conflicts=conflicts,
            infeasibility_type=(
                str(infeasibility_type) if infeasibility_type is not None else None
            ),
            window_conflicts=window_conflicts,
        )


@dataclass
class SolveResult:
    """统一求解结果：装箱与排程相互独立。

    :param packing: 装箱结果；没有物品/箱子输入时为 None。
    :param schedule: 排程结果；没有任务输入时为 None。
    :param feasible: 所有已求解子问题均可行时为 True。
    :param reasons: 全部不可行原因（装箱与排程汇总）。
    """

    packing: Optional[PackingResult] = None
    schedule: Optional[ScheduleResult] = None
    feasible: bool = True
    reasons: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """转为 JSON 友好字典。"""
        return {
            "packing": self.packing.to_dict() if self.packing is not None else None,
            "schedule": self.schedule.to_dict() if self.schedule is not None else None,
            "feasible": self.feasible,
            "reasons": list(self.reasons),
        }

    @classmethod
    def from_dict(cls, data: Any) -> "SolveResult":
        """从持久化字典重建结果。"""
        if not isinstance(data, dict):
            raise ValueError("solve result 必须是对象")
        packing = data.get("packing")
        schedule = data.get("schedule")
        return cls(
            packing=PackingResult.from_dict(packing) if packing else None,
            schedule=ScheduleResult.from_dict(schedule) if schedule else None,
            feasible=bool(data.get("feasible", True)),
            reasons=[str(x) for x in data.get("reasons", [])],
        )
