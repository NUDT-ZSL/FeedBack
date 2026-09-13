"""排期引擎命令行入口（纯标准库）。

从标准输入逐行读取 JSON 命令，向标准输出逐行写回 JSON 结果：

- 成功：``{"ok": true, "result": ...}``
- 失败：``{"ok": false, "error": "错误信息"}``

支持的命令（每行一个 JSON 对象，字段名如下）：

``add_resource``   resource_id, availability=[[s,e], ...]
``add_task``       task_id, resource_id, start, end, priority=0, deps=[]
``move``           task_id, new_start, new_end            （冲突时 result.success=false）
``get``            task_id
``list``           resource_id?（省略则列出全部）
``timeline``       resource_id, start, end
``chain``          task_id
``save``           path
``load``           path                                   （成功后替换当前引擎状态）
``dump``           （无额外字段，输出完整快照）

空行会被跳过；非法 JSON、未知命令、字段错误都以 JSON 错误行返回。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional, TextIO

from schedule import (
    MoveResult,
    ScheduleEngine,
    ScheduleError,
)


def _missing(cmd: Dict[str, Any], key: str) -> None:
    """命令缺少必填字段时抛出带命令名的错误。"""

    if key not in cmd:
        raise ScheduleError(f"命令 {cmd.get('cmd')!r} 缺少字段 {key!r}")


def _ok(result: Any) -> str:
    return json.dumps({"ok": True, "result": result}, ensure_ascii=False)


def _err(message: str) -> str:
    return json.dumps({"ok": False, "error": message}, ensure_ascii=False)


def handle_command(engine: ScheduleEngine, cmd: Dict[str, Any]) -> ScheduleEngine:
    """执行单条命令；返回执行后应使用的引擎（load 会替换引擎）。

    成功时把结果写入 ``cmd`` 的 ``_response`` 键（由调用方取出），
    失败时抛出 :class:`ScheduleError`。
    """

    name = cmd.get("cmd")
    if not isinstance(name, str):
        raise ScheduleError("每行输入必须是含字符串字段 cmd 的 JSON 对象")

    if name == "add_resource":
        for key in ("resource_id", "availability"):
            _missing(cmd, key)
        engine.add_resource(cmd["resource_id"], cmd["availability"])
        cmd["_response"] = {"added": "resource", "resource_id": cmd["resource_id"]}

    elif name == "add_task":
        for key in ("task_id", "resource_id", "start", "end"):
            _missing(cmd, key)
        engine.add_task(
            cmd["task_id"],
            cmd["resource_id"],
            cmd["start"],
            cmd["end"],
            priority=cmd.get("priority", 0),
            deps=cmd.get("deps", []),
        )
        cmd["_response"] = {"added": "task", "task_id": cmd["task_id"]}

    elif name == "move":
        for key in ("task_id", "new_start", "new_end"):
            _missing(cmd, key)
        result: MoveResult = engine.move(
            cmd["task_id"], cmd["new_start"], cmd["new_end"]
        )
        cmd["_response"] = result.to_dict()

    elif name == "get":
        _missing(cmd, "task_id")
        cmd["_response"] = engine.get_task(cmd["task_id"])

    elif name == "list":
        cmd["_response"] = engine.list_tasks(cmd.get("resource_id"))

    elif name == "timeline":
        for key in ("resource_id", "start", "end"):
            _missing(cmd, key)
        cmd["_response"] = engine.get_resource_timeline(
            cmd["resource_id"], cmd["start"], cmd["end"]
        )

    elif name == "chain":
        _missing(cmd, "task_id")
        cmd["_response"] = engine.get_dependency_chain(cmd["task_id"])

    elif name == "save":
        _missing(cmd, "path")
        engine.save(cmd["path"])
        cmd["_response"] = {"saved": cmd["path"]}

    elif name == "load":
        _missing(cmd, "path")
        engine = ScheduleEngine.load(cmd["path"])
        cmd["_response"] = {"loaded": cmd["path"]}

    elif name == "dump":
        cmd["_response"] = engine.to_dict()

    else:
        raise ScheduleError(f"未知命令 {name!r}")

    return engine


def run(
    stdin: TextIO,
    stdout: TextIO,
    engine: Optional[ScheduleEngine] = None,
) -> int:
    """逐行处理命令流；返回进程退出码（始终为 0，错误以 JSON 行表达）。"""

    if engine is None:
        engine = ScheduleEngine()
    for line_no, raw in enumerate(stdin, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if not isinstance(cmd, dict):
                raise ScheduleError("命令必须是 JSON 对象")
            engine = handle_command(engine, cmd)
            response = _ok(cmd["_response"])
        except json.JSONDecodeError as exc:
            response = _err(
                f"第 {line_no} 行不是合法 JSON：{exc.msg}"
            )
        except (ScheduleError, TypeError, KeyError) as exc:
            # TypeError/KeyError：字段类型完全不符（如对 None 取长度），
            # 同样以结构化错误返回而不是崩溃。
            response = _err(f"第 {line_no} 行：{exc}")
        stdout.write(response + "\n")
        stdout.flush()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    """命令行入口。"""

    # Windows 管道默认按系统代码页（如 GBK）编码，离线验收时会导致
    # 中文错误信息乱码；强制按 UTF-8 收发 JSON 行，保证跨平台一致。
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    return run(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
