"""Command-line entry point for the work-stealing executor.

Reads JSON commands from standard input, one per line, and writes one JSON
result per line to standard output.  Errors are reported as JSON objects
with an ``error`` field (and ``ok: false``).

Usage::

    python main.py [workers]

Supported commands (each is a JSON object with a ``cmd`` key)::

    {"cmd": "submit", "task_id": "a", "deps": [], "timeout": 5,
     "max_retries": 1, "payload": {"kind": "const", "value": 1}}
    {"cmd": "submit_many", "tasks": [<task>, <task>, ...]}
    {"cmd": "cancel", "task_id": "a"}
    {"cmd": "run"}
    {"cmd": "result", "task_id": "a"}
    {"cmd": "state"}
    {"cmd": "save", "path": "snapshot.json"}
    {"cmd": "load", "path": "snapshot.json"}
    {"cmd": "dump"}

Since executable code cannot be sent over JSON, payloads for the CLI are
small built-in specifications:

* ``{"kind": "const", "value": <any JSON>}`` -- returns ``value``.
* ``{"kind": "fail", "message": "..."}`` -- raises ``RuntimeError``.
* ``{"kind": "sleep", "seconds": 0.5, "value": <any JSON>}`` -- sleeps
  (cooperatively cancellable), then returns ``value``.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any, Callable, Dict, List

from executor import (
    ExecutorError,
    Task,
    UnknownTaskError,
    ValidationError,
    WorkStealingExecutor,
    current_cancel_token,
)


class _PayloadCancelled(Exception):
    """Raised by CLI payloads when they observe their cancellation token."""


def make_payload(spec: Any) -> Callable[[], Any]:
    """Build a payload callable from a JSON payload specification."""
    if not isinstance(spec, dict) or "kind" not in spec:
        raise ValidationError("payload must be an object with a 'kind' field")
    kind = spec["kind"]
    if kind == "const":
        value = spec.get("value")
        return lambda: value
    if kind == "fail":
        message = str(spec.get("message", "payload failed"))

        def _fail() -> Any:
            raise RuntimeError(message)

        return _fail
    if kind == "sleep":
        try:
            seconds = float(spec.get("seconds", 0))
        except (TypeError, ValueError):
            raise ValidationError(f"sleep payload: invalid 'seconds': {spec.get('seconds')!r}")
        if seconds < 0:
            raise ValidationError("sleep payload: 'seconds' must be >= 0")
        value = spec.get("value")

        def _sleep() -> Any:
            token = current_cancel_token()
            deadline = time.monotonic() + seconds
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return value
                if token is not None and token.is_cancelled:
                    raise _PayloadCancelled("payload observed cancellation")
                time.sleep(min(0.01, remaining))

        return _sleep
    raise ValidationError(f"unknown payload kind: {kind!r}")


def task_from_dict(data: Any) -> Task:
    """Build a :class:`Task` from a JSON task definition."""
    if not isinstance(data, dict):
        raise ValidationError("task definition must be a JSON object")
    if "task_id" not in data:
        raise ValidationError("task definition is missing 'task_id'")
    if "payload" not in data:
        raise ValidationError(f"task {data['task_id']!r} is missing 'payload'")
    return Task(
        task_id=data["task_id"],
        payload=make_payload(data["payload"]),
        deps=data.get("deps", []),
        timeout=data.get("timeout"),
        max_retries=data.get("max_retries", 0),
    )


def _ok(**extra: Any) -> Dict[str, Any]:
    response: Dict[str, Any] = {"ok": True}
    response.update(extra)
    return response


def _err(error_type: str, message: str) -> Dict[str, Any]:
    return {"ok": False, "error": {"type": error_type, "message": message}}


def _require(command: Dict[str, Any], field: str) -> Any:
    if field not in command:
        raise ValidationError(f"command {command.get('cmd')!r} is missing field {field!r}")
    return command[field]


def handle(holder: Dict[str, WorkStealingExecutor], command: Any) -> Dict[str, Any]:
    """Execute one parsed command and return its JSON-able response."""
    if not isinstance(command, dict):
        return _err("InvalidCommand", "each command must be a JSON object")
    op = command.get("cmd")
    try:
        executor = holder["executor"]
        if op == "submit":
            executor.submit(task_from_dict(command))
            return _ok()
        if op == "submit_many":
            raw_tasks = command.get("tasks")
            if not isinstance(raw_tasks, list):
                raise ValidationError("submit_many requires a 'tasks' list")
            tasks = [task_from_dict(item) for item in raw_tasks]
            executor.submit_many(tasks)
            return _ok(submitted=len(tasks))
        if op == "cancel":
            executor.cancel(_require(command, "task_id"))
            return _ok()
        if op == "run":
            executor.run()
            return _ok(summary=executor.get_state()["counts"])
        if op == "result":
            return _ok(result=executor.get_result(_require(command, "task_id")))
        if op == "state":
            return _ok(state=executor.get_state())
        if op == "save":
            executor.save(_require(command, "path"))
            return _ok()
        if op == "load":
            holder["executor"] = WorkStealingExecutor.load(_require(command, "path"))
            return _ok()
        if op == "dump":
            return _ok(snapshot=executor.snapshot())
        return _err("UnknownCommand", f"unknown command: {op!r}")
    except UnknownTaskError as exc:
        return _err("UnknownTask", str(exc))
    except ExecutorError as exc:
        return _err(type(exc).__name__, str(exc))
    except Exception as exc:  # noqa: BLE001 - last-resort JSON error envelope
        return _err(type(exc).__name__, str(exc))


def main(argv: List[str] = None) -> int:
    """Run the command loop.  Optional first argument: worker thread count."""
    args = list(sys.argv[1:] if argv is None else argv)
    workers = 4
    if args:
        try:
            workers = int(args[0])
        except ValueError:
            sys.stderr.write(f"invalid worker count: {args[0]!r}\n")
            return 2
    try:
        holder: Dict[str, WorkStealingExecutor] = {
            "executor": WorkStealingExecutor(workers=workers)
        }
    except ExecutorError as exc:
        sys.stderr.write(f"cannot start executor: {exc}\n")
        return 2
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            response = _err("InvalidJSON", f"input line is not valid JSON: {exc}")
        else:
            response = handle(holder, command)
        sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
