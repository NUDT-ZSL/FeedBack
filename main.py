"""main.py — 调度内核的逐行 JSON 命令行入口。

用法
====
::

    python main.py < commands.txt
    # 或交互式逐行输入，每行一条 JSON 命令，回车后得到一行 JSON 结果

每条命令是一个 JSON 对象，必须带 ``cmd`` 字段；每条命令的输出也是一行
JSON。成功形如 ``{"ok": true, ...}``，失败形如 ``{"ok": false,
"error": "错误原因"}``。空行直接跳过；单行 JSON 解析失败会返回错误行，
不会中断后续命令。

支持的命令
----------
register      {"cmd":"register","task":{task_id,owner,deadline,priority,payload?}}
              task 的五个字段也允许直接平铺在命令对象上
cancel        {"cmd":"cancel","task_id":"..."}
cancel_owner  {"cmd":"cancel_owner","owner":"..."}
advance       {"cmd":"advance","time": 123}
poll          {"cmd":"poll"}
peek          {"cmd":"peek"}
stats         {"cmd":"stats"}
save          {"cmd":"save","path":"state.json"}
load          {"cmd":"load","path":"state.json"}   # 用文件中的内核替换当前内核
dump          {"cmd":"dump"}                       # 输出完整快照 JSON
init          {"cmd":"init","max_tasks": 100}      # 可选，只能在第一条命令使用，
                                                  # null/缺省表示无上限
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional, Tuple

from scheduler import DeadlineScheduler, SchedulerError, Task, task_from_dict


def _task_result(task: Task) -> Dict[str, Any]:
    return {
        "task_id": task.task_id,
        "owner": task.owner,
        "deadline": task.deadline,
        "priority": task.priority,
        "payload": task.payload,
    }


def handle_command(
    kernel: DeadlineScheduler, obj: Dict[str, Any]
) -> Tuple[DeadlineScheduler, Dict[str, Any]]:
    """执行一条已解析的命令，返回（可能被 load 替换的）内核与结果 dict。

    结果 dict 成功时含 ``ok: true``，失败时含 ``ok: false`` 和 ``error``。
    """
    cmd = obj.get("cmd")
    if not isinstance(cmd, str):
        return kernel, {"ok": False, "error": "missing or invalid 'cmd' field"}

    try:
        if cmd == "register":
            if "task" in obj:
                source = obj["task"]
            else:
                # 扁平形式：命令对象本身就是任务字段，去掉 cmd。
                source = {k: v for k, v in obj.items() if k != "cmd"}
            task = task_from_dict(source)
            kernel.register(task)
            return kernel, {"ok": True, "result": "registered",
                            "task": _task_result(task)}

        if cmd == "cancel":
            if "task_id" not in obj:
                raise SchedulerError("cancel requires 'task_id'")
            kernel.cancel(obj["task_id"])
            return kernel, {"ok": True, "result": "cancelled",
                            "task_id": obj["task_id"]}

        if cmd == "cancel_owner":
            if "owner" not in obj:
                raise SchedulerError("cancel_owner requires 'owner'")
            count = kernel.cancel_by_owner(obj["owner"])
            return kernel, {"ok": True, "result": "cancelled",
                            "owner": obj["owner"], "count": count}

        if cmd == "advance":
            if "time" not in obj:
                raise SchedulerError("advance requires 'time'")
            new_clock = kernel.advance_to(obj["time"])
            return kernel, {"ok": True, "result": "advanced",
                            "clock": new_clock}

        if cmd == "poll":
            tasks = kernel.poll_expired()
            return kernel, {"ok": True, "result": "polled",
                            "tasks": [_task_result(t) for t in tasks],
                            "count": len(tasks)}

        if cmd == "peek":
            nxt = kernel.peek_next()
            return kernel, {"ok": True, "next": nxt}

        if cmd == "stats":
            return kernel, {"ok": True, "stats": kernel.stats()}

        if cmd == "save":
            if not isinstance(obj.get("path"), str):
                raise SchedulerError("save requires string 'path'")
            kernel.save(obj["path"])
            return kernel, {"ok": True, "result": "saved",
                            "path": obj["path"]}

        if cmd == "load":
            if not isinstance(obj.get("path"), str):
                raise SchedulerError("load requires string 'path'")
            kernel = DeadlineScheduler.load(obj["path"])
            return kernel, {"ok": True, "result": "loaded",
                            "path": obj["path"], "stats": kernel.stats()}

        if cmd == "dump":
            return kernel, {"ok": True, "snapshot": kernel.to_snapshot()}

        if cmd == "init":
            raise SchedulerError(
                "'init' is only allowed as the very first command"
            )

        return kernel, {"ok": False, "error": f"unknown command {cmd!r}"}

    except SchedulerError as exc:
        return kernel, {"ok": False, "error": str(exc)}


def run(lines: List[str]) -> List[str]:
    """按行执行命令，返回对应的 JSON 输出行（主要方便测试）。"""
    output: List[str] = []
    kernel: Optional[DeadlineScheduler] = None
    for lineno, raw in enumerate(lines, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as exc:
            result: Dict[str, Any] = {
                "ok": False,
                "error": f"line {lineno}: invalid JSON: {exc.msg}",
            }
            output.append(json.dumps(result, ensure_ascii=False))
            continue
        if not isinstance(obj, dict):
            output.append(json.dumps(
                {"ok": False, "error": f"line {lineno}: command must be a "
                                       f"JSON object"},
                ensure_ascii=False,
            ))
            continue

        # 可选的第一条 init 命令：决定 max_tasks。
        if kernel is None and obj.get("cmd") == "init":
            max_tasks = obj.get("max_tasks", None)
            try:
                kernel = DeadlineScheduler(max_tasks=max_tasks)
            except SchedulerError as exc:
                output.append(json.dumps(
                    {"ok": False, "error": str(exc)}, ensure_ascii=False))
                kernel = DeadlineScheduler()
            else:
                output.append(json.dumps(
                    {"ok": True, "result": "initialized",
                     "max_tasks": max_tasks}, ensure_ascii=False))
            continue
        if kernel is None:
            kernel = DeadlineScheduler()

        kernel, result = handle_command(kernel, obj)
        output.append(json.dumps(result, ensure_ascii=False))
    return output


def main() -> int:
    """从标准输入逐行读命令，向标准输出逐行写结果。"""
    outputs = run(sys.stdin.read().splitlines())
    for line in outputs:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
