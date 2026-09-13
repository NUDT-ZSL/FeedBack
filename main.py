"""MVCC 数据库命令行入口。

从标准输入逐行读取 JSON 命令，每条命令输出一行 JSON 结果。
错误同样以 JSON 返回（包含 "error" 字段），不会中断后续命令。

支持的命令（每行一个 JSON 对象，"cmd" 字段指定命令名）：

    {"cmd": "begin",  "txn_id": "t1"}
    {"cmd": "get",    "txn_id": "t1", "key": "a"}
    {"cmd": "put",    "txn_id": "t1", "key": "a", "value": "1"}
    {"cmd": "delete", "txn_id": "t1", "key": "a"}
    {"cmd": "commit", "txn_id": "t1"}
    {"cmd": "abort",  "txn_id": "t1"}
    {"cmd": "gc"}
    {"cmd": "state",  "txn_id": "t1"}
    {"cmd": "save",   "path": "db.json"}
    {"cmd": "load",   "path": "db.json"}
    {"cmd": "dump"}

示例：
    $ python main.py
    {"cmd": "begin", "txn_id": "t1"}
    {"ok": true, "txn_id": "t1", "snapshot_ts": 0}
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable

from mvcc import MVCCDatabase, MVCCError


def _require(cmd: dict[str, Any], *fields: str) -> None:
    """校验命令包含必需字段，缺失则抛 MVCCError。"""
    for f in fields:
        if f not in cmd:
            raise MVCCError(f"missing field {f!r} for cmd {cmd.get('cmd')!r}")


def _handle(db_holder: dict[str, MVCCDatabase], cmd: dict[str, Any]) -> dict[str, Any]:
    """执行一条命令并返回结果对象。db_holder 用字典包一层以便 load 替换实例。"""
    name = cmd.get("cmd")
    if not isinstance(name, str):
        raise MVCCError("command must have a string 'cmd' field")
    db = db_holder["db"]

    if name == "begin":
        _require(cmd, "txn_id")
        txn = db.begin(cmd["txn_id"])
        return {"ok": True, "txn_id": txn.txn_id, "snapshot_ts": txn.snapshot_ts}

    if name == "get":
        _require(cmd, "txn_id", "key")
        return {"ok": True, "value": db.get(cmd["txn_id"], cmd["key"])}

    if name == "put":
        _require(cmd, "txn_id", "key", "value")
        db.put(cmd["txn_id"], cmd["key"], cmd["value"])
        return {"ok": True}

    if name == "delete":
        _require(cmd, "txn_id", "key")
        db.delete(cmd["txn_id"], cmd["key"])
        return {"ok": True}

    if name == "commit":
        _require(cmd, "txn_id")
        result = db.commit(cmd["txn_id"])
        if result.committed:
            return {"ok": True, "status": "committed", "commit_ts": result.commit_ts}
        return {"ok": True, "status": "aborted", "conflicts": result.conflicts}

    if name == "abort":
        _require(cmd, "txn_id")
        db.abort(cmd["txn_id"])
        return {"ok": True}

    if name == "gc":
        return {"ok": True, "collected": db.gc()}

    if name == "state":
        _require(cmd, "txn_id")
        return {"ok": True, "txn": db.state(cmd["txn_id"])}

    if name == "save":
        _require(cmd, "path")
        db.save(cmd["path"])
        return {"ok": True}

    if name == "load":
        _require(cmd, "path")
        db_holder["db"] = MVCCDatabase.load(cmd["path"])
        return {"ok": True}

    if name == "dump":
        return {"ok": True, "state": db.dump()}

    raise MVCCError(f"unknown cmd: {name!r}")


def run(in_stream: Any = sys.stdin, out_stream: Any = sys.stdout) -> None:
    """主循环：逐行读命令、执行、输出一行 JSON 结果。"""
    db_holder: dict[str, MVCCDatabase] = {"db": MVCCDatabase()}
    for lineno, line in enumerate(in_stream, start=1):
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if not isinstance(cmd, dict):
                raise MVCCError("command must be a JSON object")
            result = _handle(db_holder, cmd)
        except MVCCError as e:
            result = {"ok": False, "error": str(e)}
        except (TypeError, ValueError) as e:
            # JSON 解析失败或字段类型不对
            result = {"ok": False, "error": f"bad command on line {lineno}: {e}"}
        out_stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        out_stream.flush()


def main() -> None:
    """命令行入口。"""
    run()


if __name__ == "__main__":
    main()
