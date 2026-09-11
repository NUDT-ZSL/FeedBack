"""命令行入口：从标准输入逐行读取 JSON 命令，每行输出一行 JSON 结果。

用法::

    python main.py [--m 1048576] [--k 7] [--max-bits 4194304] [--exact]

协议
----
* 每行一条 JSON 对象，必须带 ``cmd`` 字段；空行跳过。
* 成功响应形如 ``{"ok": true, ...}``。
* 任何错误都响应 ``{"error": "信息", "type": "错误类名", "cmd": "..."}``，
  不会中断进程（致命参数错误除外）。

支持的命令
~~~~~~~~~~
insert       {"cmd":"insert","key":"k","tag":"t","seq":1}
contains     {"cmd":"contains","tag":"t","key":"k"}
union        {"cmd":"union","other":"b.json","save":"c.json","replace":false}
intersect    字段同 union
difference   字段同 union
cardinality  {"cmd":"cardinality","tag":"t"}（tag 省略则返回全部 tag）
stats        {"cmd":"stats"}
save         {"cmd":"save","path":"state.json"}
load         {"cmd":"load","path":"state.json"}（替换当前内核）
dump         {"cmd":"dump"}（输出完整可 JSON 化状态，单行）
reset        {"cmd":"reset","m":1024,"k":3,"max_bits":4096,"exact":false}
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, Dict, Optional, TextIO

from bloom_kernel import (
    DEFAULT_K,
    DEFAULT_M,
    BloomKernel,
    CapacityError,
    ExactKernel,
    Item,
    KernelError,
    PersistenceError,
    ValidationError,
)

__all__ = ["run_command", "process_lines", "main"]


def _make_kernel(
    m: int = DEFAULT_M, k: int = DEFAULT_K,
    max_bits: Optional[int] = None, exact: bool = False,
    track_keys: bool = False,
) -> Any:
    """按配置创建内核；集中一处，方便 reset 与启动参数复用。"""
    if exact:
        return ExactKernel(max_keys=max_bits)
    return BloomKernel(
        default_m=m, default_k=k, max_bits=max_bits, track_keys=track_keys
    )


def _kernel_summary(kernel: Any) -> Dict[str, Any]:
    """stats 命令里附带的内核级摘要。"""
    summary: Dict[str, Any] = {
        "kind": type(kernel).__name__,
        "tags": kernel.tags(),
        "stats": kernel.stats(),
    }
    if isinstance(kernel, BloomKernel):
        summary["total_bits"] = kernel.total_bits
        summary["max_bits"] = kernel.max_bits
        summary["default_m"] = kernel.default_m
        summary["default_k"] = kernel.default_k
        summary["track_keys"] = kernel.track_keys
    else:
        summary["total_keys"] = kernel.total_keys
        summary["max_keys"] = kernel.max_keys
    return summary


def run_command(kernel: Any, obj: Dict[str, Any]) -> Any:
    """执行一条已解析的命令，返回 (新内核, 响应字典)。

    绝大多数命令不替换内核，原样返回；``load``、``reset`` 以及带
    ``replace: true`` 的集合运算会返回新内核。
    """

    if not isinstance(obj, dict):
        raise ValidationError("命令必须是 JSON 对象")
    cmd = obj.get("cmd")
    if not isinstance(cmd, str) or not cmd:
        raise ValidationError("缺少字符串字段 cmd")

    # ---- insert / contains ------------------------------------------- #
    if cmd == "insert":
        item = Item(
            key=_require_str(obj, "key"),
            tag=_require_str(obj, "tag"),
            seq=_require_int(obj, "seq"),
        )
        is_new = kernel.insert(item)
        return kernel, {"ok": True, "cmd": cmd, "new": is_new, "tag": item.tag}

    if cmd == "contains":
        tag = _require_str(obj, "tag")
        key = _require_str(obj, "key")
        member = kernel.contains(tag, key)
        return kernel, {"ok": True, "cmd": cmd, "tag": tag, "key": key, "member": member}

    # ---- 集合运算 ----------------------------------------------------- #
    if cmd in ("union", "intersect", "difference"):
        other_path = _require_str(obj, "other")
        other = _load_any(other_path)
        method = getattr(kernel, cmd)
        result = method(other)
        response: Dict[str, Any] = {
            "ok": True,
            "cmd": cmd,
            "tags": result.tags(),
            "stats": result.stats(),
        }
        save_path = obj.get("save")
        if save_path is not None:
            if not isinstance(save_path, str) or not save_path:
                raise ValidationError("save 必须是非空路径字符串")
            result.save(save_path)
            response["saved"] = save_path
        if obj.get("replace", False):
            kernel = result
            response["replaced"] = True
        return kernel, response

    # ---- 指标 --------------------------------------------------------- #
    if cmd == "cardinality":
        if "tag" in obj and obj["tag"] is not None:
            tag = _require_str(obj, "tag")
            return kernel, {
                "ok": True,
                "cmd": cmd,
                "tag": tag,
                "estimated_cardinality": kernel.estimate_cardinality(tag),
            }
        tags = obj.get("tags")
        if tags is not None:
            if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
                raise ValidationError("tags 必须是字符串数组")
            target_tags = tags
        else:
            target_tags = kernel.tags()
        return kernel, {
            "ok": True,
            "cmd": cmd,
            "cardinalities": {
                t: kernel.estimate_cardinality(t) for t in target_tags
            },
        }

    if cmd == "stats":
        return kernel, {"ok": True, "cmd": cmd, **_kernel_summary(kernel)}

    # ---- 持久化 ------------------------------------------------------- #
    if cmd == "save":
        path = _require_str(obj, "path")
        kernel.save(path)
        return kernel, {"ok": True, "cmd": cmd, "path": path}

    if cmd == "load":
        path = _require_str(obj, "path")
        return _load_any(path), {"ok": True, "cmd": cmd, "path": path}

    if cmd == "dump":
        return kernel, {"ok": True, "cmd": cmd, "state": kernel.to_dict()}

    # ---- 生命周期 ----------------------------------------------------- #
    if cmd == "reset":
        exact = bool(obj.get("exact", False))
        m = _optional_positive_int(obj, "m", DEFAULT_M)
        k = _optional_positive_int(obj, "k", DEFAULT_K)
        max_bits = _optional_nonneg_int(obj, "max_bits", None)
        track_keys = bool(obj.get("track_keys", False))
        return _make_kernel(m, k, max_bits, exact, track_keys), {
            "ok": True, "cmd": cmd
        }

    raise ValidationError(f"未知命令: {cmd!r}")


def _load_any(path: str) -> Any:
    """按快照里的 format 字段自动选择布隆/精确内核加载。"""
    if not path:
        raise ValidationError("路径不能为空字符串")
    # 先嗅探 format，避免用错类导致含糊的报错。
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        raise PersistenceError(f"快照文件不存在: {path}") from None
    except json.JSONDecodeError as exc:
        raise PersistenceError(f"快照不是合法 JSON: 第 {exc.lineno} 行: {exc.msg}") from None
    except OSError as exc:
        raise PersistenceError(f"读取快照失败: {exc}") from exc
    fmt = data.get("format") if isinstance(data, dict) else None
    if fmt == "exact-kernel":
        return ExactKernel.from_dict(data)
    if fmt == "bloom-kernel":
        return BloomKernel.from_dict(data)
    raise PersistenceError(
        f"快照 {path} 的 format 无法识别: {fmt!r}（应为 bloom-kernel/exact-kernel）"
    )


def process_lines(kernel: Any, stdin: TextIO, stdout: TextIO) -> Any:
    """逐行驱动：读一行、解析、执行、写一行 JSON。返回最终内核。"""
    for raw in stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValidationError(f"输入不是合法 JSON: 第 {exc.lineno} 行: {exc.msg}")
            kernel, response = run_command(kernel, obj)
        except KernelError as exc:
            cmd_name = None
            try:
                cmd_name = json.loads(line).get("cmd")
            except Exception:
                pass
            response = {
                "ok": False,
                "error": str(exc),
                "type": type(exc).__name__,
            }
            if isinstance(cmd_name, str):
                response["cmd"] = cmd_name
        stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        stdout.flush()
    return kernel


def _require_str(obj: Dict[str, Any], name: str) -> str:
    val = obj.get(name)
    if not isinstance(val, str):
        raise ValidationError(f"字段 {name!r} 必须是字符串，实际为: {val!r}")
    return val


def _require_int(obj: Dict[str, Any], name: str) -> int:
    val = obj.get(name)
    if not isinstance(val, int) or isinstance(val, bool):
        raise ValidationError(f"字段 {name!r} 必须是整数，实际为: {val!r}")
    return val


def _optional_positive_int(obj: Dict[str, Any], name: str, default: int) -> int:
    if name not in obj or obj[name] is None:
        return default
    val = _require_int(obj, name)
    if val < 1:
        raise ValidationError(f"字段 {name!r} 必须 >= 1，实际为: {val}")
    return val


def _optional_nonneg_int(obj: Dict[str, Any], name: str, default: Optional[int]) -> Optional[int]:
    if name not in obj or obj[name] is None:
        return default
    val = _require_int(obj, name)
    if val < 0:
        raise ValidationError(f"字段 {name!r} 必须 >= 0，实际为: {val}")
    return val


def main(argv: Optional[list] = None) -> int:
    # Windows 默认控制台可能是 GBK，统一强制 UTF-8，保证中文/特殊字符可输出。
    for stream in (sys.stdin, sys.stdout):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except (AttributeError, ValueError):
            pass
    parser = argparse.ArgumentParser(
        description="流式分片布隆过滤器内核（stdin JSON 行协议）"
    )
    parser.add_argument("--m", type=int, default=DEFAULT_M, help="默认位数组长度（位）")
    parser.add_argument("--k", type=int, default=DEFAULT_K, help="默认哈希个数")
    parser.add_argument(
        "--max-bits", type=int, default=None,
        help="所有 tag 位数总位数上限；0 表示不允许任何插入",
    )
    parser.add_argument(
        "--exact", action="store_true",
        help="使用精确 set 内核（对照测试用），此时 --max-bits 作为 max_keys",
    )
    parser.add_argument(
        "--track-keys", action="store_true",
        help="布隆内核额外精确保存全部 key：distinct/基数估算变精确，"
        "且双方都开启时集合运算（含差集）零假阴性",
    )
    args = parser.parse_args(argv)
    try:
        kernel = _make_kernel(
            args.m, args.k, args.max_bits, args.exact, args.track_keys
        )
    except ValidationError as exc:
        sys.stdout.write(
            json.dumps({"ok": False, "error": str(exc), "type": "ValidationError"})
            + "\n"
        )
        return 2
    process_lines(kernel, sys.stdin, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
