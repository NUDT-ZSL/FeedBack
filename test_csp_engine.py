"""Unit tests for the offline CSP engine and its JSON-lines CLI."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from csp_engine import (  # noqa: E402
    CSPEngine,
    CspError,
    DuplicateNameError,
    LoadError,
    PredicateError,
    RelationError,
    SerializationError,
    UnknownConstraintError,
    UnknownVariableError,
)

WORKSPACE = os.path.dirname(os.path.abspath(__file__))
MAIN_PY = os.path.join(WORKSPACE, "main.py")


def coloring_engine() -> CSPEngine:
    """Small map-coloring CSP: 3 regions, 2 colors -> unsat; 3 colors -> sat."""
    engine = CSPEngine()
    for name in ("a", "b", "c"):
        engine.add_variable(name, [1, 2, 3])
    engine.add_constraint("ab", ["a", "b"], relation={"op": "ne"})
    engine.add_constraint("bc", ["b", "c"], relation={"op": "ne"})
    engine.add_constraint("ac", ["a", "c"], relation={"op": "ne"})
    return engine


class TestModelValidation(unittest.TestCase):
    """Variable/constraint model rules."""

    def test_duplicate_variable_name_rejected(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        with self.assertRaises(DuplicateNameError):
            engine.add_variable("x", [3])

    def test_duplicate_constraint_cid_rejected(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "ne"})
        with self.assertRaises(DuplicateNameError):
            engine.add_constraint("c1", ["x", "y"], relation={"op": "eq"})

    def test_invalid_variable_inputs(self):
        engine = CSPEngine()
        with self.assertRaises(CspError):
            engine.add_variable("", [1])
        with self.assertRaises(CspError):
            engine.add_variable("x", [])  # empty domain
        with self.assertRaises(CspError):
            engine.add_variable("y", [1, 2.5])  # float not allowed
        with self.assertRaises(CspError):
            engine.add_variable("z", [True, False])  # bool not allowed

    def test_scope_validation(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])
        with self.assertRaises(CspError):
            engine.add_constraint("c1", ["x"], relation={"op": "eq"})  # too short
        with self.assertRaises(CspError):
            engine.add_constraint("c2", ["x", "x"], relation={"op": "eq"})  # dup
        with self.assertRaises(UnknownVariableError):
            engine.add_constraint("c3", ["x", "nope"], relation={"op": "eq"})

    def test_remove_unknown_constraint(self):
        engine = CSPEngine()
        with self.assertRaises(UnknownConstraintError):
            engine.remove_constraint("ghost")

    def test_predicate_must_be_callable_or_relation(self):
        engine = CSPEngine()
        engine.add_variable("x", [1])
        engine.add_variable("y", [1])
        with self.assertRaises(RelationError):
            engine.add_constraint("c1", ["x", "y"], predicate=42)
        with self.assertRaises(RelationError):
            engine.add_constraint("c2", ["x", "y"])  # neither given

    def test_unknown_relation_op(self):
        engine = CSPEngine()
        engine.add_variable("x", [1])
        engine.add_variable("y", [1])
        with self.assertRaises(RelationError):
            engine.add_constraint("c1", ["x", "y"], relation={"op": "magic"})


class TestPropagation(unittest.TestCase):
    """AC-3 style arc consistency, including n-ary constraints."""

    def test_binary_arc_consistency(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        self.assertEqual(engine.current_domain("x"), {1, 2})
        self.assertEqual(engine.current_domain("y"), {2, 3})

    def test_ternary_all_different_propagation(self):
        engine = CSPEngine()
        engine.add_variable("a", [1])
        engine.add_variable("b", [1, 2])
        engine.add_variable("c", [1, 2, 3])
        engine.add_constraint("tri", ["a", "b", "c"], relation={"op": "all_different"})
        # a=1 forces b=2, which forces c=3 -- pure propagation, no search.
        self.assertEqual(engine.current_domain("b"), {2})
        self.assertEqual(engine.current_domain("c"), {3})

    def test_ternary_sum_propagation(self):
        engine = CSPEngine()
        engine.add_variable("a", [1, 2, 3])
        engine.add_variable("b", [1, 2, 3])
        engine.add_variable("c", [1, 2, 3])
        engine.add_constraint("sum", ["a", "b", "c"], relation={"op": "sum_eq", "value": 9})
        # Only 3+3+3 reaches 9.
        self.assertEqual(engine.current_domain("a"), {3})
        self.assertEqual(engine.current_domain("b"), {3})
        self.assertEqual(engine.current_domain("c"), {3})

    def test_quaternary_constraint(self):
        engine = CSPEngine()
        for name in ("p", "q", "r", "s"):
            engine.add_variable(name, [1, 2, 3, 4])
        engine.add_constraint(
            "quad", ["p", "q", "r", "s"], relation={"op": "sum_eq", "value": 10}
        )
        engine.tighten("p", [4])
        engine.tighten("q", [4])
        # p=q=4 leaves 2 for r+s, so r=s=1.
        self.assertEqual(engine.current_domain("r"), {1})
        self.assertEqual(engine.current_domain("s"), {1})

    def test_allowed_and_forbidden_tables(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint(
            "tbl", ["x", "y"], relation={"op": "allowed", "tuples": [[1, 2], [2, 3]]}
        )
        self.assertEqual(engine.current_domain("x"), {1, 2})
        self.assertEqual(engine.current_domain("y"), {2, 3})
        engine2 = CSPEngine()
        engine2.add_variable("x", [1, 2])
        engine2.add_variable("y", [1, 2])
        engine2.add_constraint(
            "fb", ["x", "y"], relation={"op": "forbidden", "tuples": [[1, 1], [2, 2]]}
        )
        result = engine2.solve()
        self.assertEqual(result.status, "sat")
        self.assertNotEqual(result.assignment["x"], result.assignment["y"])

    def test_expr_relation(self):
        engine = CSPEngine()
        engine.add_variable("a", [1, 2, 3])
        engine.add_variable("b", [1, 2, 3])
        engine.add_variable("c", [1, 2, 3, 4, 5, 6])
        engine.add_constraint("expr", ["a", "b", "c"], relation={"op": "expr", "code": "a + b == c"})
        engine.tighten("a", [3])
        engine.tighten("b", [3])
        self.assertEqual(engine.current_domain("c"), {6})

    def test_callable_predicate(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint("c1", ["x", "y"], predicate=lambda vals: vals[0] * 2 == vals[1])
        self.assertEqual(engine.current_domain("x"), {1})
        self.assertEqual(engine.current_domain("y"), {2})

    def test_predicate_exception_wrapped(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])

        def boom(vals):
            raise ValueError("nope")

        with self.assertRaises(PredicateError) as ctx:
            engine.add_constraint("bad", ["x", "y"], predicate=boom)
        self.assertIn("bad", str(ctx.exception))

    def test_empty_domain_detection_during_propagation(self):
        engine = CSPEngine()
        engine.add_variable("x", [1])
        engine.add_variable("y", [1])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "ne"})
        # x={1}, y={1}, x != y -> both wiped -> unsat.
        self.assertEqual(engine.solve().status, "unsat")


class TestSearch(unittest.TestCase):
    """Backtracking search, MRV ordering, stats, branch budget."""

    def test_solve_sat_returns_valid_assignment(self):
        engine = coloring_engine()
        result = engine.solve()
        self.assertEqual(result.status, "sat")
        a, b, c = (result.assignment[n] for n in ("a", "b", "c"))
        self.assertEqual(len({a, b, c}), 3)  # all different

    def test_solve_unsat(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        engine.add_constraint("c2", ["y", "x"], relation={"op": "lt"})
        self.assertEqual(engine.solve().status, "unsat")

    def test_stats_recorded(self):
        engine = coloring_engine()
        before = engine.get_stats()
        engine.solve()
        stats = engine.get_stats()
        self.assertGreaterEqual(stats["branches"], 1)
        self.assertGreater(stats["propagations"], before["propagations"])
        self.assertEqual(stats["variables"], 3)
        self.assertEqual(stats["constraints"], 3)

    def test_solve_restores_domains(self):
        engine = coloring_engine()
        domains_before = {n: engine.current_domain(n) for n in ("a", "b", "c")}
        engine.solve()
        for name, dom in domains_before.items():
            self.assertEqual(engine.current_domain(name), dom)

    def test_empty_engine_is_trivially_sat(self):
        result = CSPEngine().solve()
        self.assertEqual(result.status, "sat")
        self.assertEqual(result.assignment, {})

    def test_single_variable_no_constraints(self):
        engine = CSPEngine()
        engine.add_variable("x", [3, 1, 2])
        result = engine.solve()
        self.assertEqual(result.status, "sat")
        self.assertEqual(result.assignment, {"x": 1})  # smallest value first

    def test_branch_budget_returns_unknown(self):
        # 4 pigeons, 3 holes, pairwise != : unsat, but only search can tell.
        engine = CSPEngine(max_branches=2)
        for i in range(4):
            engine.add_variable(f"p{i}", [1, 2, 3])
        for i in range(4):
            for j in range(i + 1, 4):
                engine.add_constraint(f"c{i}{j}", [f"p{i}", f"p{j}"], relation={"op": "ne"})
        self.assertEqual(engine.solve().status, "unknown")
        # With enough budget the same problem is decided unsat.
        engine2 = CSPEngine()
        for i in range(4):
            engine2.add_variable(f"p{i}", [1, 2, 3])
        for i in range(4):
            for j in range(i + 1, 4):
                engine2.add_constraint(f"c{i}{j}", [f"p{i}", f"p{j}"], relation={"op": "ne"})
        self.assertEqual(engine2.solve().status, "unsat")

    def test_mixed_int_string_domain(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, "one", 2, "two"])
        engine.add_variable("y", [1, "one"])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "eq"})
        self.assertEqual(engine.current_domain("x"), {1, "one"})
        result = engine.solve()
        self.assertEqual(result.status, "sat")
        self.assertEqual(result.assignment["x"], result.assignment["y"])


class TestConflictExplanation(unittest.TestCase):
    """explain_conflict: cids, attempts, and real MUS shrinking."""

    def test_conflict_reports_cids_and_attempts(self):
        engine = CSPEngine()
        engine.add_variable("x", [1])
        engine.add_variable("y", [2])
        engine.add_constraint("eq", ["x", "y"], relation={"op": "eq"})
        conflict = engine.explain_conflict()
        self.assertIn("eq", conflict.conflicting_cids)
        self.assertIn("eq", conflict.attempts)
        tried = {(a["variable"], a["value"]) for a in conflict.attempts["eq"]}
        self.assertIn(("x", 1), tried)
        self.assertTrue(conflict.message)

    def test_mus_shrinks_to_real_core(self):
        engine = CSPEngine()
        engine.add_variable("x", [1])
        engine.add_variable("y", [2])
        engine.add_variable("z", [1, 2])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "eq"})  # unsat core
        engine.add_constraint("c2", ["x", "z"], relation={"op": "le"})  # irrelevant
        engine.add_constraint("c3", ["y", "z"], relation={"op": "le"})  # irrelevant
        conflict = engine.explain_conflict()
        self.assertEqual(conflict.mus, ["c1"])
        # Verify the MUS is genuinely minimal: removing c1 makes it sat.
        engine.remove_constraint("c1")
        self.assertEqual(engine.solve().status, "sat")

    def test_mus_empty_when_domain_empty(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "ne"})
        engine.tighten("x", [])  # empty domain: unsat regardless of constraints
        conflict = engine.explain_conflict()
        self.assertEqual(conflict.mus, [])
        self.assertIn("empty domain", conflict.message)

    def test_explain_conflict_on_satisfiable_raises(self):
        engine = coloring_engine()
        with self.assertRaises(CspError):
            engine.explain_conflict()


class TestIncrementalUpdates(unittest.TestCase):
    """tighten/relax/add_constraint returning affected variable sets."""

    def test_tighten_propagates_only_downstream(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_variable("z", [10, 20])  # unconstrained, must stay untouched
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        affected = engine.tighten("x", [2])
        self.assertEqual(affected, {"x", "y"})
        self.assertEqual(engine.current_domain("x"), {2})
        self.assertEqual(engine.current_domain("y"), {3})
        self.assertEqual(engine.current_domain("z"), {10, 20})

    def test_tighten_noop_returns_empty_set(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        self.assertEqual(engine.tighten("x", [1, 2, 3]), set())

    def test_relax_allows_resolving_after_unsat(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        engine.tighten("x", [3])  # x=3 -> y>3 impossible -> unsat
        self.assertEqual(engine.solve().status, "unsat")
        affected = engine.relax("x", [1])
        self.assertIn("x", affected)
        result = engine.solve()
        self.assertEqual(result.status, "sat")
        self.assertLess(result.assignment["x"], result.assignment["y"])

    def test_add_constraint_returns_affected(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        affected = engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        self.assertEqual(affected, {"x", "y"})
        self.assertEqual(engine.current_domain("x"), {1, 2})

    def test_remove_constraint_restores_values(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2, 3])
        engine.add_variable("y", [1, 2, 3])
        engine.add_constraint("c1", ["x", "y"], relation={"op": "lt"})
        self.assertEqual(engine.current_domain("x"), {1, 2})
        affected = engine.remove_constraint("c1")
        self.assertEqual(affected, {"x", "y"})
        self.assertEqual(engine.current_domain("x"), {1, 2, 3})

    def test_tighten_unknown_variable(self):
        engine = CSPEngine()
        with self.assertRaises(UnknownVariableError):
            engine.tighten("ghost", [1])
        with self.assertRaises(UnknownVariableError):
            engine.relax("ghost", [1])


class TestPersistence(unittest.TestCase):
    """save/load round-trip and corrupt-file handling."""

    def _build_engine(self) -> CSPEngine:
        engine = coloring_engine()
        engine.tighten("a", [1, 2])
        engine.solve()  # accumulate stats
        return engine

    def test_save_load_roundtrip(self):
        engine = self._build_engine()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            engine.save(path)
            loaded = CSPEngine.load(path)
        self.assertEqual(engine.to_dict(), loaded.to_dict())
        self.assertEqual(engine.get_stats(), loaded.get_stats())
        # The loaded engine solves to the same assignment.
        self.assertEqual(engine.solve().assignment, loaded.solve().assignment)

    def test_load_missing_file(self):
        with self.assertRaises(LoadError) as ctx:
            CSPEngine.load("/nonexistent/definitely-not-there.json")
        self.assertIn("cannot read", str(ctx.exception))

    def test_load_invalid_json(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            fh.write("{not json")
            path = fh.name
        try:
            with self.assertRaises(LoadError) as ctx:
                CSPEngine.load(path)
            self.assertIn("invalid JSON", str(ctx.exception))
        finally:
            os.unlink(path)

    def _load_data(self, data) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(data, fh)
            path = fh.name
        try:
            CSPEngine.load(path)
        finally:
            os.unlink(path)

    def _valid_state(self) -> dict:
        engine = self._build_engine()
        return engine.to_dict()

    def test_load_missing_fields(self):
        with self.assertRaises(LoadError):
            self._load_data({"format": "csp-engine/1"})  # no variables/constraints
        with self.assertRaises(LoadError):
            self._load_data({"no_format": True})

    def test_load_duplicate_variable(self):
        data = self._valid_state()
        data["variables"].append(dict(data["variables"][0]))
        with self.assertRaises(LoadError) as ctx:
            self._load_data(data)
        self.assertIn("duplicate", str(ctx.exception))

    def test_load_dangling_scope_reference(self):
        data = self._valid_state()
        data["constraints"][0]["scope"] = ["a", "ghost"]
        with self.assertRaises(LoadError) as ctx:
            self._load_data(data)
        self.assertIn("unknown variable", str(ctx.exception))

    def test_load_empty_base_domain(self):
        data = self._valid_state()
        data["variables"][0]["base_domain"] = []
        with self.assertRaises(LoadError):
            self._load_data(data)

    def test_load_unparseable_relation(self):
        data = self._valid_state()
        data["constraints"][0]["relation"] = {"op": "abracadabra"}
        with self.assertRaises(LoadError):
            self._load_data(data)

    def test_save_with_callable_predicate_fails(self):
        engine = CSPEngine()
        engine.add_variable("x", [1, 2])
        engine.add_variable("y", [1, 2])
        engine.add_constraint("c1", ["x", "y"], predicate=lambda vals: vals[0] != vals[1])
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(SerializationError):
                engine.save(os.path.join(tmp, "state.json"))


class TestCli(unittest.TestCase):
    """End-to-end JSON-lines command interface."""

    def run_cli(self, commands: list) -> list:
        proc = subprocess.run(
            [sys.executable, MAIN_PY],
            input="\n".join(json.dumps(c) for c in commands) + "\n",
            capture_output=True,
            text=True,
            cwd=WORKSPACE,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return [json.loads(line) for line in proc.stdout.strip().splitlines()]

    def test_full_session(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "state.json")
            out = self.run_cli([
                {"cmd": "add_var", "name": "x", "domain": [1, 2, 3]},
                {"cmd": "add_var", "name": "y", "domain": [1, 2, 3]},
                {"cmd": "add_con", "cid": "c1", "scope": ["x", "y"], "relation": {"op": "lt"}},
                {"cmd": "solve"},
                {"cmd": "tighten", "variable": "x", "values": [2]},
                {"cmd": "solve"},
                {"cmd": "stats"},
                {"cmd": "save", "path": path},
                {"cmd": "load", "path": path},
                {"cmd": "dump"},
            ])
        self.assertTrue(all(r["ok"] for r in out), out)
        self.assertEqual(out[2]["affected"], ["x", "y"])
        self.assertEqual(out[3]["status"], "sat")
        self.assertEqual(out[3]["assignment"], {"x": 1, "y": 2})
        self.assertEqual(out[4]["affected"], ["x", "y"])
        self.assertEqual(out[5]["assignment"], {"x": 2, "y": 3})
        self.assertGreaterEqual(out[6]["stats"]["branches"], 1)
        self.assertEqual(len(out[9]["state"]["variables"]), 2)

    def test_conflict_command(self):
        out = self.run_cli([
            {"cmd": "add_var", "name": "x", "domain": [1]},
            {"cmd": "add_var", "name": "y", "domain": [2]},
            {"cmd": "add_con", "cid": "eq", "scope": ["x", "y"], "relation": {"op": "eq"}},
            {"cmd": "conflict"},
        ])
        self.assertTrue(out[3]["ok"])
        self.assertEqual(out[3]["conflict"]["mus"], ["eq"])

    def test_errors_are_json_with_error_field(self):
        out = self.run_cli([
            {"cmd": "add_var", "name": "x", "domain": [1, 2]},
            {"cmd": "add_var", "name": "x", "domain": [3]},  # duplicate
            {"cmd": "bogus"},
            {"cmd": "tighten", "variable": "ghost", "values": [1]},
            {"cmd": "add_var", "name": "y"},  # missing domain
        ])
        for response in out[1:]:
            self.assertFalse(response["ok"])
            self.assertIn("error", response)
        self.assertIn("duplicate", out[1]["error"])
        self.assertIn("unknown command", out[2]["error"])
        self.assertIn("unknown variable", out[3]["error"])
        self.assertIn("missing field", out[4]["error"])

    def test_invalid_json_line(self):
        proc = subprocess.run(
            [sys.executable, MAIN_PY],
            input="this is not json\n",
            capture_output=True,
            text=True,
            cwd=WORKSPACE,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        response = json.loads(proc.stdout.strip())
        self.assertFalse(response["ok"])
        self.assertIn("error", response)


if __name__ == "__main__":
    unittest.main()
