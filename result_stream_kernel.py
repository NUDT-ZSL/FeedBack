"""浏览器端查询结果面板的结果流内核。

本模块负责：

* 维护多个查询计划（``QueryPlan``），每个计划有全局唯一标识、非空查询条件
  描述、状态（进行中 / 已完成 / 已取消 / 失败）以及一份按稳定顺序排列的
  可见结果序列；
* 接收后端分批推送的结果批次并并入对应计划的可见序列，按结果项标识去重；
* 管理“当前计划”的切换，保证任意时刻当前计划标识唯一，且非当前计划的
  结果不会混入当前计划的可见序列；
* 拒绝迟到批次（目标计划已取消 / 已失败）和未知计划批次；
* 将全部内部状态导出为 JSON 文件并校验性地重新载入；
* 提供逐条操作请求入口 ``ResultStreamKernel.apply_operation``。

确定性规则（验收依据，务必与 README 保持一致）
================================================

1. **稳定排序**：可见序列按 ``(排序键, 结果项标识)`` 升序排列；排序键相同
   时按结果项标识的字典序打破平局。排序键只能是 ``int`` / ``float`` /
   ``str``（``bool`` 非法，``float`` 必须为有限值），且同一计划内排序键
   的“种类”（数值 / 文本）必须一致，否则批次会被拒绝。
2. **去重保留规则**：同一计划内按结果项标识去重，**先到达者胜出**——按
   批次到达顺序、批次内按列表顺序，第一次出现的版本被保留，之后出现的同
   标识结果项被丢弃并计入去重统计。该规则只依赖到达顺序，与批次如何
   切分无关，因此在同一到达顺序下重放必然得到同一结果。
3. **批次接收**：状态为“进行中”或“已完成”的计划可以接收批次；“已取消”
   或“已失败”的计划拒绝批次；未注册的计划标识的批次一律被拒绝，绝不静默
   丢弃或自动创建计划。单个批次是原子的：批次内任一结果项非法则整个
   批次被拒绝，计划状态不变。
4. **计划隔离**：结果项只归属于接收它的计划；不同计划即使结果项标识
   相同也各自独立计数、互不影响。
5. **当前计划**：切换当前计划是幂等的（重复切换同一计划无副作用）；
   取消操作同样幂等。取消当前计划不会自动清除当前计划标识。

仅使用 Python 标准库，可完全离线运行。
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple, Union

__all__ = [
    "SCHEMA_VERSION",
    "SortKey",
    "PlanStatus",
    "ResultItem",
    "BatchRecord",
    "BatchReport",
    "QueryPlan",
    "ResultStreamKernel",
    "KernelError",
    "UnknownPlanError",
    "DuplicatePlanError",
    "BatchRejectedError",
    "InvalidItemError",
    "InvalidPlanError",
    "ImportValidationError",
    "UnknownOperationError",
]

#: 导出文件的格式版本号。
SCHEMA_VERSION = 1

#: 合法的排序键类型。
SortKey = Union[int, float, str]


# ---------------------------------------------------------------------------
# 异常体系
# ---------------------------------------------------------------------------


class KernelError(Exception):
    """结果流内核所有错误的基类。"""


class UnknownPlanError(KernelError):
    """引用了未注册的计划标识。"""


class DuplicatePlanError(KernelError):
    """尝试注册已存在的计划标识。"""


class InvalidPlanError(KernelError):
    """计划本身的参数非法（如空标识、空描述、非法状态迁移）。"""


class BatchRejectedError(KernelError):
    """批次被拒绝（目标计划已取消 / 已失败等），计划状态未被改变。"""


class InvalidItemError(KernelError):
    """结果项非法（空标识、非法排序键、载荷不可 JSON 序列化等）。"""


class ImportValidationError(KernelError):
    """导入的 JSON 数据未通过校验；失败后内存状态保持不变。"""


class UnknownOperationError(KernelError):
    """apply_operation 收到未知操作类型。"""


# ---------------------------------------------------------------------------
# 基础数据类型
# ---------------------------------------------------------------------------


class PlanStatus(Enum):
    """查询计划的生命周期状态。"""

    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"

    @classmethod
    def from_string(cls, value: Any) -> "PlanStatus":
        """从字符串解析状态，非法取值抛出 :class:`ImportValidationError`。

        :param value: 待解析的取值，期望为 ``"running"`` / ``"completed"`` /
            ``"cancelled"`` / ``"failed"`` 之一。
        :returns: 对应的枚举成员。
        :raises ImportValidationError: 取值不是合法状态字符串。
        """
        if isinstance(value, str):
            for member in cls:
                if member.value == value:
                    return member
        raise ImportValidationError(
            f"非法的计划状态取值: {value!r}，合法取值为 "
            f"{[m.value for m in cls]}"
        )


def _sort_key_kind(sort_key: SortKey) -> str:
    """返回排序键的种类（``"number"`` 或 ``"text"``），并做合法性校验。

    :param sort_key: 待校验的排序键。
    :returns: ``"number"``（int/float）或 ``"text"``（str）。
    :raises InvalidItemError: 排序键类型非法、为 ``bool``、或为非有限浮点数。
    """
    # bool 是 int 的子类，必须显式排除，避免 True/False 混进数值排序。
    if isinstance(sort_key, bool):
        raise InvalidItemError(f"排序键不允许为 bool 类型: {sort_key!r}")
    if isinstance(sort_key, (int, float)):
        if isinstance(sort_key, float) and not math.isfinite(sort_key):
            raise InvalidItemError(f"排序键不允许为非有限浮点数: {sort_key!r}")
        return "number"
    if isinstance(sort_key, str):
        return "text"
    raise InvalidItemError(
        f"排序键类型非法: {type(sort_key).__name__}，"
        "仅支持 int / float / str"
    )


@dataclass(frozen=True)
class ResultItem:
    """一条查询结果项。

    :ivar item_id: 全局唯一的结果项标识（非空字符串）。
    :ivar sort_key: 排序键，仅支持 int / float / str；排序键相同时按
        ``item_id`` 字典序打破平局。
    :ivar payload: 任意可 JSON 序列化的业务数据，默认为 ``None``。
    """

    item_id: str
    sort_key: SortKey
    payload: Any = None

    def __post_init__(self) -> None:
        """校验结果项字段的合法性。"""
        if not isinstance(self.item_id, str) or not self.item_id:
            raise InvalidItemError(f"结果项标识必须是非空字符串: {self.item_id!r}")
        try:
            _sort_key_kind(self.sort_key)
        except InvalidItemError as exc:
            raise InvalidItemError(
                f"结果项 {self.item_id!r} 的{exc}"
            ) from exc
        try:
            json.dumps(self.payload)
        except (TypeError, ValueError) as exc:
            raise InvalidItemError(
                f"结果项 {self.item_id!r} 的载荷不可 JSON 序列化: {exc}"
            ) from exc

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "item_id": self.item_id,
            "sort_key": self.sort_key,
            "payload": self.payload,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ResultItem":
        """从字典构造结果项。

        :param data: 含 ``item_id`` / ``sort_key`` / 可选 ``payload`` 的映射。
        :raises InvalidItemError: 字段缺失或非法。
        """
        if not isinstance(data, Mapping):
            raise InvalidItemError(f"结果项必须是映射类型，收到: {type(data).__name__}")
        missing = {"item_id", "sort_key"} - set(data)
        if missing:
            raise InvalidItemError(f"结果项缺少字段: {sorted(missing)}")
        return cls(
            item_id=data["item_id"],
            sort_key=data["sort_key"],
            payload=data.get("payload"),
        )


@dataclass(frozen=True)
class BatchRecord:
    """一条已接收批次的记录（用于审计与导出）。

    :ivar plan_id: 批次所属计划标识。
    :ivar sequence: 该计划内第几个被接收的批次（从 1 开始）。
    :ivar received: 批次内结果项总数。
    :ivar added: 实际并入可见序列的结果项数。
    :ivar duplicates: 因去重被丢弃的结果项数。
    """

    plan_id: str
    sequence: int
    received: int
    added: int
    duplicates: int

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "plan_id": self.plan_id,
            "sequence": self.sequence,
            "received": self.received,
            "added": self.added,
            "duplicates": self.duplicates,
        }


#: receive_batch 的返回报告，结构与 BatchRecord 相同。
BatchReport = BatchRecord


# ---------------------------------------------------------------------------
# 查询计划
# ---------------------------------------------------------------------------


class QueryPlan:
    """一个查询计划及其可见结果序列。

    可见序列不单独存储，而是由内部字典按需排序生成，因此任意到达顺序
    下最终顺序一致。
    """

    def __init__(self, plan_id: str, description: str) -> None:
        """创建处于“进行中”状态的计划。

        :param plan_id: 全局唯一计划标识（非空字符串）。
        :param description: 非空的查询条件描述。
        :raises InvalidPlanError: 标识或描述非法。
        """
        if not isinstance(plan_id, str) or not plan_id:
            raise InvalidPlanError(f"计划标识必须是非空字符串: {plan_id!r}")
        if not isinstance(description, str) or not description.strip():
            raise InvalidPlanError(
                f"计划 {plan_id!r} 的查询条件描述必须是非空字符串"
            )
        self.plan_id: str = plan_id
        self.description: str = description
        self.status: PlanStatus = PlanStatus.RUNNING
        self._items: Dict[str, ResultItem] = {}
        self._sort_key_kind: Optional[str] = None
        self.batches_received: int = 0
        self.duplicates_dropped: int = 0

    @property
    def accepts_batches(self) -> bool:
        """该计划当前是否允许接收批次（进行中或已完成）。"""
        return self.status in (PlanStatus.RUNNING, PlanStatus.COMPLETED)

    def merge_batch(self, items: Iterable[ResultItem]) -> Tuple[int, int]:
        """把一个批次并入可见序列，返回 ``(新增数, 去重丢弃数)``。

        去重规则：按结果项标识去重，先到达者胜出；同标识的后来者被丢弃
        并计入 ``duplicates_dropped``。调用方需保证批次内结果项已全部
        通过校验（本方法仍会校验排序键种类一致性，若不一致则抛出异常，
        且此时批次尚未产生任何副作用）。

        :param items: 批次内的结果项（可乱序、可含重复）。
        :returns: ``(added, duplicates)``。
        :raises InvalidItemError: 结果项排序键种类与计划已有排序键不一致。
        """
        items = list(items)
        # 先整体校验排序键种类，保证批次原子性：要么全部并入，要么全部拒绝。
        # 以计划已有种类为基准；计划为空时以批次内第一个结果项为基准，
        # 因此“空计划 + 批次内种类不一致”也会被拒绝。
        effective_kind = self._sort_key_kind
        for item in items:
            kind = _sort_key_kind(item.sort_key)
            if effective_kind is None:
                effective_kind = kind
                continue
            if kind != effective_kind:
                raise InvalidItemError(
                    f"结果项 {item.item_id!r} 的排序键种类 {kind!r} 与计划 "
                    f"{self.plan_id!r} 的排序键种类 {effective_kind!r} "
                    "不一致，整个批次被拒绝"
                )
        added = 0
        duplicates = 0
        for item in items:
            if self._sort_key_kind is None:
                self._sort_key_kind = _sort_key_kind(item.sort_key)
            if item.item_id in self._items:
                # 先到达者胜出：丢弃后来者。
                duplicates += 1
                continue
            self._items[item.item_id] = item
            added += 1
        self.batches_received += 1
        self.duplicates_dropped += duplicates
        return added, duplicates

    def visible_sequence(self) -> List[ResultItem]:
        """返回按 ``(排序键, 结果项标识)`` 稳定排序的可见结果序列。"""
        return sorted(
            self._items.values(), key=lambda it: (it.sort_key, it.item_id)
        )

    def contains(self, item_id: str) -> bool:
        """判断结果项标识是否属于本计划。"""
        return item_id in self._items

    def to_dict(self) -> Dict[str, Any]:
        """序列化为 JSON 友好的字典。"""
        return {
            "plan_id": self.plan_id,
            "description": self.description,
            "status": self.status.value,
            "items": [item.to_dict() for item in self.visible_sequence()],
            "batches_received": self.batches_received,
            "duplicates_dropped": self.duplicates_dropped,
        }


# ---------------------------------------------------------------------------
# 结果流内核
# ---------------------------------------------------------------------------


class ResultStreamKernel:
    """结果流内核：管理多个查询计划、批次合并与当前计划切换。"""

    def __init__(self) -> None:
        """创建一个空内核（无计划、无当前计划）。"""
        self._plans: Dict[str, QueryPlan] = {}
        self._current_plan_id: Optional[str] = None
        self._batches: List[BatchRecord] = []

    # -- 内部工具 ---------------------------------------------------------

    def _require_plan(self, plan_id: str) -> QueryPlan:
        """取计划，未注册则抛出 :class:`UnknownPlanError`。"""
        try:
            return self._plans[plan_id]
        except KeyError:
            raise UnknownPlanError(f"未知的计划标识: {plan_id!r}") from None

    @staticmethod
    def _coerce_items(
        plan_id: str, items: Iterable[Union[ResultItem, Mapping[str, Any]]]
    ) -> List[ResultItem]:
        """把批次内容统一转换为 :class:`ResultItem` 列表并整体校验。

        任一结果项非法都会抛出异常，保证批次原子性。
        """
        coerced: List[ResultItem] = []
        for index, raw in enumerate(items):
            try:
                item = (
                    raw if isinstance(raw, ResultItem) else ResultItem.from_dict(raw)
                )
            except InvalidItemError as exc:
                raise InvalidItemError(
                    f"计划 {plan_id!r} 的批次中第 {index} 个结果项非法: {exc}"
                ) from exc
            coerced.append(item)
        return coerced

    # -- 计划生命周期 -----------------------------------------------------

    def register_plan(self, plan_id: str, description: str) -> QueryPlan:
        """注册新计划（初始状态为“进行中”）。

        :param plan_id: 全局唯一计划标识。
        :param description: 非空查询条件描述。
        :returns: 新创建的计划对象。
        :raises DuplicatePlanError: 计划标识已存在。
        :raises InvalidPlanError: 标识或描述非法。
        """
        if plan_id in self._plans:
            raise DuplicatePlanError(f"计划标识已存在: {plan_id!r}")
        plan = QueryPlan(plan_id, description)
        self._plans[plan_id] = plan
        return plan

    def switch_current_plan(self, plan_id: str) -> bool:
        """把指定计划切换为当前计划。

        重复切换同一计划是幂等 no-op；旧计划自动变为非当前，但其数据
        保留且仍可继续接收批次。

        :param plan_id: 目标计划标识。
        :returns: 当前计划标识是否发生了变化。
        :raises UnknownPlanError: 计划未注册。
        """
        self._require_plan(plan_id)
        if self._current_plan_id == plan_id:
            return False
        self._current_plan_id = plan_id
        return True

    def cancel_plan(self, plan_id: str) -> bool:
        """取消计划；幂等，重复取消同一计划无副作用。

        :param plan_id: 目标计划标识。
        :returns: 本次调用是否真正改变了状态（已取消时返回 ``False``）。
        :raises UnknownPlanError: 计划未注册。
        """
        plan = self._require_plan(plan_id)
        if plan.status is PlanStatus.CANCELLED:
            return False
        plan.status = PlanStatus.CANCELLED
        return True

    def complete_plan(self, plan_id: str) -> None:
        """把进行中的计划标记为已完成。

        :raises UnknownPlanError: 计划未注册。
        :raises InvalidPlanError: 计划不在“进行中”状态。
        """
        plan = self._require_plan(plan_id)
        if plan.status is not PlanStatus.RUNNING:
            raise InvalidPlanError(
                f"计划 {plan_id!r} 当前状态为 {plan.status.value!r}，"
                "只有进行中的计划可以标记为已完成"
            )
        plan.status = PlanStatus.COMPLETED

    def fail_plan(self, plan_id: str) -> None:
        """把进行中或已完成的计划标记为失败。

        :raises UnknownPlanError: 计划未注册。
        :raises InvalidPlanError: 计划已取消或已失败。
        """
        plan = self._require_plan(plan_id)
        if plan.status in (PlanStatus.CANCELLED, PlanStatus.FAILED):
            raise InvalidPlanError(
                f"计划 {plan_id!r} 当前状态为 {plan.status.value!r}，"
                "不能标记为失败"
            )
        plan.status = PlanStatus.FAILED

    # -- 批次接收 ---------------------------------------------------------

    def receive_batch(
        self,
        plan_id: str,
        items: Iterable[Union[ResultItem, Mapping[str, Any]]],
    ) -> BatchReport:
        """接收一个批次并并入对应计划的可见序列。

        批次是原子的：任一结果项非法则整个批次被拒绝，计划状态不变。
        空批次合法：批次数加一，但不改变可见序列。

        :param plan_id: 批次声明所属的计划标识。
        :param items: 批次内的结果项（``ResultItem`` 或字典），可乱序、
            可含与历史批次或本批次内重复的结果项。
        :returns: 批次报告（接收数 / 新增数 / 去重数）。
        :raises UnknownPlanError: 计划标识未注册（绝不自动创建计划）。
        :raises BatchRejectedError: 计划已取消或已失败，批次被原样拒绝。
        :raises InvalidItemError: 批次内结果项非法。
        """
        plan = self._require_plan(plan_id)
        if not plan.accepts_batches:
            raise BatchRejectedError(
                f"批次被拒绝：计划 {plan_id!r} 已处于 "
                f"{plan.status.value!r} 状态，不再接收批次"
            )
        coerced = self._coerce_items(plan_id, items)
        added, duplicates = plan.merge_batch(coerced)
        report = BatchReport(
            plan_id=plan_id,
            sequence=plan.batches_received,
            received=len(coerced),
            added=added,
            duplicates=duplicates,
        )
        self._batches.append(report)
        return report

    # -- 查询 -------------------------------------------------------------

    @property
    def current_plan_id(self) -> Optional[str]:
        """当前计划标识；没有当前计划时为 ``None``。"""
        return self._current_plan_id

    def get_plan_results(self, plan_id: str) -> List[ResultItem]:
        """返回指定计划按稳定顺序排列的可见结果序列。

        :raises UnknownPlanError: 计划未注册。
        """
        return self._require_plan(plan_id).visible_sequence()

    def get_current_results(self) -> List[ResultItem]:
        """返回当前计划的可见结果序列；无当前计划时返回空列表。"""
        if self._current_plan_id is None:
            return []
        return self._plans[self._current_plan_id].visible_sequence()

    def locate_item(self, item_id: str) -> List[str]:
        """返回包含指定结果项标识的所有计划标识，按字典序稳定排列。"""
        return sorted(pid for pid, plan in self._plans.items() if plan.contains(item_id))

    def plan_stats(self, plan_id: str) -> Dict[str, Any]:
        """返回计划的统计信息（批次数、去重数、可见项数、状态）。

        :raises UnknownPlanError: 计划未注册。
        """
        plan = self._require_plan(plan_id)
        return {
            "plan_id": plan.plan_id,
            "status": plan.status.value,
            "batches_received": plan.batches_received,
            "duplicates_dropped": plan.duplicates_dropped,
            "visible_count": len(plan.visible_sequence()),
        }

    def list_plan_ids(self) -> List[str]:
        """返回全部已注册计划标识，按字典序稳定排列。"""
        return sorted(self._plans)

    def snapshot(self) -> Dict[str, Any]:
        """返回内部状态的完整快照（JSON 友好，供“查看内部状态”操作）。"""
        return {
            "current_plan_id": self._current_plan_id,
            "plans": {
                pid: {
                    "description": self._plans[pid].description,
                    "status": self._plans[pid].status.value,
                    "batches_received": self._plans[pid].batches_received,
                    "duplicates_dropped": self._plans[pid].duplicates_dropped,
                    "visible_items": [
                        item.to_dict() for item in self._plans[pid].visible_sequence()
                    ],
                }
                for pid in self.list_plan_ids()
            },
            "batches": [record.to_dict() for record in self._batches],
        }

    # -- 导出 / 导入 ------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """把全部状态序列化为 JSON 友好的字典。"""
        return {
            "version": SCHEMA_VERSION,
            "current_plan_id": self._current_plan_id,
            "plans": [self._plans[pid].to_dict() for pid in self.list_plan_ids()],
            "batches": [record.to_dict() for record in self._batches],
        }

    def export_to_file(self, path: Union[str, Path]) -> None:
        """把全部状态写入 JSON 文件。

        :param path: 目标文件路径（父目录必须已存在）。
        """
        text = json.dumps(self.to_dict(), ensure_ascii=False, indent=2)
        Path(path).write_text(text, encoding="utf-8")

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ResultStreamKernel":
        """从字典校验性地重建内核。

        全部校验通过后才会构造并返回新内核；任何校验失败都抛出
        :class:`ImportValidationError`，且不会产生半初始化的对象。

        :param data: :meth:`to_dict` 产出的结构。
        :raises ImportValidationError: 数据损坏、字段缺失或校验失败。
        """
        if not isinstance(data, Mapping):
            raise ImportValidationError(
                f"导入数据必须是映射类型，收到: {type(data).__name__}"
            )
        for field_name in ("version", "current_plan_id", "plans", "batches"):
            if field_name not in data:
                raise ImportValidationError(f"导入数据缺少字段: {field_name!r}")
        if data["version"] != SCHEMA_VERSION:
            raise ImportValidationError(
                f"不支持的格式版本: {data['version']!r}，期望 {SCHEMA_VERSION}"
            )
        plans_data = data["plans"]
        batches_data = data["batches"]
        if not isinstance(plans_data, list):
            raise ImportValidationError("字段 'plans' 必须是列表")
        if not isinstance(batches_data, list):
            raise ImportValidationError("字段 'batches' 必须是列表")

        kernel = cls()
        for index, plan_data in enumerate(plans_data):
            kernel._load_plan(index, plan_data)

        current = data["current_plan_id"]
        if current is not None:
            if not isinstance(current, str) or current not in kernel._plans:
                raise ImportValidationError(
                    f"当前计划标识 {current!r} 未出现在 plans 中"
                )
            kernel._current_plan_id = current

        for index, batch_data in enumerate(batches_data):
            kernel._load_batch_record(index, batch_data)
        return kernel

    def _load_plan(self, index: int, plan_data: Any) -> None:
        """校验并载入单个计划（仅供 :meth:`from_dict` 使用）。"""
        if not isinstance(plan_data, Mapping):
            raise ImportValidationError(f"plans[{index}] 必须是映射类型")
        for field_name in (
            "plan_id",
            "description",
            "status",
            "items",
            "batches_received",
            "duplicates_dropped",
        ):
            if field_name not in plan_data:
                raise ImportValidationError(
                    f"plans[{index}] 缺少字段: {field_name!r}"
                )
        plan_id = plan_data["plan_id"]
        if not isinstance(plan_id, str) or not plan_id:
            raise ImportValidationError(
                f"plans[{index}] 的计划标识必须是非空字符串: {plan_id!r}"
            )
        if plan_id in self._plans:
            raise ImportValidationError(f"计划标识重复: {plan_id!r}")
        description = plan_data["description"]
        if not isinstance(description, str) or not description.strip():
            raise ImportValidationError(
                f"计划 {plan_id!r} 的查询条件描述必须是非空字符串"
            )
        status = PlanStatus.from_string(plan_data["status"])
        for counter in ("batches_received", "duplicates_dropped"):
            value = plan_data[counter]
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ImportValidationError(
                    f"计划 {plan_id!r} 的 {counter} 必须是非负整数: {value!r}"
                )
        items_data = plan_data["items"]
        if not isinstance(items_data, list):
            raise ImportValidationError(f"计划 {plan_id!r} 的 items 必须是列表")

        plan = QueryPlan(plan_id, description)
        plan.status = status
        seen_item_ids: set = set()
        kind: Optional[str] = None
        for item_index, item_data in enumerate(items_data):
            try:
                item = ResultItem.from_dict(item_data)
            except InvalidItemError as exc:
                raise ImportValidationError(
                    f"计划 {plan_id!r} 的第 {item_index} 个结果项非法: {exc}"
                ) from exc
            if item.item_id in seen_item_ids:
                raise ImportValidationError(
                    f"计划 {plan_id!r} 内结果项标识重复: {item.item_id!r}"
                )
            item_kind = _sort_key_kind(item.sort_key)
            if kind is None:
                kind = item_kind
            elif item_kind != kind:
                raise ImportValidationError(
                    f"计划 {plan_id!r} 内结果项 {item.item_id!r} 的排序键种类 "
                    f"{item_kind!r} 与其他结果项的 {kind!r} 不一致"
                )
            seen_item_ids.add(item.item_id)
            plan._items[item.item_id] = item
        plan._sort_key_kind = kind
        plan.batches_received = plan_data["batches_received"]
        plan.duplicates_dropped = plan_data["duplicates_dropped"]
        self._plans[plan_id] = plan

    def _load_batch_record(self, index: int, batch_data: Any) -> None:
        """校验并载入单条批次记录（仅供 :meth:`from_dict` 使用）。"""
        if not isinstance(batch_data, Mapping):
            raise ImportValidationError(f"batches[{index}] 必须是映射类型")
        for field_name in ("plan_id", "sequence", "received", "added", "duplicates"):
            if field_name not in batch_data:
                raise ImportValidationError(
                    f"batches[{index}] 缺少字段: {field_name!r}"
                )
        plan_id = batch_data["plan_id"]
        if plan_id not in self._plans:
            raise ImportValidationError(
                f"batches[{index}] 引用了不存在的计划: {plan_id!r}"
            )
        numbers = {}
        for field_name in ("sequence", "received", "added", "duplicates"):
            value = batch_data[field_name]
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ImportValidationError(
                    f"batches[{index}] 的 {field_name} 必须是非负整数: {value!r}"
                )
            numbers[field_name] = value
        if numbers["added"] + numbers["duplicates"] != numbers["received"]:
            raise ImportValidationError(
                f"batches[{index}] 计数不自洽: added({numbers['added']}) + "
                f"duplicates({numbers['duplicates']}) != received({numbers['received']})"
            )
        self._batches.append(
            BatchRecord(
                plan_id=plan_id,
                sequence=numbers["sequence"],
                received=numbers["received"],
                added=numbers["added"],
                duplicates=numbers["duplicates"],
            )
        )

    def import_from_file(self, path: Union[str, Path]) -> None:
        """从 JSON 文件校验性地载入状态，替换当前内存状态。

        文件损坏、JSON 解析失败或任何字段校验失败时抛出
        :class:`ImportValidationError`，且**内存状态保持不变**（先在新
        对象上完成全部校验，成功后才替换）。

        :param path: 导入文件路径。
        :raises ImportValidationError: 文件缺失、损坏或校验失败。
        """
        file_path = Path(path)
        try:
            text = file_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ImportValidationError(f"无法读取导入文件 {file_path}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ImportValidationError(
                f"导入文件 {file_path} 不是合法 JSON: {exc}"
            ) from exc
        restored = self.from_dict(data)
        self._plans = restored._plans
        self._current_plan_id = restored._current_plan_id
        self._batches = restored._batches

    # -- 逐条操作请求入口 ---------------------------------------------------

    def apply_operation(self, operation: Mapping[str, Any]) -> Any:
        """接收并执行一条操作请求，返回 JSON 友好的结果。

        支持的操作（``operation["op"]``）：

        * ``register_plan``: ``{plan_id, description}``
        * ``receive_batch``: ``{plan_id, items}``
        * ``switch_plan`` / ``cancel_plan`` / ``complete_plan`` /
          ``fail_plan``: ``{plan_id}``
        * ``get_plan_results``: ``{plan_id}``
        * ``get_current_plan`` / ``get_current_results`` / ``snapshot``
        * ``locate_item``: ``{item_id}``
        * ``plan_stats``: ``{plan_id}``
        * ``export``: ``{path}`` / ``import``: ``{path}``

        :param operation: 操作请求映射，必须包含 ``op`` 键。
        :returns: 操作结果（JSON 友好的字典 / 列表 / 标量）。
        :raises UnknownOperationError: 未知操作类型或缺少 ``op`` 键。
        :raises KernelError: 各操作自身的校验错误，错误信息包含具体的
            计划标识或结果项标识。
        """
        if not isinstance(operation, Mapping) or "op" not in operation:
            raise UnknownOperationError(
                f"操作请求必须包含 'op' 键: {operation!r}"
            )
        op = operation["op"]

        if op == "register_plan":
            plan = self.register_plan(operation["plan_id"], operation["description"])
            return {"plan_id": plan.plan_id, "status": plan.status.value}
        if op == "receive_batch":
            report = self.receive_batch(operation["plan_id"], operation["items"])
            return report.to_dict()
        if op == "switch_plan":
            changed = self.switch_current_plan(operation["plan_id"])
            return {"current_plan_id": self._current_plan_id, "changed": changed}
        if op == "cancel_plan":
            changed = self.cancel_plan(operation["plan_id"])
            return {"plan_id": operation["plan_id"], "cancelled": True,
                    "changed": changed}
        if op == "complete_plan":
            self.complete_plan(operation["plan_id"])
            return {"plan_id": operation["plan_id"], "status": "completed"}
        if op == "fail_plan":
            self.fail_plan(operation["plan_id"])
            return {"plan_id": operation["plan_id"], "status": "failed"}
        if op == "get_plan_results":
            return [item.to_dict() for item in self.get_plan_results(operation["plan_id"])]
        if op == "get_current_plan":
            return {"current_plan_id": self._current_plan_id}
        if op == "get_current_results":
            return [item.to_dict() for item in self.get_current_results()]
        if op == "locate_item":
            return {"item_id": operation["item_id"],
                    "plan_ids": self.locate_item(operation["item_id"])}
        if op == "plan_stats":
            return self.plan_stats(operation["plan_id"])
        if op == "export":
            self.export_to_file(operation["path"])
            return {"exported": operation["path"]}
        if op == "import":
            self.import_from_file(operation["path"])
            return {"imported": operation["path"]}
        if op == "snapshot":
            return self.snapshot()
        raise UnknownOperationError(f"未知操作类型: {op!r}")
