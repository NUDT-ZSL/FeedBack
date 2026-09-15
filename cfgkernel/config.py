"""配置值对象与字段溯源（provenance）。

:class:`Config` 是一份“扁平”配置：

- ``values`` ：当前 schema 版本下所有已知字段的最终取值（点分路径 -> 值）；
- ``sources``：每个字段一条 :class:`FieldSource`，记录它的来源版本与状态
  （显式设置 / 默认补齐 / 重命名继承 / 忽略 / 降级 / 废弃）；
- ``extras`` ：老设备读新配置等场景下出现的、当前版本不认识或被设备能力
  拒绝的字段。它们的**原始值原样保留**——既用于“明确标记为忽略”，也
  保证重新落盘 / 回滚时一个字节都不丢，绝不静默丢弃。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .version import Version

# 字段状态
ST_SET = "set"                # 用户显式提供
ST_DEFAULT = "default"        # 演进过程中按默认值补齐
ST_RENAMED = "renamed"        # 由重命名 / 废弃迁移而来
ST_IGNORED = "ignored"        # 设备不支持或版本不认识：已忽略（值保存在 extras）
ST_DEGRADED = "degraded"      # 无法完整表示：已按策略降级（夹取 / 兜底值）
ST_DEPRECATED = "deprecated"  # 字段已到废弃版本但值仍存在
ST_ARCHIVED = "archived"      # 字段在迁移中被显式移除，值归档保留

# extras 中的忽略原因
R_UNKNOWN = "unknown_field"          # 老设备 / 老版本不认识的新字段
R_CAPABILITY = "capability_missing"  # 设备缺少字段所需能力
R_DROPPED = "field_dropped"          # 迁移到新版本后字段被移除
R_UNSUPPORTED_VALUE = "unsupported_value"  # 值无法在目标上表示（且未降级）


@dataclass
class FieldSource:
    """单个字段的来源与状态说明。"""

    path: str
    status: str
    origin_version: Version          # 值最初进入配置时的版本
    reason: str = ""                 # 忽略 / 降级等情况的人类可读说明
    renamed_from: Optional[str] = None
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "path": self.path,
            "status": self.status,
            "origin_version": self.origin_version.to_json(),
            "reason": self.reason,
            "renamed_from": self.renamed_from,
            "detail": self.detail,
        }

    @classmethod
    def from_json(cls, data: dict) -> "FieldSource":
        return cls(
            path=data["path"],
            status=data["status"],
            origin_version=Version(data["origin_version"]),
            reason=data.get("reason", ""),
            renamed_from=data.get("renamed_from"),
            detail=data.get("detail", {}),
        )


@dataclass
class IgnoredField:
    """extras 中一个被忽略 / 归档字段的记录（原始值保真）。"""

    path: str
    value: Any
    reason: str
    seen_version: Version            # 在哪个版本的解析中发现它
    origin_version: Version          # 该值最初来自哪个版本
    detail: Dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "path": self.path,
            "value": self.value,
            "reason": self.reason,
            "seen_version": self.seen_version.to_json(),
            "origin_version": self.origin_version.to_json(),
            "detail": self.detail,
        }

    @classmethod
    def from_json(cls, data: dict) -> "IgnoredField":
        return cls(
            path=data["path"],
            value=data["value"],
            reason=data["reason"],
            seen_version=Version(data["seen_version"]),
            origin_version=Version(data["origin_version"]),
            detail=data.get("detail", {}),
        )


def flatten(raw: Dict[str, Any], prefix: str = "") -> Dict[str, Any]:
    """把嵌套 dict 摊平成点分路径；非 dict 值或列表视为叶子。

    列表保持整体作为叶子（列表元素类型由 schema 约束），不展开下标。
    """
    out: Dict[str, Any] = {}
    for key in sorted(raw):
        value = raw[key]
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            out.update(flatten(value, path))
        else:
            out[path] = value
    return out


class Config:
    """一份带完整溯源信息的配置。"""

    def __init__(
        self,
        schema_version: "str | Version",
        name: str = "",
        model_name: Optional[str] = None,
        firmware: Optional["str | Version"] = None,
    ) -> None:
        self.schema_version = Version(schema_version)
        self.name = name
        # 若该配置是 apply() 到具体设备后得到的，记录型号与固件
        self.model_name = model_name
        self.firmware = Version(firmware) if firmware is not None else None
        self.values: Dict[str, Any] = {}
        self.sources: Dict[str, FieldSource] = {}
        self.extras: Dict[str, IgnoredField] = {}

    # -- 基本访问 -----------------------------------------------------------

    def get(self, path: str) -> Any:
        return self.values.get(path)

    def source_of(self, path: str) -> Optional[FieldSource]:
        return self.sources.get(path)

    def ignored(self) -> List[IgnoredField]:
        """按路径稳定排序的忽略 / 归档字段列表。"""
        return [self.extras[p] for p in sorted(self.extras)]

    def is_ignored(self, path: str) -> bool:
        src = self.sources.get(path)
        return src is not None and src.status == ST_IGNORED

    def is_degraded(self, path: str) -> bool:
        src = self.sources.get(path)
        return src is not None and src.status == ST_DEGRADED

    # -- 内部写入（引擎使用） -----------------------------------------------

    def set_value(
        self,
        path: str,
        value: Any,
        status: str,
        origin: "str | Version",
        reason: str = "",
        renamed_from: Optional[str] = None,
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        self.values[path] = value
        self.sources[path] = FieldSource(
            path=path,
            status=status,
            origin_version=Version(origin),
            reason=reason,
            renamed_from=renamed_from,
            detail=detail or {},
        )

    def move_to_extra(
        self,
        path: str,
        reason: str,
        seen_version: "str | Version",
        origin: Optional["str | Version"] = None,
        detail: Optional[Dict[str, Any]] = None,
    ) -> None:
        """把字段从活动值移到 extras（值保真），并清除其活动来源。"""
        if path in self.values:
            value = self.values[path]
            src = self.sources.get(path)
            origin_ver = Version(origin) if origin else (
                src.origin_version if src else self.schema_version
            )
            self.extras[path] = IgnoredField(
                path=path,
                value=value,
                reason=reason,
                seen_version=Version(seen_version),
                origin_version=origin_ver,
                detail=detail or {},
            )
            del self.values[path]
            self.sources.pop(path, None)

    def put_extra(self, entry: IgnoredField) -> None:
        self.extras[entry.path] = entry

    def remove(self, path: str) -> None:
        self.values.pop(path, None)
        self.sources.pop(path, None)

    # -- 快照（迁移回滚用） --------------------------------------------------

    def snapshot(self) -> dict:
        import copy

        return {
            "schema_version": self.schema_version,
            "name": self.name,
            "model_name": self.model_name,
            "firmware": self.firmware,
            "values": copy.deepcopy(self.values),
            "sources": copy.deepcopy(self.sources),
            "extras": copy.deepcopy(self.extras),
        }

    def restore(self, snap: dict) -> None:
        import copy

        self.schema_version = snap["schema_version"]
        self.name = snap.get("name", "")
        self.model_name = snap.get("model_name")
        fw = snap.get("firmware")
        self.firmware = fw if isinstance(fw, Version) or fw is None else Version(fw)
        self.values = copy.deepcopy(snap["values"])
        self.sources = copy.deepcopy(snap["sources"])
        self.extras = copy.deepcopy(snap["extras"])

    # -- 序列化 -------------------------------------------------------------

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "schema_version": self.schema_version.to_json(),
            "model_name": self.model_name,
            "firmware": self.firmware.to_json() if self.firmware else None,
            "values": {k: self.values[k] for k in sorted(self.values)},
            "sources": [self.sources[k].to_json() for k in sorted(self.sources)],
            "extras": [self.extras[k].to_json() for k in sorted(self.extras)],
        }

    @classmethod
    def from_json(cls, data: dict) -> "Config":
        cfg = cls(
            data["schema_version"],
            name=data.get("name", ""),
            model_name=data.get("model_name"),
            firmware=data.get("firmware"),
        )
        cfg.values = dict(data.get("values", {}))
        cfg.sources = {
            s["path"]: FieldSource.from_json(s) for s in data.get("sources", [])
        }
        cfg.extras = {
            e["path"]: IgnoredField.from_json(e) for e in data.get("extras", [])
        }
        return cfg
