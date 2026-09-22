from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .loader import find_cycle
from .models import Manifest, Task

DAY = 24 * 60
MAX_HORIZON_DAYS = 365


@dataclass(frozen=True)
class ScheduledTask:
    task_id: str
    machine_id: str
    start: int
    end: int
    rank: int

    def to_dict(self) -> dict[str, Any]:
        return {"task_id": self.task_id, "machine_id": self.machine_id,
                "start": self.start, "end": self.end, "rank": self.rank}


@dataclass(frozen=True)
class Schedule:
    assignments: dict[str, ScheduledTask]
    makespan: int
    critical_path: list[str]
    logical_order: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {"makespan": self.makespan, "critical_path": self.critical_path,
                "logical_order": self.logical_order,
                "assignments": [self.assignments[x].to_dict() for x in self.logical_order]}


def topological_order(manifest: Manifest) -> list[str]:
    graph = {task.id: set(task.depends) for task in manifest.tasks}
    if find_cycle(graph):
        raise ValueError("cannot schedule a graph containing a cycle")
    indegree = {task_id: len(edges) for task_id, edges in graph.items()}
    ready = sorted(task_id for task_id, degree in indegree.items() if degree == 0)
    order: list[str] = []
    while ready:
        task_id = ready.pop(0)
        order.append(task_id)
        for candidate in sorted(graph):
            if task_id in graph[candidate]:
                graph[candidate].remove(task_id)
                indegree[candidate] -= 1
                if indegree[candidate] == 0:
                    ready.append(candidate)
        ready.sort()
    if len(order) != len(manifest.tasks):
        raise ValueError("cannot schedule a graph containing a cycle")
    return order


def calculate_ranks(manifest: Manifest) -> dict[str, int]:
    by_id = manifest.task_map()
    ranks: dict[str, int] = {}
    for task_id in reversed(topological_order(manifest)):
        task = by_id[task_id]
        children = [ranks[child.id] for child in manifest.tasks if task_id in child.depends]
        ranks[task_id] = task.duration + (max(children) if children else 0)
    return ranks


def next_window_start(windows: tuple[tuple[int, int], ...], earliest: int, duration: int) -> int | None:
    for day in range(MAX_HORIZON_DAYS):
        day_start = day * DAY
        for window_start, window_end in sorted(windows):
            start = max(earliest, day_start + window_start)
            if start + duration <= day_start + window_end:
                return start
    return None


def schedule_manifest(manifest: Manifest) -> Schedule:
    by_id = manifest.task_map()
    machines = manifest.machine_map()
    ranks = calculate_ranks(manifest)
    machine_free = {machine_id: 0 for machine_id in machines}
    assigned: dict[str, ScheduledTask] = {}
    remaining = set(by_id)

    def ready_tasks() -> list[Task]:
        return [
            by_id[task_id]
            for task_id in remaining
            if all(parent in assigned for parent in by_id[task_id].depends)
        ]

    def earliest_for(task: Task) -> tuple[int, int, str] | None:
        allowed = task.machine_ids or list(machines)
        best: tuple[int, int, str] | None = None
        for machine_id in allowed:
            machine = machines[machine_id]
            earliest = max(
                [machine_free[machine_id]]
                + [assigned[parent].end for parent in task.depends]
            )
            start = next_window_start(machine.windows, earliest, task.duration)
            if start is None:
                continue
            candidate = (start + task.duration, start, machine_id)
            if best is None or candidate < best:
                best = candidate
        return best

    while remaining:
        choices: list[tuple[int, int, str, str]] = []
        for task in ready_tasks():
            earliest = earliest_for(task)
            if earliest:
                end, start, machine_id = earliest
                choices.append((-ranks[task.id], end, task.id, machine_id))
        if not choices:
            raise ValueError(f"找不到可容纳任务时长的机器可用窗：{', '.join(sorted(remaining))}")
        _, end, task_id, machine_id = min(choices)
        start = end - by_id[task_id].duration
        assigned[task_id] = ScheduledTask(task_id, machine_id, start, end, ranks[task_id])
        machine_free[machine_id] = end
        remaining.remove(task_id)

    logical_order = sorted(assigned, key=lambda x: (assigned[x].end, assigned[x].rank, x))
    makespan = max(item.end for item in assigned.values())
    critical = _critical_path(by_id, assigned, ranks, logical_order)
    return Schedule(assigned, makespan, critical, logical_order)


def _critical_path(
    by_id: dict[str, Task],
    assigned: dict[str, ScheduledTask],
    ranks: dict[str, int],
    logical_order: list[str],
) -> list[str]:
    if not assigned:
        return []
    current = max(logical_order, key=lambda item: (assigned[item].end, ranks[item]))
    path = [current]
    while by_id[current].depends:
        current = max(
            by_id[current].depends,
            key=lambda item: (assigned[item].end, ranks[item], item),
        )
        path.append(current)
    return list(reversed(path))
