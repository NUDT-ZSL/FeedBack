"""排班引擎：数据维护、硬约束、缺口分析、事件驱动重排、查询与公平指标。"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

from .errors import NotFoundError, ScheduleError, ValidationError
from .models import Config, Employee, Shift, Store, TimeWindow, subtract_window
from .solver import conflict_code, solve


class SystemClock:
    """真实系统时钟。"""

    def now(self) -> datetime:
        return datetime.now()


class ManualClock:
    """可注入的逻辑时钟：测试与离线重放时由外部显式推进。"""

    def __init__(self, start: Optional[datetime] = None):
        self._now = start or datetime(2026, 1, 1, 0, 0)

    def now(self) -> datetime:
        return self._now

    def set(self, value: datetime) -> None:
        self._now = value

    def advance(self, delta: timedelta) -> datetime:
        self._now += delta
        return self._now


class SchedulingEngine:
    """连锁门店排班引擎。

    公平目标按字典序优化：覆盖班次数 > 工时极差 > 夜班极差 > 分配序列字典序
    （同分时按员工标识字典序打破平局）。求解器是 (班次, 员工, 配置) 的确定性
    纯函数，因此事件后的局部重排与从头重排结果完全一致。
    """

    def __init__(self, config: Optional[Config] = None, clock=None):
        self.config = config or Config()
        self.clock = clock or SystemClock()
        self.stores: Dict[str, Store] = {}
        self.shifts: Dict[str, Shift] = {}
        self.employees: Dict[str, Employee] = {}
        self.skills: set = set()
        self._assignments: Dict[str, str] = {}  # 仅包含已覆盖班次
        self._gaps: Dict[str, dict] = {}
        self._events: List[tuple] = []
        self._last_event_time: Optional[datetime] = None

    # ---------------------------------------------------------------- 数据维护
    def add_skill(self, name: str) -> None:
        self.skills.add(name)

    def add_store(self, store_id: str, name: str = "") -> None:
        if store_id in self.stores:
            raise ValidationError(f"门店标识重复: {store_id!r}")
        self.stores[store_id] = Store(store_id, name)

    def add_shift(
        self,
        shift_id: str,
        store_id: str,
        start: datetime,
        end: datetime,
        required_skills: Sequence[str] = (),
    ) -> None:
        if shift_id in self.shifts:
            raise ValidationError(f"班次标识重复: {shift_id!r}")
        if store_id not in self.stores:
            raise NotFoundError(f"门店不存在: {store_id!r}")
        try:
            shift = Shift(shift_id, store_id, start, end, frozenset(required_skills))
        except ValueError as exc:
            raise ValidationError(str(exc)) from exc
        self.shifts[shift_id] = shift
        self.skills |= shift.required_skills

    def add_employee(
        self,
        employee_id: str,
        skills: Sequence[str],
        availability: Sequence[TimeWindow],
        max_hours: float,
    ) -> None:
        if employee_id in self.employees:
            raise ValidationError(f"员工标识重复: {employee_id!r}")
        if not isinstance(max_hours, (int, float)) or isinstance(max_hours, bool) or max_hours < 0:
            raise ValidationError(f"员工 {employee_id!r} 工时上限必须是非负数值")
        windows = list(availability)
        for w in windows:
            if not isinstance(w, TimeWindow):
                raise ValidationError(f"员工 {employee_id!r} 的可用时段必须是 TimeWindow")
        self.employees[employee_id] = Employee(
            employee_id, frozenset(skills), windows, int(round(max_hours * 60))
        )
        self.skills |= set(skills)

    # ---------------------------------------------------------------- 求解
    def schedule(self) -> dict:
        """从头全量排班（确定性）。返回覆盖摘要。"""
        sol = solve(self.shifts, self.employees, self.config)
        self._assignments = {sid: eid for sid, eid in sol.items() if eid is not None}
        self._recompute_gaps()
        return self.summary()

    def _reschedule(self, affected: set) -> dict:
        """事件驱动的局部重排。

        先只解锁受影响班次（其余分配锁定）局部重解；再用全量确定性重解校验，
        若两者不一致则采用全量结果——保证返回值与"从头重排"完全一致。
        """
        affected = set(affected)
        # 当前未覆盖的班次总是重新尝试
        affected |= {sid for sid in self.shifts if sid not in self._assignments}
        locked: Dict[str, str] = {}
        for sid, eid in self._assignments.items():
            if sid in affected:
                continue
            if self._statically_feasible(eid, self.shifts[sid]):
                locked[sid] = eid
            else:
                affected.add(sid)  # 锁定分配已因事件失效，一并重排
        candidate = solve(self.shifts, self.employees, self.config, locked=locked)
        full = solve(self.shifts, self.employees, self.config)
        final = candidate if candidate == full else full
        changed = sorted(
            sid for sid in self.shifts if self._assignments.get(sid) != final.get(sid)
        )
        self._assignments = {sid: eid for sid, eid in final.items() if eid is not None}
        self._recompute_gaps()
        return {
            "changed_shifts": changed,
            "affected_shifts": sorted(affected),
            "local_consistent": candidate == full,
        }

    def _statically_feasible(self, employee_id: str, shift: Shift) -> bool:
        e = self.employees[employee_id]
        return e.skills >= shift.required_skills and e.is_available_for(shift.start, shift.end)

    # ---------------------------------------------------------------- 时钟与事件
    def now(self) -> datetime:
        return self.clock.now()

    def advance_time(self, delta: timedelta) -> datetime:
        """推进逻辑时钟（仅 ManualClock 支持）。"""
        if not hasattr(self.clock, "advance"):
            raise ScheduleError("当前时钟不支持推进，请注入 ManualClock")
        return self.clock.advance(delta)

    def _check_event_time(self) -> datetime:
        now = self.clock.now()
        if self._last_event_time is not None and now < self._last_event_time:
            raise ScheduleError("事件时间不能早于上一个事件（时钟不可回退）")
        self._last_event_time = now
        return now

    def employee_leave(self, employee_id: str, start: datetime, end: datetime) -> dict:
        """员工临时请假：扣除可用时段，只重排受影响班次。"""
        e = self._employee(employee_id)
        now = self._check_event_time()
        e.availability = subtract_window(e.availability, start, end)
        self._events.append((now, f"员工 {employee_id} 请假 {start.isoformat()}~{end.isoformat()}"))
        affected = {
            sid
            for sid, eid in self._assignments.items()
            if eid == employee_id
            and not e.is_available_for(self.shifts[sid].start, self.shifts[sid].end)
        }
        return self._reschedule(affected)

    def update_availability(self, employee_id: str, windows: Sequence[TimeWindow]) -> dict:
        """员工可用时段整体变更，只重排受影响班次。"""
        e = self._employee(employee_id)
        now = self._check_event_time()
        e.availability = list(windows)
        self._events.append((now, f"员工 {employee_id} 可用时段变更"))
        affected = {
            sid
            for sid, eid in self._assignments.items()
            if eid == employee_id
            and not e.is_available_for(self.shifts[sid].start, self.shifts[sid].end)
        }
        return self._reschedule(affected)

    @property
    def events(self) -> List[dict]:
        return [{"time": t.isoformat(), "description": d} for t, d in self._events]

    # ---------------------------------------------------------------- 缺口分析
    def _recompute_gaps(self) -> None:
        self._gaps = {}
        for sid, s in self.shifts.items():
            if sid not in self._assignments:
                self._gaps[sid] = self._analyze_gap(s)

    def _analyze_gap(self, shift: Shift) -> dict:
        minutes = self._employee_minutes()
        reasons = []
        skilled = 0
        for eid in sorted(self.employees):
            e = self.employees[eid]
            missing = shift.required_skills - e.skills
            if missing:
                reasons.append({
                    "employee": eid,
                    "code": "missing_skills",
                    "missing": sorted(missing),
                    "detail": f"缺少技能: {', '.join(sorted(missing))}",
                })
                continue
            skilled += 1
            if not e.is_available_for(shift.start, shift.end):
                reasons.append({
                    "employee": eid,
                    "code": "not_available",
                    "detail": "可用时段不包含该班次",
                })
                continue
            conflict_with, code = self._first_conflict(eid, shift)
            if code == "overlap":
                reasons.append({
                    "employee": eid,
                    "code": "overlap",
                    "with_shift": conflict_with,
                    "detail": f"与已排班次 {conflict_with} 时间重叠",
                })
            elif code == "rest":
                reasons.append({
                    "employee": eid,
                    "code": "insufficient_rest",
                    "with_shift": conflict_with,
                    "detail": f"与已排班次 {conflict_with} 间隔不足最短休息 "
                              f"{self.config.min_rest_minutes} 分钟",
                })
            elif minutes[eid] + shift.duration_minutes > e.max_minutes:
                reasons.append({
                    "employee": eid,
                    "code": "exceeds_max_hours",
                    "detail": f"排入后工时 {(minutes[eid] + shift.duration_minutes) / 60:.2f}h "
                              f"超过上限 {e.max_minutes / 60:.2f}h",
                })
            else:
                reasons.append({
                    "employee": eid,
                    "code": "feasible_but_unassigned",
                    "detail": "该员工当前可行（求解达到搜索预算上限，未排入）",
                })
        if not self.employees:
            summary = "no_employees"
        elif skilled == 0:
            summary = "no_employee_with_required_skills"
        elif all(r["code"] in ("missing_skills", "not_available") for r in reasons):
            summary = "no_available_employee"
        else:
            summary = "all_candidates_conflicted"
        return {
            "shift_id": shift.id,
            "store_id": shift.store_id,
            "required_skills": sorted(shift.required_skills),
            "summary": summary,
            "reasons": reasons,
        }

    def _first_conflict(self, employee_id: str, shift: Shift):
        for sid, eid in self._assignments.items():
            if eid != employee_id:
                continue
            code = conflict_code(shift, self.shifts[sid], self.config.min_rest_minutes)
            if code:
                return sid, code
        return None, None

    # ---------------------------------------------------------------- 统计与查询
    def _employee_minutes(self) -> Dict[str, int]:
        minutes = {eid: 0 for eid in self.employees}
        for sid, eid in self._assignments.items():
            minutes[eid] += self.shifts[sid].duration_minutes
        return minutes

    def _employee_nights(self) -> Dict[str, int]:
        nights = {eid: 0 for eid in self.employees}
        for sid, eid in self._assignments.items():
            s = self.shifts[sid]
            if self.config.is_night_shift(s.start, s.end):
                nights[eid] += 1
        return nights

    def summary(self) -> dict:
        uncovered = sorted(sid for sid in self.shifts if sid not in self._assignments)
        return {
            "total_shifts": len(self.shifts),
            "covered_shifts": len(self._assignments),
            "uncovered_shifts": len(uncovered),
            "uncovered_shift_ids": uncovered,
        }

    def assignments(self) -> Dict[str, str]:
        return {sid: self._assignments[sid] for sid in sorted(self._assignments)}

    def get_store_schedule(self, store_id: str) -> List[dict]:
        if store_id not in self.stores:
            raise NotFoundError(f"门店不存在: {store_id!r}")
        rows = [s for s in self.shifts.values() if s.store_id == store_id]
        rows.sort(key=lambda s: (s.start, s.id))
        return [
            {
                "shift_id": s.id,
                "start": s.start.isoformat(),
                "end": s.end.isoformat(),
                "required_skills": sorted(s.required_skills),
                "is_night": self.config.is_night_shift(s.start, s.end),
                "employee_id": self._assignments.get(s.id),
            }
            for s in rows
        ]

    def get_employee_schedule(self, employee_id: str) -> dict:
        e = self._employee(employee_id)
        sids = [sid for sid, eid in self._assignments.items() if eid == employee_id]
        sids.sort(key=lambda sid: (self.shifts[sid].start, sid))
        minutes = sum(self.shifts[sid].duration_minutes for sid in sids)
        nights = sum(
            1
            for sid in sids
            if self.config.is_night_shift(self.shifts[sid].start, self.shifts[sid].end)
        )
        return {
            "employee_id": employee_id,
            "shifts": [
                {
                    "shift_id": sid,
                    "store_id": self.shifts[sid].store_id,
                    "start": self.shifts[sid].start.isoformat(),
                    "end": self.shifts[sid].end.isoformat(),
                    "is_night": self.config.is_night_shift(
                        self.shifts[sid].start, self.shifts[sid].end
                    ),
                }
                for sid in sids
            ],
            "total_hours": round(minutes / 60, 4),
            "night_shifts": nights,
            "max_hours": round(e.max_minutes / 60, 4),
        }

    def get_shift_gap(self, shift_id: str) -> Optional[dict]:
        if shift_id not in self.shifts:
            raise NotFoundError(f"班次不存在: {shift_id!r}")
        return self._gaps.get(shift_id)

    def fairness_report(self) -> dict:
        minutes = self._employee_minutes()
        nights = self._employee_nights()
        n = len(self.employees)
        mean_hours = (sum(minutes.values()) / 60 / n) if n else 0.0
        mean_nights = (sum(nights.values()) / n) if n else 0.0
        per_employee = []
        for eid in sorted(self.employees):
            hours = minutes[eid] / 60
            per_employee.append({
                "employee_id": eid,
                "hours": round(hours, 4),
                "night_shifts": nights[eid],
                "hours_deviation": round(hours - mean_hours, 4),
                "night_deviation": round(nights[eid] - mean_nights, 4),
            })
        hv = [m / 60 for m in minutes.values()]
        nv = list(nights.values())
        return {
            "employees": per_employee,
            "global": {
                "covered_shifts": len(self._assignments),
                "uncovered_shifts": len(self.shifts) - len(self._assignments),
                "uncovered_shift_ids": sorted(
                    sid for sid in self.shifts if sid not in self._assignments
                ),
                "hours_range": round(max(hv) - min(hv), 4) if hv else 0.0,
                "night_shift_range": (max(nv) - min(nv)) if nv else 0,
                "mean_hours": round(mean_hours, 4),
                "mean_night_shifts": round(mean_nights, 4),
            },
        }

    # ---------------------------------------------------------------- 持久化
    def save(self, path) -> None:
        from .persistence import save_engine

        save_engine(self, path)

    @classmethod
    def load(cls, path, clock=None) -> "SchedulingEngine":
        from .persistence import load_engine

        return load_engine(path, clock=clock)

    def import_file(self, path) -> None:
        """从 JSON 文件载入并替换当前状态；任何校验失败都不会改变现有状态。"""
        from .persistence import load_engine

        new = load_engine(path, clock=self.clock)
        self.config = new.config
        self.stores = new.stores
        self.shifts = new.shifts
        self.employees = new.employees
        self.skills = new.skills
        self._assignments = new._assignments
        self._gaps = new._gaps

    # ---------------------------------------------------------------- 内部
    def _employee(self, employee_id: str) -> Employee:
        if employee_id not in self.employees:
            raise NotFoundError(f"员工不存在: {employee_id!r}")
        return self.employees[employee_id]
