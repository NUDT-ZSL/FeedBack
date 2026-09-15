"""配置演进与能力适配内核。

:class:`ConfigKernel` 是唯一入口，职责分四层：

1. 登记层：能力、型号 / 固件、字段演进规则、迁移边——重复与非法定义在登记
   时即被拒绝（:class:`RegistrationError`）。
2. 解析层：:meth:`normalize` 把任意版本的原始配置按目标版本折叠解析，
   老版本读新字段 → extras 标记 unknown；新字段缺省 → 按引入版本补默认；
   取值收紧 → 按字段策略报错或降级，绝不静默处理。
3. 迁移层：:meth:`migrate` 沿迁移边逐版本执行声明式操作，结果与
   :meth:`normalize` 直接按目标版本解析逐字节一致；任一步失败整体回滚；
   :meth:`rollback` 凭迁移记录恢复。
4. 设备层与查询层：:meth:`apply` 结合具体型号 / 固件做能力判定，
   :meth:`field_info` / :meth:`diff` 回答最终取值、来源与稳定顺序差异。
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

from .config import (
    Config,
    IgnoredField,
    R_CAPABILITY,
    R_DROPPED,
    R_UNKNOWN,
    R_UNSUPPORTED_VALUE,
    ST_DEFAULT,
    ST_DEGRADED,
    ST_DEPRECATED,
    ST_IGNORED,
    ST_RENAMED,
    ST_SET,
    flatten,
)
from .errors import (
    FieldProblem,
    KernelError,
    MigrationError,
    RegistrationError,
    RollbackError,
    ValidationError,
)
from .migrate import (
    MigrationOp,
    MigrationRecord,
    MigrationStep,
    FieldChangeRecord,
    RollbackRecord,
    StepRecord,
    _snapshot_to_json,
)
from .model import Capability, DeviceModel, validate_field_path, validate_name
from .schema import (
    POLICY_CLAMP,
    POLICY_ERROR,
    POLICY_FALLBACK,
    POLICIES,
    T_ENUM,
    T_FLOAT,
    T_INT,
    T_LIST,
    T_STR,
    TYPES,
    EnumMember,
    FieldChange,
    FieldSpec,
    ResolvedField,
    _UNSET,
)
from .version import Version


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _digest(obj: Any) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()


class ConfigKernel:
    FORMAT = "cfgkernel/1"

    def __init__(self) -> None:
        self.capabilities: Dict[str, Capability] = {}
        self.models: Dict[str, DeviceModel] = {}
        self.fields: Dict[str, FieldSpec] = {}
        self._steps: Dict[Tuple[Version, Version], MigrationStep] = {}
        self.configs: Dict[str, Config] = {}
        self.migration_records: List[MigrationRecord] = []
        self.rollback_records: List[RollbackRecord] = []

    # ======================================================================
    # 1. 登记层
    # ======================================================================

    def register_capability(
        self,
        name: str,
        introduced: "str | Version",
        deprecated: Optional["str | Version"] = None,
    ) -> Capability:
        validate_name(name, "能力")
        if name in self.capabilities:
            raise RegistrationError(f"能力 '{name}' 重复登记")
        intro = Version(introduced)
        dep = Version(deprecated) if deprecated is not None else None
        if dep is not None and dep <= intro:
            raise RegistrationError(
                f"能力 '{name}' 的废弃版本 {dep} 必须晚于引入版本 {intro}"
            )
        cap = Capability(name=name, introduced=intro, deprecated=dep)
        self.capabilities[name] = cap
        return cap

    def register_model(self, name: str) -> DeviceModel:
        validate_name(name, "型号")
        if name in self.models:
            raise RegistrationError(f"型号 '{name}' 重复登记")
        model = DeviceModel(name)
        self.models[name] = model
        return model

    def register_firmware(self, model_name: str, fw: "str | Version") -> Version:
        model = self._model(model_name)
        try:
            return model.register_firmware(fw)
        except RegistrationError:
            raise
        except Exception as exc:  # 防御：任何非法输入都翻译成内核错误
            raise RegistrationError(str(exc)) from exc

    def register_support(
        self, model_name: str, capability: str, since: "str | Version"
    ) -> None:
        model = self._model(model_name)
        model.register_support(capability, since, self.capabilities)

    def register_field(
        self,
        path: str,
        ftype: str,
        introduced: "str | Version",
        *,
        default: Any = None,
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        elem_type: Optional[str] = None,
        enum_members: Optional[List[Tuple[str, "str | Version"]]] = None,
        required_capability: Optional[str] = None,
        range_policy: str = POLICY_ERROR,
        degrade_fallback: Any = None,
    ) -> FieldSpec:
        validate_field_path(path)
        if path in self.fields:
            raise RegistrationError(f"字段 '{path}' 重复登记")
        if ftype not in TYPES:
            raise RegistrationError(
                f"字段 '{path}' 的类型 {ftype!r} 非法，合法类型：{sorted(TYPES)}"
            )
        if range_policy not in POLICIES:
            raise RegistrationError(
                f"字段 '{path}' 的收紧策略 {range_policy!r} 非法，"
                f"合法值：{sorted(POLICIES)}"
            )
        intro = Version(introduced)
        self._validate_bounds(path, ftype, min_value, max_value,
                              min_length, max_length, elem_type)
        if required_capability is not None:
            validate_name(required_capability, "能力")
            if required_capability not in self.capabilities:
                raise RegistrationError(
                    f"字段 '{path}' 依赖的能力 '{required_capability}' 尚未登记"
                )
        members: List[Tuple[str, str]] = []
        seen: Dict[str, Version] = {}
        for name, mver in enum_members or []:
            if not isinstance(name, str) or not name:
                raise RegistrationError(
                    f"字段 '{path}' 的枚举成员名不能为空"
                )
            mv = Version(mver)
            if name in seen:
                raise RegistrationError(
                    f"字段 '{path}' 的枚举成员 {name!r} 重复登记"
                )
            if mv < intro:
                raise RegistrationError(
                    f"字段 '{path}' 的枚举成员 {name!r} 引入版本 {mv} 早于"
                    f"字段引入版本 {intro}"
                )
            seen[name] = mv
            members.append((name, mv.to_json()))
        if ftype != T_ENUM and members:
            raise RegistrationError(f"非枚举字段 '{path}' 不得声明枚举成员")
        try:
            spec = FieldSpec(
                path=path,
                ftype=ftype,
                introduced=intro,
                default=default,
                min_value=min_value,
                max_value=max_value,
                min_length=min_length,
                max_length=max_length,
                elem_type=elem_type,
                enum_members=members,
                required_capability=required_capability,
                range_policy=range_policy,
                degrade_fallback=degrade_fallback,
            )
        except ValueError as exc:
            raise RegistrationError(str(exc)) from exc
        # 默认值与兜底值必须本身合法
        rf = spec.resolve_at(intro)
        assert rf is not None
        problems = rf.validate_value(default)
        if problems:
            raise RegistrationError(
                f"字段 '{path}' 的默认值非法：{problems[0].message}"
            )
        if range_policy == POLICY_FALLBACK:
            if ftype != T_ENUM:
                raise RegistrationError(
                    f"字段 '{path}' 使用 fallback 策略但不是枚举字段"
                )
            if degrade_fallback is None or degrade_fallback not in rf.enum_values():
                raise RegistrationError(
                    f"字段 '{path}' 的 degrade_fallback {degrade_fallback!r} "
                    f"必须是当前合法枚举成员之一 {rf.enum_values()}"
                )
        # 字段引入版本不得落在任何已登记迁移边的内部（链必须经过该版本）
        self._assert_not_inside_edge(path, intro)
        self.fields[path] = spec
        return spec

    def _assert_not_inside_edge(self, path: str, ver: Version) -> None:
        for (a, b) in self._steps:
            if a < ver < b:
                raise RegistrationError(
                    f"字段 '{path}' 的版本 {ver} 落在已登记迁移边 {a} -> {b} "
                    "内部：请先把该迁移边拆成逐版本的边再登记字段变化"
                )

    def add_field_change(
        self,
        path: str,
        version: "str | Version",
        *,
        ftype: Optional[str] = None,
        default: Any = ...,  # type: ignore[assignment]
        min_value: Optional[float] = None,
        max_value: Optional[float] = None,
        min_length: Optional[int] = None,
        max_length: Optional[int] = None,
        elem_type: Optional[str] = None,
        enum_members_added: Optional[List[Tuple[str, "str | Version"]]] = None,
        enum_members_removed: Optional[List[str]] = None,
        deprecated: Optional[bool] = None,
        range_policy: Optional[str] = None,
        degrade_fallback: Any = ...,  # type: ignore[assignment]
    ) -> None:
        spec = self._field(path)
        ver = Version(version)
        if ver <= spec.introduced:
            raise RegistrationError(
                f"字段 '{path}' 的变化版本 {ver} 必须晚于引入版本 {spec.introduced}"
            )
        if ver in spec.changes:
            raise RegistrationError(
                f"字段 '{path}' 在版本 {ver} 的规则变化重复登记"
            )
        self._assert_not_inside_edge(path, ver)
        prev_rf = self._resolve_before(spec, ver)
        if ftype is not None and ftype not in TYPES:
            raise RegistrationError(
                f"字段 '{path}' 在 {ver} 的新类型 {ftype!r} 非法"
            )
        if range_policy is not None and range_policy not in POLICIES:
            raise RegistrationError(
                f"字段 '{path}' 在 {ver} 的收紧策略 {range_policy!r} 非法"
            )
        new_type = ftype or (prev_rf.ftype if prev_rf else None)
        self._validate_bounds(
            path, new_type, min_value, max_value,
            min_length, max_length, elem_type,
        )
        added: List[EnumMember] = []
        if enum_members_added:
            existing = set(prev_rf.enum_values()) if prev_rf else set()
            for name, mver in enum_members_added:
                mv = Version(mver)
                if name in existing:
                    raise RegistrationError(
                        f"字段 '{path}' 的枚举成员 {name!r} 在 {ver} 之前已存在，"
                        "不得重复扩值"
                    )
                added.append(EnumMember(value=name, introduced=max(mv, ver)))
        change = FieldChange(
            version=ver,
            ftype=ftype,
            default=default if default is not Ellipsis else _UNSET,
            min_value=min_value,
            max_value=max_value,
            min_length=min_length,
            max_length=max_length,
            elem_type=elem_type,
            enum_members_added=tuple(added),
            enum_members_removed=tuple(enum_members_removed or []),
            deprecated=deprecated,
            range_policy=range_policy,
            degrade_fallback=(
                degrade_fallback if degrade_fallback is not Ellipsis else _UNSET
            ),
        )
        try:
            spec.add_change(change)
        except ValueError as exc:
            raise RegistrationError(str(exc)) from exc
        # 变化后规则必须自洽：新默认值 / 兜底值合法
        rf = spec.resolve_at(ver)
        assert rf is not None
        new_default = rf.default
        problems = rf.validate_value(new_default)
        if problems:
            spec.changes.pop(ver, None)
            raise RegistrationError(
                f"字段 '{path}' 在 {ver} 的默认值非法：{problems[0].message}"
            )
        if rf.range_policy == POLICY_FALLBACK and (
            rf.degrade_fallback is None or rf.degrade_fallback not in rf.enum_values()
        ):
            spec.changes.pop(ver, None)
            raise RegistrationError(
                f"字段 '{path}' 在 {ver} 的 fallback 策略要求 degrade_fallback "
                f"是合法枚举成员之一 {rf.enum_values()}"
            )

    def register_migration_step(
        self,
        from_version: "str | Version",
        to_version: "str | Version",
        ops: Optional[List[MigrationOp]] = None,
    ) -> MigrationStep:
        try:
            step = MigrationStep(from_version, to_version, ops or [])
        except ValueError as exc:
            raise RegistrationError(str(exc)) from exc
        a, b = step.edge
        if (a, b) in self._steps:
            raise RegistrationError(f"迁移边 {step.label()} 重复登记")
        for op in step.ops:
            self._validate_op(op)
        # 必须与已有迁移边首尾相接，构成一条不分叉的演进链
        if self._steps:
            starts = {f for f, _ in self._steps}
            ends = {t for _, t in self._steps}
            if a not in ends and b not in starts:
                chain = self.migration_chain()
                raise RegistrationError(
                    f"迁移边 {step.label()} 与已有演进链 {chain} 无法相接："
                    f"{a} 不是任何边的终点，{b} 也不是任何边的起点（链不得分叉）"
                )
            if a in starts or b in ends:
                raise RegistrationError(
                    f"迁移边 {step.label()} 与已有边冲突（版本不得分叉 / 回绕）"
                )
        # 迁移边跨越的区间内不得存在未作为链节点的字段变化版本
        for path, spec in self.fields.items():
            check_versions = [spec.introduced] + list(spec.changes)
            for v in check_versions:
                if a < v < b:
                    raise RegistrationError(
                        f"迁移边 {step.label()} 跨过了字段 '{path}' 在 {v} 的变化，"
                        "演进链必须逐版本经过该节点"
                    )
        self._steps[(a, b)] = step
        return step

    def migration_chain(self) -> List[str]:
        edges = sorted(self._steps, key=lambda e: e[0])
        return [f"{a} -> {b}" for a, b in edges]

    # -- 登记辅助 ------------------------------------------------------------

    def _model(self, name: str) -> DeviceModel:
        if name not in self.models:
            raise RegistrationError(f"型号 '{name}' 尚未登记")
        return self.models[name]

    def _field(self, path: str) -> FieldSpec:
        if path not in self.fields:
            raise RegistrationError(f"字段 '{path}' 尚未登记")
        return self.fields[path]

    @staticmethod
    def _validate_bounds(
        path: str, ftype: str, min_value, max_value,
        min_length, max_length, elem_type,
    ) -> None:
        if ftype in (T_INT, T_FLOAT):
            if min_value is not None and not isinstance(min_value, (int, float)):
                raise RegistrationError(f"字段 '{path}' 的 min_value 必须是数值")
            if max_value is not None and not isinstance(max_value, (int, float)):
                raise RegistrationError(f"字段 '{path}' 的 max_value 必须是数值")
            if (
                min_value is not None and max_value is not None
                and min_value > max_value
            ):
                raise RegistrationError(
                    f"字段 '{path}' 的 min_value({min_value}) 不得大于 "
                    f"max_value({max_value})"
                )
        if ftype in (T_STR, T_LIST):
            for nm, val in (("min_length", min_length), ("max_length", max_length)):
                if val is not None and (not isinstance(val, int) or val < 0):
                    raise RegistrationError(
                        f"字段 '{path}' 的 {nm} 必须是非负整数"
                    )
            if (
                min_length is not None and max_length is not None
                and min_length > max_length
            ):
                raise RegistrationError(
                    f"字段 '{path}' 的 min_length({min_length}) 不得大于 "
                    f"max_length({max_length})"
                )
        if ftype == T_LIST:
            if elem_type is not None and elem_type not in TYPES:
                raise RegistrationError(
                    f"字段 '{path}' 的 elem_type {elem_type!r} 非法"
                )

    @staticmethod
    def _validate_op(op: MigrationOp) -> None:
        a = op.args
        if op.kind == "rename":
            if not isinstance(a.get("old"), str) or not isinstance(a.get("new"), str):
                raise RegistrationError("rename 操作需要字符串参数 old / new")
            if a["old"] == a["new"]:
                raise RegistrationError("rename 操作的 old 与 new 不得相同")
        elif op.kind == "set":
            if not isinstance(a.get("path"), str) or "value" not in a:
                raise RegistrationError("set 操作需要参数 path / value")
        elif op.kind == "map_enum":
            mapping = a.get("mapping")
            if not isinstance(a.get("path"), str) or not isinstance(mapping, dict) \
                    or not mapping:
                raise RegistrationError(
                    "map_enum 操作需要非空参数 path(str) / mapping(dict)"
                )
        elif op.kind == "cast":
            if not isinstance(a.get("path"), str) or a.get("to_type") not in TYPES:
                raise RegistrationError(
                    f"cast 操作需要 path 与合法 to_type（{sorted(TYPES)}）"
                )
        elif op.kind == "drop":
            if not isinstance(a.get("path"), str):
                raise RegistrationError("drop 操作需要字符串参数 path")

    def _resolve_before(self, spec: FieldSpec, ver: Version) -> Optional[ResolvedField]:
        prev = [v for v in [spec.introduced, *spec.changes] if v < ver]
        if not prev:
            return None
        return spec.resolve_at(max(prev))

    def _edges_between(
        self, start: Version, end: Version
    ) -> List[MigrationStep]:
        """start -> end 的有序迁移边；缺边时给出清晰错误。"""
        if start > end:
            raise KernelError(
                f"迁移目标版本 {end} 低于当前版本 {start}，内核只支持向前迁移；"
                "如需恢复旧配置请使用 rollback()"
            )
        edges = sorted(self._steps, key=lambda e: e[0])
        result: List[MigrationStep] = []
        cur = start
        while cur < end:
            nxt = [t for f, t in edges if f == cur]
            if not nxt:
                raise KernelError(
                    f"演进链在版本 {cur} 之后缺少迁移定义，无法迁移到 {end}；"
                    f"已登记的链：{self.migration_chain() or '<空>'}"
                )
            t = nxt[0]
            if t > end:
                raise KernelError(
                    f"迁移目标版本 {end} 不是演进链上的节点（{cur} 的下一条边直达 "
                    f"{t}），请沿链逐版本迁移"
                )
            result.append(self._steps[(cur, t)])
            cur = t
        return result

    # ======================================================================
    # 2/3. 解析与迁移
    # ======================================================================

    def normalize(
        self,
        raw: Dict[str, Any] | Config,
        target: "str | Version",
        *,
        version: Optional["str | Version"] = None,
        name: str = "",
    ) -> Config:
        """把原始配置直接按 ``target`` 版本解析（等价于从零逐版本迁移的结果）。

        ``version`` 指出这份配置是按哪个版本编写的（默认等于 target）：
        老设备读新配置 / 新设备读老配置时用它区分方向。
        """
        target = Version(target)
        if isinstance(raw, Config):
            origin = raw.schema_version
            work = Config(target, name=name or raw.name)
            work.values = copy.deepcopy(raw.values)
            work.sources = copy.deepcopy(raw.sources)
            work.extras = copy.deepcopy(raw.extras)
        else:
            origin = Version(version) if version is not None else target
            work = Config(target, name=name)
            flat = flatten(raw)
            for path, value in flat.items():
                work.set_value(path, value, ST_SET, origin)
        if origin <= target:
            # 与 migrate() 走完全相同的逐边回放，保证两种入口结果逐字节一致
            self._replay(work, origin, target)
            # 无边可走（同版本解析）时仍需完整校验 / 补默认 / 降级；
            # 有边时该调用是幂等收尾，不改变结果
            self._finalize(work, target, origin)
        else:
            self._read_newer_config_on_older(work, origin, target)
            self._finalize(work, target, origin)
        work.schema_version = target
        return work

    def _replay(
        self,
        config: Config,
        start: Version,
        target: Version,
        *,
        record_changes: bool = False,
        records: Optional[List[StepRecord]] = None,
    ) -> List[StepRecord]:
        """沿演进链逐版本迁移，每一步都做一次按该版本的完整收尾。

        成功执行完的边会实时追加进 ``records``（若提供），这样即便某条边
        中途抛错，调用方也能准确知道失败的是哪一条边。
        """
        result_records: List[StepRecord] = records if records is not None else []
        for step in self._edges_between(start, target):
            changes = self._apply_edge(config, step, record_changes=record_changes)
            self._finalize(config, step.to_version, step.from_version)
            config.schema_version = step.to_version
            if record_changes:
                result_records.append(
                    StepRecord(
                        edge=step.label(),
                        ops=[op.to_json() for op in step.ops],
                        changes=changes,
                    )
                )
        return result_records

    def migrate(
        self, config: Config, target: "str | Version"
    ) -> Tuple[Config, MigrationRecord]:
        """把已归一化配置迁移到目标版本，返回（新配置，迁移记录）。

        - 目标等于当前版本：幂等返回内容完全一致的配置，不产生新记录。
        - 中途任何一步失败：配置整体恢复到迁移前状态并抛出 MigrationError。
        """
        target = Version(target)
        if not isinstance(config, Config):
            raise KernelError("migrate() 的入参必须是 Config（先经 normalize 解析）")
        snapshot = config.snapshot()
        if target == config.schema_version:
            # 幂等：重复迁移返回内容完全一致的副本，不产生新记录
            return copy.deepcopy(config), None  # type: ignore[return-value]
        if target < config.schema_version:
            raise KernelError(
                f"迁移目标 {target} 低于当前 {config.schema_version}，"
                "向前迁移不支持降级；请使用 rollback_record()"
            )
        edges = self._edges_between(config.schema_version, target)
        result = copy.deepcopy(config)
        step_records: List[StepRecord] = []
        try:
            self._replay(
                result, config.schema_version, target,
                record_changes=True, records=step_records,
            )
        except (ValidationError, KernelError, ValueError) as exc:
            config.restore(snapshot)  # 输入对象整体回滚到迁移前
            # 已完成的边数之外，第一条未完成的边就是失败边
            failed_step = (
                edges[len(step_records)]
                if len(step_records) < len(edges) else edges[-1]
            )
            raise MigrationError(failed_step.label(), exc) from exc
        # 成功：把输入对象也同步到迁移后状态（调用方持有的引用不会停留在旧状态）
        config.restore(result.snapshot())
        record_id = _digest({
            "kind": "migration",
            "config_name": config.name,
            "from": snapshot["schema_version"].to_json(),
            "to": target.to_json(),
            "values_before": snapshot["values"],
            "edges": [s.to_json() for s in step_records],
        })
        record = MigrationRecord(
            record_id=record_id,
            config_name=config.name,
            from_version=snapshot["schema_version"],
            to_version=target,
            steps=step_records,
            before_snapshot=snapshot,
        )
        # 记录迁移后快照，供回滚时检测配置是否已分叉
        record.after_snapshot = result.snapshot()  # type: ignore[attr-defined]
        self.migration_records.append(record)
        if config.name:
            self.configs[config.name] = result
        return result, record

    def rollback_record(
        self, record_id: Optional[str] = None, *, config_name: Optional[str] = None
    ) -> Tuple[Config, RollbackRecord]:
        """按迁移记录把配置整体恢复到迁移前。

        优先按记录 id 定位；否则取某具名配置最近一次迁移记录。
        若迁移后配置已被改动（与记录的迁移后快照不一致），拒绝回滚并说明。
        """
        record = self._find_record(record_id, config_name)
        current = None
        if record.config_name and record.config_name in self.configs:
            current = self.configs[record.config_name]
        if current is not None:
            after = getattr(record, "after_snapshot", None)
            if after is not None and not self._snapshot_equal(
                current.snapshot(), after
            ):
                raise RollbackError(
                    f"配置 '{record.config_name}' 自迁移 {record.id[:12]} 后已被修改，"
                    "当前状态与迁移后状态不一致，拒绝回滚以免覆盖现场改动"
                )
        restored = Config(record.from_version, name=record.config_name)
        restored.restore(copy.deepcopy(record.before_snapshot))
        record.rolled_back = True
        rb_id = _digest({"kind": "rollback", "migration": record.id})
        rb = RollbackRecord(
            id=rb_id,
            migration_id=record.id,
            config_name=record.config_name,
            restored_to=record.from_version,
        )
        self.rollback_records.append(rb)
        if record.config_name:
            self.configs[record.config_name] = restored
        return restored, rb

    # -- 迁移边执行 ----------------------------------------------------------

    def _apply_edge(
        self, config: Config, step: MigrationStep, *, record_changes: bool = False
    ) -> List[FieldChangeRecord]:
        changes: List[FieldChangeRecord] = []

        def note(path, old, new, sb, sa, text):
            if record_changes:
                changes.append(FieldChangeRecord(path, old, new, sb, sa, text))

        a, b = step.edge
        for op in step.ops:
            args = op.args
            if op.kind == "rename":
                old, new = args["old"], args["new"]
                if old in config.values:
                    if new in config.values:
                        raise KernelError(
                            f"迁移边 {step.label()} 的 rename({old} -> {new}) "
                            "冲突：新旧路径同时存在取值，无法决定保留哪一个"
                        )
                    value = config.values[old]
                    src = config.sources[old]
                    if src.status == ST_DEFAULT:
                        # 老值本就是默认补齐：直接解析时新字段会用自己的默认值，
                        # 这里保持等价——归档老路径，让默认补齐逻辑填新字段。
                        config.remove(old)
                        config.put_extra(IgnoredField(
                            path=old,
                            value=copy.deepcopy(value),
                            reason=R_DROPPED,
                            seen_version=b,
                            origin_version=src.origin_version,
                            detail={"edge": step.label(), "note": (
                                f"老字段 {old} 为默认值，{b} 重命名为 {new} 后"
                                "按新字段默认值补齐，老路径归档")},
                        ))
                        note(old, value, None, ST_DEFAULT, "archived",
                             f"default renamed -> {new}，新字段补默认")
                    else:
                        config.set_value(
                            new, value, ST_RENAMED, src.origin_version,
                            reason=f"由废弃字段 {old} 在 {b} 重命名而来",
                            renamed_from=old,
                        )
                        note(old, value, value, src.status, ST_RENAMED,
                             f"rename -> {new}")
                        config.remove(old)
                        # 老路径归档：后续补默认逻辑不得把它当成“新字段缺省”
                        config.put_extra(IgnoredField(
                            path=old,
                            value=copy.deepcopy(value),
                            reason=R_DROPPED,
                            seen_version=b,
                            origin_version=src.origin_version,
                            detail={"edge": step.label(),
                                    "note": f"字段在 {b} 重命名为 {new}，老路径归档"},
                        ))
            elif op.kind == "set":
                p, v = args["path"], args["value"]
                old = config.values.get(p)
                sb = config.sources[p].status if p in config.sources else ST_DEFAULT
                config.set_value(p, copy.deepcopy(v), ST_SET, b,
                                 reason=f"由迁移边 {step.label()} 的 set 写入")
                note(p, old, v, sb, ST_SET, "set")
            elif op.kind == "map_enum":
                p, mapping = args["path"], args["mapping"]
                if p in config.values and config.values[p] in mapping:
                    old = config.values[p]
                    new = mapping[old]
                    src = config.sources[p]
                    config.set_value(
                        p, new, src.status, src.origin_version,
                        reason=f"枚举值在 {b} 由 {old!r} 映射为 {new!r}",
                        renamed_from=src.renamed_from,
                    )
                    note(p, old, new, src.status, src.status, "map_enum")
            elif op.kind == "cast":
                p, to_type = args["path"], args["to_type"]
                if p in config.values:
                    old = config.values[p]
                    ok, new = self._safe_convert(old, to_type)
                    if not ok:
                        raise KernelError(
                            f"迁移边 {step.label()} 的 cast 无法把字段 '{p}' 的值 "
                            f"{old!r}({type(old).__name__}) 转换为 {to_type}"
                        )
                    src = config.sources[p]
                    config.set_value(p, new, src.status, src.origin_version,
                                     reason=f"类型在 {b} 转换为 {to_type}")
                    note(p, old, new, src.status, src.status, f"cast -> {to_type}")
            elif op.kind == "drop":
                p = args["path"]
                if p in config.values:
                    old = config.values[p]
                    config.move_to_extra(
                        p, R_DROPPED, b,
                        detail={"edge": step.label(), "note": "迁移边显式弃用"},
                    )
                    note(p, old, None,
                         config.sources.get(p).status if p in config.sources else "",
                         "archived", "drop")
        self._auto_handle_field_changes(config, a, b, changes)
        return changes

    def _auto_handle_field_changes(
        self, config: Config, a: Version, b: Version,
        changes: List[FieldChangeRecord],
    ) -> None:
        """处理没有显式迁移操作覆盖的规则变化：新字段补默认、类型变化转换、
        枚举收紧、字段废弃标记。"""
        for path in sorted(self.fields):
            spec = self.fields[path]
            before_rf = spec.resolve_at(a)
            after_rf = spec.resolve_at(b)
            # 新引入字段：缺省则按引入版本补默认
            if before_rf is None and after_rf is not None and path not in config.values:
                config.set_value(
                    path, copy.deepcopy(after_rf.default), ST_DEFAULT, b,
                    reason=f"字段在 {b} 引入，按默认值补齐",
                )
                changes.append(FieldChangeRecord(
                    path, None, after_rf.default, "<缺失>", ST_DEFAULT, "引入补默认"))
                continue
            if before_rf is None or after_rf is None or path not in config.values:
                continue
            src = config.sources[path]
            # 类型变化：默认补齐值直接换成新默认；显式值才尝试转换 / 降级
            if before_rf.ftype != after_rf.ftype:
                if src.status == ST_DEFAULT:
                    old_default = config.values[path]
                    config.set_value(
                        path, copy.deepcopy(after_rf.default), ST_DEFAULT, b,
                        reason=(f"类型在 {b} 从 {before_rf.ftype} 变为 "
                                f"{after_rf.ftype}，老默认值 {old_default!r} "
                                "替换为新默认值"),
                    )
                    changes.append(FieldChangeRecord(
                        path, old_default, after_rf.default,
                        ST_DEFAULT, ST_DEFAULT, "类型变化导致默认值替换"))
                else:
                    ok, converted = self._safe_convert(
                        config.values[path], after_rf.ftype)
                    if not ok:
                        old_value = config.values[path]
                        degraded, new_value, why = self._degrade(
                            after_rf, old_value,
                            f"类型从 {before_rf.ftype} 收紧为 {after_rf.ftype}",
                        )
                        if not degraded:
                            raise ValidationError([FieldProblem(
                                path, FieldProblem.KIND_CANNOT_CONVERT,
                                after_rf.expected_description(),
                                old_value,
                                f"字段 '{path}' 在 {b} 类型从 {before_rf.ftype} "
                                f"收紧为 {after_rf.ftype}，值 "
                                f"{old_value!r} 无法表示，"
                                "且字段策略为 error",
                            )])
                        config.set_value(path, new_value, ST_DEGRADED,
                                         src.origin_version, reason=why,
                                         detail={"original": old_value})
                        changes.append(FieldChangeRecord(
                            path, old_value,
                            new_value, src.status, ST_DEGRADED, why))
                    else:
                        old = config.values[path]
                        config.set_value(path, converted, src.status,
                                         src.origin_version,
                                         reason=(f"类型在 {b} 自动转换为 "
                                                 f"{after_rf.ftype}"))
                        changes.append(FieldChangeRecord(
                            path, old, converted, src.status, src.status,
                            f"自动类型转换 -> {after_rf.ftype}"))
            # 取值收紧（数值范围 / 枚举成员移除）：校验 + 策略
            problems = after_rf.validate_value(config.values[path])
            if problems:
                degraded, new_value, why = self._degrade(
                    after_rf, config.values[path],
                    f"取值在 {b} 收紧，{problems[0].message}",
                )
                if not degraded:
                    raise ValidationError(problems)
                config.set_value(path, new_value, ST_DEGRADED, src.origin_version,
                                 reason=why, detail={"original": config.values[path]})
                changes.append(FieldChangeRecord(
                    path, problems[0].actual, new_value,
                    src.status, ST_DEGRADED, why))
            # 废弃标记（值保留，状态标 deprecated）
            if after_rf.deprecated and src.status not in (ST_DEPRECATED, ST_DEGRADED):
                config.set_value(
                    path, config.values[path], ST_DEPRECATED, src.origin_version,
                    reason=f"字段自 {b} 起废弃，值保留待后续迁移",
                    renamed_from=src.renamed_from,
                )

    def _finalize(self, config: Config, target: Version, origin: Version) -> None:
        """按目标版本收尾：未知字段入 extras、补默认、逐字段校验 / 降级、
        废弃标记。该函数对同一份输入是幂等的。"""
        # 1. 不认识的字段 -> extras（老版本读新配置）
        for path in sorted(config.values):
            spec = self.fields.get(path)
            rf = spec.resolve_at(target) if spec else None
            if rf is None:
                src = config.sources.get(path)
                reason = R_UNKNOWN
                if spec is not None:
                    detail = {"introduced": spec.introduced.to_json(),
                              "target": target.to_json()}
                    text = (f"目标版本 {target} 早于字段引入版本 "
                            f"{spec.introduced}，该字段被忽略（原始值已保留）")
                else:
                    detail = {"registered": False}
                    text = f"字段未在任何版本登记，目标版本 {target} 下被忽略"
                config.move_to_extra(
                    path, reason, target,
                    origin=src.origin_version if src else origin,
                    detail={**detail, "note": text},
                )
        # 2. 已知但取值缺失的字段补默认（新设备读老配置：补齐新能力开关）
        for path in sorted(self.fields):
            spec = self.fields[path]
            rf = spec.resolve_at(target)
            if rf is None or path in config.values:
                continue
            if any(e.path == path for e in config.extras.values()):
                continue
            config.set_value(
                path, copy.deepcopy(rf.default), ST_DEFAULT,
                max(spec.introduced, origin) if origin <= target else spec.introduced,
                reason=(f"目标版本 {target} 下字段缺省，按其引入版本 "
                        f"{spec.introduced} 的默认值补齐"),
            )
        # 3. 逐字段校验，可降级的就地降级；硬问题全部收集后一次性抛出，
        #    避免现场改一个错再冒出下一个
        hard_problems: List[FieldProblem] = []
        for path in sorted(config.values):
            rf = self.fields[path].resolve_at(target)
            assert rf is not None
            problems = rf.validate_value(config.values[path])
            if not problems:
                continue
            degraded, new_value, why = self._degrade(
                rf, config.values[path], problems[0].message
            )
            if degraded:
                src = config.sources[path]
                config.set_value(path, new_value, ST_DEGRADED, src.origin_version,
                                 reason=why, detail={"original": problems[0].actual})
            else:
                hard_problems.extend(problems)
        if hard_problems:
            raise ValidationError(hard_problems)
        # 4. 废弃标记
        for path in sorted(config.values):
            rf = self.fields[path].resolve_at(target)
            if rf and rf.deprecated:
                src = config.sources[path]
                if src.status not in (ST_DEPRECATED, ST_DEGRADED, ST_IGNORED):
                    config.set_value(path, config.values[path], ST_DEPRECATED,
                                     src.origin_version,
                                     reason=f"字段在目标版本 {target} 已废弃",
                                     renamed_from=src.renamed_from)

    def _read_newer_config_on_older(
        self, config: Config, origin: Version, target: Version
    ) -> None:
        """老版本读取新版本编写的配置（origin > target）。

        新字段直接忽略进 extras；收紧的取值按目标版本策略降级；原始值保留。
        """
        # 先让 _finalize 的未知字段逻辑处理“未来字段”，这里只需处理收紧取值
        for path in sorted(config.values):
            spec = self.fields.get(path)
            rf = spec.resolve_at(target) if spec else None
            if rf is None:
                continue  # _finalize 会归入 extras
            problems = rf.validate_value(config.values[path])
            if problems:
                degraded, new_value, why = self._degrade(
                    rf, config.values[path],
                    f"老版本 {target} 无法表示新配置取值：{problems[0].message}",
                )
                if not degraded:
                    raise ValidationError(problems)
                src = config.sources[path]
                config.set_value(path, new_value, ST_DEGRADED, src.origin_version,
                                 reason=why, detail={"original": problems[0].actual})

    # -- 类型转换与降级 ------------------------------------------------------

    @staticmethod
    def _safe_convert(value: Any, to_type: str) -> Tuple[bool, Any]:
        """返回 (是否成功, 转换后的值)。只做无歧义的安全转换。"""
        if to_type == T_FLOAT:
            if isinstance(value, bool):
                return False, None
            if isinstance(value, int):
                return True, float(value)
            if isinstance(value, str):
                try:
                    return True, float(value)
                except ValueError:
                    return False, None
        if to_type == T_INT:
            if isinstance(value, bool):
                return False, None
            if isinstance(value, int):
                return True, value
            if isinstance(value, float) and value.is_integer():
                return True, int(value)
            if isinstance(value, str):
                try:
                    return True, int(value)
                except ValueError:
                    return False, None
        if to_type == T_STR:
            if isinstance(value, str):
                return True, value
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                return True, str(value)
        if to_type == T_ENUM and isinstance(value, str):
            return True, value
        return False, None

    @staticmethod
    def _degrade(
        rf: ResolvedField, value: Any, cause: str
    ) -> Tuple[bool, Any, str]:
        """按字段策略把不合法取值降级。返回 (是否降级, 新值, 说明)。"""
        if rf.range_policy == POLICY_CLAMP and rf.ftype in (T_INT, T_FLOAT):
            clamped = value
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                if rf.min_value is not None and value < rf.min_value:
                    clamped = type(value)(rf.min_value) if rf.ftype == T_INT \
                        else float(rf.min_value)
                    if rf.ftype == T_INT:
                        clamped = int(rf.min_value)
                elif rf.max_value is not None and value > rf.max_value:
                    clamped = int(rf.max_value) if rf.ftype == T_INT \
                        else float(rf.max_value)
                return True, clamped, (
                    f"降级（clamp）：{cause}；原值 {value!r} 夹取为 {clamped!r}，"
                    "原始值记录在 detail.original"
                )
        if rf.range_policy == POLICY_FALLBACK and rf.ftype == T_ENUM:
            if rf.degrade_fallback is not None:
                return True, copy.deepcopy(rf.degrade_fallback), (
                    f"降级（fallback）：{cause}；原值 {value!r} 替换为兜底值 "
                    f"{rf.degrade_fallback!r}，原始值记录在 detail.original"
                )
        return False, None, ""

    # ======================================================================
    # 4. 设备应用与查询
    # ======================================================================

    def apply(
        self,
        raw: Dict[str, Any] | Config,
        model_name: str,
        fw: "str | Version",
        *,
        version: Optional["str | Version"] = None,
        name: str = "",
    ) -> Config:
        """把配置应用到具体设备：先按固件版本解析，再逐字段做能力判定。

        - 设备缺能力：字段取值移至 extras 并以默认值占位、状态 ignored；
        - 未知字段：extras 标记 unknown；
        - 取值收紧：按字段策略降级（degraded）；
        - 类型错误等硬问题：抛出带完整字段路径 / 期望 / 实际的 ValidationError。
        """
        model = self._model(model_name)
        fw = Version(fw)
        if not model.has_firmware(fw):
            raise RegistrationError(
                f"型号 '{model_name}' 未登记固件版本 {fw}，无法应用配置"
            )
        applied = self.normalize(raw, fw, version=version, name=name)
        for path in sorted(applied.values):
            rf = self.fields[path].resolve_at(fw)
            cap = rf.required_capability
            if cap is not None and not model.supports(cap, fw):
                original = applied.values[path]
                src = applied.sources[path]
                since = model.since_version(cap)
                applied.move_to_extra(
                    path, R_CAPABILITY, fw,
                    origin=src.origin_version,
                    detail={
                        "capability": cap,
                        "model": model_name,
                        "model_supports_since": since.to_json() if since else None,
                        "note": (
                            f"型号 '{model_name}' 在固件 {fw} 不支持能力 "
                            f"'{cap}'，字段被忽略，原始值已保留"),
                    },
                )
                applied.set_value(
                    path, copy.deepcopy(rf.default), ST_IGNORED,
                    src.origin_version,
                    reason=(f"设备缺少能力 '{cap}'，按默认值降级占位；"
                            f"实际取值 {original!r} 已保留在 extras"),
                    detail={"original": original, "capability": cap},
                )
        applied.model_name = model_name
        applied.firmware = fw
        return applied

    def field_info(
        self, config: Config, path: str, *, model_name: Optional[str] = None,
        fw: Optional["str | Version"] = None,
    ) -> dict:
        """回答某字段在配置（及可选的具体设备）上的最终取值与来龙去脉。"""
        info: Dict[str, Any] = {"path": path}
        spec = self.fields.get(path)
        target = config.schema_version
        rf = spec.resolve_at(target) if spec else None
        if rf is None:
            extra = config.extras.get(path)
            info.update({
                "present": False,
                "status": extra.reason if extra else "not_registered",
                "value": extra.value if extra else None,
                "origin_version": (
                    extra.origin_version.to_json() if extra else None),
                "reason": extra.detail.get("note", extra.reason) if extra else
                    f"字段 '{path}' 在版本 {target} 不存在或未登记",
                "ignored": True,
                "degraded": False,
            })
            return info
        info["rule_version"] = target.to_json()
        info["ftype"] = rf.ftype
        info["default"] = rf.default
        info["deprecated"] = rf.deprecated
        info["required_capability"] = rf.required_capability
        if path in config.values:
            src = config.sources[path]
            info.update({
                "present": True,
                "value": config.values[path],
                "status": src.status,
                "origin_version": src.origin_version.to_json(),
                "reason": src.reason,
                "renamed_from": src.renamed_from,
                "ignored": src.status == ST_IGNORED,
                "degraded": src.status == ST_DEGRADED,
                "original_value": src.detail.get("original"),
            })
        else:
            extra = config.extras.get(path)
            info.update({
                "present": False,
                "value": extra.value if extra else rf.default,
                "status": extra.reason if extra else "missing",
                "origin_version": extra.origin_version.to_json() if extra else None,
                "reason": extra.detail.get("note", "") if extra else
                    "字段无取值且无记录",
                "ignored": extra is not None,
                "degraded": False,
            })
        if model_name is not None and fw is not None:
            model = self._model(model_name)
            fw = Version(fw)
            if rf.required_capability:
                info["device_capability_ok"] = model.supports(
                    rf.required_capability, fw)
            else:
                info["device_capability_ok"] = True
        return info

    def diff(
        self,
        config: Config,
        target: Optional["str | Version"] = None,
        *,
        model_name: Optional[str] = None,
        fw: Optional["str | Version"] = None,
    ) -> List[dict]:
        """配置相对目标版本（默认其自身版本）的字段差异，按路径稳定排序。

        每条：{path, category, actual, expected(default), status, origin_version,
        reason}。category 取值：
        explicit/default/ignored/degraded/deprecated/renamed/unknown/
        capability_missing/dropped。
        """
        target = Version(target) if target is not None else config.schema_version
        model = self._model(model_name) if model_name else None
        fwv = Version(fw) if fw is not None else target
        entries: List[dict] = []
        for path in sorted(self.fields):
            rf = self.fields[path].resolve_at(target)
            if rf is None:
                # 字段在目标版本尚未引入：若配置里带着它（老版本读新配置），
                # 按 extras 中的忽略原因分类
                extra = config.extras.get(path)
                if extra is not None:
                    category = {
                        R_UNKNOWN: "unknown",
                        R_CAPABILITY: "capability_missing",
                        R_DROPPED: "dropped",
                        R_UNSUPPORTED_VALUE: "unsupported_value",
                    }.get(extra.reason, extra.reason)
                    entries.append(self._diff_entry(
                        path, category, extra.value, None, extra))
                continue
            if path in config.values:
                value = config.values[path]
                src = config.sources[path]
                if model is not None and rf.required_capability and not model.supports(
                    rf.required_capability, fwv
                ):
                    category = "capability_missing"
                elif src.status == ST_DEGRADED:
                    category = "degraded"
                elif rf.deprecated:
                    # 规则本身在目标版本已废弃（无论值是显式还是迁移而来）
                    category = "deprecated"
                else:
                    category = {
                        ST_SET: "explicit",
                        ST_DEFAULT: "default",
                        ST_RENAMED: "renamed",
                        ST_IGNORED: "ignored",
                        ST_DEPRECATED: "deprecated",
                    }.get(src.status, src.status)
                entries.append({
                    "path": path,
                    "category": category,
                    "actual": value,
                    "expected": copy.deepcopy(rf.default),
                    "status": src.status,
                    "origin_version": src.origin_version.to_json(),
                    "reason": src.reason,
                    "is_default": value == rf.default
                    and src.status in (ST_DEFAULT, ST_SET),
                })
            else:
                extra = config.extras.get(path)
                if extra is not None:
                    entries.append(self._diff_entry(
                        path, "dropped", extra.value, rf.default, extra))
                else:
                    entries.append({
                        "path": path,
                        "category": "missing",
                        "actual": None,
                        "expected": copy.deepcopy(rf.default),
                        "status": "missing",
                        "origin_version": None,
                        "reason": "字段在配置中缺失",
                        "is_default": False,
                    })
        # 未登记 / 未来字段
        for path in sorted(config.extras):
            if any(e["path"] == path for e in entries):
                continue
            extra = config.extras[path]
            category = {
                R_UNKNOWN: "unknown",
                R_CAPABILITY: "capability_missing",
                R_DROPPED: "dropped",
                R_UNSUPPORTED_VALUE: "unsupported_value",
            }.get(extra.reason, extra.reason)
            entries.append(self._diff_entry(
                path, category, extra.value, None, extra))
        return entries

    @staticmethod
    def _diff_entry(path, category, actual, expected, extra: IgnoredField) -> dict:
        return {
            "path": path,
            "category": category,
            "actual": actual,
            "expected": expected,
            "status": extra.reason,
            "origin_version": extra.origin_version.to_json(),
            "reason": extra.detail.get("note", extra.reason),
            "is_default": False,
        }

    # ======================================================================
    # 迁移记录查询
    # ======================================================================

    def _find_record(
        self, record_id: Optional[str], config_name: Optional[str]
    ) -> MigrationRecord:
        if record_id is not None:
            for rec in reversed(self.migration_records):
                if rec.id == record_id:
                    return rec
            raise RollbackError(f"找不到迁移记录 {record_id}")
        name = config_name
        if name is None and len(self.configs) == 1:
            name = next(iter(self.configs))
        if name is None:
            raise RollbackError("回滚需要提供 record_id 或具名配置 config_name")
        for rec in reversed(self.migration_records):
            if rec.config_name == name:
                return rec
        raise RollbackError(f"配置 '{name}' 没有可回滚的迁移记录")

    @staticmethod
    def _snapshot_equal(a: dict, b: dict) -> bool:
        return _canonical(_snapshot_to_json(a)) == _canonical(_snapshot_to_json(b))

    # ======================================================================
    # 5. JSON 持久化（见 persistence.py 中的 save/load）
    # ======================================================================

    def to_payload(self) -> dict:
        return {
            "format": self.FORMAT,
            "capabilities": [self.capabilities[k].to_json()
                             for k in sorted(self.capabilities)],
            "models": [self.models[k].to_json() for k in sorted(self.models)],
            "fields": [self.fields[k].to_json() for k in sorted(self.fields)],
            "migration_steps": [
                self._steps[e].to_json()
                for e in sorted(self._steps, key=lambda x: x[0])
            ],
            "configs": [self.configs[k].to_json() for k in sorted(self.configs)],
            "migration_records": [r.to_json() for r in self.migration_records],
            "rollback_records": [r.to_json() for r in self.rollback_records],
        }
