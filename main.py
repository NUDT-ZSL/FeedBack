#!/usr/bin/env python3
"""增量式依赖图引擎的命令行入口。

从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果。
成功结果形如 ``{"ok": true, ...}``；失败结果形如
``{"ok": false, "error": "错误信息", "type": "异常类型"}``，
涉及环检测时还会带上 ``cycle`` 字段。

支持的命令（每行一个 JSON 对象，``op`` 字段指定操作）：

====================  =====================================================
op                    其余字段
====================  =====================================================
add                   id, fingerprint, deps(可选，字符串数组)
remove                id
update                id, fingerprint
clean                 id
plan                  （无）
affected              id
explain               id
nodes                 （无，列出全部节点 id）
status                id
save                  path
load                  path
dump                  （无，输出完整快照内容）
====================  =====================================================

示例::

    echo '{"op":"add","id":"a","fingerprint":"h1"}
    {"op":"add","id":"b","fingerprint":"h2","deps":["a"]}
    {"op":"update","id":"a","fingerprint":"h1x"}
    {"op":"plan"}' | python main.py

输出::

    {"ok": true}
    {"ok": true}
    {"ok": true, "changed": true}
    {"ok": true, "plan": ["a"]}

空行会被跳过；单行 JSON 解析失败不会中断后续命令。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, List, Optional

from depgraph.engine import (
    CycleError,
    DependencyGraph,
    DepGraphError,
)


# ---------------------------------------------------------------------- #
# 命令处理
# ---------------------------------------------------------------------- #


class CommandError(Exception):
    """命令格式/参数错误（区别于引擎本身的领域错误）。"""


def _require_str(cmd: Dict[str, Any], field: str) -> str:
    """从命令对象取一个必须存在且为字符串的字段。"""
    if field not in cmd:
        raise CommandError(f"命令缺少字段: {field}")
    value = cmd[field]
    if not isinstance(value, str):
        raise CommandError(f"字段 {field} 必须是字符串")
    return value


def _optional_deps(cmd: Dict[str, Any]) -> Optional[List[str]]:
    if "deps" not in cmd:
        return None
    deps = cmd["deps"]
    if not isinstance(deps, list) or not all(isinstance(d, str) for d in deps):
        raise CommandError("字段 deps 必须是字符串数组")
    return deps


def handle_add(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    fingerprint = _require_str(cmd, "fingerprint")
    deps = _optional_deps(cmd)
    g.add_node(node_id, fingerprint, deps)
    return {"ok": True}


def handle_remove(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    g.remove_node(node_id)
    return {"ok": True}


def handle_update(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    fingerprint = _require_str(cmd, "fingerprint")
    changed = g.update_fingerprint(node_id, fingerprint)
    return {"ok": True, "changed": changed}


def handle_clean(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    g.mark_clean(node_id)
    return {"ok": True}


def handle_plan(g: DependencyGraph, _cmd: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "plan": g.get_plan()}


def handle_affected(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    return {"ok": True, "affected": g.get_affected(node_id)}


def handle_explain(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    return {"ok": True, "paths": g.explain_dirty(node_id)}


def handle_nodes(g: DependencyGraph, _cmd: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "nodes": g.list_nodes()}


def handle_status(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    node_id = _require_str(cmd, "id")
    return {"ok": True, "node": g.get_status(node_id)}


def handle_save(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_str(cmd, "path")
    g.save(path)
    return {"ok": True, "path": path}


def handle_load(g: DependencyGraph, cmd: Dict[str, Any]) -> Dict[str, Any]:
    path = _require_str(cmd, "path")
    loaded = DependencyGraph.load(path)
    # 原地替换内部状态，保持对同一个 graph 对象的引用不变。
    g.__dict__.clear()
    g.__dict__.update(loaded.__dict__)
    return {"ok": True, "path": path, "nodes": len(g)}


def handle_dump(g: DependencyGraph, _cmd: Dict[str, Any]) -> Dict[str, Any]:
    return {"ok": True, "snapshot": g.to_dict()}


Handler = Callable[[DependencyGraph, Dict[str, Any]], Dict[str, Any]]

HANDLERS: Dict[str, Handler] = {
    "add": handle_add,
    "remove": handle_remove,
    "update": handle_update,
    "clean": handle_clean,
    "plan": handle_plan,
    "affected": handle_affected,
    "explain": handle_explain,
    "nodes": handle_nodes,
    "status": handle_status,
    "save": handle_save,
    "load": handle_load,
    "dump": handle_dump,
}


def dispatch(graph: DependencyGraph, line: str) -> Dict[str, Any]:
    """解析并执行一行命令，始终返回一个可 JSON 序列化的结果字典。"""
    try:
        cmd = json.loads(line)
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"不是合法 JSON: {exc.msg}", "type": "JSONDecodeError"}

    if not isinstance(cmd, dict):
        return {"ok": False, "error": "命令必须是 JSON 对象", "type": "CommandError"}

    op = cmd.get("op")
    if not isinstance(op, str):
        return {"ok": False, "error": "命令缺少字符串字段 op", "type": "CommandError"}

    handler = HANDLERS.get(op)
    if handler is None:
        return {
            "ok": False,
            "error": f"未知操作: {op!r}，支持: {', '.join(sorted(HANDLERS))}",
            "type": "CommandError",
        }

    try:
        return handler(graph, cmd)
    except CycleError as exc:
        result: Dict[str, Any] = {
            "ok": False,
            "error": str(exc),
            "type": "CycleError",
            "cycle": list(exc.cycle),
        }
        return result
    except DepGraphError as exc:
        return {"ok": False, "error": str(exc), "type": type(exc).__name__}
    except CommandError as exc:
        return {"ok": False, "error": str(exc), "type": "CommandError"}
    except OSError as exc:
        return {"ok": False, "error": f"文件操作失败: {exc}", "type": type(exc).__name__}


def run(lines: List[str]) -> List[str]:
    """按顺序执行命令行列表，返回 JSON 结果行列表（便于测试）。"""
    graph = DependencyGraph()
    output: List[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        result = dispatch(graph, stripped)
        output.append(json.dumps(result, ensure_ascii=False))
    return output


def main(argv: Optional[List[str]] = None) -> int:
    """CLI 主入口：逐行读标准输入，逐行向标准输出写结果。

    :return: 进程退出码（单条命令失败不致命，始终返回 0）。
    """
    # Windows 控制台默认可能是 cp936，统一强制 UTF-8，保证管道下游按
    # JSON 约定的 UTF-8 编解码不会乱码。
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    graph = DependencyGraph()
    for line in sys.stdin:
        stripped = line.strip()
        if not stripped:
            continue
        result = dispatch(graph, stripped)
        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
