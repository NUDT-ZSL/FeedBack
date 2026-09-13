"""Unit tests for the workflow orchestration kernel.

Covers: transition matching and priority, guard parsing/evaluation, action
execution, compensation rollback, logical-clock timers, consistency
validation, snapshot save/load round-trips, load error handling, and the
JSON command-line dispatcher.
"""

from __future__ import annotations

import json
import os
import tempfile
import unittest

from guards import (
    GuardEvaluationError,
    GuardSyntaxError,
    check_guard,
    evaluate_guard,
    parse_guard,
)
from kernel import (
    ClockError,
    DefinitionError,
    InstanceError,
    PersistenceError,
    WorkflowEngine,
)
from main import handle_command


def order_spec() -> dict:
    """A small order-flow machine used by several tests."""
    return {
        "machine_id": "order",
        "initial": "created",
        "states": [
            {"name": "created"},
            {"name": "paid"},
            {"name": "shipped"},
            {"name": "cancelled", "terminal": True},
        ],
        "transitions": [
            {
                "from": "created",
                "to": "paid",
                "event": "pay",
                "guard": "amount >= 100",
                "action": "charge",
                "priority": 1,
            },
            {
                "from": "created",
                "to": "cancelled",
                "event": "pay",
                "guard": "amount < 100",
                "priority": 2,
            },
            {"from": "paid", "to": "shipped", "event": "ship"},
        ],
    }


class GuardTests(unittest.TestCase):
    """Guard expression parsing and evaluation."""

    def test_comparison_and_logic(self) -> None:
        variables = {"x": 10, "name": "abc"}
        self.assertTrue(check_guard("x >= 10 AND name == 'abc'", variables))
        self.assertFalse(check_guard("x > 10 AND name == 'abc'", variables))
        self.assertTrue(check_guard("x < 10 OR name != 'zzz'", variables))

    def test_precedence_and_parentheses(self) -> None:
        # AND binds tighter than OR.
        self.assertTrue(check_guard("x == 1 OR x == 2 AND y == 3", {"x": 1, "y": 0}))
        self.assertFalse(check_guard("(x == 1 OR x == 2) AND y == 3", {"x": 1, "y": 0}))
        self.assertTrue(check_guard("NOT (x == 1 OR x == 2)", {"x": 3}))
        self.assertTrue(check_guard("NOT x == 1", {"x": 2}))
        self.assertTrue(check_guard("not x == 1 and y", {"x": 2, "y": 7}))

    def test_literals_and_truthiness(self) -> None:
        self.assertTrue(check_guard("x == -5", {"x": -5}))
        self.assertTrue(check_guard('name == "a b"', {"name": "a b"}))
        self.assertTrue(check_guard("x", {"x": 3}))
        self.assertFalse(check_guard("x", {"x": 0}))
        self.assertFalse(check_guard("s", {"s": ""}))
        self.assertTrue(check_guard("NOT s", {"s": ""}))

    def test_syntax_errors(self) -> None:
        for bad in ("", "   ", "x ==", "(x == 1", "x == 1)", "x ~ 3",
                    "x && y", "== 1", "x == 'unterminated"):
            with self.assertRaises(GuardSyntaxError, msg=bad):
                parse_guard(bad)

    def test_evaluation_errors(self) -> None:
        with self.assertRaises(GuardEvaluationError):
            evaluate_guard(parse_guard("missing == 1"), {})
        with self.assertRaises(GuardEvaluationError):
            evaluate_guard(parse_guard("x < 'a'"), {"x": 1})
        # Equality across types is defined instead of raising.
        self.assertFalse(check_guard("x == 'a'", {"x": 1}))
        self.assertTrue(check_guard("x != 'a'", {"x": 1}))


class TransitionMatchingTests(unittest.TestCase):
    """Priority ordering and guard-based branch selection."""

    def setUp(self) -> None:
        self.engine = WorkflowEngine()
        self.engine.define_machine(order_spec())
        self.engine.register_action("charge", lambda v: {**v, "charged": 1})

    def test_priority_order_first_guard_true_wins(self) -> None:
        self.engine.create_instance("order", "o1", {"amount": 150})
        result = self.engine.send_event("o1", "pay")
        self.assertTrue(result.ok)
        self.assertEqual(result.state, "paid")
        self.assertEqual(result.transition["to"], "paid")
        self.assertEqual(self.engine.get_instance("o1")["variables"]["charged"], 1)

    def test_lower_priority_branch_when_guard_false(self) -> None:
        self.engine.create_instance("order", "o2", {"amount": 50})
        result = self.engine.send_event("o2", "pay")
        self.assertTrue(result.ok)
        self.assertEqual(result.state, "cancelled")

    def test_no_matching_guard(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "m",
            "initial": "s",
            "states": ["s", "t"],
            "transitions": [
                {"from": "s", "to": "t", "event": "go", "guard": "x == 1"},
            ],
        })
        engine.create_instance("m", "i", {"x": 2})
        result = engine.send_event("i", "go")
        self.assertFalse(result.ok)
        self.assertIn("guard_not_matched", result.reason)
        self.assertEqual(result.state, "s")

    def test_no_transition_and_terminal_state(self) -> None:
        self.engine.create_instance("order", "o3", {"amount": 10})
        self.assertEqual(self.engine.send_event("o3", "pay").state, "cancelled")
        result = self.engine.send_event("o3", "pay")
        self.assertFalse(result.ok)
        self.assertIn("terminal_state", result.reason)
        # Unknown event on a live state.
        self.engine.create_instance("order", "o4", {"amount": 1})
        result = self.engine.send_event("o4", "explode")
        self.assertFalse(result.ok)
        self.assertIn("no_transition", result.reason)

    def test_unknown_instance_and_bad_event(self) -> None:
        result = self.engine.send_event("nope", "pay")
        self.assertFalse(result.ok)
        self.assertIn("instance_not_found", result.reason)
        self.engine.create_instance("order", "o5", {"amount": 1})
        result = self.engine.send_event("o5", "")
        self.assertFalse(result.ok)

    def test_single_state_no_transitions(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "lonely", "initial": "only", "states": ["only"],
        })
        engine.create_instance("lonely", "i")
        result = engine.send_event("i", "anything")
        self.assertFalse(result.ok)
        self.assertIn("no_transition", result.reason)


class InstanceAndActionTests(unittest.TestCase):
    """Instance lifecycle, variable validation, action execution."""

    def test_duplicate_and_empty_instance_id(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        engine.create_instance("order", "o1")
        with self.assertRaises(InstanceError):
            engine.create_instance("order", "o1")
        with self.assertRaises(InstanceError):
            engine.create_instance("order", "")
        with self.assertRaises(InstanceError):
            engine.create_instance("missing-machine", "x")

    def test_variable_type_validation(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        for bad in ({"f": 1.5}, {"b": True}, {"l": [1]}, {1: "x"}, {"n": None}):
            with self.assertRaises(InstanceError, msg=repr(bad)):
                engine.create_instance("order", "i", bad)

    def test_unregistered_action_rejected(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())  # action "charge" not registered
        engine.create_instance("order", "o1", {"amount": 500})
        result = engine.send_event("o1", "pay")
        self.assertFalse(result.ok)
        self.assertIn("unregistered_action", result.reason)
        self.assertEqual(self.engine_state(engine, "o1"), "created")

    def test_action_modifies_variables_and_history(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        engine.register_action("charge", lambda v: {**v, "charged": 1})
        engine.create_instance("order", "o1", {"amount": 200})
        engine.tick(3)
        result = engine.send_event("o1", "pay")
        self.assertTrue(result.ok)
        instance = engine.get_instance("o1")
        self.assertEqual(instance["variables"], {"amount": 200, "charged": 1})
        history = engine.get_history("o1")
        self.assertEqual(len(history), 1)
        entry = history[0]
        self.assertEqual((entry["from"], entry["to"], entry["event"]),
                         ("created", "paid", "pay"))
        self.assertEqual(entry["timestamp"], 3)
        self.assertEqual(entry["action_result"]["status"], "ok")

    def test_action_returning_invalid_variables_fails_and_rolls_back(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        engine.register_action("charge", lambda v: {"bad": 1.5})
        engine.create_instance("order", "o1", {"amount": 200})
        result = engine.send_event("o1", "pay")
        self.assertFalse(result.ok)
        self.assertEqual(engine.get_instance("o1")["state"], "created")
        self.assertEqual(engine.get_instance("o1")["variables"], {"amount": 200})

    @staticmethod
    def engine_state(engine: WorkflowEngine, instance_id: str) -> str:
        return engine.get_instance(instance_id)["state"]


class CompensationTests(unittest.TestCase):
    """Rollback with compensation functions on action failure."""

    def build(self):
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "saga",
            "initial": "start",
            "states": ["start", "done"],
            "transitions": [
                {"from": "start", "to": "done", "event": "run",
                 "actions": ["a1", "a2", "boom"]},
            ],
        })
        calls = []

        def make_action(key, value):
            def action(variables):
                variables = dict(variables)
                variables[key] = value
                return variables
            return action

        def make_compensation(name, fail=False):
            def compensation(variables):
                calls.append(name)
                if fail:
                    raise RuntimeError(f"compensation {name} exploded")
                return variables
            return compensation

        engine.register_action("a1", make_action("x", 1))
        engine.register_action("a2", make_action("y", 2))

        def boom(variables):
            raise RuntimeError("boom went off")

        engine.register_action("boom", boom)
        return engine, calls, make_compensation

    def test_rollback_restores_state_and_variables_reverse_order(self) -> None:
        engine, calls, make_compensation = self.build()
        engine.register_compensation("a1", make_compensation("c1"))
        engine.register_compensation("a2", make_compensation("c2"))
        engine.create_instance("saga", "i", {"keep": "yes"})
        result = engine.send_event("i", "run")
        self.assertFalse(result.ok)
        self.assertIn("action_failed", result.reason)
        self.assertIn("boom went off", result.reason)
        # Compensations ran in reverse application order.
        self.assertEqual(calls, ["c2", "c1"])
        # Instance fully restored.
        instance = engine.get_instance("i")
        self.assertEqual(instance["state"], "start")
        self.assertEqual(instance["variables"], {"keep": "yes"})
        self.assertEqual(result.compensation_failures, [])
        # Failure recorded in history.
        entry = engine.get_history("i")[-1]
        self.assertEqual(entry["action_result"]["status"], "failed")
        self.assertTrue(entry["action_result"]["rolled_back"])
        self.assertEqual(entry["from"], "start")
        self.assertEqual(entry["to"], "start")

    def test_compensation_failure_is_recorded_and_others_continue(self) -> None:
        engine, calls, make_compensation = self.build()
        engine.register_compensation("a1", make_compensation("c1", fail=True))
        engine.register_compensation("a2", make_compensation("c2"))
        engine.create_instance("saga", "i")
        result = engine.send_event("i", "run")
        self.assertFalse(result.ok)
        self.assertEqual(calls, ["c2", "c1"])  # c2 still ran before c1 failed
        self.assertEqual(len(result.compensation_failures), 1)
        self.assertIn("a1", result.compensation_failures[0])
        self.assertIn("exploded", result.compensation_failures[0])
        entry = engine.get_history("i")[-1]
        self.assertEqual(
            entry["action_result"]["compensation_failures"],
            result.compensation_failures,
        )

    def test_missing_compensation_is_not_an_error(self) -> None:
        engine, _calls, _mk = self.build()  # no compensations registered at all
        engine.create_instance("saga", "i")
        result = engine.send_event("i", "run")
        self.assertFalse(result.ok)
        self.assertEqual(result.compensation_failures, [])


class TimerTests(unittest.TestCase):
    """Logical-clock timers and deterministic tick ordering."""

    def build(self, after: int = 5) -> WorkflowEngine:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "session",
            "initial": "active",
            "states": ["active", "expired", "closed"],
            "transitions": [
                {"from": "active", "to": "expired", "event": "timeout"},
                {"from": "active", "to": "closed", "event": "close"},
            ],
            "timers": [{"state": "active", "after": after, "event": "timeout"}],
        })
        return engine

    def test_timer_fires_exactly_at_deadline(self) -> None:
        engine = self.build(after=5)
        engine.create_instance("session", "s1")
        self.assertEqual(engine.tick(4), [])
        self.assertEqual(engine.get_instance("s1")["state"], "active")
        fired = engine.tick(1)  # clock now 5 == deadline
        self.assertEqual(len(fired), 1)
        self.assertTrue(fired[0].ok)
        self.assertEqual(engine.get_instance("s1")["state"], "expired")

    def test_timer_does_not_refire(self) -> None:
        engine = self.build(after=1)
        engine.create_instance("session", "s1")
        engine.tick(1)
        self.assertEqual(engine.tick(10), [])

    def test_timer_cancelled_when_leaving_state(self) -> None:
        engine = self.build(after=5)
        engine.create_instance("session", "s1")
        engine.send_event("s1", "close")
        self.assertEqual(engine.tick(10), [])
        self.assertEqual(engine.get_instance("s1")["state"], "closed")

    def test_firing_order_deadline_then_instance_id(self) -> None:
        engine = self.build(after=3)
        engine.create_instance("session", "b")  # deadline 3
        engine.tick(1)
        engine.create_instance("session", "a")  # deadline 4
        engine.create_instance("session", "c")  # deadline 4
        fired = engine.tick(3)  # clock = 4, all three due
        self.assertEqual([r.instance_id for r in fired], ["b", "a", "c"])
        self.assertTrue(all(r.ok for r in fired))

    def test_negative_tick_rejected(self) -> None:
        engine = self.build()
        with self.assertRaises(ClockError):
            engine.tick(-1)
        self.assertEqual(engine.clock, 0)

    def test_timer_event_without_transition_is_consumed(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "m",
            "initial": "s",
            "states": ["s"],
            "transitions": [],
            "timers": [{"state": "s", "after": 1, "event": "nothing"}],
        })
        engine.create_instance("m", "i")
        fired = engine.tick(1)
        self.assertEqual(len(fired), 1)
        self.assertFalse(fired[0].ok)
        self.assertIn("no_transition", fired[0].reason)
        # Consumed: no infinite re-firing on later ticks.
        self.assertEqual(engine.tick(5), [])

    def test_register_timer_api(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "m", "initial": "s", "states": ["s", "t"],
            "transitions": [{"from": "s", "to": "t", "event": "go"}],
        })
        engine.register_timer("m", "s", 2, "go")
        engine.create_instance("m", "i")
        engine.tick(2)
        self.assertEqual(engine.get_instance("i")["state"], "t")
        with self.assertRaises(DefinitionError):
            engine.register_timer("m", "ghost-state", 1, "go")
        with self.assertRaises(DefinitionError):
            engine.register_timer("unknown", "s", 1, "go")


class ValidateTests(unittest.TestCase):
    """Consistency validation collects every diagnostic, sorted."""

    def test_clean_machine_has_no_diagnostics(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        self.assertEqual(engine.validate("order"), [])

    def test_all_problem_kinds_reported(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "broken",
            "initial": "nowhere",
            "states": [{"name": "a"}, {"name": "dead", "terminal": True}],
            "transitions": [
                {"from": "a", "to": "ghost", "event": "e1", "priority": 0},
                {"from": "missing", "to": "a", "event": "e2", "priority": 0},
                {"from": "a", "to": "a", "event": "e1", "priority": 0},  # dup priority
                {"from": "a", "to": "a", "event": "e3", "guard": "x =="},
                {"from": "dead", "to": "a", "event": "e4"},  # terminal out-edge
            ],
            "timers": [{"state": "limbo", "after": 1, "event": "e5"}],
        })
        diagnostics = engine.validate("broken")
        messages = "\n".join(d.message for d in diagnostics)
        self.assertIn("initial state 'nowhere'", messages)
        self.assertIn("target state 'ghost'", messages)
        self.assertIn("source state 'missing'", messages)
        self.assertIn("priority 0 is used by 2 transitions", messages)
        self.assertIn("guard is not parseable", messages)
        self.assertIn("terminal state 'dead'", messages)
        self.assertIn("undefined state 'limbo'", messages)
        # Sorted by (machine_id, location) and fully reported, not just one.
        keys = [(d.machine_id, d.location) for d in diagnostics]
        self.assertEqual(keys, sorted(keys))
        self.assertGreaterEqual(len(diagnostics), 7)
        self.assertTrue(all(d.machine_id == "broken" for d in diagnostics))

    def test_validate_unknown_machine(self) -> None:
        engine = WorkflowEngine()
        with self.assertRaises(DefinitionError):
            engine.validate("nope")

    def test_guard_error_surfaces_at_send_time(self) -> None:
        engine = WorkflowEngine()
        engine.define_machine({
            "machine_id": "m",
            "initial": "s",
            "states": ["s", "t"],
            "transitions": [
                {"from": "s", "to": "t", "event": "go", "guard": "x =="},
            ],
        })
        engine.create_instance("m", "i", {"x": 1})
        result = engine.send_event("i", "go")
        self.assertFalse(result.ok)
        self.assertIn("guard_error", result.reason)


class PersistenceTests(unittest.TestCase):
    """Snapshot save/load round-trips and load-time validation."""

    def build_busy_engine(self) -> WorkflowEngine:
        engine = WorkflowEngine()
        engine.define_machine(order_spec())
        engine.define_machine({
            "machine_id": "session",
            "initial": "active",
            "states": ["active", "expired"],
            "transitions": [{"from": "active", "to": "expired", "event": "timeout"}],
            "timers": [{"state": "active", "after": 5, "event": "timeout"}],
        })
        engine.register_action("charge", lambda v: {**v, "charged": 1})
        engine.create_instance("order", "o1", {"amount": 250})
        engine.create_instance("session", "s1")
        engine.tick(2)
        engine.send_event("o1", "pay")
        return engine

    def roundtrip(self, engine: WorkflowEngine) -> WorkflowEngine:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            engine.save(path)
            clone = WorkflowEngine()
            clone.load(path)
            return clone

    def test_snapshot_roundtrip_is_identical(self) -> None:
        engine = self.build_busy_engine()
        clone = self.roundtrip(engine)
        self.assertEqual(engine.snapshot(), clone.snapshot())
        self.assertEqual(clone.clock, engine.clock)
        self.assertEqual(clone.get_history("o1"), engine.get_history("o1"))

    def test_timers_survive_roundtrip(self) -> None:
        engine = self.build_busy_engine()
        clone = self.roundtrip(engine)
        fired = clone.tick(3)  # s1 entered at clock 2, after 5 -> deadline 7
        self.assertEqual(len(fired), 1)
        self.assertEqual(clone.get_instance("s1")["state"], "expired")

    def test_load_missing_file(self) -> None:
        engine = WorkflowEngine()
        with self.assertRaises(PersistenceError):
            engine.load("definitely/not/a/real/path.json")

    def test_load_corrupt_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "bad.json")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write("{not json")
            with self.assertRaises(PersistenceError) as ctx:
                WorkflowEngine().load(path)
            self.assertIn("not valid JSON", str(ctx.exception))

    def test_load_missing_field(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "missing.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"version": 1, "clock": 0, "machines": []}, handle)
            with self.assertRaises(PersistenceError) as ctx:
                WorkflowEngine().load(path)
            self.assertIn("instances", str(ctx.exception))

    def _write_and_load(self, snapshot: dict):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(snapshot, handle)
            engine = WorkflowEngine()
            engine.load(path)
            return engine

    def base_snapshot(self) -> dict:
        engine = self.build_busy_engine()
        return engine.snapshot()

    def test_load_duplicate_instance_id(self) -> None:
        snapshot = self.base_snapshot()
        snapshot["instances"].append(dict(snapshot["instances"][0]))
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("duplicate instance_id", str(ctx.exception))

    def test_load_unknown_current_state(self) -> None:
        snapshot = self.base_snapshot()
        snapshot["instances"][0]["state"] = "ghost"
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("current state", str(ctx.exception))

    def test_load_history_with_unknown_state(self) -> None:
        snapshot = self.base_snapshot()
        snapshot["instances"][0]["history"][0]["to"] = "ghost"
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("history[0]", str(ctx.exception))

    def test_load_unserializable_variable(self) -> None:
        snapshot = self.base_snapshot()
        snapshot["instances"][0]["variables"]["amount"] = 2.5
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("variables", str(ctx.exception))

    def test_load_timer_with_unknown_state(self) -> None:
        snapshot = self.base_snapshot()
        for machine in snapshot["machines"]:
            if machine["machine_id"] == "session":
                machine["timers"][0]["state"] = "limbo"
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("limbo", str(ctx.exception))

    def test_load_inconsistent_machine_rejected(self) -> None:
        snapshot = self.base_snapshot()
        for machine in snapshot["machines"]:
            if machine["machine_id"] == "order":
                machine["transitions"][0]["guard"] = "amount >="
        with self.assertRaises(PersistenceError) as ctx:
            self._write_and_load(snapshot)
        self.assertIn("inconsistent", str(ctx.exception))

    def test_failed_load_leaves_engine_untouched(self) -> None:
        engine = self.build_busy_engine()
        before = engine.snapshot()
        with self.assertRaises(PersistenceError):
            engine.load("no/such/file.json")
        self.assertEqual(engine.snapshot(), before)


class CommandLineTests(unittest.TestCase):
    """The JSON-lines dispatcher used by main.py."""

    def test_full_flow(self) -> None:
        engine = WorkflowEngine()
        out = handle_command(engine, {"cmd": "define", "machine": order_spec()})
        self.assertTrue(out["ok"])
        out = handle_command(engine, {
            "cmd": "create", "machine_id": "order", "instance_id": "o1",
            "variables": {"amount": 300},
        })
        self.assertTrue(out["ok"])
        out = handle_command(engine, {"cmd": "send", "instance_id": "o1", "event": "pay"})
        self.assertFalse(out["ok"])  # "charge" not registered here
        self.assertIn("unregistered_action", out["reason"])
        out = handle_command(engine, {"cmd": "validate", "machine_id": "order"})
        self.assertTrue(out["ok"])
        self.assertTrue(out["consistent"])
        out = handle_command(engine, {"cmd": "instance", "instance_id": "o1"})
        self.assertEqual(out["instance"]["state"], "created")
        out = handle_command(engine, {"cmd": "history", "instance_id": "o1"})
        self.assertEqual(len(out["history"]), 1)  # the rolled-back attempt
        out = handle_command(engine, {"cmd": "tick", "n": 5})
        self.assertEqual(out["clock"], 5)
        out = handle_command(engine, {"cmd": "dump"})
        self.assertEqual(out["state"]["clock"], 5)

    def test_errors_are_json_with_error_field(self) -> None:
        engine = WorkflowEngine()
        out = handle_command(engine, {"cmd": "frobnicate"})
        self.assertFalse(out["ok"])
        self.assertIn("error", out)
        out = handle_command(engine, {"cmd": "instance", "instance_id": "ghost"})
        self.assertFalse(out["ok"])
        self.assertIn("error", out)
        out = handle_command(engine, "not a dict")
        self.assertFalse(out["ok"])
        self.assertIn("error", out)

    def test_builtin_actions_and_timer_command(self) -> None:
        from main import build_engine

        engine = build_engine()
        handle_command(engine, {"cmd": "define", "machine": {
            "machine_id": "counter",
            "initial": "counting",
            "states": ["counting", "done"],
            "transitions": [
                {"from": "counting", "to": "counting", "event": "step",
                 "action": "inc"},
                {"from": "counting", "to": "done", "event": "finish"},
            ],
        }})
        handle_command(engine, {"cmd": "create", "machine_id": "counter",
                                "instance_id": "c1", "variables": {"count": 0}})
        handle_command(engine, {"cmd": "send", "instance_id": "c1", "event": "step"})
        out = handle_command(engine, {"cmd": "instance", "instance_id": "c1"})
        self.assertEqual(out["instance"]["variables"]["count"], 1)

    def test_save_load_via_commands(self) -> None:
        engine = WorkflowEngine()
        handle_command(engine, {"cmd": "define", "machine": order_spec()})
        handle_command(engine, {"cmd": "create", "machine_id": "order",
                                "instance_id": "o1", "variables": {"amount": 1}})
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "s.json")
            out = handle_command(engine, {"cmd": "save", "path": path})
            self.assertTrue(out["ok"])
            other = WorkflowEngine()
            out = handle_command(other, {"cmd": "load", "path": path})
            self.assertTrue(out["ok"])
            self.assertEqual(engine.snapshot(), other.snapshot())
            out = handle_command(other, {"cmd": "load",
                                         "path": os.path.join(tmp, "nope.json")})
            self.assertFalse(out["ok"])
            self.assertIn("error", out)


if __name__ == "__main__":
    unittest.main()
