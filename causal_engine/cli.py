"""逐行 JSON 命令行接口。

协议：从标准输入逐行读取 JSON 对象，每行一条命令，向标准输出写一行
JSON 结果。成功响应形如::

    {"ok": true, "cmd": "register", "result": {...}}

失败响应形如::

    {"ok": false, "cmd": "append", "error": "具体错误信息",
     "error_type": "InvalidEventError"}

空行被忽略。支持的命令：

register / append / snapshot / replay / state / get / list /
save / load / dump
"""

from __future__ import annotations

import json
import sys
from typing import Any, TextIO

from causal_engine.engine import CausalEngine, Event
from causal_engine.exceptions import CausalEngineError

# 命令名 -> 必需字段
_REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "register": ("process_id",),
    "append": ("event",),
    "snapshot": ("process_cut",),
    "replay": ("seeds",),
    "get": ("event_id",),
    "list": ("process_id",),
    "save": ("path",),
    "load": ("path",),
}


def _ok(cmd: str, result: Any) -> dict[str, Any]:
    return {"ok": True, "cmd": cmd, "result": result}


def _err(cmd: str | None, message: str, error_type: str = "ProtocolError") -> dict[str, Any]:
    response: dict[str, Any] = {
        "ok": False,
        "error": message,
        "error_type": error_type,
    }
    if cmd is not None:
        response["cmd"] = cmd
    return response


def process_command(
    engine: CausalEngine, command: dict[str, Any]
) -> tuple[CausalEngine, dict[str, Any]]:
    """执行一条已解析的命令。

    :param engine: 当前引擎实例（``load`` 成功时会返回新实例）。
    :param command: 命令字典，必须含 ``cmd`` 字段。
    :return: ``(可能被替换的引擎, JSON 可序列化的响应字典)``。
    """
    cmd = command.get("cmd")
    if not isinstance(cmd, str):
        return engine, _err(None, "command must be a JSON object with a string 'cmd' field")

    required = _REQUIRED_FIELDS.get(cmd)
    if required is None:
        if cmd in ("state", "dump"):
            required = ()
        else:
            return engine, _err(cmd, f"unknown command: {cmd!r}")

    missing = [field for field in required if field not in command]
    if missing:
        return engine, _err(
            cmd,
            f"command {cmd!r} is missing required field(s): {', '.join(missing)}",
            "ProtocolError",
        )

    try:
        if cmd == "register":
            pid = engine.register_process(command["process_id"])
            return engine, _ok(cmd, {"process_id": pid, "registered": True})

        if cmd == "append":
            raw_event = command["event"]
            if not isinstance(raw_event, dict):
                return engine, _err(cmd, "'event' must be a JSON object")
            try:
                event = Event(
                    event_id=raw_event["event_id"],
                    process_id=raw_event["process_id"],
                    seq=raw_event["seq"],
                    vector=raw_event.get("vector", {}),
                    payload=raw_event.get("payload"),
                )
            except KeyError as exc:
                return engine, _err(
                    cmd,
                    f"'event' is missing required field: {exc.args[0]}",
                    "InvalidEventError",
                )
            except CausalEngineError as exc:
                return engine, _err(cmd, str(exc), type(exc).__name__)
            engine.append(event)
            return engine, _ok(cmd, {"event_id": event.event_id, "appended": True})

        if cmd == "snapshot":
            events = engine.consistent_snapshot(command["process_cut"])
            return engine, _ok(cmd, [event.to_dict() for event in events])

        if cmd == "replay":
            seeds = command["seeds"]
            if not isinstance(seeds, list):
                return engine, _err(cmd, "'seeds' must be a list")
            events = engine.replay_closure(seeds)
            return engine, _ok(cmd, [event.to_dict() for event in events])

        if cmd == "state":
            return engine, _ok(cmd, engine.get_state())

        if cmd == "get":
            event = engine.get_event(command["event_id"])
            return engine, _ok(cmd, None if event is None else event.to_dict())

        if cmd == "list":
            events = engine.list_events(command["process_id"])
            return engine, _ok(cmd, [event.to_dict() for event in events])

        if cmd == "save":
            engine.save(command["path"])
            return engine, _ok(cmd, {"path": command["path"], "saved": True})

        if cmd == "load":
            loaded = CausalEngine.load(command["path"])
            return loaded, _ok(cmd, loaded.get_state())

        if cmd == "dump":
            return engine, _ok(cmd, engine.dump())

    except CausalEngineError as exc:
        return engine, _err(cmd, str(exc), type(exc).__name__)

    # 理论上不可达：未知命令已在前面拦截
    return engine, _err(cmd, f"unsupported command: {cmd!r}")


def run_stream(
    input_stream: TextIO,
    output_stream: TextIO,
    engine: CausalEngine | None = None,
) -> CausalEngine:
    """从文本流逐行读取命令并逐行写出结果。

    :param input_stream: 输入流（通常是 ``sys.stdin``）。
    :param output_stream: 输出流（通常是 ``sys.stdout``）。
    :param engine: 可选的初始引擎。
    :return: 处理完所有命令后的引擎（``load`` 可能替换实例）。
    """
    if engine is None:
        engine = CausalEngine()
    for line in input_stream:
        stripped = line.strip()
        if not stripped:
            continue
        try:
            command = json.loads(stripped)
        except json.JSONDecodeError as exc:
            response = _err(
                None,
                f"invalid JSON at line ({exc.msg})",
                "ProtocolError",
            )
        else:
            if not isinstance(command, dict):
                response = _err(
                    None, "each command must be a JSON object"
                )
            else:
                engine, response = process_command(engine, command)
        output_stream.write(json.dumps(response, ensure_ascii=False) + "\n")
        output_stream.flush()
    return engine


def main(argv: list[str] | None = None) -> int:
    """命令行入口：标准输入读命令，标准输出写结果。

    :return: 进程退出码（始终为 0；单条命令失败只体现在 JSON 响应里）。
    """
    run_stream(sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
