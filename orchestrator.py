"""Deterministic, embeddable job orchestration kernel.

Single-process, no real threads or sleeps: time is supplied by an injected
clock (see :class:`FakeClock`) and job bodies by an injected ``executor``.

State machine (fixed)::

    PENDING -> RUNNING -> SUCCEEDED
                    |          |
                    v          v
                  FAILED   COMPENSATING -> COMPENSATED
                               |
                               v
                           SUCCEEDED   (compensation itself failed)
    PENDING -> SKIPPED
    RUNNING -> PENDING        (scheduled retry)

Any other transition raises :class:`JobStateError`.

Failure semantics (deterministic fail-fast): when a job exhausts its retries
it becomes ``FAILED``; every transitive downstream job becomes ``SKIPPED``
(dependency propagation), any job not yet started is aborted (also
``SKIPPED``), and every ``SUCCEEDED`` job is compensated in reverse
topological order. A failed compensation is recorded in
``compensation_errors`` but does not stop the remaining compensations. The
overall result is then ``PARTIAL``.
"""

from __future__ import annotations

import heapq
import json
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence


# --------------------------------------------------------------------------- #
# States / result constants
# --------------------------------------------------------------------------- #


class State:
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    COMPENSATING = "COMPENSATING"
    COMPENSATED = "COMPENSATED"
    SKIPPED = "SKIPPED"


class Result:
    RUNNING = "RUNNING"
    SUCCESS = "SUCCESS"
    PARTIAL = "PARTIAL"


# States that make every downstream job un-runnable.
_BAD_STATES = frozenset({State.FAILED, State.COMPENSATED, State.SKIPPED})

# Legal transitions. Anything not listed raises JobStateError.
ALLOWED_TRANSITIONS: Dict[str, frozenset] = {
    State.PENDING: frozenset({State.RUNNING, State.SKIPPED}),
    State.RUNNING: frozenset(
        {State.SUCCEEDED, State.FAILED, State.PENDING}
    ),
    State.SUCCEEDED: frozenset({State.COMPENSATING}),
    State.COMPENSATING: frozenset({State.COMPENSATED, State.SUCCEEDED}),
    State.FAILED: frozenset(),
    State.COMPENSATED: frozenset(),
    State.SKIPPED: frozenset(),
}

SNAPSHOT_VERSION = 1


# --------------------------------------------------------------------------- #
# Errors
# --------------------------------------------------------------------------- #


class JobStateError(RuntimeError):
    """An illegal state-machine transition was attempted."""

    def __init__(self, job_id: str, from_state: str, to_state: str):
        self.job_id = job_id
        self.from_state = from_state
        self.to_state = to_state
        super().__init__(
            f"illegal state transition for job {job_id!r}: "
            f"{from_state} -> {to_state}"
        )


class CycleError(ValueError):
    """The dependency graph contains a cycle.

    ``cycle`` is the ordered id sequence along the cycle, closing with the
    starting id (e.g. ``["a", "b", "c", "a"]``; self dependency is
    ``["x", "x"]``). The sequence is stable for the same graph.
    """

    def __init__(self, cycle: Sequence[str]):
        self.cycle = list(cycle)
        super().__init__(
            "dependency cycle detected: " + " -> ".join(self.cycle)
        )


# --------------------------------------------------------------------------- #
# Clock
# --------------------------------------------------------------------------- #


class FakeClock:
    """Deterministic virtual clock. Executors drive time via ``sleep``."""

    def __init__(self, start: float = 0.0):
        self._t = float(start)

    def now(self) -> float:
        return self._t

    def sleep(self, seconds: float) -> None:
        self._t += float(seconds)

    def _set(self, value: float) -> None:
        self._t = float(value)


# --------------------------------------------------------------------------- #
# Job / result records
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Job:
    id: str
    deps: List[str] = field(default_factory=list)
    retries: int = 0  # extra attempts after attempt 0; total attempts = retries + 1
    timeout: Optional[float] = None  # virtual-time budget per attempt
    compensate: Optional[str] = None  # compensation action identifier

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or not self.id:
            raise ValueError("job id must be a non-empty string")
        if self.retries < 0:
            raise ValueError(f"job {self.id!r}: retries must be >= 0")
        if self.timeout is not None and self.timeout < 0:
            raise ValueError(f"job {self.id!r}: timeout must be >= 0")
        # frozen dataclass -> store a defensive copy
        object.__setattr__(self, "deps", list(self.deps))


@dataclass(frozen=True)
class RunResult:
    result: str
    states: Dict[str, str]
    errors: Dict[str, str]
    compensation_errors: Dict[str, str]
    events: List[tuple]

    @property
    def terminal(self) -> bool:
        return self.result in (Result.SUCCESS, Result.PARTIAL)


# Executor: (job, attempt) -> bool, attempt starts at 0.
Executor = Callable[[Job, int], bool]
# Compensator receives the job (job.compensate is the action id).
Compensator = Callable[[Job], bool]


# --------------------------------------------------------------------------- #
# Graph helpers
# --------------------------------------------------------------------------- #


def _tarjan_sccs(order: List[str], deps: Dict[str, List[str]]) -> List[List[str]]:
    """Iterative Tarjan. Nodes and neighbours are visited in sorted order."""
    index_of: Dict[str, int] = {}
    lowlink: Dict[str, int] = {}
    on_stack: Dict[str, bool] = {}
    stack: List[str] = []
    sccs: List[List[str]] = []
    counter = 0

    for root in sorted(order):
        if root in index_of:
            continue
        # stack frames: (node, iterator over sorted neighbours)
        index_of[root] = lowlink[root] = counter
        counter += 1
        stack.append(root)
        on_stack[root] = True
        work = [(root, iter(sorted(deps[root])))]
        while work:
            node, it = work[-1]
            advanced = False
            for nxt in it:
                if nxt not in index_of:
                    index_of[nxt] = lowlink[nxt] = counter
                    counter += 1
                    stack.append(nxt)
                    on_stack[nxt] = True
                    work.append((nxt, iter(sorted(deps[nxt]))))
                    advanced = True
                    break
                if on_stack.get(nxt):
                    lowlink[node] = min(lowlink[node], index_of[nxt])
            if advanced:
                continue
            if lowlink[node] == index_of[node]:
                component: List[str] = []
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    component.append(w)
                    if w == node:
                        break
                sccs.append(sorted(component))
            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[node])
    return sccs


def _find_cycle(order: List[str], deps: Dict[str, List[str]]) -> List[str]:
    """Return a stable cycle: smallest cyclic SCC, shortest path from its
    smallest member back to itself (BFS over neighbours in id order)."""
    cyclic = []
    for component in _tarjan_sccs(order, deps):
        if len(component) > 1:
            cyclic.append(component)
        elif component[0] in deps[component[0]]:
            cyclic.append(component)
    if not cyclic:
        return []
    component = min(cyclic, key=lambda c: c[0])
    members = set(component)
    start = component[0]

    # BFS inside the SCC; neighbours expanded in sorted id order so the
    # first closed walk found is reproducible.
    parents: Dict[str, Optional[str]] = {start: None}
    queue: List[str] = [start]
    head = 0
    closing: Optional[str] = None
    while head < len(queue):
        node = queue[head]
        head += 1
        for nxt in sorted(deps[node]):
            if nxt not in members:
                continue
            if nxt == start and node != start:
                closing = node
                queue = queue[:head]  # stop BFS
                break
            if nxt == start and node == start:
                # self dependency
                return [start, start]
            if nxt not in parents:
                parents[nxt] = node
                queue.append(nxt)
        if closing is not None:
            break

    path: List[str] = []
    cur: Optional[str] = closing
    while cur is not None:
        path.append(cur)
        cur = parents[cur]
    path.reverse()
    path.append(start)
    return path


def _topological_order(
    order: List[str], deps: Dict[str, List[str]]
) -> List[str]:
    """Kahn topo sort with id-sorted ready set (stable)."""
    indeg = {jid: 0 for jid in order}
    dependents: Dict[str, List[str]] = {jid: [] for jid in order}
    for jid in order:
        for d in deps[jid]:
            indeg[jid] += 1
            dependents[d].append(jid)
    ready = [jid for jid in order if indeg[jid] == 0]
    heapq.heapify(ready)
    result: List[str] = []
    while ready:
        jid = heapq.heappop(ready)
        result.append(jid)
        for child in dependents[jid]:
            indeg[child] -= 1
            if indeg[child] == 0:
                heapq.heappush(ready, child)
    return result  # full result: graph is guaranteed acyclic here


# --------------------------------------------------------------------------- #
# Orchestrator
# --------------------------------------------------------------------------- #


class Orchestrator:
    def __init__(
        self,
        jobs: Sequence[Job],
        executor: Executor,
        compensator: Optional[Compensator] = None,
        clock: Optional[FakeClock] = None,
        max_parallel: Optional[int] = None,
    ):
        self._jobs: Dict[str, Job] = {}
        self._order: List[str] = []
        for job in jobs:
            if job.id in self._jobs:
                raise ValueError(f"duplicate job id: {job.id!r}")
            self._jobs[job.id] = job
            self._order.append(job.id)

        self._deps: Dict[str, List[str]] = {
            jid: list(self._jobs[jid].deps) for jid in self._order
        }
        # Edge validation before cycle detection, naming the exact edge.
        for jid in self._order:
            for dep in self._deps[jid]:
                if dep not in self._jobs:
                    raise ValueError(
                        f"job {jid!r} depends on unknown job {dep!r} "
                        f"(edge {jid} -> {dep})"
                    )

        cycle = _find_cycle(self._order, self._deps)
        if cycle:
            raise CycleError(cycle)

        if max_parallel is not None and max_parallel < 1:
            raise ValueError("max_parallel must be >= 1")
        self.max_parallel = (
            max_parallel if max_parallel is not None else len(self._order) or 1
        )

        self._executor = executor
        self._compensator = compensator or (lambda job: True)
        self.clock = clock or FakeClock()

        self._topo = _topological_order(self._order, self._deps)

        self.states: Dict[str, str] = {
            jid: State.PENDING for jid in self._order
        }
        self.attempts: Dict[str, int] = {jid: 0 for jid in self._order}
        self.errors: Dict[str, str] = {}
        self.compensation_errors: Dict[str, str] = {}
        self.events: List[tuple] = []
        self.result: str = Result.SUCCESS if not self._order else Result.RUNNING

    # -- graph introspection -------------------------------------------------

    @property
    def jobs(self) -> Dict[str, Job]:
        return self._jobs

    def topological_order(self) -> List[str]:
        return list(self._topo)

    # -- state machine -------------------------------------------------------

    def transition(self, job_id: str, to_state: str) -> None:
        frm = self.states[job_id]
        if to_state not in ALLOWED_TRANSITIONS[frm]:
            raise JobStateError(job_id, frm, to_state)
        self.states[job_id] = to_state

    # -- main loop -----------------------------------------------------------

    def run(self, limit: Optional[int] = None) -> RunResult:
        """Advance the graph until terminal (or ``limit`` job executions).

        ``limit`` bounds how many jobs are started; it exists to take a
        mid-run snapshot. Returns a :class:`RunResult`.
        """
        started = 0
        while self.result == Result.RUNNING:
            self._propagate_skips()

            ready = sorted(
                jid
                for jid in self._topo
                if self.states[jid] == State.PENDING
                and all(
                    self.states[d] == State.SUCCEEDED for d in self._deps[jid]
                )
            )
            chosen = ready[: self.max_parallel]

            if not chosen:
                pending = [
                    jid
                    for jid in self._order
                    if self.states[jid] == State.PENDING
                ]
                if pending:
                    # Unreachable for an acyclic graph: a pending node must
                    # either have a bad dep (skip), a succeeded dep (ready),
                    # or a pending dep that eventually unblocks it.
                    raise RuntimeError(
                        "orchestrator stuck on pending jobs: "
                        + ", ".join(sorted(pending))
                    )
                self.result = Result.SUCCESS
                break

            wave_failed = False
            for jid in chosen:
                if not self._execute_job(jid):
                    wave_failed = True
                started += 1

            if wave_failed:
                self._failover()

            if limit is not None and started >= limit:
                break

        return self._result()

    def _execute_job(self, jid: str) -> bool:
        job = self._jobs[jid]
        self.transition(jid, State.RUNNING)
        self.events.append(("run_start", jid))

        reason = ""
        for attempt in range(self.attempts[jid], job.retries + 1):
            self.attempts[jid] = attempt + 1
            self.events.append(("attempt", jid, attempt))
            start = self.clock.now()
            ok = False
            try:
                ok = bool(self._executor(job, attempt))
            except Exception as exc:  # executor blow-up == failed attempt
                ok = False
                reason = f"error:{type(exc).__name__}"
            elapsed = self.clock.now() - start

            if job.timeout is not None and elapsed > job.timeout:
                ok = False
                reason = "timeout"

            if ok:
                self.transition(jid, State.SUCCEEDED)
                self.events.append(("succeeded", jid))
                return True

            if attempt < job.retries:
                self.transition(jid, State.PENDING)
                self.events.append(("retry", jid, attempt + 1))
                self.transition(jid, State.RUNNING)
            else:
                self.transition(jid, State.FAILED)
                self.errors[jid] = reason or "failed"
                self.events.append(("failed", jid, reason or "failed"))
                return False
        return False  # pragma: no cover

    def _propagate_skips(self) -> None:
        """One topo-order pass: any pending job with a bad dep is skipped.
        Topo order guarantees transitive (indirect-downstream) propagation
        in a single pass."""
        for jid in self._topo:
            if self.states[jid] != State.PENDING:
                continue
            for dep in self._deps[jid]:  # declared order -> stable blame edge
                if self.states[dep] in _BAD_STATES:
                    self.transition(jid, State.SKIPPED)
                    self.events.append(("skipped", jid, f"dep:{dep}"))
                    break

    def _failover(self) -> None:
        # 1. skips travel down the dependency chain
        self._propagate_skips()
        # 2. everything not started is aborted (fail-fast)
        for jid in sorted(self._order):
            if self.states[jid] == State.PENDING:
                self.transition(jid, State.SKIPPED)
                self.events.append(("skipped", jid, "aborted"))
        # 3. compensate succeeded jobs in reverse topological order
        for jid in reversed(self._topo):
            if self.states[jid] != State.SUCCEEDED:
                continue
            job = self._jobs[jid]
            self.transition(jid, State.COMPENSATING)
            self.events.append(("compensate_start", jid, job.compensate))
            try:
                ok = bool(self._compensator(job))
            except Exception:
                ok = False
            if ok:
                self.transition(jid, State.COMPENSATED)
                self.events.append(("compensated", jid, job.compensate))
            else:
                self.transition(jid, State.SUCCEEDED)
                self.compensation_errors[jid] = job.compensate or ""
                self.events.append(
                    ("compensate_failed", jid, job.compensate)
                )
        self.result = Result.PARTIAL

    def _result(self) -> RunResult:
        return RunResult(
            result=self.result,
            states=dict(self.states),
            errors=dict(self.errors),
            compensation_errors=dict(self.compensation_errors),
            events=list(self.events),
        )

    # -- snapshot / restore --------------------------------------------------

    def snapshot(self) -> str:
        """Return a byte-stable, JSON-serialisable checkpoint string."""
        data = {
            "version": SNAPSHOT_VERSION,
            "max_parallel": self.max_parallel,
            "clock": self.clock.now(),
            "jobs": [
                {
                    "id": job.id,
                    "deps": list(job.deps),
                    "retries": job.retries,
                    "timeout": job.timeout,
                    "compensate": job.compensate,
                }
                for job in (self._jobs[j] for j in self._order)
            ],
            "states": dict(self.states),
            "attempts": dict(self.attempts),
            "errors": dict(self.errors),
            "compensation_errors": dict(self.compensation_errors),
            "result": self.result,
            "events": [list(event) for event in self.events],
        }
        return json.dumps(
            data, sort_keys=True, separators=(",", ":"), ensure_ascii=False
        )

    @classmethod
    def restore(
        cls,
        snapshot: str,
        executor: Executor,
        compensator: Optional[Compensator] = None,
        clock: Optional[FakeClock] = None,
    ) -> "Orchestrator":
        data = json.loads(snapshot)
        if data.get("version") != SNAPSHOT_VERSION:
            raise ValueError(
                f"unsupported snapshot version: {data.get('version')!r}"
            )
        jobs = [
            Job(
                id=j["id"],
                deps=list(j["deps"]),
                retries=j["retries"],
                timeout=j["timeout"],
                compensate=j["compensate"],
            )
            for j in data["jobs"]
        ]
        restored_clock = clock or FakeClock()
        orch = cls(
            jobs,
            executor=executor,
            compensator=compensator,
            clock=restored_clock,
            max_parallel=data["max_parallel"],
        )
        orch.clock._set(float(data["clock"]))
        orch.states.update(data["states"])
        orch.attempts.update(data["attempts"])
        # Defensive: a job captured mid-attempt restarts that same attempt
        # cleanly (it never completed), so the attempt counter rolls back.
        for jid, st in list(orch.states.items()):
            if st == State.RUNNING:
                orch.states[jid] = State.PENDING
                orch.attempts[jid] = max(0, orch.attempts[jid] - 1)
        orch.errors.update(data["errors"])
        orch.compensation_errors.update(data["compensation_errors"])
        orch.result = data["result"]
        orch.events = [tuple(event) for event in data["events"]]
        return orch
