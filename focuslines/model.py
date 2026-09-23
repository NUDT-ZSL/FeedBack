"""Core state machine for multi-line focus tracking.

Entities:
  WorkLine  -- an ordered list of Stage objects, one line of work.
  Stage     -- a phase with an estimated duration and accumulated
               invested time; survives any number of interruptions.
  FocusTracker -- owns all lines and the single global focus session.

Timer model: only one stage may be actively timing at a time. Invested
time is accumulated on every pause/switch/complete, so remaining time
is always derived as ``estimated - invested`` and never resets.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class StageStatus(str, Enum):
    PENDING = "pending"        # not started yet
    ACTIVE = "active"          # currently being timed
    PAUSED = "paused"          # interrupted / switched away, unfinished
    COMPLETED = "completed"


class LineStatus(str, Enum):
    ACTIVE = "active"
    COMPLETED = "completed"    # every stage completed
    ABANDONED = "abandoned"    # given up by the user


class TrackerState(str, Enum):
    IDLE = "idle"              # nothing running
    FOCUSING = "focusing"      # a stage is being timed
    INTERRUPTED = "interrupted"  # timing paused, awaiting a decision


class FocusError(Exception):
    """Raised on illegal state transitions."""


@dataclass
class Interruption:
    reason: str
    at: float                  # epoch seconds when it happened
    invested_seconds: float    # stage total invested at that moment


@dataclass
class Stage:
    stage_id: str
    name: str
    estimated_seconds: float
    status: StageStatus = StageStatus.PENDING
    invested_seconds: float = 0.0
    interruptions: list = field(default_factory=list)

    def remaining_seconds(self, extra_elapsed: float = 0.0) -> float:
        """Estimated minus invested; negative means overtime."""
        return self.estimated_seconds - self.invested_seconds - extra_elapsed


@dataclass
class WorkLine:
    line_id: str
    name: str
    stages: list = field(default_factory=list)
    status: LineStatus = LineStatus.ACTIVE

    def stage(self, stage_id: str) -> Stage:
        for s in self.stages:
            if s.stage_id == stage_id:
                return s
        raise FocusError(f"no stage {stage_id!r} in line {self.line_id!r}")


class FocusTracker:
    """Owns work lines and the single active focus session."""

    def __init__(self, clock=None):
        self._clock = clock or time.time
        self.lines: dict[str, WorkLine] = {}
        self.state = TrackerState.IDLE
        self._focus: tuple[str, str] | None = None  # (line_id, stage_id)
        self._segment_start: float | None = None
        self._seq = {"line": 0, "stage": 0}

    # -- structure ---------------------------------------------------

    def add_line(self, name: str, stages: list[tuple[str, float]]) -> WorkLine:
        """Create a line; stages are (name, estimated_minutes) in order."""
        self._seq["line"] += 1
        line = WorkLine(line_id=f"L{self._seq['line']}", name=name)
        for stage_name, minutes in stages:
            self._seq["stage"] += 1
            line.stages.append(Stage(
                stage_id=f"S{self._seq['stage']}",
                name=stage_name,
                estimated_seconds=float(minutes) * 60.0,
            ))
        self.lines[line.line_id] = line
        return line

    def line(self, line_id: str) -> WorkLine:
        try:
            return self.lines[line_id]
        except KeyError:
            raise FocusError(f"no work line {line_id!r}") from None

    # -- timer helpers -------------------------------------------------

    def _now(self) -> float:
        return float(self._clock())

    def _running_elapsed(self) -> float:
        if self.state != TrackerState.FOCUSING or self._segment_start is None:
            return 0.0
        return self._now() - self._segment_start

    def _accumulate(self) -> None:
        """Fold the running segment into the focused stage."""
        if self._focus is None:
            return
        line_id, stage_id = self._focus
        stage = self.lines[line_id].stage(stage_id)
        stage.invested_seconds += self._running_elapsed()
        self._segment_start = None

    def invested_seconds(self, line_id: str, stage_id: str) -> float:
        stage = self.line(line_id).stage(stage_id)
        total = stage.invested_seconds
        if self._focus == (line_id, stage_id):
            total += self._running_elapsed()
        return total

    def remaining_seconds(self, line_id: str, stage_id: str) -> float:
        stage = self.line(line_id).stage(stage_id)
        extra = 0.0
        if self._focus == (line_id, stage_id):
            extra = self._running_elapsed()
        return stage.remaining_seconds(extra)

    # -- focus session transitions ------------------------------------

    def _focused_stage(self) -> Stage:
        line_id, stage_id = self._focus
        return self.lines[line_id].stage(stage_id)

    def start_focus(self, line_id: str, stage_id: str) -> None:
        """Enter a stage and start timing. Requires IDLE state."""
        if self.state != TrackerState.IDLE:
            raise FocusError(
                "another stage is active; interrupt or complete it first")
        line = self.line(line_id)
        if line.status != LineStatus.ACTIVE:
            raise FocusError(f"line {line_id} is {line.status.value}")
        stage = line.stage(stage_id)
        if stage.status not in (StageStatus.PENDING, StageStatus.PAUSED):
            raise FocusError(f"stage {stage_id} is {stage.status.value}")
        stage.status = StageStatus.ACTIVE
        self._focus = (line_id, stage_id)
        self._segment_start = self._now()
        self.state = TrackerState.FOCUSING

    def complete_stage(self) -> None:
        """Mark the focused stage completed (from focusing or interrupted).

        If that was the line's last unfinished stage, the line becomes
        COMPLETED and its summary becomes available.
        """
        if self.state not in (TrackerState.FOCUSING, TrackerState.INTERRUPTED):
            raise FocusError("no focused stage to complete")
        self._accumulate()
        line_id, stage_id = self._focus
        stage = self.lines[line_id].stage(stage_id)
        stage.status = StageStatus.COMPLETED
        self._focus = None
        self.state = TrackerState.IDLE
        line = self.lines[line_id]
        if all(s.status == StageStatus.COMPLETED for s in line.stages):
            line.status = LineStatus.COMPLETED

    def abandon_line(self, line_id: str) -> None:
        """Give up a whole line; stops the timer if it was focused."""
        line = self.line(line_id)
        if line.status != LineStatus.ACTIVE:
            raise FocusError(f"line {line_id} is already {line.status.value}")
        if self._focus is not None and self._focus[0] == line_id:
            self._accumulate()
            stage = self._focused_stage()
            if stage.status == StageStatus.ACTIVE:
                stage.status = StageStatus.PAUSED
            self._focus = None
            self.state = TrackerState.IDLE
        line.status = LineStatus.ABANDONED

    # -- reporting -----------------------------------------------------

    def current_focus(self) -> dict | None:
        """Describe the active/interrupted focus for display."""
        if self._focus is None:
            return None
        line_id, stage_id = self._focus
        line = self.lines[line_id]
        stage = line.stage(stage_id)
        return {
            "line_id": line_id,
            "line_name": line.name,
            "stage_id": stage_id,
            "stage_name": stage.name,
            "state": self.state.value,
            "invested_seconds": self.invested_seconds(line_id, stage_id),
            "remaining_seconds": self.remaining_seconds(line_id, stage_id),
        }

    def summary(self, line_id: str) -> dict:
        """Per-line rollup: stages, totals, interruptions, final status."""
        line = self.line(line_id)
        stages = []
        for s in line.stages:
            stages.append({
                "stage_id": s.stage_id,
                "name": s.name,
                "status": s.status.value,
                "estimated_seconds": s.estimated_seconds,
                "invested_seconds": self.invested_seconds(line_id, s.stage_id),
                "remaining_seconds": self.remaining_seconds(line_id, s.stage_id),
                "interruptions": [
                    {"reason": i.reason, "at": i.at,
                     "invested_seconds": i.invested_seconds}
                    for i in s.interruptions
                ],
            })
        return {
            "line_id": line.line_id,
            "name": line.name,
            "status": line.status.value,
            "stages": stages,
            "total_estimated_seconds": sum(
                s.estimated_seconds for s in line.stages),
            "total_invested_seconds": sum(
                st["invested_seconds"] for st in stages),
            "total_interruptions": sum(
                len(s.interruptions) for s in line.stages),
            "completed_stages": sum(
                1 for s in line.stages if s.status == StageStatus.COMPLETED),
        }

    # -- persistence ---------------------------------------------------

    def to_dict(self) -> dict:
        return {
            "state": self.state.value,
            "focus": list(self._focus) if self._focus else None,
            "segment_start": self._segment_start,
            "seq": dict(self._seq),
            "lines": [
                {
                    "line_id": ln.line_id,
                    "name": ln.name,
                    "status": ln.status.value,
                    "stages": [
                        {
                            "stage_id": s.stage_id,
                            "name": s.name,
                            "estimated_seconds": s.estimated_seconds,
                            "status": s.status.value,
                            "invested_seconds": s.invested_seconds,
                            "interruptions": [
                                {"reason": i.reason, "at": i.at,
                                 "invested_seconds": i.invested_seconds}
                                for i in s.interruptions
                            ],
                        }
                        for s in ln.stages
                    ],
                }
                for ln in self.lines.values()
            ],
        }

    @classmethod
    def from_dict(cls, data: dict, clock=None) -> "FocusTracker":
        tracker = cls(clock=clock)
        tracker.state = TrackerState(data["state"])
        tracker._focus = tuple(data["focus"]) if data["focus"] else None
        tracker._segment_start = data["segment_start"]
        tracker._seq = dict(data["seq"])
        for ld in data["lines"]:
            line = WorkLine(
                line_id=ld["line_id"], name=ld["name"],
                status=LineStatus(ld["status"]))
            for sd in ld["stages"]:
                line.stages.append(Stage(
                    stage_id=sd["stage_id"],
                    name=sd["name"],
                    estimated_seconds=sd["estimated_seconds"],
                    status=StageStatus(sd["status"]),
                    invested_seconds=sd["invested_seconds"],
                    interruptions=[Interruption(**i) for i in sd["interruptions"]],
                ))
            tracker.lines[line.line_id] = line
        return tracker

    def interrupt(self, reason: str = "") -> None:
        """Pause timing, keep invested time, record the reason."""
        if self.state != TrackerState.FOCUSING:
            raise FocusError("nothing is currently being timed")
        self._accumulate()
        stage = self._focused_stage()
        stage.status = StageStatus.PAUSED
        stage.interruptions.append(Interruption(
            reason=reason,
            at=self._now(),
            invested_seconds=stage.invested_seconds,
        ))
        self.state = TrackerState.INTERRUPTED

    def resume(self) -> None:
        """Continue the interrupted stage; remaining derives from invested."""
        if self.state != TrackerState.INTERRUPTED:
            raise FocusError("no interrupted stage to resume")
        stage = self._focused_stage()
        stage.status = StageStatus.ACTIVE
        self._segment_start = self._now()
        self.state = TrackerState.FOCUSING

    def switch_stage(self, line_id: str, stage_id: str) -> None:
        """From INTERRUPTED, jump to another stage (same or other line).

        The interrupted stage stays PAUSED (unfinished) with its invested
        time intact; the target starts from its own accumulated invested
        time (zero if never touched).
        """
        if self.state != TrackerState.INTERRUPTED:
            raise FocusError("switching is only allowed from interrupted state")
        line = self.line(line_id)
        if line.status != LineStatus.ACTIVE:
            raise FocusError(f"line {line_id} is {line.status.value}")
        stage = line.stage(stage_id)
        if stage.status not in (StageStatus.PENDING, StageStatus.PAUSED):
            raise FocusError(f"stage {stage_id} is {stage.status.value}")
        stage.status = StageStatus.ACTIVE
        self._focus = (line_id, stage_id)
        self._segment_start = self._now()
        self.state = TrackerState.FOCUSING
