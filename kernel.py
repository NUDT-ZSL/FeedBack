"""Workflow orchestration kernel.

A pure standard-library state-machine engine featuring:

* declarative machine definitions (states, transitions, guards, actions),
* instance lifecycle management and event driving (:meth:`WorkflowEngine.send_event`),
* consistency validation with a full diagnostic list (:meth:`WorkflowEngine.validate`),
* compensation-based rollback when an action fails,
* deterministic logical-clock timers (:meth:`WorkflowEngine.tick`),
* JSON snapshot persistence (:meth:`WorkflowEngine.save` / :meth:`WorkflowEngine.load`).

No networking, no wall-clock dependency: time only advances through
:meth:`WorkflowEngine.tick`, so the engine runs fully offline and is
deterministic under unit tests.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple

from guards import GuardEvaluationError, GuardSyntaxError, evaluate_guard, parse_guard

# An action/compensation receives the current variables dict and returns the
# new variables dict.  It must be pure: all state lives in the dict.
ActionFn = Callable[[Dict[str, Any]], Dict[str, Any]]

# Safety net against zero-delay timer loops (a timer with after=0 whose event
# re-enters the same state would otherwise spin forever inside one tick).
MAX_TIMER_FIRES_PER_TICK = 10000

SNAPSHOT_VERSION = 1


class WorkflowError(Exception):
    """Base class for every error raised by the kernel."""


class DefinitionError(WorkflowError):
    """A state machine definition is structurally invalid."""


class InstanceError(WorkflowError):
    """Instance lifecycle error: unknown/duplicate id, bad variables, ..."""


class ActionError(WorkflowError):
    """An action is unregistered or returned an invalid result."""


class ClockError(WorkflowError):
    """Logical clock misuse: rewind attempt or runaway timer loop."""


class PersistenceError(WorkflowError):
    """A snapshot cannot be saved/loaded or fails consistency checks."""


def _check_variables(variables: Any, exc_type: type, what: str) -> None:
    """Ensure *variables* is a ``dict[str, int | str]`` (bool excluded)."""
    if not isinstance(variables, dict):
        raise exc_type(f"{what} must be an object mapping strings to int/str values")
    for key, value in variables.items():
        if not isinstance(key, str):
            raise exc_type(f"{what}: variable name {key!r} is not a string")
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise exc_type(
                f"{what}: variable {key!r} has unsupported value {value!r} "
                "(only int and str are allowed)"
            )


def _require_non_empty_str(value: Any, what: str, exc_type: type = DefinitionError) -> str:
    if not isinstance(value, str) or not value:
        raise exc_type(f"{what} must be a non-empty string, got {value!r}")
    return value


def _require_int(value: Any, what: str, exc_type: type = DefinitionError) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise exc_type(f"{what} must be an integer, got {value!r}")
    return value


# ---------------------------------------------------------------------------
# Definitions
# ---------------------------------------------------------------------------


@dataclass
class StateDef:
    """One state of a machine."""

    name: str
    terminal: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {"name": self.name, "terminal": self.terminal}


@dataclass
class Transition:
    """One transition: on ``event`` in ``from_state``, if ``guard`` holds,
    run ``actions`` and move to ``to_state``.  Lower ``priority`` matches first."""

    from_state: str
    to_state: str
    event: str
    actions: List[str] = field(default_factory=list)
    guard: Optional[str] = None
    priority: int = 0
    _guard_ast: Any = field(default=None, repr=False, compare=False)

    def guard_allows(self, variables: Dict[str, Any]) -> bool:
        """Evaluate this transition's guard against *variables*.

        A transition without a guard always matches.  Raises
        :class:`GuardSyntaxError` / :class:`GuardEvaluationError` on failure.
        """
        if self.guard is None:
            return True
        if self._guard_ast is None:
            self._guard_ast = parse_guard(self.guard)
        return evaluate_guard(self._guard_ast, variables)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from": self.from_state,
            "to": self.to_state,
            "event": self.event,
            "actions": list(self.actions),
            "guard": self.guard,
            "priority": self.priority,
        }


@dataclass
class TimerDef:
    """A timed transition: ``after`` logical clock units spent in ``state``,
    fire ``event`` on the instance."""

    state: str
    after: int
    event: str

    def to_dict(self) -> Dict[str, Any]:
        return {"state": self.state, "after": self.after, "event": self.event}


@dataclass
class Machine:
    """A state machine definition."""

    machine_id: str
    initial: str
    states: Dict[str, StateDef]
    transitions: List[Transition] = field(default_factory=list)
    timers: List[TimerDef] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "initial": self.initial,
            "states": [s.to_dict() for s in self.states.values()],
            "transitions": [t.to_dict() for t in self.transitions],
            "timers": [t.to_dict() for t in self.timers],
        }


def machine_from_spec(spec: Dict[str, Any]) -> Machine:
    """Build a :class:`Machine` from a plain-dict specification.

    Structural problems (bad types, empty ids, duplicate state names) raise
    :class:`DefinitionError` immediately.  Semantic problems (dangling state
    references, unparseable guards, duplicate priorities) are intentionally
    *not* raised here; they are reported by :func:`validate_machine` so that
    callers can collect every diagnostic at once.
    """
    if not isinstance(spec, dict):
        raise DefinitionError(f"machine spec must be an object, got {spec!r}")
    machine_id = _require_non_empty_str(spec.get("machine_id"), "machine_id")
    initial = spec.get("initial", spec.get("initial_state"))
    initial = _require_non_empty_str(initial, f"machine {machine_id!r}: initial state")

    raw_states = spec.get("states", [])
    if not isinstance(raw_states, list):
        raise DefinitionError(f"machine {machine_id!r}: states must be a list")
    states: Dict[str, StateDef] = {}
    for entry in raw_states:
        if isinstance(entry, str):
            name, terminal = entry, False
        elif isinstance(entry, dict):
            name = entry.get("name")
            terminal = bool(entry.get("terminal", False))
        else:
            raise DefinitionError(
                f"machine {machine_id!r}: state entries must be strings or objects, "
                f"got {entry!r}"
            )
        name = _require_non_empty_str(name, f"machine {machine_id!r}: state name")
        if name in states:
            raise DefinitionError(f"machine {machine_id!r}: duplicate state {name!r}")
        states[name] = StateDef(name, terminal)

    transitions: List[Transition] = []
    raw_transitions = spec.get("transitions", [])
    if not isinstance(raw_transitions, list):
        raise DefinitionError(f"machine {machine_id!r}: transitions must be a list")
    for index, raw in enumerate(raw_transitions):
        where = f"machine {machine_id!r}: transitions[{index}]"
        if not isinstance(raw, dict):
            raise DefinitionError(f"{where} must be an object, got {raw!r}")
        from_state = _require_non_empty_str(raw.get("from"), f"{where}: from")
        to_state = _require_non_empty_str(raw.get("to"), f"{where}: to")
        event = _require_non_empty_str(raw.get("event"), f"{where}: event")
        guard = raw.get("guard")
        if guard is not None and not isinstance(guard, str):
            raise DefinitionError(f"{where}: guard must be a string or null")
        priority = _require_int(raw.get("priority", 0), f"{where}: priority")
        actions: List[str] = []
        if "actions" in raw and raw["actions"] is not None:
            raw_actions = raw["actions"]
            if not isinstance(raw_actions, list):
                raise DefinitionError(f"{where}: actions must be a list of names")
            actions = [
                _require_non_empty_str(a, f"{where}: action name") for a in raw_actions
            ]
        elif raw.get("action") is not None:
            actions = [_require_non_empty_str(raw["action"], f"{where}: action")]
        transitions.append(
            Transition(from_state, to_state, event, actions, guard, priority)
        )

    timers: List[TimerDef] = []
    raw_timers = spec.get("timers", [])
    if not isinstance(raw_timers, list):
        raise DefinitionError(f"machine {machine_id!r}: timers must be a list")
    for index, raw in enumerate(raw_timers):
        where = f"machine {machine_id!r}: timers[{index}]"
        if not isinstance(raw, dict):
            raise DefinitionError(f"{where} must be an object, got {raw!r}")
        state = _require_non_empty_str(raw.get("state"), f"{where}: state")
        event = _require_non_empty_str(raw.get("event"), f"{where}: event")
        after = _require_int(raw.get("after"), f"{where}: after")
        if after < 0:
            raise DefinitionError(f"{where}: after must be >= 0, got {after}")
        timers.append(TimerDef(state, after, event))

    return Machine(machine_id, initial, states, transitions, timers)


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


@dataclass
class Diagnostic:
    """One consistency problem found in a machine definition."""

    machine_id: str
    location: str
    message: str
    severity: str = "error"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "machine_id": self.machine_id,
            "location": self.location,
            "severity": self.severity,
            "message": self.message,
        }


def validate_machine(machine: Machine) -> List[Diagnostic]:
    """Check *machine* for internal consistency.

    Returns *all* diagnostics found, sorted by ``(machine_id, location)`` —
    never just the first problem.  An empty list means the machine is
    consistent.
    """
    diags: List[Diagnostic] = []
    mid = machine.machine_id

    def report(location: str, message: str) -> None:
        diags.append(Diagnostic(mid, location, message))

    if not machine.states:
        report("states", "machine has no states")
    if machine.initial not in machine.states:
        report("initial", f"initial state {machine.initial!r} is not a defined state")

    for index, t in enumerate(machine.transitions):
        location = f"transitions[{index}]"
        if t.from_state not in machine.states:
            report(location, f"transition source state {t.from_state!r} is not defined")
        if t.to_state not in machine.states:
            report(location, f"transition target state {t.to_state!r} is not defined")
        if t.guard is not None:
            try:
                parse_guard(t.guard)
            except GuardSyntaxError as exc:
                report(location, f"guard is not parseable: {exc}")
        state_def = machine.states.get(t.from_state)
        if state_def is not None and state_def.terminal:
            report(
                location,
                f"terminal state {t.from_state!r} must not have outgoing transitions",
            )

    grouped: Dict[Tuple[str, str], Dict[int, int]] = {}
    for t in machine.transitions:
        priorities = grouped.setdefault((t.from_state, t.event), {})
        priorities[t.priority] = priorities.get(t.priority, 0) + 1
    for (from_state, event), priorities in sorted(grouped.items()):
        for priority, count in sorted(priorities.items()):
            if count > 1:
                report(
                    f"transitions(from={from_state!r}, event={event!r})",
                    f"priority {priority} is used by {count} transitions; "
                    "priorities must be unique within one (from, event) pair",
                )

    for index, timer in enumerate(machine.timers):
        if timer.state not in machine.states:
            report(
                f"timers[{index}]",
                f"timer references undefined state {timer.state!r}",
            )

    diags.sort(key=lambda d: (d.machine_id, d.location, d.message))
    return diags


# ---------------------------------------------------------------------------
# Instances and results
# ---------------------------------------------------------------------------


@dataclass
class HistoryEntry:
    """One recorded transition attempt (successful or rolled back)."""

    from_state: str
    to_state: str
    event: str
    timestamp: int
    actions: List[str] = field(default_factory=list)
    action_result: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from": self.from_state,
            "to": self.to_state,
            "event": self.event,
            "timestamp": self.timestamp,
            "actions": list(self.actions),
            "action_result": copy.deepcopy(self.action_result),
        }


@dataclass
class Instance:
    """A running instance of a state machine."""

    instance_id: str
    machine_id: str
    state: str
    variables: Dict[str, Any]
    entered_at: int
    history: List[HistoryEntry] = field(default_factory=list)
    # Timers already fired for the current (state, entered_at) stay, so a
    # timer whose event does not cause a transition is not re-fired forever.
    timers_consumed: List[List[Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "instance_id": self.instance_id,
            "machine_id": self.machine_id,
            "state": self.state,
            "variables": copy.deepcopy(self.variables),
            "entered_at": self.entered_at,
            "history": [entry.to_dict() for entry in self.history],
            "timers_consumed": copy.deepcopy(self.timers_consumed),
        }


@dataclass
class EventResult:
    """Outcome of :meth:`WorkflowEngine.send_event` (or of one timer firing)."""

    ok: bool
    instance_id: str
    state: Optional[str]
    transition: Optional[Dict[str, Any]]
    action_result: Optional[Dict[str, Any]]
    reason: Optional[str]
    compensation_failures: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "instance_id": self.instance_id,
            "state": self.state,
            "transition": copy.deepcopy(self.transition),
            "action_result": copy.deepcopy(self.action_result),
            "reason": self.reason,
            "compensation_failures": list(self.compensation_failures),
        }


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class WorkflowEngine:
    """The orchestration kernel: machines, instances, timers, persistence."""

    def __init__(self) -> None:
        self._machines: Dict[str, Machine] = {}
        self._instances: Dict[str, Instance] = {}
        self._actions: Dict[str, ActionFn] = {}
        self._compensations: Dict[str, ActionFn] = {}
        self._clock: int = 0

    # -- introspection -----------------------------------------------------

    @property
    def clock(self) -> int:
        """Current logical clock value."""
        return self._clock

    def machine_ids(self) -> List[str]:
        """Ids of all defined machines, sorted."""
        return sorted(self._machines)

    # -- definitions ---------------------------------------------------------

    def define_machine(self, spec: Dict[str, Any]) -> Machine:
        """Define a new state machine from a plain-dict *spec*.

        :raises DefinitionError: on structural problems or a duplicate id.
        """
        machine = machine_from_spec(spec)
        if machine.machine_id in self._machines:
            raise DefinitionError(f"machine {machine.machine_id!r} is already defined")
        self._machines[machine.machine_id] = machine
        return machine

    def register_action(self, name: str, fn: ActionFn) -> None:
        """Register an action: a pure function ``variables -> new variables``."""
        _require_non_empty_str(name, "action name")
        if not callable(fn):
            raise DefinitionError(f"action {name!r}: fn must be callable")
        self._actions[name] = fn

    def register_compensation(self, action_name: str, fn: ActionFn) -> None:
        """Register the compensation function for action *action_name*.

        The compensation runs when a later action in the same transition
        fails; it receives the current variables and may return adjusted ones.
        """
        _require_non_empty_str(action_name, "action name")
        if not callable(fn):
            raise DefinitionError(f"compensation for {action_name!r}: fn must be callable")
        self._compensations[action_name] = fn

    def register_timer(self, machine_id: str, state: str, after: int, event: str) -> None:
        """Register a timed transition on an already-defined machine."""
        machine = self._machines.get(machine_id)
        if machine is None:
            raise DefinitionError(f"unknown machine_id {machine_id!r}")
        _require_non_empty_str(state, "timer state")
        _require_non_empty_str(event, "timer event")
        _require_int(after, "timer after")
        if after < 0:
            raise DefinitionError(f"timer after must be >= 0, got {after}")
        if state not in machine.states:
            raise DefinitionError(
                f"machine {machine_id!r}: timer references undefined state {state!r}"
            )
        machine.timers.append(TimerDef(state, after, event))

    # -- instances -----------------------------------------------------------

    def create_instance(
        self,
        machine_id: str,
        instance_id: str,
        variables: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create an instance of *machine_id* in its initial state.

        :raises InstanceError: unknown machine, duplicate/empty id, bad variables.
        :raises DefinitionError: the machine's initial state is undefined.
        """
        machine = self._machines.get(machine_id)
        if machine is None:
            raise InstanceError(f"unknown machine_id {machine_id!r}")
        _require_non_empty_str(instance_id, "instance_id", InstanceError)
        if instance_id in self._instances:
            raise InstanceError(f"instance_id {instance_id!r} already exists")
        if machine.initial not in machine.states:
            raise DefinitionError(
                f"machine {machine_id!r}: initial state {machine.initial!r} is not defined"
            )
        variables = {} if variables is None else dict(variables)
        _check_variables(variables, InstanceError, "variables")
        instance = Instance(
            instance_id=instance_id,
            machine_id=machine_id,
            state=machine.initial,
            variables=variables,
            entered_at=self._clock,
        )
        self._instances[instance_id] = instance
        return self.get_instance(instance_id)

    def get_instance(self, instance_id: str) -> Dict[str, Any]:
        """Return a snapshot dict of one instance.

        :raises InstanceError: if the instance does not exist.
        """
        instance = self._instances.get(instance_id)
        if instance is None:
            raise InstanceError(f"unknown instance_id {instance_id!r}")
        return {
            "instance_id": instance.instance_id,
            "machine_id": instance.machine_id,
            "state": instance.state,
            "variables": copy.deepcopy(instance.variables),
            "entered_at": instance.entered_at,
        }

    def get_history(self, instance_id: str) -> List[Dict[str, Any]]:
        """Return the full transition history of one instance.

        :raises InstanceError: if the instance does not exist.
        """
        instance = self._instances.get(instance_id)
        if instance is None:
            raise InstanceError(f"unknown instance_id {instance_id!r}")
        return [entry.to_dict() for entry in instance.history]

    # -- event driving ---------------------------------------------------------

    def send_event(self, instance_id: str, event: str) -> EventResult:
        """Deliver *event* to one instance and return an :class:`EventResult`.

        Never raises for domain problems — rejection reasons are reported in
        ``EventResult.reason`` (``instance_not_found``, ``terminal_state``,
        ``no_transition``, ``guard_not_matched``, ``guard_error``,
        ``unregistered_action``, ``action_failed``).
        """
        rejected = lambda reason, state=None: EventResult(  # noqa: E731
            ok=False,
            instance_id=instance_id,
            state=state,
            transition=None,
            action_result=None,
            reason=reason,
        )
        instance = self._instances.get(instance_id)
        if instance is None:
            return rejected(f"instance_not_found: {instance_id!r}")
        machine = self._machines.get(instance.machine_id)
        if machine is None:
            return rejected(f"machine_not_found: {instance.machine_id!r}", instance.state)
        if not isinstance(event, str) or not event:
            return rejected("event must be a non-empty string", instance.state)
        state_def = machine.states.get(instance.state)
        if state_def is not None and state_def.terminal:
            return rejected(
                f"terminal_state: {instance.state!r} accepts no further events",
                instance.state,
            )

        candidates = [
            t
            for t in machine.transitions
            if t.from_state == instance.state and t.event == event
        ]
        if not candidates:
            return rejected(
                f"no_transition: no transition from {instance.state!r} on event {event!r}",
                instance.state,
            )
        # Priority ascending; Python's sort is stable, so equal priorities
        # (a definition error reported by validate) keep definition order.
        candidates.sort(key=lambda t: t.priority)

        chosen: Optional[Transition] = None
        for transition in candidates:
            try:
                if transition.guard_allows(instance.variables):
                    chosen = transition
                    break
            except (GuardSyntaxError, GuardEvaluationError) as exc:
                return rejected(f"guard_error: {exc}", instance.state)
        if chosen is None:
            return rejected(
                "guard_not_matched: no transition guard evaluated to true",
                instance.state,
            )
        return self._apply_transition(instance, chosen, event)

    def _apply_transition(
        self, instance: Instance, transition: Transition, event: str
    ) -> EventResult:
        """Run *transition*'s actions and move *instance*, with rollback."""
        prev_state = instance.state
        prev_variables = copy.deepcopy(instance.variables)
        transition_info = transition.to_dict()
        applied: List[str] = []
        try:
            for name in transition.actions:
                fn = self._actions.get(name)
                if fn is None:
                    raise ActionError(f"unregistered_action: {name!r}")
                new_variables = fn(copy.deepcopy(instance.variables))
                _check_variables(
                    new_variables, ActionError, f"result of action {name!r}"
                )
                instance.variables = dict(new_variables)
                applied.append(name)
        except Exception as exc:
            compensation_failures = self._compensate(instance, applied)
            instance.state = prev_state
            instance.variables = prev_variables
            action_result = {
                "status": "failed",
                "error": str(exc),
                "rolled_back": True,
                "compensation_failures": list(compensation_failures),
            }
            instance.history.append(
                HistoryEntry(
                    prev_state,
                    prev_state,
                    event,
                    self._clock,
                    list(transition.actions),
                    action_result,
                )
            )
            reason = (
                str(exc)
                if isinstance(exc, ActionError)
                else f"action_failed: {exc}"
            )
            return EventResult(
                ok=False,
                instance_id=instance.instance_id,
                state=instance.state,
                transition=transition_info,
                action_result=action_result,
                reason=reason,
                compensation_failures=compensation_failures,
            )

        instance.state = transition.to_state
        instance.entered_at = self._clock
        instance.timers_consumed.clear()
        action_result = {"status": "ok", "actions": list(applied)}
        instance.history.append(
            HistoryEntry(
                prev_state,
                transition.to_state,
                event,
                self._clock,
                list(transition.actions),
                action_result,
            )
        )
        return EventResult(
            ok=True,
            instance_id=instance.instance_id,
            state=instance.state,
            transition=transition_info,
            action_result=action_result,
            reason=None,
        )

    def _compensate(self, instance: Instance, applied: List[str]) -> List[str]:
        """Run compensations for *applied* actions in reverse order.

        A failing compensation is recorded and the remaining ones are still
        attempted.  Returns the list of ``"action: error"`` failure strings.
        """
        failures: List[str] = []
        for name in reversed(applied):
            compensation = self._compensations.get(name)
            if compensation is None:
                continue
            try:
                compensation(copy.deepcopy(instance.variables))
            except Exception as exc:  # keep compensating the rest
                failures.append(f"{name}: {exc}")
        return failures

    # -- logical clock and timers --------------------------------------------

    def tick(self, n: int = 1) -> List[EventResult]:
        """Advance the logical clock by *n* units and fire all due timers.

        Timers fire in deterministic order: ascending deadline, ties broken
        by ascending ``instance_id``.  Returns one :class:`EventResult` per
        fired timer, in firing order.

        :raises ClockError: if *n* is negative (clock rewind) or a zero-delay
            timer loop exceeds ``MAX_TIMER_FIRES_PER_TICK`` firings.
        """
        _require_int(n, "tick(n)", ClockError)
        if n < 0:
            raise ClockError(
                f"tick(n): n must be >= 0, got {n}; the logical clock cannot rewind"
            )
        self._clock += n
        fired: List[EventResult] = []
        for _ in range(MAX_TIMER_FIRES_PER_TICK):
            due = self._due_timers()
            if not due:
                return fired
            _deadline, instance_id, event = due[0]
            instance = self._instances[instance_id]
            # Mark as consumed before firing: if the event does not move the
            # instance (rejected or missing transition) it must not re-fire.
            instance.timers_consumed.append([instance.state, instance.entered_at, event])
            fired.append(self.send_event(instance_id, event))
        raise ClockError(
            f"more than {MAX_TIMER_FIRES_PER_TICK} timer firings in one tick; "
            "check for zero-delay timers whose event re-enters the same state"
        )

    def _due_timers(self) -> List[Tuple[int, str, str]]:
        """All due timers as ``(deadline, instance_id, event)``, sorted."""
        due: List[Tuple[int, str, str]] = []
        for instance in self._instances.values():
            machine = self._machines.get(instance.machine_id)
            if machine is None:
                continue
            for timer in machine.timers:
                if timer.state != instance.state:
                    continue
                if [instance.state, instance.entered_at, timer.event] in (
                    instance.timers_consumed
                ):
                    continue
                deadline = instance.entered_at + timer.after
                if deadline <= self._clock:
                    due.append((deadline, instance.instance_id, timer.event))
        due.sort(key=lambda item: (item[0], item[1]))
        return due

    # -- validation ------------------------------------------------------------

    def validate(self, machine_id: str) -> List[Diagnostic]:
        """Return all consistency diagnostics for *machine_id*.

        :raises DefinitionError: if the machine does not exist.
        """
        machine = self._machines.get(machine_id)
        if machine is None:
            raise DefinitionError(f"unknown machine_id {machine_id!r}")
        return validate_machine(machine)

    # -- persistence -------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Return the full engine state as a JSON-serializable dict."""
        return {
            "version": SNAPSHOT_VERSION,
            "clock": self._clock,
            "machines": [self._machines[k].to_dict() for k in sorted(self._machines)],
            "instances": [self._instances[k].to_dict() for k in sorted(self._instances)],
        }

    def save(self, path: str) -> None:
        """Write :meth:`snapshot` to *path* as JSON.

        :raises PersistenceError: if the file cannot be written.
        """
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(self.snapshot(), handle, ensure_ascii=False, indent=2)
                handle.write("\n")
        except OSError as exc:
            raise PersistenceError(f"cannot write snapshot to {path!r}: {exc}") from exc

    def load(self, path: str) -> None:
        """Rebuild engine state from the JSON snapshot at *path*.

        The snapshot is fully validated before anything is replaced: machine
        consistency (same checks as :meth:`validate`), unique instance ids,
        existing current/history states, serializable variables and valid
        timer references.  On any problem a :class:`PersistenceError` is
        raised and the engine is left untouched.  Registered actions and
        compensations are code, not data, so they survive a load.
        """
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except OSError as exc:
            raise PersistenceError(f"cannot read snapshot {path!r}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise PersistenceError(f"snapshot {path!r} is not valid JSON: {exc}") from exc
        machines, instances, clock = self._restore(data, source=path)
        self._machines = machines
        self._instances = instances
        self._clock = clock

    @staticmethod
    def _restore(
        data: Any, source: str = "<snapshot>"
    ) -> Tuple[Dict[str, Machine], Dict[str, Instance], int]:
        """Parse and fully validate snapshot *data*; never mutates the engine."""

        def fail(message: str) -> PersistenceError:
            return PersistenceError(f"{source}: {message}")

        if not isinstance(data, dict):
            raise fail(f"top level must be a JSON object, got {type(data).__name__}")
        for key in ("version", "clock", "machines", "instances"):
            if key not in data:
                raise fail(f"missing required field {key!r}")
        if data["version"] != SNAPSHOT_VERSION:
            raise fail(
                f"unsupported snapshot version {data['version']!r} "
                f"(expected {SNAPSHOT_VERSION})"
            )
        clock = data["clock"]
        if isinstance(clock, bool) or not isinstance(clock, int) or clock < 0:
            raise fail(f"clock must be a non-negative integer, got {clock!r}")

        raw_machines = data["machines"]
        if not isinstance(raw_machines, list):
            raise fail("machines must be a list")
        machines: Dict[str, Machine] = {}
        for spec in raw_machines:
            try:
                machine = machine_from_spec(spec)
            except DefinitionError as exc:
                raise fail(f"invalid machine definition: {exc}") from exc
            if machine.machine_id in machines:
                raise fail(f"duplicate machine_id {machine.machine_id!r}")
            machines[machine.machine_id] = machine
        for machine_id in sorted(machines):
            diagnostics = validate_machine(machines[machine_id])
            if diagnostics:
                details = "; ".join(
                    f"{d.location}: {d.message}" for d in diagnostics
                )
                raise fail(f"machine {machine_id!r} is inconsistent: {details}")

        raw_instances = data["instances"]
        if not isinstance(raw_instances, list):
            raise fail("instances must be a list")
        instances: Dict[str, Instance] = {}
        for index, raw in enumerate(raw_instances):
            where = f"instances[{index}]"
            if not isinstance(raw, dict):
                raise fail(f"{where} must be an object, got {raw!r}")
            for key in ("instance_id", "machine_id", "state", "variables",
                        "history", "entered_at"):
                if key not in raw:
                    raise fail(f"{where}: missing required field {key!r}")
            instance_id = raw["instance_id"]
            if not isinstance(instance_id, str) or not instance_id:
                raise fail(f"{where}: instance_id must be a non-empty string")
            if instance_id in instances:
                raise fail(f"duplicate instance_id {instance_id!r}")
            machine = machines.get(raw["machine_id"])
            if machine is None:
                raise fail(
                    f"instance {instance_id!r}: unknown machine_id {raw['machine_id']!r}"
                )
            state = raw["state"]
            if state not in machine.states:
                raise fail(
                    f"instance {instance_id!r}: current state {state!r} is not "
                    f"defined in machine {machine.machine_id!r}"
                )
            variables = raw["variables"]
            try:
                _check_variables(variables, PersistenceError,
                                 f"instance {instance_id!r}: variables")
            except PersistenceError as exc:
                raise fail(str(exc)) from exc
            entered_at = raw["entered_at"]
            if isinstance(entered_at, bool) or not isinstance(entered_at, int):
                raise fail(f"instance {instance_id!r}: entered_at must be an integer")

            raw_history = raw["history"]
            if not isinstance(raw_history, list):
                raise fail(f"instance {instance_id!r}: history must be a list")
            history: List[HistoryEntry] = []
            for h_index, raw_entry in enumerate(raw_history):
                h_where = f"instance {instance_id!r}: history[{h_index}]"
                if not isinstance(raw_entry, dict):
                    raise fail(f"{h_where} must be an object")
                for key in ("from", "to", "event", "timestamp"):
                    if key not in raw_entry:
                        raise fail(f"{h_where}: missing required field {key!r}")
                for key in ("from", "to"):
                    if raw_entry[key] not in machine.states:
                        raise fail(
                            f"{h_where}: state {raw_entry[key]!r} is not defined "
                            f"in machine {machine.machine_id!r}"
                        )
                timestamp = raw_entry["timestamp"]
                if isinstance(timestamp, bool) or not isinstance(timestamp, int):
                    raise fail(f"{h_where}: timestamp must be an integer")
                actions = raw_entry.get("actions", [])
                if not isinstance(actions, list) or not all(
                    isinstance(a, str) for a in actions
                ):
                    raise fail(f"{h_where}: actions must be a list of strings")
                history.append(
                    HistoryEntry(
                        from_state=raw_entry["from"],
                        to_state=raw_entry["to"],
                        event=raw_entry["event"],
                        timestamp=timestamp,
                        actions=list(actions),
                        action_result=raw_entry.get("action_result"),
                    )
                )

            timers_consumed = raw.get("timers_consumed", [])
            if not isinstance(timers_consumed, list):
                raise fail(f"instance {instance_id!r}: timers_consumed must be a list")
            instances[instance_id] = Instance(
                instance_id=instance_id,
                machine_id=machine.machine_id,
                state=state,
                variables=dict(variables),
                entered_at=entered_at,
                history=history,
                timers_consumed=copy.deepcopy(timers_consumed),
            )
        return machines, instances, clock
