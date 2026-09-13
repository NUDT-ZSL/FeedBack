"""Command-line entry point for the workflow orchestration kernel.

Reads JSON commands from standard input, one per line, and writes one JSON
result per line to standard output.  Errors are reported as JSON objects
with an ``error`` field; the loop never crashes on a bad command.

Supported commands (``cmd`` field)::

    {"cmd": "define",   "machine": {<machine spec>}}       # or fields inline
    {"cmd": "create",   "machine_id": "m", "instance_id": "i", "variables": {...}}
    {"cmd": "send",     "instance_id": "i", "event": "go"}
    {"cmd": "validate", "machine_id": "m"}
    {"cmd": "instance", "instance_id": "i"}
    {"cmd": "history",  "instance_id": "i"}
    {"cmd": "tick",     "n": 5}
    {"cmd": "save",     "path": "state.json"}
    {"cmd": "load",     "path": "state.json"}
    {"cmd": "dump"}
    {"cmd": "timer",    "machine_id": "m", "state": "s", "after": 3, "event": "e"}

Actions are Python callables and therefore cannot be defined over stdin; a
few built-ins are pre-registered for scripting and demos:

* ``noop`` — returns the variables unchanged,
* ``fail`` — always raises (useful to exercise compensation rollback),
* ``inc``  — increments the integer variable ``count`` (compensation: ``dec``).
"""

from __future__ import annotations

import io
import json
import sys
from typing import Any, Dict

from kernel import WorkflowEngine, WorkflowError


def build_engine() -> WorkflowEngine:
    """Create an engine with the built-in demo actions registered."""

    def _noop(variables: Dict[str, Any]) -> Dict[str, Any]:
        return variables

    def _fail(variables: Dict[str, Any]) -> Dict[str, Any]:
        raise RuntimeError("built-in action 'fail' always fails")

    def _inc(variables: Dict[str, Any]) -> Dict[str, Any]:
        variables = dict(variables)
        count = variables.get("count", 0)
        if isinstance(count, bool) or not isinstance(count, int):
            raise RuntimeError("variable 'count' is not an integer")
        variables["count"] = count + 1
        return variables

    def _dec(variables: Dict[str, Any]) -> Dict[str, Any]:
        variables = dict(variables)
        count = variables.get("count", 0)
        if isinstance(count, int) and not isinstance(count, bool):
            variables["count"] = count - 1
        return variables

    engine = WorkflowEngine()
    engine.register_action("noop", _noop)
    engine.register_action("fail", _fail)
    engine.register_action("inc", _inc)
    engine.register_compensation("inc", _dec)
    return engine


def handle_command(engine: WorkflowEngine, command: Any) -> Dict[str, Any]:
    """Execute one parsed *command* against *engine* and return a result dict.

    The result always contains ``ok``; failures additionally contain
    ``error``.  This function never raises.
    """
    if not isinstance(command, dict):
        return {"ok": False, "error": f"command must be a JSON object, got {command!r}"}
    cmd = command.get("cmd")
    try:
        if cmd == "define":
            spec = command.get("machine")
            if spec is None:
                spec = {k: v for k, v in command.items() if k != "cmd"}
            machine = engine.define_machine(spec)
            return {"ok": True, "machine_id": machine.machine_id}
        if cmd == "create":
            instance = engine.create_instance(
                command.get("machine_id"),
                command.get("instance_id"),
                command.get("variables"),
            )
            return {"ok": True, "instance": instance}
        if cmd == "send":
            return engine.send_event(
                command.get("instance_id"), command.get("event")
            ).to_dict()
        if cmd == "validate":
            diagnostics = engine.validate(command.get("machine_id"))
            return {
                "ok": True,
                "consistent": not diagnostics,
                "diagnostics": [d.to_dict() for d in diagnostics],
            }
        if cmd == "instance":
            return {"ok": True, "instance": engine.get_instance(command.get("instance_id"))}
        if cmd == "history":
            return {"ok": True, "history": engine.get_history(command.get("instance_id"))}
        if cmd == "tick":
            fired = engine.tick(command.get("n", 1))
            return {
                "ok": True,
                "clock": engine.clock,
                "fired": [result.to_dict() for result in fired],
            }
        if cmd == "save":
            engine.save(command.get("path"))
            return {"ok": True, "path": command.get("path")}
        if cmd == "load":
            engine.load(command.get("path"))
            return {"ok": True, "path": command.get("path")}
        if cmd == "dump":
            return {"ok": True, "state": engine.snapshot()}
        if cmd == "timer":
            engine.register_timer(
                command.get("machine_id"),
                command.get("state"),
                command.get("after"),
                command.get("event"),
            )
            return {"ok": True}
        return {"ok": False, "error": f"unknown command: {cmd!r}"}
    except WorkflowError as exc:
        return {"ok": False, "error": str(exc), "error_type": type(exc).__name__}
    except Exception as exc:  # defensive: one bad command must not kill the loop
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}


def main() -> None:
    """Run the read-eval-print loop over stdin/stdout."""
    engine = build_engine()
    # utf-8-sig: tolerate a BOM produced by Windows shells/editors.
    stream = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8-sig")
    for line in stream:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            result = {"ok": False, "error": f"invalid JSON: {exc}"}
        else:
            result = handle_command(engine, command)
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
