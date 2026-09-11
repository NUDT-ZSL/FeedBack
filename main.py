#!/usr/bin/env python3
"""因果依赖追踪内核的命令行入口。

从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果；
错误同样以 JSON 返回（包含 ``error`` 与 ``error_type`` 字段），进程不退出的
前提下尽可能继续处理后续命令。

支持的命令（``cmd`` 字段）：

- ``add_edge``     ``{"cmd":"add_edge","artifact":"a","input":"b","kind":"file"}``
- ``report``       ``{"cmd":"report","input":"b","fingerprint":"v1"}``
- ``set_artifact`` ``{"cmd":"set_artifact","artifact":"a","fingerprint":"h1"}``
- ``rebuilt``      ``{"cmd":"rebuilt","artifact":"a"}``
- ``plan``         ``{"cmd":"plan"}``
- ``explain``      ``{"cmd":"explain","artifact":"a"}``
- ``stats``        ``{"cmd":"stats"}``
- ``save``         ``{"cmd":"save","path":"state.json"}``
- ``load``         ``{"cmd":"load","path":"state.json"}``
- ``dump``         ``{"cmd":"dump"}``

用法::

    python main.py [--max-edges N] < commands.jsonl

``--max-edges`` 缺省时为精确模式（无边数上限）。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List, MutableMapping, Optional

from deptracker import DependencyError, DependencyTracker

#: 每条命令必需的参数（cmd 除外）。
_REQUIRED: Dict[str, List[str]] = {
    "add_edge": ["artifact", "input"],
    "report": ["input", "fingerprint"],
    "set_artifact": ["artifact", "fingerprint"],
    "rebuilt": ["artifact"],
    "plan": [],
    "explain": ["artifact"],
    "stats": [],
    "save": ["path"],
    "load": ["path"],
    "dump": [],
}


def execute(
    holder: MutableMapping[str, DependencyTracker], command: Dict[str, Any]
) -> Dict[str, Any]:
    """执行一条命令并返回结果字典（``holder`` 持有当前追踪器，load 会替换它）。"""
    cmd = command.get("cmd")
    if cmd not in _REQUIRED:
        return {"ok": False, "error": f"未知命令: {cmd!r}", "error_type": "UnknownCommand"}
    missing = [k for k in _REQUIRED[cmd] if k not in command]
    if missing:
        return {
            "ok": False,
            "error": f"命令 {cmd!r} 缺少参数: {', '.join(missing)}",
            "error_type": "MissingParameter",
        }

    tracker = holder["tracker"]
    if cmd == "add_edge":
        added = tracker.add_edge(
            command["artifact"], command["input"], command.get("kind", "file")
        )
        return {"ok": True, "added": added}
    if cmd == "report":
        invalidated = tracker.report_fingerprint(
            command["input"], command["fingerprint"]
        )
        return {"ok": True, "invalidated": invalidated}
    if cmd == "set_artifact":
        invalidated = tracker.set_artifact_fingerprint(
            command["artifact"], command["fingerprint"]
        )
        return {"ok": True, "invalidated": invalidated}
    if cmd == "rebuilt":
        tracker.mark_rebuilt(command["artifact"])
        return {"ok": True}
    if cmd == "plan":
        return {"ok": True, "plan": tracker.get_rebuild_plan()}
    if cmd == "explain":
        return {"ok": True, **tracker.explain_invalid(command["artifact"])}
    if cmd == "stats":
        return {"ok": True, **tracker.stats()}
    if cmd == "save":
        tracker.save(command["path"])
        return {"ok": True, "path": command["path"]}
    if cmd == "load":
        holder["tracker"] = DependencyTracker.load(command["path"])
        return {"ok": True, "path": command["path"]}
    # cmd == "dump"
    return {"ok": True, "state": tracker.dump()}


def run(
    lines: Any,
    out: Any,
    tracker: Optional[DependencyTracker] = None,
) -> None:
    """逐行处理 JSON 命令流，结果逐行写入 ``out``（便于测试注入）。"""
    holder: Dict[str, DependencyTracker] = {
        "tracker": tracker if tracker is not None else DependencyTracker()
    }
    for lineno, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            result = {
                "ok": False,
                "error": f"第 {lineno} 行不是合法 JSON: {exc}",
                "error_type": "BadJson",
            }
        else:
            if not isinstance(command, dict):
                result = {
                    "ok": False,
                    "error": f"第 {lineno} 行必须是 JSON 对象",
                    "error_type": "BadCommand",
                }
            else:
                try:
                    result = execute(holder, command)
                except DependencyError as exc:
                    result = {
                        "ok": False,
                        "error": str(exc),
                        "error_type": type(exc).__name__,
                    }
                except (ValueError, KeyError, TypeError) as exc:
                    result = {
                        "ok": False,
                        "error": str(exc),
                        "error_type": type(exc).__name__,
                    }
        out.write(json.dumps(result, ensure_ascii=False) + "\n")
        out.flush()


def main(argv: Optional[List[str]] = None) -> int:
    """命令行入口：解析参数并处理标准输入的命令流。"""
    parser = argparse.ArgumentParser(
        description="因果依赖追踪内核: 从标准输入逐行读取 JSON 命令"
    )
    parser.add_argument(
        "--max-edges",
        type=int,
        default=None,
        metavar="N",
        help="依赖边总数上限; 缺省为精确模式(无上限)",
    )
    args = parser.parse_args(argv)
    try:
        tracker = DependencyTracker(max_edges=args.max_edges)
    except ValueError as exc:
        print(
            json.dumps({"ok": False, "error": str(exc), "error_type": "ValueError"},
                       ensure_ascii=False),
            file=sys.stderr,
        )
        return 2
    run(sys.stdin, sys.stdout, tracker)
    return 0


if __name__ == "__main__":
    sys.exit(main())
