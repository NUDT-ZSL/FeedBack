"""领域模型：项目与分配方案。

金额一律使用 Decimal，并规范化到 MONEY_QUANT（默认 0.01，即“分”），
从源头消除浮点误差，保证重复求解逐字节一致。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

from .errors import PlanError, ValidationError

#: 金额最小单位
MONEY_QUANT = Decimal("0.01")
_ZERO = Decimal("0.00")


def money(value: Any, location: Optional[str] = None) -> Decimal:
    """把输入（int/str/Decimal/float）规范化为两位小数的非负金额。

    float 仅允许恰好为整“分”的值（10.1 这类二进制不可精确表示的值会被拒绝，
    请用字符串或 Decimal 传金额）。
    """
    loc = location or "amount"
    if isinstance(value, bool):
        raise ValidationError(f"金额不能是布尔值: {value!r}", loc)
    if isinstance(value, float):
        d = Decimal(str(value))
    elif isinstance(value, (int, Decimal)):
        d = Decimal(value)
    elif isinstance(value, str):
        s = value.strip()
        if not s:
            raise ValidationError("金额不能为空字符串", loc)
        try:
            d = Decimal(s)
        except InvalidOperation:
            raise ValidationError(f"无法解析为金额: {value!r}", loc)
    else:
        raise ValidationError(f"金额类型非法: {type(value).__name__}", loc)
    if not d.is_finite():
        raise ValidationError(f"金额必须是有限数: {value!r}", loc)
    if d < 0:
        raise ValidationError(f"金额不能为负: {value!r}", loc)
    q = d.quantize(MONEY_QUANT)
    if q != d:
        raise ValidationError(f"金额精度超过 {MONEY_QUANT}（最小单位为分）: {value!r}", loc)
    return q


@dataclass(frozen=True)
class Project:
    """候选项目（不可变）。

    :param project_id: 唯一标识（非空字符串）
    :param priority: 优先级，整数，数值越小越优先
    :param total_need: 总需求额（等于各阶段投入之和）
    :param min_start: 最低启动额（>0 且 <= total_need）
    :param phases: 按阶段划分的投入计划，每阶段 > 0，按顺序执行
    :param benefit: 预期收益，用于计算投入产出比；缺省取总需求额
                    （即 ROI=1，退化回“优先级 + 字典序”定序）
    """

    project_id: str
    priority: int
    total_need: Decimal
    min_start: Decimal
    phases: Tuple[Decimal, ...]
    benefit: Decimal

    def __post_init__(self) -> None:
        loc = f"projects[{self.project_id!r}]" if self.project_id else "projects[<?>]"
        if not isinstance(self.project_id, str) or not self.project_id.strip():
            raise ValidationError("项目标识必须是非空字符串", "projects[<?>].id")
        if isinstance(self.priority, bool) or not isinstance(self.priority, int):
            raise ValidationError(
                f"优先级必须是整数，得到 {type(self.priority).__name__}",
                f"{loc}.priority",
            )
        total = self.total_need
        mn = self.min_start
        if total <= 0:
            raise ValidationError(f"总需求额必须大于 0，得到 {total}", f"{loc}.total_need")
        if mn <= 0:
            raise ValidationError(f"最低启动额必须大于 0，得到 {mn}", f"{loc}.min_start")
        if mn > total:
            raise ValidationError(
                f"最低启动额 {mn} 超过总需求额 {total}", f"{loc}.min_start"
            )
        if not self.phases:
            raise ValidationError("至少需要一个投入阶段", f"{loc}.phases")
        norm_phases: List[Decimal] = []
        for i, ph in enumerate(self.phases):
            v = money(ph, f"{loc}.phases[{i}]")
            if v <= 0:
                raise ValidationError(f"阶段投入必须大于 0，得到 {v}", f"{loc}.phases[{i}]")
            norm_phases.append(v)
        phases_sum = sum(norm_phases, _ZERO)
        if phases_sum != total:
            raise ValidationError(
                f"各阶段投入之和 {phases_sum} 不等于总需求额 {total}"
                f"（差额 {total - phases_sum}）",
                f"{loc}.phases",
            )
        ben = self.benefit
        if ben < 0:
            raise ValidationError(f"预期收益不能为负: {ben}", f"{loc}.benefit")
        # frozen dataclass 需要 object.__setattr__ 写入规范化后的值
        object.__setattr__(self, "phases", tuple(norm_phases))
        object.__setattr__(self, "benefit", ben if ben > 0 else total)

    # ---- 构造辅助 ----

    @classmethod
    def create(
        cls,
        project_id: str,
        priority: int,
        total_need: Any,
        min_start: Any,
        phases: Sequence[Any],
        benefit: Any = None,
    ) -> "Project":
        """宽松输入构造：金额接受 str/int/Decimal，阶段接受列表。"""
        total = money(total_need, f"projects[{project_id!r}].total_need")
        mn = money(min_start, f"projects[{project_id!r}].min_start")
        ben = money(benefit, f"projects[{project_id!r}].benefit") if benefit is not None else total
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise ValidationError(
                f"优先级必须是整数，得到 {type(priority).__name__}",
                f"projects[{project_id!r}].priority",
            )
        return cls(
            project_id=str(project_id),
            priority=priority,
            total_need=total,
            min_start=mn,
            phases=tuple(money(p, f"projects[{project_id!r}].phases[{i}]")
                         for i, p in enumerate(phases)),
            benefit=ben,
        )

    # ---- 序列化 ----

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.project_id,
            "priority": self.priority,
            "total_need": str(self.total_need),
            "min_start": str(self.min_start),
            "benefit": str(self.benefit),
            "phases": [str(p) for p in self.phases],
        }

    @classmethod
    def from_dict(cls, raw: Any, index: Optional[int] = None) -> "Project":
        """从普通字典构造；字段缺失/类型错误会抛出带位置的 ValidationError。"""
        tag = f"[{index}]" if index is not None else "[?]"
        loc = f"projects{tag}"
        if not isinstance(raw, Mapping):
            raise ValidationError(f"项目必须是对象，得到 {type(raw).__name__}", loc)
        required = ("id", "priority", "total_need", "min_start", "phases")
        for key in required:
            if key not in raw:
                raise ValidationError(f"缺少必填字段 {key!r}", loc, key)
        pid = raw["id"]
        if not isinstance(pid, str) or not pid.strip():
            raise ValidationError("项目 id 必须是非空字符串", f"{loc}.id")
        if not isinstance(raw["phases"], Sequence) or isinstance(raw["phases"], (str, bytes)):
            raise ValidationError("phases 必须是数组", f"projects[{pid!r}].phases")
        benefit = raw.get("benefit", raw["total_need"])
        return cls.create(
            project_id=pid,
            priority=raw["priority"],
            total_need=raw["total_need"],
            min_start=raw["min_start"],
            phases=list(raw["phases"]),
            benefit=benefit,
        )

    # ---- 阶段工具 ----

    def funded_phases(self, amount: Decimal) -> Tuple[Tuple[Decimal, ...], Decimal]:
        """给定累计拨款 amount，返回（每阶段实际占用, 末阶段部分投入）。

        按阶段顺序填充：阶段 1 未填满前不会进入阶段 2。
        """
        amount = money(amount) if amount > 0 else _ZERO
        if amount > self.total_need:
            amount = self.total_need
        used: List[Decimal] = []
        remaining = amount
        for plan in self.phases:
            take = min(plan, remaining)
            used.append(take)
            remaining -= take
            if remaining == 0:
                break
        return tuple(used), remaining


@dataclass(frozen=True)
class AllocationPlan:
    """一次求解的分配结果（不可变）。

    :param budget: 本次资金上限
    :param allocations: project_id -> 已批金额（仅记录获得拨款的项目）
    :param registry_snapshot: 求解所基于的 (projects, prerequisites) 快照，
                              用于查询与序列化，保证方案自解释
    """

    budget: Decimal
    allocations: Mapping[str, Decimal] = field(default_factory=dict)
    projects: Mapping[str, Project] = field(default_factory=dict, repr=False)
    prerequisites: Mapping[str, Tuple[str, ...]] = field(default_factory=dict, repr=False)

    def amount_for(self, project_id: str) -> Decimal:
        return self.allocations.get(project_id, _ZERO)

    @property
    def total(self) -> Decimal:
        return sum(self.allocations.values(), _ZERO)

    def is_started(self, project_id: str) -> bool:
        """已启动 = 拿到不低于最低启动额的拨款。"""
        proj = self.projects.get(project_id)
        if proj is None:
            return False
        return self.amount_for(project_id) >= proj.min_start

    def started_ids(self) -> List[str]:
        return [pid for pid in sorted(self.allocations) if self.is_started(pid)]

    def unmet_ids(self) -> List[str]:
        """候选集中未被足额满足的项目（按 id 字典序）：未启动或仍有缺口。"""
        out = []
        for pid in sorted(self.projects):
            if self.amount_for(pid) < self.projects[pid].total_need:
                out.append(pid)
        return out

    def phase_usage(self) -> List[Decimal]:
        """全局各阶段占用：把每个项目的已批金额按其阶段顺序摊开后按阶段列求和。

        长度为所有项目中的最大阶段数；未启动/拨款为 0 的项目各阶段计 0。
        """
        max_n = max((len(p.phases) for p in self.projects.values()), default=0)
        totals = [_ZERO for _ in range(max_n)]
        for pid, proj in self.projects.items():
            used, _ = proj.funded_phases(self.amount_for(pid))
            for i, v in enumerate(used):
                totals[i] += v
        return totals

    def validate(self) -> None:
        """完整校验一份方案（载入/求解后调用）。"""
        # 1. 单项不超总需求；已启动项目达到最低启动额
        for pid, amt in self.allocations.items():
            proj = self.projects.get(pid)
            if proj is None:
                raise ValidationError(f"方案引用了不存在的项目 {pid!r}", f"allocations[{pid!r}]")
            if amt < 0 or amt > proj.total_need:
                raise ValidationError(
                    f"已批金额 {amt} 超出 [0, {proj.total_need}] 范围",
                    f"allocations[{pid!r}]",
                )
            if 0 < amt < proj.min_start:
                raise ValidationError(
                    f"项目已获拨款 {amt} 但低于最低启动额 {proj.min_start}",
                    f"allocations[{pid!r}]",
                )
        # 2. 前置门控：项目已启动则其所有前置必须已达标
        for pid in self.started_ids():
            for pre in self.prerequisites.get(pid, ()):  # type: ignore[union-attr]
                pre_proj = self.projects.get(pre)
                if pre_proj is None:
                    raise DependencyRefError(pid, pre)
                if self.amount_for(pre) < pre_proj.min_start:
                    raise PlanGateError(pid, pre, pre_proj.min_start, self.amount_for(pre))
        # 3. 总额不超过上限
        if self.total > self.budget:
            raise PlanError(
                f"已批金额合计 {self.total} 超过资金上限 {self.budget}"
                f"（超出 {self.total - self.budget}）"
            )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "budget": str(self.budget),
            "allocations": [
                {"project_id": pid, "amount": str(self.amount_for(pid))}
                for pid in sorted(self.allocations)
                if self.amount_for(pid) > 0
            ],
        }


class DependencyRefError(ValidationError):
    def __init__(self, pid: str, missing: str) -> None:
        super().__init__(
            f"项目 {pid!r} 的前置 {missing!r} 不存在",
            f"allocations[{pid!r}].prerequisites",
        )


class PlanGateError(ValidationError):
    def __init__(self, pid: str, pre: str, need: Decimal, got: Decimal) -> None:
        super().__init__(
            f"项目 {pid!r} 已启动，但前置 {pre!r} 拨款 {got} 未达到其最低启动额 {need}",
            f"allocations[{pid!r}]",
        )
