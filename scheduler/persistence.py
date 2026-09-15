"""JSON 持久化：导出/载入门店、班次、员工、排班结果与公平指标。

载入时做完整校验：标识唯一、时段合法、技能引用存在、排班无重叠且满足
全部硬约束。任何错误都抛出 ValidationError 并给出清晰定位，且不会
污染已有引擎状态（先完整构建并校验，成功后才替换）。
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Optional

from .engine import SchedulingEngine
from .errors import ValidationError
from .models import Config, Employee, Shift, Store, TimeWindow
from .solver import conflict_code

SCHEMA_VERSION = 1


def _fmt_hhmm(minute_of_day: int) -> str:
    return f"{minute_of_day // 60:02d}:{minute_of_day % 60:02d}"


def _parse_hhmm(text, ctx: str) -> int:
    if not isinstance(text, str):
        raise ValidationError(f"{ctx}: 期望 'HH:MM' 字符串，得到 {text!r}")
    parts = text.split(":")
    if len(parts) != 2:
        raise ValidationError(f"{ctx}: 时间格式应为 'HH:MM'，得到 {text!r}")
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError:
        raise ValidationError(f"{ctx}: 时间格式应为 'HH:MM'，得到 {text!r}") from None
    if not (0 <= h < 24 and 0 <= m < 60):
        raise ValidationError(f"{ctx}: 时间超出范围: {text!r}")
    return h * 60 + m


def _parse_dt(value, ctx: str) -> datetime:
    if not isinstance(value, str):
        raise ValidationError(f"{ctx}: 期望 ISO 时间字符串，得到 {value!r}")
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        raise ValidationError(f"{ctx}: 无法解析时间 {value!r}（应为 ISO 8601 格式）") from None


def _req(record: dict, key: str, ctx: str):
    if key not in record:
        raise ValidationError(f"{ctx}: 缺少必需字段 '{key}'")
    return record[key]


def _req_str(record: dict, key: str, ctx: str) -> str:
    v = _req(record, key, ctx)
    if not isinstance(v, str) or not v:
        raise ValidationError(f"{ctx}: 字段 '{key}' 必须是非空字符串，得到 {v!r}")
    return v


def _req_str_list(record: dict, key: str, ctx: str) -> list:
    v = _req(record, key, ctx)
    if not isinstance(v, list) or not all(isinstance(x, str) and x for x in v):
        raise ValidationError(f"{ctx}: 字段 '{key}' 必须是非空字符串列表，得到 {v!r}")
    return list(v)


def engine_to_dict(engine: SchedulingEngine) -> dict:
    cfg = engine.config
    return {
        "version": SCHEMA_VERSION,
        "config": {
            "min_rest_minutes": cfg.min_rest_minutes,
            "night_start": _fmt_hhmm(cfg.night_start_minute),
            "night_end": _fmt_hhmm(cfg.night_end_minute),
        },
        "skills": sorted(engine.skills),
        "stores": [
            {"id": s.id, "name": s.name} for s in sorted(engine.stores.values(), key=lambda s: s.id)
        ],
        "shifts": [
            {
                "id": s.id,
                "store_id": s.store_id,
                "start": s.start.isoformat(),
                "end": s.end.isoformat(),
                "required_skills": sorted(s.required_skills),
            }
            for s in sorted(engine.shifts.values(), key=lambda s: s.id)
        ],
        "employees": [
            {
                "id": e.id,
                "skills": sorted(e.skills),
                "availability": [
                    {"start": w.start.isoformat(), "end": w.end.isoformat()}
                    for w in sorted(e.availability, key=lambda w: (w.start, w.end))
                ],
                "max_hours": e.max_minutes / 60,
            }
            for e in sorted(engine.employees.values(), key=lambda e: e.id)
        ],
        "assignments": [
            {"shift_id": sid, "employee_id": eid}
            for sid, eid in sorted(engine.assignments().items())
        ],
        "fairness": engine.fairness_report(),
    }


def save_engine(engine: SchedulingEngine, path) -> None:
    data = engine_to_dict(engine)
    Path(path).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def engine_from_dict(data, clock=None) -> SchedulingEngine:
    if not isinstance(data, dict):
        raise ValidationError("文件内容必须是 JSON 对象")
    version = data.get("version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise ValidationError(f"不支持的文件版本: {version!r}（当前支持 {SCHEMA_VERSION}）")

    # ---- 配置 ----
    cfg_data = data.get("config", {})
    if not isinstance(cfg_data, dict):
        raise ValidationError("字段 'config' 必须是对象")
    rest = cfg_data.get("min_rest_minutes", Config().min_rest_minutes)
    if not isinstance(rest, int) or isinstance(rest, bool) or rest < 0:
        raise ValidationError(f"config.min_rest_minutes 必须是非负整数，得到 {rest!r}")
    try:
        config = Config(
            min_rest_minutes=rest,
            night_start_minute=_parse_hhmm(cfg_data.get("night_start", "22:00"), "config.night_start"),
            night_end_minute=_parse_hhmm(cfg_data.get("night_end", "06:00"), "config.night_end"),
        )
    except ValueError as exc:
        raise ValidationError(f"config: {exc}") from exc

    engine = SchedulingEngine(config=config, clock=clock)

    # ---- 技能目录：未提供时取员工技能的并集 ----
    raw_skills = data.get("skills")
    if raw_skills is not None:
        if not isinstance(raw_skills, list) or not all(isinstance(x, str) and x for x in raw_skills):
            raise ValidationError("字段 'skills' 必须是非空字符串列表")
        catalog = set(raw_skills)
    else:
        catalog = None  # 延后到员工解析后确定

    # ---- 门店 ----
    stores = _req(data, "stores", "根节点")
    if not isinstance(stores, list):
        raise ValidationError("字段 'stores' 必须是列表")
    for i, rec in enumerate(stores):
        ctx = f"stores[{i}]"
        if not isinstance(rec, dict):
            raise ValidationError(f"{ctx}: 必须是对象")
        sid = _req_str(rec, "id", ctx)
        name = rec.get("name", "")
        if not isinstance(name, str):
            raise ValidationError(f"{ctx}: 字段 'name' 必须是字符串")
        if sid in engine.stores:
            raise ValidationError(f"{ctx}: 门店标识重复: {sid!r}")
        engine.stores[sid] = Store(sid, name)

    # ---- 员工 ----
    employees = _req(data, "employees", "根节点")
    if not isinstance(employees, list):
        raise ValidationError("字段 'employees' 必须是列表")
    for i, rec in enumerate(employees):
        ctx = f"employees[{i}]"
        if not isinstance(rec, dict):
            raise ValidationError(f"{ctx}: 必须是对象")
        eid = _req_str(rec, "id", ctx)
        if eid in engine.employees:
            raise ValidationError(f"{ctx}: 员工标识重复: {eid!r}")
        skills = _req_str_list(rec, "skills", ctx)
        max_hours = _req(rec, "max_hours", ctx)
        if not isinstance(max_hours, (int, float)) or isinstance(max_hours, bool) or max_hours < 0:
            raise ValidationError(f"{ctx}: 字段 'max_hours' 必须是非负数值，得到 {max_hours!r}")
        avail = _req(rec, "availability", ctx)
        if not isinstance(avail, list):
            raise ValidationError(f"{ctx}: 字段 'availability' 必须是列表")
        windows = []
        for j, w in enumerate(avail):
            wctx = f"{ctx}.availability[{j}]"
            if not isinstance(w, dict):
                raise ValidationError(f"{wctx}: 必须是对象")
            start = _parse_dt(_req(w, "start", wctx), f"{wctx}.start")
            end = _parse_dt(_req(w, "end", wctx), f"{wctx}.end")
            if end <= start:
                raise ValidationError(f"{wctx}: 时段结束必须晚于开始 ({start.isoformat()} ~ {end.isoformat()})")
            windows.append(TimeWindow(start, end))
        engine.employees[eid] = Employee(
            eid, frozenset(skills), windows, int(round(max_hours * 60))
        )

    if catalog is None:
        catalog = set().union(*(e.skills for e in engine.employees.values())) if engine.employees else set()
    engine.skills = set(catalog)
    for eid, e in engine.employees.items():
        unknown = e.skills - catalog
        if unknown:
            raise ValidationError(
                f"员工 {eid!r} 引用了未登记的技能: {sorted(unknown)}"
            )

    # ---- 班次 ----
    shifts = _req(data, "shifts", "根节点")
    if not isinstance(shifts, list):
        raise ValidationError("字段 'shifts' 必须是列表")
    for i, rec in enumerate(shifts):
        ctx = f"shifts[{i}]"
        if not isinstance(rec, dict):
            raise ValidationError(f"{ctx}: 必须是对象")
        sid = _req_str(rec, "id", ctx)
        if sid in engine.shifts:
            raise ValidationError(f"{ctx}: 班次标识重复: {sid!r}")
        store_id = _req_str(rec, "store_id", ctx)
        if store_id not in engine.stores:
            raise ValidationError(f"{ctx}: 引用了不存在的门店: {store_id!r}")
        start = _parse_dt(_req(rec, "start", ctx), f"{ctx}.start")
        end = _parse_dt(_req(rec, "end", ctx), f"{ctx}.end")
        if end <= start:
            raise ValidationError(f"{ctx}: 班次结束必须晚于开始 ({start.isoformat()} ~ {end.isoformat()})")
        required = _req_str_list(rec, "required_skills", ctx)
        unknown = set(required) - catalog
        if unknown:
            raise ValidationError(f"{ctx}: 班次 {sid!r} 引用了不存在的技能: {sorted(unknown)}")
        engine.shifts[sid] = Shift(sid, store_id, start, end, frozenset(required))

    # ---- 排班结果：逐条校验全部硬约束 ----
    assignments = data.get("assignments", [])
    if not isinstance(assignments, list):
        raise ValidationError("字段 'assignments' 必须是列表")
    result = {}
    for i, rec in enumerate(assignments):
        ctx = f"assignments[{i}]"
        if not isinstance(rec, dict):
            raise ValidationError(f"{ctx}: 必须是对象")
        sid = _req_str(rec, "shift_id", ctx)
        eid = _req_str(rec, "employee_id", ctx)
        if sid not in engine.shifts:
            raise ValidationError(f"{ctx}: 引用了不存在的班次: {sid!r}")
        if eid not in engine.employees:
            raise ValidationError(f"{ctx}: 引用了不存在的员工: {eid!r}")
        if sid in result:
            raise ValidationError(f"{ctx}: 班次 {sid!r} 被重复分配")
        shift = engine.shifts[sid]
        emp = engine.employees[eid]
        missing = shift.required_skills - emp.skills
        if missing:
            raise ValidationError(
                f"{ctx}: 员工 {eid!r} 缺少班次 {sid!r} 所需技能: {sorted(missing)}"
            )
        if not emp.is_available_for(shift.start, shift.end):
            raise ValidationError(
                f"{ctx}: 员工 {eid!r} 的可用时段不包含班次 {sid!r}"
            )
        result[sid] = eid

    # 同一员工：重叠、最短休息、工时上限
    for eid, emp in engine.employees.items():
        mine = sorted(
            (engine.shifts[sid] for sid, a in result.items() if a == eid),
            key=lambda s: (s.start, s.id),
        )
        total = sum(s.duration_minutes for s in mine)
        if total > emp.max_minutes:
            raise ValidationError(
                f"员工 {eid!r} 的排班总工时 {total / 60:.2f}h 超过上限 {emp.max_minutes / 60:.2f}h"
            )
        for prev, cur in zip(mine, mine[1:]):
            code = conflict_code(prev, cur, config.min_rest_minutes)
            if code == "overlap":
                raise ValidationError(
                    f"员工 {eid!r} 的班次 {prev.id!r} 与 {cur.id!r} 时间重叠"
                )
            if code == "rest":
                raise ValidationError(
                    f"员工 {eid!r} 的班次 {prev.id!r} 与 {cur.id!r} 间隔不足最短休息 "
                    f"{config.min_rest_minutes} 分钟"
                )

    engine._assignments = result
    engine._recompute_gaps()
    return engine


def load_engine(path, clock=None) -> SchedulingEngine:
    p = Path(path)
    try:
        text = p.read_text(encoding="utf-8")
    except OSError as exc:
        raise ValidationError(f"无法读取文件 {p}: {exc}") from exc
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"文件 {p} 不是合法 JSON: 第 {exc.lineno} 行第 {exc.colno} 列: {exc.msg}") from exc
    return engine_from_dict(data, clock=clock)
