"""Multi-queue work-stealing executor for offline batch processing.

This module implements a dependency-aware task executor built only on the
Python standard library:

* Tasks declare their dependencies; the executor schedules them in
  dependency-ready order across a fixed pool of worker threads.
* Each worker owns a local double-ended queue.  Workers pop from the head of
  their own queue and, when idle, steal from the *tail* of other queues.
* Tasks support per-attempt timeouts, cooperative cancellation through a
  cancellation token, and automatic retries with a configurable limit.
* The whole execution state can be persisted to / restored from a JSON
  snapshot file.

Cancellation model
------------------
Python threads cannot be killed forcibly, so timeouts and cancellation are
*cooperative*: the executor sets a :class:`CancellationToken` and waits a
short grace period.  Payloads that want to be interruptible should poll
:func:`current_cancel_token` and return (or raise) promptly once it is
cancelled.  A payload that ignores the token is abandoned after the grace
period (its daemon thread is orphaned) and the task is still marked as
timed out / cancelled.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass
from enum import Enum
from typing import Any, Callable, Deque, Dict, Iterable, List, Optional, Set

__all__ = [
    "Task",
    "TaskState",
    "TERMINAL_STATES",
    "CancellationToken",
    "current_cancel_token",
    "WorkStealingExecutor",
    "Executor",
    "ExecutorError",
    "ValidationError",
    "CycleError",
    "DuplicateTaskError",
    "UnknownTaskError",
    "StateError",
    "SnapshotError",
]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ExecutorError(Exception):
    """Base class for all executor-related errors."""


class ValidationError(ExecutorError, ValueError):
    """A task definition or a command argument is invalid."""


class CycleError(ValidationError):
    """Submitting these tasks would introduce a dependency cycle.

    The :attr:`cycle` attribute holds the cycle as a list of task ids,
    with the first id repeated at the end (e.g. ``["a", "b", "c", "a"]``).
    """

    def __init__(self, cycle: Iterable[str]) -> None:
        self.cycle: List[str] = list(cycle)
        super().__init__("dependency cycle detected: " + " -> ".join(self.cycle))


class DuplicateTaskError(ValidationError):
    """A task with the same task_id has already been submitted."""


class UnknownTaskError(ExecutorError, KeyError):
    """Referenced task_id does not exist in this executor."""

    def __init__(self, task_id: str) -> None:
        self.task_id = task_id
        super().__init__(f"unknown task_id: {task_id!r}")

    def __str__(self) -> str:  # KeyError would add extra quoting
        return str(self.args[0])


class StateError(ExecutorError):
    """The operation is not allowed in the executor's current state."""


class SnapshotError(ExecutorError):
    """A snapshot file is missing, corrupt, or fails consistency checks."""


# ---------------------------------------------------------------------------
# Task states
# ---------------------------------------------------------------------------


class TaskState(str, Enum):
    """Lifecycle states of a task."""

    PENDING = "pending"      # waiting for dependencies
    READY = "ready"          # queued on some worker's local queue
    RUNNING = "running"      # currently executing on a worker
    SUCCESS = "success"      # finished successfully, result available
    FAILED = "failed"        # failed permanently (retries exhausted)
    TIMEOUT = "timeout"      # timed out permanently (retries exhausted)
    CANCELLED = "cancelled"  # cancelled before completion
    SKIPPED = "skipped"      # never ran because a dependency did not succeed


TERMINAL_STATES: Set[TaskState] = {
    TaskState.SUCCESS,
    TaskState.FAILED,
    TaskState.TIMEOUT,
    TaskState.CANCELLED,
    TaskState.SKIPPED,
}

_STATE_VERBS = {
    TaskState.FAILED: "failed",
    TaskState.TIMEOUT: "timed out",
    TaskState.CANCELLED: "was cancelled",
    TaskState.SKIPPED: "was skipped",
}


# ---------------------------------------------------------------------------
# Cancellation token
# ---------------------------------------------------------------------------


class CancellationToken:
    """Cooperative cancellation flag handed to the running payload.

    Payloads check :attr:`is_cancelled` (or :meth:`wait`) periodically and
    abort themselves once the token has been cancelled by the executor.
    """

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        """Set the token; idempotent and thread-safe."""
        self._event.set()

    @property
    def is_cancelled(self) -> bool:
        """True once :meth:`cancel` has been called."""
        return self._event.is_set()

    def wait(self, timeout: Optional[float] = None) -> bool:
        """Block until the token is cancelled or ``timeout`` seconds elapse."""
        return self._event.wait(timeout)


_thread_local = threading.local()


def current_cancel_token() -> Optional[CancellationToken]:
    """Return the cancellation token of the task running on this thread.

    Intended to be called from inside a payload function.  Returns ``None``
    when called outside of task execution.
    """
    return getattr(_thread_local, "token", None)


# ---------------------------------------------------------------------------
# Task definition
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Task:
    """An immutable task definition.

    :param task_id: unique, non-empty identifier.
    :param payload: zero-argument callable returning a JSON-serializable value.
    :param deps: ids of tasks that must succeed before this one runs
        (no duplicates, no self-dependency).
    :param timeout: optional per-attempt timeout in seconds; must be > 0.
    :param max_retries: how many times a failed/timed-out attempt is retried
        (0 means a single attempt).
    """

    task_id: str
    payload: Callable[[], Any]
    deps: Iterable[str] = frozenset()
    timeout: Optional[float] = None
    max_retries: int = 0

    def __post_init__(self) -> None:
        if not isinstance(self.task_id, str) or not self.task_id:
            raise ValidationError("task_id must be a non-empty string")
        if not callable(self.payload):
            raise ValidationError(f"task {self.task_id!r}: payload must be callable")
        seen: Set[str] = set()
        for dep in self.deps:
            if not isinstance(dep, str) or not dep:
                raise ValidationError(
                    f"task {self.task_id!r}: dependency ids must be non-empty strings, got {dep!r}"
                )
            if dep in seen:
                raise ValidationError(
                    f"task {self.task_id!r}: duplicate dependency {dep!r}"
                )
            seen.add(dep)
        if self.task_id in seen:
            raise ValidationError(f"task {self.task_id!r} cannot depend on itself")
        object.__setattr__(self, "deps", frozenset(seen))
        if self.timeout is not None:
            if isinstance(self.timeout, bool) or not isinstance(self.timeout, (int, float)):
                raise ValidationError(
                    f"task {self.task_id!r}: timeout must be a positive number of seconds or None"
                )
            if self.timeout <= 0:
                raise ValidationError(
                    f"task {self.task_id!r}: timeout must be > 0 seconds, got {self.timeout}"
                )
        if (
            isinstance(self.max_retries, bool)
            or not isinstance(self.max_retries, int)
            or self.max_retries < 0
        ):
            raise ValidationError(
                f"task {self.task_id!r}: max_retries must be a non-negative integer"
            )


def _missing_payload() -> Any:
    """Placeholder payload for tasks restored from a snapshot."""
    raise StateError("task payload is not available (task was loaded from a snapshot)")


class _Record:
    """Mutable per-task runtime state (internal)."""

    __slots__ = (
        "task",
        "state",
        "result",
        "error",
        "attempts",
        "skip_reason",
        "remaining",
        "token",
        "cancel_requested",
    )

    def __init__(self, task: Task) -> None:
        self.task = task
        self.state = TaskState.PENDING
        self.result: Any = None
        self.error: Optional[Dict[str, str]] = None
        self.attempts = 0
        self.skip_reason: Optional[str] = None
        self.remaining = len(task.deps)
        self.token: Optional[CancellationToken] = None
        self.cancel_requested = False


class _AttemptResult:
    """Holds the outcome of a single payload invocation (internal)."""

    __slots__ = ("value", "exc")

    def __init__(self) -> None:
        self.value: Any = None
        self.exc: Optional[BaseException] = None


def _run_payload(payload: Callable[[], Any], token: CancellationToken, holder: _AttemptResult) -> None:
    """Thread target: run the payload, capturing its result or exception."""
    _thread_local.token = token
    try:
        holder.value = payload()
    except BaseException as exc:  # noqa: BLE001 - stored, not swallowed
        holder.exc = exc
    finally:
        _thread_local.token = None


def _find_cycle(graph: Dict[str, Iterable[str]]) -> Optional[List[str]]:
    """Return one dependency cycle of ``graph`` as a list of task ids, or None."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {node: WHITE for node in graph}
    stack: List[str] = []

    def dfs(node: str) -> Optional[List[str]]:
        color[node] = GRAY
        stack.append(node)
        for nxt in sorted(graph[node]):
            if nxt not in color:
                continue
            if color[nxt] == GRAY:
                idx = stack.index(nxt)
                return stack[idx:] + [nxt]
            if color[nxt] == WHITE:
                found = dfs(nxt)
                if found:
                    return found
        stack.pop()
        color[node] = BLACK
        return None

    for node in sorted(graph):
        if color[node] == WHITE:
            found = dfs(node)
            if found:
                return found
    return None


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------


class WorkStealingExecutor:
    """Dependency-aware, multi-queue, work-stealing batch executor.

    :param workers: number of worker threads (>= 1), each with its own queue.
    :param cancel_grace: seconds to wait for a payload to exit after its
        cancellation token has been set (timeout or cancel), before the
        executor abandons the attempt.

    Typical usage::

        ex = WorkStealingExecutor(workers=4)
        ex.submit(Task("a", lambda: 1))
        ex.submit(Task("b", lambda: 2, deps=["a"]))
        ex.run()
        assert ex.get_result("b")["result"] == 2

    An executor instance runs once: after :meth:`run` returns, no further
    tasks may be submitted and :meth:`run` may not be called again.
    """

    def __init__(self, workers: int = 4, cancel_grace: float = 0.5) -> None:
        if isinstance(workers, bool) or not isinstance(workers, int) or workers < 1:
            raise ValidationError(f"workers must be a positive integer, got {workers!r}")
        if cancel_grace < 0:
            raise ValidationError("cancel_grace must be >= 0")
        self._workers = workers
        self._cancel_grace = float(cancel_grace)
        self._cond = threading.Condition()
        self._records: Dict[str, _Record] = {}
        self._dependents: Dict[str, Set[str]] = {}
        self._queues: List[Deque[str]] = [deque() for _ in range(workers)]
        self._qlocks = [threading.Lock() for _ in range(workers)]
        self._rr = 0  # round-robin cursor for placing newly ready tasks
        self._non_terminal = 0
        self._started = False
        self._shutdown = False
        self._finished = False
        self._threads: List[threading.Thread] = []
        self._executed = [0] * workers
        self._steals = 0

    # ------------------------------------------------------------------
    # Submission
    # ------------------------------------------------------------------

    def submit(self, task: Task) -> None:
        """Submit a single task.  See :meth:`submit_many` for semantics."""
        self.submit_many([task])

    def submit_many(self, tasks: Iterable[Task]) -> None:
        """Submit a batch of tasks atomically.

        Either every task is accepted or (on any validation error) none is.
        Dependencies must reference tasks already submitted or tasks within
        the same batch; unknown ids raise :class:`UnknownTaskError` and
        dependency cycles raise :class:`CycleError`.
        """
        batch = list(tasks)
        if not batch:
            return
        with self._cond:
            if self._finished or self._shutdown:
                raise StateError("executor has finished; cannot submit more tasks")
            for task in batch:
                if not isinstance(task, Task):
                    raise ValidationError(f"expected Task instances, got {type(task).__name__}")

            seen: Set[str] = set()
            for task in batch:
                if task.task_id in seen:
                    raise DuplicateTaskError(
                        f"duplicate task_id {task.task_id!r} within the batch"
                    )
                seen.add(task.task_id)
                if task.task_id in self._records:
                    raise DuplicateTaskError(f"task {task.task_id!r} has already been submitted")

            known = set(self._records) | seen
            for task in batch:
                for dep in task.deps:
                    if dep not in known:
                        raise UnknownTaskError(dep)

            graph: Dict[str, Iterable[str]] = {
                tid: rec.task.deps for tid, rec in self._records.items()
            }
            for task in batch:
                graph[task.task_id] = task.deps
            cycle = _find_cycle(graph)
            if cycle:
                raise CycleError(cycle)

            # --- commit: only dict/deque operations below, nothing here
            # may fail.  All validation happened above, so a raised error
            # always leaves existing tasks, counters, _rr and queues
            # completely untouched, and retrying the same batch fails (or
            # succeeds) identically.
            for task in batch:
                self._records[task.task_id] = _Record(task)
                self._dependents[task.task_id] = set()
            for task in batch:
                for dep in task.deps:
                    self._dependents[dep].add(task.task_id)
            self._non_terminal += len(batch)

            # Remaining-dependency counts: pure arithmetic on current
            # states (a dependency that already succeeded does not count).
            for task in batch:
                rec = self._records[task.task_id]
                rec.remaining = sum(
                    1
                    for dep in task.deps
                    if self._records[dep].state is not TaskState.SUCCESS
                )

            # Enqueue tasks whose dependencies are all satisfied.  This is
            # the only place _rr advances, and it is past every validation
            # failure path.
            for task in batch:
                rec = self._records[task.task_id]
                if rec.remaining == 0:
                    rec.state = TaskState.READY
                    self._enqueue_locked(task.task_id)

            # --- post-commit: cascade skips for dependencies that are
            # already terminal (e.g. cancelled before this submission).
            # Only tasks of this batch can be affected: existing tasks
            # were submitted earlier and can never depend on new ones.
            for task in batch:
                rec = self._records[task.task_id]
                if rec.state is not TaskState.PENDING:
                    continue
                for dep in sorted(task.deps):
                    dep_state = self._records[dep].state
                    if dep_state in TERMINAL_STATES:
                        self._mark_skipped_locked(
                            rec, f"dependency {dep!r} {_STATE_VERBS[dep_state]}"
                        )
                        break
            self._cond.notify_all()

    # ------------------------------------------------------------------
    # Cancellation
    # ------------------------------------------------------------------

    def cancel(self, task_id: str) -> None:
        """Cancel a task that has not finished yet.

        * Pending/ready tasks are marked ``cancelled`` immediately.
        * A running task's cancellation token is set; the task becomes
          ``cancelled`` once its payload exits (or the grace period elapses).

        Downstream tasks are marked ``skipped``.  Cancelling a finished task
        raises :class:`StateError`; an unknown id raises
        :class:`UnknownTaskError`.
        """
        with self._cond:
            rec = self._records.get(task_id)
            if rec is None:
                raise UnknownTaskError(task_id)
            if rec.state in TERMINAL_STATES:
                raise StateError(
                    f"task {task_id!r} already finished with state {rec.state.value!r}"
                )
            if rec.state is TaskState.RUNNING:
                rec.cancel_requested = True
                if rec.token is not None:
                    rec.token.cancel()
            else:
                rec.state = TaskState.CANCELLED
                self._cascade_terminal_locked(rec)
            self._cond.notify_all()

    # ------------------------------------------------------------------
    # Running
    # ------------------------------------------------------------------

    def run(self) -> None:
        """Start the workers and block until every task is terminal.

        Returns when all tasks are successful, failed, timed out, cancelled
        or skipped -- no task can be left behind in the waiting area.
        """
        with self._cond:
            if self._finished:
                raise StateError("run() has already completed; executors are single-use")
            stuck = [
                tid
                for tid, rec in self._records.items()
                if rec.state not in TERMINAL_STATES and rec.task.payload is _missing_payload
            ]
            if stuck:
                raise StateError(
                    "cannot run: tasks loaded from a snapshot have no payload: "
                    + ", ".join(sorted(stuck))
                )
            if not self._started:
                self._started = True
                self._threads = [
                    threading.Thread(
                        target=self._worker_loop,
                        args=(i,),
                        name=f"ws-worker-{i}",
                        daemon=True,
                    )
                    for i in range(self._workers)
                ]
                for thread in self._threads:
                    thread.start()
            self._cond.wait_for(lambda: self._non_terminal == 0)
            self._shutdown = True
            self._cond.notify_all()
        for thread in self._threads:
            thread.join()
        with self._cond:
            self._finished = True

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def get_result(self, task_id: str) -> Dict[str, Any]:
        """Return the outcome of one task.

        The mapping has keys ``task_id``, ``state``, ``attempts``,
        ``result`` (only meaningful when state is ``success``), ``error``
        (``{"type", "message"}`` for failed/timed-out tasks, else None) and
        ``skip_reason`` (for skipped tasks, else None).
        """
        with self._cond:
            rec = self._records.get(task_id)
            if rec is None:
                raise UnknownTaskError(task_id)
            return {
                "task_id": task_id,
                "state": rec.state.value,
                "attempts": rec.attempts,
                "result": rec.result,
                "error": rec.error,
                "skip_reason": rec.skip_reason,
            }

    def get_state(self) -> Dict[str, Any]:
        """Return a snapshot of the whole executor state.

        Includes every task's state, per-worker executed-attempt counts, the
        number of steals, and aggregate counts per terminal state.
        """
        with self._cond:
            counts = {state.value: 0 for state in TaskState}
            for rec in self._records.values():
                counts[rec.state.value] += 1
            return {
                "tasks": {
                    tid: {
                        "state": rec.state.value,
                        "attempts": rec.attempts,
                        "error": rec.error,
                        "skip_reason": rec.skip_reason,
                    }
                    for tid, rec in self._records.items()
                },
                "workers": [
                    {"worker_id": i, "executed": self._executed[i]}
                    for i in range(self._workers)
                ],
                "steals": self._steals,
                "counts": counts,
                "succeeded": counts[TaskState.SUCCESS.value],
                "failed": counts[TaskState.FAILED.value],
                "timed_out": counts[TaskState.TIMEOUT.value],
                "cancelled": counts[TaskState.CANCELLED.value],
                "skipped": counts[TaskState.SKIPPED.value],
                "total": len(self._records),
                "finished": self._finished,
            }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Return the executor state as a JSON-serializable mapping."""
        with self._cond:
            tasks = []
            for tid in sorted(self._records):
                rec = self._records[tid]
                tasks.append(
                    {
                        "task_id": tid,
                        "deps": sorted(rec.task.deps),
                        "timeout": rec.task.timeout,
                        "max_retries": rec.task.max_retries,
                        "state": rec.state.value,
                        "attempts": rec.attempts,
                        "result": rec.result,
                        "error": rec.error,
                        "skip_reason": rec.skip_reason,
                    }
                )
            return {
                "version": 1,
                "config": {"workers": self._workers, "cancel_grace": self._cancel_grace},
                "tasks": tasks,
            }

    def save(self, path: str) -> None:
        """Write task definitions, dependencies, states and results to ``path``.

        Payloads are callables and therefore *not* persisted; a snapshot
        restores definitions and outcomes, not the ability to re-run.
        """
        data = self.snapshot()
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
        except OSError as exc:
            raise SnapshotError(f"cannot write snapshot to {path!r}: {exc}") from exc

    @classmethod
    def load(cls, path: str) -> "WorkStealingExecutor":
        """Rebuild an executor from a snapshot file, validating consistency.

        Raises :class:`SnapshotError` with a precise message when the file
        is unreadable, is not valid JSON, misses required fields, contains
        duplicate task ids, references unknown dependencies, contains a
        dependency cycle, or holds illegal state values.
        """
        try:
            with open(path, "r", encoding="utf-8") as fh:
                text = fh.read()
        except OSError as exc:
            raise SnapshotError(f"cannot read snapshot file {path!r}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise SnapshotError(f"snapshot file {path!r} is not valid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise SnapshotError("snapshot root must be a JSON object")
        if data.get("version") != 1:
            raise SnapshotError(f"unsupported snapshot version: {data.get('version')!r}")
        raw_tasks = data.get("tasks")
        if not isinstance(raw_tasks, list):
            raise SnapshotError("snapshot is missing the 'tasks' list")
        config = data.get("config") or {}
        if not isinstance(config, dict):
            raise SnapshotError("snapshot 'config' must be an object")
        workers = config.get("workers", 4)
        if isinstance(workers, bool) or not isinstance(workers, int) or workers < 1:
            raise SnapshotError(f"snapshot has invalid worker count: {workers!r}")
        grace = config.get("cancel_grace", 0.5)
        if isinstance(grace, bool) or not isinstance(grace, (int, float)) or grace < 0:
            raise SnapshotError(f"snapshot has invalid cancel_grace: {grace!r}")

        required = (
            "task_id",
            "deps",
            "timeout",
            "max_retries",
            "state",
            "attempts",
            "result",
            "error",
            "skip_reason",
        )
        valid_states = {state.value for state in TaskState}
        parsed: Dict[str, Dict[str, Any]] = {}
        for index, raw in enumerate(raw_tasks):
            if not isinstance(raw, dict):
                raise SnapshotError(f"snapshot task #{index} is not a JSON object")
            for field_name in required:
                if field_name not in raw:
                    raise SnapshotError(
                        f"snapshot task #{index}: missing required field {field_name!r}"
                    )
            tid = raw["task_id"]
            if not isinstance(tid, str) or not tid:
                raise SnapshotError(f"snapshot task #{index}: 'task_id' must be a non-empty string")
            if tid in parsed:
                raise SnapshotError(f"duplicate task_id {tid!r} in snapshot")
            deps = raw["deps"]
            if not isinstance(deps, list) or not all(isinstance(d, str) and d for d in deps):
                raise SnapshotError(f"task {tid!r}: 'deps' must be a list of non-empty strings")
            if len(set(deps)) != len(deps):
                raise SnapshotError(f"task {tid!r}: duplicate entries in 'deps'")
            if tid in deps:
                raise SnapshotError(f"task {tid!r}: task cannot depend on itself")
            timeout = raw["timeout"]
            if timeout is not None and (
                isinstance(timeout, bool)
                or not isinstance(timeout, (int, float))
                or timeout <= 0
            ):
                raise SnapshotError(f"task {tid!r}: 'timeout' must be null or a positive number")
            max_retries = raw["max_retries"]
            if isinstance(max_retries, bool) or not isinstance(max_retries, int) or max_retries < 0:
                raise SnapshotError(f"task {tid!r}: 'max_retries' must be a non-negative integer")
            attempts = raw["attempts"]
            if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 0:
                raise SnapshotError(f"task {tid!r}: 'attempts' must be a non-negative integer")
            if raw["state"] not in valid_states:
                raise SnapshotError(
                    f"task {tid!r}: illegal state {raw['state']!r}; "
                    f"expected one of {sorted(valid_states)}"
                )
            error = raw["error"]
            if error is not None and (
                not isinstance(error, dict)
                or not isinstance(error.get("type"), str)
                or not isinstance(error.get("message"), str)
            ):
                raise SnapshotError(
                    f"task {tid!r}: 'error' must be null or an object with 'type' and 'message'"
                )
            if raw["skip_reason"] is not None and not isinstance(raw["skip_reason"], str):
                raise SnapshotError(f"task {tid!r}: 'skip_reason' must be null or a string")
            parsed[tid] = raw

        for tid, raw in parsed.items():
            for dep in raw["deps"]:
                if dep not in parsed:
                    raise SnapshotError(f"task {tid!r} depends on unknown task {dep!r}")
        graph = {tid: raw["deps"] for tid, raw in parsed.items()}
        cycle = _find_cycle(graph)
        if cycle:
            raise SnapshotError("dependency cycle in snapshot: " + " -> ".join(cycle))

        executor = cls(workers=workers, cancel_grace=float(grace))
        with executor._cond:
            for tid, raw in parsed.items():
                task = Task(
                    task_id=tid,
                    payload=_missing_payload,
                    deps=raw["deps"],
                    timeout=raw["timeout"],
                    max_retries=raw["max_retries"],
                )
                rec = _Record(task)
                rec.state = TaskState(raw["state"])
                rec.attempts = raw["attempts"]
                rec.result = raw["result"]
                rec.error = raw["error"]
                rec.skip_reason = raw["skip_reason"]
                executor._records[tid] = rec
                executor._dependents[tid] = set()
            for tid, raw in parsed.items():
                for dep in raw["deps"]:
                    executor._dependents[dep].add(tid)
            for tid, raw in parsed.items():
                rec = executor._records[tid]
                rec.remaining = sum(
                    1
                    for dep in raw["deps"]
                    if executor._records[dep].state is not TaskState.SUCCESS
                )
                if rec.state not in TERMINAL_STATES:
                    executor._non_terminal += 1
        return executor

    # ------------------------------------------------------------------
    # Internal: queue operations
    # ------------------------------------------------------------------

    def _enqueue_locked(self, task_id: str) -> None:
        """Place a ready task on the next worker queue (round-robin).

        Must be called with ``self._cond`` held.
        """
        idx = self._rr
        self._rr = (self._rr + 1) % self._workers
        with self._qlocks[idx]:
            self._queues[idx].append(task_id)

    def _requeue_locked(self, worker_id: int, rec: _Record) -> None:
        """Send a task back to its worker's queue for a retry attempt."""
        rec.state = TaskState.READY
        rec.token = None
        with self._qlocks[worker_id]:
            self._queues[worker_id].append(rec.task.task_id)

    def _pop_own(self, worker_id: int) -> Optional[str]:
        """Pop a task from the head of the worker's own queue."""
        with self._qlocks[worker_id]:
            if self._queues[worker_id]:
                return self._queues[worker_id].popleft()
        return None

    def _steal(self, worker_id: int) -> Optional[str]:
        """Steal one task from the tail of another worker's queue.

        Lock-order rule: only the target queue's lock is held while
        popping; the steals counter is updated under ``self._cond``
        *after* the queue lock has been released.  Every path in the
        executor therefore takes locks in the single global order
        ``_cond`` -> queue lock, so no circular wait is possible.
        """
        for offset in range(1, self._workers):
            idx = (worker_id + offset) % self._workers
            task_id: Optional[str] = None
            with self._qlocks[idx]:
                if self._queues[idx]:
                    task_id = self._queues[idx].pop()
            if task_id is not None:
                with self._cond:
                    self._steals += 1
                return task_id
        return None

    # ------------------------------------------------------------------
    # Internal: state transitions (all called with self._cond held)
    # ------------------------------------------------------------------

    def _mark_skipped_locked(self, rec: _Record, reason: str) -> None:
        rec.state = TaskState.SKIPPED
        rec.skip_reason = reason
        self._non_terminal -= 1
        self._cascade_skip_locked(rec)

    def _cascade_skip_locked(self, rec: _Record) -> None:
        """Recursively skip dependents of an already-terminal skipped task."""
        for child_id in self._dependents[rec.task.task_id]:
            child = self._records[child_id]
            if child.state in (TaskState.PENDING, TaskState.READY):
                child.state = TaskState.SKIPPED
                child.skip_reason = f"dependency {rec.task.task_id!r} was skipped"
                self._non_terminal -= 1
                self._cascade_skip_locked(child)

    def _cascade_terminal_locked(self, rec: _Record) -> None:
        """Handle a task reaching a non-success terminal state."""
        self._non_terminal -= 1
        verb = _STATE_VERBS[rec.state]
        for child_id in self._dependents[rec.task.task_id]:
            child = self._records[child_id]
            if child.state in (TaskState.PENDING, TaskState.READY):
                child.state = TaskState.SKIPPED
                child.skip_reason = f"dependency {rec.task.task_id!r} {verb}"
                self._non_terminal -= 1
                self._cascade_skip_locked(child)

    def _cascade_success_locked(self, rec: _Record) -> None:
        """Wake dependents of a successfully finished task."""
        self._non_terminal -= 1
        for child_id in self._dependents[rec.task.task_id]:
            child = self._records[child_id]
            if child.state is not TaskState.PENDING:
                continue
            child.remaining -= 1
            if child.remaining == 0:
                child.state = TaskState.READY
                self._enqueue_locked(child_id)

    # ------------------------------------------------------------------
    # Internal: worker machinery
    # ------------------------------------------------------------------

    def _worker_loop(self, worker_id: int) -> None:
        while True:
            task_id = self._pop_own(worker_id)
            if task_id is None:
                task_id = self._steal(worker_id)
            if task_id is not None:
                self._execute(worker_id, task_id)
                continue
            with self._cond:
                if self._shutdown or self._non_terminal == 0:
                    return
                self._cond.wait(timeout=0.05)

    def _execute(self, worker_id: int, task_id: str) -> None:
        with self._cond:
            rec = self._records[task_id]
            if rec.state is not TaskState.READY:
                return  # cancelled or skipped while sitting in the queue
            rec.state = TaskState.RUNNING
            rec.attempts += 1
            token = CancellationToken()
            rec.token = token
            self._executed[worker_id] += 1
            payload = rec.task.payload
            timeout = rec.task.timeout

        holder = _AttemptResult()
        runner = threading.Thread(
            target=_run_payload,
            args=(payload, token, holder),
            name=f"ws-payload-{task_id}",
            daemon=True,
        )
        runner.start()
        deadline = time.monotonic() + timeout if timeout is not None else None
        grace_until: Optional[float] = None
        gave_up: Optional[str] = None  # "timeout" | "cancel"
        while True:
            runner.join(0.01)
            if not runner.is_alive():
                break
            now = time.monotonic()
            with self._cond:
                cancel_req = rec.cancel_requested
            if cancel_req:
                token.cancel()
                if grace_until is None:
                    grace_until = now + self._cancel_grace
                    gave_up = "cancel"
            elif deadline is not None and now >= deadline:
                token.cancel()
                if grace_until is None:
                    grace_until = now + self._cancel_grace
                    gave_up = "timeout"
            if grace_until is not None and now >= grace_until:
                break  # payload ignored the token; abandon the attempt
        self._finish_attempt(worker_id, rec, holder, gave_up)

    def _finish_attempt(
        self,
        worker_id: int,
        rec: _Record,
        holder: _AttemptResult,
        gave_up: Optional[str],
    ) -> None:
        with self._cond:
            if gave_up == "timeout" and not rec.cancel_requested:
                if rec.attempts <= rec.task.max_retries:
                    self._requeue_locked(worker_id, rec)
                else:
                    rec.state = TaskState.TIMEOUT
                    rec.error = {
                        "type": "TimeoutError",
                        "message": f"task exceeded its timeout of {rec.task.timeout} seconds",
                    }
                    self._cascade_terminal_locked(rec)
            elif rec.cancel_requested or gave_up == "cancel":
                rec.state = TaskState.CANCELLED
                self._cascade_terminal_locked(rec)
            elif holder.exc is not None:
                if rec.attempts <= rec.task.max_retries:
                    self._requeue_locked(worker_id, rec)
                else:
                    rec.state = TaskState.FAILED
                    rec.error = {
                        "type": type(holder.exc).__name__,
                        "message": str(holder.exc) or repr(holder.exc),
                    }
                    self._cascade_terminal_locked(rec)
            else:
                serialization_error: Optional[Exception] = None
                try:
                    json.dumps(holder.value)
                except (TypeError, ValueError) as exc:
                    serialization_error = exc
                if serialization_error is None:
                    rec.state = TaskState.SUCCESS
                    rec.result = holder.value
                    self._cascade_success_locked(rec)
                elif rec.attempts <= rec.task.max_retries:
                    self._requeue_locked(worker_id, rec)
                else:
                    rec.state = TaskState.FAILED
                    rec.error = {
                        "type": type(serialization_error).__name__,
                        "message": f"task result is not JSON serializable: {serialization_error}",
                    }
                    self._cascade_terminal_locked(rec)
            self._cond.notify_all()


# Convenient short alias.
Executor = WorkStealingExecutor
