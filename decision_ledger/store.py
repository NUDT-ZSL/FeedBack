"""JSON 文件持久化。

台账整体保存为单个 UTF-8 JSON 文件，先写临时文件再原子替换，
避免写入中途中断损坏台账。完全离线，无外部依赖。
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Union

from .engine import Ledger


def save(ledger: Ledger, path: Union[str, os.PathLike]) -> Path:
    """把台账保存到 path，返回最终路径。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(ledger.to_dict(), ensure_ascii=False, indent=2, sort_keys=False)
    # 同目录临时文件 + os.replace 保证原子落盘。
    fd, tmp_name = tempfile.mkstemp(
        prefix=target.name + ".", suffix=".tmp", dir=str(target.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp_name, target)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return target


def load(path: Union[str, os.PathLike]) -> Ledger:
    """从 JSON 文件加载台账；文件不存在则抛 FileNotFoundError。"""
    target = Path(path)
    with target.open("r", encoding="utf-8") as fh:
        data = json.load(fh)
    return Ledger.from_dict(data)


def load_or_create(path: Union[str, os.PathLike]) -> Ledger:
    """文件存在则加载，否则返回一个空台账（不立即落盘）。"""
    target = Path(path)
    if target.exists():
        return load(target)
    return Ledger()
