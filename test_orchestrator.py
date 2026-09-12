"""Unit tests for the deterministic job orchestration kernel.

Run with:  python -m unittest -v
"""

import json
import unittest

from orchestrator import (
    CycleError,
    FakeClock,
    Job,
    JobStateError,
    Orchestrator,
    Result,
    State,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def make_executor(clock, fail=None, succeed_at=None, sleeps=None, raise_on=None):
    """Build a scripted executor + call log.

    fail:       set of job ids that always return False
    succeed_at: {job_id: attempt_number} -> succeed from that attempt on
    sleeps:     {job_id: virtual seconds consumed per call}
    raise_on:   set of job ids whose call raises (counts as a failed attempt)
    """
    fail = fail or set()
    succeed_at = succeed_at or {}
    sleeps = sleeps or {}
    raise_on = raise_on or set()
    calls = []

    def executor(job, attempt):
        calls.append((job.id, attempt))
        if job.id in sleeps:
            clock.sleep(sleeps[job.id])
        if job.id in raise_on:
            raise RuntimeError(f"boom in job {job.id}")
        if job.id in fail:
            return False
        if job.id in succeed_at:
            return attempt >= succeed_at[job.id]
        return True

    executor.calls = calls
    return executor


def make_compensator(fail=None, log=None):
    fail = fail or set()
    log = log if log is not None else []

    def compensator(job):
        log.append(job.id)
        return job.id not in fail

    compensator.log = log
    return compensator


def diamond_jobs(**overrides):
    """a -> b, a -> c; {b, c} -> d; c -> e"""
    spec = {
        "a": [],
        "b": ["a"],
        "c": ["a"],
        "d": ["b", "c"],
        "e": ["c"],
    }
    jobs = []
    for jid, deps in spec.items():
        kw = overrides.get(jid, {})
        jobs.append(Job(id=jid, deps=deps, **kw))
    return jobs


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


class TestSuccessPath(unittest.TestCase):
    def test_all_succeed_states_and_order(self):
        clock = FakeClock()
        ex = make_executor(clock, sleeps={"b": 3})
        comp_log = []
        o = Orchestrator(
            diamond_jobs(),
            ex,
            make_compensator(log=comp_log),
            clock=clock,
            max_parallel=2,
        )

        result = o.run()

        self.assertEqual(result.result, Result.SUCCESS)
        self.assertEqual(
            result.states,
            {jid: State.SUCCEEDED for jid in "abcde"},
        )
        self.assertEqual(result.errors, {})
        self.assertEqual(result.compensation_errors, {})
        self.assertEqual(comp_log, [])  # nothing to compensate
        # every job executed exactly once, attempt 0
        self.assertEqual(
            sorted(ex.calls),
            sorted([(jid, 0) for jid in "abcde"]),
        )
        # virtual clock advanced, no real sleep involved
        self.assertEqual(clock.now(), 3.0)
        # d must run after both of its deps; e after c
        order = [e[1] for e in result.events if e[0] == "run_start"]
        self.assertLess(order.index("a"), order.index("b"))
        self.assertLess(order.index("b"), order.index("d"))
        self.assertLess(order.index("c"), order.index("d"))
        self.assertLess(order.index("c"), order.index("e"))

    def test_max_parallel_waves_are_stable(self):
        # three independent roots -> exactly two may start in the first wave,
        # chosen by id order
        jobs = [Job(id="z"), Job(id="x"), Job(id="y")]
        o = Orchestrator(jobs, make_executor(FakeClock()), max_parallel=2)
        o.run()
        order = [e[1] for e in o.events if e[0] == "run_start"]
        self.assertEqual(order, ["x", "y", "z"])


class TestRetriesAndTimeout(unittest.TestCase):
    def test_retries_exhausted_then_failed(self):
        o = Orchestrator(
            [Job(id="a", retries=2)], make_executor(FakeClock(), fail={"a"})
        )
        result = o.run()
        self.assertEqual(result.states["a"], State.FAILED)
        self.assertEqual(result.result, Result.PARTIAL)
        self.assertEqual(
            [e for e in result.events if e[0] == "attempt"],
            [("attempt", "a", 0), ("attempt", "a", 1), ("attempt", "a", 2)],
        )

    def test_succeeds_on_last_allowed_attempt(self):
        ex = make_executor(FakeClock(), succeed_at={"a": 2})
        o = Orchestrator([Job(id="a", retries=2)], ex)
        result = o.run()
        self.assertEqual(result.states["a"], State.SUCCEEDED)
        self.assertEqual(result.result, Result.SUCCESS)
        self.assertEqual(ex.calls, [("a", 0), ("a", 1), ("a", 2)])

    def test_executor_exception_counts_as_failed_attempt(self):
        ex = make_executor(FakeClock(), raise_on={"a"})
        o = Orchestrator([Job(id="a", retries=0)], ex)
        result = o.run()
        self.assertEqual(result.states["a"], State.FAILED)
        self.assertTrue(result.errors["a"].startswith("error:RuntimeError"))

    def test_timeout_uses_virtual_clock(self):
        # executor reports success but burns 10 virtual seconds against a
        # budget of 5 -> the attempt is a timeout failure
        clock = FakeClock()
        ex = make_executor(clock, sleeps={"a": 10})
        o = Orchestrator([Job(id="a", timeout=5)], ex, clock=clock)
        result = o.run()
        self.assertEqual(result.states["a"], State.FAILED)
        self.assertEqual(result.errors["a"], "timeout")


class TestDependencyGating(unittest.TestCase):
    def test_failure_skips_indirect_downstream_with_edge_named(self):
        # chain a -> b -> c; a fails => b skipped via edge b->a and c via c->b
        jobs = [
            Job(id="a"),
            Job(id="b", deps=["a"]),
            Job(id="c", deps=["b"]),
        ]
        o = Orchestrator(jobs, make_executor(FakeClock(), fail={"a"}))
        result = o.run()

        self.assertEqual(result.states["a"], State.FAILED)
        self.assertEqual(result.states["b"], State.SKIPPED)
        self.assertEqual(result.states["c"], State.SKIPPED)
        skip_events = [e for e in result.events if e[0] == "skipped"]
        # each skip names the exact job and the dependency edge that caused it
        self.assertIn(("skipped", "b", "dep:a"), skip_events)
        self.assertIn(("skipped", "c", "dep:b"), skip_events)
        self.assertEqual(result.result, Result.PARTIAL)

    def test_one_failed_dep_skips_diamond_join_sibling_is_compensated(self):
        # diamond: b fails => d is skipped via edge d->b; c succeeded and must
        # be compensated; a succeeded and must be compensated
        jobs = diamond_jobs(b={"retries": 0})
        comp_log = []
        o = Orchestrator(
            jobs,
            make_executor(FakeClock(), fail={"b"}),
            make_compensator(log=comp_log),
            max_parallel=4,
        )
        result = o.run()

        self.assertEqual(result.states["b"], State.FAILED)
        self.assertEqual(result.states["d"], State.SKIPPED)
        self.assertEqual(result.states["e"], State.SKIPPED)
        self.assertEqual(result.states["c"], State.COMPENSATED)
        self.assertEqual(result.states["a"], State.COMPENSATED)
        # the skip event says exactly which edge blocked d
        self.assertIn(("skipped", "d", "dep:b"), result.events)
        # reverse topological order: c before a; failed b never compensated
        self.assertEqual(comp_log, ["c", "a"])

    def test_unknown_dependency_names_the_edge(self):
        with self.assertRaises(ValueError) as ctx:
            Orchestrator([Job(id="a", deps=["ghost"])], make_executor(FakeClock()))
        self.assertIn("edge a -> ghost", str(ctx.exception))


class TestCompensation(unittest.TestCase):
    def test_compensation_runs_reverse_topological_with_action_ids(self):
        jobs = [
            Job(id="a", compensate="undo-a"),
            Job(id="b", deps=["a"], compensate="undo-b"),
            Job(id="c", deps=["b"]),
        ]
        o = Orchestrator(
            jobs,
            make_executor(FakeClock(), fail={"c"}),
            make_compensator(),
        )
        result = o.run()

        self.assertEqual(
            [e for e in result.events if e[0] == "compensate_start"],
            [
                ("compensate_start", "b", "undo-b"),
                ("compensate_start", "a", "undo-a"),
            ],
        )
        self.assertEqual(result.states["b"], State.COMPENSATED)
        self.assertEqual(result.states["a"], State.COMPENSATED)
        self.assertEqual(result.states["c"], State.FAILED)

    def test_compensation_failure_recorded_but_continues_and_partial(self):
        # b's compensation fails; a's compensation must still run
        jobs = [
            Job(id="a", compensate="undo-a"),
            Job(id="b", deps=["a"], compensate="undo-b"),
            Job(id="c", deps=["b"]),
        ]
        comp_log = []
        o = Orchestrator(
            jobs,
            make_executor(FakeClock(), fail={"c"}),
            make_compensator(fail={"b"}, log=comp_log),
        )
        result = o.run()

        self.assertEqual(comp_log, ["b", "a"])  # did not stop after b failed
        self.assertEqual(
            result.compensation_errors, {"b": "undo-b"}
        )
        # failed compensation leaves the job SUCCEEDED (rollback not applied)
        self.assertEqual(result.states["b"], State.SUCCEEDED)
        self.assertEqual(result.states["a"], State.COMPENSATED)
        self.assertEqual(result.result, Result.PARTIAL)


class TestCycleDetection(unittest.TestCase):
    def test_simple_cycle_sequence_is_stable(self):
        jobs = [
            Job(id="a", deps=["b"]),
            Job(id="b", deps=["c"]),
            Job(id="c", deps=["a"]),
        ]
        with self.assertRaises(CycleError) as ctx:
            Orchestrator(jobs, make_executor(FakeClock()))
        self.assertEqual(ctx.exception.cycle, ["a", "b", "c", "a"])

    def test_cycle_reproducible_across_input_order(self):
        jobs_a = [
            Job(id="c", deps=["a"]),
            Job(id="a", deps=["b"]),
            Job(id="b", deps=["c"]),
        ]
        jobs_b = list(reversed(jobs_a))
        cycles = []
        for jobs in (jobs_a, jobs_b):
            try:
                Orchestrator(jobs, make_executor(FakeClock()))
            except CycleError as exc:
                cycles.append(exc.cycle)
        self.assertEqual(len(cycles), 2)
        self.assertEqual(cycles[0], cycles[1])

    def test_self_dependency_is_a_cycle(self):
        with self.assertRaises(CycleError) as ctx:
            Orchestrator([Job(id="x", deps=["x"])], make_executor(FakeClock()))
        self.assertEqual(ctx.exception.cycle, ["x", "x"])


class TestStateMachine(unittest.TestCase):
    def test_illegal_transition_carries_job_id_and_states(self):
        o = Orchestrator([Job(id="a")], make_executor(FakeClock()))
        with self.assertRaises(JobStateError) as ctx:
            o.transition("a", State.FAILED)  # PENDING -> FAILED illegal
        self.assertEqual(ctx.exception.job_id, "a")
        self.assertEqual(ctx.exception.from_state, State.PENDING)
        self.assertEqual(ctx.exception.to_state, State.FAILED)

    def test_terminal_states_reject_transitions(self):
        o = Orchestrator([Job(id="a")], make_executor(FakeClock()))
        o.transition("a", State.SKIPPED)
        with self.assertRaises(JobStateError):
            o.transition("a", State.RUNNING)


class TestSnapshotRestore(unittest.TestCase):
    def _build_fresh(self):
        clock = FakeClock()
        ex = make_executor(clock, sleeps={"b": 4, "e": 2})
        comp = make_compensator()
        o = Orchestrator(
            diamond_jobs(), ex, comp, clock=clock, max_parallel=2
        )
        return o, ex, comp

    def test_snapshot_is_json_serialisable(self):
        o, _, _ = self._build_fresh()
        o.run(limit=1)
        raw = o.snapshot()
        # bytes -> JSON -> bytes round trip
        data = json.loads(raw)
        self.assertEqual(data["version"], 1)
        self.assertEqual(
            json.dumps(data, sort_keys=True, separators=(",", ":")), raw
        )

    def test_restore_midrun_matches_one_shot_run_byte_for_byte(self):
        # one-shot reference run
        full, _, _ = self._build_fresh()
        full.run()
        final_full = full.snapshot()
        expected_states = dict(full.states)

        # split run: stop after the first job starts/completes, checkpoint
        half, ex_half, _ = self._build_fresh()
        half.run(limit=1)
        mid_snap = half.snapshot()

        # a second independent run stopped at the same point must produce
        # exactly the same checkpoint bytes
        probe, _, _ = self._build_fresh()
        probe.run(limit=1)
        self.assertEqual(probe.snapshot(), mid_snap)

        # resume with a *fresh* executor so we can observe post-restore calls
        clock2 = FakeClock()
        ex_resume = make_executor(clock2, sleeps={"b": 4, "e": 2})
        comp_resume = make_compensator()
        restored = Orchestrator.restore(
            mid_snap, ex_resume, comp_resume, clock=clock2
        )
        self.assertEqual(restored.result, Result.RUNNING)
        result = restored.run()

        # final state mapping identical to the one-shot run
        self.assertEqual(result.result, Result.SUCCESS)
        self.assertEqual(result.states, expected_states)

        # already-SUCCEEDED 'a' must never be re-executed after restore
        resumed_ids = {jid for jid, _ in ex_resume.calls}
        self.assertNotIn("a", resumed_ids)
        self.assertEqual(
            sorted(ex_resume.calls),
            sorted([(jid, 0) for jid in "bcde"]),
        )

        # full checkpoint bytes identical: states, attempts, clock, events
        self.assertEqual(restored.snapshot(), final_full)

    def test_restore_continues_failure_and_compensation(self):
        def build():
            clock = FakeClock()
            ex = make_executor(clock, fail={"d"})
            comp = make_compensator()
            return (
                Orchestrator(
                    diamond_jobs(), ex, comp, clock=clock, max_parallel=2
                ),
                ex,
                comp,
            )

        full, _, full_comp = build()
        full.run()

        half, _, _ = build()
        half.run(limit=1)  # a completed, nothing else
        snap = half.snapshot()

        ex2 = make_executor(FakeClock(), fail={"d"})
        comp2 = make_compensator()
        restored = Orchestrator.restore(snap, ex2, comp2)
        result = restored.run()

        self.assertEqual(result.result, Result.PARTIAL)
        self.assertEqual(result.states, full.states)
        self.assertEqual(result.events, full.events)
        # d fails while e runs concurrently in the same wave and succeeds, so
        # e is rolled back too; reverse topological order: e, c, b, a
        self.assertEqual(comp2.log, ["e", "c", "b", "a"])
        self.assertNotIn(("a", 0), ex2.calls)

    def test_restore_running_state_restarts_same_attempt(self):
        # hand-craft a checkpoint captured while 'a' is mid attempt 0;
        # after restore that attempt must be retried, not skipped
        o = Orchestrator(
            [Job(id="a", retries=1)], make_executor(FakeClock())
        )
        snap = json.loads(o.snapshot())
        snap["states"]["a"] = State.RUNNING
        snap["attempts"]["a"] = 1
        snap["events"].append(["run_start", "a"])

        ex = make_executor(FakeClock())
        restored = Orchestrator.restore(json.dumps(snap), ex)
        result = restored.run()
        self.assertEqual(result.states["a"], State.SUCCEEDED)
        self.assertEqual(ex.calls, [("a", 0)])  # same attempt number again


if __name__ == "__main__":
    unittest.main()
