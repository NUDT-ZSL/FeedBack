#!/usr/bin/env python3
"""optcore 命令行入口：从标准输入逐行读取 JSON 命令。

支持的命令（每行一个 JSON 对象，``cmd`` 或 ``command`` 指定命令名）：

* ``pack``     —— 仅求解装箱，字段 items / bins；
* ``schedule`` —— 仅求解排程，字段 tasks / resources；
* ``solve``    —— 统一求解，字段 items / bins / tasks / resources；
* ``save``     —— 求解并把问题与结果写入 ``path`` 指向的 JSON 快照；
* ``load``     —— 从 ``path`` 读取快照，校验后载入会话状态；
* ``dump``     —— 输出当前会话的问题与结果。

每条命令对应输出一行 JSON；成功为 ``{"ok": true, ...}``，
失败为 ``{"ok": false, "error": "...", ...}``。空行将被忽略。

也可通过 ``python main.py 输入文件`` 从文件读取命令（便于验收脚本）。
"""

from __future__ import annotations

import io
import json
import sys
from typing import Any, Dict, Optional, Tuple

from optcore.errors import InvalidInputError, OptCoreError, PersistenceError
from optcore.models import SolveResult
from optcore.persistence import (
    SNAPSHOT_FORMAT,
    SNAPSHOT_VERSION,
    load_snapshot,
    save_problem,
)
from optcore.solver import Problem, solve_problem

JSONDict = Dict[str, Any]


class Session:
    """跨命令保存的会话状态：当前问题与其求解结果。"""

    def __init__(self) -> None:
        self.problem = Problem()
        self.result: Optional[SolveResult] = None

    def set_problem(self, problem: Problem) -> None:
        """载入新问题并重算结果。"""
        self.problem = problem
        self.result = solve_problem(problem)

    def snapshot_dict(self) -> JSONDict:
        return {
            "format": SNAPSHOT_FORMAT,
            "version": SNAPSHOT_VERSION,
            "problem": self.problem.to_dict(),
            "result": self.result.to_dict() if self.result is not None else None,
        }


def _build_problem(payload: JSONDict) -> Problem:
    """从命令负载构造并校验 Problem（含资源时间窗解析）。"""
    return Problem.from_raw(
        items=payload.get("items"),
        bins=payload.get("bins"),
        tasks=payload.get("tasks"),
        resources=payload.get("resources"),
    )


def _error(message: str, command: Optional[str], error_type: str) -> JSONDict:
    response: JSONDict = {"ok": False, "error": message, "error_type": error_type}
    if command is not None:
        response["command"] = command
    return response


def handle(payload: JSONDict, session: Session) -> JSONDict:
    """分发并执行一条命令，返回可 JSON 序列化的响应。"""
    command = payload.get("cmd") or payload.get("command")
    if not isinstance(command, str):
        raise InvalidInputError("每条命令必须包含字符串字段 cmd")

    if command == "solve":
        problem = _build_problem(payload)
        session.set_problem(problem)
        return {"ok": True, "command": command, "result": session.result.to_dict()}

    if command == "pack":
        problem = _build_problem(payload)
        session.set_problem(problem)
        result = session.result
        return {
            "ok": True,
            "command": command,
            "result": result.packing.to_dict() if result and result.packing else None,
        }

    if command == "schedule":
        problem = _build_problem(payload)
        session.set_problem(problem)
        result = session.result
        return {
            "ok": True,
            "command": command,
            "result": result.schedule.to_dict()
            if result and result.schedule
            else None,
        }

    if command == "save":
        path = payload.get("path")
        if not isinstance(path, str) or not path:
            raise InvalidInputError("save 命令需要非空字符串字段 path")
        # 提供了任一字段就视为新问题，否则保存当前会话状态。
        if any(k in payload for k in ("items", "bins", "tasks", "resources")):
            problem = _build_problem(payload)
            session.set_problem(problem)
        save_problem(path, session.problem, session.result)
        return {"ok": True, "command": command, "path": path}

    if command == "load":
        path = payload.get("path")
        if not isinstance(path, str) or not path:
            raise InvalidInputError("load 命令需要非空字符串字段 path")
        snapshot = load_snapshot(path)
        session.problem = snapshot.problem
        session.result = (
            snapshot.result
            if snapshot.result is not None
            else solve_problem(snapshot.problem)
        )
        return {"ok": True, "command": command, "snapshot": session.snapshot_dict()}

    if command == "dump":
        return {"ok": True, "command": command, "snapshot": session.snapshot_dict()}

    raise InvalidInputError(f"未知命令: {command!r}（支持 pack/schedule/solve/save/load/dump）")


def process_line(line: str, session: Session) -> JSONDict:
    """解析并处理一行输入，任何失败都转为带 error 字段的响应。"""
    try:
        payload = json.loads(line)
    except json.JSONDecodeError as exc:
        return _error(f"不是合法 JSON: {exc.msg}（第 {exc.lineno} 行）", None, "JSONDecodeError")
    if not isinstance(payload, dict):
        return _error("命令必须是 JSON 对象", None, "InvalidInputError")
    command = payload.get("cmd") or payload.get("command")
    try:
        return handle(payload, session)
    except (InvalidInputError, PersistenceError) as exc:
        return _error(str(exc), command if isinstance(command, str) else None,
                      type(exc).__name__)
    except OptCoreError as exc:
        return _error(str(exc), command if isinstance(command, str) else None,
                      type(exc).__name__)


def run(stream: io.TextIOBase, out: io.TextIOBase) -> int:
    """从 stream 逐行读命令并向 out 逐行写结果。"""
    session = Session()
    for line in stream:
        line = line.strip()
        if not line:
            continue
        response = process_line(line, session)
        out.write(json.dumps(response, ensure_ascii=False) + "\n")
        out.flush()
    return 0


def main(argv: Optional[Tuple[str, ...]] = None) -> int:
    """命令行主入口：无参数读标准输入，有参数把参数当输入文件。"""
    # Windows 管道默认使用区域编码（如 GBK），统一强制 UTF-8 以保证
    # 中文错误信息可被验收脚本按 JSON/UTF-8 解析。
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    argv = tuple(sys.argv[1:] if argv is None else argv)
    if argv:
        with open(argv[0], "r", encoding="utf-8") as handle:
            return run(handle, sys.stdout)
    return run(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
