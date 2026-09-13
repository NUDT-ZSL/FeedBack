"""补丁的 JSON 持久化与读回校验。

保存文件包含：补丁指令、旧/新整文件指纹、分块配置、统计信息以及
指令序列的紧凑二进制编码（base64）。读回时严格校验结构、指令类型、
COPY 范围、ADD 数据、指纹格式与统计一致性；文件损坏、字段缺失或
被截断都会抛出带明确信息的 :class:`cdiff.CorruptPatchError`，
不会静默吞掉任何异常。
"""

from __future__ import annotations

import base64
import json
import os

from .delta import Delta
from .errors import CorruptPatchError

#: 持久化文件格式。
DOC_FORMAT = "cdiff-patch"
DOC_VERSION = 1


def save_delta(path: os.PathLike | str, delta: Delta) -> None:
    """把补丁及指纹、配置、统计写入一个 JSON 文件。

    :param path: 目标路径（已存在会被覆盖）。
    :param delta: 要保存的补丁。
    """
    if not isinstance(delta, Delta):
        raise TypeError("save_delta expects a Delta object")
    doc = {
        "format": DOC_FORMAT,
        "version": DOC_VERSION,
        "old_fingerprint": delta.old_fingerprint.to_dict(),
        "new_fingerprint": delta.new_fingerprint.to_dict(),
        "config": delta.config.to_dict(),
        "ops": [op.to_dict() for op in delta.ops],
        "ops_binary_b64": base64.b64encode(delta.encode()).decode("ascii"),
        "stats": delta.stats(),
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")


def load_delta(path: os.PathLike | str) -> Delta:
    """从 JSON 文件重建补丁并全面校验一致性。

    :raises CorruptPatchError: 文件无法读取、不是合法 JSON、字段缺失、
        指纹/指令格式非法、二进制快照与指令列表不符等。
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        raise CorruptPatchError("cannot read patch file %r: %s" % (str(path), exc)) from exc

    try:
        doc = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CorruptPatchError(
            "patch file %r is not valid JSON: %s" % (str(path), exc.msg)
        ) from exc

    return delta_from_dict(doc)


def delta_to_dict(delta: Delta) -> dict:
    """返回可直接 ``json.dumps`` 的补丁文档字典。"""
    return {
        "format": DOC_FORMAT,
        "version": DOC_VERSION,
        "old_fingerprint": delta.old_fingerprint.to_dict(),
        "new_fingerprint": delta.new_fingerprint.to_dict(),
        "config": delta.config.to_dict(),
        "ops": [op.to_dict() for op in delta.ops],
        "ops_binary_b64": base64.b64encode(delta.encode()).decode("ascii"),
        "stats": delta.stats(),
    }


def delta_from_dict(doc: object) -> Delta:
    """从已解析的 JSON 文档重建补丁并校验。

    除 :meth:`Delta.from_dict` 的全部校验外，还会校验

    - 顶层 ``format`` / ``version``；
    - ``ops_binary_b64`` 可解码、解出的指令与 ``ops`` 列表逐条一致
      （防止文件被局部篡改或截断）。
    """
    if not isinstance(doc, dict):
        raise CorruptPatchError("patch document must be a JSON object")
    if doc.get("format") != DOC_FORMAT:
        raise CorruptPatchError(
            "not a cdiff patch file (format=%r)" % doc.get("format")
        )
    version = doc.get("version")
    if not isinstance(version, int) or version != DOC_VERSION:
        raise CorruptPatchError("unsupported patch version: %r" % (version,))
    for field_name in ("ops", "old_fingerprint", "new_fingerprint", "config"):
        if field_name not in doc:
            raise CorruptPatchError("missing field in patch document: %s" % field_name)

    delta = Delta.from_dict(doc)

    blob_b64 = doc.get("ops_binary_b64")
    if blob_b64 is None:
        raise CorruptPatchError("missing ops_binary_b64 snapshot")
    if not isinstance(blob_b64, str):
        raise CorruptPatchError("ops_binary_b64 must be a string")
    try:
        blob = base64.b64decode(blob_b64, validate=True)
    except ValueError as exc:
        raise CorruptPatchError("ops_binary_b64 is not valid base64: %s" % exc) from exc

    try:
        decoded = Delta.decode_ops(blob)
    except CorruptPatchError:
        raise
    if len(decoded) != len(delta.ops):
        raise CorruptPatchError(
            "binary snapshot has %d ops but ops list has %d"
            % (len(decoded), len(delta.ops))
        )
    for i, (a, b) in enumerate(zip(decoded, delta.ops)):
        if type(a) is not type(b):
            raise CorruptPatchError("op %d type mismatch between snapshot and list" % i)
        if a != b:
            raise CorruptPatchError("op %d differs between snapshot and list" % i)

    return delta
