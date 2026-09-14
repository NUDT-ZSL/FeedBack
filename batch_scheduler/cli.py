"""命令行入口：从标准输入逐行读取 JSON 命令，逐行输出一行 JSON 结果。

支持的命令（每行一个 JSON 对象，均含 "cmd" 字段）：

* ``register_resource``  注册资源：resource_id, capacity
* ``submit_task``        提交任务：task_id, resource_id, amount, deadline,
  可选 priority（默认 0）、committed（默认 false）
* ``preempt``            抢占任务：task_id，可选 reason
* ``query_occupancy``    查询占用：resource_id, start, end
* ``query_task``         查询任务：task_id
* ``query_records``      查询拒绝/抢占记录
* ``advance_clock``      推进时钟：time
* ``export``             导出状态：path
* ``import``             导入状态：path（失败时原状态保持不变）
* ``dump_state``         查看内部状态

每条命令输出一行 JSON：成功为 ``{"ok": true, ...}``，失败为
``{"ok": false, "error": <代码>, "message": <说明>}``。准入被拒绝
不是错误，而是 ``{"ok": true, "admitted": false, "reason": ...}``。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Callable, Dict, Optional, TextIO

from .core import Scheduler, SchedulerError
from . import persistence


class Session:
    """一次 CLI 会话：持有当前调度器实例（import 成功时整体替换）。"""

    def __init__(self) -> None:
        self.scheduler = Scheduler()


def _required(command: Dict[str, Any], name: str) -> Any:
    """取必填字段，缺失时抛操作级错误。"""
    if name not in command:
        raise SchedulerError("missing_field", f"命令缺少字段: {name}")
    return command[name]


def _frac_field(command: Dict[str, Any], name: str) -> Any:
    """取必填数值字段并转换为 Fraction。"""
    return persistence.frac_from_json(_required(command, name), name)


def _task_info(result_task: Any) -> Optional[Dict[str, Any]]:
    """从 Task 构造输出用字典。"""
    if result_task is None:
        return None
    return {
        "task_id": result_task.task_id,
        "resource_id": result_task.resource_id,
        "status": result_task.status,
        "start": result_task.start,
        "end": result_task.end,
    }


def _cmd_register_resource(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    resource = session.scheduler.register_resource(
        _required(command, "resource_id"), _frac_field(command, "capacity")
    )
    return {"resource_id": resource.resource_id, "capacity": resource.capacity}


def _cmd_submit_task(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    result = session.scheduler.submit_task(
        task_id=_required(command, "task_id"),
        resource_id=_required(command, "resource_id"),
        amount=_frac_field(command, "amount"),
        deadline=_frac_field(command, "deadline"),
        priority=command.get("priority", 0),
        committed=command.get("committed", False),
    )
    response: Dict[str, Any] = {"admitted": result.admitted, "reason": result.reason}
    if result.admitted:
        response["task"] = _task_info(result.task)
        response["preempted"] = list(result.preempted)
    return response


def _cmd_preempt(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    record = session.scheduler.preempt_task(
        _required(command, "task_id"), reason=command.get("reason", "manual")
    )
    return {"preempted": record["task_id"], "record": record}


def _cmd_query_occupancy(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    return session.scheduler.query_occupancy(
        _required(command, "resource_id"),
        _frac_field(command, "start"),
        _frac_field(command, "end"),
    )


def _cmd_query_task(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    return {"task": session.scheduler.query_task(_required(command, "task_id"))}


def _cmd_query_records(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    return session.scheduler.query_records()


def _cmd_advance_clock(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    resumed = session.scheduler.advance_clock(_frac_field(command, "time"))
    return {"clock": session.scheduler.clock, "resumed": resumed}


def _cmd_export(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    path = _required(command, "path")
    if not isinstance(path, str) or not path:
        raise SchedulerError("invalid_path", f"导出路径非法: {path!r}")
    persistence.export_state(session.scheduler, path)
    return {"path": path}


def _cmd_import(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    path = _required(command, "path")
    if not isinstance(path, str) or not path:
        raise SchedulerError("invalid_path", f"导入路径非法: {path!r}")
    # 先完整构建并校验，成功后才替换，失败时原状态保持不变。
    session.scheduler = persistence.import_state(path)
    return {"path": path, "clock": session.scheduler.clock}


def _cmd_dump_state(session: Session, command: Dict[str, Any]) -> Dict[str, Any]:
    return {"state": persistence.state_to_dict(session.scheduler)}


_HANDLERS: Dict[str, Callable[[Session, Dict[str, Any]], Dict[str, Any]]] = {
    "register_resource": _cmd_register_resource,
    "submit_task": _cmd_submit_task,
    "preempt": _cmd_preempt,
    "query_occupancy": _cmd_query_occupancy,
    "query_task": _cmd_query_task,
    "query_records": _cmd_query_records,
    "advance_clock": _cmd_advance_clock,
    "export": _cmd_export,
    "import": _cmd_import,
    "dump_state": _cmd_dump_state,
}


def handle_command(session: Session, command: Any) -> Dict[str, Any]:
    """执行一条命令并返回结果字典（不含 "ok" 字段）。"""
    if not isinstance(command, dict):
        raise SchedulerError("invalid_command", "命令必须是 JSON 对象")
    cmd = command.get("cmd")
    if not isinstance(cmd, str) or cmd not in _HANDLERS:
        raise SchedulerError("unknown_command", f"未知命令: {cmd!r}")
    return _HANDLERS[cmd](session, command)


def main(stdin: Optional[TextIO] = None, stdout: Optional[TextIO] = None) -> None:
    """主循环：逐行读取命令，逐行写出 JSON 结果。"""
    if stdin is None:
        stdin = sys.stdin
    if stdout is None:
        stdout = sys.stdout
    session = Session()
    for line in stdin:
        line = line.strip()
        if not line:
            continue  # 空行忽略
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            response: Dict[str, Any] = {
                "ok": False,
                "error": "invalid_json",
                "message": f"输入不是合法 JSON: {exc}",
            }
        else:
            try:
                result = handle_command(session, command)
                response = {"ok": True}
                response.update(persistence.jsonable(result))
            except SchedulerError as exc:
                response = {"ok": False, "error": exc.code, "message": exc.message}
            except OSError as exc:
                response = {"ok": False, "error": "io_error", "message": str(exc)}
        stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        stdout.flush()


if __name__ == "__main__":
    main()
