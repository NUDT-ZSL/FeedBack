"""行式 JSON 命令行入口。

从标准输入逐行读取 JSON 命令，每行一条，向标准输出写一行 JSON 结果。
成功响应形如 ``{"ok": true, ...}``；任何错误（含 JSON 解析失败、未知
命令、内核错误）都返回 ``{"ok": false, "code": ..., "error": ...}``，
进程不中断，可继续处理后续命令。空行忽略，读到 EOF 退出。

支持的命令（``op`` 字段）::

    register        登记资源：{"op":"register","name":"db-slot-1"}
    acquire         申请：{"op":"acquire","name":"...","owner":"worker-1"}
    release         释放：{"op":"release","name":"..."}
    retry           重试释放：{"op":"retry","name":"..."}
    reset          重置为空闲：{"op":"reset","name":"..."}
    force_cleanup   强制清理全部：{"op":"force_cleanup"}
    status          查询单资源：{"op":"status","name":"..."}
    list_unreleased 列出占用未归零资源
    list_all        列出全部资源
    export          导出快照：{"op":"export","path":"state.json"}
    import          导入快照：{"op":"import","path":"state.json"}
    inspect         查看内部完整状态（等价于导出的内存快照）
    config          配置失败注入（仅用于演练/验收，见下）
    ping            连通性自检，返回 {"ok": true, "pong": true}

失败注入（默认初始化与释放总是成功）::

    {"op":"config",
     "init_fail": {"a": 1, "b": -1},
     "release_fail": {"a": 2}}

* 值为正整数 n：该资源接下来 n 次回调失败（每次递减）；
* 值为 -1：始终失败；0 或缺省：成功。

也可用环境变量 ``RK_MAX_RETRIES`` 指定连续失败上限（默认 3），
或命令行参数 ``--max-retries N``。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Optional, TextIO

from .kernel import (
    ResourceAlreadyExistsError,
    ResourceBusyError,
    ResourceKernel,
    ResourceKernelError,
    ResourceNotFoundError,
    ResourceNotOccupiedError,
    InvalidStateError,
)
from .persistence import PersistenceError, export_to_file, import_from_file


class ScriptedFailure:
    """按资源名计数的失败注入器（供 CLI 演练初始化/释放失败场景）。"""

    def __init__(self) -> None:
        # name -> 剩余失败次数；-1 表示永远失败。
        self._remaining: Dict[str, int] = {}

    def configure(self, mapping: Optional[Dict[str, Any]]) -> None:
        """用 {资源名: 次数} 配置；次数为 -1 表示永远失败。"""
        self._remaining = {}
        if not mapping:
            return
        if not isinstance(mapping, dict):
            raise ValueError("failure map must be an object of name->integer")
        for name, times in mapping.items():
            if not isinstance(name, str):
                raise ValueError("failure map keys must be resource name strings")
            if (
                not isinstance(times, int)
                or isinstance(times, bool)
                or times < -1
            ):
                raise ValueError(
                    f"failure count for '{name}' must be -1 (always) or >= 0"
                )
            self._remaining[name] = times

    def __call__(self, name: str) -> Optional[str]:
        """作为初始化/释放回调：返回 None 成功，返回字符串为失败原因。"""
        remaining = self._remaining.get(name, 0)
        if remaining == -1:
            return f"injected failure for '{name}' (always)"
        if remaining > 0:
            self._remaining[name] = remaining - 1
            return f"injected failure for '{name}' ({remaining} attempt(s) left)"
        return None


def _error(code: str, message: str) -> Dict[str, Any]:
    """构造统一的错误响应体。"""
    return {"ok": False, "code": code, "error": message}


def _kernel_error_code(exc: ResourceKernelError) -> str:
    """把内核异常映射为稳定的错误码字符串。"""
    return getattr(exc, "code", "kernel_error")


def handle_command(
    kernel: ResourceKernel,
    command: Dict[str, Any],
    init_failure: ScriptedFailure,
    release_failure: ScriptedFailure,
) -> Dict[str, Any]:
    """执行一条已解析的命令，返回可 JSON 序列化的响应字典。

    本函数不抛出内核异常：所有已知错误都转换为 ``ok=false`` 响应，
    未知异常兜底为 ``internal_error``，以保证 CLI 逐行处理不中断。
    """
    op = command.get("op")
    if not isinstance(op, str):
        return _error("missing_op", "command object must contain a string 'op'")

    try:
        if op == "ping":
            return {"ok": True, "pong": True}

        if op == "config":
            try:
                init_failure.configure(command.get("init_fail"))
                release_failure.configure(command.get("release_fail"))
            except ValueError as exc:
                return _error("invalid_config", str(exc))
            return {"ok": True, "configured": True}

        if op == "register":
            name = command.get("name")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            kernel.register(name)
            return {"ok": True, "registered": name}

        if op == "acquire":
            name = command.get("name")
            owner = command.get("owner")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            if not isinstance(owner, str) or not owner:
                return _error("invalid_argument", "'owner' must be a non-empty string")
            kernel.acquire(name, owner)
            return {"ok": True, "name": name, "owner": owner, "state": "occupied"}

        if op == "release":
            name = command.get("name")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            kernel.release(name)
            return {"ok": True, **_status_payload(kernel, name)}

        if op == "retry":
            name = command.get("name")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            kernel.retry(name)
            return {"ok": True, **_status_payload(kernel, name)}

        if op == "reset":
            name = command.get("name")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            kernel.reset(name)
            return {"ok": True, **_status_payload(kernel, name)}

        if op == "force_cleanup":
            summary = kernel.force_cleanup()
            return {"ok": True, "cleanup": summary}

        if op == "status":
            name = command.get("name")
            if not isinstance(name, str) or not name:
                return _error("invalid_argument", "'name' must be a non-empty string")
            return {"ok": True, "resource": kernel.status(name)}

        if op == "list_unreleased":
            return {"ok": True, "resources": kernel.list_unreleased()}

        if op == "list_all":
            return {"ok": True, "resources": kernel.list_all()}

        if op == "export":
            path = command.get("path")
            if not isinstance(path, str) or not path:
                return _error("invalid_argument", "'path' must be a non-empty string")
            export_to_file(kernel, path)
            return {"ok": True, "exported": path}

        if op == "import":
            path = command.get("path")
            if not isinstance(path, str) or not path:
                return _error("invalid_argument", "'path' must be a non-empty string")
            import_from_file(kernel, path)
            return {"ok": True, "imported": path, "resources": kernel.list_all()}

        if op == "inspect":
            return {"ok": True, "snapshot": kernel.to_snapshot()}

        return _error("unknown_op", f"unknown op '{op}'")

    except (
        ResourceNotFoundError,
        ResourceAlreadyExistsError,
        ResourceBusyError,
        ResourceNotOccupiedError,
        InvalidStateError,
        PersistenceError,
    ) as exc:
        return _error(_kernel_error_code(exc), str(exc))
    except ValueError as exc:
        return _error("invalid_argument", str(exc))
    except Exception as exc:  # 最后防线：CLI 永不因单条命令崩溃
        return _error("internal_error", f"{type(exc).__name__}: {exc}")


def _status_payload(kernel: ResourceKernel, name: str) -> Dict[str, Any]:
    """在释放/重试响应中顺带带上资源最新状态。"""
    status = kernel.status(name)
    return {
        "name": name,
        "state": status["state"],
        "occupation_count": status["occupation_count"],
        "retry_count": status["retry_count"],
        "last_failure_reason": status["last_failure_reason"],
    }


def build_kernel(max_retries: int) -> "tuple[ResourceKernel, ScriptedFailure, ScriptedFailure]":
    """构造 CLI 使用的内核与一对可配置失败回调。"""
    init_failure = ScriptedFailure()
    release_failure = ScriptedFailure()
    kernel = ResourceKernel(
        initializer=init_failure,
        releaser=release_failure,
        max_retries=max_retries,
    )
    return kernel, init_failure, release_failure


def run(
    in_stream: TextIO,
    out_stream: TextIO,
    max_retries: Optional[int] = None,
) -> int:
    """主循环：逐行读 JSON、逐行写 JSON。

    :returns: 进程退出码（始终为 0；单条命令失败体现在响应 JSON 中）。
    """
    if max_retries is None:
        try:
            max_retries = int(os.environ.get("RK_MAX_RETRIES", "3"))
        except ValueError:
            max_retries = 3
    kernel, init_failure, release_failure = build_kernel(max_retries)

    for line in in_stream:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError as exc:
            response = _error(
                "bad_json",
                f"input is not valid JSON: {exc.msg} "
                f"(line {exc.lineno}, column {exc.colno})",
            )
        else:
            if not isinstance(command, dict):
                response = _error(
                    "invalid_command", "each command must be a JSON object"
                )
            else:
                response = handle_command(
                    kernel, command, init_failure, release_failure
                )
        out_stream.write(json.dumps(response, ensure_ascii=False, sort_keys=True))
        out_stream.write("\n")
        out_stream.flush()
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    """命令行入口：解析参数并启动行式 JSON 循环。"""
    parser = argparse.ArgumentParser(
        description="Offline resource management kernel (line-delimited JSON API)."
    )
    parser.add_argument(
        "--max-retries",
        type=int,
        default=None,
        help="max consecutive release failures before FAILED state (default: 3 "
        "or RK_MAX_RETRIES env var).",
    )
    args = parser.parse_args(argv)
    return run(sys.stdin, sys.stdout, max_retries=args.max_retries)


if __name__ == "__main__":
    raise SystemExit(main())
