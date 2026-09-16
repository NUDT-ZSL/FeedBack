"""引擎门面：全量求解、削减后增量重算与查询的统一入口。

增量重算语义（需求 5）：
    当项目 X 被削减/取消时，只允许重算 R = {X} ∪ X 的全部下游项目；
    R 之外的项目拨款视为已承诺、保持不变。重算等价于：以“R 之外项目
    按当前金额锁定、X 按削减后金额锁定”为约束，对候选集 R 做一次全新
    求解。因此增量结果与带同样约束从头求解的结果**逐项目完全一致**，
    而未受影响项目拨款分文不动（测试中会同时校验这两条）。

    注意：削减是新增的硬约束（该项目此后被锁定在新金额），并非“假装
    历史承诺不存在”。这正是“只动下游”与“与从头求解一致”能够同时成立
    的含义。
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .errors import PlanError, ValidationError
from .models import AllocationPlan, Project, money
from .queries import plan_summary, project_report
from .registry import Registry
from .solver import SolveRequest, Solver

_ZERO = Decimal("0.00")


class Engine:
    def __init__(self, registry: Registry) -> None:
        self.registry = registry
        self.plan: Optional[AllocationPlan] = None

    # ---- 全量求解 ----

    def solve(
        self,
        budget: Any,
        *,
        candidate_ids: Optional[Sequence[str]] = None,
        preallocated: Optional[Dict[str, Any]] = None,
    ) -> AllocationPlan:
        """在给定资金上限下产出一份全新的分配方案。"""
        pre = (
            {pid: money(v, f"preallocated[{pid!r}]") for pid, v in preallocated.items()}
            if preallocated
            else {}
        )
        req = SolveRequest(
            registry=self.registry,
            budget=money(budget, "budget"),
            candidate_ids=candidate_ids,
            preallocated=pre,
        )
        self.plan = Solver.solve(req)
        return self.plan

    # ---- 增量重算 ----

    def affected_region(self, project_id: str) -> List[str]:
        """削减某项目时会被重算的区域：自身 + 全部下游，拓扑序稳定返回。"""
        self.registry.get(project_id)
        region = {project_id} | self.registry.downstream_closure([project_id])
        topo = self.registry.topological_order()
        return [pid for pid in topo if pid in region]

    def reduce(
        self,
        project_id: str,
        new_amount: Any = _ZERO,
        *,
        _check_equivalence: bool = False,
    ) -> Tuple[AllocationPlan, List[str]]:
        """把项目实际投入削减为 new_amount（缺省 0 = 取消），只重算下游。

        * new_amount 必须 <= 当前已批金额；
        * 允许 0（取消，其下游因门控全部停止）或 >= 该项目最低启动额；
          禁止落在 (0, min_start) 区间——那会违反启动下限。
        返回 (新方案, 受影响项目id列表)。
        """
        if self.plan is None:
            raise PlanError("尚未生成任何分配方案，请先调用 solve()")
        proj = self.registry.get(project_id)
        current = self.plan.amount_for(project_id)
        target = money(new_amount, f"reduce[{project_id!r}]")
        if target > current:
            raise ValidationError(
                f"削减后金额 {target} 不能高于当前已批金额 {current}",
                f"reduce[{project_id!r}]",
            )
        if _ZERO < target < proj.min_start:
            raise ValidationError(
                f"削减后金额 {target} 落在 (0, 最低启动额 {proj.min_start}) 之间："
                f"要么取消（0），要么不低于最低启动额",
                f"reduce[{project_id!r}]",
            )

        region = set(self.affected_region(project_id))
        # 锁定区域外所有项目的当前承诺——包括当前拨款为 0 的项目：
        # 否则削减释放出的预算可能流向无关项目，违背“未受影响项目拨款
        # 不得改变”，也会使增量结果与带同约束的全量求解不一致。
        fixed: Dict[str, Decimal] = {
            pid: self.plan.amount_for(pid)
            for pid in self.registry.project_ids()
            if pid not in region
        }
        # 削减项目锁定在新金额
        fixed[project_id] = target

        req = SolveRequest(
            registry=self.registry,
            budget=self.plan.budget,
            candidate_ids=sorted(region),
            preallocated=fixed,
        )
        new_plan = Solver.solve(req)

        if _check_equivalence:
            # 自检：用同样的硬约束、对全部候选重跑一次全量求解，必须逐项一致
            full_req = SolveRequest(
                registry=self.registry,
                budget=self.plan.budget,
                candidate_ids=None,
                preallocated=fixed,
            )
            full_plan = Solver.solve(full_req)
            if dict(full_plan.allocations) != dict(new_plan.allocations):
                raise PlanError(
                    "内部一致性校验失败：增量重算与全量重算结果不一致 "
                    f"incremental={dict(new_plan.allocations)} "
                    f"full={dict(full_plan.allocations)}"
                )

        unaffected = [
            pid for pid in self.plan.allocations if pid not in region
        ]
        for pid in unaffected:
            if new_plan.amount_for(pid) != self.plan.amount_for(pid):
                raise PlanError(
                    f"内部一致性校验失败：未受影响项目 {pid!r} 拨款发生变化"
                )

        self.plan = new_plan
        return new_plan, sorted(region)

    # ---- 查询（需求 6） ----

    def query_project(self, project_id: str) -> Dict[str, Any]:
        if self.plan is None:
            raise PlanError("尚未生成任何分配方案，请先调用 solve()")
        return project_report(self.registry, self.plan, project_id)

    def query_plan(self) -> Dict[str, Any]:
        if self.plan is None:
            raise PlanError("尚未生成任何分配方案，请先调用 solve()")
        return plan_summary(self.plan)
