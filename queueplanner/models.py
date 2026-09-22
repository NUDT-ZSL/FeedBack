from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TaskStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    BLOCKED = "blocked"
    FAILED = "failed"
    COMPLETED = "completed"


@dataclass(frozen=True)
class Material:
    id: str
    name: str
    version: str
    path: str = ""


@dataclass(frozen=True)
class Machine:
    id: str
    name: str
    windows: tuple[tuple[int, int], ...]


@dataclass
class Task:
    id: str
    name: str
    duration: int
    explicit_depends: list[str] = field(default_factory=list)
    material_depends: list[str] = field(default_factory=list)
    materials: list[str] = field(default_factory=list)
    machine_ids: list[str] = field(default_factory=list)
    produces: str | None = None

    @property
    def depends(self) -> list[str]:
        return list(dict.fromkeys([*self.explicit_depends, *self.material_depends]))


@dataclass
class Manifest:
    tasks: list[Task]
    machines: list[Machine]
    materials: list[Material]

    def task_map(self) -> dict[str, Task]:
        return {task.id: task for task in self.tasks}

    def machine_map(self) -> dict[str, Machine]:
        return {machine.id: machine for machine in self.machines}

    def material_map(self) -> dict[str, Material]:
        return {material.id: material for material in self.materials}


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "path": self.path}


class ManifestError(ValueError):
    def __init__(self, issues: list[ValidationIssue]):
        self.issues = issues
        super().__init__("; ".join(issue.message for issue in issues))
