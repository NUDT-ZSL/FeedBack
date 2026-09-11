"""命令行入口：从标准输入逐行读 JSON 命令，逐行输出 JSON 结果。

用法::

    python main.py [--block-size N] [--max-entries N]

每行一条命令，支持的 cmd：

* ``{"cmd": "insert", "key": ..., "tag": ..., "seq": ...}`` → ``{"ok": true}``
* ``{"cmd": "range", "start": ..., "end": ...}`` → ``{"entries": [...]}``（[start, end)）
* ``{"cmd": "prefix", "prefix": ...}`` → ``{"entries": [...]}``
* ``{"cmd": "top", "k": ...}`` → ``{"entries": [...]}``
* ``{"cmd": "delete", "key": ..., "tag": ...}`` → ``{"deleted": n}``
* ``{"cmd": "merge", "paths": [p1, ...]}`` → ``{"entries": [...]}``
  （把当前内核与若干快照文件加载出的内核做有序归并，不修改任何内核；
  paths 可省略，等价于 dump）
* ``{"cmd": "stats"}`` → 统计信息
* ``{"cmd": "save", "path": ...}`` → ``{"ok": true}``
* ``{"cmd": "load", "path": ...}`` → ``{"ok": true}``（替换当前内核状态）
* ``{"cmd": "dump"}`` → ``{"entries": [...]}``（全量有序输出）

任何错误都以 ``{"error": "..."}`` 单行 JSON 返回，进程继续读下一条命令。
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Dict, List

from sortmerge import (
    Entry,
    KernelError,
    SortMergeKernel,
    merge_shards,
)


def _entries_result(entries) -> Dict[str, Any]:
    return {"entries": [e.to_dict() for e in entries]}


def _dispatch(kernel: SortMergeKernel, cmd: Dict[str, Any]):
    """执行一条命令，返回 (可能更新后的 kernel, 结果字典)。"""
    op = cmd.get("cmd")
    if not isinstance(op, str):
        raise KernelError("命令缺少 cmd 字段")

    if op == "insert":
        entry = Entry.from_dict(cmd)
        kernel.insert(entry)
        return kernel, {"ok": True}

    if op == "range":
        _require(cmd, "start", "end")
        return kernel, _entries_result(kernel.range_scan(cmd["start"], cmd["end"]))

    if op == "prefix":
        _require(cmd, "prefix")
        return kernel, _entries_result(kernel.prefix_scan(cmd["prefix"]))

    if op == "top":
        _require(cmd, "k")
        return kernel, _entries_result(kernel.top(cmd["k"]))

    if op == "delete":
        _require(cmd, "key", "tag")
        return kernel, {"deleted": kernel.delete(cmd["key"], cmd["tag"])}

    if op == "merge":
        paths = cmd.get("paths", [])
        if not isinstance(paths, list):
            raise KernelError("merge 的 paths 必须是数组")
        kernels: List[SortMergeKernel] = [kernel]
        kernels.extend(SortMergeKernel.load(p) for p in paths)
        return kernel, _entries_result(merge_shards(kernels))

    if op == "stats":
        return kernel, kernel.stats()

    if op == "save":
        _require(cmd, "path")
        kernel.save(cmd["path"])
        return kernel, {"ok": True}

    if op == "load":
        _require(cmd, "path")
        return SortMergeKernel.load(cmd["path"]), {"ok": True}

    if op == "dump":
        return kernel, _entries_result(kernel.dump())

    raise KernelError("未知命令: %r" % (op,))


def _require(cmd: Dict[str, Any], *fields: str) -> None:
    missing = [f for f in fields if f not in cmd]
    if missing:
        raise KernelError("命令 %r 缺少字段: %s" % (cmd.get("cmd"), missing))


def run(kernel: SortMergeKernel, stdin, stdout) -> None:
    """逐行读命令、逐行写结果的主循环。"""
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError as exc:
            result: Dict[str, Any] = {"error": "非法 JSON: %s" % exc}
        else:
            if not isinstance(cmd, dict):
                result = {"error": "命令必须是 JSON 对象"}
            else:
                try:
                    kernel, result = _dispatch(kernel, cmd)
                except (KernelError, ValueError, TypeError, KeyError) as exc:
                    result = {"error": str(exc)}
        stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        stdout.flush()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="增量式字符串排序与归并内核 CLI")
    parser.add_argument("--block-size", type=int, default=1024, help="有序块大小")
    parser.add_argument(
        "--max-entries",
        type=int,
        default=None,
        help="总条目数上限，缺省为无上限（精确模式）",
    )
    args = parser.parse_args(argv)
    kernel = SortMergeKernel(block_size=args.block_size, max_entries=args.max_entries)
    # utf-8-sig：容忍 Windows 管道写入的 BOM；stdout 同样按 UTF-8 输出。
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8-sig")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    run(kernel, sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
