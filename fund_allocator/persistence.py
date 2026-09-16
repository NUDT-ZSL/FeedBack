"""文件持久化（需求 7）。

文件为单份 UTF-8 JSON，结构：

    {
      "version": 1,
      "budget": "1000.00",
      "projects": [
        {"id": "P1", "priority": 1, "total_need": "300.00",
         "min_start": "100.00", "benefit": "400.00",
         "phases": ["100.00", "200.00"]}
      ],
      "dependencies": [{"project": "P2", "requires": "P1"}],
      "plan": {"allocations": [{"project_id": "P1", "amount": "300.00"}]}
    }

载入时做全量校验（标识唯一、阶段之和守恒、依赖无环/无悬空、
单项金额合法、已批合计不超上限、门控与启动下限）。
所有解析与校验都在临时对象上完成，**全部通过后才一次性替换调用方
状态**——任何一步失败，引擎原有状态保持不变。
写入采用“同目录临时文件 + os.replace”原子替换，避免半写文件。
"""

from __future__ import annotations

import json
import os
import tempfile
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .engine import Engine
from .errors import (
    AllocationError,
    DependencyError,
    PersistenceError,
    PlanError,
    ValidationError,
)
from .models import AllocationPlan, Project, money
from .registry import Registry

FORMAT_VERSION = 1


# ============================ 保存 ============================

def engine_to_dict(engine: Engine) -> Dict[str, Any]:
    if engine.plan is None:
        raise PlanError("尚未生成分配方案，无可保存的方案（可只保存项目请用 scenario_dict）")
    projects, prereqs = engine.registry.snapshot()
    deps = [
        {"project": pid, "requires": pre}
        for pid in sorted(prereqs)
        for pre in sorted(prereqs[pid])
    ]
    return {
        "version": FORMAT_VERSION,
        "budget": str(engine.plan.budget),
        "projects": [projects[pid].to_dict() for pid in sorted(projects)],
        "dependencies": deps,
        "plan": engine.plan.to_dict(),
    }


def scenario_dict(registry: Registry, budget: Any) -> Dict[str, Any]:
    """只保存项目/依赖/资金上限（尚无方案时使用）。"""
    projects, prereqs = registry.snapshot()
    return {
        "version": FORMAT_VERSION,
        "budget": str(money(budget, "budget")),
        "projects": [projects[pid].to_dict() for pid in sorted(projects)],
        "dependencies": [
            {"project": pid, "requires": pre}
            for pid in sorted(prereqs)
            for pre in sorted(prereqs[pid])
        ],
    }


def save_to(path: str, engine: Engine) -> None:
    """原子写入：先写同目录临时文件，再 os.replace 覆盖目标。"""
    data = engine_to_dict(engine)
    _atomic_write_json(path, data)


def save_scenario(path: str, registry: Registry, budget: Any) -> None:
    _atomic_write_json(path, scenario_dict(registry, budget))


def _atomic_write_json(path: str, data: Mapping[str, Any]) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".fundplan-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=False)
            f.write("\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ============================ 载入 ============================

def _fail(msg: str, cause: Optional[BaseException] = None) -> "PersistenceError":
    err = PersistenceError(msg)
    if cause is not None:
        err.__cause__ = cause
    return err


def _read_json(path: str) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        raise _fail(f"文件不存在: {path}")
    except OSError as exc:
        raise _fail(f"无法读取文件 {path}: {exc}", exc)
    if not text.strip():
        raise _fail(f"文件为空: {path}")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise _fail(
            f"JSON 损坏（第 {exc.lineno} 行第 {exc.colno} 列附近）: {exc.msg}",
            exc,
        )


def load_new(path: str) -> Engine:
    """从文件构建一个全新的 Engine；失败抛 PersistenceError，无副作用。"""
    data = _read_json(path)
    registry, budget, plan = _build(data, source=path)
    engine = Engine(registry)
    engine.plan = plan  # 可能为 None（文件中没有方案）
    engine._loaded_budget = budget  # type: ignore[attr-defined]
    return engine


def load_into(path: str, engine: Engine) -> Engine:
    """把文件内容载入**已有** Engine：全部校验通过后才替换其状态。

    失败时 engine 的 registry / plan 原样保留。
    """
    data = _read_json(path)
    registry, budget, plan = _build(data, source=path)
    engine.registry = registry
    engine.plan = plan
    engine._loaded_budget = budget  # type: ignore[attr-defined]
    return engine


def _build(
    raw: Any, *, source: str = "<memory>"
) -> Tuple[Registry, Decimal, Optional[AllocationPlan]]:
    """在临时对象上完成全部解析与校验；任何异常包装为 PersistenceError。"""
    try:
        if not isinstance(raw, Mapping):
            raise ValidationError("顶层必须是 JSON 对象", "$")
        if "budget" not in raw:
            raise ValidationError("缺少必填字段 'budget'", "$", "budget")
        if "projects" not in raw:
            raise ValidationError("缺少必填字段 'projects'", "$", "projects")
        budget = money(raw["budget"], "budget")
        if budget < 0:
            raise ValidationError(f"资金上限不能为负: {budget}", "budget")

        raw_projects = raw["projects"]
        if not isinstance(raw_projects, list):
            raise ValidationError("projects 必须是数组", "projects")

        # ---- 项目：构造即完成阶段守恒/金额/下限校验 ----
        registry = Registry()
        seen: set = set()
        projects: Dict[str, Project] = {}
        for i, item in enumerate(raw_projects):
            proj = Project.from_dict(item, index=i)
            if proj.project_id in seen:
                raise ValidationError(
                    f"项目标识 {proj.project_id!r} 重复",
                    f"projects[{i}].id",
                    "id",
                )
            seen.add(proj.project_id)
            registry.add_project(proj)
            projects[proj.project_id] = proj

        # ---- 依赖：悬空引用 + 环 ----
        prereq_map: Dict[str, List[str]] = {}
        raw_deps = raw.get("dependencies", [])
        if not isinstance(raw_deps, list):
            raise ValidationError("dependencies 必须是数组", "dependencies")
        for i, edge in enumerate(raw_deps):
            loc = f"dependencies[{i}]"
            if not isinstance(edge, Mapping):
                raise ValidationError("依赖项必须是对象", loc)
            if "project" not in edge or "requires" not in edge:
                raise ValidationError(
                    "依赖项必须包含 'project' 与 'requires' 两个字段", loc
                )
            a, b = edge["project"], edge["requires"]
            if not isinstance(a, str) or not isinstance(b, str):
                raise ValidationError("依赖两端必须是字符串 id", loc)
            if a not in projects:
                raise DependencyError(
                    f"依赖方项目 {a!r} 不存在", [a, b]
                )
            if b not in projects:
                raise DependencyError(
                    f"被依赖项目 {b!r} 不存在", [a, b]
                )
            prereq_map.setdefault(a, []).append(b)
        # 统一添加（add_dependency 逐条做环检测，重复边幂等处理）
        for a in sorted(prereq_map):
            for b in prereq_map[a]:
                try:
                    registry.add_dependency(a, b)
                except DependencyError as exc:
                    raise DependencyError(
                        f"依赖配置非法（{exc.message}）", exc.chain
                    )
        cycle = registry.find_cycle()
        if cycle is not None:  # 双保险
            raise DependencyError("依赖图存在环", cycle)

        # ---- 方案（可选） ----
        plan: Optional[AllocationPlan] = None
        if "plan" in raw and raw["plan"] is not None:
            plan = _build_plan(raw["plan"], registry, budget)

        return registry, budget, plan

    except PersistenceError:
        raise
    except AllocationError as exc:
        raise _fail(f"载入 {source} 失败：{exc}", exc)


def _build_plan(
    raw_plan: Any, registry: Registry, budget: Decimal
) -> AllocationPlan:
    if not isinstance(raw_plan, Mapping):
        raise ValidationError("plan 必须是对象", "plan")
    rows = raw_plan.get("allocations", [])
    if not isinstance(rows, list):
        raise ValidationError("plan.allocations 必须是数组", "plan.allocations")
    allocations: Dict[str, Decimal] = {}
    for i, row in enumerate(rows):
        loc = f"plan.allocations[{i}]"
        if not isinstance(row, Mapping):
            raise ValidationError("拨款项必须是对象", loc)
        if "project_id" not in row or "amount" not in row:
            raise ValidationError(
                "拨款项必须包含 'project_id' 与 'amount'", loc
            )
        pid = row["project_id"]
        if not isinstance(pid, str):
            raise ValidationError("project_id 必须是字符串", f"{loc}.project_id")
        if pid not in registry.projects():
            raise ValidationError(
                f"拨款引用了不存在的项目 {pid!r}", f"{loc}.project_id"
            )
        if pid in allocations:
            raise ValidationError(
                f"项目 {pid!r} 在方案中出现多次", f"{loc}.project_id"
            )
        amt = money(row["amount"], f"{loc}.amount")
        allocations[pid] = amt

    _, prereqs = registry.snapshot()
    plan = AllocationPlan(
        budget=budget,
        allocations=allocations,
        projects=registry.projects(),
        prerequisites=dict(prereqs),
    )
    # 单项范围 / 启动下限 / 前置门控 / 合计不超上限，一次性校验
    plan.validate()
    return plan
