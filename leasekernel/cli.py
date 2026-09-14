"""命令行入口：从标准输入逐行读取 JSON 命令，每行输出一行 JSON。

支持的命令（``cmd`` 字段区分）::

    {"cmd": "register", "resource": "r1", "ttl": 100, "epsilon": 10,
     "node_epsilons": {"node-a": 5}}
    {"cmd": "acquire",  "resource": "r1", "holder": "node-a"}
    {"cmd": "renew",    "resource": "r1", "holder": "node-a",
     "generation": 1, "local_time": 40, "lease_id": "r1#L1"}
    {"cmd": "write",    "resource": "r1", "holder": "node-a",
     "generation": 1}
    {"cmd": "release",  "resource": "r1", "holder": "node-a", "generation": 1}
    {"cmd": "reclaim", "resource": "r1"}        // resource 可省略 => 扫描全部
    {"cmd": "advance",  "delta": 30}            // 时钟前进（非负）
    {"cmd": "set_clock", "time": 50}            // 时钟回退/跳变注入
    {"cmd": "status",   "resource": "r1"}
    {"cmd": "log",      "limit": 20}            // limit 可省略
    {"cmd": "export",   "path": "state.json"}
    {"cmd": "import",   "path": "state.json"}
    {"cmd": "inspect"}                          // 查看完整内部状态
    {"cmd": "reset",    "initial": 0}           // 清空并重建内核（可选）

成功输出 ``{"ok": true, ...}``；失败输出
``{"ok": false, "error": "...", "error_type": "..."}``，绝不向标准输出抛出
异常。空行被忽略。
"""

from __future__ import annotations

import json
import sys
from typing import Any, Dict, List, Optional, TextIO

from .clock import ManualClock
from .kernel import (
    LeaseKernel,
    PersistenceError,
    ValidationError,
)

__all__ = ["run", "handle_command"]


def _ok(**fields: Any) -> Dict[str, Any]:
    out: Dict[str, Any] = {"ok": True}
    out.update(fields)
    return out


def _err(exc: Exception) -> Dict[str, Any]:
    return {
        "ok": False,
        "error": str(exc),
        "error_type": type(exc).__name__,
    }


def handle_command(kernel: LeaseKernel, command: Dict[str, Any]) -> Dict[str, Any]:
    """在给定内核上执行一条已解析的命令，返回可 JSON 化的结果字典。"""
    if not isinstance(command, dict):
        raise ValidationError("命令必须是 JSON 对象")
    cmd = command.get("cmd")
    if not isinstance(cmd, str):
        raise ValidationError("缺少字符串字段 cmd")

    if cmd == "reset":
        initial = float(command.get("initial", 0.0))
        kernel.reset(initial)
        return _ok(reset=True, now=kernel.clock.now, monotonic=kernel.clock.monotonic)

    if cmd == "register":
        result = kernel.register_resource(
            name=command["resource"],
            ttl=command["ttl"],
            epsilon=command.get("epsilon", 0.0),
            node_epsilons=command.get("node_epsilons"),
        )
        return _ok(**result)

    if cmd == "acquire":
        result = kernel.acquire(command["resource"], command["holder"])
        return _ok(**result)

    if cmd == "renew":
        result = kernel.renew(
            resource=command["resource"],
            holder=command["holder"],
            generation=command["generation"],
            local_time=command["local_time"],
            lease_id=command.get("lease_id"),
        )
        return _ok(**result)

    if cmd == "write":
        result = kernel.check_write(
            resource=command["resource"],
            holder=command["holder"],
            generation=command["generation"],
            lease_id=command.get("lease_id"),
        )
        return _ok(**result)

    if cmd == "release":
        result = kernel.release(
            command["resource"], command["holder"], command["generation"]
        )
        return _ok(**result)

    if cmd == "reclaim":
        result = kernel.reclaim(command.get("resource"))
        return _ok(**result)

    if cmd == "advance":
        if "delta" not in command:
            raise ValidationError("advance 缺少 delta")
        if isinstance(kernel.clock, ManualClock):
            value = kernel.clock.advance(command["delta"])
        else:  # pragma: no cover - CLI 总是使用 ManualClock
            raise ValidationError("当前时钟不支持 advance")
        return _ok(advanced=command["delta"], now=value,
                   monotonic=kernel.clock.monotonic)

    if cmd == "set_clock":
        if "time" not in command:
            raise ValidationError("set_clock 缺少 time")
        if isinstance(kernel.clock, ManualClock):
            value = kernel.clock.set_time(command["time"])
        else:  # pragma: no cover
            raise ValidationError("当前时钟不支持 set_clock")
        return _ok(now=value, monotonic=kernel.clock.monotonic)

    if cmd == "status":
        return _ok(status=kernel.status(command["resource"]).to_dict())

    if cmd == "log":
        events: List[Dict[str, Any]] = [e.to_dict() for e in kernel.events]
        limit = command.get("limit")
        if limit is not None:
            if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
                raise ValidationError("limit 必须是非负整数")
            if limit:
                events = events[-limit:]
        return _ok(events=events, count=len(events))

    if cmd == "inspect":
        return _ok(state=kernel.to_dict())

    if cmd == "export":
        path = command.get("path")
        if not isinstance(path, str) or not path:
            raise ValidationError("export 缺少 path")
        kernel.export_json(path)
        return _ok(exported=path)

    if cmd == "import":
        path = command.get("path")
        if not isinstance(path, str) or not path:
            raise ValidationError("import 缺少 path")
        kernel.import_json(path)
        return _ok(imported=path, state=kernel.to_dict())

    raise ValidationError("未知命令: %s" % cmd)


def run(inp: TextIO, out: TextIO, initial_clock: float = 0.0) -> int:
    """流式处理：逐行读 ``inp``，逐行向 ``out`` 写 JSON。

    :return: 出现的错误行数（0 表示全部成功），便于脚本检测。
    """
    kernel = LeaseKernel(ManualClock(initial_clock))
    errors = 0
    for lineno, raw in enumerate(inp, start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
            result = handle_command(kernel, command)
        except (
            ValidationError,
            PersistenceError,
            KeyError,
            TypeError,
            ValueError,
            json.JSONDecodeError,
            OSError,
        ) as exc:
            if isinstance(exc, KeyError):
                exc = ValidationError("缺少字段: %s" % exc.args[0])
            result = _err(exc)
            result["line"] = lineno
            errors += 1
        out.write(json.dumps(result, ensure_ascii=False, sort_keys=True) + "\n")
        out.flush()
    return errors


def main(argv: Optional[List[str]] = None) -> int:
    """进程入口。可用 ``--initial`` 指定逻辑时钟初值。"""
    argv = list(sys.argv[1:] if argv is None else argv)
    initial = 0.0
    if argv and argv[0] == "--initial":
        if len(argv) < 2:
            sys.stderr.write("--initial 需要一个数值参数\n")
            return 2
        try:
            initial = float(argv[1])
        except ValueError:
            sys.stderr.write("--initial 参数必须是数值\n")
            return 2
    return run(sys.stdin, sys.stdout, initial)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
