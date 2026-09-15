"""配置适配内核核心。

设计概述
========

* 版本空间只有一个：字段引入版本、配置 schema 版本、设备固件版本使用同一种
  点分数字版本号，可直接比较。
* 字段（:class:`FieldDef`）以字段名登记，名字即身份；改名通过迁移规则表达，
  改名的新名必须是为该次改名登记的新字段，不能与既有独立字段重名。
* 迁移规则（:class:`MigrationRule`）连接两个 schema 版本，一个起始版本至多一条
  规则（规则间不允许分叉），规则内可同时包含若干改名与改类型动作。
* 迁移到更高版本时按规则逐级正向执行；向低固件适配时按规则逆向回退。
  跨越而无法停留的规则会触发 :class:`MigrationChainError`，错误中带断点版本。
* 适配 = 先把配置迁移到设备固件版本，再按固件支持的引入版本与能力标签裁剪；
  固件版本之后才引入的字段按默认值补齐，没有默认值的必填字段缺失即拒绝。
* 所有结果（决策记录、生效配置、导出）都按键排序，结果只取决于设备能力与
  配置版本，与字段到达顺序无关，且重复适配结果完全相同。
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from .errors import (
    DuplicateError,
    MigrationChainError,
    MissingFieldError,
    NotFoundError,
    ValidationError,
)
from .values import VALUE_TYPES, check_value_type, convert_value
from .version import Version, canonical_version, parse_version


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Device:
    """一台已登记设备。"""

    device_id: str
    model: str
    firmware: str  # 原始固件版本字符串
    capabilities: frozenset

    def to_dict(self):
        return {
            "device_id": self.device_id,
            "model": self.model,
            "firmware": self.firmware,
            "capabilities": sorted(self.capabilities),
        }


@dataclass(frozen=True)
class FieldDef:
    """一个字段定义。

    :param name: 字段名（全局唯一，改名后旧名不可再登记）。
    :param type: 标量类型，见 :data:`device_config.values.VALUE_TYPES`。
    :param introduced_in: 字段引入版本。
    :param required: 是否必填；必填字段缺失且无默认值时适配被拒绝。
    :param default: 可选默认值，类型必须与 ``type`` 一致。
    :param required_capabilities: 设备需要具备的全部能力标签，缺一即裁剪。
    """

    name: str
    type: str
    introduced_in: str
    required: bool = True
    default: object = None
    has_default: bool = False
    required_capabilities: frozenset = frozenset()

    def to_dict(self):
        data = {
            "name": self.name,
            "type": self.type,
            "introduced_in": self.introduced_in,
            "required": self.required,
            "required_capabilities": sorted(self.required_capabilities),
        }
        if self.has_default:
            data["default"] = self.default
        return data


@dataclass(frozen=True)
class MigrationRule:
    """一条从 ``from_version`` 到 ``to_version`` 的迁移规则。

    :param renames: 旧字段名 -> 新字段名。
    :param type_changes: 当前版本字段名 -> 目标类型。
    """

    from_version: str
    to_version: str
    renames: frozenset = frozenset()
    type_changes: frozenset = frozenset()

    def to_dict(self):
        return {
            "from_version": self.from_version,
            "to_version": self.to_version,
            "renames": [
                {"from": a, "to": b}
                for a, b in sorted(self.renames, key=lambda p: p[0])
            ],
            "type_changes": [
                {"field": f, "to_type": t}
                for f, t in sorted(self.type_changes, key=lambda p: p[0])
            ],
        }


@dataclass(frozen=True)
class FieldDecision:
    """单个字段在一次适配中的取舍记录。"""

    field: str
    kept: bool
    reason: str
    detail: str
    value: object = None
    source: str = ""  # input | default | migrated

    def to_dict(self):
        return {
            "field": self.field,
            "kept": self.kept,
            "reason": self.reason,
            "detail": self.detail,
            "source": self.source,
            "value": self.value,
        }


# 裁剪原因常量
REASON_KEPT = "kept"
REASON_FUTURE_FIRMWARE = "unsupported_firmware"
REASON_MISSING_CAPABILITY = "missing_capability"
REASON_MISSING_REQUIRED = "missing_required"


@dataclass
class _FieldState:
    """快照构建过程中一个"存活字段"的内部状态。"""

    definition: FieldDef
    effective_type: str
    alive: bool = True
    name_history: tuple = ()  # 该字段身份曾用过的名字（不含当前名）


# ---------------------------------------------------------------------------
# 内核
# ---------------------------------------------------------------------------


class ConfigKernel:
    """设备配置适配内核。

    所有登记方法在数据不合法时抛出 ``device_config.errors`` 下的异常，
    且失败时内核保持调用前状态（校验先于写入）。
    """

    def __init__(self):
        self._devices = {}
        self._fields = {}
        self._rules = {}  # Version(from) -> MigrationRule
        self._configs = {}  # config_id -> {"version": Version, "values": dict}
        self._adaptations = {}  # record_id -> 完整适配记录 dict

    # ------------------------------------------------------------------
    # 登记：设备
    # ------------------------------------------------------------------

    def register_device(self, device_id, model, firmware, capabilities):
        version = parse_version(firmware)  # 非法版本先抛错，状态不变
        if not isinstance(device_id, str) or not device_id:
            raise ValidationError("设备唯一标识必须是非空字符串")
        if not isinstance(model, str) or not model:
            raise ValidationError("设备型号必须是非空字符串")
        caps = self._normalize_capabilities(capabilities, where=f"设备 {device_id}")
        if device_id in self._devices:
            raise DuplicateError(f"设备标识 {device_id!r} 已存在")
        self._devices[device_id] = Device(
            device_id=device_id,
            model=model,
            firmware=str(version),
            capabilities=frozenset(caps),
        )
        return self._devices[device_id]

    def get_device(self, device_id) -> Device:
        try:
            return self._devices[device_id]
        except KeyError:
            raise NotFoundError(f"设备 {device_id!r} 未登记") from None

    def list_devices(self):
        return [self._devices[k] for k in sorted(self._devices)]

    # ------------------------------------------------------------------
    # 登记：字段定义
    # ------------------------------------------------------------------

    def register_field(
        self,
        name,
        field_type,
        introduced_in,
        *,
        required=True,
        default=None,
        has_default=None,
        required_capabilities=(),
    ):
        if not isinstance(name, str) or not name:
            raise ValidationError("字段名必须是非空字符串")
        if field_type not in VALUE_TYPES:
            raise ValidationError(
                f"字段 {name!r} 的类型 {field_type!r} 非法，"
                f"允许类型：{', '.join(VALUE_TYPES)}"
            )
        version = parse_version(introduced_in)
        if not isinstance(required, bool):
            raise ValidationError(f"字段 {name!r} 的 required 必须是布尔值")
        caps = self._normalize_capabilities(
            required_capabilities, where=f"字段 {name}"
        )
        if name in self._fields:
            raise DuplicateError(f"字段 {name!r} 重复定义")
        # 已在某条改名规则中充当新名的名字不能再作为独立字段登记
        occupied = self._occupied_rename_names()
        if name in occupied:
            raise ValidationError(
                f"字段 {name!r} 已被迁移规则用作改名目标名，不能重复定义"
            )

        explicit_default = has_default if has_default is not None else default is not None
        if explicit_default:
            check_value_type(default, field_type, where=f"字段 {name!r} 默认值")
        else:
            default = None

        fd = FieldDef(
            name=name,
            type=field_type,
            introduced_in=str(version),
            required=required,
            default=default,
            has_default=explicit_default,
            required_capabilities=frozenset(caps),
        )
        self._fields[name] = fd
        return fd

    def get_field(self, name) -> FieldDef:
        try:
            return self._fields[name]
        except KeyError:
            raise NotFoundError(f"字段 {name!r} 未定义") from None

    def list_fields(self):
        return [self._fields[k] for k in sorted(self._fields)]

    def _occupied_rename_names(self):
        names = set()
        for rule in self._rules.values():
            for _old, new in rule.renames:
                names.add(new)
        return names

    # ------------------------------------------------------------------
    # 登记：迁移规则
    # ------------------------------------------------------------------

    def register_migration_rule(
        self, from_version, to_version, *, renames=None, type_changes=None
    ):
        v_from = parse_version(from_version)
        v_to = parse_version(to_version)
        if v_from >= v_to:
            raise ValidationError(
                f"迁移规则必须从低版本到高版本：{v_from} -> {v_to}"
            )

        renames = self._normalize_renames(renames, v_from, v_to)
        type_changes = self._normalize_type_changes(type_changes, v_from, v_to, renames)

        if v_from in self._rules:
            existing = self._rules[v_from]
            raise DuplicateError(
                f"版本 {v_from} 已登记通往 {existing.to_version} 的迁移规则，"
                "一个版本只能有一条迁出规则（不允许分叉）"
            )

        # 与既有规则完全重复（两端版本相同）也拒绝
        for rule in self._rules.values():
            if parse_version(rule.to_version) == v_to and rule.from_version == str(v_from):
                raise DuplicateError(f"迁移规则 {v_from} -> {v_to} 重复登记")

        # 环检测：新版本排序后检查 from->to 形成的图；
        # 正常情况下 to > from 不可能成环，这里防御构造顺序导致的问题。
        self._assert_acyclic_with(v_from, v_to)

        rule = MigrationRule(
            from_version=canonical_version(v_from),
            to_version=canonical_version(v_to),
            renames=frozenset(renames),
            type_changes=frozenset(type_changes),
        )

        # 改名目标名必须引用一个已登记字段，且该字段在"起始版本"尚不存在、
        # 在目标版本首次存活——即它是为这次改名而引入的新身份。
        # 若目标在起始版本已作为独立字段存活，则属于两个字段身份合并，拒绝。
        used_targets = set()
        for other in self._rules.values():
            for _old, other_new in other.renames:
                used_targets.add(other_new)
        snapshot_from = self.snapshot_at(v_from)
        snapshot_to = self.snapshot_at(v_to)
        for old, new in renames:
            if old not in self._fields:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 改名的源字段 {old!r} 未登记"
                )
            new_def = self._fields.get(new)
            if new_def is None:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名目标 {new!r} 必须是已登记字段"
                )
            old_state = snapshot_from.states_by_name.get(old)
            if old_state is None or not old_state.alive:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 改名的源字段 {old!r} "
                    f"在版本 {v_from} 不是存活字段"
                )
            pre_state = snapshot_from.states_by_name.get(new)
            if pre_state is not None and pre_state.alive:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名冲突：源字段 {old!r} 与目标名 "
                    f"{new!r} 在版本 {v_from} 都是独立存活字段，改名会合并两个字段"
                    "身份，拒绝登记"
                )
            new_state = snapshot_to.states_by_name.get(new)
            if new_state is None or not new_state.alive:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名目标 {new!r} "
                    f"在版本 {v_to} 不是存活字段"
                )
            if new in used_targets:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名目标 {new!r} "
                    "已被另一条规则占用"
                )
            used_targets.add(new)

        self._rules[v_from] = rule
        return rule

    def _normalize_renames(self, renames, v_from, v_to):
        renames = list(renames or [])
        result = []
        seen_old, seen_new = set(), set()
        for item in renames:
            if isinstance(item, dict):
                old, new = item.get("from"), item.get("to")
            else:
                try:
                    old, new = item
                except (TypeError, ValueError):
                    raise ValidationError(
                        f"规则 {v_from} -> {v_to} 的改名项必须是 (旧名, 新名)"
                    ) from None
            if not isinstance(old, str) or not old:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名旧名必须是非空字符串"
                )
            if not isinstance(new, str) or not new:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名新名必须是非空字符串"
                )
            if old == new:
                raise ValidationError(f"字段 {old!r} 改名前后名字相同，规则无意义")
            if old in seen_old:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 中字段 {old!r} 出现多次改名"
                )
            if new in seen_new:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的改名目标名 {new!r} 被多个字段使用"
                )
            seen_old.add(old)
            seen_new.add(new)
            result.append((old, new))
        return result

    def _normalize_type_changes(self, type_changes, v_from, v_to, renames):
        type_changes = list(type_changes or [])
        rename_map = dict(renames)
        result = []
        seen = set()
        for item in type_changes:
            if isinstance(item, dict):
                fname, to_type = item.get("field"), item.get("to_type")
            else:
                try:
                    fname, to_type = item
                except (TypeError, ValueError):
                    raise ValidationError(
                        f"规则 {v_from} -> {v_to} 的类型变更项必须是 (字段, 目标类型)"
                    ) from None
            if not isinstance(fname, str) or not fname:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 的类型变更字段名必须是非空字符串"
                )
            if to_type not in VALUE_TYPES:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 中字段 {fname!r} 的目标类型 "
                    f"{to_type!r} 非法"
                )
            if fname in seen:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 中字段 {fname!r} 出现多次类型变更"
                )
            seen.add(fname)

            # 用“不含当前规则”的快照验证源字段在 from 版本存活、源类型可转、
            # 且改名场景下目标类型必须与目标字段定义的基础类型一致。
            snapshot = self.snapshot_at(v_from)
            state = snapshot.states_by_name.get(fname)
            if state is None or not state.alive:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 引用的字段 {fname!r} "
                    f"在版本 {v_from} 不存在"
                )
            from_type = state.effective_type
            if from_type == to_type:
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 中字段 {fname!r} 声明类型变更 "
                    f"{from_type} -> {to_type}，类型未改变"
                )
            if (from_type, to_type) not in _convertible_pairs():
                raise ValidationError(
                    f"规则 {v_from} -> {v_to} 中字段 {fname!r} 的类型变更 "
                    f"{from_type} -> {to_type} 不受支持"
                )

            if fname in rename_map:
                target_def = self._fields.get(rename_map[fname])
                if target_def is None:
                    raise ValidationError(
                        f"规则 {v_from} -> {v_to} 的改名目标 "
                        f"{rename_map[fname]!r} 必须是已登记字段"
                    )
                if target_def.type != to_type:
                    raise ValidationError(
                        f"规则 {v_from} -> {v_to} 中 {fname!r} 改名为 "
                        f"{target_def.name!r}，类型变更 {from_type} -> {to_type} "
                        f"与目标字段定义类型 {target_def.type} 不一致"
                    )
                # 目标字段的默认值（若有）必须能按迁移后的类型使用
                if target_def.has_default:
                    check_value_type(
                        target_def.default,
                        to_type,
                        where=f"改名目标字段 {target_def.name!r} 默认值",
                    )
            result.append((fname, to_type))
        return result

    def list_migration_rules(self):
        return [self._rules[v] for v in sorted(self._rules, key=lambda x: x.parts)]

    def _assert_acyclic_with(self, v_from, v_to):
        # 构造加入新边后的邻接表做 DFS 环检测。
        edges = {}
        for v, rule in self._rules.items():
            edges[v] = parse_version(rule.to_version)
        edges[v_from] = v_to
        visiting, visited = set(), set()

        def visit(node, stack):
            if node in visiting:
                cycle = " -> ".join(str(x) for x in stack + [node])
                raise ValidationError(f"迁移规则存在环：{cycle}")
            if node in visited:
                return
            visiting.add(node)
            nxt = edges.get(node)
            if nxt is not None:
                visit(nxt, stack + [node])
            visiting.discard(node)
            visited.add(node)

        for node in sorted(edges, key=lambda x: x.parts):
            visit(node, [])

    # ------------------------------------------------------------------
    # 登记：配置
    # ------------------------------------------------------------------

    def register_config(self, config_id, version, values):
        if not isinstance(config_id, str) or not config_id:
            raise ValidationError("配置标识必须是非空字符串")
        if config_id in self._configs:
            raise DuplicateError(f"配置 {config_id!r} 已存在")
        v = parse_version(version)
        if not isinstance(values, dict):
            raise ValidationError(f"配置 {config_id!r} 的字段集合必须是对象/字典")

        normalized = {}
        for name, val in values.items():
            if not isinstance(name, str) or not name:
                raise ValidationError(f"配置 {config_id!r} 中字段名必须是非空字符串")
            fd = self._fields.get(name)
            if fd is None:
                raise ValidationError(
                    f"配置 {config_id!r} 引用了未定义字段 {name!r}"
                )
            if parse_version(fd.introduced_in) > v:
                raise ValidationError(
                    f"配置 {config_id!r}（版本 {v}）携带了字段 {name!r}，"
                    f"该字段直到 {fd.introduced_in} 才引入"
                )
            check_value_type(val, fd.type, where=f"配置 {config_id!r} 字段 {name!r}")
            normalized[name] = val

        self._configs[config_id] = {
            "version": v,
            "values": normalized,
            "version_text": str(v),
        }
        return self._configs[config_id]

    def get_config(self, config_id):
        try:
            cfg = self._configs[config_id]
        except KeyError:
            raise NotFoundError(f"配置 {config_id!r} 未登记") from None
        return {
            "config_id": config_id,
            "version": cfg["version_text"],
            "values": dict(cfg["values"]),
        }

    def list_configs(self):
        return [self.get_config(cid) for cid in sorted(self._configs)]

    # ------------------------------------------------------------------
    # 版本快照
    # ------------------------------------------------------------------

    def snapshot_at(self, target: Version):
        """构造 ``target`` 版本时的字段视图（不依赖调用方、仅供内部与查询使用）。"""
        states = {}
        # 1) 加入所有在 target 及之前引入的字段
        for fd in self._fields.values():
            if parse_version(fd.introduced_in) <= target:
                states[fd.name] = _FieldState(definition=fd, effective_type=fd.type)
        # 2) 按版本顺序应用 from < target... 的规则（to <= target 才完全生效）
        for v in sorted(self._rules, key=lambda x: x.parts):
            if v >= target:
                break
            rule = self._rules[v]
            v_to = parse_version(rule.to_version)
            if v_to > target:
                # 规则整体跨越 target：改名与类型变更都不在 target 生效
                continue
            type_map = dict(rule.type_changes)
            rename_map = dict(rule.renames)
            for fname, to_type in rule.type_changes:
                st = states.get(fname)
                if st is not None and st.alive:
                    states[fname] = _FieldState(
                        definition=st.definition,
                        effective_type=to_type,
                        alive=True,
                        name_history=st.name_history,
                    )
            for old, new in rule.renames:
                st = states.get(old)
                if st is None or not st.alive:
                    continue
                target_def = self._fields[new]
                # 若改名同规则里带了该字段的类型变更，用变更后的类型；
                # 否则用目标字段定义的基础类型。
                new_type = type_map.get(old, target_def.type)
                states[old] = _FieldState(
                    definition=st.definition,
                    effective_type=st.effective_type,
                    alive=False,
                    name_history=st.name_history,
                )
                states[new] = _FieldState(
                    definition=target_def,
                    effective_type=new_type,
                    alive=True,
                    name_history=st.name_history + (old,),
                )
        return _Snapshot(target, states, self._fields)

    # ------------------------------------------------------------------
    # 迁移路径
    # ------------------------------------------------------------------

    def migration_path(self, base_version, target_version):
        """返回从 ``base_version`` 到 ``target_version`` 的完整迁移路径。

        返回 hop 列表，每个 hop 为 dict：

        ``{"from", "to", "rule": MigrationRule|None, "identity": bool}``

        - 正向（base < target）：按 from 升序，遇到无规则可停留的空档保持 identity；
          若某条规则整体跨越目标，断链报错并指出断点版本。
        - 逆向（base > target）：按 from 降序回退；规则跨越目标同样断链。
        - 相同版本：返回空列表。
        """
        base = parse_version(base_version)
        target = parse_version(target_version)
        if base == target:
            return []

        rules_sorted = [self._rules[v] for v in sorted(self._rules, key=lambda x: x.parts)]
        hops = []
        cur = base

        if base < target:
            # 正向。规则之间必须首尾相接；开头（配置早于第一条规则）与结尾
            # （最后一条规则后只有字段新增）允许 identity 段。
            applied_any = False
            for rule in rules_sorted:
                v_from = parse_version(rule.from_version)
                v_to = parse_version(rule.to_version)
                if v_to <= cur:
                    continue
                if v_from < cur:
                    # 配置版本落在某条规则区间内部，没有对应的 schema 节点
                    raise MigrationChainError(
                        canonical_version(cur), canonical_version(target),
                        f"版本 {cur} 位于规则 {rule.from_version} -> "
                        f"{rule.to_version} 区间内，不存在该版本的迁移步骤",
                    )
                if v_from > cur:
                    if applied_any:
                        raise MigrationChainError(
                            canonical_version(cur), canonical_version(target),
                            f"规则链在版本 {cur} 之后断裂：下一条规则 "
                            f"{rule.from_version} -> {rule.to_version} 未与上一规则"
                            f"首尾相接，缺少从 {cur} 出发的迁移规则",
                        )
                    hops.append({"from": canonical_version(cur), "to": canonical_version(rule.from_version),
                                 "rule": None, "identity": True})
                    cur = v_from
                    if cur == target:
                        break
                if v_to > target:
                    raise MigrationChainError(
                        canonical_version(rule.from_version), canonical_version(target),
                        f"规则 {rule.from_version} -> {rule.to_version} "
                        f"跨越目标版本 {target}，无法在目标版本停留",
                    )
                hops.append({"from": canonical_version(cur), "to": canonical_version(rule.to_version), "rule": rule,
                             "identity": False})
                cur = v_to
                applied_any = True
                if cur == target:
                    break
            if cur != target:
                hops.append({"from": canonical_version(cur), "to": canonical_version(target), "rule": None,
                             "identity": True})
        else:
            # 逆向：正向路径的镜像。
            undone_any = False
            for rule in reversed(rules_sorted):
                v_from = parse_version(rule.from_version)
                v_to = parse_version(rule.to_version)
                if v_from >= cur:
                    continue
                if v_to > cur:
                    raise MigrationChainError(
                        canonical_version(cur), canonical_version(target),
                        f"版本 {cur} 位于规则 {rule.from_version} -> "
                        f"{rule.to_version} 区间内，不存在该版本的迁移步骤",
                    )
                if v_to < cur:
                    if undone_any:
                        raise MigrationChainError(
                            canonical_version(cur), canonical_version(target),
                            f"规则链在版本 {cur} 处断裂：无法回到上一条规则 "
                            f"{rule.from_version} -> {rule.to_version} 的端点",
                        )
                    hops.append({"from": canonical_version(cur), "to": canonical_version(rule.from_version),
                                 "rule": None, "identity": True})
                    cur = v_to
                    if cur == target:
                        break
                if v_from < target:
                    raise MigrationChainError(
                        canonical_version(rule.from_version), canonical_version(target),
                        f"规则 {rule.from_version} -> {rule.to_version} "
                        f"跨越目标版本 {target}，无法在目标版本停留",
                    )
                hops.append({"from": canonical_version(cur), "to": canonical_version(rule.from_version), "rule": rule,
                             "identity": False})
                cur = v_from
                undone_any = True
                if cur == target:
                    break
            if cur != target:
                hops.append({"from": canonical_version(cur), "to": canonical_version(target), "rule": None,
                             "identity": True})

        return hops

    def describe_migration_path(self, base_version, target_version):
        """路径的人类可读/可序列化描述（不含内部对象）。"""
        steps = []
        for hop in self.migration_path(base_version, target_version):
            rule = hop["rule"]
            steps.append({
                "from": hop["from"],
                "to": hop["to"],
                "identity": hop["identity"],
                "renames": [list(pair) for pair in sorted(rule.renames)] if rule else [],
                "type_changes": (
                    [[f, t] for f, t in sorted(rule.type_changes)] if rule else []
                ),
            })
        return steps

    # ------------------------------------------------------------------
    # 适配
    # ------------------------------------------------------------------

    def adapt(self, config_id, device_id):
        """把一份配置适配到一台设备。

        :returns: 适配记录 dict（同时被内核保存，可用
                  :meth:`get_adaptation` 取回）。
        :raises MigrationChainError: 配置版本到固件版本的迁移链断裂。
        :raises MissingFieldError: 必填字段缺失且没有默认值。
        """
        cfg = self._configs.get(config_id)
        if cfg is None:
            raise NotFoundError(f"配置 {config_id!r} 未登记")
        device = self.get_device(device_id)

        base_version = cfg["version"]
        fw_version = parse_version(device.firmware)

        # 1) 迁移到固件版本（可能正向补齐或逆向降级），失败会在此抛出
        self.migration_path(base_version, fw_version)
        migrated = self._migrate_values(
            cfg["values"], base_version, fw_version
        )

        snapshot = self.snapshot_at(fw_version)
        decisions = []
        effective = {}

        # 2) 已存在（迁移后）的值：按固件/能力裁剪
        for name in sorted(migrated):
            value = migrated[name]
            st = snapshot.states_by_name.get(name)
            if st is None or not st.alive:
                # 迁移后仍残留的字段在固件 schema 中不存在（通常因引入版本晚于固件）
                source_fd = self._fields.get(name)
                introduced = (
                    source_fd.introduced_in if source_fd is not None else "未知版本"
                )
                decisions.append(FieldDecision(
                    field=name, kept=False,
                    reason=REASON_FUTURE_FIRMWARE,
                    detail=(
                        f"字段 {name} 于固件版本 {introduced} 引入，"
                        f"设备固件为 {device.firmware}，安全降级忽略"
                    ),
                    value=value, source="migrated",
                ))
                continue
            fd = st.definition
            introduced = parse_version(fd.introduced_in)
            if introduced > fw_version:
                decisions.append(FieldDecision(
                    field=name, kept=False,
                    reason=REASON_FUTURE_FIRMWARE,
                    detail=(
                        f"字段于固件版本 {fd.introduced_in} 引入，"
                        f"设备固件为 {device.firmware}，安全降级忽略"
                    ),
                    value=value, source="migrated",
                ))
                continue
            missing_caps = sorted(set(fd.required_capabilities) - set(device.capabilities))
            if missing_caps:
                decisions.append(FieldDecision(
                    field=name, kept=False,
                    reason=REASON_MISSING_CAPABILITY,
                    detail=(
                        f"设备缺少能力标签：{', '.join(missing_caps)}；"
                        f"该字段要求：{', '.join(sorted(fd.required_capabilities)) or '（无）'}"
                    ),
                    value=value, source="migrated",
                ))
                continue
            decisions.append(FieldDecision(
                field=name, kept=True, reason=REASON_KEPT,
                detail=f"设备固件 {device.firmware} 已支持且能力满足",
                value=value, source="migrated" if base_version != fw_version else "input",
            ))
            effective[name] = value

        # 3) 固件支持但配置中没有的字段：默认补齐 / 必填缺失 / 因能力静默裁剪
        missing_required = []
        for name in sorted(snapshot.states_by_name):
            if name in migrated:
                continue
            st = snapshot.states_by_name[name]
            if not st.alive:
                continue
            fd = st.definition
            if parse_version(fd.introduced_in) > fw_version:
                continue
            missing_caps = sorted(set(fd.required_capabilities) - set(device.capabilities))
            if missing_caps:
                # 设备根本不具备该能力：不要求补齐，也不进生效配置
                decisions.append(FieldDecision(
                    field=name, kept=False,
                    reason=REASON_MISSING_CAPABILITY,
                    detail=(
                        f"配置中缺失且设备缺少能力标签：{', '.join(missing_caps)}，"
                        "无需补齐"
                    ),
                ))
                continue
            if fd.has_default:
                default_value = self._default_for(fd, base_version, fw_version)
                decisions.append(FieldDecision(
                    field=name, kept=True, reason=REASON_KEPT,
                    detail=(
                        f"配置为旧版本 {cfg['version_text']}，按字段默认值补齐 "
                        f"（引入于 {fd.introduced_in}）"
                    ),
                    value=default_value, source="default",
                ))
                effective[name] = default_value
            elif fd.required:
                missing_required.append(name)

        if missing_required:
            raise MissingFieldError(missing_required)

        decisions.sort(key=lambda d: d.field)
        record = {
            "record_id": "",  # 下面按规范化内容生成
            "config_id": config_id,
            "device_id": device_id,
            "config_version": cfg["version_text"],
            "target_firmware": device.firmware,
            "migration_path": self.describe_migration_path(base_version, fw_version),
            "effective_config": {k: effective[k] for k in sorted(effective)},
            "decisions": [d.to_dict() for d in decisions],
        }
        record["record_id"] = self._record_id(record)

        # 幂等：同一输入重复适配得到同一条记录（完全相同的内容与 ID）
        self._adaptations[record["record_id"]] = record
        return record

    def _migrate_values(self, values, base: Version, target: Version):
        """按迁移路径把取值集合从 base 搬到 target，返回新 dict（不改输入）。

        正向：先改类型（按 from 版本快照里的有效类型），再改名。
        逆向：先改回旧名，再改回旧类型。
        """
        hops = self.migration_path(base, target)
        if not hops:
            return dict(values)

        current = dict(values)
        if base < target:
            for hop in hops:
                rule = hop["rule"]
                if rule is None:
                    continue  # identity 步：纯加字段版本，取值不变
                snapshot_from = self.snapshot_at(parse_version(rule.from_version))
                rename_map = dict(rule.renames)
                type_map = dict(rule.type_changes)
                next_values = {}
                for name, value in current.items():
                    if name in type_map:
                        old_type = self._alive_type(snapshot_from, name, rule.from_version)
                        value = convert_value(
                            value, old_type, type_map[name],
                            where=f"字段 {name!r} 在 {rule.from_version} -> "
                                  f"{rule.to_version} 的类型迁移",
                        )
                    new_name = rename_map.get(name, name)
                    next_values[new_name] = value
                current = next_values
        else:
            for hop in reversed(hops):
                rule = hop["rule"]
                if rule is None:
                    continue
                snapshot_from = self.snapshot_at(parse_version(rule.from_version))
                rename_map = dict(rule.renames)
                inverse_rename = {new: old for old, new in rename_map.items()}
                type_map = dict(rule.type_changes)
                next_values = {}
                for name, value in current.items():
                    old_name = inverse_rename.get(name, name)
                    if old_name in type_map:
                        old_type = self._alive_type(
                            snapshot_from, old_name, rule.from_version
                        )
                        value = convert_value(
                            value, type_map[old_name], old_type,
                            where=f"字段 {old_name!r} 从 {rule.to_version} 回退到 "
                                  f"{rule.from_version} 的逆向类型迁移",
                        )
                    next_values[old_name] = value
                current = next_values
        return current

    @staticmethod
    def _alive_type(snapshot, name, version):
        st = snapshot.states_by_name.get(name)
        if st is None or not st.alive:
            raise MigrationChainError(
                str(version), str(version),
                f"迁移时字段 {name!r} 在版本 {version} 不存在",
            )
        return st.effective_type

    def _default_for(self, fd: FieldDef, base: Version, target: Version):
        """求字段在 target 版本应使用的默认值。

        默认值挂在字段当前定义上（其引入版本的类型）；若从 base 到 target 的
        迁移链上该字段经历过类型变更，默认值也要随之转换。
        """
        value = fd.default
        # 从 fd 引入版本走到 target，重放涉及该字段身份的改名与类型变更
        hops = self.migration_path(parse_version(fd.introduced_in), target)
        name_now = fd.name
        cur_type = fd.type
        for hop in hops:
            rule = hop["rule"]
            if rule is None:
                continue
            rename_map = dict(rule.renames)
            for fname, to_type in rule.type_changes:
                if fname == name_now:
                    value = convert_value(
                        value, cur_type, to_type,
                        where=f"字段 {fd.name!r} 默认值在 "
                              f"{rule.from_version} -> {rule.to_version} 的迁移",
                    )
                    cur_type = to_type
            if name_now in dict(rename_map):
                name_now = rename_map[name_now]
        return value

    def _record_id(self, record):
        payload = {
            "config_id": record["config_id"],
            "device_id": record["device_id"],
            "config_version": record["config_version"],
            "target_firmware": record["target_firmware"],
            "effective_config": record["effective_config"],
            "decisions": record["decisions"],
            "migration_path": record["migration_path"],
        }
        blob = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(blob).hexdigest()[:16]

    # ------------------------------------------------------------------
    # 查询
    # ------------------------------------------------------------------

    def effective_config(self, device_id, config_id=None):
        """查询设备当前生效配置。

        不传 ``config_id`` 时返回该设备最近一次适配的生效配置；
        传入时等价于重新执行 :meth:`adapt`。
        """
        if config_id is not None:
            return self.adapt(config_id, device_id)["effective_config"]
        matches = [
            rec for rec in self._adaptations.values()
            if rec["device_id"] == device_id
        ]
        if not matches:
            raise NotFoundError(f"设备 {device_id!r} 尚无适配记录")
        # 同一设备多条记录时取记录 ID 最小者，保证查询确定性
        matches.sort(key=lambda r: r["record_id"])
        return dict(matches[-1]["effective_config"])

    def field_decision(self, record_id, field_name):
        """查询某次适配中某字段被保留或裁掉的原因。"""
        record = self.get_adaptation(record_id)
        for d in record["decisions"]:
            if d["field"] == field_name:
                return dict(d)
        raise NotFoundError(
            f"适配记录 {record_id} 中没有字段 {field_name!r} 的取舍记录"
        )

    def get_adaptation(self, record_id):
        try:
            return self._adaptations[record_id]
        except KeyError:
            raise NotFoundError(f"适配记录 {record_id} 不存在") from None

    def find_adaptation(self, config_id, device_id):
        """按配置与设备定位已有适配记录（不重新计算）。"""
        for rec in self._adaptations.values():
            if rec["config_id"] == config_id and rec["device_id"] == device_id:
                return rec
        raise NotFoundError(
            f"配置 {config_id!r} 针对设备 {device_id!r} 的适配记录不存在"
        )

    def list_adaptations(self):
        return [self._adaptations[k] for k in sorted(self._adaptations)]

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_capabilities(capabilities, *, where):
        if isinstance(capabilities, str):
            raise ValidationError(
                f"{where} 的能力标签必须是字符串集合，不能是单个字符串"
            )
        try:
            caps = list(capabilities)
        except TypeError:
            raise ValidationError(f"{where} 的能力标签必须是可迭代的字符串集合") from None
        result = set()
        for cap in caps:
            if not isinstance(cap, str) or not cap:
                raise ValidationError(f"{where} 的能力标签必须都是非空字符串")
            result.add(cap)
        return result


def _convertible_pairs():
    from .values import _CONVERTERS
    return frozenset(_CONVERTERS)


class _Snapshot:
    """某版本上的字段视图。"""

    def __init__(self, target: Version, states, field_defs):
        self.target = target
        self.states_by_name = states
        self._field_defs = field_defs

    def alive_fields(self):
        return {
            name: st for name, st in self.states_by_name.items() if st.alive
        }
