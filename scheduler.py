"""Discrete-time scheduler for the local factory planning demo.

The model intentionally uses only Python's standard library.  One planning day
is represented by 288 five-minute slots.  Every segment occupies whole slots.
"""

from __future__ import annotations

from math import ceil, isfinite
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

SLOT_MINUTES = 5
SLOTS = 24 * 60 // SLOT_MINUTES
OFF_KEY = "OFF"


def clamp_slot(value: Any, default: int = 0) -> int:
    """Convert a slot-like value to an integer in the planning horizon."""
    try:
        number = int(round(float(value)))
    except (TypeError, ValueError):
        number = default
    return max(0, min(SLOTS, number))


def money(value: float) -> float:
    """Round currency/energy values for stable JSON output."""
    if not isfinite(value):
        return 0.0
    return round(float(value) + 0.0, 4)


def qty(value: float) -> float:
    if not isfinite(value):
        return 0.0
    return round(float(value) + 0.0, 3)


def parse_window(text: Any) -> Tuple[int, int]:
    """Parse 'start,end' or 'start;end' maintenance windows given as slots."""
    raw = str(text or "").strip()
    if not raw:
        return (0, 0)
    for separator in (";", ",", "|", "-"):
        if separator in raw:
            left, right = raw.split(separator, 1)
            start, end = parse_timeish(left), parse_timeish(right)
            if start <= end:
                return (start, max(start, end))
    return (0, 0)


def parse_windows(text: Any) -> List[Tuple[int, int]]:
    """Parse one or several windows separated by semicolons, e.g. 08:00-09:00;15:00-15:30."""
    windows = []
    for part in str(text or "").split(";"):
        window = parse_window(part)
        if window[1] > window[0]:
            windows.append(window)
    return windows


def parse_timeish(value: Any) -> int:
    text = str(value or "").strip()
    if ":" in text:
        hour_text, minute_text = text.split(":", 1)
        return clamp_slot((int(hour_text) * 60 + int(float(minute_text))) // SLOT_MINUTES)
    return clamp_slot(text)


def _mode(mode: Dict[str, Any]) -> Dict[str, Any]:
    key = str(mode.get("id") or mode.get("mode") or mode.get("name") or "").strip()
    return {
        "id": key,
        "name": str(mode.get("name") or key),
        "rate": max(0.0, float(mode.get("rate", mode.get("power", 0)) or 0)),
        "speed": max(0.0, float(mode.get("speed", mode.get("output", 0)) or 0)),
        # speed and energy are expressed per hour
    }


def normalize_devices(raw_devices: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize device rows and embedded mode descriptions.

    Accepted mode columns include:
    modes = LOW:power,speed;HIGH:power,speed
    or repeated JSON-like rows prepared by the UI.
    """
    devices: List[Dict[str, Any]] = []
    for index, row in enumerate(raw_devices):
        device_id = str(row.get("id") or row.get("device_id") or f"D{index + 1}").strip()
        modes_raw = row.get("modes")
        if isinstance(modes_raw, list):
            modes = [_mode(item) for item in modes_raw if isinstance(item, dict)]
        else:
            modes = []
            for part in str(modes_raw or "").replace("|", ";").split(";"):
                part = part.strip()
                if not part or ":" not in part:
                    continue
                name, values = part.split(":", 1)
                fields = [v.strip() for v in values.replace(",", "/").split("/")]
                try:
                    power = float(fields[0])
                    speed = float(fields[1]) if len(fields) > 1 else power
                except (ValueError, IndexError):
                    continue
                modes.append(_mode({"id": name.strip(), "rate": power, "speed": speed}))
        if not modes:
            # A conservative default makes malformed demo data immediately usable.
            modes = [_mode({"id": "RUN", "rate": row.get("power", 10), "speed": row.get("speed", 10)})]
        modes = [mode for mode in modes if mode["id"]]
        modes.sort(key=lambda item: (item["speed"], item["rate"]))

        maintenance: List[Dict[str, int]] = []
        if isinstance(row.get("maintenance"), list):
            for item in row["maintenance"]:
                if isinstance(item, dict):
                    maintenance.append({"start": clamp_slot(item.get("start")), "end": clamp_slot(item.get("end"))})
        for key, value in row.items():
            if key and "maintenance" in str(key).lower() and isinstance(value, str) and value:
                for start, end in parse_windows(value):
                    maintenance.append({"start": start, "end": end})

        devices.append(
            {
                "id": device_id,
                "name": str(row.get("name") or device_id),
                "shift_start": clamp_slot(row.get("shift_start", row.get("available_start", 0)), 0),
                "shift_end": clamp_slot(row.get("shift_end", row.get("available_end", SLOTS)), SLOTS),
                "max_run_slots": clamp_slot(row.get("max_run_slots", row.get("capacity_limit", SLOTS)), SLOTS),
                "modes": modes,
                "maintenance": maintenance,
            }
        )
    return devices


def normalize_transitions(raw: Any, devices: Sequence[Dict[str, Any]]) -> Dict[Tuple[str, str, str], Dict[str, int]]:
    """Build transition lookup keyed by (device,from_mode,to_mode).

    Raw entries may be dictionaries or strings such as
    "DEV1,OFF,LOW,2,3" = 2 slots duration and 3 kW transition power.
    """
    lookup: Dict[Tuple[str, str, str], Dict[str, int]] = {}
    rows = raw if isinstance(raw, list) else []
    for row in rows:
        if isinstance(row, str):
            fields = [part.strip() for part in row.split(",")]
            if len(fields) < 5:
                continue
            row = dict(zip(("device_id", "from", "to", "duration_slots", "rate"), fields))
        if not isinstance(row, dict):
            continue
        device_id = str(row.get("device_id") or row.get("device") or "").strip()
        source = str(row.get("from") or row.get("from_mode") or OFF_KEY).strip() or OFF_KEY
        target = str(row.get("to") or row.get("to_mode") or "").strip()
        if not device_id or not target:
            continue
        duration = clamp_slot(row.get("duration_slots", row.get("slots", row.get("duration", 1))), 1)
        try:
            rate = max(0.0, float(row.get("rate", row.get("power", 0)) or 0))
        except (TypeError, ValueError):
            rate = 0.0
        lookup[(device_id, source, target)] = {"slots": max(1, duration), "rate": rate}

    # Convenience default: one slot startup and instantaneous same-tier mode
    # changes are still represented explicitly so their energy is visible.
    for device in devices:
        for mode in device["modes"]:
            key = (device["id"], OFF_KEY, mode["id"])
            lookup.setdefault(key, {"slots": 2, "rate": round(mode["rate"] * 0.25, 3)})
            for other in device["modes"]:
                if other["id"] != mode["id"]:
                    lookup.setdefault(
                        (device["id"], mode["id"], other["id"]),
                        {"slots": 1,
                         "rate": round(max(mode["rate"], other["rate"]) * 0.35, 3)},
                    )
    return lookup


def normalize_tasks(raw_tasks: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    tasks: List[Dict[str, Any]] = []
    for index, row in enumerate(raw_tasks):
        task_id = str(row.get("id") or row.get("task_id") or f"T{index + 1}").strip()
        dependencies = row.get("depends_on", row.get("dependencies", ""))
        if isinstance(dependencies, list):
            deps = [str(item).strip() for item in dependencies if str(item).strip()]
        else:
            deps = [part.strip() for part in str(dependencies or "").replace(";", ",").split(",") if part.strip()]
        allowed = row.get("allowed_devices", row.get("devices", ""))
        if isinstance(allowed, list):
            eligible_devices = [str(item).strip() for item in allowed if str(item).strip()]
        else:
            eligible_devices = [part.strip() for part in str(allowed or "").replace(";", ",").split(",") if part.strip()]
        tasks.append(
            {
                "id": task_id,
                "name": str(row.get("name") or task_id),
                "quantity": max(0.0, float(row.get("quantity", row.get("demand", 0)) or 0)),
                "release": clamp_slot(row.get("release", row.get("release_slot", 0)), 0),
                "deadline": clamp_slot(row.get("deadline", row.get("due", SLOTS)), SLOTS),
                "priority": int(float(row.get("priority", 1) or 1)),
                "depends_on": deps,
                "allowed_devices": eligible_devices,
                "effective_deadline": clamp_slot(row.get("deadline", row.get("due", SLOTS)), SLOTS),
            }
        )
    return tasks


class Scheduler:
    def __init__(
        self,
        devices: Sequence[Dict[str, Any]],
        tasks: Sequence[Dict[str, Any]],
        transitions: Dict[Tuple[str, str, str], Dict[str, int]],
        overrides: Optional[Sequence[Dict[str, Any]]] = None,
        relax_windows: bool = False,
    ):
        self.devices = list(devices)
        self.device_by_id = {item["id"]: item for item in self.devices}
        self.tasks = list(tasks)
        self.task_by_id = {item["id"]: item for item in self.tasks}
        self.transitions = transitions
        self.overrides = list(overrides or [])
        self.relax_windows = relax_windows
        self.segments: Dict[str, List[Dict[str, Any]]] = {d["id"]: [] for d in self.devices}
        self.occupied: Dict[str, Set[int]] = {d["id"]: set() for d in self.devices}
        self.run_slots: Dict[str, int] = {d["id"]: 0 for d in self.devices}
        self.remaining = {task["id"]: task["quantity"] for task in self.tasks}
        self.end_slots: Dict[str, int] = {}
        self.conflicts: List[Dict[str, Any]] = []
        self.manual_segments = 0

    def available(self, device: Dict[str, Any], slot: int) -> bool:
        if slot < 0 or slot >= SLOTS:
            return False
        if slot in self.occupied[device["id"]]:
            return False
        if self.relax_windows:
            return not any(window["start"] <= slot < window["end"] for window in device["maintenance"])
        return (
            device["shift_start"] <= slot < device["shift_end"]
            and not any(window["start"] <= slot < window["end"] for window in device["maintenance"])
        )

    def add_segment(
        self,
        device_id: str,
        start: int,
        end: int,
        kind: str,
        task_id: Optional[str] = None,
        mode: str = OFF_KEY,
        rate: float = 0.0,
        produced: float = 0.0,
        locked: bool = False,
    ) -> Dict[str, Any]:
        segment = {
            "id": f"{device_id}-{kind}-{len(self.segments[device_id]) + 1}",
            "device_id": device_id,
            "task_id": task_id,
            "kind": kind,
            "mode": mode,
            "start": int(start),
            "end": int(end),
            "rate": round(float(rate), 4),
            "produced": qty(produced),
            "locked": bool(locked),
        }
        self.segments[device_id].append(segment)
        self.segments[device_id].sort(key=lambda item: (item["start"], item["end"]))
        for slot in range(start, end):
            self.occupied[device_id].add(slot)
        if kind == "production":
            self.run_slots[device_id] += end - start
        return segment

    def state_before(self, device_id: str, slot: int) -> str:
        state = OFF_KEY
        for segment in sorted(self.segments[device_id], key=lambda item: (item["end"], item["start"])):
            if segment["end"] <= slot:
                if segment["kind"] == "production":
                    state = segment["mode"]
                elif segment["kind"] == "transition":
                    state = str(segment.get("to_mode") or state)
        return state

    def place_transition(self, device_id: str, source: str, target: str, production_start: int) -> Optional[int]:
        """Reserve a transition immediately before production; return its start."""
        if source == target:
            return production_start
        info = self.transitions.get((device_id, source, target))
        if not info:
            self.conflicts.append(
                {
                    "type": "missing_transition",
                    "task_id": None,
                    "device_id": device_id,
                    "from_mode": source,
                    "to_mode": target,
                    "message": f"设备 {device_id} 缺少 {source}→{target} 的过渡定义。",
                }
            )
            return None
        duration = max(1, info["slots"])
        start = production_start - duration
        if start < 0 or any(not self.available(self.device_by_id[device_id], slot) for slot in range(start, production_start)):
            return None
        segment = self.add_segment(device_id, start, production_start, "transition", mode=source, rate=info["rate"])
        segment["to_mode"] = target
        return start

    def apply_overrides(self) -> None:
        for override in sorted(self.overrides, key=lambda item: clamp_slot(item.get("start"))):
            device_id = str(override.get("device_id", "")).strip()
            task_id = str(override.get("task_id", "")).strip()
            mode_id = str(override.get("mode", "")).strip()
            device = self.device_by_id.get(device_id)
            task = self.task_by_id.get(task_id)
            if not device or not task:
                continue
            mode = next((item for item in device["modes"] if item["id"] == mode_id), None)
            start, end = clamp_slot(override.get("start")), clamp_slot(override.get("end"))
            if not mode or end <= start:
                self.conflicts.append({"type": "invalid_edit", "task_id": task_id, "device_id": device_id,
                                       "message": "手动调整的档位或时间无效。"})
                continue
            if device_id not in {item["id"] for item in self._eligible_devices(task)}:
                self.conflicts.append({"type": "device_not_allowed", "task_id": task_id, "device_id": device_id,
                                       "message": f"任务 {task_id} 不能由设备 {device_id} 承接。"})
                continue
            unfinished_dependency = next((dep for dep in task["depends_on"] if dep in self.task_by_id and self.remaining.get(dep, 0) > 0), None)
            if unfinished_dependency:
                self.conflicts.append({"type": "manual_dependency", "task_id": task_id, "device_id": device_id,
                                       "dependency": unfinished_dependency,
                                       "message": f"不能先安排任务 {task_id}：前置任务 {unfinished_dependency} 尚未完成。"})
                continue
            if start < task["release"] or end > task["effective_deadline"]:
                self.conflicts.append({"type": "manual_deadline", "task_id": task_id, "device_id": device_id,
                                       "start": start, "end": end, "deadline": task["effective_deadline"],
                                       "message": f"手动安排会使任务 {task_id} 在 {device_id} 上错过自身或后续任务的截止时间。"})
                continue
            if any(not self.available(device, slot) for slot in range(start, end)):
                self.conflicts.append({"type": "manual_blocked", "task_id": task_id, "device_id": device_id,
                                       "start": start, "end": end,
                                       "message": f"设备 {device_id} 的手动时段被维护、班次或已有调整占用。"})
                continue
            source = self.state_before(device_id, start)
            transition_start = self.place_transition(device_id, source, mode_id, start)
            if transition_start is None:
                self.conflicts.append({"type": "manual_transition", "task_id": task_id, "device_id": device_id,
                                       "start": start, "mode": mode_id,
                                       "message": f"设备 {device_id} 在 {start} 前没有足够的 {source}→{mode_id} 过渡时间。"})
                continue
            if self.run_slots[device_id] + (end - start) > device["max_run_slots"]:
                self.conflicts.append({"type": "manual_capacity", "task_id": task_id, "device_id": device_id,
                                       "message": f"设备 {device_id} 当日剩余产能不足以承接该手动安排。"})
                continue
            possible = min(self.remaining[task_id], mode["speed"] * (end - start) * SLOT_MINUTES / 60.0)
            possible_slots = min(end - start, max(1, ceil(possible / (mode["speed"] * SLOT_MINUTES / 60.0)))) if possible > 0 else 0
            if possible_slots <= 0:
                self.conflicts.append({"type": "task_already_complete", "task_id": task_id, "device_id": device_id,
                                       "message": f"任务 {task_id} 已完成，无需继续安排。"})
                continue
            production_end = start + possible_slots
            self.add_segment(device_id, start, production_end, "production", task_id, mode_id, mode["rate"], possible, True)
            self.remaining[task_id] = qty(max(0.0, self.remaining[task_id] - possible))
            self.end_slots[task_id] = max(self.end_slots.get(task_id, 0), production_end)
            self.manual_segments += 1

    def _eligible_devices(self, task: Dict[str, Any]) -> List[Dict[str, Any]]:
        allowed = set(task["allowed_devices"])
        return [device for device in self.devices if not allowed or device["id"] in allowed]

    def _can_transition_before(self, device: Dict[str, Any], source: str, target: str, production_start: int) -> bool:
        if source == target:
            return True
        info = self.transitions.get((device["id"], source, target))
        if not info:
            return False
        duration = info["slots"]
        return production_start - duration >= 0 and all(
            self.available(device, slot) for slot in range(production_start - duration, production_start)
        )

    def _earliest_window(
        self, device: Dict[str, Any], lower: int, mode: Dict[str, Any], max_slots: int,
        limit: int = SLOTS,
    ) -> Optional[Tuple[int, int]]:
        """Find earliest contiguous production run with transition immediately before it."""
        max_slots = max(0, min(max_slots, device["max_run_slots"] - self.run_slots[device["id"]]))
        if max_slots <= 0 or mode["speed"] <= 0:
            return None
        for slot in range(max(0, lower), SLOTS):
            if not self.available(device, slot):
                continue
            source = self.state_before(device["id"], slot)
            if not self._can_transition_before(device, source, mode["id"], slot):
                continue
            length = 0
            probe = slot
            while probe < limit and length < max_slots and self.available(device, probe):
                length += 1
                probe += 1
            if length:
                return slot, length
        return None

    def _task_lower_bound(self, task: Dict[str, Any]) -> int:
        lower = task["release"]
        for dependency in task["depends_on"]:
            if dependency in self.task_by_id:
                if self.remaining.get(dependency, 0) > 0 or dependency not in self.end_slots:
                    return SLOTS + 1
                lower = max(lower, self.end_slots[dependency])
        return lower

    def _best_candidate(self, task: Dict[str, Any], partial_allowed: bool) -> Optional[Dict[str, Any]]:
        lower = self._task_lower_bound(task)
        deadline = task["effective_deadline"]
        if lower > deadline:
            return None
        complete_candidates: List[Dict[str, Any]] = []
        partial_candidates: List[Dict[str, Any]] = []
        for device in self._eligible_devices(task):
            for mode in device["modes"]:
                window = self._earliest_window(device, lower, mode, SLOTS, deadline)
                if not window:
                    continue
                start, available_slots = window
                per_slot = mode["speed"] * SLOT_MINUTES / 60.0
                required_slots = max(1, ceil(self.remaining[task["id"]] / per_slot)) if per_slot > 0 else SLOTS + 1
                length = min(available_slots, required_slots)
                end = start + length
                transition = self.transitions.get((device["id"], self.state_before(device["id"], start), mode["id"]))
                transition_slots = 0 if self.state_before(device["id"], start) == mode["id"] else (transition or {}).get("slots", 0)
                produced = min(self.remaining[task["id"]], per_slot * length)
                energy = mode["rate"] * length * SLOT_MINUTES / 60.0
                energy += (transition or {}).get("rate", 0) * transition_slots * SLOT_MINUTES / 60.0
                candidate = {
                    "device": device, "mode": mode, "start": start, "length": length, "end": end,
                    "produced": qty(produced), "energy": energy,
                    "unit_energy": energy / produced if produced else 0.0,
                }
                if end <= deadline and produced + 1e-9 >= self.remaining[task["id"]]:
                    complete_candidates.append(candidate)
                elif partial_allowed and end <= deadline:
                    partial_candidates.append(candidate)
        if complete_candidates:
            # Earliest completion protects downstream work and shared capacity;
            # energy breaks ties among equally fast choices.
            return min(complete_candidates, key=lambda c: (c["end"], c["unit_energy"], c["start"]))
        if partial_allowed and partial_candidates:
            # If a single remaining allocation cannot complete the task, speed
            # beats energy so other eligible devices can still take the remainder.
            return min(partial_candidates, key=lambda c: (c["end"], c["unit_energy"], c["start"]))
        return None

    def _ordered_tasks(self) -> List[Dict[str, Any]]:
        # Kahn ordering; downstream tasks carry the earliest relevant deadline
        # upward so a prerequisite is not scheduled after its dependent is due.
        indegree = {task["id"]: 0 for task in self.tasks}
        dependents: Dict[str, List[str]] = {task["id"]: [] for task in self.tasks}
        for task in self.tasks:
            for dep in task["depends_on"]:
                if dep in indegree:
                    indegree[task["id"]] += 1
                    dependents[dep].append(task["id"])
        order: List[Dict[str, Any]] = []
        ready = [self.task_by_id[task_id] for task_id, degree in indegree.items() if degree == 0]
        while ready:
            ready.sort(key=lambda t: (t["deadline"], t["priority"], t["id"]))
            task = ready.pop(0)
            order.append(task)
            for child_id in dependents[task["id"]]:
                indegree[child_id] -= 1
                child = self.task_by_id[child_id]
                if indegree[child_id] == 0:
                    ready.append(child)
        for task in reversed(order):
            for child_id in dependents[task["id"]]:
                task["effective_deadline"] = min(task["effective_deadline"], self.task_by_id[child_id]["effective_deadline"])
        if len(order) != len(self.tasks):
            unresolved = {task_id for task_id, degree in indegree.items() if degree > 0}
            self.conflicts.append({"type": "dependency_cycle", "task_ids": sorted(unresolved),
                                   "message": "任务依赖中存在循环，无法生成先后顺序。"})
        return order

    def _commit_candidate(self, task: Dict[str, Any], candidate: Dict[str, Any]) -> None:
        device, mode = candidate["device"], candidate["mode"]
        start, end = candidate["start"], candidate["end"]
        source = self.state_before(device["id"], start)
        transition_start = self.place_transition(device["id"], source, mode["id"], start)
        if transition_start is None:
            return
        produced = min(candidate["produced"], self.remaining[task["id"]])
        actual_slots = min(end - start, max(1, ceil(produced / (mode["speed"] * SLOT_MINUTES / 60.0))))
        end = start + actual_slots
        segment = self.add_segment(device["id"], start, end, "production", task["id"], mode["id"], mode["rate"], produced, False)
        candidate["produced"] = produced
        candidate["end"] = end
        segment["produced"] = qty(produced)
        self.remaining[task["id"]] = qty(max(0.0, self.remaining[task["id"]] - produced))
        if self.remaining[task["id"]] <= 1e-6:
            self.end_slots[task["id"]] = max(self.end_slots.get(task["id"], 0), end)

    def _report_unfinished(self, order: Sequence[Dict[str, Any]]) -> None:
        for task in order:
            if self.remaining[task["id"]] <= 1e-6:
                continue
            eligible = self._eligible_devices(task)
            details = []
            for device in eligible:
                reasons = []
                if self.run_slots[device["id"]] >= device["max_run_slots"]:
                    reasons.append("达到产能上限")
                if any(window["start"] < task["effective_deadline"] for window in device["maintenance"]):
                    reasons.append("存在维护窗口")
                if task["effective_deadline"] <= device["shift_start"] or task["release"] >= device["shift_end"]:
                    reasons.append("启停窗口不重叠")
                details.append({"device_id": device["id"], "reasons": reasons or ["可用时段/档位不足以完成剩余产量"]})
            self.conflicts.append(
                {
                    "type": "late_or_unfinished",
                    "task_id": task["id"],
                    "remaining": self.remaining[task["id"]],
                    "deadline": task["deadline"],
                    "devices": details,
                    "message": f"任务 {task['id']} 的前置截止约束为第 {task['effective_deadline']} 个时间槽，仍有 {self.remaining[task['id']]} 无法完成。",
                }
            )

    def run(self) -> Dict[str, Any]:
        self.add_maintenance_segments()
        self._ordered_tasks()
        self.apply_overrides()
        order = self._ordered_tasks()
        # Fill each prerequisite before moving downstream. Partial chunks let a
        # blocked machine transfer its residual quantity to another device.
        for task in order:
            while self.remaining[task["id"]] > 1e-6:
                candidate = self._best_candidate(task, partial_allowed=True)
                if not candidate:
                    break
                self._commit_candidate(task, candidate)
        self._report_unfinished(order)
        return self.build_result(feasible=not self.conflicts)

    def add_maintenance_segments(self) -> None:
        for device in self.devices:
            for window in device["maintenance"]:
                start, end = window["start"], window["end"]
                if end > start and all(slot not in self.occupied[device["id"]] for slot in range(start, end)):
                    self.add_segment(device["id"], start, end, "maintenance", mode="MAINT", rate=0)

    def build_result(self, feasible: bool) -> Dict[str, Any]:
        curve = [0.0 for _ in range(SLOTS)]
        device_rows = []
        for device in self.devices:
            energy = 0.0
            run = transition = 0
            for segment in self.segments[device["id"]]:
                segment_energy = segment["rate"] * (segment["end"] - segment["start"]) * SLOT_MINUTES / 60.0
                segment["energy_kwh"] = money(segment_energy)
                energy += segment_energy
                for slot in range(segment["start"], segment["end"]):
                    if segment["kind"] in {"production", "transition"}:
                        curve[slot] += segment["rate"]
                if segment["kind"] == "production":
                    run += segment["end"] - segment["start"]
                elif segment["kind"] == "transition":
                    transition += segment["end"] - segment["start"]
            device_rows.append({
                "device_id": device["id"], "name": device["name"], "energy_kwh": money(energy),
                "run_slots": run, "transition_slots": transition,
                "load_ratio": round(run / max(1, device["max_run_slots"]), 4),
                "modes": device["modes"], "shift_start": device["shift_start"],
                "shift_end": device["shift_end"], "maintenance": device["maintenance"],
            })

        task_rows = []
        for task in self.tasks:
            done = qty(task["quantity"] - self.remaining[task["id"]])
            end = self.end_slots.get(task["id"])
            task_rows.append({
                "task_id": task["id"], "name": task["name"], "quantity": task["quantity"],
                "completed": min(task["quantity"], done), "remaining": max(0.0, self.remaining[task["id"]]),
                "release": task["release"], "deadline": task["deadline"], "end": end,
                "on_time": end is not None and end <= task["deadline"] and self.remaining[task["id"]] <= 1e-6,
                "depends_on": task["depends_on"],
            })
        energy_kwh = sum(row["energy_kwh"] for row in device_rows)
        major = max(device_rows, key=lambda row: row["energy_kwh"], default=None)
        all_segments = [segment for values in self.segments.values() for segment in values]
        return {
            "feasible": feasible and all(row["remaining"] <= 1e-6 for row in task_rows),
            "slot_minutes": SLOT_MINUTES, "slots": SLOTS,
            "segments": sorted(all_segments, key=lambda item: (item["start"], item["device_id"], item["kind"])),
            "devices": sorted(device_rows, key=lambda row: row["energy_kwh"], reverse=True),
            "tasks": task_rows, "conflicts": self.conflicts,
            "metrics": {
                "energy_kwh": money(energy_kwh),
                "transition_kwh": money(sum(
                    s["rate"] * (s["end"] - s["start"]) * SLOT_MINUTES / 60.0
                    for s in all_segments if s["kind"] == "transition")),
                "peak_kw": money(max(curve, default=0.0)),
                "manual_segments": self.manual_segments,
                "main_energy_source": major["device_id"] if major and major["energy_kwh"] > 0 else None,
            },
            "energy_curve_kw": [money(value) for value in curve],
        }


def _tariff_vector(raw_tariff: Any) -> List[float]:
    if isinstance(raw_tariff, list):
        values = [float(item or 0) for item in raw_tariff]
    else:
        try:
            values = [float(raw_tariff)] if raw_tariff not in (None, "") else [0.8]
        except (TypeError, ValueError):
            values = [0.8]
    if len(values) == 24:
        return [values[slot * SLOT_MINUTES // 60] for slot in range(SLOTS)]
    if len(values) == SLOTS:
        return values
    return [values[slot % len(values)] for slot in range(SLOTS)]


def apply_tariff(result: Dict[str, Any], raw_tariff: Any) -> Dict[str, Any]:
    prices = _tariff_vector(raw_tariff)
    curve = result["energy_curve_kw"]
    cost_curve = [money(curve[slot] * SLOT_MINUTES / 60.0 * prices[slot]) for slot in range(SLOTS)]
    result["tariff_currency_per_kwh"] = [money(value) for value in prices]
    result["cost_curve"] = cost_curve
    result["metrics"]["total_cost"] = money(sum(cost_curve))
    return result


def _run_once(
    devices: Sequence[Dict[str, Any]],
    tasks: Sequence[Dict[str, Any]],
    transitions: Dict[Tuple[str, str, str], Dict[str, int]],
    overrides: Sequence[Dict[str, Any]],
    relax_windows: bool,
) -> Dict[str, Any]:
    return Scheduler(
        [dict(device, maintenance=list(device["maintenance"]), modes=list(device["modes"])) for device in devices],
        [dict(task, depends_on=list(task["depends_on"]), allowed_devices=list(task["allowed_devices"])) for task in tasks],
        transitions, overrides, relax_windows,
    ).run()


def schedule(payload: Dict[str, Any]) -> Dict[str, Any]:
    devices = normalize_devices(payload.get("devices", []))
    tasks = normalize_tasks(payload.get("tasks", []))
    transitions = normalize_transitions(payload.get("transitions", []), devices)
    overrides = payload.get("overrides", []) if isinstance(payload.get("overrides", []), list) else []
    current = _run_once(devices, tasks, transitions, overrides, False)
    result = apply_tariff(current, payload.get("tariff", 0.8))
    if not result["feasible"]:
        for override in overrides:
            task_id = str(override.get("task_id", ""))
            device_id = str(override.get("device_id", ""))
            if task_id in {task["id"] for task in tasks} and device_id in {device["id"] for device in devices}:
                result["conflicts"].append({
                    "type": "manual_adjustment_source",
                    "task_id": task_id,
                    "device_id": device_id,
                    "start": clamp_slot(override.get("start")),
                    "end": clamp_slot(override.get("end")),
                    "mode": str(override.get("mode", "")),
                    "message": f"手动调整：任务 {task_id} 在设备 {device_id} 上以 {override.get('mode', '')} 档运行，"
                               f"是当前截止冲突的来源；替代方案已清空该调整。",
                })
        alternative = _run_once(devices, tasks, transitions, [], False)
        if not alternative["feasible"]:
            alternative = _run_once(devices, tasks, transitions, [], True)
        result["alternative"] = apply_tariff(alternative, payload.get("tariff", 0.8))
        result["alternative"]["note"] = (
            "替代方案保留维护与产能上限，清空手动启停/档位调整；"
            "如仍为红色，则设备总产能或维护约束不足。"
        )
    return result
