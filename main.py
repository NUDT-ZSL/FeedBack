#!/usr/bin/env python3
"""cdiff 命令行入口：从标准输入逐行读取 JSON 命令，逐行输出 JSON 结果。

支持的命令（每行一个 JSON 对象）：

- ``fingerprint``：``{"cmd":"fingerprint","data_b64":"...","config":{...}}``
- ``diff``       ：``{"cmd":"diff","old_b64":"...","new_b64":"..."}``
- ``patch``      ：``{"cmd":"patch","old_b64":"...","delta":{...}}``
                  或 ``{"cmd":"patch","old_b64":"...","path":"patch.json"}``
- ``compare``    ：``{"cmd":"compare","old_hex":"...","new_hex":"..."}``
- ``save``       ：``{"cmd":"save","path":"p.json","delta":{...}}``
- ``load``       ：``{"cmd":"load","path":"p.json"}``
- ``dump``       ：``{"cmd":"dump","delta":{...}}`` 或带 ``path``

字节内容既可用 ``*_b64`` 也可用 ``*_hex`` 表示，因此可以安全处理
任意二进制数据。成功输出一行结果 JSON；任何错误输出一行
``{"error": "...", "error_type": "..."}``，不会中断后续命令。
空行会被跳过。
"""

from __future__ import annotations

import base64
import binascii
import json
import sys
from typing import Any, Dict, Optional

from cdiff import (
    CdiffError,
    ChunkConfig,
    FingerprintMismatchError,
    compare,
    diff,
    fingerprint,
    patch,
    patch_size,
)
from cdiff.persistence import delta_from_dict, delta_to_dict, load_delta, save_delta


def _decode_bytes(obj: Dict[str, Any], *names: str) -> bytes:
    """从命令对象中按候选字段名取出二进制内容。

    支持的键是每个逻辑名加上 ``_b64`` / ``_hex`` 后缀；
    逻辑名本身若存在则必须是 base64 字符串。
    """
    for name in names:
        for suffix, decoder in (("_b64", _b64decode), ("_hex", bytes.fromhex)):
            key = name + suffix
            if key in obj:
                value = obj[key]
                if not isinstance(value, str):
                    raise CdiffError("%s must be a string" % key)
                try:
                    return decoder(value)
                except (ValueError, binascii.Error) as exc:
                    raise CdiffError("cannot decode %s: %s" % (key, exc)) from exc
        if name in obj:
            value = obj[name]
            if not isinstance(value, str):
                raise CdiffError("%s must be a base64 string" % name)
            try:
                return _b64decode(value)
            except (ValueError, binascii.Error) as exc:
                raise CdiffError("cannot decode %s: %s" % (name, exc)) from exc
    raise CdiffError(
        "missing binary field, expected one of: %s"
        % ", ".join("%s_b64/%s_hex" % (n, n) for n in names)
    )


def _b64decode(value: str) -> bytes:
    """标准 base64 解码（严格模式，拒绝夹杂非法字符）。"""
    return base64.b64decode(value, validate=True)


def _b64encode(data: bytes) -> str:
    """标准 base64 编码。"""
    return base64.b64encode(data).decode("ascii")


def _get_config(obj: Dict[str, Any]) -> Optional[ChunkConfig]:
    """读取可选的分块配置。"""
    raw = obj.get("config")
    if raw is None:
        return None
    return ChunkConfig.from_dict(raw)


def _get_delta(obj: Dict[str, Any]):
    """从内联 ``delta`` 对象或 ``path``/``delta_path`` 文件得到补丁。"""
    if "delta" in obj:
        return delta_from_dict(obj["delta"])
    for key in ("path", "delta_path"):
        if key in obj:
            source = obj[key]
            if not isinstance(source, str):
                raise CdiffError("%s must be a string" % key)
            return load_delta(source)
    raise CdiffError("missing 'delta' object or 'path' string")


# -- 各命令实现 -----------------------------------------------------------


def cmd_fingerprint(obj: Dict[str, Any]) -> Dict[str, Any]:
    """fingerprint 命令。"""
    data = _decode_bytes(obj, "data")
    return fingerprint(data, _get_config(obj)).to_dict()


def cmd_diff(obj: Dict[str, Any]) -> Dict[str, Any]:
    """diff 命令：返回自包含的补丁文档，可直接回传给 patch/save。"""
    old = _decode_bytes(obj, "old")
    new = _decode_bytes(obj, "new")
    delta = diff(old, new, _get_config(obj))
    result = delta_to_dict(delta)
    result["patch_size"] = patch_size(delta)
    return result


def cmd_patch(obj: Dict[str, Any]) -> Dict[str, Any]:
    """patch 命令：返回还原出的新内容（base64）。"""
    old = _decode_bytes(obj, "old")
    delta = _get_delta(obj)
    result = patch(old, delta)
    return {"data_b64": _b64encode(result), "size": len(result)}


def cmd_compare(obj: Dict[str, Any]) -> Dict[str, Any]:
    """compare 命令。"""
    old = _decode_bytes(obj, "old")
    new = _decode_bytes(obj, "new")
    return compare(old, new, _get_config(obj)).to_dict()


def cmd_save(obj: Dict[str, Any]) -> Dict[str, Any]:
    """save 命令：把补丁写到 JSON 文件。

    补丁来源二选一：内联 ``delta`` / 另一个补丁文件 ``delta_path``，
    或者直接给 ``old_b64`` + ``new_b64`` 现场生成。
    """
    path = obj.get("path")
    if not isinstance(path, str):
        raise CdiffError("save requires a string 'path'")
    if "delta" in obj:
        delta = delta_from_dict(obj["delta"])
    elif "delta_path" in obj:
        source = obj["delta_path"]
        if not isinstance(source, str):
            raise CdiffError("delta_path must be a string")
        delta = load_delta(source)
    elif "old_b64" in obj or "old_hex" in obj:
        old = _decode_bytes(obj, "old")
        new = _decode_bytes(obj, "new")
        delta = diff(old, new, _get_config(obj))
    else:
        raise CdiffError(
            "save needs a 'delta' object, a 'delta_path' file, or old/new data"
        )
    save_delta(path, delta)
    return {"saved": path, "patch_size": patch_size(delta)}


def cmd_load(obj: Dict[str, Any]) -> Dict[str, Any]:
    """load 命令：读回补丁文档（已通过完整一致性校验）。"""
    path = obj.get("path")
    if not isinstance(path, str):
        raise CdiffError("load requires a string 'path'")
    delta = load_delta(path)
    result = delta_to_dict(delta)
    result["patch_size"] = patch_size(delta)
    return result


def cmd_dump(obj: Dict[str, Any]) -> Dict[str, Any]:
    """dump 命令：给出补丁的可读摘要（指令、指纹、配置、统计）。"""
    delta = _get_delta(obj)
    ops = []
    for i, op in enumerate(delta.ops):
        d = op.to_dict()
        d["index"] = i
        if d["op"] == "ADD":
            d["length"] = len(op.data)
        ops.append(d)
    return {
        "old_digest": delta.old_fingerprint.digest,
        "new_digest": delta.new_fingerprint.digest,
        "old_size": delta.old_fingerprint.size,
        "new_size": delta.new_fingerprint.size,
        "config": delta.config.to_dict(),
        "patch_size": patch_size(delta),
        "stats": delta.stats(),
        "ops": ops,
    }


_DISPATCH = {
    "fingerprint": cmd_fingerprint,
    "diff": cmd_diff,
    "patch": cmd_patch,
    "compare": cmd_compare,
    "save": cmd_save,
    "load": cmd_load,
    "dump": cmd_dump,
}


def handle_line(line: str) -> str:
    """处理一行输入，返回一行 JSON 结果（成功或错误）。"""
    try:
        obj = json.loads(line)
        if not isinstance(obj, dict):
            raise CdiffError("command must be a JSON object")
        command = obj.get("cmd")
        handler = _DISPATCH.get(command)
        if handler is None:
            raise CdiffError(
                "unknown cmd %r, expected one of %s"
                % (command, ", ".join(sorted(_DISPATCH)))
            )
        result = handler(obj)
        if not isinstance(result, dict):
            result = {"result": result}
        return json.dumps(result, ensure_ascii=False, sort_keys=True)
    except CdiffError as exc:
        payload: Dict[str, Any] = {
            "error": str(exc),
            "error_type": type(exc).__name__,
        }
        if isinstance(exc, FingerprintMismatchError):
            payload["expected"] = exc.expected
            payload["actual"] = exc.actual
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)
    except Exception as exc:  # noqa: BLE001 - 任何意外都以 JSON 错误返回
        return json.dumps(
            {
                "error": "%s: %s" % (type(exc).__name__, exc),
                "error_type": type(exc).__name__,
            },
            ensure_ascii=False,
            sort_keys=True,
        )


def main(argv: Optional[list] = None) -> int:
    """逐行读取标准输入并写出 JSON 结果，始终以退出码 0 结束。"""
    out = sys.stdout
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        out.write(handle_line(line) + "\n")
        out.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
