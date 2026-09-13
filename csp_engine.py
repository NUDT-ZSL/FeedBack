"""Offline CSP (constraint satisfaction problem) engine.

Pure standard-library implementation providing:

* variable/constraint modelling with serializable relation expressions,
* AC-3 style generalized arc-consistency (GAC) propagation for n-ary constraints,
* depth-first backtracking search with MRV variable ordering and a branch budget,
* conflict explanation with a deletion-based minimal unsatisfiable subset (MUS),
* incremental domain tightening / relaxation and dynamic constraint insertion,
* JSON persistence (save/load) with strict validation.

The engine keeps two domain levels per variable:

* ``base_domain`` -- the declared domain as modified by ``tighten``/``relax``;
* current domain (``_domains``) -- ``base_domain`` after arc-consistency pruning.

Incremental tightening only re-runs the arcs downstream of the touched
variable; relaxation and constraint removal rebuild current domains from
``base_domain`` (arc consistency is not incrementally reversible).
"""

from __future__ import annotations

import json
from collections import deque
from dataclasses import dataclass
from itertools import product
from typing import Any, Callable, Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple

__all__ = [
    "CSPEngine",
    "SolveResult",
    "Conflict",
    "CspError",
    "DuplicateNameError",
    "UnknownVariableError",
    "UnknownConstraintError",
    "RelationError",
    "PredicateError",
    "SerializationError",
    "LoadError",
    "FORMAT_VERSION",
]

#: A predicate receives one tuple of values aligned with the constraint scope.
Predicate = Callable[[Tuple[Any, ...]], bool]

#: Format tag written into every saved file and checked on load.
FORMAT_VERSION = "csp-engine/1"


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class CspError(Exception):
    """Base class for all engine errors."""


class DuplicateNameError(CspError):
    """A variable name or constraint cid is already registered."""


class UnknownVariableError(CspError):
    """Referenced variable does not exist."""


class UnknownConstraintError(CspError):
    """Referenced constraint cid does not exist."""


class RelationError(CspError):
    """A serializable relation expression is malformed or unknown."""


class PredicateError(CspError):
    """A constraint predicate raised while being evaluated."""


class SerializationError(CspError):
    """The engine state cannot be serialized (e.g. opaque callable predicate)."""


class LoadError(CspError):
    """A saved file is unreadable, corrupt, or fails validation."""


class _BudgetExhausted(Exception):
    """Internal control-flow signal: the search branch budget ran out."""


# ---------------------------------------------------------------------------
# Value helpers
# ---------------------------------------------------------------------------


def _value_key(value: Any) -> Tuple[int, Any]:
    """Deterministic ordering key that tolerates mixed int/str domains."""
    if isinstance(value, int):
        return (0, value)
    return (1, str(value))


def _check_value(value: Any) -> None:
    """Validate one domain value: must be int or str (bool excluded)."""
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise CspError(
            f"domain values must be int or str, got {type(value).__name__}: {value!r}"
        )


def _sorted_domain(values: Iterable[Any]) -> List[Any]:
    """Return the domain values in the engine's deterministic order."""
    return sorted(values, key=_value_key)


# ---------------------------------------------------------------------------
# Serializable relation expressions
# ---------------------------------------------------------------------------

_CHAIN_OPS = ("eq", "ne", "lt", "le", "gt", "ge")
_SUM_OPS = ("sum_eq", "sum_ne", "sum_lt", "sum_le", "sum_gt", "sum_ge")

# Builtins exposed to ``expr`` relations. Offline local tool, still kept tight.
_EXPR_BUILTINS: Dict[str, Any] = {
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "len": len,
    "all": all,
    "any": any,
    "sorted": sorted,
    "round": round,
}


def _compile_chain(op: str) -> Predicate:
    """Compile a chain comparison applied across the whole scope."""
    if op == "eq":
        return lambda vals: all(v == vals[0] for v in vals[1:])
    if op == "ne":
        return lambda vals: len(set(vals)) == len(vals)
    if op == "lt":
        return lambda vals: all(a < b for a, b in zip(vals, vals[1:]))
    if op == "le":
        return lambda vals: all(a <= b for a, b in zip(vals, vals[1:]))
    if op == "gt":
        return lambda vals: all(a > b for a, b in zip(vals, vals[1:]))
    return lambda vals: all(a >= b for a, b in zip(vals, vals[1:]))  # ge


def _compile_sum(op: str, target: Any) -> Predicate:
    """Compile a sum comparison: sum(scope values) <op> target."""
    if op == "sum_eq":
        return lambda vals: sum(vals) == target
    if op == "sum_ne":
        return lambda vals: sum(vals) != target
    if op == "sum_lt":
        return lambda vals: sum(vals) < target
    if op == "sum_le":
        return lambda vals: sum(vals) <= target
    if op == "sum_gt":
        return lambda vals: sum(vals) > target
    return lambda vals: sum(vals) >= target  # sum_ge


def _compile_expr(code: str, scope: Sequence[str]) -> Predicate:
    """Compile a Python expression over the scope variable names."""
    for name in scope:
        if not name.isidentifier():
            raise RelationError(
                f"expr relations require identifier variable names, got {name!r}"
            )
    try:
        compiled = compile(code, "<relation expr>", "eval")
    except SyntaxError as exc:
        raise RelationError(f"invalid expr relation {code!r}: {exc}") from None

    def predicate(vals: Tuple[Any, ...]) -> bool:
        env = dict(zip(scope, vals))
        return bool(eval(compiled, {"__builtins__": dict(_EXPR_BUILTINS)}, env))

    return predicate


def compile_relation(relation: Any, scope: Sequence[str]) -> Predicate:
    """Compile a serializable relation dict into a predicate.

    Supported forms (``n`` = len(scope)):

    * ``{"op": "all_different"}`` -- all values pairwise distinct.
    * ``{"op": "eq"|"ne"|"lt"|"le"|"gt"|"ge"}`` -- chain comparison over the
      scope in order (``ne`` means pairwise distinct).
    * ``{"op": "sum_eq"|...|"sum_ge", "value": k}`` -- sum of values vs ``k``.
    * ``{"op": "allowed", "tuples": [[...], ...]}`` -- explicit allowed table.
    * ``{"op": "forbidden", "tuples": [[...], ...]}`` -- explicit forbidden table.
    * ``{"op": "expr", "code": "a + b <= c"}`` -- Python expression over the
      scope variable names.

    Raises:
        RelationError: if the relation is malformed or references an unknown op.
    """
    if not isinstance(relation, dict):
        raise RelationError(
            f"relation must be a dict, got {type(relation).__name__}: {relation!r}"
        )
    op = relation.get("op")
    if not isinstance(op, str) or not op:
        raise RelationError("relation requires a non-empty string 'op' field")

    if op == "all_different":
        return lambda vals: len(set(vals)) == len(vals)
    if op in _CHAIN_OPS:
        return _compile_chain(op)
    if op in _SUM_OPS:
        if "value" not in relation:
            raise RelationError(f"relation {op!r} requires a 'value' field")
        target = relation["value"]
        if isinstance(target, bool) or not isinstance(target, (int, float)):
            raise RelationError(f"relation {op!r} 'value' must be a number")
        return _compile_sum(op, target)
    if op in ("allowed", "forbidden"):
        tuples = relation.get("tuples")
        if not isinstance(tuples, list):
            raise RelationError(f"relation {op!r} requires a 'tuples' list")
        table: Set[Tuple[Any, ...]] = set()
        for entry in tuples:
            if not isinstance(entry, list) or len(entry) != len(scope):
                raise RelationError(
                    f"relation {op!r} tuple {entry!r} must be a list of length {len(scope)}"
                )
            for value in entry:
                try:
                    _check_value(value)
                except CspError as exc:
                    raise RelationError(f"relation {op!r}: {exc}") from None
            table.add(tuple(entry))
        if op == "allowed":
            return lambda vals: tuple(vals) in table
        return lambda vals: tuple(vals) not in table
    if op == "expr":
        code = relation.get("code")
        if not isinstance(code, str) or not code.strip():
            raise RelationError("relation 'expr' requires a non-empty 'code' string")
        return _compile_expr(code, scope)
    raise RelationError(f"unknown relation op {op!r}")


# ---------------------------------------------------------------------------
# Model objects
# ---------------------------------------------------------------------------


@dataclass
class Variable:
    """A CSP variable: unique name plus its declared (base) domain."""

    name: str
    base_domain: Set[Any]


@dataclass
class Constraint:
    """A CSP constraint over an ordered scope of variable names.

    ``predicate`` decides whether a tuple of values (aligned with ``scope``)
    is allowed. ``relation`` holds the serializable form when the constraint
    was built from a relation dict; it is ``None`` for opaque callables,
    which cannot be persisted.
    """

    cid: str
    scope: List[str]
    predicate: Predicate
    relation: Optional[Dict[str, Any]] = None


@dataclass
class SolveResult:
    """Outcome of :meth:`CSPEngine.solve`.

    ``status`` is one of ``"sat"`` (``assignment`` holds a complete mapping),
    ``"unsat"`` (no solution exists), or ``"unknown"`` (the branch budget was
    exhausted before the search could decide).
    """

    status: str
    assignment: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable view of the result."""
        return {"status": self.status, "assignment": self.assignment}


@dataclass
class Conflict:
    """Human-readable explanation of an unsatisfiable engine state.

    Attributes:
        conflicting_cids: constraint ids whose revisions pruned values during
            the diagnostic propagation run (falling back to all constraints
            when the conflict only appears inside search).
        attempts: per constraint cid, the ``{variable, value}`` assignments
            that were tried and rejected because no support existed.
        mus: a minimal unsatisfiable subset of constraint ids, computed by
            deletion-based shrinking (every removed id was re-verified).
        message: one-line human-readable summary.
    """

    conflicting_cids: List[str]
    attempts: Dict[str, List[Dict[str, Any]]]
    mus: List[str]
    message: str

    def to_dict(self) -> Dict[str, Any]:
        """JSON-serializable view of the conflict."""
        return {
            "conflicting_cids": list(self.conflicting_cids),
            "attempts": {cid: list(items) for cid, items in self.attempts.items()},
            "mus": list(self.mus),
            "message": self.message,
        }


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class CSPEngine:
    """Offline CSP solver: GAC propagation + MRV backtracking search.

    Args:
        max_branches: per-``solve()`` cap on branch attempts; exceeding it
            yields status ``"unknown"`` instead of a wrong answer.
    """

    def __init__(self, max_branches: int = 100_000) -> None:
        if isinstance(max_branches, bool) or not isinstance(max_branches, int) or max_branches < 0:
            raise CspError("max_branches must be a non-negative int")
        self.max_branches = max_branches
        self._variables: Dict[str, Variable] = {}
        self._constraints: Dict[str, Constraint] = {}
        self._constraints_by_var: Dict[str, List[str]] = {}
        self._domains: Dict[str, Set[Any]] = {}
        self._stats: Dict[str, int] = {
            "branches": 0,
            "backtracks": 0,
            "propagations": 0,
            "pruned": 0,
        }
        self._budget = 0  # remaining branch attempts for the active solve()

    # ------------------------------------------------------------------
    # Model construction
    # ------------------------------------------------------------------

    def add_variable(self, name: str, domain: Iterable[Any]) -> None:
        """Register a variable with a non-empty domain of ints/strings.

        Raises:
            CspError: invalid name or domain.
            DuplicateNameError: ``name`` is already registered.
        """
        if not isinstance(name, str) or not name:
            raise CspError("variable name must be a non-empty string")
        if name in self._variables:
            raise DuplicateNameError(f"duplicate variable name {name!r}")
        values = set(domain)
        if not values:
            raise CspError(f"variable {name!r}: domain must be non-empty")
        for value in values:
            _check_value(value)
        self._variables[name] = Variable(name=name, base_domain=set(values))
        self._domains[name] = set(values)
        self._constraints_by_var[name] = []

    def add_constraint(
        self,
        cid: str,
        scope: Sequence[str],
        predicate: Optional[Any] = None,
        relation: Optional[Dict[str, Any]] = None,
    ) -> Set[str]:
        """Register a constraint and incrementally propagate its arcs.

        Exactly one of ``predicate`` (callable taking a value tuple aligned
        with ``scope``) or ``relation`` (serializable dict, see
        :func:`compile_relation`) must be given. A dict passed as
        ``predicate`` is treated as a relation for convenience.

        Returns:
            The set of variable names whose current domains changed due to
            the propagation triggered by this constraint.

        Raises:
            DuplicateNameError: ``cid`` is already registered.
            UnknownVariableError: scope references an unknown variable.
            RelationError: malformed relation / missing predicate.
            CspError: invalid cid or scope.
        """
        if not isinstance(cid, str) or not cid:
            raise CspError("constraint cid must be a non-empty string")
        if cid in self._constraints:
            raise DuplicateNameError(f"duplicate constraint cid {cid!r}")
        if isinstance(predicate, dict) and relation is None:
            relation, predicate = predicate, None
        if (predicate is None) == (relation is None):
            raise RelationError("provide exactly one of predicate= or relation=")
        scope_list = self._validate_scope(scope)
        if relation is not None:
            compiled = compile_relation(relation, scope_list)
            constraint = Constraint(cid=cid, scope=scope_list, predicate=compiled, relation=relation)
        else:
            if not callable(predicate):
                raise RelationError("predicate must be callable or a relation dict")
            constraint = Constraint(cid=cid, scope=scope_list, predicate=predicate, relation=None)
        self._install_constraint(constraint)
        arcs = [(cid, var) for var in scope_list]
        _, affected = self._propagate(arcs)
        return affected

    def remove_constraint(self, cid: str) -> Set[str]:
        """Remove a constraint and rebuild pruned domains from base domains.

        Arc consistency is not incrementally reversible, so removal (like
        relaxation) recomputes current domains from ``base_domain``.

        Returns:
            The set of variable names whose current domains changed.

        Raises:
            UnknownConstraintError: ``cid`` is not registered.
        """
        if cid not in self._constraints:
            raise UnknownConstraintError(f"unknown constraint cid {cid!r}")
        constraint = self._constraints.pop(cid)
        for name in constraint.scope:
            self._constraints_by_var[name].remove(cid)
        return self._recompute_domains()

    def _validate_scope(self, scope: Sequence[str]) -> List[str]:
        """Check scope shape: >=2 known variables, no duplicates."""
        if not isinstance(scope, (list, tuple)):
            raise CspError("scope must be a list of variable names")
        scope_list = list(scope)
        if len(scope_list) < 2:
            raise CspError("constraint scope must contain at least two variables")
        if len(set(scope_list)) != len(scope_list):
            raise CspError(f"constraint scope contains duplicates: {scope_list!r}")
        for name in scope_list:
            if name not in self._variables:
                raise UnknownVariableError(f"scope references unknown variable {name!r}")
        return scope_list

    def _install_constraint(self, constraint: Constraint) -> None:
        """Insert a constraint into the indexes without propagating."""
        self._constraints[constraint.cid] = constraint
        for name in constraint.scope:
            self._constraints_by_var[name].append(constraint.cid)

    # ------------------------------------------------------------------
    # Incremental updates
    # ------------------------------------------------------------------

    def tighten(self, variable: str, values: Iterable[Any]) -> Set[str]:
        """Intersect a variable's domain with ``values`` and re-propagate.

        Only the arcs downstream of ``variable`` are re-run (no full
        recompute). Tightening to the empty set is allowed and makes the
        engine unsatisfiable until relaxed.

        Returns:
            The set of variable names whose current domains changed, plus
            ``variable`` itself whenever its declared (base) domain changed
            or its current domain is empty. In particular, tightening an
            already-empty domain returns ``{variable}`` rather than an
            empty set, so callers never mistake it for a no-op.

        Raises:
            UnknownVariableError: ``variable`` is not registered.
        """
        var = self._require_variable(variable)
        allowed = set(values)
        for value in allowed:
            _check_value(value)
        old_base = set(var.base_domain)
        var.base_domain &= allowed
        base_changed = var.base_domain != old_base
        new_domain = self._domains[variable] & allowed
        if new_domain == self._domains[variable]:
            # Current domain unchanged: nothing to propagate, but still
            # report the variable if its declared domain moved or it is
            # stuck empty -- both are states the caller must not miss.
            if base_changed or not new_domain:
                return {variable}
            return set()
        self._domains[variable] = new_domain
        arcs = self._downstream_arcs(variable)
        _, affected = self._propagate(arcs)
        affected.add(variable)
        return affected

    def relax(self, variable: str, values: Iterable[Any]) -> Set[str]:
        """Add ``values`` back into a variable's domain and re-solve state.

        Widening a domain may resurrect values of *other* variables that
        were pruned earlier, so current domains are rebuilt from
        ``base_domain`` and fully re-propagated. If the engine was
        unsatisfiable before, it can be solved again afterwards.

        Returns:
            The set of variable names whose current domains changed.

        Raises:
            UnknownVariableError: ``variable`` is not registered.
        """
        var = self._require_variable(variable)
        added = set(values)
        for value in added:
            _check_value(value)
        if not added:
            return set()
        var.base_domain |= added
        return self._recompute_domains()

    def _require_variable(self, variable: str) -> Variable:
        """Fetch a registered variable or raise ``UnknownVariableError``."""
        if variable not in self._variables:
            raise UnknownVariableError(f"unknown variable {variable!r}")
        return self._variables[variable]

    def _downstream_arcs(self, variable: str) -> List[Tuple[str, str]]:
        """Arcs (cid, other_var) that may lose support when ``variable`` shrinks."""
        return [
            (cid, other)
            for cid in self._constraints_by_var[variable]
            for other in self._constraints[cid].scope
            if other != variable
        ]

    def _recompute_domains(self) -> Set[str]:
        """Rebuild current domains from base domains and fully propagate.

        Compares against a snapshot *copy* of the previous domains and
        treats missing keys on either side as empty sets, so a domain map
        that is out of sync with the variable registry cannot raise.
        """
        old = self._snapshot()
        self._domains = {name: set(var.base_domain) for name, var in self._variables.items()}
        self._propagate()
        names = set(old) | set(self._domains)
        return {
            name
            for name in names
            if old.get(name, set()) != self._domains.get(name, set())
        }

    # ------------------------------------------------------------------
    # Propagation (generalized AC-3)
    # ------------------------------------------------------------------

    def _all_arcs(self) -> List[Tuple[str, str]]:
        """Every directed arc (cid, var) of every constraint."""
        return [(cid, var) for cid, con in self._constraints.items() for var in con.scope]

    def _propagate(
        self,
        arcs: Optional[Iterable[Tuple[str, str]]] = None,
        record: Optional[List[Tuple[str, str, Any]]] = None,
    ) -> Tuple[bool, Set[str]]:
        """Run AC-3 style propagation until the queue empties or a domain wipes out.

        Args:
            arcs: initial arc queue; defaults to all arcs (full propagation).
            record: optional list that receives ``(cid, variable, value)``
                triples for every pruned value (used by conflict diagnosis).

        Returns:
            ``(consistent, affected)`` where ``consistent`` is False as soon
            as some domain became empty, and ``affected`` lists the variables
            whose domains shrank.
        """
        for dom in self._domains.values():
            if not dom:
                return False, set()
        queue: Deque[Tuple[str, str]] = deque(arcs if arcs is not None else self._all_arcs())
        in_queue: Set[Tuple[str, str]] = set(queue)
        affected: Set[str] = set()
        while queue:
            cid, var = queue.popleft()
            in_queue.discard((cid, var))
            constraint = self._constraints[cid]
            self._stats["propagations"] += 1
            removed = self._revise(constraint, var, record)
            if not removed:
                continue
            affected.add(var)
            self._stats["pruned"] += len(removed)
            if not self._domains[var]:
                return False, affected
            for arc in self._downstream_arcs(var):
                if arc not in in_queue:
                    queue.append(arc)
                    in_queue.add(arc)
        return True, affected

    def _revise(
        self,
        constraint: Constraint,
        var: str,
        record: Optional[List[Tuple[str, str, Any]]],
    ) -> List[Any]:
        """Remove every value of ``var`` that has no support in ``constraint``.

        A support is a tuple over the other scope variables' current domains
        (aligned with the full scope) that satisfies the predicate.
        """
        domain = self._domains[var]
        others = [name for name in constraint.scope if name != var]
        other_domains = [_sorted_domain(self._domains[name]) for name in others]
        position = constraint.scope.index(var)
        removed: List[Any] = []
        for value in _sorted_domain(domain):
            if not self._has_support(constraint, position, value, others, other_domains):
                removed.append(value)
                if record is not None:
                    record.append((constraint.cid, var, value))
        if removed:
            for value in removed:
                domain.discard(value)
        return removed

    def _has_support(
        self,
        constraint: Constraint,
        position: int,
        value: Any,
        others: List[str],
        other_domains: List[List[Any]],
    ) -> bool:
        """True iff some tuple over the other domains supports ``value``."""
        for combo in product(*other_domains):
            values = list(combo)
            values.insert(position, value)
            if self._call_predicate(constraint, tuple(values)):
                return True
        return False

    def _call_predicate(self, constraint: Constraint, values: Tuple[Any, ...]) -> bool:
        """Evaluate a constraint predicate, wrapping foreign exceptions."""
        try:
            return bool(constraint.predicate(values))
        except CspError:
            raise
        except Exception as exc:
            raise PredicateError(
                f"constraint {constraint.cid!r} predicate raised "
                f"{type(exc).__name__}: {exc} (values={values!r})"
            ) from exc

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def solve(self, max_branches: Optional[int] = None) -> SolveResult:
        """Solve the CSP: propagate to a fixpoint, then MRV backtracking search.

        The engine's current domains are restored before returning, so
        ``solve()`` never disturbs incremental state; the found assignment
        (if any) is returned inside the result.

        Args:
            max_branches: per-call override of the branch budget.

        Returns:
            ``SolveResult`` with status ``"sat"``/``"unsat"``/``"unknown"``.
        """
        budget = self.max_branches if max_branches is None else max_branches
        saved = self._snapshot()
        self._budget = budget
        try:
            consistent, _ = self._propagate()
            if not consistent:
                return SolveResult("unsat")
            try:
                assignment = self._backtrack()
            except _BudgetExhausted:
                return SolveResult("unknown")
            if assignment is None:
                return SolveResult("unsat")
            return SolveResult("sat", assignment)
        finally:
            self._domains = saved

    def _backtrack(self) -> Optional[Dict[str, Any]]:
        """Recursive MRV search; returns a full assignment or None (unsat)."""
        unassigned = [name for name, dom in self._domains.items() if len(dom) > 1]
        if not unassigned:
            # All domains are singletons; arc consistency on singletons means
            # every constraint is satisfied by this exact tuple.
            return {name: next(iter(dom)) for name, dom in self._domains.items()}
        var = min(unassigned, key=lambda n: (len(self._domains[n]), n))
        for value in _sorted_domain(self._domains[var]):
            if self._budget <= 0:
                raise _BudgetExhausted
            self._budget -= 1
            self._stats["branches"] += 1
            snapshot = self._snapshot()
            self._domains[var] = {value}
            consistent, _ = self._propagate(self._downstream_arcs(var))
            if consistent:
                result = self._backtrack()
                if result is not None:
                    return result
            self._domains = snapshot
            self._stats["backtracks"] += 1
        return None

    def _snapshot(self) -> Dict[str, Set[Any]]:
        """Deep copy of the current domain map."""
        return {name: set(dom) for name, dom in self._domains.items()}

    def get_stats(self) -> Dict[str, int]:
        """Cumulative counters: branches, backtracks, propagations, pruned.

        ``propagations`` counts arc revisions; ``branches`` counts value
        attempts during search. Also includes variable/constraint counts.
        """
        stats = dict(self._stats)
        stats["variables"] = len(self._variables)
        stats["constraints"] = len(self._constraints)
        return stats

    # ------------------------------------------------------------------
    # Conflict explanation
    # ------------------------------------------------------------------

    def explain_conflict(self) -> Conflict:
        """Explain why the current engine state is unsatisfiable.

        Re-runs propagation from the base domains while recording every
        rejected ``(variable, value)`` attempt, then shrinks the full
        constraint set to a minimal unsatisfiable subset (MUS) by
        deletion-based verification: a constraint is dropped only if the
        remainder is *still* unsatisfiable.

        Returns:
            A :class:`Conflict` with conflicting cids, per-constraint
            rejected attempts, the MUS, and a readable message.

        Raises:
            CspError: the engine is actually satisfiable, or the search
                budget was exhausted before unsatisfiability could be
                confirmed.
        """
        saved = self._snapshot()
        record: List[Tuple[str, str, Any]] = []
        try:
            self._domains = {name: set(var.base_domain) for name, var in self._variables.items()}
            consistent, _ = self._propagate(record=record)
        finally:
            self._domains = saved
        if consistent:
            result = self.solve()
            if result.status == "sat":
                raise CspError("explain_conflict: the problem is satisfiable, no conflict")
            if result.status == "unknown":
                raise CspError(
                    "explain_conflict: branch budget exhausted, cannot confirm the conflict"
                )
        attempts: Dict[str, List[Dict[str, Any]]] = {}
        order: List[str] = []
        for cid, var, value in record:
            if cid not in attempts:
                attempts[cid] = []
                order.append(cid)
            attempts[cid].append({"variable": var, "value": value})
        conflicting = order if order else list(self._constraints)
        mus = self._compute_mus()
        if mus:
            message = (
                f"unsatisfiable: {len(conflicting)} constraint(s) involved "
                f"{conflicting}; minimal unsatisfiable core ({len(mus)}): {mus}"
            )
        else:
            empty = [n for n, v in self._variables.items() if not v.base_domain]
            message = (
                "unsatisfiable even with no constraints "
                f"(empty domain for variable(s) {empty})"
            )
        return Conflict(
            conflicting_cids=conflicting,
            attempts=attempts,
            mus=mus,
            message=message,
        )

    def _compute_mus(self) -> List[str]:
        """Deletion-based MUS: drop each cid if the rest stays unsatisfiable."""
        mus = list(self._constraints)
        for cid in list(mus):
            trial = [c for c in mus if c != cid]
            if self._subset_unsat(trial):
                mus = trial
        return mus

    def _subset_unsat(self, cids: List[str]) -> bool:
        """True iff the engine restricted to ``cids`` is provably unsat.

        A ``"unknown"`` verdict (budget exhausted) is treated as *not*
        unsatisfiable, so the MUS stays conservative.
        """
        if any(not var.base_domain for var in self._variables.values()):
            return True  # empty declared domain: unsat regardless of constraints
        sub = CSPEngine(max_branches=self.max_branches)
        for name, var in self._variables.items():
            sub.add_variable(name, var.base_domain)
        for cid in cids:
            con = self._constraints[cid]
            if con.relation is not None:
                sub.add_constraint(cid, list(con.scope), relation=con.relation)
            else:
                sub.add_constraint(cid, list(con.scope), predicate=con.predicate)
        return sub.solve().status == "unsat"

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        """Full serializable state: variables, domains, constraints, stats.

        Raises:
            SerializationError: a constraint uses an opaque callable
                predicate, which cannot be represented in JSON.
        """
        constraints = []
        for con in self._constraints.values():
            if con.relation is None:
                raise SerializationError(
                    f"constraint {con.cid!r} uses an opaque callable predicate and "
                    "cannot be serialized; re-create it with a relation dict"
                )
            constraints.append(
                {"cid": con.cid, "scope": list(con.scope), "relation": con.relation}
            )
        return {
            "format": FORMAT_VERSION,
            "max_branches": self.max_branches,
            "variables": [
                {
                    "name": name,
                    "base_domain": _sorted_domain(var.base_domain),
                    "domain": _sorted_domain(self._domains[name]),
                }
                for name, var in self._variables.items()
            ],
            "constraints": constraints,
            "stats": dict(self._stats),
        }

    def save(self, path: str) -> None:
        """Write the full engine state (see :meth:`to_dict`) as JSON.

        Raises:
            SerializationError: unserializable constraint or unwritable path.
        """
        data = self.to_dict()
        try:
            with open(path, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
        except OSError as exc:
            raise SerializationError(f"cannot write {path!r}: {exc}") from exc

    @classmethod
    def load(cls, path: str) -> "CSPEngine":
        """Rebuild an engine from a JSON file written by :meth:`save`.

        Raises:
            LoadError: file missing/unreadable, invalid JSON, or any
                structural validation failure (duplicate names, dangling
                scope references, empty domains, unparseable relations...).
        """
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except OSError as exc:
            raise LoadError(f"cannot read {path!r}: {exc}") from exc
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise LoadError(f"invalid JSON in {path!r}: {exc}") from None
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Any) -> "CSPEngine":
        """Rebuild an engine from the dict produced by :meth:`to_dict`.

        Raises:
            LoadError: on any structural or referential inconsistency.
        """
        if not isinstance(data, dict):
            raise LoadError("top-level JSON value must be an object")
        fmt = data.get("format")
        if fmt != FORMAT_VERSION:
            raise LoadError(f"unsupported or missing format tag: {fmt!r}")
        for key in ("variables", "constraints"):
            if key not in data:
                raise LoadError(f"missing required field {key!r}")
            if not isinstance(data[key], list):
                raise LoadError(f"field {key!r} must be a list")

        max_branches = data.get("max_branches", 100_000)
        if isinstance(max_branches, bool) or not isinstance(max_branches, int) or max_branches < 0:
            raise LoadError(f"invalid max_branches: {max_branches!r}")
        engine = cls(max_branches=max_branches)

        saved_domains: Dict[str, Set[Any]] = {}
        try:
            for entry in data["variables"]:
                engine._load_variable(entry, saved_domains)
            for entry in data["constraints"]:
                engine._load_constraint(entry)
        except CspError as exc:
            raise LoadError(f"invalid file contents: {exc}") from None
        engine._domains = saved_domains

        stats = data.get("stats", {})
        if not isinstance(stats, dict) or any(
            not isinstance(k, str) or isinstance(v, bool) or not isinstance(v, int)
            for k, v in stats.items()
        ):
            raise LoadError(f"invalid stats field: {stats!r}")
        engine._stats.update(stats)
        engine._validate_fixpoint()
        return engine

    def _validate_fixpoint(self) -> None:
        """Check that the restored current domains are an arc-consistency fixpoint.

        Re-runs propagation on a scratch copy of the domains (stats are
        restored afterwards, so validation does not pollute them). An empty
        current domain counts as a valid fixpoint: propagation stops there.

        Raises:
            LoadError: a saved current domain still holds values that
                propagation would prune, i.e. the file is inconsistent with
                its own constraints.
        """
        original_domains = self._domains
        original_stats = self._stats
        try:
            self._domains = {name: set(dom) for name, dom in original_domains.items()}
            self._stats = dict(original_stats)
            self._propagate()
            if self._domains != original_domains:
                for name in self._variables:
                    if self._domains.get(name) != original_domains.get(name):
                        raise LoadError(
                            f"variable {name!r}: saved domain "
                            f"{_sorted_domain(original_domains.get(name, set()))} is not "
                            "an arc-consistency fixpoint of the constraints"
                        )
        finally:
            self._domains = original_domains
            self._stats = original_stats

    def _load_variable(self, entry: Any, saved_domains: Dict[str, Set[Any]]) -> None:
        """Validate and register one variable entry from a saved file.

        ``base_domain`` may legitimately be empty here: ``tighten(x, [])``
        produces exactly that state, and save/load must round-trip it. The
        non-empty rule is enforced only by :meth:`add_variable`.
        """
        if not isinstance(entry, dict):
            raise LoadError(f"variable entry must be an object: {entry!r}")
        for key in ("name", "base_domain", "domain"):
            if key not in entry:
                raise LoadError(f"variable entry missing field {key!r}: {entry!r}")
        name = entry["name"]
        base = entry["base_domain"]
        current = entry["domain"]
        if not isinstance(name, str) or not name:
            raise LoadError(f"variable name must be a non-empty string: {name!r}")
        if name in self._variables:
            raise LoadError(f"duplicate variable name {name!r}")
        if not isinstance(base, list) or not isinstance(current, list):
            raise LoadError(f"variable {name!r}: domains must be lists")
        for value in base:
            _check_value(value)
        self._variables[name] = Variable(name=name, base_domain=set(base))
        self._constraints_by_var[name] = []
        self._domains[name] = set(base)
        for value in current:
            _check_value(value)
        current_set = set(current)
        if not current_set <= set(base):
            raise LoadError(f"variable {name!r}: current domain is not a subset of base domain")
        saved_domains[name] = current_set

    def _load_constraint(self, entry: Any) -> None:
        """Validate and install one constraint entry from a saved file."""
        if not isinstance(entry, dict):
            raise LoadError(f"constraint entry must be an object: {entry!r}")
        for key in ("cid", "scope", "relation"):
            if key not in entry:
                raise LoadError(f"constraint entry missing field {key!r}: {entry!r}")
        cid, scope, relation = entry["cid"], entry["scope"], entry["relation"]
        if not isinstance(cid, str) or not cid:
            raise LoadError(f"constraint cid must be a non-empty string: {cid!r}")
        if cid in self._constraints:
            raise LoadError(f"duplicate constraint cid {cid!r}")
        scope_list = self._validate_scope(scope)
        compiled = compile_relation(relation, scope_list)
        self._install_constraint(
            Constraint(cid=cid, scope=scope_list, predicate=compiled, relation=relation)
        )

    # ------------------------------------------------------------------
    # Introspection helpers (used by the CLI and tests)
    # ------------------------------------------------------------------

    def current_domain(self, variable: str) -> Set[Any]:
        """Current (propagated) domain of a variable, as a set copy."""
        self._require_variable(variable)
        return set(self._domains[variable])

    def base_domain(self, variable: str) -> Set[Any]:
        """Declared base domain of a variable, as a set copy."""
        self._require_variable(variable)
        return set(self._variables[variable].base_domain)

    def constraint_ids(self) -> List[str]:
        """All registered constraint ids, in insertion order."""
        return list(self._constraints)

    def variable_names(self) -> List[str]:
        """All registered variable names, in insertion order."""
        return list(self._variables)
