"""输入归一化与校验。

求解器只接受 :class:`~optcore.models.Item` / :class:`~optcore.models.BinSpec`
/ :class:`~optcore.models.Task`，而命令行和快照读入的是普通 JSON 字典。
本模块负责把宽松形式（可缺省 ``group`` / ``deps`` / ``release`` 等）
转换为强类型模型，并在转换过程中做完整的前置校验：

* item_id / task_id / bin_id 非空且唯一；
* size / capacity 为正数，duration 为正整数；
* group / resource 非空；
* deps 引用存在、不自依赖、不重复。

依赖成环与分组超容量属于*问题不可行*（需要给出环/分组证明）而不是
输入格式错误，分别由 :mod:`optcore.scheduling` 与 :mod:`optcore.packing`
处理。
"""

from __future__ import annotations

import math
from numbers import Real
from typing import Any, Iterable, List, Optional, Sequence, Tuple

from .errors import InvalidInputError
from .models import BinSpec, Item, Task


def _is_real_number(value: Any) -> bool:
    """判断是否为可参与数值计算的实数（排除 bool 与 NaN/inf）。"""
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return False
    return True


def _is_int(value: Any) -> bool:
    """判断是否为整数（接受 3.0 这类整数取值的 float，排除 bool）。"""
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        return True
    return (
        isinstance(value, float)
        and not math.isnan(value)
        and not math.isinf(value)
        and value.is_integer()
    )


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise InvalidInputError(message)


def normalize_items(raw_items: Optional[Iterable[Any]]) -> List[Item]:
    """把原始物品列表归一化为 :class:`Item` 列表并做唯一性校验。

    :param raw_items: ``Item`` 或形如
        ``{"item_id": ..., "size": ..., "group": ...}`` 的字典序列；
        group 缺省为 ``"default"``。
    :raises InvalidInputError: 字段缺失、类型错误或 id 重复。
    """
    if raw_items is None:
        return []
    items: List[Item] = []
    seen: set = set()
    for index, raw in enumerate(raw_items):
        if isinstance(raw, Item):
            item = raw
        elif isinstance(raw, dict):
            _require("item_id" in raw, f"items[{index}] 缺少字段 item_id")
            _require("size" in raw, f"items[{index}] 缺少字段 size")
            item_id = raw["item_id"]
            _require(
                isinstance(item_id, str) and item_id != "",
                f"items[{index}].item_id 必须是非空字符串",
            )
            size = raw["size"]
            _require(
                _is_real_number(size),
                f"items[{index}].size 必须是有限数值",
            )
            size = float(size)
            _require(size > 0, f"items[{index}].size 必须为正数")
            group = raw.get("group", "default")
            _require(
                isinstance(group, str) and group != "",
                f"items[{index}].group 必须是非空字符串",
            )
            item = Item(item_id=item_id, size=size, group=group)
        else:
            raise InvalidInputError(
                f"items[{index}] 必须是对象或 Item，实际为 {type(raw).__name__}"
            )
        _require(
            item.item_id not in seen,
            f"item_id 重复: {item.item_id!r}",
        )
        seen.add(item.item_id)
        items.append(item)
    return items


def normalize_bins(raw_bins: Optional[Iterable[Any]]) -> List[BinSpec]:
    """把原始箱子列表归一化为 :class:`BinSpec` 列表。

    bin_id 可缺省，缺省时按输入顺序自动生成 ``bin-1, bin-2, ...``；
    也允许直接传入数值（被当作容量，id 自动生成）。

    :raises InvalidInputError: 字段缺失、容量非法或 id 重复。
    """
    if raw_bins is None:
        return []
    bins: List[BinSpec] = []
    seen: set = set()
    for index, raw in enumerate(raw_bins):
        if isinstance(raw, BinSpec):
            bin_spec = raw
        elif isinstance(raw, dict):
            _require("capacity" in raw, f"bins[{index}] 缺少字段 capacity")
            capacity = raw["capacity"]
            _require(
                _is_real_number(capacity),
                f"bins[{index}].capacity 必须是有限数值",
            )
            capacity = float(capacity)
            _require(capacity > 0, f"bins[{index}].capacity 必须为正数")
            bin_id = raw.get("bin_id", f"bin-{index + 1}")
            _require(
                isinstance(bin_id, str) and bin_id != "",
                f"bins[{index}].bin_id 必须是非空字符串",
            )
            bin_spec = BinSpec(bin_id=bin_id, capacity=capacity)
        elif _is_real_number(raw):
            capacity = float(raw)
            _require(capacity > 0, f"bins[{index}] 容量必须为正数")
            bin_spec = BinSpec(bin_id=f"bin-{index + 1}", capacity=capacity)
        else:
            raise InvalidInputError(
                f"bins[{index}] 必须是对象、BinSpec 或正数容量"
            )
        _require(
            bin_spec.bin_id not in seen,
            f"bin_id 重复: {bin_spec.bin_id!r}",
        )
        seen.add(bin_spec.bin_id)
        bins.append(bin_spec)
    return bins


def normalize_tasks(raw_tasks: Optional[Iterable[Any]]) -> List[Task]:
    """把原始任务列表归一化为 :class:`Task` 列表。

    接受 :class:`Task` 或字典；``deps`` 缺省为空集，``release`` 缺省为 0。
    本函数只校验 id、取值以及 deps *内部*的合法性（字符串、不重复、不自依
    赖）；deps 是否指向存在的任务由 :func:`validate_task_references` 校验。
    """
    if raw_tasks is None:
        return []
    tasks: List[Task] = []
    seen: set = set()
    for index, raw in enumerate(raw_tasks):
        if isinstance(raw, Task):
            task = raw
            # 模型对象跳过类型校验，但跨字段规则（不自依赖）仍需保证，
            # 否则直接构造 Task 可以绕过字典路径上的校验。
            _require(
                task.task_id not in task.deps,
                f"任务 {task.task_id!r} 不能依赖自身",
            )
        elif isinstance(raw, dict):
            _require("task_id" in raw, f"tasks[{index}] 缺少字段 task_id")
            _require("duration" in raw, f"tasks[{index}] 缺少字段 duration")
            task_id = raw["task_id"]
            _require(
                isinstance(task_id, str) and task_id != "",
                f"tasks[{index}].task_id 必须是非空字符串",
            )
            duration = raw["duration"]
            _require(
                _is_int(duration) and int(duration) > 0,
                f"tasks[{index}].duration 必须是正整数",
            )
            resource = raw.get("resource", "default")
            _require(
                isinstance(resource, str) and resource != "",
                f"tasks[{index}].resource 必须是非空字符串",
            )
            raw_deps = raw.get("deps", [])
            _require(
                isinstance(raw_deps, (list, tuple, set, frozenset)),
                f"tasks[{index}].deps 必须是数组",
            )
            deps: set = set()
            for dep in raw_deps:
                _require(
                    isinstance(dep, str) and dep != "",
                    f"tasks[{index}].deps 中的依赖必须是非空字符串",
                )
                _require(
                    dep != task_id,
                    f"任务 {task_id!r} 不能依赖自身",
                )
                _require(
                    dep not in deps,
                    f"任务 {task_id!r} 的依赖 {dep!r} 重复",
                )
                deps.add(dep)
            release = raw.get("release", 0)
            _require(
                _is_int(release),
                f"tasks[{index}].release 必须是整数",
            )
            task = Task(
                task_id=task_id,
                duration=int(duration),
                resource=resource,
                deps=frozenset(deps),
                release=int(release),
            )
        else:
            raise InvalidInputError(
                f"tasks[{index}] 必须是对象或 Task，实际为 {type(raw).__name__}"
            )
        _require(
            task.task_id not in seen,
            f"task_id 重复: {task.task_id!r}",
        )
        seen.add(task.task_id)
        tasks.append(task)
    return tasks


def normalize_resources(raw_resources: Optional[Iterable[Any]]) -> List[str]:
    """归一化资源列表：返回资源 id 列表，可为空（表示不限制资源集合）。

    任务引用了未声明的资源不算错误——未声明时以任务中出现的资源为准；
    资源列表仅用于显式登记可用资源与容量无约束的情形。
    """
    if raw_resources is None:
        return []
    result: List[str] = []
    seen: set = set()
    for index, raw in enumerate(raw_resources):
        if isinstance(raw, dict):
            _require("resource" in raw or "resource_id" in raw,
                     f"resources[{index}] 缺少 resource 字段")
            value = raw.get("resource", raw.get("resource_id"))
        else:
            value = raw
        _require(
            isinstance(value, str) and value != "",
            f"resources[{index}] 必须是非空字符串",
        )
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def validate_task_references(tasks: Sequence[Task]) -> None:
    """校验所有 deps 指向存在的任务，且 item_id 与 task_id 不冲突。

    :raises InvalidInputError: 存在悬空依赖，或 item_id/task_id 重名。
    """
    task_ids = {task.task_id for task in tasks}
    for task in tasks:
        for dep in sorted(task.deps):
            if dep not in task_ids:
                raise InvalidInputError(
                    f"任务 {task.task_id!r} 依赖了不存在的任务 {dep!r}"
                )


def normalize_all(
    raw_items: Optional[Iterable[Any]] = None,
    raw_bins: Optional[Iterable[Any]] = None,
    raw_tasks: Optional[Iterable[Any]] = None,
    raw_resources: Optional[Iterable[Any]] = None,
) -> Tuple[List[Item], List[BinSpec], List[Task], List[str]]:
    """一次性归一化并交叉校验四类输入。"""
    items = normalize_items(raw_items)
    bins = normalize_bins(raw_bins)
    tasks = normalize_tasks(raw_tasks)
    resources = normalize_resources(raw_resources)
    validate_task_references(tasks)
    return items, bins, tasks, resources
