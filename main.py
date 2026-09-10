#!/usr/bin/env python3
"""列式时序存储引擎的命令行入口。

从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果。
错误同样是一行 JSON，包含 ``"error"`` 字段，不会中断后续命令处理。

支持的命令（``op`` 字段区分）::

    {"op": "append", "points": [Point, ...]}
    {"op": "query", "metric": str, "tags_filter": {...}, "start": int,
     "end": int, "fields": [str, ...] | null, "agg": str, "step": int | null}
    {"op": "delete_series", "metric": str, "tags": {...}}
    {"op": "delete_range", "metric": str, "tags": {...}, "start": int, "end": int}
    {"op": "compact"}
    {"op": "save", "dir": str}
    {"op": "load", "dir": str}
    {"op": "stats"}
    {"op": "dump"}

Point 的 JSON 形式::

    {"metric": "cpu", "tags": {"host": "a"}, "ts": 1, "fields": {"v": 0.5}}

示例::

    echo '{"op":"append","points":[{"metric":"cpu","tags":{"host":"a"},
    "ts":1,"fields":{"v":1.0}}]}' | python main.py
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from tsdb import ColumnarTSDB, TSDBError


def _ok(op: str, **extra: Any) -> Dict[str, Any]:
    result = {"ok": True, "op": op}
    result.update(extra)
    return result


def _err(op: str, message: str) -> Dict[str, Any]:
    return {"ok": False, "op": op, "error": message}


def handle_command(db: ColumnarTSDB, command: Dict[str, Any]) -> Dict[str, Any]:
    """在 ``db`` 上执行一条已解析的命令，返回可 JSON 序列化的结果 dict。"""
    op = command.get("op")
    if not isinstance(op, str):
        return _err(str(op), "命令必须包含字符串字段 'op'")

    if op == "append":
        points = command.get("points")
        if not isinstance(points, list):
            return _err(op, "'points' 必须是点对象的列表")
        written = db.append(points)
        return _ok(op, written=written)

    if op == "query":
        required = ("metric", "tags_filter", "start", "end")
        missing = [k for k in required if k not in command]
        if missing:
            return _err(op, f"query 缺少参数: {missing}")
        results = db.query(
            metric=command["metric"],
            tags_filter=command["tags_filter"],
            start=command["start"],
            end=command["end"],
            fields=command.get("fields"),
            agg=command.get("agg", "none"),
            step=command.get("step"),
        )
        return _ok(op, results=[r.to_dict() for r in results])

    if op == "delete_series":
        if "metric" not in command or "tags" not in command:
            return _err(op, "delete_series 需要 'metric' 和 'tags'")
        deleted = db.delete_series(command["metric"], command["tags"])
        return _ok(op, deleted=deleted)

    if op == "delete_range":
        required = ("metric", "tags", "start", "end")
        missing = [k for k in required if k not in command]
        if missing:
            return _err(op, f"delete_range 缺少参数: {missing}")
        deleted = db.delete_range(
            command["metric"], command["tags"], command["start"], command["end"]
        )
        return _ok(op, deleted=deleted)

    if op == "compact":
        info = db.compact()
        return _ok(op, **info, stats=db.stats())

    if op == "save":
        if not isinstance(command.get("dir"), str) or not command["dir"]:
            return _err(op, "save 需要非空字符串 'dir'")
        db.save(command["dir"])
        return _ok(op, dir=command["dir"])

    if op == "load":
        if not isinstance(command.get("dir"), str) or not command["dir"]:
            return _err(op, "load 需要非空字符串 'dir'")
        db.load(command["dir"])
        return _ok(op, dir=command["dir"], stats=db.stats())

    if op == "stats":
        return _ok(op, stats=db.stats())

    if op == "dump":
        return _ok(op, layout=db.dump())

    return _err(op, f"未知命令: {op!r}，支持 append/query/delete_series/"
                    "delete_range/compact/save/load/stats/dump")


def main(argv: list[str] | None = None) -> int:
    """逐行处理 stdin。返回值固定为 0（错误体现在每行结果里）。"""
    # 统一用 UTF-8 输出，避免 Windows 控制台默认代码页（如 GBK）遇到
    # 用户数据里的非常规字符时 UnicodeEncodeError。
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    db = ColumnarTSDB()
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            response = _err("<unparsed>", f"输入不是合法 JSON: {exc}")
        else:
            if not isinstance(command, dict):
                response = _err("<unparsed>", "每行必须是一个 JSON 对象")
            else:
                op = command.get("op", "<unknown>")
                try:
                    response = handle_command(db, command)
                except TSDBError as exc:
                    response = _err(str(op), str(exc))
                except (TypeError, KeyError) as exc:
                    response = _err(str(op), f"参数错误: {exc}")
        out.write(json.dumps(response, ensure_ascii=False, allow_nan=False) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
