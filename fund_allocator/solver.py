"""可复现的分配求解器。

定序与取舍规则（需求 4）：
    排序键 = (优先级升序, 投入产出比降序, 项目标识字典序升序)
    其中 ROI = benefit / total_need，用交叉相乘的 Decimal 精确比较，
    不引入浮点；未提供 benefit 时 benefit 取总需求额（ROI 全等，退化为
    “优先级 + 字典序”）。

启动规则（需求 3）：
    * 项目获得拨款当且仅当获得 >= 自身最低启动额；
    * 按排序键逐个处理：前置全部达标才可启动；
    * 若前置排名更靠后且尚未启动，会随该项目一并“链式启动”
      （各取最低启动额，作为一个原子事务：要么都放下，要么都不放下）；
    * 链式启动的前置在轮到自己的排序位次时只补差额，不会重复拿启动额；
    * 所有启动决策完成后，再按同一排序键把剩余预算依次补足各项目的
      阶段缺口（阶段 1 填满才进阶段 2……）。

一轮扫描即完备：若某项目因预算不足无法完成“自身+未达标前置”的最小
启动组合，之后预算只会更少，重排也不可能再启动它——因此结果唯一且
无需多轮迭代，天然可复现。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .errors import PlanError, ValidationError
from .models import AllocationPlan, Project
from .registry import Registry

_ZERO = Decimal("0.00")


@dataclass(frozen=True)
class SolveRequest:
    """一次求解请求。

    :param registry: 项目/依赖注册表
    :param budget: 资金上限
    :param candidate_ids: 参与取舍的候选项目；None 表示全部项目
    :param preallocated: 外部既定拨款 project_id -> 金额。
                         金额为 0 表示强制不投（其下游不得再启动）；
                         >0 表示已按该金额锁定，求解器不能增减，
                         且会占用预算、作为前置门控的“达标锚点”。
    """

    registry: Registry
    budget: Decimal
    candidate_ids: Optional[Sequence[str]] = None
    preallocated: Mapping[str, Decimal] = field(default_factory=dict)


class Solver:
    """无状态求解器：同一 SolveRequest 必定得到同一 AllocationPlan。"""

    @staticmethod
    def rank_projects(projects: Mapping[str, Project]) -> List[str]:
        """按 (priority↑, ROI↓, id↑) 输出稳定排名。"""
        ids = sorted(projects)  # 先字典序，排序稳定 => 最终平局仍字典序
        import functools

        def cmp(a: str, b: str) -> int:
            pa, pb = projects[a], projects[b]
            if pa.priority != pb.priority:
                return -1 if pa.priority < pb.priority else 1
            # ROI 降序：benefit_a/total_a 与 benefit_b/total_b 交叉相乘
            lhs = pa.benefit * pb.total_need
            rhs = pb.benefit * pa.total_need
            if lhs != rhs:
                return -1 if lhs > rhs else 1
            return -1 if a < b else (1 if a > b else 0)

        return sorted(ids, key=functools.cmp_to_key(cmp))

    @staticmethod
    def solve(req: SolveRequest) -> AllocationPlan:
        reg = req.registry
        projects, prereqs = reg.snapshot()

        # ---- 预算与候选集规范化 ----
        from .models import money

        budget = money(req.budget, "budget")
        candidates = set(projects) if req.candidate_ids is None else set(req.candidate_ids)
        for pid in candidates:
            if pid not in projects:
                raise ValidationError(
                    f"候选项目 {pid!r} 不存在", f"candidate_ids[{pid!r}]"
                )

        alloc: Dict[str, Decimal] = {}
        fixed: Dict[str, Decimal] = {}
        for pid, amt in req.preallocated.items():
            if pid not in projects:
                raise ValidationError(
                    f"既定拨款引用了不存在的项目 {pid!r}",
                    f"preallocated[{pid!r}]",
                )
            v = money(amt, f"preallocated[{pid!r}]")
            proj = projects[pid]
            if v > proj.total_need:
                raise ValidationError(
                    f"既定拨款 {v} 超过项目 {pid!r} 总需求额 {proj.total_need}",
                    f"preallocated[{pid!r}]",
                )
            if _ZERO < v < proj.min_start:
                raise ValidationError(
                    f"既定拨款 {v} 低于项目 {pid!r} 最低启动额 {proj.min_start}"
                    f"（如需取消请给 0）",
                    f"preallocated[{pid!r}]",
                )
            fixed[pid] = v
            if v > 0:
                alloc[pid] = v

        remaining = budget - sum(alloc.values(), _ZERO)
        if remaining < 0:
            raise PlanError(
                f"既定拨款合计 {sum(alloc.values(), _ZERO)} 已超过资金上限 {budget}"
                f"（超出 {-remaining}）"
            )

        ranking = [pid for pid in Solver.rank_projects(projects) if pid in candidates]

        def started(pid: str) -> bool:
            amt = alloc.get(pid, _ZERO)
            return amt >= projects[pid].min_start

        def unstarted_chain(target: str) -> Optional[List[str]]:
            """target 要启动所需的、尚未达标 的前置闭包（拓扑序）。

            返回 None 表示门控永久受阻（某前置被强制不投，或不在候选集
            且当前无拨款）。
            """
            needed: set = set()
            stack = list(prereqs.get(target, ()))
            while stack:
                pre = stack.pop()
                if started(pre):
                    continue
                # 未达标：强制不投 / 非候选且无拨款 => 无法打通
                if fixed.get(pre, _ZERO) == _ZERO and (pre not in candidates or pre in fixed):
                    return None
                needed.add(pre)
                stack.extend(prereqs.get(pre, ()))
            topo = [p for p in reg.topological_order() if p in needed]
            return topo

        # ---- 第一轮：最低启动额（含链式前置） ----
        for pid in ranking:
            if pid in fixed:
                continue  # 既定拨款：既不追加也不取消
            if started(pid):
                continue  # 已被更早的项目链式启动
            chain = unstarted_chain(pid)
            if chain is None:
                continue  # 门控无法打通：放弃
            cost = sum((projects[c].min_start for c in chain), _ZERO) + projects[pid].min_start
            if cost > remaining:
                continue  # 预算不足：放弃（之后预算只会更少）
            # 原子提交：链式前置先落，项目自身后落
            for c in chain:
                alloc[c] = projects[c].min_start
            alloc[pid] = projects[pid].min_start
            remaining -= cost

        # ---- 第二轮：按排名把剩余预算补足阶段缺口 ----
        for pid in ranking:
            if pid in fixed:
                continue
            if not started(pid):
                continue
            gap = projects[pid].total_need - alloc[pid]
            if gap <= 0:
                continue
            add = min(gap, remaining)
            if add > 0:
                alloc[pid] += add
                remaining -= add
            if remaining == 0:
                break

        plan = AllocationPlan(
            budget=budget,
            allocations={pid: v for pid, v in alloc.items() if v > 0},
            projects=projects,
            prerequisites=dict(prereqs),
        )
        plan.validate()
        return plan
