"""查询服务：单项目与整份方案的稳定顺序查询（需求 6）。"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List

from .models import AllocationPlan, Project
from .registry import Registry

_ZERO = Decimal("0.00")


def project_report(registry: Registry, plan: AllocationPlan, project_id: str) -> Dict[str, Any]:
    """单个项目的完整查询结果，键固定、列表稳定排序。

    返回字段：
      id, priority, total_need, min_start, benefit, phases,
      funded（已批金额）, gap（剩余缺口）, started（启动状态）,
      prerequisites（直接前置, 字典序）,
      dependents（被哪些项目直接依赖, 字典序）,
      all_dependents（传递依赖方, 字典序）
    """
    proj: Project = registry.get(project_id)
    funded = plan.amount_for(project_id) if plan is not None else _ZERO
    return {
        "id": proj.project_id,
        "priority": proj.priority,
        "total_need": proj.total_need,
        "min_start": proj.min_start,
        "benefit": proj.benefit,
        "phases": list(proj.phases),
        "funded": funded,
        "gap": proj.total_need - funded,
        "started": funded >= proj.min_start,
        "prerequisites": list(registry.prerequisites(project_id)),
        "dependents": registry.dependents(project_id),
        "all_dependents": registry.all_dependents(project_id),
    }


def plan_summary(plan: AllocationPlan) -> Dict[str, Any]:
    """整份方案汇总：总额、各阶段占用、未满足项，全部按稳定顺序。"""
    phase_usage = plan.phase_usage()
    unmet: List[Dict[str, Any]] = []
    for pid in plan.unmet_ids():
        proj = plan.projects[pid]
        funded = plan.amount_for(pid)
        unmet.append(
            {
                "id": pid,
                "priority": proj.priority,
                "total_need": proj.total_need,
                "funded": funded,
                "gap": proj.total_need - funded,
                "started": plan.is_started(pid),
            }
        )
    funded_rows = [
        {"id": pid, "amount": plan.amount_for(pid)}
        for pid in sorted(plan.allocations)
        if plan.amount_for(pid) > 0
    ]
    return {
        "budget": plan.budget,
        "total_allocated": plan.total,
        "remaining": plan.budget - plan.total,
        "started": plan.started_ids(),
        "funded": funded_rows,
        "phase_usage": [
            {"phase": i + 1, "amount": amt} for i, amt in enumerate(phase_usage)
        ],
        "unmet": unmet,
    }
