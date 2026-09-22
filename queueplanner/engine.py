from __future__ import annotations

from dataclasses import dataclass, field
from threading import RLock
from typing import Any

from .models import Manifest, TaskStatus
from .scheduler import Schedule, calculate_ranks, next_window_start, schedule_manifest


@dataclass
class Run:
    task_id: str
    machine_id: str
    start: int
    end: int
    remaining: int


@dataclass
class TaskState:
    task_id: str
    status: TaskStatus = TaskStatus.WAITING
    machine_id: str | None = None
    start: int | None = None
    end: int | None = None
    attempts: int = 0
    blocked_by: list[str] = field(default_factory=list)
    stale: bool = False
    stale_accepted: bool = False
    stale_reasons: list[str] = field(default_factory=list)
    last_error: str = ""
    material_versions: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "machine_id": self.machine_id,
            "start": self.start,
            "end": self.end,
            "attempts": self.attempts,
            "blocked_by": self.blocked_by,
            "stale": self.stale,
            "stale_accepted": self.stale_accepted,
            "stale_reasons": self.stale_reasons,
            "last_error": self.last_error,
            "material_versions": self.material_versions,
        }


@dataclass
class Event:
    time: int
    level: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {"time": self.time, "level": self.level, "message": self.message}


class QueueEngine:
    def __init__(self, manifest: Manifest, schedule: Schedule | None = None):
        self.manifest = manifest
        self.schedule = schedule or schedule_manifest(manifest)
        self.ranks = calculate_ranks(manifest)
        self.now = min((item.start for item in self.schedule.assignments.values()), default=0)
        self.lock = RLock()
        self.machine_paused = {machine.id: False for machine in manifest.machines}
        self.states = {task.id: TaskState(task.id) for task in manifest.tasks}
        self.runs: dict[str, Run] = {}
        self.material_versions = {item.id: item.version for item in manifest.materials}
        self.events: list[Event] = []
        self.completed_order: list[str] = []
        self._log("info", "队列已载入并完成依赖与可用窗排程")

    def _log(self, level: str, message: str) -> None:
        self.events.append(Event(self.now, level, message))
        del self.events[:-300]

    def descendants(self, task_id: str) -> set[str]:
        result: set[str] = set()
        stack = [task_id]
        while stack:
            current = stack.pop()
            for task in self.manifest.tasks:
                if current in task.depends and task.id not in result:
                    result.add(task.id)
                    stack.append(task.id)
        return result

    def _refresh_blocked(self) -> None:
        for task in self.manifest.tasks:
            state = self.states[task.id]
            if state.status not in (TaskStatus.WAITING, TaskStatus.BLOCKED, TaskStatus.FAILED):
                continue
            failed_parents = [
                parent for parent in task.depends
                if self.states[parent].status in (TaskStatus.FAILED, TaskStatus.BLOCKED)
            ]
            if failed_parents:
                state.status = TaskStatus.BLOCKED
                state.blocked_by = failed_parents
            elif state.status == TaskStatus.BLOCKED:
                state.status = TaskStatus.WAITING
                state.blocked_by = []

    def tick(self) -> None:
        with self.lock:
            completed = []
            for task_id, run in list(self.runs.items()):
                run.remaining -= 1
                if run.remaining <= 0:
                    completed.append(task_id)
            for task_id in completed:
                run = self.runs.pop(task_id)
                state = self.states[task_id]
                state.status = TaskStatus.COMPLETED
                state.end = run.end
                state.machine_id = run.machine_id
                self.completed_order.append(task_id)
                self._log("success", f"任务 {task_id} 已在机器 {run.machine_id} 完成")
            self._refresh_blocked()
            self._dispatch()
            self.now += 1

    def run_until(self, minute: int) -> None:
        with self.lock:
            while self.now < minute:
                self.tick()

    def _dispatch(self) -> None:
        by_id = self.manifest.task_map()
        machine_map = self.manifest.machine_map()
        occupied = {run.machine_id for run in self.runs.values()}
        free_machines = [
            machine.id
            for machine in self.manifest.machines
            if not self.machine_paused[machine.id] and machine.id not in occupied
        ]
        ready: list[str] = []
        for task in self.manifest.tasks:
            state = self.states[task.id]
            if state.status != TaskStatus.WAITING or (state.stale and not state.stale_accepted):
                continue
            if all(self.states[parent].status == TaskStatus.COMPLETED for parent in task.depends):
                ready.append(task.id)
        ready.sort(key=lambda task_id: (-self.ranks[task_id], task_id))

        for task_id in ready:
            task = by_id[task_id]
            allowed = [machine_id for machine_id in (task.machine_ids or free_machines) if machine_id in free_machines]
            if not allowed:
                continue
            baseline = self.schedule.assignments.get(task_id)
            preferred = baseline.machine_id if baseline and baseline.machine_id in allowed else allowed[0]
            available_now: list[str] = []
            for candidate in allowed:
                machine = machine_map[candidate]
                start = next_window_start(machine.windows, self.now, task.duration)
                if start == self.now:
                    available_now.append(candidate)
            if not available_now:
                continue
            machine_id = self._choose_machine(task_id, available_now, preferred)
            machine = machine_map[machine_id]
            free_machines.remove(machine_id)
            state = self.states[task_id]
            state.status = TaskStatus.RUNNING
            state.machine_id = machine_id
            state.start = self.now
            state.end = None
            state.attempts += 1
            state.blocked_by = []
            state.material_versions = {
                material_id: self.material_versions[material_id]
                for material_id in task.materials
            }
            self.runs[task_id] = Run(task_id, machine_id, self.now, self.now + task.duration, task.duration)
            self._log("info", f"任务 {task_id} 开始在机器 {machine_id} 执行")

    def _choose_machine(self, task_id: str, allowed: list[str], preferred: str) -> str:
        if preferred in allowed:
            return preferred
        return sorted(allowed)[0]

    def fail_task(self, task_id: str, reason: str = "素材损坏或渲染失败") -> None:
        with self.lock:
            if task_id not in self.states:
                raise KeyError(f"未知任务：{task_id}")
            state = self.states[task_id]
            if state.status != TaskStatus.RUNNING:
                raise ValueError(f"任务 {task_id} 当前不是进行状态，不能注入失败")
            run = self.runs.pop(task_id)
            state.status = TaskStatus.FAILED
            state.machine_id = run.machine_id
            state.end = None
            state.last_error = reason
            affected = sorted(self.descendants(task_id))
            self._refresh_blocked()
            self._log("error", f"任务 {task_id} 失败：{reason}；{len(affected)} 个后续任务受阻")
            return None

    def retry_task(self, task_id: str) -> None:
        with self.lock:
            if task_id not in self.states:
                raise KeyError(f"未知任务：{task_id}")
            state = self.states[task_id]
            if state.status != TaskStatus.FAILED:
                raise ValueError(f"任务 {task_id} 当前不是失败状态")
            state.status = TaskStatus.WAITING
            state.machine_id = None
            state.start = None
            state.end = None
            state.last_error = ""
            state.blocked_by = []
            self._refresh_blocked()
            self._dispatch()
            self._log("info", f"任务 {task_id} 已进入重试，后续任务自动恢复排程")

    def set_machine_paused(self, machine_id: str, paused: bool) -> None:
        with self.lock:
            if machine_id not in self.machine_paused:
                raise KeyError(f"未知机器：{machine_id}")
            self.machine_paused[machine_id] = paused
            action = "暂停" if paused else "恢复"
            self._log("info", f"机器 {machine_id} 已{action}，等待任务按依赖和可用窗重新安排")
            if not paused:
                self._dispatch()

    def material_impact(self, material_id: str, new_version: str) -> dict[str, Any]:
        with self.lock:
            if material_id not in self.material_versions:
                raise KeyError(f"未知素材：{material_id}")
            if not str(new_version).strip():
                raise ValueError("新版本不能为空")
            new_version = str(new_version).strip()
            if self.material_versions[material_id] == new_version:
                raise ValueError("新版本不能与当前版本相同")
            direct = [
                task.id for task in self.manifest.tasks
                if material_id in task.materials
            ]
            affected: set[str] = set(direct)
            for task_id in direct:
                affected.update(self.descendants(task_id))
            by_status: dict[str, list[str]] = {}
            for task_id in sorted(affected):
                status = self.states[task_id].status.value
                by_status.setdefault(status, []).append(task_id)
            return {
                "material_id": material_id,
                "old_version": self.material_versions[material_id],
                "new_version": new_version,
                "direct_consumers": sorted(direct),
                "affected_tasks": sorted(affected),
                "by_status": by_status,
            }

    def replace_material(
        self,
        material_id: str,
        new_version: str,
        rerun: bool,
        selected_tasks: list[str] | None = None,
    ) -> dict[str, Any]:
        with self.lock:
            impact = self.material_impact(material_id, new_version)
            affected = set(impact["affected_tasks"])
            direct = set(impact["direct_consumers"])
            selected: set[str]
            if rerun:
                if selected_tasks is None:
                    selected = set(affected)
                else:
                    selected = set(selected_tasks)
                    unknown = selected - affected
                    if unknown:
                        raise ValueError(f"所选任务不在素材影响范围内：{', '.join(sorted(unknown))}")
                    # 重跑某个已产出的节点时，必须一并重做其下游，避免混用旧结果。
                    closure: set[str] = set()
                    for task_id in selected:
                        closure.add(task_id)
                        closure.update(self.descendants(task_id))
                    required_ancestors: set[str] = set()
                    for task_id in selected:
                        stack = [task_id]
                        while stack:
                            current = stack.pop()
                            for parent in self.manifest.task_map()[current].depends:
                                if parent in affected and parent not in selected:
                                    required_ancestors.add(parent)
                                    stack.append(parent)
                    if required_ancestors:
                        raise ValueError(
                            "重跑下游任务必须同时重跑受影响上游："
                            + ", ".join(sorted(required_ancestors))
                        )
                    selected = closure & affected
            else:
                selected = set()

            old_version = self.material_versions[material_id]
            self.material_versions[material_id] = new_version
            for task_id in sorted(affected):
                state = self.states[task_id]
                is_direct = task_id in direct
                if task_id in selected:
                    self._reset_task(task_id, preserve_attempt=True)
                    if is_direct:
                        state.material_versions[material_id] = new_version
                elif state.status == TaskStatus.COMPLETED or state.stale:
                    state.stale = True
                    state.stale_accepted = not rerun
                    reason = f"素材 {material_id}:{old_version} 已被 {new_version} 替换"
                    if reason not in state.stale_reasons:
                        state.stale_reasons.append(reason)
                elif is_direct and state.status == TaskStatus.RUNNING:
                    state.stale_accepted = not rerun
                elif is_direct:
                    # 尚未启动的直接取用任务天然使用新版本，不算旧结果。
                    state.material_versions[material_id] = new_version
            self._recompute_stale()
            self._refresh_blocked()
            self._dispatch()
            self._log(
                "warning",
                f"素材 {material_id} 替换为 {new_version}，影响 {len(affected)} 个任务，重跑 {len(selected)} 个",
            )
            impact["rerun_tasks"] = sorted(selected)
            return impact

    def accept_stale(self, task_ids: list[str] | None = None) -> list[str]:
        with self.lock:
            targets = set(task_ids) if task_ids is not None else {
                task_id for task_id, state in self.states.items() if state.stale
            }
            unknown = targets - set(self.states)
            if unknown:
                raise KeyError(f"未知任务：{', '.join(sorted(unknown))}")
            for task_id in targets:
                state = self.states[task_id]
                if state.stale:
                    state.stale_accepted = True
            self._recompute_stale()
            self._refresh_blocked()
            self._dispatch()
            self._log("info", f"已接受 {len(targets)} 个任务的旧结果并放行下游")
            return sorted(targets)

    def _reset_task(self, task_id: str, preserve_attempt: bool = True) -> None:
        run = self.runs.pop(task_id, None)
        state = self.states[task_id]
        attempts = state.attempts if preserve_attempt else 0
        material_versions = state.material_versions
        state.status = TaskStatus.WAITING
        state.machine_id = None
        state.start = None
        state.end = None
        state.attempts = attempts
        state.blocked_by = []
        state.stale = False
        state.stale_accepted = False
        state.stale_reasons = []
        state.last_error = ""
        if run:
            self._log("warning", f"任务 {task_id} 被中止并回到队列，将使用新素材重跑")

    def _recompute_stale(self) -> None:
        by_id = self.manifest.task_map()
        for task in self.manifest.tasks:
            state = self.states[task.id]
            material_mismatch = [
                material_id for material_id in task.materials
                if state.material_versions.get(material_id)
                and state.material_versions[material_id] != self.material_versions[material_id]
            ]
            stale_parents = [
                parent for parent in task.depends
                if self.states[parent].stale and not self.states[parent].stale_accepted
            ]
            if material_mismatch or stale_parents:
                state.stale = True
                state.stale_accepted = state.stale_accepted and not stale_parents
                reasons = [f"素材 {item} 版本已更新" for item in material_mismatch]
                reasons.extend(f"上游 {item} 结果已过期" for item in stale_parents)
                state.stale_reasons = list(dict.fromkeys(reasons))
            if state.stale and state.status in (TaskStatus.WAITING, TaskStatus.BLOCKED):
                state.status = TaskStatus.WAITING
                state.blocked_by = []

    def all_done(self) -> bool:
        with self.lock:
            return all(state.status == TaskStatus.COMPLETED for state in self.states.values())

    def _task_payload(self, task_id: str) -> dict[str, Any]:
        task = self.manifest.task_map()[task_id]
        state = self.states[task_id].to_dict()
        state.update(
            {
                "name": task.name,
                "duration": task.duration,
                "depends_on": task.depends,
                "materials": task.materials,
                "eligible_machines": task.machine_ids or [m.id for m in self.manifest.machines],
                "rank": self.ranks[task_id],
                "baseline_machine": self.schedule.assignments[task_id].machine_id,
                "baseline_start": self.schedule.assignments[task_id].start,
                "baseline_end": self.schedule.assignments[task_id].end,
                "logical_index": self.schedule.logical_order.index(task_id),
            }
        )
        return state

    def to_dict(self) -> dict[str, Any]:
        with self.lock:
            remaining = [
                task_id for task_id, state in self.states.items()
                if state.status != TaskStatus.COMPLETED
            ]
            completed = sorted(
                (task_id for task_id, state in self.states.items() if state.status == TaskStatus.COMPLETED),
                key=lambda item: self.schedule.logical_order.index(item),
            )
            return {
                "now": self.now,
                "remaining_tasks": remaining,
                "baseline_makespan": self.schedule.makespan,
                "critical_path": self.schedule.critical_path,
                "baseline_logical_order": self.schedule.logical_order,
                "completed_logical_order": completed,
                "live_completion_order": self.completed_order,
                "order_matches_baseline": completed == [
                    item for item in self.schedule.logical_order if item in completed
                ],
                "machines": [
                    {
                        "id": machine.id,
                        "name": machine.name,
                        "paused": self.machine_paused[machine.id],
                        "windows": [{"start": s, "end": e} for s, e in machine.windows],
                        "current_task": next(
                            (task_id for task_id, run in self.runs.items() if run.machine_id == machine.id),
                            None,
                        ),
                    }
                    for machine in self.manifest.machines
                ],
                "materials": [
                    {
                        "id": material.id,
                        "name": material.name,
                        "path": material.path,
                        "version": self.material_versions[material.id],
                        "original_version": material.version,
                    }
                    for material in self.manifest.materials
                ],
                "tasks": [self._task_payload(task.id) for task in self.manifest.tasks],
                "events": [event.to_dict() for event in reversed(self.events[-120:])],
            }
