"""领域模型。

设计要点：

- 金额一律整数分（见 :mod:`settlement.money`）。
- “一张券”由逻辑标识 ``coupon_id`` 标识；它可以被多个来源发放，每次发放是一条
  :class:`Issue`。各来源参数不一致时生成 :class:`ConflictRecord`，双方全部保留，
  在冲突被人工裁决前该券冻结、不参与求解。
- :class:`CouponSpec` 是某次发放携带的参数；:class:`Coupon` 是引擎内部聚合。
- :class:`Application` 是“一张中选券作用在哪些行、各抵扣多少分”的确定结果。
"""
from __future__ import annotations

import enum
from dataclasses import dataclass, field, replace
from typing import FrozenSet, List, Mapping, Optional, Sequence, Tuple

from .errors import ValidationError
from .money import MoneyInput, format_yuan, to_cents

NEUTRAL_SOURCE = "direct"        # 直接登记（无来源）时的占位来源
NEUTRAL_VERSION = 0              # 直接登记时的版次
NEUTRAL_PRIORITY = 100           # 默认优先级（数值越小越优先；当前仅作展示与解释用）


def _check_identifier(value: object, what: str, path: str | list[str] | None) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{what}必须是字符串", path)
    text = value.strip()
    if text == "":
        raise ValidationError(f"{what}不能为空", path)
    if any(ch.isspace() for ch in text):
        raise ValidationError(f"{what}不能包含空白字符: {value!r}", path)
    if len(text) > 64:
        raise ValidationError(f"{what}长度不能超过 64: {value!r}", path)
    return text


@dataclass(frozen=True)
class Category:
    """商品品类。"""

    category_id: str
    name: str = ""

    @staticmethod
    def build(category_id: str, name: str = "") -> "Category":
        cid = _check_identifier(category_id, "品类标识", "category_id")
        return Category(category_id=cid, name=name)


@dataclass(frozen=True)
class CouponSpec:
    """券参数（一次配置/发放所携带的内容）。

    字段语义：

    - ``applicable_categories`` 适用品类；空集合表示“全品类”。
    - ``threshold_cents``         使用门槛（命中行商品额之和必须达到该值，单位：分）。
    - ``discount_cents``          优惠额度（单位：分）。
    - ``exclusive_group``         互斥组标识；同一互斥组最多中选一张。``None`` 表示不与任何券互斥。
    - ``priority``                优先级（数值越小越优先）；用于展示、解释及稳定排序，
                                  最优目标仍是总优惠额最大，平局按券标识字典序。
    """

    coupon_id: str
    threshold_cents: int
    discount_cents: int
    applicable_categories: FrozenSet[str] = field(default_factory=frozenset)
    exclusive_group: Optional[str] = None
    priority: int = NEUTRAL_PRIORITY

    @staticmethod
    def build(
        coupon_id: str,
        threshold: MoneyInput,
        discount: MoneyInput,
        applicable_categories: Optional[Sequence[str]] = None,
        exclusive_group: Optional[str] = None,
        priority: int = NEUTRAL_PRIORITY,
    ) -> "CouponSpec":
        """以“元”为金额单位构造券参数，逐项校验，错误带字段位置。"""
        cid = _check_identifier(coupon_id, "券标识", "coupon_id")
        threshold_cents = to_cents(threshold, [cid, "threshold"])
        discount_cents = to_cents(discount, [cid, "discount"])
        if applicable_categories is None:
            cats: FrozenSet[str] = frozenset()
        else:
            if not isinstance(applicable_categories, (list, tuple, set, frozenset)):
                raise ValidationError("适用品类必须是字符串列表", [cid, "applicable_categories"])
            checked = []
            for i, c in enumerate(applicable_categories):
                checked.append(_check_identifier(c, "品类标识", [cid, "applicable_categories", i]))
            cats = frozenset(checked)
        group: Optional[str]
        if exclusive_group is None:
            group = None
        else:
            if not isinstance(exclusive_group, str) or exclusive_group.strip() == "":
                raise ValidationError("互斥组标识必须是非空字符串", [cid, "exclusive_group"])
            group = exclusive_group.strip()
        if not isinstance(priority, int) or isinstance(priority, bool):
            raise ValidationError("优先级必须是整数", [cid, "priority"])
        return CouponSpec(
            coupon_id=cid,
            threshold_cents=threshold_cents,
            discount_cents=discount_cents,
            applicable_categories=cats,
            exclusive_group=group,
            priority=priority,
        )

    @staticmethod
    def from_cents(
        coupon_id: str,
        threshold_cents: int,
        discount_cents: int,
        applicable_categories: Optional[Sequence[str]] = None,
        exclusive_group: Optional[str] = None,
        priority: int = NEUTRAL_PRIORITY,
    ) -> "CouponSpec":
        """以“分”为金额单位构造（供内部/快照使用）。"""
        cid = _check_identifier(coupon_id, "券标识", "coupon_id")
        for name, val in (("threshold_cents", threshold_cents), ("discount_cents", discount_cents)):
            if not isinstance(val, int) or isinstance(val, bool):
                raise ValidationError(f"{name} 必须是整数分", [cid, name])
            if val <= 0:
                raise ValidationError(f"{name} 必须为正数", [cid, name])
        if applicable_categories is None:
            cats = frozenset()
        else:
            cats = frozenset(
                _check_identifier(c, "品类标识", [cid, "applicable_categories", i])
                for i, c in enumerate(applicable_categories)
            )
        if exclusive_group is not None and (not isinstance(exclusive_group, str) or not exclusive_group.strip()):
            raise ValidationError("互斥组标识必须是非空字符串", [cid, "exclusive_group"])
        if not isinstance(priority, int) or isinstance(priority, bool):
            raise ValidationError("优先级必须是整数", [cid, "priority"])
        return CouponSpec(
            coupon_id=cid,
            threshold_cents=int(threshold_cents),
            discount_cents=int(discount_cents),
            applicable_categories=cats,
            exclusive_group=exclusive_group.strip() if exclusive_group else None,
            priority=priority,
        )

    def applies_to_category(self, category_id: str) -> bool:
        return not self.applicable_categories or category_id in self.applicable_categories


@dataclass(frozen=True)
class OrderLine:
    """订单商品行。

    - ``line_total_cents`` 为该行商品额（单价 × 数量，整数分），求解只依赖该值与品类，
      单价/数量同时保留用于展示、持久化与入参校验。
    """

    line_id: str
    category_id: str
    unit_price_cents: int
    quantity: int
    line_total_cents: int = 0

    def __post_init__(self) -> None:
        # dataclass(frozen=True) 下用 object.__setattr__ 补默认行总额。
        if self.line_total_cents == 0:
            object.__setattr__(self, "line_total_cents", self.unit_price_cents * self.quantity)

    @staticmethod
    def build(
        line_id: str,
        category_id: str,
        unit_price: MoneyInput,
        quantity: int,
        known_categories: Optional[Sequence[str]] = None,
    ) -> "OrderLine":
        """构造商品行并校验；``known_categories`` 给定时，品类必须已登记。"""
        lid = _check_identifier(line_id, "商品行标识", "line_id")
        cid = _check_identifier(category_id, "品类标识", "category_id")
        if known_categories is not None and cid not in set(known_categories):
            raise ValidationError(f"品类 {cid!r} 尚未登记，不能用于商品行 {lid!r}", [lid, "category_id"])
        unit_cents = to_cents(unit_price, [lid, "unit_price"])
        if not isinstance(quantity, int) or isinstance(quantity, bool):
            raise ValidationError("数量必须是整数", [lid, "quantity"])
        if quantity <= 0:
            raise ValidationError(f"数量必须为正数，收到 {quantity}", [lid, "quantity"])
        total = unit_cents * quantity
        if total > 1_000_000_000_00:
            raise ValidationError("单行金额超出允许上限", [lid, "line_total"])
        return OrderLine(
            line_id=lid,
            category_id=cid,
            unit_price_cents=unit_cents,
            quantity=quantity,
            line_total_cents=total,
        )


@dataclass(frozen=True)
class Issue:
    """一次券发放：来源、版次与该来源给出的参数。"""

    source: str
    version: int
    spec: CouponSpec

    @staticmethod
    def build(source: str, version: int, spec: CouponSpec) -> "Issue":
        if not isinstance(source, str) or source.strip() == "":
            raise ValidationError("来源标识必须是非空字符串", [spec.coupon_id, "source"])
        if not isinstance(version, int) or isinstance(version, bool) or version < 0:
            raise ValidationError("版次必须是非负整数", [spec.coupon_id, "version"])
        return Issue(source=source.strip(), version=int(version), spec=spec)


class CouponStatus(enum.Enum):
    """逻辑券在多来源发放下的状态。"""

    SINGLE = "single"        # 仅一个来源（或多来源参数完全一致）
    CONFLICTED = "conflicted"  # 多来源参数矛盾，已冻结
    RESOLVED = "resolved"    # 冲突经人工裁决，以指定来源参数为准


@dataclass(frozen=True)
class ConflictRecord:
    """同一逻辑券被多个来源以矛盾参数发放的可读冲突记录。

    不可变；追加来源时由引擎生成新记录。所有发放始终保留在 ``issues`` 中。
    """

    coupon_id: str
    issues: Tuple[Issue, ...]
    created_at_seq: int
    resolved_source: Optional[str] = None

    def is_resolved(self) -> bool:
        return self.resolved_source is not None

    def with_resolution(self, source: str) -> "ConflictRecord":
        return replace(self, resolved_source=source)

    def with_issues(self, issues: Tuple[Issue, ...], created_at_seq: Optional[int] = None) -> "ConflictRecord":
        return replace(
            self,
            issues=tuple(issues),
            created_at_seq=self.created_at_seq if created_at_seq is None else created_at_seq,
        )

    def render(self) -> str:
        lines = [f"券 {self.coupon_id} 存在多来源参数冲突："]
        for issue in self.issues:
            s = issue.spec
            cats = "全品类" if not s.applicable_categories else "、".join(sorted(s.applicable_categories))
            group = s.exclusive_group or "无互斥组"
            lines.append(
                f"  - 来源 {issue.source!r}（版次 {issue.version}）："
                f"门槛 {format_yuan(s.threshold_cents)} 元，额度 {format_yuan(s.discount_cents)} 元，"
                f"适用品类[{cats}]，互斥组 {group}，优先级 {s.priority}"
            )
        if self.resolved_source is not None:
            lines.append(f"  裁决：已人工指定以来源 {self.resolved_source!r} 的参数为准。")
        else:
            lines.append("  处理：双方参数均保留，该券已冻结，不参与求解；请调用 resolve_conflict 人工裁决。")
        return "\n".join(lines)


@dataclass(frozen=True)
class Coupon:
    """引擎内部的逻辑券聚合。"""

    coupon_id: str
    issues: Tuple[Issue, ...]
    status: CouponStatus
    conflict: Optional[ConflictRecord] = None

    @property
    def spec(self) -> CouponSpec:
        """当前生效参数：裁决后取裁决来源；否则取唯一/一致参数。"""
        if self.status is CouponStatus.RESOLVED and self.conflict is not None:
            for issue in self.issues:
                if issue.source == self.conflict.resolved_source:
                    return issue.spec
            raise ValidationError(
                f"券 {self.coupon_id} 的裁决来源 {self.conflict.resolved_source!r} 已不存在",
                [self.coupon_id, "resolved_source"],
            )
        return self.issues[-1].spec

    def active(self) -> bool:
        """是否参与求解。"""
        return self.status is not CouponStatus.CONFLICTED


@dataclass(frozen=True)
class LineAllocation:
    """一张券在单个商品行上的抵扣。"""

    line_id: str
    amount_cents: int


@dataclass(frozen=True)
class Application:
    """一张中选券的完整抵扣方案。"""

    coupon_id: str
    allocations: Tuple[LineAllocation, ...]
    total_discount_cents: int
    eligible_line_ids: Tuple[str, ...]
    eligible_total_cents: int

    def amount_on(self, line_id: str) -> int:
        for a in self.allocations:
            if a.line_id == line_id:
                return a.amount_cents
        return 0

    def covered_lines(self) -> FrozenSet[str]:
        return frozenset(a.line_id for a in self.allocations if a.amount_cents > 0)


@dataclass(frozen=True)
class RejectedCoupon:
    """未中选候选券的结构化说明（解释用）。"""

    coupon_id: str
    reason_code: str          # 见 explain.py 中的原因码
    reason: str               # 可读原因
    detail: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ComponentSnapshot:
    """单个连通分量的求解结果快照（增量缓存的缓存单元）。"""

    component_key: str                    # 分量成员券标识排序后拼接
    coupon_ids: Tuple[str, ...]
    line_ids: Tuple[str, ...]
    applications: Tuple[Application, ...]
    rejected: Tuple[RejectedCoupon, ...]
    total_discount_cents: int
    fingerprint: str


@dataclass(frozen=True)
class SolveResult:
    """整单求解结果。"""

    applications: Tuple[Application, ...]
    rejected: Tuple[RejectedCoupon, ...]
    total_discount_cents: int
    eligible_coupon_ids: Tuple[str, ...]   # 参与求解的券（已排除冻结券）
    frozen_coupon_ids: Tuple[str, ...]     # 因冲突冻结的券
    component_keys: Tuple[str, ...]
    component_fingerprints: Mapping[str, str]
    fingerprint: str                        # 整单结果指纹
    order_fingerprint: str                 # 订单（行）指纹
    coupon_fingerprint: str                # 券面指纹

    def selected_ids(self) -> Tuple[str, ...]:
        return tuple(a.coupon_id for a in self.applications)

    def application_for(self, coupon_id: str) -> Optional[Application]:
        for a in self.applications:
            if a.coupon_id == coupon_id:
                return a
        return None


# ---------------------------------------------------------------------------
# 供求解器使用的纯工具
# ---------------------------------------------------------------------------

def eligible_lines_for(spec: CouponSpec, lines: Sequence[OrderLine]) -> List[OrderLine]:
    """返回券可作用的商品行（品类匹配），按行标识排序保证确定性。"""
    out = [ln for ln in lines if spec.applies_to_category(ln.category_id)]
    out.sort(key=lambda ln: ln.line_id)
    return out


def spec_signature(spec: CouponSpec) -> Tuple:
    """券参数的结构化签名，用于判定多来源发放是否“参数互相矛盾”。"""
    return (
        spec.threshold_cents,
        spec.discount_cents,
        spec.applicable_categories,
        spec.exclusive_group,
        spec.priority,
    )
