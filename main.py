#!/usr/bin/env python3
"""内容寻址块存储的命令行入口（行式 JSON 协议，仅用标准库）。

用法::

    python main.py

进程从标准输入逐行读取 JSON 命令，每条命令向标准输出写一行 JSON 结果。
空行跳过；命令执行失败时输出 ``{"error": ..., "error_type": ...}``，
进程不退出，继续处理下一行。

字节数据一律用 Base64 编码传递（字段名 ``data_b64`` / ``content_b64``）。

支持的命令：

``new_store``   {"block_size"?: 4096, "max_bytes"?: null}
    重置进程内的当前存储（默认 4096 字节块、无上限）。
``put_block``   {"data_b64": "..."}
    写入块，返回 ``block_id`` 与写入后的 ``ref_count``。
``get_block``   {"block_id": "..."}
    返回 ``data_b64``；块不存在时返回 error。
``add_file``    {"path": "a.txt", "data_b64": "...", "block_size"?: n}
    切块写入并登记清单，返回 ``manifest``。
``remove_file`` {"path": "a.txt"}
    移除清单并释放引用（不自动 gc）。
``diff``        {"local_path"?: p, "remote_path"?: p,
                 "local_manifest"?: {...}, "remote_manifest"?: {...}}
    返回同步计划 ``plan``。
``apply``       {"plan": {...}, "remote_dir"?: "...", "adopt"?: false}
    从远端快照目录（不给则用进程内当前存储）拉块并重建文件，
    返回 ``content_b64``、``length``、``bytes_sha256``；``adopt`` 为
    true 时同时把远端清单登记进当前存储。
``gc`` / ``stats`` / ``manifests``
    垃圾回收 / 统计 / 列出清单。
``save``        {"dir": "..."} / ``load`` {"dir": "..."}
    快照持久化与恢复（load 会替换当前存储）。
``dump``        返回当前存储的完整可检视状态（统计、引用表、清单、块索引）。
"""

from __future__ import annotations

import base64
import json
import sys
from typing import Any, Callable, Dict, Optional

import cas
from cas import (
    BlockSizeMismatchError,
    CasError,
    ContentStore,
    Manifest,
    MissingBlockError,
    SyncPlan,
    diff,
)

CommandResult = Dict[str, Any]
Handler = Callable[[Dict[str, Any]], CommandResult]


class CliSession:
    """持有进程内当前 :class:`ContentStore` 的会话。"""

    def __init__(self) -> None:
        self.store: ContentStore = ContentStore()

    # -- 命令处理 --------------------------------------------------------- #
    def cmd_new_store(self, cmd: Dict[str, Any]) -> CommandResult:
        block_size = cmd.get("block_size", cas.DEFAULT_BLOCK_SIZE)
        max_bytes = cmd.get("max_bytes", None)
        self.store = ContentStore(block_size=block_size, max_bytes=max_bytes)
        return {"ok": True, "block_size": block_size, "max_bytes": max_bytes}

    def cmd_put_block(self, cmd: Dict[str, Any]) -> CommandResult:
        data = _decode_b64(cmd, "data_b64")
        block_id = self.store.put_block(data)
        return {"block_id": block_id, "ref_count": self.store.ref_count(block_id)}

    def cmd_get_block(self, cmd: Dict[str, Any]) -> CommandResult:
        block_id = _require_str(cmd, "block_id")
        data = self.store.get_block(block_id)
        return {
            "block_id": block_id,
            "size": len(data),
            "data_b64": base64.b64encode(data).decode("ascii"),
        }

    def cmd_add_file(self, cmd: Dict[str, Any]) -> CommandResult:
        path = _require_str(cmd, "path")
        data = _decode_b64(cmd, "data_b64")
        block_size = cmd.get("block_size")
        manifest = self.store.add_file(path, data, block_size)
        return {"manifest": manifest.to_dict()}

    def cmd_remove_file(self, cmd: Dict[str, Any]) -> CommandResult:
        path = _require_str(cmd, "path")
        self.store.remove_manifest(path)
        return {"ok": True, "path": path}

    def cmd_manifests(self, cmd: Dict[str, Any]) -> CommandResult:
        return {
            "manifests": [m.to_dict() for m in self.store.manifests.values()]
        }

    def cmd_diff(self, cmd: Dict[str, Any]) -> CommandResult:
        local_manifest = self._resolve_manifest(cmd, "local")
        remote_manifest = self._resolve_manifest(cmd, "remote")
        plan = diff(local_manifest, remote_manifest)
        return {"plan": plan.to_dict()}

    def cmd_apply(self, cmd: Dict[str, Any]) -> CommandResult:
        if "plan" not in cmd or not isinstance(cmd["plan"], dict):
            raise CasError("apply 缺少 plan 对象")
        plan = SyncPlan.from_dict(cmd["plan"])

        if "remote_dir" in cmd and cmd["remote_dir"] is not None:
            remote_store = ContentStore.load(str(cmd["remote_dir"]))
        else:
            # 不带 remote_dir 时把进程内存储当作“远端”，便于离线自测。
            remote_store = self.store

        content = self.store.apply_diff(plan, remote_store)
        result: CommandResult = {
            "length": len(content),
            "bytes_sha256": cas.hash_bytes(content),
            "content_b64": base64.b64encode(content).decode("ascii"),
            "manifest_content_hash": plan.content_hash,
        }
        if cmd.get("adopt", False):
            manifest = self.store.adopt_remote_manifest(plan)
            result["manifest"] = manifest.to_dict()
        return result

    def cmd_gc(self, cmd: Dict[str, Any]) -> CommandResult:
        return {"removed": self.store.gc()}

    def cmd_stats(self, cmd: Dict[str, Any]) -> CommandResult:
        return self.store.stats()

    def cmd_save(self, cmd: Dict[str, Any]) -> CommandResult:
        dir_path = _require_str(cmd, "dir")
        self.store.save(dir_path)
        return {"ok": True, "dir": dir_path}

    def cmd_load(self, cmd: Dict[str, Any]) -> CommandResult:
        dir_path = _require_str(cmd, "dir")
        self.store = ContentStore.load(dir_path)
        return {"ok": True, "dir": dir_path, **self.store.stats()}

    def cmd_dump(self, cmd: Dict[str, Any]) -> CommandResult:
        return {
            "block_size": self.store.block_size,
            "max_bytes": self.store.max_bytes,
            "stats": self.store.stats(),
            "refs": {
                bid: self.store.ref_count(bid)
                for bid in self.store.block_ids()
            },
            "manifests": [
                m.to_dict() for m in self.store.manifests.values()
            ],
            "blocks": [
                {"id": bid, "size": len(self.store.get_block(bid))}
                for bid in self.store.block_ids()
            ],
        }

    # -- 辅助 ------------------------------------------------------------- #
    def _resolve_manifest(self, cmd: Dict[str, Any], side: str) -> Manifest:
        inline = cmd.get(f"{side}_manifest")
        if inline is not None:
            if not isinstance(inline, dict):
                raise CasError(f"{side}_manifest 必须是对象")
            return Manifest.from_dict(inline)
        path_key = f"{side}_path"
        if path_key in cmd:
            path = str(cmd[path_key])
            manifest = self.store.manifests.get(path)
            if manifest is None:
                raise CasError(f"{side} 端清单路径不存在: {path!r}")
            return manifest
        raise CasError(f"diff 缺少 {side}_manifest 或 {side}_path")


def _require_str(cmd: Dict[str, Any], key: str) -> str:
    if key not in cmd or not isinstance(cmd[key], str):
        raise CasError(f"缺少字符串字段: {key}")
    return cmd[key]


def _decode_b64(cmd: Dict[str, Any], key: str) -> bytes:
    if key not in cmd or not isinstance(cmd[key], str):
        raise CasError(f"缺少 Base64 字符串字段: {key}")
    try:
        return base64.b64decode(cmd[key], validate=True)
    except (ValueError, TypeError) as exc:
        raise CasError(f"{key} 不是合法的 Base64: {exc}") from exc


def build_handlers(session: CliSession) -> Dict[str, Handler]:
    return {
        "new_store": session.cmd_new_store,
        "put_block": session.cmd_put_block,
        "get_block": session.cmd_get_block,
        "add_file": session.cmd_add_file,
        "remove_file": session.cmd_remove_file,
        "manifests": session.cmd_manifests,
        "diff": session.cmd_diff,
        "apply": session.cmd_apply,
        "gc": session.cmd_gc,
        "stats": session.cmd_stats,
        "save": session.cmd_save,
        "load": session.cmd_load,
        "dump": session.cmd_dump,
    }


def main(argv: Optional[list] = None) -> int:
    """行式 JSON 主循环：读一行命令，写一行结果。"""
    # 行式 JSON 协议固定走 UTF-8，避免 Windows 控制台默认代码页影响。
    for stream in (sys.stdin, sys.stdout):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8")

    session = CliSession()
    handlers = build_handlers(session)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
            if not isinstance(cmd, dict) or "cmd" not in cmd:
                raise CasError("每行必须是包含 cmd 字段的 JSON 对象")
            name = str(cmd["cmd"])
            handler = handlers.get(name)
            if handler is None:
                raise CasError(f"未知命令: {name}")
            result = handler(cmd)
        except CasError as exc:
            result = {"error": str(exc), "error_type": type(exc).__name__}
            # 差分场景下额外带上结构化信息，方便调用方判断。
            if isinstance(exc, BlockSizeMismatchError):
                result["local_size"] = exc.local_size
                result["remote_size"] = exc.remote_size
            if isinstance(exc, MissingBlockError):
                result["missing"] = exc.missing
        except Exception as exc:  # noqa: BLE001 - CLI 边界，任何错误都转 JSON
            result = {"error": str(exc), "error_type": type(exc).__name__}

        sys.stdout.write(json.dumps(result, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
