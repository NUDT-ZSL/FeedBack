"""单文件持久化：JSON 信封 + sha256 校验和 + 原子写入。

文件布局：

    {
      "format": "experience-graph",
      "version": 1,
      "payload": { ...图谱数据... },
      "checksum": "<sha256(canonical(payload))>"
    }

载入时先校验信封与校验和，再做严格的结构校验；任一步失败都抛
:class:`CorruptSnapshot`，且载入目标对象不会被改动（先在临时对象上构建，
成功后才返回）。
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from typing import Optional

from .errors import CorruptSnapshot
from .graph import ExperienceGraph

FORMAT = "experience-graph"
ENVELOPE_VERSION = 1


def _canonical(payload: dict) -> bytes:
    return json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _checksum(payload: dict) -> str:
    return hashlib.sha256(_canonical(payload)).hexdigest()


def save(graph: ExperienceGraph, path: str) -> None:
    """原子写入：先写同目录临时文件并 fsync，再 os.replace 覆盖目标。"""
    payload = graph.to_dict()
    envelope = {
        "format": FORMAT,
        "version": ENVELOPE_VERSION,
        "payload": payload,
        "checksum": _checksum(payload),
    }
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(prefix=".eg-", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(envelope, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load(path: str, into: Optional[ExperienceGraph] = None) -> ExperienceGraph:
    """载入快照。

    任何损坏 / 字段缺失 / 校验和不符都抛 :class:`CorruptSnapshot`；
    当传入 ``into`` 时，仅在完全成功后才整体替换其状态，失败后状态不变。
    """
    try:
        with open(path, "r", encoding="utf-8") as fh:
            raw = fh.read()
    except OSError as exc:
        raise CorruptSnapshot(f"无法读取快照文件 {path!r}：{exc}") from exc

    try:
        envelope = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CorruptSnapshot(f"快照不是合法 JSON（{path}）：{exc}") from exc

    if not isinstance(envelope, dict):
        raise CorruptSnapshot("快照损坏：顶层结构必须是对象")
    for key in ("format", "version", "payload", "checksum"):
        if key not in envelope:
            raise CorruptSnapshot(f"快照损坏：缺少顶层字段 {key!r}")
    if envelope["format"] != FORMAT:
        raise CorruptSnapshot(f"快照格式不符：{envelope['format']!r}")
    if envelope["version"] != ENVELOPE_VERSION:
        raise CorruptSnapshot(f"不支持的信封版本：{envelope['version']}")

    payload = envelope["payload"]
    if not isinstance(payload, dict):
        raise CorruptSnapshot("快照损坏：payload 必须是对象")
    expected = _checksum(payload)
    if not isinstance(envelope["checksum"], str) or envelope["checksum"] != expected:
        raise CorruptSnapshot("快照校验和不符：文件可能已损坏或被篡改")

    # 结构校验在全新对象上进行；只有成功才提交给调用方。
    rebuilt = ExperienceGraph.from_dict(payload)
    if into is not None:
        into.__dict__.update(rebuilt.__dict__)
        return into
    return rebuilt
