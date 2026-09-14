"""资源内核的 JSON 文件持久化。

导出时先写临时文件再原子替换，避免半截文件覆盖原快照；导入时先完整
读取、解析、校验，全部通过后才替换内核内存状态——文件损坏或字段缺失
时抛出带明确信息的 :class:`PersistenceError`，内存状态保持不变。
"""

from __future__ import annotations

import json
import os
import tempfile
from typing import Any, Dict

from .kernel import ResourceKernel, ResourceKernelError


class PersistenceError(ResourceKernelError):
    """快照文件读写或解析失败。"""

    code = "persistence_error"


def export_to_file(kernel: ResourceKernel, path: str) -> None:
    """把内核快照写成 JSON 文件（原子替换，UTF-8、缩进 2）。

    :raises PersistenceError: 写入失败。
    """
    snapshot = kernel.to_snapshot()
    directory = os.path.dirname(os.path.abspath(path)) or "."
    tmp_name: str = ""
    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix=".resource-kernel-", suffix=".tmp", dir=directory
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(snapshot, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
        except BaseException:
            # fdopen 失败时 fd 仍需关闭；正常路径下 with 已处理。
            try:
                os.close(fd)
            except OSError:
                pass
            raise
        os.replace(tmp_name, path)
    except OSError as exc:
        if tmp_name and os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
        raise PersistenceError(f"failed to write snapshot to '{path}': {exc}") from None


def import_from_file(kernel: ResourceKernel, path: str) -> Dict[str, Any]:
    """从 JSON 文件读取快照并载入内核。

    任何环节（文件不存在、JSON 损坏、字段缺失、自洽性校验失败）都抛出
    :class:`PersistenceError`；内核在 :meth:`ResourceKernel.load_snapshot`
    中先构建完整新状态再提交，故失败时内存状态保持不变。

    :returns: 解析出的原始快照字典。
    """
    try:
        with open(path, "r", encoding="utf-8") as handle:
            text = handle.read()
    except OSError as exc:
        raise PersistenceError(
            f"failed to read snapshot from '{path}': {exc}"
        ) from None

    try:
        snapshot = json.loads(text)
    except json.JSONDecodeError as exc:
        raise PersistenceError(
            f"snapshot file '{path}' is not valid JSON: {exc.msg} "
            f"(line {exc.lineno}, column {exc.colno})"
        ) from None

    if not isinstance(snapshot, dict):
        raise PersistenceError(
            f"snapshot file '{path}' must contain a JSON object at top level"
        )

    try:
        kernel.load_snapshot(snapshot)
    except (ValueError, TypeError) as exc:
        raise PersistenceError(f"invalid snapshot in '{path}': {exc}") from None
    return snapshot
