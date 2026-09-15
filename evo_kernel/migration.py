"""版本间迁移。

迁移沿版本链**逐版本**进行，每一步都经过同一个解析器：

1. 先按“源版本”规则解析当前数据（校验不变量、补齐默认值）；
2. 应用目标版本登记的 :class:`~evo_kernel.versions.Transform`
   （改名、枚举映射、嵌套重排等自定义演进）；
3. 再按“目标版本”规则解析——因此每一步的产物都等于“直接按目标版本
   解析”的结果，类型 / 必填 / 枚举错误会在这一步暴露。

失败语义：:func:`migrate` 不修改输入数据（内部深拷贝），任一步失败都
抛出 :class:`MigrationError` 并给出失败的步骤位置；Kernel 层负责把
已存储记录恢复到迁移前快照（见 :mod:`evo_kernel.kernel`）。

整个过程只依赖输入数据与版本规则（transform 也是确定性纯函数），
同一份数据迁移两次得到逐字节一致的结果，可复现。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

from .errors import MigrationError, ParseError
from .parser import parse
from .paths import canonical_bytes, rule_path
from .versions import VersionRegistry, _index


@dataclass
class MigrationStep:
    """链上一个版本到相邻版本的单步迁移记录。"""

    from_version: str
    to_version: str
    fields_added: List[str]
    fields_removed: List[str]
    defaults_applied: List[str]
    transform_applied: Optional[str]  # transform 的人类可读描述；无则 None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "from_version": self.from_version,
            "to_version": self.to_version,
            "fields_added": list(self.fields_added),
            "fields_removed": list(self.fields_removed),
            "defaults_applied": list(self.defaults_applied),
            "transform_applied": self.transform_applied,
        }


@dataclass
class MigrationResult:
    """一次完整迁移的结果与审计信息。"""

    source_version: str
    target_version: str
    path: List[str]
    steps: List[MigrationStep]
    data: Dict[str, Any]
    unknown: Dict[str, Any]
    consistent_with_direct_parse: bool

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_version": self.source_version,
            "target_version": self.target_version,
            "path": list(self.path),
            "steps": [s.to_dict() for s in self.steps],
            "data": copy.deepcopy(self.data),
            "unknown": copy.deepcopy(self.unknown),
            "consistent_with_direct_parse": self.consistent_with_direct_parse,
        }


def _rule_pathset(registry: VersionRegistry, version_id: str) -> Tuple[set, Dict[str, Any]]:
    version = registry.get(version_id)
    index = _index(version.fields)
    return {rule_path(p) for p in index}, index


def migrate(
    registry: VersionRegistry,
    source_version: str,
    target_version: str,
    raw: Any,
) -> MigrationResult:
    """把 ``raw`` 从 ``source_version`` 迁移到 ``target_version``。

    :raises MigrationError: 源/目标版本无效、跨链、降级或任一步校验失败。
    """
    path = registry.common_chain(source_version, target_version)  # 含两端
    # 只支持沿演进链向前迁移；transform 描述的是“新版本如何由父版本产生”，
    # 反向应用没有定义，回滚请使用 Kernel.revert_migration（基于迁移前快照）。
    if source_version != target_version and source_version not in registry.chain(target_version):
        raise MigrationError(
            f"不支持从 {source_version!r} 降级迁移到 {target_version!r}；"
            "迁移只能沿版本链向前，需要恢复旧数据请使用回滚接口"
        )
    carried_unknown: Dict[str, Any] = {}
    steps: List[MigrationStep] = []
    current: Any = copy.deepcopy(raw)

    if source_version == target_version:
        result = parse(registry.get(source_version), current)
        if not result.ok:
            raise ParseError(source_version, result.errors)
        return MigrationResult(
            source_version=source_version,
            target_version=target_version,
            path=list(path),
            steps=[],
            data=result.data,
            unknown=dict(result.unknown),
            consistent_with_direct_parse=True,
        )

    for i in range(1, len(path)):
        from_id, to_id = path[i - 1], path[i]
        from_v = registry.get(from_id)
        to_v = registry.get(to_id)

        # 1) 按源版本解析：校验当前不变量。
        pre = parse(from_v, current)
        if not pre.ok:
            raise MigrationError(
                f"迁移 {from_id} -> {to_id} 失败：数据不满足源版本 {from_id!r} 的规则，"
                f"首个错误：{pre.errors[0]}"
            )
        carried_unknown = _merge_unknown(carried_unknown, pre.unknown)

        # 2) 应用新版本的自定义 transform。
        intermediate = copy.deepcopy(pre.data)
        transform_desc: Optional[str] = None
        if to_v.transform is not None:
            transform_desc = to_v.transform.description
            try:
                to_v.transform.apply(intermediate)
            except MigrationError:
                raise
            except Exception as exc:  # noqa: BLE001 - transform 可能抛任意异常
                raise MigrationError(
                    f"迁移 {from_id} -> {to_id} 失败：transform "
                    f"{to_v.transform.description!r} 抛出 {type(exc).__name__}: {exc}"
                ) from exc

        # 3) 按目标版本解析：与“直接按目标版本解析”完全一致。
        post = parse(to_v, intermediate)
        if not post.ok:
            raise MigrationError(
                f"迁移 {from_id} -> {to_id} 失败：transform 产物不满足目标版本 "
                f"{to_id!r} 的规则，首个错误：{post.errors[0]}"
            )

        from_paths, _ = _rule_pathset(registry, from_id)
        to_paths, to_index = _rule_pathset(registry, to_id)
        step = MigrationStep(
            from_version=from_id,
            to_version=to_id,
            fields_added=sorted(to_paths - from_paths),
            fields_removed=sorted(from_paths - to_paths),
            defaults_applied=list(post.defaults_applied),
            transform_applied=transform_desc,
        )
        steps.append(step)

        # 上一步的未知字段若在新版本中有了规则（被 transform 提前写入或
        # 新规则覆盖同名路径），就不再算未知；其余继续携带，绝不丢失。
        carried_unknown = _merge_unknown(carried_unknown, post.unknown)
        carried_unknown = {
            p: v for p, v in carried_unknown.items() if not _now_known(p, to_index)
        }
        current = post.data

    # 4) 复现性自检：最终数据再按目标版本解析一次，必须逐字节一致。
    target_version_obj = registry.get(target_version)
    reparsed = parse(target_version_obj, copy.deepcopy(current))
    if not reparsed.ok:  # pragma: no cover - 理论不可达
        raise MigrationError("迁移完成后的复现性自检失败")
    consistent = canonical_bytes(reparsed.data) == canonical_bytes(current)
    if not consistent:  # pragma: no cover - 理论不可达
        raise MigrationError("迁移结果与直接按目标版本解析不一致")

    return MigrationResult(
        source_version=source_version,
        target_version=target_version,
        path=list(path),
        steps=steps,
        data=current,
        unknown=dict(sorted(carried_unknown.items())),
        consistent_with_direct_parse=True,
    )


def _merge_unknown(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(a)
    for k, v in b.items():
        merged.setdefault(k, v)
    return merged


def _now_known(display_path: str, to_index: Dict[Tuple[str, ...], Any]) -> bool:
    """未知字段路径是否已被新版本规则覆盖（仅判定无数组下标的对象路径）。"""
    if "[" in display_path:
        return False
    parts = tuple(display_path.split("."))
    return parts in to_index
