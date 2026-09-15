"""声明式迁移操作与迁移记录。

一条迁移边 ``from_version -> to_version`` 由若干操作组成，操作全部是纯数据
（可 JSON 序列化、可重复执行、无时间与随机因素），因此任意一份配置沿同一
演进链迁移的结果完全可复现。

支持的操作：

``rename``   老字段重命名为新字段（保留原值与来源版本）
``set``      写入固定值（通常配合重命名做单位换算等确定性变换）
``map_enum`` 枚举值映射 {老值: 新值}，未命中按字段策略报错或降级
``cast``     显式类型转换（类型发生变化时引擎也会自动尝试安全转换）
``drop``     显式弃用字段（值归档进 extras，不丢失）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .config import FieldSource, IgnoredField
from .version import Version

OP_RENAME = "rename"
OP_SET = "set"
OP_MAP_ENUM = "map_enum"
OP_CAST = "cast"
OP_DROP = "drop"

OP_TYPES = frozenset({OP_RENAME, OP_SET, OP_MAP_ENUM, OP_CAST, OP_DROP})


@dataclass(frozen=True)
class MigrationOp:
    kind: str
    args: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {"kind": self.kind, "args": self.args}

    @classmethod
    def from_json(cls, data: dict) -> "MigrationOp":
        kind = data["kind"]
        if kind not in OP_TYPES:
            raise ValueError(f"未知迁移操作类型 {kind!r}")
        return cls(kind=kind, args=dict(data.get("args", {})))

    # -- 便于链式构造 -------------------------------------------------------

    @staticmethod
    def rename(old: str, new: str) -> "MigrationOp":
        return MigrationOp(OP_RENAME, {"old": old, "new": new})

    @staticmethod
    def set_value(path: str, value: Any) -> "MigrationOp":
        return MigrationOp(OP_SET, {"path": path, "value": value})

    @staticmethod
    def map_enum(path: str, mapping: Dict[str, str]) -> "MigrationOp":
        return MigrationOp(OP_MAP_ENUM, {"path": path, "mapping": dict(mapping)})

    @staticmethod
    def cast(path: str, to_type: str) -> "MigrationOp":
        return MigrationOp(OP_CAST, {"path": path, "to_type": to_type})

    @staticmethod
    def drop(path: str) -> "MigrationOp":
        return MigrationOp(OP_DROP, {"path": path})


class MigrationStep:
    """演进链上的一条边。"""

    def __init__(
        self,
        from_version: "str | Version",
        to_version: "str | Version",
        ops: Optional[List[MigrationOp]] = None,
    ) -> None:
        self.from_version = Version(from_version)
        self.to_version = Version(to_version)
        if self.from_version >= self.to_version:
            raise ValueError(
                f"迁移边必须从低版本到高版本：{self.from_version} -> {self.to_version}"
            )
        self.ops: List[MigrationOp] = list(ops or [])

    @property
    def edge(self) -> Tuple[Version, Version]:
        return (self.from_version, self.to_version)

    def label(self) -> str:
        return f"{self.from_version} -> {self.to_version}"

    def to_json(self) -> dict:
        return {
            "from_version": self.from_version.to_json(),
            "to_version": self.to_version.to_json(),
            "ops": [op.to_json() for op in self.ops],
        }

    @classmethod
    def from_json(cls, data: dict) -> "MigrationStep":
        return cls(
            data["from_version"],
            data["to_version"],
            [MigrationOp.from_json(o) for o in data.get("ops", [])],
        )


@dataclass
class FieldChangeRecord:
    """迁移中单个字段发生变化的留痕（用于迁移记录 / 差异比对）。"""

    path: str
    old_value: Any
    new_value: Any
    status_before: str
    status_after: str
    note: str = ""

    def to_json(self) -> dict:
        return {
            "path": self.path,
            "old_value": self.old_value,
            "new_value": self.new_value,
            "status_before": self.status_before,
            "status_after": self.status_after,
            "note": self.note,
        }

    @classmethod
    def from_json(cls, data: dict) -> "FieldChangeRecord":
        return cls(**data)


@dataclass
class StepRecord:
    edge: str
    ops: List[dict]
    changes: List[FieldChangeRecord]

    def to_json(self) -> dict:
        return {
            "edge": self.edge,
            "ops": self.ops,
            "changes": [c.to_json() for c in self.changes],
        }

    @classmethod
    def from_json(cls, data: dict) -> "StepRecord":
        return cls(
            edge=data["edge"],
            ops=list(data.get("ops", [])),
            changes=[FieldChangeRecord.from_json(c) for c in data.get("changes", [])],
        )


class MigrationRecord:
    """一次迁移的完整记录，含迁移前快照，可据此回滚。

    记录 id 由输入内容的哈希派生（而非时间戳），同一输入重复迁移得到同一 id，
    保证可复现；调用方也可以显式指定 id。
    """

    def __init__(
        self,
        record_id: str,
        config_name: str,
        from_version: Version,
        to_version: Version,
        steps: List[StepRecord],
        before_snapshot: dict,
    ) -> None:
        self.id = record_id
        self.config_name = config_name
        self.from_version = from_version
        self.to_version = to_version
        self.steps = steps
        self.before_snapshot = before_snapshot
        self.after_snapshot: Optional[dict] = None
        self.rolled_back = False

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "config_name": self.config_name,
            "from_version": self.from_version.to_json(),
            "to_version": self.to_version.to_json(),
            "steps": [s.to_json() for s in self.steps],
            "before_snapshot": _snapshot_to_json(self.before_snapshot),
            "after_snapshot": (
                _snapshot_to_json(self.after_snapshot)
                if self.after_snapshot is not None else None
            ),
            "rolled_back": self.rolled_back,
        }

    @classmethod
    def from_json(cls, data: dict) -> "MigrationRecord":
        rec = cls(
            record_id=data["id"],
            config_name=data["config_name"],
            from_version=Version(data["from_version"]),
            to_version=Version(data["to_version"]),
            steps=[StepRecord.from_json(s) for s in data.get("steps", [])],
            before_snapshot=_snapshot_from_json(data["before_snapshot"]),
        )
        if data.get("after_snapshot"):
            rec.after_snapshot = _snapshot_from_json(data["after_snapshot"])
        rec.rolled_back = bool(data.get("rolled_back", False))
        return rec


@dataclass
class RollbackRecord:
    """一次回滚的留痕。"""

    id: str
    migration_id: str
    config_name: str
    restored_to: Version

    def to_json(self) -> dict:
        return {
            "id": self.id,
            "migration_id": self.migration_id,
            "config_name": self.config_name,
            "restored_to": self.restored_to.to_json(),
        }

    @classmethod
    def from_json(cls, data: dict) -> "RollbackRecord":
        return cls(
            id=data["id"],
            migration_id=data["migration_id"],
            config_name=data["config_name"],
            restored_to=Version(data["restored_to"]),
        )


def _snapshot_to_json(snap: dict) -> dict:
    firmware = snap.get("firmware")
    return {
        "schema_version": snap["schema_version"].to_json(),
        "name": snap.get("name", ""),
        "model_name": snap.get("model_name"),
        "firmware": firmware.to_json() if isinstance(firmware, Version) else firmware,
        "values": snap["values"],
        "sources": [s.to_json() for s in snap["sources"].values()],
        "extras": [e.to_json() for e in snap["extras"].values()],
    }


def _snapshot_from_json(data: dict) -> dict:
    values = dict(data["values"])
    sources = {s["path"]: FieldSource.from_json(s) for s in data["sources"]}
    extras = {e["path"]: IgnoredField.from_json(e) for e in data["extras"]}
    return {
        "schema_version": Version(data["schema_version"]),
        "name": data.get("name", ""),
        "model_name": data.get("model_name"),
        "firmware": Version(data["firmware"]) if data.get("firmware") else None,
        "values": values,
        "sources": sources,
        "extras": extras,
    }
