"""JSON-lines command interface for the CSP engine.

Reads one JSON command object per line from standard input and writes one
JSON result object per line to standard output. Errors are reported as
``{"ok": false, "error": "..."}`` and never abort the loop.

Commands (``cmd`` field):

* ``add_var``    -- ``{"cmd": "add_var", "name": "x", "domain": [1, 2, 3]}``
* ``add_con``    -- ``{"cmd": "add_con", "cid": "c1", "scope": ["x", "y"],
                    "relation": {"op": "lt"}}`` (``predicate`` accepted as an
                    alias for ``relation``)
* ``remove_con`` -- ``{"cmd": "remove_con", "cid": "c1"}``
* ``tighten``    -- ``{"cmd": "tighten", "variable": "x", "values": [1, 2]}``
* ``relax``      -- ``{"cmd": "relax", "variable": "x", "values": [3]}``
* ``solve``      -- ``{"cmd": "solve"}`` (optional ``max_branches``)
* ``conflict``   -- ``{"cmd": "conflict"}``
* ``stats``      -- ``{"cmd": "stats"}``
* ``save``       -- ``{"cmd": "save", "path": "state.json"}``
* ``load``       -- ``{"cmd": "load", "path": "state.json"}``
* ``dump``       -- ``{"cmd": "dump"}`` (full engine state as JSON)
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, IO, Tuple

from csp_engine import CSPEngine, CspError


def handle(engine: CSPEngine, request: Any) -> Tuple[CSPEngine, Dict[str, Any]]:
    """Execute one command and return ``(engine, response)``.

    ``load`` replaces the engine instance, which is why the (possibly new)
    engine is returned alongside the response.

    Raises:
        CspError: any engine-level failure (caller renders it as JSON).
        KeyError: a required command field is missing.
    """
    if not isinstance(request, dict):
        raise CspError("command must be a JSON object")
    cmd = request.get("cmd")
    if not isinstance(cmd, str):
        raise CspError("command requires a string 'cmd' field")

    if cmd == "add_var":
        engine.add_variable(request["name"], request["domain"])
        return engine, {"ok": True}
    if cmd == "add_con":
        relation = request.get("relation", request.get("predicate"))
        affected = engine.add_constraint(request["cid"], request["scope"], relation=relation)
        return engine, {"ok": True, "affected": sorted(affected)}
    if cmd == "remove_con":
        affected = engine.remove_constraint(request["cid"])
        return engine, {"ok": True, "affected": sorted(affected)}
    if cmd == "tighten":
        affected = engine.tighten(request["variable"], request["values"])
        return engine, {"ok": True, "affected": sorted(affected)}
    if cmd == "relax":
        affected = engine.relax(request["variable"], request["values"])
        return engine, {"ok": True, "affected": sorted(affected)}
    if cmd == "solve":
        result = engine.solve(max_branches=request.get("max_branches"))
        return engine, {"ok": True, **result.to_dict()}
    if cmd == "conflict":
        conflict = engine.explain_conflict()
        return engine, {"ok": True, "conflict": conflict.to_dict()}
    if cmd == "stats":
        return engine, {"ok": True, "stats": engine.get_stats()}
    if cmd == "save":
        engine.save(request["path"])
        return engine, {"ok": True}
    if cmd == "load":
        engine = CSPEngine.load(request["path"])
        return engine, {"ok": True}
    if cmd == "dump":
        return engine, {"ok": True, "state": engine.to_dict()}
    raise CspError(f"unknown command {cmd!r}")


def main(stream: IO[str] = None, out: IO[str] = None) -> None:
    """Run the command loop: one JSON command in, one JSON result out."""
    stream = stream if stream is not None else sys.stdin
    out = out if out is not None else sys.stdout
    engine = CSPEngine()
    for line in stream:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response: Dict[str, Any] = {"ok": False, "error": f"invalid JSON: {exc}"}
        else:
            try:
                engine, response = handle(engine, request)
            except KeyError as exc:
                response = {"ok": False, "error": f"missing field: {exc}"}
            except CspError as exc:
                response = {"ok": False, "error": str(exc)}
            except Exception as exc:  # defensive: the loop must not die
                response = {"ok": False, "error": f"internal error: {type(exc).__name__}: {exc}"}
        out.write(json.dumps(response) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
