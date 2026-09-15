"""设备能力与型号。

- :class:`Capability`：一项能力（如 ``wifi``、``ble_mesh``）的生命周期——
  在哪个固件版本引入、（可选）哪个版本废弃 / 移除。能力名全局唯一，
  字段规则通过 ``required_capability`` 引用。
- :class:`DeviceModel`：一个设备型号，登记其发布过的固件版本链，以及
  “哪些能力从哪个版本开始支持”。同一型号同一版本重复登记会被拒绝。

能力支持判定：

    introduced <= fw < deprecated         支持
    fw >= deprecated（若设置）            不支持（能力已下线）
    fw < introduced                       不支持（尚未引入）
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from .errors import RegistrationError
from .version import Version

_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_\-]{0,63}$")
_PATH_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$")


def validate_name(name: str, kind: str) -> None:
    if not isinstance(name, str) or not name:
        raise RegistrationError(f"{kind}名称不能为空，实际为 {name!r}")
    if not _NAME_RE.match(name):
        raise RegistrationError(
            f"{kind}名称 {name!r} 非法：须以字母开头，仅含字母、数字、'_'、'-'，"
            "长度不超过 64"
        )


def validate_field_path(path: str) -> None:
    if not isinstance(path, str) or not path:
        raise RegistrationError(f"字段路径不能为空，实际为 {path!r}")
    if not _PATH_RE.match(path):
        raise RegistrationError(
            f"字段路径 {path!r} 非法：须为点分标识符，如 'net.wifi.power'，"
            "每段以字母或下划线开头"
        )


@dataclass(frozen=True)
class Capability:
    """能力定义（全局）。"""

    name: str
    introduced: Version
    deprecated: Optional[Version] = None  # 该版本起能力被移除/下线

    def supported_at(self, fw: Version) -> bool:
        if fw < self.introduced:
            return False
        if self.deprecated is not None and fw >= self.deprecated:
            return False
        return True

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "introduced": self.introduced.to_json(),
            "deprecated": self.deprecated.to_json() if self.deprecated else None,
        }

    @classmethod
    def from_json(cls, data: dict) -> "Capability":
        return cls(
            name=data["name"],
            introduced=Version(data["introduced"]),
            deprecated=Version(data["deprecated"]) if data.get("deprecated") else None,
        )


@dataclass(frozen=True)
class ModelSupport:
    """型号在某固件版本上对一项能力的支持声明。"""

    capability: str
    since: Version  # 型号从该固件起具备该能力（不得早于能力自身的引入版本）

    def to_json(self) -> dict:
        return {"capability": self.capability, "since": self.since.to_json()}

    @classmethod
    def from_json(cls, data: dict) -> "ModelSupport":
        return cls(capability=data["capability"], since=Version(data["since"]))


class DeviceModel:
    """一个设备型号及其固件版本链、能力支持矩阵。"""

    def __init__(self, name: str) -> None:
        validate_name(name, "型号")
        self.name = name
        self._firmwares: Dict[Version, None] = {}
        # capability -> ModelSupport
        self._supports: Dict[str, ModelSupport] = {}

    # -- 登记 ---------------------------------------------------------------

    def register_firmware(self, fw: "str | Version") -> Version:
        fw = Version(fw)
        if fw in self._firmwares:
            raise RegistrationError(
                f"型号 '{self.name}' 的固件版本 {fw} 重复登记"
            )
        self._firmwares[fw] = None
        return fw

    def register_support(
        self,
        capability: str,
        since: "str | Version",
        capabilities: Dict[str, Capability],
    ) -> None:
        validate_name(capability, "能力")
        since = Version(since)
        if capability not in capabilities:
            raise RegistrationError(
                f"型号 '{self.name}' 引用了未登记的能力 '{capability}'，"
                "请先注册能力再声明型号支持"
            )
        cap = capabilities[capability]
        if since < cap.introduced:
            raise RegistrationError(
                f"型号 '{self.name}' 声明自 {since} 起支持能力 '{capability}'，"
                f"但该能力直到 {cap.introduced} 才引入"
            )
        if cap.deprecated is not None and since >= cap.deprecated:
            raise RegistrationError(
                f"型号 '{self.name}' 声明自 {since} 起支持能力 '{capability}'，"
                f"但该能力已在 {cap.deprecated} 下线"
            )
        if since not in self._firmwares:
            raise RegistrationError(
                f"型号 '{self.name}' 尚未登记固件版本 {since}，"
                "无法在该版本上声明能力支持"
            )
        if capability in self._supports:
            raise RegistrationError(
                f"型号 '{self.name}' 对能力 '{capability}' 的支持重复声明"
            )
        self._supports[capability] = ModelSupport(capability, since)

    # -- 查询 ---------------------------------------------------------------

    def firmwares(self) -> List[Version]:
        return sorted(self._firmwares)

    def has_firmware(self, fw: Version) -> bool:
        return fw in self._firmwares

    def supported_capabilities(self, fw: Version) -> List[str]:
        """该型号在指定固件上实际可用的能力名（按名称排序，顺序稳定）。"""
        result = [
            name
            for name, support in self._supports.items()
            if support.since <= fw
        ]
        return sorted(result)

    def supports(self, capability: str, fw: Version) -> bool:
        support = self._supports.get(capability)
        if support is None or fw < support.since:
            return False
        return True

    def since_version(self, capability: str) -> Optional[Version]:
        support = self._supports.get(capability)
        return support.since if support else None

    # -- 序列化 -------------------------------------------------------------

    def to_json(self) -> dict:
        return {
            "name": self.name,
            "firmwares": [v.to_json() for v in sorted(self._firmwares)],
            "supports": [self._supports[k].to_json() for k in sorted(self._supports)],
        }

    @classmethod
    def from_json(cls, data: dict, capabilities: Dict[str, Capability]) -> "DeviceModel":
        model = cls(data["name"])
        for fw in data.get("firmwares", []):
            model.register_firmware(fw)
        for sup in data.get("supports", []):
            model.register_support(
                sup["capability"], Version(sup["since"]), capabilities
            )
        return model
