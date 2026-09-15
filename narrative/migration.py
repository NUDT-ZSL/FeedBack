"""存档跨版本迁移：格式版本迁移链 + 内容演进规则。

- 格式迁移：MIGRATIONS 中登记 (源版本 -> 目标版本) 的纯函数，migrate_save 沿链逐步执行。
- 内容演进（缺变量补默认值、缺失节点标记不可用、进度与分支归属保持不变）
  在 Engine.load 中完成，见 engine.py。
"""
from __future__ import annotations

import copy
from typing import Any, Callable, Dict, List, Tuple

from .engine import SAVE_FORMAT_VERSION
from .model import ValidationError

MigrationFn = Callable[[Dict[str, Any]], Dict[str, Any]]

MIGRATIONS: Dict[Tuple[int, int], MigrationFn] = {}


def register(from_version: int, to_version: int):
    def deco(fn: MigrationFn) -> MigrationFn:
        MIGRATIONS[(from_version, to_version)] = fn
        return fn
    return deco


def migrate_save(data: Dict[str, Any],
                 target_version: int = SAVE_FORMAT_VERSION) -> Dict[str, Any]:
    """沿迁移链把旧格式存档升级到目标版本。不修改入参。"""
    data = copy.deepcopy(data)
    version = data.get("format_version")
    if version is None:
        raise ValidationError("存档缺少 format_version 字段")
    if version > target_version:
        raise ValidationError(f"存档版本 {version} 高于目标版本 {target_version}，无法降级")
    path: List[int] = [version]
    while version < target_version:
        step = MIGRATIONS.get((version, version + 1))
        if step is None:
            raise ValidationError(f"缺少 {version} -> {version + 1} 的迁移规则")
        data = step(data)
        version += 1
        data["format_version"] = version
        path.append(version)
    data.setdefault("migration_notes", [])
    if len(path) > 1:
        data["migration_notes"].append(
            "格式迁移链: " + " -> ".join(f"v{v}" for v in path)
        )
    return data


# ---- 内置迁移规则 ----

@register(1, 2)
def _migrate_v1_to_v2(data: Dict[str, Any]) -> Dict[str, Any]:
    """v1 -> v2：v1 没有 history/unavailable_nodes/migration_notes 字段，补空结构；
    unlocked 由单值 current 列表（若存在）兼容为列表。"""
    data.setdefault("history", [])
    data.setdefault("unavailable_nodes", [])
    data.setdefault("migration_notes", [])
    data.setdefault("conflicts", [])
    data.setdefault("change_log", [])
    data.setdefault("branch_trail", [])
    if not isinstance(data.get("unlocked"), list):
        data["unlocked"] = sorted(data.get("unlocked") or [])
    return data
