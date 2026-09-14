"""调度器状态的 JSON 导出与导入。

导出内容：逻辑时钟、资源、任务（含占用时间线与承诺标记）、
拒绝与抢占记录。导入时做完整校验：任务标识唯一、处理量为正、
截止时刻合法、占用时间线互不重叠且不超过容量、承诺任务未被
挤掉；任何校验失败都抛出带清晰信息的 :class:`SchedulerError`，
且导入以"先完整构建再替换"的方式进行，失败不影响原有状态。

数值序列化：Fraction 在分母为 1 时写成整数；能精确表示为
IEEE 双精度时写成浮点数；否则写成 "分子/分母" 字符串，保证
导出/导入往返完全精确。
"""

from __future__ import annotations

import json
from fractions import Fraction
from typing import Any, Dict, List

from .core import (
    Scheduler,
    SchedulerError,
    Resource,
    Task,
    STATUS_PENDING,
    STATUS_SCHEDULED,
)

FORMAT_VERSION = 1

_TASK_REQUIRED_FIELDS = (
    "task_id",
    "resource_id",
    "amount",
    "deadline",
    "priority",
    "committed",
    "status",
    "submit_seq",
)


def frac_to_json(value: Fraction) -> Any:
    """把 Fraction 序列化为可精确往返的 JSON 数值。"""
    if value.denominator == 1:
        return value.numerator
    as_float = float(value)
    if Fraction(as_float) == value:
        return as_float
    return f"{value.numerator}/{value.denominator}"


def frac_from_json(value: Any, field_name: str = "value") -> Fraction:
    """把 JSON 数值（int/float/"p/q" 字符串）解析为 Fraction。"""
    if isinstance(value, bool):
        raise SchedulerError("invalid_number", f"字段 {field_name} 不是合法数值: {value!r}")
    if isinstance(value, int):
        return Fraction(value)
    if isinstance(value, float):
        return Fraction(value)
    if isinstance(value, str):
        try:
            return Fraction(value)
        except (ValueError, ZeroDivisionError):
            raise SchedulerError(
                "invalid_number", f"字段 {field_name} 不是合法数值: {value!r}"
            ) from None
    raise SchedulerError("invalid_number", f"字段 {field_name} 不是合法数值: {value!r}")


def jsonable(obj: Any) -> Any:
    """递归地把结构中的 Fraction 转换为 JSON 可序列化数值。"""
    if isinstance(obj, Fraction):
        return frac_to_json(obj)
    if isinstance(obj, dict):
        return {key: jsonable(val) for key, val in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(item) for item in obj]
    return obj


def state_to_dict(scheduler: Scheduler) -> Dict[str, Any]:
    """把调度器完整状态序列化为 JSON 可写出的字典。"""
    tasks = sorted(scheduler.tasks.values(), key=lambda t: t.submit_seq)
    return {
        "version": FORMAT_VERSION,
        "clock": frac_to_json(scheduler.clock),
        "resources": [
            {
                "resource_id": r.resource_id,
                "capacity": frac_to_json(r.capacity),
            }
            for r in sorted(scheduler.resources.values(), key=lambda r: r.resource_id)
        ],
        "tasks": [
            {
                "task_id": t.task_id,
                "resource_id": t.resource_id,
                "amount": frac_to_json(t.amount),
                "deadline": frac_to_json(t.deadline),
                "priority": t.priority,
                "committed": t.committed,
                "status": t.status,
                "submit_seq": t.submit_seq,
                "start": frac_to_json(t.start) if t.start is not None else None,
                "end": frac_to_json(t.end) if t.end is not None else None,
            }
            for t in tasks
        ],
        "rejections": jsonable(list(scheduler.rejections)),
        "preemptions": jsonable(list(scheduler.preemptions)),
    }


def export_state(scheduler: Scheduler, path: str) -> None:
    """把调度器状态写入 JSON 文件。"""
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(state_to_dict(scheduler), fh, ensure_ascii=False, indent=2)
        fh.write("\n")


def import_state(path: str) -> Scheduler:
    """从 JSON 文件载入调度器状态；文件损坏或校验失败抛 SchedulerError。"""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise SchedulerError("invalid_import", f"导入文件不存在: {path}") from None
    except json.JSONDecodeError as exc:
        raise SchedulerError("invalid_import", f"导入文件不是合法 JSON: {exc}") from None
    except UnicodeDecodeError as exc:
        raise SchedulerError("invalid_import", f"导入文件编码非法: {exc}") from None
    return state_from_dict(data)


def state_from_dict(data: Any) -> Scheduler:
    """从字典构建新调度器并做完整校验；任何失败都抛 SchedulerError。

    校验项：版本、字段齐全、任务标识唯一、处理量为正、截止时刻
    合法、占用区间互不重叠且速率不超容量、承诺任务已排入且能在
    截止前完成。本函数只构造新对象，不触碰任何现有调度器。
    """
    if not isinstance(data, dict):
        raise SchedulerError("invalid_import", "导入内容必须是 JSON 对象")
    for key in ("version", "clock", "resources", "tasks", "rejections", "preemptions"):
        if key not in data:
            raise SchedulerError("invalid_import", f"导入内容缺少字段: {key}")
    if data["version"] != FORMAT_VERSION:
        raise SchedulerError(
            "invalid_import", f"不支持的格式版本: {data['version']!r}"
        )

    scheduler = Scheduler()
    scheduler.clock = frac_from_json(data["clock"], "clock")
    if scheduler.clock < 0:
        raise SchedulerError("invalid_import", f"时钟不能为负: {scheduler.clock}")

    _load_resources(scheduler, data["resources"])
    _load_tasks(scheduler, data["tasks"])
    scheduler.rejections = _load_records(data["rejections"], "rejections", is_preemption=False)
    scheduler.preemptions = _load_records(data["preemptions"], "preemptions", is_preemption=True)

    seqs = [r["seq"] for r in scheduler.rejections + scheduler.preemptions]
    if len(seqs) != len(set(seqs)):
        raise SchedulerError("invalid_import", "记录序号 (seq) 存在重复")

    _validate_timelines(scheduler)

    if scheduler.tasks:
        scheduler._submit_seq = max(t.submit_seq for t in scheduler.tasks.values()) + 1
    records = scheduler.rejections + scheduler.preemptions
    if records:
        scheduler._record_seq = max(r["seq"] for r in records) + 1
    return scheduler


def _load_resources(scheduler: Scheduler, raw: Any) -> None:
    """载入并校验资源列表。"""
    if not isinstance(raw, list):
        raise SchedulerError("invalid_import", "resources 必须是数组")
    for i, item in enumerate(raw):
        where = f"resources[{i}]"
        if not isinstance(item, dict):
            raise SchedulerError("invalid_import", f"{where} 必须是对象")
        for key in ("resource_id", "capacity"):
            if key not in item:
                raise SchedulerError("invalid_import", f"{where} 缺少字段: {key}")
        resource_id = item["resource_id"]
        if not isinstance(resource_id, str) or not resource_id:
            raise SchedulerError("invalid_import", f"{where}.resource_id 非法: {resource_id!r}")
        if resource_id in scheduler.resources:
            raise SchedulerError("invalid_import", f"资源标识重复: {resource_id}")
        capacity = frac_from_json(item["capacity"], f"{where}.capacity")
        if capacity < 0:
            raise SchedulerError("invalid_import", f"{where}.capacity 不能为负: {capacity}")
        scheduler.resources[resource_id] = Resource(resource_id=resource_id, capacity=capacity)


def _load_tasks(scheduler: Scheduler, raw: Any) -> None:
    """载入并校验任务列表（标识唯一、处理量为正、截止时刻合法）。"""
    if not isinstance(raw, list):
        raise SchedulerError("invalid_import", "tasks 必须是数组")
    for i, item in enumerate(raw):
        where = f"tasks[{i}]"
        if not isinstance(item, dict):
            raise SchedulerError("invalid_import", f"{where} 必须是对象")
        for key in _TASK_REQUIRED_FIELDS:
            if key not in item:
                raise SchedulerError("invalid_import", f"{where} 缺少字段: {key}")
        task_id = item["task_id"]
        if not isinstance(task_id, str) or not task_id:
            raise SchedulerError("invalid_import", f"{where}.task_id 非法: {task_id!r}")
        if task_id in scheduler.tasks:
            raise SchedulerError("invalid_import", f"任务标识重复: {task_id}")
        resource_id = item["resource_id"]
        if resource_id not in scheduler.resources:
            raise SchedulerError(
                "invalid_import", f"任务 {task_id} 引用了不存在的资源: {resource_id!r}"
            )
        amount = frac_from_json(item["amount"], f"{where}.amount")
        if amount <= 0:
            raise SchedulerError("invalid_import", f"任务 {task_id} 处理量必须为正: {amount}")
        deadline = frac_from_json(item["deadline"], f"{where}.deadline")
        if deadline < 0:
            raise SchedulerError("invalid_import", f"任务 {task_id} 截止时刻非法: {deadline}")
        priority = item["priority"]
        if isinstance(priority, bool) or not isinstance(priority, int):
            raise SchedulerError("invalid_import", f"任务 {task_id} 优先级必须是整数")
        committed = item["committed"]
        if not isinstance(committed, bool):
            raise SchedulerError("invalid_import", f"任务 {task_id} 承诺标记必须是布尔值")
        status = item["status"]
        if status not in (STATUS_SCHEDULED, STATUS_PENDING):
            raise SchedulerError("invalid_import", f"任务 {task_id} 状态非法: {status!r}")
        submit_seq = item["submit_seq"]
        if isinstance(submit_seq, bool) or not isinstance(submit_seq, int) or submit_seq < 0:
            raise SchedulerError("invalid_import", f"任务 {task_id} 提交序号非法: {submit_seq!r}")

        start = end = None
        if status == STATUS_SCHEDULED:
            for key in ("start", "end"):
                if key not in item or item[key] is None:
                    raise SchedulerError(
                        "invalid_import", f"已排入任务 {task_id} 缺少字段: {key}"
                    )
            start = frac_from_json(item["start"], f"{where}.start")
            end = frac_from_json(item["end"], f"{where}.end")
            if start < 0 or end <= start:
                raise SchedulerError(
                    "invalid_import", f"任务 {task_id} 占用区间非法: [{start}, {end})"
                )
        else:
            if item.get("start") is not None or item.get("end") is not None:
                raise SchedulerError(
                    "invalid_import", f"待排任务 {task_id} 不应带有占用区间"
                )

        if committed and status != STATUS_SCHEDULED:
            raise SchedulerError(
                "invalid_import", f"承诺任务 {task_id} 未被排入（视为被挤掉）"
            )

        scheduler.tasks[task_id] = Task(
            task_id=task_id,
            resource_id=resource_id,
            amount=amount,
            deadline=deadline,
            priority=priority,
            committed=committed,
            submit_seq=submit_seq,
            status=status,
            start=start,
            end=end,
        )


def _load_records(raw: Any, name: str, is_preemption: bool) -> List[dict]:
    """载入拒绝/抢占记录，保留原始 seq（全局唯一，保证往返一致）。"""
    if not isinstance(raw, list):
        raise SchedulerError("invalid_import", f"{name} 必须是数组")
    records: List[dict] = []
    for i, item in enumerate(raw):
        where = f"{name}[{i}]"
        if not isinstance(item, dict):
            raise SchedulerError("invalid_import", f"{where} 必须是对象")
        for key in ("seq", "task_id", "reason", "time"):
            if key not in item:
                raise SchedulerError("invalid_import", f"{where} 缺少字段: {key}")
        seq = item["seq"]
        if isinstance(seq, bool) or not isinstance(seq, int) or seq < 0:
            raise SchedulerError("invalid_import", f"{where}.seq 非法: {seq!r}")
        if not isinstance(item["task_id"], str) or not isinstance(item["reason"], str):
            raise SchedulerError("invalid_import", f"{where} 字段类型非法")
        record = {
            "seq": seq,
            "time": frac_from_json(item["time"], f"{where}.time"),
            "task_id": item["task_id"],
            "reason": item["reason"],
        }
        if is_preemption:
            displaced_by = item.get("displaced_by")
            if displaced_by is not None and not isinstance(displaced_by, str):
                raise SchedulerError("invalid_import", f"{where}.displaced_by 类型非法")
            record["displaced_by"] = displaced_by
        records.append(record)
    return records


def _validate_timelines(scheduler: Scheduler) -> None:
    """校验每个资源的占用时间线：互不重叠、不超容量、承诺任务按时完成。"""
    for resource in scheduler.resources.values():
        scheduled = [
            t
            for t in scheduler.tasks.values()
            if t.resource_id == resource.resource_id and t.status == STATUS_SCHEDULED
        ]
        scheduled.sort(key=lambda t: (t.start, t.end, t.task_id))  # type: ignore[arg-type]
        previous_end = None
        for task in scheduled:
            assert task.start is not None and task.end is not None
            if previous_end is not None and task.start < previous_end:
                raise SchedulerError(
                    "invalid_import",
                    f"资源 {resource.resource_id} 上任务 {task.task_id} 的占用区间重叠",
                )
            previous_end = task.end
            duration = task.end - task.start
            if resource.capacity <= 0 or task.amount > resource.capacity * duration:
                raise SchedulerError(
                    "invalid_import",
                    f"任务 {task.task_id} 的占用超过资源 {resource.resource_id} 的容量",
                )
            if task.committed and task.end > task.deadline:
                raise SchedulerError(
                    "invalid_import",
                    f"承诺任务 {task.task_id} 无法在截止前完成（视为被挤掉）",
                )
