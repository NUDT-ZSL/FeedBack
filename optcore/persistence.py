"""JSON 快照持久化与一致性校验。

快照格式：

.. code-block:: json

    {
      "format": "optcore-snapshot",
      "version": 1,
      "problem": {
        "items": [...], "bins": [...], "tasks": [...], "resources": [...]
      },
      "result": { ... SolveResult ... }
    }

``save`` 负责归一化输入并求解后落盘；``load`` 重建 :class:`Problem`
与 :class:`~optcore.models.SolveResult`，除重新执行全部输入校验外，
还会校验结果与输入的一致性（容量、分组不拆箱、依赖先后、release、
资源不重叠、关键路径等）。文件损坏、JSON 非法、字段缺失或校验失败
都抛 :class:`~optcore.errors.PersistenceError`，错误信息定位到具体字段。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from .errors import InvalidInputError, PersistenceError
from .models import (
    PackingResult,
    ScheduleResult,
    SolveResult,
)
from .scheduling import find_cycle, find_resource_overlaps
from .solver import Problem, solve_problem

SNAPSHOT_FORMAT = "optcore-snapshot"
SNAPSHOT_VERSION = 1


@dataclass
class Snapshot:
    """从磁盘重建的快照：问题输入与求解结果。"""

    problem: Problem
    result: Optional[SolveResult]

    def to_dict(self) -> Dict[str, Any]:
        """转为 JSON 友好字典。"""
        return {
            "problem": self.problem.to_dict(),
            "result": self.result.to_dict() if self.result is not None else None,
        }


def _read_json(path: str) -> Any:
    if not os.path.exists(path):
        raise PersistenceError(f"文件不存在: {path}")
    try:
        with open(path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except json.JSONDecodeError as exc:
        raise PersistenceError(
            f"快照文件不是合法 JSON（{path} 第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"
        ) from exc
    except OSError as exc:
        raise PersistenceError(f"无法读取快照文件 {path}: {exc}") from exc


def _problem_from_dict(data: Any) -> Problem:
    if not isinstance(data, dict):
        raise PersistenceError("快照字段 problem 必须是对象")
    for key in ("items", "bins", "tasks", "resources"):
        if key in data and not isinstance(data[key], list):
            raise PersistenceError(f"problem.{key} 必须是数组")
    try:
        problem = Problem.from_raw(
            items=data.get("items", []),
            bins=data.get("bins", []),
            tasks=data.get("tasks", []),
            resources=data.get("resources", []),
        )
    except InvalidInputError as exc:
        raise PersistenceError(f"快照输入校验失败: {exc}") from exc
    return problem


def _check_cycle(problem: Problem, result: Optional[SolveResult]) -> None:
    """依赖环校验：可行快照必须无环；带环时必须有匹配的不可行证明。"""
    cycle = find_cycle(problem.tasks)
    if cycle is None:
        return
    schedule = result.schedule if result is not None else None
    proof = schedule.cycle if schedule is not None else None
    if (
        schedule is not None
        and not schedule.feasible
        and proof
        and set(proof[:-1]) == set(cycle[:-1])
    ):
        return
    raise PersistenceError(
        f"快照任务依赖存在环: {' -> '.join(cycle)}（可行快照要求无环）"
    )


def _verify_packing(problem: Problem, result: PackingResult) -> None:
    """校验装箱结果与输入一致。"""
    items_by_id = {item.item_id: item for item in problem.items}
    bins_by_id = {bin_spec.bin_id: bin_spec for bin_spec in problem.bins}
    capacity_by_bin: Dict[str, float] = {}
    placed: Dict[str, str] = {}

    if result.used_bins != len(result.bins):
        raise PersistenceError(
            f"装箱结果不一致: used_bins={result.used_bins} 但 bins 中记录了 "
            f"{len(result.bins)} 个箱子"
        )
    for bin_id, item_ids in result.bins.items():
        if bin_id not in bins_by_id:
            raise PersistenceError(f"装箱结果引用了不存在的箱子 {bin_id!r}")
        load = 0.0
        groups_in_bin: Dict[str, List[str]] = {}
        for item_id in item_ids:
            if item_id not in items_by_id:
                raise PersistenceError(
                    f"箱子 {bin_id!r} 引用了不存在的 item_id {item_id!r}"
                )
            if item_id in placed:
                raise PersistenceError(
                    f"物品 {item_id!r} 同时出现在箱子 {placed[item_id]!r} 与 {bin_id!r}"
                )
            placed[item_id] = bin_id
            item = items_by_id[item_id]
            load += item.size
            groups_in_bin.setdefault(item.group, []).append(item_id)
        capacity_by_bin[bin_id] = bins_by_id[bin_id].capacity
        if load > bins_by_id[bin_id].capacity + 1e-9:
            raise PersistenceError(
                f"箱子 {bin_id!r} 超载: 负载 {load:g} > 容量 {bins_by_id[bin_id].capacity:g}"
            )

    # 同一 group 不得跨箱。
    group_bins: Dict[str, str] = {}
    for item_id, bin_id in placed.items():
        group = items_by_id[item_id].group
        if group in group_bins and group_bins[group] != bin_id:
            raise PersistenceError(
                f"分组 {group!r} 被拆到多个箱子: {group_bins[group]!r} 与 {bin_id!r}"
            )
        group_bins[group] = bin_id

    if result.feasible:
        missing = sorted(set(items_by_id) - set(placed))
        if missing:
            raise PersistenceError(f"装箱结果遗漏了物品: {missing}")
        # 下界不得超过实际用箱数。
        if result.lower_bound > result.used_bins:
            raise PersistenceError(
                f"装箱结果不一致: lower_bound={result.lower_bound} > "
                f"used_bins={result.used_bins}"
            )
    else:
        if placed:
            raise PersistenceError("feasible=false 的装箱结果不应包含物品分配")


def _verify_schedule(problem: Problem, result: ScheduleResult) -> None:
    """校验排程结果与输入一致。"""
    tasks_by_id = {task.task_id: task for task in problem.tasks}

    if result.cycle is not None:
        return  # 带环证明的不可行结果，结构在输出时另行保证

    if len(result.assignments) != len(tasks_by_id):
        raise PersistenceError(
            f"排程结果不一致: 共 {len(tasks_by_id)} 个任务但分配了 "
            f"{len(result.assignments)} 个"
        )
    windows: Dict[str, tuple] = {}
    for task_id, span in result.assignments.items():
        if task_id not in tasks_by_id:
            raise PersistenceError(f"排程结果引用了不存在的 task_id {task_id!r}")
        if not (isinstance(span, (list, tuple)) and len(span) == 2):
            raise PersistenceError(f"任务 {task_id!r} 的时间区间必须是 [start, end]")
        start, end = span
        task = tasks_by_id[task_id]
        if end - start != task.duration:
            raise PersistenceError(
                f"任务 {task_id!r} 区间 [{start}, {end}) 长度 != duration {task.duration}"
            )
        if start < task.release:
            raise PersistenceError(
                f"任务 {task_id!r} 开始 {start} 早于 release {task.release}"
            )
        for dep in task.deps:
            dep_end = result.assignments[dep][1]
            if start < dep_end:
                raise PersistenceError(
                    f"任务 {task_id!r} 开始 {start} 早于前置 {dep!r} 完成 {dep_end}"
                )
        windows[task_id] = (start, end)

    overlaps = find_resource_overlaps(windows, problem.tasks)
    if overlaps:
        rendered = [
            f"资源 {r!s} 时间窗 [{s}, {e}) 上的任务 {tids}"
            for r, s, e, tids in overlaps
        ]
        raise PersistenceError("排程结果存在资源冲突: " + "; ".join(rendered))

    if result.makespan != max((e for _s, e in windows.values()), default=0):
        raise PersistenceError(
            f"makespan={result.makespan} 与实际最大结束时间不一致"
        )

    # 关键路径必须是真实的依赖链；“关键路径”按规格是最长*依赖*链，
    # 其长度可能小于 makespan（资源串行会进一步推迟任务），因此与依赖
    # 图上按 duration 加权的最长路长度比较，而不是与 makespan 比较。
    # 用 Kahn 拓扑序动态规划求依赖最长路（可行快照保证无环）。
    indegree = {tid: len(tasks_by_id[tid].deps) for tid in tasks_by_id}
    dependents: Dict[str, List[str]] = {tid: [] for tid in tasks_by_id}
    for task in problem.tasks:
        for dep in task.deps:
            dependents[dep].append(task.task_id)
    queue = [tid for tid, deg in indegree.items() if deg == 0]
    dep_longest = {}
    order = []
    while queue:
        tid = queue.pop()
        order.append(tid)
        dep_len = max(
            (dep_longest[dep] for dep in tasks_by_id[tid].deps), default=0
        )
        dep_longest[tid] = dep_len + tasks_by_id[tid].duration
        for nxt in dependents[tid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    expected_chain_len = max(dep_longest.values(), default=0)

    chain = result.critical_path
    if chain:
        if any(tid not in tasks_by_id for tid in chain):
            raise PersistenceError("critical_path 引用了不存在的 task_id")
        chain_len = 0
        for i, tid in enumerate(chain):
            task = tasks_by_id[tid]
            chain_len += task.duration
            if i > 0 and chain[i - 1] not in task.deps:
                raise PersistenceError(
                    f"critical_path 中 {chain[i - 1]!r} 不是 {tid!r} 的前置"
                )
        if chain_len != expected_chain_len:
            raise PersistenceError(
                f"critical_path 长度 {chain_len} 不是最长依赖链长度 "
                f"{expected_chain_len}"
            )
    elif expected_chain_len:
        raise PersistenceError("critical_path 为空但存在任务")


def verify_snapshot(problem: Problem, result: Optional[SolveResult]) -> None:
    """校验求解结果与问题输入的全部一致性约束。

    :raises PersistenceError: 发现任何不一致。
    """
    if result is None:
        return
    if result.packing is not None:
        _verify_packing(problem, result.packing)
    if result.schedule is not None:
        _verify_schedule(problem, result.schedule)
    expected_feasible = (
        result.packing is None or result.packing.feasible
    ) and (result.schedule is None or result.schedule.feasible)
    if result.feasible != expected_feasible:
        raise PersistenceError(
            f"feasible={result.feasible} 与子问题可行状态不一致"
        )


def save_problem(
    path: str,
    problem: Problem,
    result: Optional[SolveResult] = None,
) -> str:
    """把问题（可选附带求解结果）写入 JSON 快照文件。

    :returns: 实际写入的路径。
    """
    payload = {
        "format": SNAPSHOT_FORMAT,
        "version": SNAPSHOT_VERSION,
        "problem": problem.to_dict(),
        "result": result.to_dict() if result is not None else None,
    }
    try:
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
    except OSError as exc:
        raise PersistenceError(f"无法写入快照文件 {path}: {exc}") from exc
    return path


def load_snapshot(path: str) -> Snapshot:
    """读取快照并重建、校验问题与结果。

    :raises PersistenceError: 文件不存在、JSON 损坏、字段缺失、
        输入非法、依赖成环或结果与输入不一致。
    """
    data = _read_json(path)
    if not isinstance(data, dict):
        raise PersistenceError("快照根节点必须是 JSON 对象")
    if data.get("format") != SNAPSHOT_FORMAT:
        raise PersistenceError(
            f"不是 {SNAPSHOT_FORMAT} 快照（format={data.get('format')!r}）"
        )
    if data.get("version") != SNAPSHOT_VERSION:
        raise PersistenceError(
            f"不支持的快照版本: {data.get('version')!r}，当前支持 {SNAPSHOT_VERSION}"
        )
    if "problem" not in data:
        raise PersistenceError("快照缺少字段 problem")
    problem = _problem_from_dict(data["problem"])

    result: Optional[SolveResult] = None
    if data.get("result") is not None:
        try:
            result = SolveResult.from_dict(data["result"])
        except (ValueError, TypeError, KeyError) as exc:
            raise PersistenceError(f"快照结果解析失败: {exc}") from exc
    _check_cycle(problem, result)
    verify_snapshot(problem, result)
    return Snapshot(problem=problem, result=result)


def load_problem(path: str) -> Problem:
    """只读取快照中的问题输入。"""
    return load_snapshot(path).problem


def load_result(path: str) -> SolveResult:
    """读取快照中的求解结果；缺失结果时当场重算。"""
    snapshot = load_snapshot(path)
    if snapshot.result is None:
        return solve_problem(snapshot.problem)
    return snapshot.result


def save_result(
    path: str,
    result: SolveResult,
    problem: Optional[Problem] = None,
) -> str:
    """把求解结果连同问题（可缺省为空问题）写入快照。"""
    return save_problem(path, problem or Problem(), result)


def save(
    path: str,
    items: Optional[Sequence[Any]] = None,
    bins: Optional[Sequence[Any]] = None,
    tasks: Optional[Sequence[Any]] = None,
    resources: Optional[Sequence[Any]] = None,
    result: Optional[SolveResult] = None,
) -> str:
    """一站式保存：归一化输入、求解（未提供 result 时）并写入快照。

    :raises InvalidInputError: 输入不合法。
    :raises PersistenceError: 写盘失败。
    """
    problem = Problem.from_raw(items, bins, tasks, resources)
    if result is None:
        result = solve_problem(problem)
    return save_problem(path, problem, result)


def load(path: str) -> Snapshot:
    """``load_snapshot`` 的短名入口。"""
    return load_snapshot(path)
