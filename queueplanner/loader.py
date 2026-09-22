from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .models import Machine, Manifest, ManifestError, Material, Task, ValidationIssue


def load_manifest(path: str | Path) -> Manifest:
    with Path(path).open("r", encoding="utf-8") as handle:
        return parse_manifest(json.load(handle))


def parse_manifest(data: Any) -> Manifest:
    issues: list[ValidationIssue] = []
    if not isinstance(data, dict):
        raise ManifestError([ValidationIssue("invalid_root", "清单必须是 JSON 对象")])

    materials, material_issues = _parse_materials(data.get("materials", []))
    machines, machine_issues = _parse_machines(data.get("machines", []))
    tasks, task_issues = _parse_tasks(
        data.get("tasks", []),
        {item.id for item in materials},
        {item.id for item in machines},
    )
    issues.extend([*material_issues, *machine_issues, *task_issues])
    if not materials:
        issues.append(ValidationIssue("materials.empty", "至少需要一个素材", "materials"))
    if not machines:
        issues.append(ValidationIssue("machines.empty", "至少需要一台机器", "machines"))
    if not tasks:
        issues.append(ValidationIssue("tasks.empty", "至少需要一个任务", "tasks"))

    task_ids = {item.id for item in tasks}
    producers = _collect_producers(tasks, issues)
    _infer_material_dependencies(tasks, producers)
    _validate_relations(tasks, task_ids, producers, issues)

    if issues:
        raise ManifestError(issues)
    return Manifest(tasks=tasks, machines=machines, materials=materials)


def _parse_materials(raw: Any) -> tuple[list[Material], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    if not isinstance(raw, list):
        return [], [ValidationIssue("materials.type", "materials 必须是数组", "materials")]
    result: list[Material] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        path = f"materials[{index}]"
        if not isinstance(item, dict):
            issues.append(ValidationIssue("material.type", "素材必须是对象", path))
            continue
        material_id = str(item.get("id", "")).strip()
        if not material_id:
            issues.append(ValidationIssue("material.id", "素材 id 不能为空", f"{path}.id"))
        elif material_id in seen:
            issues.append(ValidationIssue("material.duplicate", f"素材 id 重复：{material_id}", f"{path}.id"))
        else:
            seen.add(material_id)
        result.append(
            Material(
                id=material_id,
                name=str(item.get("name", material_id)),
                version=str(item.get("version", "v1")),
                path=str(item.get("path", "")),
            )
        )
    return result, issues


def _parse_time(value: Any, path: str, issues: list[ValidationIssue]) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        issues.append(ValidationIssue("time.type", f"{path} 必须是分钟数或 HH:MM", path))
        return None
    if isinstance(value, str):
        text = value.strip()
        if ":" not in text:
            try:
                value = int(text)
            except ValueError:
                issues.append(ValidationIssue("time.format", f"{path} 时间格式错误", path))
                return None
        else:
            parts = text.split(":", 1)
            try:
                hour, minute = int(parts[0]), int(parts[1])
            except ValueError:
                issues.append(ValidationIssue("time.format", f"{path} 时间格式错误", path))
                return None
            if not 0 <= hour <= 23 or not 0 <= minute <= 59:
                issues.append(ValidationIssue("time.range", f"{path} 时间超出范围", path))
                return None
            return hour * 60 + minute
    number = int(value)
    if number < 0:
        issues.append(ValidationIssue("time.range", f"{path} 时间不能为负", path))
        return None
    return number


def _parse_machines(raw: Any) -> tuple[list[Machine], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    if not isinstance(raw, list):
        return [], [ValidationIssue("machines.type", "machines 必须是数组", "machines")]
    result: list[Machine] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        path = f"machines[{index}]"
        if not isinstance(item, dict):
            issues.append(ValidationIssue("machine.type", "机器必须是对象", path))
            continue
        machine_id = str(item.get("id", "")).strip()
        if not machine_id:
            issues.append(ValidationIssue("machine.id", "机器 id 不能为空", f"{path}.id"))
        elif machine_id in seen:
            issues.append(ValidationIssue("machine.duplicate", f"机器 id 重复：{machine_id}", f"{path}.id"))
        else:
            seen.add(machine_id)
        windows_raw = item.get("availability", item.get("windows", []))
        if not windows_raw:
            windows = ((0, 24 * 60),)
        elif not isinstance(windows_raw, list):
            issues.append(ValidationIssue("machine.windows", "availability 必须是数组", f"{path}.availability"))
            windows = ()
        else:
            windows_list: list[tuple[int, int]] = []
            for w_index, window in enumerate(windows_raw):
                wpath = f"{path}.availability[{w_index}]"
                if not isinstance(window, dict):
                    issues.append(ValidationIssue("window.type", "可用时段必须是对象", wpath))
                    continue
                start = _parse_time(window.get("start", 0), f"{wpath}.start", issues)
                end = _parse_time(window.get("end", 24 * 60), f"{wpath}.end", issues)
                if start is not None and end is not None:
                    if start >= end:
                        issues.append(ValidationIssue("window.range", "可用时段开始必须早于结束", wpath))
                    else:
                        windows_list.append((start, min(end, 24 * 60)))
            windows = tuple(windows_list)
        result.append(Machine(id=machine_id, name=str(item.get("name", machine_id)), windows=windows))
    return result, issues


def _string_list(value: Any, path: str, issues: list[ValidationIssue], code: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        issues.append(ValidationIssue(code, f"{path} 必须是数组", path))
        return []
    result = []
    for index, item in enumerate(value):
        text = str(item).strip() if item is not None else ""
        if not text:
            issues.append(ValidationIssue(code, f"{path}[{index}] 不能为空", f"{path}[{index}]"))
        else:
            result.append(text)
    return result


def _parse_tasks(
    raw: Any, material_ids: set[str], machine_ids: set[str]
) -> tuple[list[Task], list[ValidationIssue]]:
    issues: list[ValidationIssue] = []
    if not isinstance(raw, list):
        return [], [ValidationIssue("tasks.type", "tasks 必须是数组", "tasks")]
    result: list[Task] = []
    seen: set[str] = set()
    for index, item in enumerate(raw):
        path = f"tasks[{index}]"
        if not isinstance(item, dict):
            issues.append(ValidationIssue("task.type", "任务必须是对象", path))
            continue
        task_id = str(item.get("id", "")).strip()
        if not task_id:
            issues.append(ValidationIssue("task.id", "任务 id 不能为空", f"{path}.id"))
        elif task_id in seen:
            issues.append(ValidationIssue("task.duplicate", f"任务 id 重复：{task_id}", f"{path}.id"))
        else:
            seen.add(task_id)
        duration = item.get("duration", 0)
        if isinstance(duration, bool) or not isinstance(duration, int) or duration <= 0:
            issues.append(ValidationIssue("task.duration", f"任务 {task_id or index} 时长必须是正整数分钟", f"{path}.duration"))
            duration = 0
        explicit = _string_list(item.get("depends_on", []), f"{path}.depends_on", issues, "task.depends")
        materials = _string_list(item.get("materials", []), f"{path}.materials", issues, "task.materials")
        allowed_machines = _string_list(
            item.get("machines", item.get("machine_ids", [])), f"{path}.machines", issues, "task.machines"
        )
        for material_id in materials:
            if material_id not in material_ids:
                issues.append(ValidationIssue("material.missing", f"任务 {task_id} 引用了不存在的素材 {material_id}", f"{path}.materials"))
        for machine_id in allowed_machines:
            if machine_id not in machine_ids:
                issues.append(ValidationIssue("machine.missing", f"任务 {task_id} 引用了不存在的机器 {machine_id}", f"{path}.machines"))
        if len(materials) != len(set(materials)):
            issues.append(ValidationIssue("task.duplicate_material", f"任务 {task_id} 重复引用素材", f"{path}.materials"))
        if len(explicit) != len(set(explicit)):
            issues.append(ValidationIssue("task.duplicate_dependency", f"任务 {task_id} 重复声明依赖", f"{path}.depends_on"))
        produces = item.get("produces")
        if produces is not None and str(produces).strip():
            produces = str(produces).strip()
            if produces not in material_ids:
                issues.append(ValidationIssue("material.missing", f"任务 {task_id} 产出了不存在的素材 {produces}", f"{path}.produces"))
        else:
            produces = None
        result.append(
            Task(
                id=task_id,
                name=str(item.get("name", task_id)),
                duration=duration,
                explicit_depends=explicit,
                materials=materials,
                machine_ids=allowed_machines,
                produces=produces,
            )
        )
    return result, issues


def _collect_producers(tasks: list[Task], issues: list[ValidationIssue]) -> dict[str, str]:
    producers: dict[str, str] = {}
    for task in tasks:
        material_id = task.produces
        if material_id:
            if material_id in producers and producers[material_id] != task.id:
                issues.append(
                    ValidationIssue(
                        "material.multiple_producers",
                        f"素材 {material_id} 同时被 {producers[material_id]} 和 {task.id} 产出",
                        f"tasks.{task.id}",
                    )
                )
            producers[material_id] = task.id
    return producers


def _infer_material_dependencies(tasks: list[Task], producers: dict[str, str]) -> None:
    for task in tasks:
        inferred = [
            producers[material_id]
            for material_id in task.materials
            if material_id in producers and producers[material_id] != task.id
        ]
        task.material_depends = list(dict.fromkeys(inferred))


def _validate_relations(
    tasks: list[Task],
    task_ids: set[str],
    producers: dict[str, str],
    issues: list[ValidationIssue],
) -> None:
    by_id = {task.id: task for task in tasks}
    for task in tasks:
        for dependency_id in task.explicit_depends:
            if dependency_id not in task_ids:
                issues.append(
                    ValidationIssue(
                        "task.missing_dependency",
                        f"任务 {task.id} 依赖了不存在的任务 {dependency_id}",
                        f"tasks.{task.id}.depends_on",
                    )
                )
            elif dependency_id == task.id:
                issues.append(
                    ValidationIssue(
                        "task.self_dependency",
                        f"任务 {task.id} 不能依赖自己",
                        f"tasks.{task.id}.depends_on",
                    )
                )
    dependency_graph = {task.id: set(task.depends) & task_ids for task in tasks}
    cycle = find_cycle(dependency_graph)
    if cycle:
        issues.append(
            ValidationIssue(
                "dependency.cycle",
                "检测到循环依赖：" + " -> ".join(cycle),
                "tasks",
            )
        )


def find_cycle(graph: dict[str, set[str]]) -> list[str]:
    visiting: set[str] = set()
    visited: set[str] = set()
    stack: list[str] = []

    def visit(node: str) -> list[str] | None:
        visiting.add(node)
        stack.append(node)
        for neighbor in sorted(graph.get(node, set())):
            if neighbor in visited or neighbor not in graph:
                continue
            if neighbor in visiting:
                start = stack.index(neighbor)
                return [*stack[start:], neighbor]
            result = visit(neighbor)
            if result:
                return result
        stack.pop()
        visiting.remove(node)
        visited.add(node)
        return None

    for node in sorted(graph):
        if node not in visited:
            result = visit(node)
            if result:
                return result
    return []
