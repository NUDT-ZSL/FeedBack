"""Unit tests for the multi-queue work-stealing executor.

Run with:  python -m unittest test_executor -v
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from executor import (
    CycleError,
    DuplicateTaskError,
    SnapshotError,
    StateError,
    Task,
    UnknownTaskError,
    ValidationError,
    WorkStealingExecutor,
    current_cancel_token,
)


def _noop():
    return None


class TaskValidationTests(unittest.TestCase):
    """Validation of Task construction and submission rules."""

    def test_empty_task_id_rejected(self):
        with self.assertRaises(ValidationError):
            Task("", _noop)

    def test_non_callable_payload_rejected(self):
        with self.assertRaises(ValidationError):
            Task("a", payload=42)

    def test_self_dependency_rejected(self):
        with self.assertRaises(ValidationError):
            Task("a", _noop, deps=["a"])

    def test_duplicate_deps_rejected(self):
        with self.assertRaises(ValidationError):
            Task("a", _noop, deps=["b", "b"])

    def test_zero_and_negative_timeout_rejected(self):
        with self.assertRaises(ValidationError):
            Task("a", _noop, timeout=0)
        with self.assertRaises(ValidationError):
            Task("a", _noop, timeout=-1.5)

    def test_negative_max_retries_rejected(self):
        with self.assertRaises(ValidationError):
            Task("a", _noop, max_retries=-1)

    def test_unknown_dependency_rejected(self):
        ex = WorkStealingExecutor()
        with self.assertRaises(UnknownTaskError):
            ex.submit(Task("a", _noop, deps=["ghost"]))

    def test_duplicate_submit_rejected(self):
        ex = WorkStealingExecutor()
        ex.submit(Task("a", _noop))
        with self.assertRaises(DuplicateTaskError):
            ex.submit(Task("a", _noop))

    def test_submit_many_is_atomic(self):
        ex = WorkStealingExecutor()
        with self.assertRaises(UnknownTaskError):
            ex.submit_many([Task("ok", _noop), Task("bad", _noop, deps=["ghost"])])
        # Nothing was committed: 'ok' can be submitted again.
        ex.submit(Task("ok", _noop))
        self.assertEqual(ex.get_state()["total"], 1)

    def test_cycle_detection_reports_cycle(self):
        ex = WorkStealingExecutor()
        with self.assertRaises(CycleError) as ctx:
            ex.submit_many(
                [
                    Task("a", _noop, deps=["c"]),
                    Task("b", _noop, deps=["a"]),
                    Task("c", _noop, deps=["b"]),
                ]
            )
        cycle = ctx.exception.cycle
        self.assertEqual(cycle[0], cycle[-1])
        self.assertEqual(set(cycle), {"a", "b", "c"})
        self.assertIn("->", str(ctx.exception))
        # Atomic: no tasks were committed.
        self.assertEqual(ex.get_state()["total"], 0)

    def test_two_node_cycle(self):
        ex = WorkStealingExecutor()
        with self.assertRaises(CycleError):
            ex.submit_many([Task("a", _noop, deps=["b"]), Task("b", _noop, deps=["a"])])

    def test_invalid_workers_rejected(self):
        with self.assertRaises(ValidationError):
            WorkStealingExecutor(workers=0)


class SchedulingTests(unittest.TestCase):
    """Dependency-ordered scheduling behaviour."""

    def test_empty_run_returns_immediately(self):
        ex = WorkStealingExecutor(workers=2)
        start = time.monotonic()
        ex.run()
        self.assertLess(time.monotonic() - start, 2.0)
        self.assertTrue(ex.get_state()["finished"])

    def test_single_task(self):
        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("only", lambda: 42))
        ex.run()
        result = ex.get_result("only")
        self.assertEqual(result["state"], "success")
        self.assertEqual(result["result"], 42)
        self.assertEqual(result["attempts"], 1)

    def test_dependency_order_chain(self):
        order = []
        lock = threading.Lock()

        def make(name):
            def payload():
                with lock:
                    order.append(name)
                return name

            return payload

        ex = WorkStealingExecutor(workers=4)
        ex.submit(Task("t0", make("t0")))
        for i in range(1, 10):
            ex.submit(Task(f"t{i}", make(f"t{i}"), deps=[f"t{i - 1}"]))
        ex.run()
        self.assertEqual(order, [f"t{i}" for i in range(10)])

    def test_diamond_dependencies(self):
        order = []
        lock = threading.Lock()

        def make(name):
            def payload():
                with lock:
                    order.append(name)
                return name

            return payload

        ex = WorkStealingExecutor(workers=4)
        ex.submit_many(
            [
                Task("a", make("a")),
                Task("b", make("b"), deps=["a"]),
                Task("c", make("c"), deps=["a"]),
                Task("d", make("d"), deps=["b", "c"]),
            ]
        )
        ex.run()
        self.assertEqual(order[0], "a")
        self.assertEqual(order[-1], "d")
        self.assertEqual(set(order[1:3]), {"b", "c"})
        self.assertEqual(ex.get_state()["succeeded"], 4)

    def test_wide_dag_respects_all_edges(self):
        order = []
        lock = threading.Lock()

        def make(name):
            def payload():
                time.sleep(0.001)
                with lock:
                    order.append(name)
                return name

            return payload

        ex = WorkStealingExecutor(workers=4)
        tasks = [Task(f"root{i}", make(f"root{i}")) for i in range(5)]
        for i in range(5):
            tasks.append(Task(f"mid{i}", make(f"mid{i}"), deps=[f"root{i}"]))
        tasks.append(Task("join", make("join"), deps=[f"mid{i}" for i in range(5)]))
        ex.submit_many(tasks)
        ex.run()
        position = {name: idx for idx, name in enumerate(order)}
        for i in range(5):
            self.assertLess(position[f"root{i}"], position[f"mid{i}"])
            self.assertLess(position[f"mid{i}"], position["join"])
        self.assertEqual(ex.get_state()["succeeded"], 11)

    def test_single_worker_no_steals(self):
        ex = WorkStealingExecutor(workers=1)
        ex.submit_many([Task(f"t{i}", lambda i=i: i) for i in range(6)])
        ex.run()
        state = ex.get_state()
        self.assertEqual(state["steals"], 0)
        self.assertEqual(state["succeeded"], 6)

    def test_run_twice_raises(self):
        ex = WorkStealingExecutor(workers=1)
        ex.run()
        with self.assertRaises(StateError):
            ex.run()

    def test_submit_after_finish_raises(self):
        ex = WorkStealingExecutor(workers=1)
        ex.run()
        with self.assertRaises(StateError):
            ex.submit(Task("late", _noop))


class FailureAndRetryTests(unittest.TestCase):
    """Failure recording, retries and downstream skipping."""

    def test_failure_recorded(self):
        def boom():
            raise ValueError("bad things")

        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("f", boom))
        ex.run()
        result = ex.get_result("f")
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["error"]["type"], "ValueError")
        self.assertEqual(result["error"]["message"], "bad things")
        self.assertEqual(result["attempts"], 1)

    def test_retry_then_success(self):
        calls = {"n": 0}

        def flaky():
            calls["n"] += 1
            if calls["n"] < 3:
                raise RuntimeError("not yet")
            return "ok"

        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("flaky", flaky, max_retries=2))
        ex.run()
        result = ex.get_result("flaky")
        self.assertEqual(result["state"], "success")
        self.assertEqual(result["result"], "ok")
        self.assertEqual(result["attempts"], 3)

    def test_retry_exhausted_marks_failed(self):
        def always_fail():
            raise RuntimeError("nope")

        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("f", always_fail, max_retries=2))
        ex.run()
        result = ex.get_result("f")
        self.assertEqual(result["state"], "failed")
        self.assertEqual(result["attempts"], 3)  # 1 initial + 2 retries

    def test_downstream_skipped_with_reason(self):
        def boom():
            raise RuntimeError("broken")

        ex = WorkStealingExecutor(workers=2)
        ex.submit_many(
            [
                Task("a", boom),
                Task("b", _noop, deps=["a"]),
                Task("c", _noop, deps=["b"]),
                Task("d", lambda: "fine"),
            ]
        )
        ex.run()
        self.assertEqual(ex.get_result("a")["state"], "failed")
        b = ex.get_result("b")
        c = ex.get_result("c")
        self.assertEqual(b["state"], "skipped")
        self.assertIn("a", b["skip_reason"])
        self.assertEqual(c["state"], "skipped")
        self.assertEqual(ex.get_result("d")["state"], "success")
        state = ex.get_state()
        self.assertEqual(state["failed"], 1)
        self.assertEqual(state["skipped"], 2)

    def test_all_tasks_fail_run_still_completes(self):
        ex = WorkStealingExecutor(workers=2)
        ex.submit_many(
            [Task(f"f{i}", lambda: (_ for _ in ()).throw(RuntimeError("x"))) for i in range(5)]
        )
        start = time.monotonic()
        ex.run()
        self.assertLess(time.monotonic() - start, 5.0)
        self.assertEqual(ex.get_state()["failed"], 5)

    def test_non_serializable_result_fails_task(self):
        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("bad", lambda: object()))
        ex.run()
        result = ex.get_result("bad")
        self.assertEqual(result["state"], "failed")
        self.assertIn("JSON", result["error"]["message"])

    def test_get_result_unknown_task(self):
        ex = WorkStealingExecutor(workers=1)
        with self.assertRaises(UnknownTaskError):
            ex.get_result("nope")


class TimeoutTests(unittest.TestCase):
    """Timeout handling, including uncooperative payloads."""

    def test_timeout_cooperative_payload(self):
        def slow():
            token = current_cancel_token()
            while not token.is_cancelled:
                time.sleep(0.005)
            return "late"  # discarded: the attempt already timed out

        ex = WorkStealingExecutor(workers=1, cancel_grace=0.1)
        ex.submit(Task("slow", slow, timeout=0.1))
        start = time.monotonic()
        ex.run()
        self.assertLess(time.monotonic() - start, 3.0)
        result = ex.get_result("slow")
        self.assertEqual(result["state"], "timeout")
        self.assertEqual(result["error"]["type"], "TimeoutError")

    def test_timeout_stubborn_payload_is_abandoned(self):
        def stubborn():
            time.sleep(30)  # never checks the token
            return None

        ex = WorkStealingExecutor(workers=1, cancel_grace=0.05)
        ex.submit(Task("stubborn", stubborn, timeout=0.05))
        start = time.monotonic()
        ex.run()
        # run() must not wait for the orphaned payload thread.
        self.assertLess(time.monotonic() - start, 5.0)
        self.assertEqual(ex.get_result("stubborn")["state"], "timeout")

    def test_timeout_consumes_retries(self):
        def slow():
            time.sleep(5)

        ex = WorkStealingExecutor(workers=1, cancel_grace=0.02)
        ex.submit(Task("t", slow, timeout=0.05, max_retries=1))
        start = time.monotonic()
        ex.run()
        self.assertLess(time.monotonic() - start, 5.0)
        result = ex.get_result("t")
        self.assertEqual(result["state"], "timeout")
        self.assertEqual(result["attempts"], 2)

    def test_timeout_then_success_on_retry(self):
        attempts = {"n": 0}

        def sometimes_slow():
            attempts["n"] += 1
            if attempts["n"] == 1:
                token = current_cancel_token()
                while not token.is_cancelled:
                    time.sleep(0.005)
                return "late"
            return "recovered"

        ex = WorkStealingExecutor(workers=1, cancel_grace=0.05)
        ex.submit(Task("t", sometimes_slow, timeout=0.05, max_retries=1))
        ex.run()
        result = ex.get_result("t")
        self.assertEqual(result["state"], "success")
        self.assertEqual(result["result"], "recovered")
        self.assertEqual(result["attempts"], 2)


class CancelTests(unittest.TestCase):
    """Cancellation of pending and running tasks."""

    def test_cancel_pending_task_cascades(self):
        ex = WorkStealingExecutor(workers=1)
        ex.submit_many(
            [
                Task("a", _noop, deps=["b"]),
                Task("b", _noop, deps=["c"]),
                Task("c", _noop, deps=["d"]),
                Task("d", lambda: time.sleep(0.05)),
            ]
        )
        ex.cancel("c")
        ex.run()
        self.assertEqual(ex.get_result("c")["state"], "cancelled")
        # 'b' and 'a' never run: their dependency was cancelled.
        self.assertEqual(ex.get_result("b")["state"], "skipped")
        self.assertIn("c", ex.get_result("b")["skip_reason"])
        self.assertEqual(ex.get_result("a")["state"], "skipped")
        self.assertEqual(ex.get_result("d")["state"], "success")

    def test_cancel_running_task(self):
        started = threading.Event()

        def long_running():
            started.set()
            token = current_cancel_token()
            while not token.is_cancelled:
                time.sleep(0.005)
            return "discarded"

        ex = WorkStealingExecutor(workers=1, cancel_grace=0.1)
        ex.submit(Task("run_me", long_running))
        ex.submit(Task("down", _noop, deps=["run_me"]))
        runner = threading.Thread(target=ex.run)
        runner.start()
        self.assertTrue(started.wait(timeout=5.0))
        ex.cancel("run_me")
        runner.join(timeout=5.0)
        self.assertFalse(runner.is_alive())
        self.assertEqual(ex.get_result("run_me")["state"], "cancelled")
        self.assertEqual(ex.get_result("down")["state"], "skipped")

    def test_cancel_unknown_task(self):
        ex = WorkStealingExecutor()
        with self.assertRaises(UnknownTaskError):
            ex.cancel("ghost")

    def test_cancel_completed_task(self):
        ex = WorkStealingExecutor(workers=1)
        ex.submit(Task("a", _noop))
        ex.run()
        with self.assertRaises(StateError):
            ex.cancel("a")


class WorkStealingTests(unittest.TestCase):
    """Work stealing between worker queues."""

    def test_stealing_happens_and_tasks_run_once(self):
        lock = threading.Lock()
        run_counts = {}

        def make(name):
            def payload():
                with lock:
                    run_counts[name] = run_counts.get(name, 0) + 1
                return name

            return payload

        ex = WorkStealingExecutor(workers=4)
        # First task blocks worker 0; the other workers must steal the
        # remaining tasks off worker 0's queue.
        ex.submit(Task("long", lambda: (time.sleep(0.5), "done")[1]))
        names = [f"t{i}" for i in range(16)]
        for name in names:
            ex.submit(Task(name, make(name)))
        ex.run()
        state = ex.get_state()
        self.assertGreater(state["steals"], 0)
        self.assertEqual(state["succeeded"], 17)
        for name in names:
            self.assertEqual(run_counts.get(name), 1, f"{name} ran {run_counts.get(name)} times")
        total_executed = sum(w["executed"] for w in state["workers"])
        self.assertEqual(total_executed, 17)

    def test_stealing_respects_dependencies(self):
        order = []
        lock = threading.Lock()

        def make(name):
            def payload():
                with lock:
                    order.append(name)
                return name

            return payload

        ex = WorkStealingExecutor(workers=4)
        ex.submit(Task("a", lambda: (time.sleep(0.1), "a")[1]))
        ex.submit(Task("b", make("b"), deps=["a"]))
        ex.run()
        self.assertEqual(order, ["b"])
        self.assertEqual(ex.get_result("b")["state"], "success")


class PersistenceTests(unittest.TestCase):
    """save()/load() round trips and corrupt-snapshot handling."""

    def _build_finished_executor(self) -> WorkStealingExecutor:
        def boom():
            raise ValueError("kaput")

        def slow():
            token = current_cancel_token()
            while not token.is_cancelled:
                time.sleep(0.005)
            return "late"

        ex = WorkStealingExecutor(workers=2, cancel_grace=0.05)
        ex.submit_many(
            [
                Task("ok", lambda: {"nested": [1, 2, 3]}),
                Task("fail", boom, max_retries=1),
                Task("slow", slow, timeout=0.05),
                Task("child", _noop, deps=["fail"]),
                Task("cancelled", _noop, deps=["ok"]),
            ]
        )
        ex.cancel("cancelled")
        ex.run()
        return ex

    def test_save_load_roundtrip(self):
        ex = self._build_finished_executor()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "snap.json")
            ex.save(path)
            loaded = WorkStealingExecutor.load(path)
        self.assertEqual(ex.get_state()["tasks"], loaded.get_state()["tasks"])
        for tid in ("ok", "fail", "slow", "child", "cancelled"):
            self.assertEqual(ex.get_result(tid), loaded.get_result(tid))
        self.assertEqual(loaded.get_result("ok")["result"], {"nested": [1, 2, 3]})
        self.assertEqual(loaded.get_result("fail")["attempts"], 2)
        self.assertEqual(loaded.get_result("slow")["state"], "timeout")
        self.assertEqual(loaded.get_result("child")["state"], "skipped")
        self.assertEqual(loaded.get_result("cancelled")["state"], "cancelled")

    def _write(self, tmp, data):
        path = os.path.join(tmp, "snap.json")
        if isinstance(data, str):
            text = data
        else:
            text = json.dumps(data)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        return path

    def _valid_snapshot(self):
        return {
            "version": 1,
            "config": {"workers": 2, "cancel_grace": 0.5},
            "tasks": [
                {
                    "task_id": "a",
                    "deps": [],
                    "timeout": None,
                    "max_retries": 0,
                    "state": "success",
                    "attempts": 1,
                    "result": 1,
                    "error": None,
                    "skip_reason": None,
                }
            ],
        }

    def test_load_missing_file(self):
        with self.assertRaises(SnapshotError):
            WorkStealingExecutor.load("/nonexistent/path/snap.json")

    def test_load_corrupt_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = self._write(tmp, "{not json")
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("not valid JSON", str(ctx.exception))

    def test_load_missing_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            del snap["tasks"][0]["timeout"]
            path = self._write(tmp, snap)
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("timeout", str(ctx.exception))

    def test_load_duplicate_task_ids(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            snap["tasks"].append(dict(snap["tasks"][0]))
            path = self._write(tmp, snap)
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("duplicate", str(ctx.exception))

    def test_load_unknown_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            snap["tasks"][0]["deps"] = ["ghost"]
            path = self._write(tmp, snap)
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("ghost", str(ctx.exception))

    def test_load_cycle_detected(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            task_a = snap["tasks"][0]
            task_b = dict(task_a, task_id="b", deps=["a"], state="success")
            task_a["deps"] = ["b"]
            snap["tasks"].append(task_b)
            path = self._write(tmp, snap)
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("cycle", str(ctx.exception))

    def test_load_illegal_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            snap["tasks"][0]["state"] = "bogus"
            path = self._write(tmp, snap)
            with self.assertRaises(SnapshotError) as ctx:
                WorkStealingExecutor.load(path)
            self.assertIn("bogus", str(ctx.exception))

    def test_load_unfinished_snapshot_cannot_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            snap = self._valid_snapshot()
            snap["tasks"][0]["state"] = "pending"
            snap["tasks"][0]["attempts"] = 0
            snap["tasks"][0]["result"] = None
            path = self._write(tmp, snap)
            loaded = WorkStealingExecutor.load(path)
            with self.assertRaises(StateError):
                loaded.run()


class CliTests(unittest.TestCase):
    """End-to-end test of the JSON-lines command interface."""

    def test_cli_session(self):
        main_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "main.py")
        with tempfile.TemporaryDirectory() as tmp:
            snap = os.path.join(tmp, "snap.json")
            commands = [
                {"cmd": "submit", "task_id": "a", "payload": {"kind": "const", "value": 1}},
                {
                    "cmd": "submit",
                    "task_id": "b",
                    "deps": ["a"],
                    "payload": {"kind": "sleep", "seconds": 0.02, "value": 2},
                },
                {
                    "cmd": "submit",
                    "task_id": "c",
                    "deps": ["b"],
                    "payload": {"kind": "fail", "message": "boom"},
                    "max_retries": 1,
                },
                {"cmd": "run"},
                {"cmd": "result", "task_id": "c"},
                {"cmd": "state"},
                {"cmd": "save", "path": snap},
                {"cmd": "load", "path": snap},
                {"cmd": "result", "task_id": "c"},
                {"cmd": "dump"},
                {"cmd": "cancel", "task_id": "nope"},
                {"cmd": "bogus"},
            ]
            stdin = "\n".join(json.dumps(c) for c in commands) + "\nnot json\n"
            proc = subprocess.run(
                [sys.executable, main_py, "2"],
                input=stdin,
                capture_output=True,
                text=True,
                timeout=60,
            )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        lines = [json.loads(line) for line in proc.stdout.strip().splitlines()]
        self.assertEqual(len(lines), len(commands) + 1)

        for i in range(4):
            self.assertTrue(lines[i]["ok"], lines[i])
        self.assertTrue(lines[4]["ok"])
        self.assertEqual(lines[4]["result"]["state"], "failed")
        self.assertEqual(lines[4]["result"]["attempts"], 2)
        self.assertEqual(lines[4]["result"]["error"]["message"], "boom")
        self.assertTrue(lines[5]["ok"])
        self.assertEqual(lines[5]["state"]["counts"]["success"], 2)
        self.assertEqual(lines[5]["state"]["counts"]["failed"], 1)
        self.assertTrue(lines[6]["ok"])  # save
        self.assertTrue(lines[7]["ok"])  # load
        self.assertEqual(lines[8]["result"]["state"], "failed")
        self.assertTrue(lines[9]["ok"])
        self.assertEqual(len(lines[9]["snapshot"]["tasks"]), 3)
        self.assertFalse(lines[10]["ok"])
        self.assertIn("error", lines[10])
        self.assertFalse(lines[11]["ok"])
        self.assertEqual(lines[11]["error"]["type"], "UnknownCommand")
        self.assertFalse(lines[12]["ok"])
        self.assertEqual(lines[12]["error"]["type"], "InvalidJSON")


if __name__ == "__main__":
    unittest.main()
