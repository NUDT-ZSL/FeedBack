"""版本登记：版本标识、父版本、字段规则、演进链与逐版本变换。

版本之间形成**一条无环演进链**：除根版本（``parent=None``）外，每个版本
有且仅有一个父版本；登记新版本时父版本必须已存在，因此不可能成环。
允许存在“多个根”形成的多条链，但 :class:`VersionRegistry` 的迁移 / 差异
接口要求两个版本位于同一条链上（有共同祖先）。

新版本的字段规则是**完整规则**（不依赖父版本），由解析器在登记时校验：

- 默认值必须满足自身规则的类型与枚举约束；
- 新增的必填字段必须给出默认值（否则旧数据永远无法演进到新版本）；
- 标量类型只能沿 ``integer -> number`` 放宽，不能收紧（收紧请在
  :class:`Transform` 中显式完成，并承担失败回滚）；
- object 嵌套变化按子路径同样检查。

逐版本 :class:`Transform` 用来表达无法从默认值自动推出的演进语义：
新增字段默认会自动补默认值、消失字段自动删除，只有自定义逻辑（改名、
枚举映射、嵌套重排等）才需要写 transform。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from .errors import RuleDefinitionError, VersionError
from .paths import rule_path, validate_name
from .rules import FieldRule

#: transform 回调签名：接收“父版本解析并补齐后的完整数据”，原地修改即可。
TransformFn = Callable[[Dict[str, Any]], None]


@dataclass
class Transform:
    """一个版本相对父版本的自定义演进函数。

    :param description: 人类可读说明（会写入迁移记录与文档）。
    :param fn: 回调，接收补齐默认值后的父版本数据副本，可原地修改。
    """

    description: str
    fn: TransformFn

    def apply(self, data: Dict[str, Any]) -> None:
        self.fn(data)


@dataclass
class Version:
    """一个已登记的格式版本。"""

    version_id: str
    parent: Optional[str]
    fields: List[FieldRule]
    description: str = ""
    transform: Optional[Transform] = None
    ordinal: int = 0  # 登记序号，同链深度相同时用于稳定排序

    def field(self, name: str) -> Optional[FieldRule]:
        return next((f for f in self.fields if f.name == name), None)

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "version_id": self.version_id,
            "parent": self.parent,
            "fields": [f.to_dict() for f in self.fields],
            "description": self.description,
        }
        if self.transform is not None:
            out["transform"] = self.transform.description
        return out


def _index(fields: List[FieldRule], prefix: Tuple[str, ...] = ()) -> Dict[Tuple[str, ...], FieldRule]:
    out: Dict[Tuple[str, ...], FieldRule] = {}
    for f in fields:
        key = prefix + (f.name,)
        out[key] = f
        if f.children:
            out.update(_index(f.children, key))
        if f.item is not None:
            item_key = key + ("",)  # tags[] 元素自身
            out[item_key] = f.item
            if f.item.children:
                out.update(_index(f.item.children, item_key))
    return out


#: 允许的跨标量类型变化（其余跨标量变化一律视为不兼容，需要 transform）。
_WIDENING = {("integer", "number")}


def validate_defaults_against_rules(fields: List[FieldRule], location: str) -> None:
    """递归校验所有声明的默认值都满足自身规则（类型、必填、枚举、嵌套）。

    采用与解析器完全相同的判定逻辑。
    """
    from .parser import validate_value

    def walk(rule: FieldRule, path_parts: Tuple[str, ...]) -> None:
        if rule.default is not ...:
            for err in validate_value(rule, rule.default, tuple(path_parts)):
                loc = f"{location}/{rule_path(path_parts)}/default"
                raise RuleDefinitionError(
                    f"默认值不满足字段规则：{err.reason}（期望 {err.expected}）", loc
                )
        for child in rule.children:
            walk(child, path_parts + (child.name,))
        if rule.item is not None:
            walk(rule.item, path_parts + ("",))

    for f in fields:
        walk(f, (f.name,))


class VersionRegistry:
    """保存全部已登记版本，维护版本链与查询能力。"""

    def __init__(self) -> None:
        self._versions: Dict[str, Version] = {}
        self._children: Dict[str, List[str]] = {}
        self._counter = 0

    # ---- 登记 -----------------------------------------------------------

    def register(
        self,
        version_id: str,
        fields: List[Dict[str, Any]] | List[FieldRule],
        parent: Optional[str] = None,
        description: str = "",
        transform: Optional[Transform] = None,
    ) -> Version:
        """登记一个新版本。

        :raises VersionError: id 非法 / 重复、父版本不存在、链不兼容。
        :raises RuleDefinitionError: 字段规则非法、默认值非法、演进不兼容。
        """
        validate_name(version_id, "version_id")
        if version_id in self._versions:
            raise VersionError(f"版本 {version_id!r} 已存在，不能重复登记")
        if parent is not None:
            if not isinstance(parent, str) or parent not in self._versions:
                raise VersionError(
                    f"版本 {version_id!r} 的父版本 {parent!r} 不存在；"
                    "请先登记父版本（版本必须沿演进链顺序登记）"
                )
            if parent == version_id:
                raise VersionError("版本不能以自身为父版本")
            if self._children.get(parent):
                raise VersionError(
                    f"父版本 {parent!r} 已有后继版本 {self._children[parent]!r}；"
                    "版本之间必须形成一条无环演进链，不能分叉"
                )

        rules: List[FieldRule] = []
        for i, raw in enumerate(fields):
            if isinstance(raw, FieldRule):
                rules.append(raw)
            else:
                rules.append(FieldRule.from_dict(raw, f"版本 {version_id}/fields[{i}]"))

        names = [f.name for f in rules]
        if len(set(names)) != len(names):
            dupes = sorted({n for n in names if names.count(n) > 1})
            raise RuleDefinitionError(f"顶层字段名重复: {dupes}", f"版本 {version_id}/fields")

        validate_defaults_against_rules(rules, f"版本 {version_id}")

        version = Version(
            version_id=version_id,
            parent=parent,
            fields=rules,
            description=description,
            transform=transform,
            ordinal=self._counter,
        )

        if parent is not None:
            self._validate_evolution(self._versions[parent], version)

        self._versions[version_id] = version
        self._children.setdefault(parent, []).append(version_id)
        self._counter += 1
        return version

    def _validate_evolution(self, parent: Version, child: Version) -> None:
        """校验 child 相对 parent 的规则演进是否可以安全自动迁移。"""
        pidx = _index(parent.fields)
        cidx = _index(child.fields)
        ploc = f"版本 {child.version_id} 相对父版本 {parent.version_id}"

        for path, new_rule in cidx.items():
            old_rule = pidx.get(path)
            location = f"{ploc}/字段 {rule_path(path)}"
            if old_rule is None:
                # 新增字段（含嵌套新增）。
                # 新版本声明了 transform 时，新增必填字段可由 transform 负责
                # 产出；迁移后仍会按新版本规则完整解析，产出失败即回滚。
                transform_covers = child.transform is not None
                if (
                    new_rule.required
                    and new_rule.default is ...
                    and not _has_required_parent(path, cidx)
                    and not transform_covers
                ):
                    raise RuleDefinitionError(
                        "新增的必填字段必须声明默认值，否则旧版本数据无法迁移到该版本"
                        "（若该字段由 transform 生成，请确认本版本已登记 transform）",
                        location,
                    )
                continue
            if old_rule.type != new_rule.type:
                pair = (old_rule.type, new_rule.type)
                if pair not in _WIDENING and child.transform is None:
                    raise RuleDefinitionError(
                        f"字段类型不能从 {old_rule.type!r} 直接变为 {new_rule.type!r}；"
                        "如确需收紧或转换，请保持字段在新版本中的类型不变并通过 transform 改名迁移，"
                        "或在登记该版本时提供 transform 显式完成转换",
                        f"{location}/type",
                    )
            if old_rule.enum is not None and new_rule.enum is not None:
                removed = set(old_rule.enum) - set(new_rule.enum)
                if removed and child.transform is None:
                    raise RuleDefinitionError(
                        f"枚举收窄会删除仍可能存在于旧数据中的取值: {sorted(removed)}；"
                        "请在本版本的 transform 中先完成取值映射（登记时提供 transform）",
                        f"{location}/enum",
                    )
            # 由可选变必填：必须给默认值，或由 transform 保证产出。
            if (
                not old_rule.required
                and new_rule.required
                and new_rule.default is ...
                and child.transform is None
            ):
                # 允许父对象整层缺省的情况由对象默认值覆盖；叶子仍需要默认值。
                if new_rule.type not in ("object", "array"):
                    raise RuleDefinitionError(
                        "字段从可选变为必填时必须声明默认值（或由 transform 产出）",
                        f"{location}/required",
                    )

        # 消失的字段（parent 有 child 没有）：允许，由迁移自动删除，无需校验。

    # ---- 查询 -----------------------------------------------------------

    def get(self, version_id: str) -> Version:
        try:
            return self._versions[version_id]
        except KeyError:
            raise VersionError(f"版本 {version_id!r} 未登记") from None

    def has(self, version_id: str) -> bool:
        return version_id in self._versions

    def versions(self) -> List[str]:
        """全部版本 id，按登记顺序稳定返回。"""
        return [
            vid
            for vid, _ in sorted(self._versions.items(), key=lambda kv: kv[1].ordinal)
        ]

    def roots(self) -> List[str]:
        """全部根版本 id（没有父版本的版本），按登记顺序稳定返回。"""
        return [
            vid
            for vid in self.versions()
            if self._versions[vid].parent is None
        ]

    def children_of(self, version_id: str) -> List[str]:
        return sorted(self._children.get(version_id, []))

    def chain(self, version_id: str) -> List[str]:
        """从根版本到 ``version_id`` 的完整链（含两端），近根在前。"""
        chain: List[str] = []
        cur: Optional[str] = version_id
        seen: set = set()
        while cur is not None:
            if cur in seen:  # 理论不可达（登记时已阻断），防御性处理。
                raise VersionError(f"版本链在 {cur!r} 处成环")
            seen.add(cur)
            chain.append(cur)
            cur = self._versions[cur].parent
        chain.reverse()
        return chain

    def common_chain(self, a: str, b: str) -> List[str]:
        """返回从 a 到 b 的逐版本路径（含两端）。

        a、b 必须在同一条链上（其中一个是另一个的祖先）。
        """
        self.get(a)
        self.get(b)
        ca = self.chain(a)
        cb = self.chain(b)
        if a in cb:
            start = cb.index(a)
            return cb[start:]
        if b in ca:
            end = ca.index(b)
            return list(reversed(ca[: end + 1]))
        raise VersionError(
            f"版本 {a!r} 与 {b!r} 不在同一条演进链上，没有共同祖先路径"
        )

    def field_rule(self, version_id: str, path: str) -> FieldRule:
        """按点路径查询某版本下的字段规则，例如 ``address.city`` 或 ``tags[]``。"""
        self.get(version_id)
        parts = [p for p in path.split(".") if p != ""]
        fields = self._versions[version_id].fields
        rule: Optional[FieldRule] = None
        for i, part in enumerate(parts):
            is_item = part.endswith("[]")
            name = part[:-2] if is_item else part
            if name:
                rule = next((f for f in fields if f.name == name), None)
                if rule is None:
                    raise VersionError(f"版本 {version_id!r} 中不存在字段 {path!r}")
                fields = rule.children
            if is_item:
                if rule is None or rule.type != "array" or rule.item is None:
                    raise VersionError(f"版本 {version_id!r} 的字段 {path!r} 不是数组元素路径")
                rule = rule.item
                fields = rule.children
        if rule is None:
            raise VersionError(f"字段路径 {path!r} 为空")
        return rule

    def field_lifecycle(self) -> List[Dict[str, Any]]:
        """全部字段的引入 / 废弃版本，按 (路径, 版本) 稳定排序。

        字段沿链“连续存在”视为同一个字段；一旦在某版本消失即标记废弃，
        之后再次同路径出现视为重新引入（单独一条记录）。
        """
        records: List[Dict[str, Any]] = []
        for root in self.roots():
            records.extend(self._lifecycle_for_chain(root))
        records.sort(key=lambda r: (r["path"], r["introduced"], r["ordinal"]))
        return records

    def _lifecycle_for_chain(self, root: str) -> List[Dict[str, Any]]:
        # 沿根版本的全部后代（按登记序）逐版本记录每个路径的出现/消失。
        chain = self._descendants(root)
        records: List[Dict[str, Any]] = []
        # active[path] = introduced_version
        active: Dict[Tuple[str, ...], str] = {}
        for vid in chain:
            present = set(_index(self._versions[vid].fields).keys())
            for path in present - set(active):
                active[path] = vid
            for path, intro in list(active.items()):
                if path not in present:
                    records.append(
                        {
                            "path": rule_path(path),
                            "introduced": intro,
                            "deprecated": vid,  # 在该版本中已不存在
                            "ordinal": self._versions[intro].ordinal,
                        }
                    )
                    del active[path]
        for path, intro in active.items():
            records.append(
                {
                    "path": rule_path(path),
                    "introduced": intro,
                    "deprecated": None,
                    "ordinal": self._versions[intro].ordinal,
                }
            )
        return records

    def _descendants(self, root: str) -> List[str]:
        """根版本及其全部后代，按登记顺序（父先于子）稳定展开。"""
        out: List[str] = []
        for vid in self.versions():
            if root in self.chain(vid):
                out.append(vid)
        return out

    def snapshot(self) -> Dict[str, Any]:
        """导出登记内容（transform 是代码，只导出其描述）。"""
        return {
            "versions": [copy.deepcopy(self._versions[v].to_dict()) for v in self.versions()],
        }

    def restore(
        self,
        data: Dict[str, Any],
        transforms: Optional[Dict[str, "Transform"]] = None,
    ) -> None:
        """从快照字典重建（transform 是代码无法序列化，需重新提供）。"""
        if not isinstance(data, dict) or "versions" not in data:
            raise VersionError("快照缺少 versions 字段")
        versions = data["versions"]
        if not isinstance(versions, list):
            raise VersionError("快照 versions 必须是数组")
        transforms = transforms or {}
        fresh = VersionRegistry()
        for i, v in enumerate(versions):
            if not isinstance(v, dict):
                raise VersionError(f"versions[{i}] 必须是对象")
            fresh.register(
                version_id=v["version_id"],
                parent=v.get("parent"),
                fields=v["fields"],
                description=v.get("description", ""),
                transform=transforms.get(v["version_id"]),
            )
        # 全部成功后才覆盖自身状态。
        self._versions = fresh._versions
        self._children = fresh._children
        self._counter = fresh._counter


def _has_required_parent(path: Tuple[str, ...], cidx: Dict[Tuple[str, ...], FieldRule]) -> bool:
    """新增叶子若位于新增的 object 内，则由对象默认值整体负责，不在此报错。"""
    while path:
        path = path[:-1]
        if not path:
            return False
        rule = cidx.get(path)
        if rule is not None and rule.required and rule.default is not ...:
            return True
    return False
