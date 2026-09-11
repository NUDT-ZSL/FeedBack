"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

协议
----

每条命令是一行 JSON 对象，用 ``cmd`` 字段指定操作：

================  ============================================================
cmd               参数 / 说明
================  ============================================================
add               ``id``、``fingerprint``、可选 ``deps``（字符串数组）
remove            ``id``；返回体含 ``removed`` 布尔
update            ``id``、``fingerprint``；返回体含 ``changed`` 布尔
clean             ``id``；确认节点干净
plan              无参数；返回 ``{"plan": [...]}``
affected          ``id``；返回 ``{"affected": [...]}``
explain           ``id``；返回 ``{"paths": [[{"node","status"}, ...], ...]}``
save              ``path``
load              ``path``
dump              无参数；返回完整快照（含状态）
================  ============================================================

成功输出 ``{"ok": true, ...}`` 或对应结果体；任何错误都输出
``{"error": "错误信息", "cmd": ...}``，进程继续处理后续命令。
非法 JSON 行同样返回一行错误 JSON。空行忽略。

示例::

    echo '{"cmd":"add","id":"a","fingerprint":"f1"}' | python main.py
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, Optional

from depgraph import DependencyGraph, GraphError


def process_command(graph: DependencyGraph, command: Dict[str, Any]) -> Dict[str, Any]:
    """对内存中的图执行一条已解析的命令，返回可 JSON 序列化的结果字典。

    引擎抛出的任何 :class:`GraphError` 被转成 ``{"error": ...}``；
    未知命令、参数缺失同样如此。本函数不抛业务异常，便于逐行协议复用。
    """
    cmd = command.get("cmd") or command.get("command")
    try:
        if cmd == "add":
            deps = command.get("deps", [])
            graph.add_node(
                _require_str(command, "id"),
                _require_str(command, "fingerprint"),
                deps if deps is not None else [],
            )
            return {"ok": True, "cmd": cmd, "id": command["id"]}

        if cmd == "remove":
            removed = graph.remove_node(_require_str(command, "id"))
            return {"ok": True, "cmd": cmd, "id": command["id"], "removed": removed}

        if cmd == "update":
            changed = graph.update_fingerprint(
                _require_str(command, "id"),
                _require_str(command, "fingerprint"),
            )
            return {"ok": True, "cmd": cmd, "id": command["id"], "changed": changed}

        if cmd == "clean":
            graph.mark_clean(_require_str(command, "id"))
            return {"ok": True, "cmd": cmd, "id": command["id"]}

        if cmd == "plan":
            return {"ok": True, "cmd": cmd, "plan": graph.get_plan()}

        if cmd == "affected":
            node_id = _require_str(command, "id")
            return {"ok": True, "cmd": cmd, "id": node_id, "affected": graph.get_affected(node_id)}

        if cmd == "explain":
            node_id = _require_str(command, "id")
            return {"ok": True, "cmd": cmd, "id": node_id, "paths": graph.explain_dirty(node_id)}

        if cmd == "status":
            return {"ok": True, "cmd": cmd, "status": graph.get_status()}

        if cmd == "save":
            path = _require_str(command, "path")
            graph.save(path)
            return {"ok": True, "cmd": cmd, "path": path}

        if cmd == "load":
            path = _require_str(command, "path")
            loaded = DependencyGraph.load(path)
            # 把加载结果灌回调用方持有的同一对象，保证后续命令作用于新图。
            graph.__dict__.update(loaded.__dict__)
            return {"ok": True, "cmd": cmd, "path": path, "nodes": len(graph)}

        if cmd == "dump":
            return {"ok": True, "cmd": cmd, "graph": graph.to_dict()}

        if cmd is None:
            raise GraphError("缺少 cmd 字段，支持的命令: add/remove/update/clean/"
                             "plan/affected/explain/status/save/load/dump")
        raise GraphError(f"未知命令: {cmd!r}")
    except GraphError as exc:
        result: Dict[str, Any] = {"error": str(exc), "type": type(exc).__name__}
        if cmd is not None:
            result["cmd"] = cmd
        if "id" in command and isinstance(command.get("id"), str):
            result["id"] = command["id"]
        return result


def _require_str(command: Dict[str, Any], field: str) -> str:
    """取字符串参数；缺失或类型不对时抛 GraphError，由统一错误通道返回。"""
    value = command.get(field)
    if not isinstance(value, str):
        raise GraphError(f"参数 {field!r} 必须是字符串")
    return value


def handle_line(graph: DependencyGraph, line: str) -> Optional[str]:
    """处理一行原始输入，返回一行 JSON 结果；空行返回 None（跳过）。"""
    if not line.strip():
        return None
    try:
        command = json.loads(line)
    except json.JSONDecodeError as exc:
        return json.dumps(
            {"error": f"输入不是合法 JSON（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"},
            ensure_ascii=False,
        )
    if not isinstance(command, dict):
        return json.dumps({"error": "每行命令必须是 JSON 对象"}, ensure_ascii=False)
    return json.dumps(process_command(graph, command), ensure_ascii=False)


def main(argv: Optional[list] = None) -> int:
    """标准输入逐行命令循环。

    :return: 进程退出码，恒为 0（业务错误走 JSON 通道；IO 致命错误为 1）。
    """
    graph = DependencyGraph()
    # Windows GBK 控制台输出中文 JSON 时避免 UnicodeEncodeError。
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    except (AttributeError, ValueError):
        pass
    stdout = sys.stdout
    try:
        for line in sys.stdin:
            result_line = handle_line(graph, line)
            if result_line is not None:
                stdout.write(result_line + "\n")
                stdout.flush()
    except BrokenPipeError:  # 下游（如 head）关闭管道时安静退出
        return 0
    except OSError as exc:  # 快照读写之外的致命 IO 错误
        stdout.write(json.dumps({"error": f"IO 错误: {exc}"}, ensure_ascii=False) + "\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
