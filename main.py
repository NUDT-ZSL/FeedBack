"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

用法::

    python main.py [--max-entries N]

每行一条命令（JSON 对象，``op`` 字段指定操作）：

- ``{"op": "insert", "key": ..., "value": ..., "owner": ...}``
- ``{"op": "remove", "key": ..., "owner": ...}``
- ``{"op": "prefix", "prefix": ...}``   —— 前缀扫描（空串返回全部）
- ``{"op": "common", "prefix": ...}``   —— 最长公共前缀统计
- ``{"op": "stats"}``                   —— 整体统计
- ``{"op": "save", "path": ...}``
- ``{"op": "load", "path": ...}``       —— 用快照替换当前索引
- ``{"op": "dump"}``                    —— 导出整棵树结构

每条命令输出一行 JSON：成功为 ``{"ok": true, "result": ...}``，
失败为 ``{"ok": false, "error": ..., "error_type": ...}``。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

from radix_index import RadixIndex, RadixIndexError

#: 各命令必需的字段（op 除外）
_REQUIRED_FIELDS: Dict[str, List[str]] = {
    "insert": ["key", "value", "owner"],
    "remove": ["key", "owner"],
    "prefix": ["prefix"],
    "common": ["prefix"],
    "stats": [],
    "save": ["path"],
    "load": ["path"],
    "dump": [],
}


class _Context:
    """持有当前索引，load 命令会整体替换它。"""

    def __init__(self, max_entries: Any) -> None:
        self.index = RadixIndex(max_entries=max_entries)


def handle(ctx: _Context, cmd: Any) -> Dict[str, Any]:
    """执行一条命令并返回结果字典（不包含 ok 字段）。

    :raises RadixIndexError: 业务错误（校验、容量、快照等）。
    """
    if not isinstance(cmd, dict):
        raise RadixIndexError(f"命令必须是 JSON 对象: {cmd!r}")
    op = cmd.get("op")
    if not isinstance(op, str) or op not in _REQUIRED_FIELDS:
        raise RadixIndexError(
            f"未知操作 op={op!r}，支持: {sorted(_REQUIRED_FIELDS)}"
        )
    for field_name in _REQUIRED_FIELDS[op]:
        if field_name not in cmd:
            raise RadixIndexError(f"命令 {op!r} 缺少字段 {field_name!r}")

    if op == "insert":
        return ctx.index.insert(cmd["key"], cmd["value"], cmd["owner"]).to_dict()
    if op == "remove":
        return ctx.index.remove(cmd["key"], cmd["owner"]).to_dict()
    if op == "prefix":
        entries = ctx.index.prefix_scan(cmd["prefix"])
        return {
            "prefix": cmd["prefix"],
            "count": len(entries),
            "entries": [e.to_dict() for e in entries],
        }
    if op == "common":
        return ctx.index.common_prefix_stats(cmd["prefix"])
    if op == "stats":
        return ctx.index.stats()
    if op == "save":
        ctx.index.save(cmd["path"])
        return {"path": cmd["path"], "entries": len(ctx.index)}
    if op == "load":
        ctx.index = RadixIndex.load(cmd["path"])
        return {"path": cmd["path"], "entries": len(ctx.index)}
    # op == "dump"
    return ctx.index.dump()


def main(argv: Any = None) -> int:
    """命令行主循环：逐行读命令，逐行写结果。"""
    parser = argparse.ArgumentParser(
        description="基数树前缀索引内核：从标准输入逐行读取 JSON 命令"
    )
    parser.add_argument(
        "--max-entries",
        type=int,
        default=None,
        help="条目总数上限（默认无上限，即精确模式；0 表示拒绝一切新注册）",
    )
    args = parser.parse_args(argv)

    try:
        ctx = _Context(args.max_entries)
    except ValueError as exc:
        print(
            json.dumps({"ok": False, "error": str(exc), "error_type": "ValueError"},
                       ensure_ascii=False),
            file=sys.stderr,
        )
        return 2

    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            result = {
                "ok": False,
                "error": f"无法解析 JSON 命令: {exc}",
                "error_type": "JSONDecodeError",
            }
        else:
            try:
                result = {"ok": True, "result": handle(ctx, cmd)}
            except RadixIndexError as exc:
                result = {
                    "ok": False,
                    "error": str(exc),
                    "error_type": type(exc).__name__,
                }
            except Exception as exc:  # 防御：任何意外错误都以 JSON 形式返回
                result = {
                    "ok": False,
                    "error": f"内部错误: {exc}",
                    "error_type": type(exc).__name__,
                }
        out.write(json.dumps(result, ensure_ascii=False) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
