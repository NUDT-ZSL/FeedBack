#!/usr/bin/env python3
"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

用法::

    python main.py < commands.txt
    或交互式逐行输入，每行一条 JSON，回车后立即得到一行 JSON 结果。

每条命令是一个 JSON 对象，必须含 ``op`` 字段。成功输出
``{"ok": true, ...}``；失败输出 ``{"ok": false, "error": "..."}``，
程序不会因为单条命令出错而退出。

支持的操作::

    {"op": "register_task", "task_id": "t1", "schedule": "*/5"}
    {"op": "add_node",      "node_id": "n1"}
    {"op": "heartbeat",     "node_id": "n1"}
    {"op": "tick",          "n": 1}                 # n 可省略，默认 1
    {"op": "acquire",       "node_id": "n1"}
    {"op": "complete",      "node_id": "n1", "task_id": "t1"}
    {"op": "remove_node",   "node_id": "n1"}
    {"op": "status"}                                    # 时钟 + 全量任务/节点
    {"op": "orphaned"}                                  # 已到期但未分配的任务
    {"op": "save",          "path": "snapshot.json"}
    {"op": "load",          "path": "snapshot.json"}    # 用快照替换当前状态
    {"op": "dump"}                                      # 输出原始快照结构
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict

from scheduler import Scheduler, SchedulerError

DEFAULT_LEASE_DURATION = 3


def _ok(**fields: Any) -> Dict[str, Any]:
    result: Dict[str, Any] = {"ok": True}
    result.update(fields)
    return result


def _err(message: str) -> Dict[str, Any]:
    return {"ok": False, "error": message}


def _str_arg(cmd: Dict[str, Any], name: str) -> str:
    value = cmd.get(name)
    if not isinstance(value, str) or not value:
        raise SchedulerError(f"参数 {name!r} 必须是非空字符串")
    return value


def handle(cmd: Dict[str, Any], sched: Scheduler) -> Dict[str, Any]:
    """在 ``sched`` 上执行一条已解析的命令，返回结果字典。

    ``load`` 比较特殊：成功时直接返回新的 Scheduler 实例，由调用方替换状态。
    """
    op = cmd.get("op")
    if not isinstance(op, str):
        raise SchedulerError("命令缺少字符串字段 'op'")

    if op == "register_task":
        task_id = _str_arg(cmd, "task_id")
        schedule = cmd.get("schedule")
        if not isinstance(schedule, str):
            raise SchedulerError("参数 'schedule' 必须是字符串")
        sched.register_task(task_id, schedule)
        return _ok(registered="task", task_id=task_id)

    if op == "add_node":
        node_id = _str_arg(cmd, "node_id")
        sched.add_node(node_id)
        return _ok(registered="node", node_id=node_id)

    if op == "heartbeat":
        node_id = _str_arg(cmd, "node_id")
        renewed = sched.heartbeat(node_id)
        return _ok(node_id=node_id, renewed=renewed, clock=sched.clock)

    if op == "tick":
        n = cmd.get("n", 1)
        if not isinstance(n, int) or isinstance(n, bool) or n < 1:
            raise SchedulerError("参数 'n' 必须是正整数")
        clock = sched.tick(n)
        return _ok(clock=clock)

    if op == "acquire":
        node_id = _str_arg(cmd, "node_id")
        tasks = sched.acquire(node_id)
        return _ok(node_id=node_id, tasks=tasks, clock=sched.clock)

    if op == "complete":
        node_id = _str_arg(cmd, "node_id")
        task_id = _str_arg(cmd, "task_id")
        sched.complete(node_id, task_id)
        return _ok(completed=task_id, node_id=node_id)

    if op == "remove_node":
        node_id = _str_arg(cmd, "node_id")
        released = sched.remove_node(node_id)
        return _ok(removed=node_id, released=released)

    if op == "status":
        snap = sched.snapshot()
        return _ok(
            clock=snap["clock"],
            lease_duration=snap["lease_duration"],
            tasks=sched.list_tasks(),
            nodes=sched.list_nodes(),
        )

    if op == "orphaned":
        return _ok(tasks=sched.get_orphaned_tasks(), clock=sched.clock)

    if op == "save":
        path = _str_arg(cmd, "path")
        sched.save(path)
        return _ok(saved=path)

    if op == "load":
        path = _str_arg(cmd, "path")
        new_sched = Scheduler.load(path)
        result = _ok(
            loaded=path,
            clock=new_sched.clock,
            lease_duration=new_sched.lease_duration,
            tasks=len(new_sched.list_tasks()),
            nodes=len(new_sched.list_nodes()),
        )
        result["_scheduler"] = new_sched
        return result

    if op == "dump":
        return _ok(snapshot=sched.snapshot())

    raise SchedulerError(f"未知操作: {op!r}")


def run(input_stream, output_stream, lease_duration: int = DEFAULT_LEASE_DURATION) -> int:
    """驱动主循环：逐行解析、执行、输出。供测试直接调用。"""
    sched = Scheduler(lease_duration=lease_duration)
    for lineno, raw in enumerate(input_stream, start=1):
        line = raw.strip()
        if not line:
            # 空行不是命令，静默跳过。
            continue
        try:
            cmd = json.loads(line)
            if not isinstance(cmd, dict):
                raise SchedulerError("每行必须是一个 JSON 对象")
            result = handle(cmd, sched)
            new_sched = result.pop("_scheduler", None)
            if new_sched is not None:
                sched = new_sched
        except (SchedulerError, ValueError) as exc:
            # ValueError 覆盖 json.JSONDecodeError 等解析错误。
            result = _err(f"第 {lineno} 行: {exc}")
        output_stream.write(json.dumps(result, ensure_ascii=False) + "\n")
        output_stream.flush()
    return 0


def main() -> int:
    # Windows 控制台/管道默认可能是 cp936，统一重配为 UTF-8，
    # 保证中文错误信息在重定向到文件或管道时不产生乱码字节。
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")
    return run(sys.stdin, sys.stdout)


if __name__ == "__main__":
    raise SystemExit(main())
