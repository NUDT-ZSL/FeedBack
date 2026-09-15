"""字段规则（schema）：类型、取值范围、枚举成员、引入/废弃版本、默认值。

一个 :class:`FieldSpec` 描述一个点分字段路径（如 ``net.wifi.power``）的完整
演进史：它在 ``introduced`` 版本进入系统，之后每个变化版本用一条
:class:`FieldChange` 声明“默认值变了 / 类型收紧了 / 枚举扩值了 / 字段废弃了”。

枚举成员本身也是分版本的：每个枚举值都记录引入版本，因此“1.x 的合法枚举在
2.0 被移除”“2.1 新增成员”都能精确表达。

本模块只关心字段规则与纯值校验，与具体设备型号解耦——能力相关的判定在
:mod:`cfgkernel.model` 与解析引擎中完成。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .errors import FieldProblem
from .version import Version

# ---------------------------------------------------------------------------
# 支持的类型
# ---------------------------------------------------------------------------

T_BOOL = "bool"
T_INT = "int"
T_FLOAT = "float"
T_STR = "str"
T_ENUM = "enum"
T_LIST = "list"

TYPES = frozenset({T_BOOL, T_INT, T_FLOAT, T_STR, T_ENUM, T_LIST})

# 类型收紧 / 迁移时无法表示旧值时的策略
POLICY_ERROR = "error"    # 严格：迁移失败（再由引擎触发整体回滚）
POLICY_CLAMP = "clamp"    # 数值：夹到范围内，并在结果上打“降级”标记
POLICY_FALLBACK = "fallback"  # 枚举：替换为 degrade_fallback，并打“降级”标记

POLICIES = frozenset({POLICY_ERROR, POLICY_CLAMP, POLICY_FALLBACK})

_UNSET = object()


@dataclass(frozen=True)
class EnumMember:
    """枚举成员：值 + 引入版本 + 可选废弃/移除版本。

    removed 为 None 表示仍有效；一旦设置，在该版本及以后该成员非法
    （收紧场景），配合字段的 range_policy 决定报错还是降级。
    """

    value: str
    introduced: Version
    removed: Optional[Version] = None

    def active_at(self, ver: Version) -> bool:
        return self.introduced <= ver and (self.removed is None or ver < self.removed)

    def to_json(self) -> dict:
        return {
            "value": self.value,
            "introduced": self.introduced.to_json(),
            "removed": self.removed.to_json() if self.removed else None,
        }

    @classmethod
    def from_json(cls, data: dict) -> "EnumMember":
        return cls(
            value=data["value"],
            introduced=Version(data["introduced"]),
            removed=Version(data["removed"]) if data.get("removed") else None,
        )


@dataclass(frozen=True)
class FieldChange:
    """字段在某个版本发生的规则变化。

    所有参数除 version 外均可选，未给的属性沿用前一版本规则。
    """

    version: Version
    ftype: Optional[str] = None
    default: Any = _UNSET
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    elem_type: Optional[str] = None
    enum_members_added: Tuple[EnumMember, ...] = field(default_factory=tuple)
    enum_members_removed: Tuple[str, ...] = field(default_factory=tuple)
    deprecated: Optional[bool] = None
    range_policy: Optional[str] = None
    degrade_fallback: Any = _UNSET

    def to_json(self) -> dict:
        data: Dict[str, Any] = {"version": self.version.to_json()}
        if self.ftype is not None:
            data["ftype"] = self.ftype
        if self.default is not _UNSET:
            data["default"] = self.default
        if self.min_value is not None:
            data["min_value"] = self.min_value
        if self.max_value is not None:
            data["max_value"] = self.max_value
        if self.min_length is not None:
            data["min_length"] = self.min_length
        if self.max_length is not None:
            data["max_length"] = self.max_length
        if self.elem_type is not None:
            data["elem_type"] = self.elem_type
        if self.enum_members_added:
            data["enum_members_added"] = [m.to_json() for m in self.enum_members_added]
        if self.enum_members_removed:
            data["enum_members_removed"] = list(self.enum_members_removed)
        if self.deprecated is not None:
            data["deprecated"] = self.deprecated
        if self.range_policy is not None:
            data["range_policy"] = self.range_policy
        if self.degrade_fallback is not _UNSET:
            data["degrade_fallback"] = self.degrade_fallback
        return data

    @classmethod
    def from_json(cls, data: dict) -> "FieldChange":
        return cls(
            version=Version(data["version"]),
            ftype=data.get("ftype"),
            default=data.get("default", _UNSET),
            min_value=data.get("min_value"),
            max_value=data.get("max_value"),
            min_length=data.get("min_length"),
            max_length=data.get("max_length"),
            elem_type=data.get("elem_type"),
            enum_members_added=tuple(
                EnumMember.from_json(m) for m in data.get("enum_members_added", [])
            ),
            enum_members_removed=tuple(data.get("enum_members_removed", [])),
            deprecated=data.get("deprecated"),
            range_policy=data.get("range_policy"),
            degrade_fallback=data.get("degrade_fallback", _UNSET),
        )


@dataclass(frozen=True)
class ResolvedField:
    """字段规则在某个具体版本上的“快照”，校验只依赖它。"""

    path: str
    version: Version
    ftype: str
    default: Any
    introduced: Version
    deprecated: bool
    min_value: Optional[float]
    max_value: Optional[float]
    min_length: Optional[int]
    max_length: Optional[int]
    elem_type: Optional[str]
    enum_members: Tuple[EnumMember, ...]
    range_policy: str
    degrade_fallback: Any
    required_capability: Optional[str]

    # -- 状态 -------------------------------------------------------------

    def exists_at(self, ver: Version) -> bool:
        return self.introduced <= ver

    def enum_values(self) -> Tuple[str, ...]:
        return tuple(m.value for m in self.enum_members if m.active_at(self.version))

    # -- 期望描述 ---------------------------------------------------------

    def expected_description(self) -> str:
        if self.ftype == T_ENUM:
            vals = "|".join(self.enum_values())
            return f"枚举 [{vals}]"
        bits = [self.ftype]
        if self.ftype == T_INT and self.min_value is not None and self.max_value is not None:
            bits.append(f"范围 [{_num(self.min_value)}, {_num(self.max_value)}]")
        elif self.ftype == T_FLOAT and (
            self.min_value is not None or self.max_value is not None
        ):
            lo = "-∞" if self.min_value is None else _num(self.min_value)
            hi = "+∞" if self.max_value is None else _num(self.max_value)
            bits.append(f"范围 [{lo}, {hi}]")
        elif self.ftype == T_STR and (
            self.min_length is not None or self.max_length is not None
        ):
            lo = "0" if self.min_length is None else str(self.min_length)
            hi = "∞" if self.max_length is None else str(self.max_length)
            bits.append(f"长度 [{lo}, {hi}]")
        elif self.ftype == T_LIST:
            if self.min_length is not None or self.max_length is not None:
                lo = "0" if self.min_length is None else str(self.min_length)
                hi = "∞" if self.max_length is None else str(self.max_length)
                bits.append(f"元素数 [{lo}, {hi}]")
            if self.elem_type:
                bits.append(f"元素类型 {self.elem_type}")
        return "，".join(bits)

    # -- 纯值校验：返回问题列表（空列表表示通过） --------------------------

    def validate_value(self, value: Any) -> List[FieldProblem]:
        problems: List[FieldProblem] = []
        if not _check_type(value, self.ftype, self.elem_type):
            actual_type = type(value).__name__
            problems.append(
                FieldProblem(
                    self.path,
                    FieldProblem.KIND_TYPE,
                    self.expected_description(),
                    value,
                    f"字段 '{self.path}' 类型不符：期望 {self.expected_description()}，"
                    f"实际 {actual_type} 类型值 {value!r}",
                )
            )
            return problems  # 类型不对，范围校验没有意义

        if self.ftype in (T_INT, T_FLOAT):
            if self.min_value is not None and value < self.min_value:
                problems.append(_range_problem(self, value))
            elif self.max_value is not None and value > self.max_value:
                problems.append(_range_problem(self, value))
        elif self.ftype == T_STR:
            if self.min_length is not None and len(value) < self.min_length:
                problems.append(_range_problem(self, value))
            elif self.max_length is not None and len(value) > self.max_length:
                problems.append(_range_problem(self, value))
        elif self.ftype == T_ENUM:
            allowed = self.enum_values()
            if value not in allowed:
                problems.append(
                    FieldProblem(
                        self.path,
                        FieldProblem.KIND_ENUM,
                        f"枚举 [{ '|'.join(allowed) }]",
                        value,
                        f"字段 '{self.path}' 枚举值非法：期望 [{ '|'.join(allowed) }]，"
                        f"实际 {value!r}",
                    )
                )
        elif self.ftype == T_LIST:
            length = len(value)
            if self.min_length is not None and length < self.min_length:
                problems.append(_range_problem(self, value))
            elif self.max_length is not None and length > self.max_length:
                problems.append(_range_problem(self, value))
            if self.elem_type is not None:
                for index, elem in enumerate(value):
                    if not _check_type(elem, self.elem_type, None):
                        problems.append(
                            FieldProblem(
                                f"{self.path}[{index}]",
                                FieldProblem.KIND_TYPE,
                                f"列表元素类型 {self.elem_type}",
                                elem,
                                f"字段 '{self.path}[{index}]' 元素类型不符：期望 "
                                f"{self.elem_type}，实际 {type(elem).__name__} 类型值 {elem!r}",
                            )
                        )
        return problems

    def to_json(self) -> dict:
        return {
            "path": self.path,
            "version": self.version.to_json(),
            "ftype": self.ftype,
            "default": self.default,
            "introduced": self.introduced.to_json(),
            "deprecated": self.deprecated,
            "min_value": self.min_value,
            "max_value": self.max_value,
            "min_length": self.min_length,
            "max_length": self.max_length,
            "elem_type": self.elem_type,
            "enum_members": [m.to_json() for m in self.enum_members],
            "range_policy": self.range_policy,
            "degrade_fallback": self.degrade_fallback,
            "required_capability": self.required_capability,
        }


def _num(x: float) -> str:
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def _range_problem(rf: ResolvedField, value: Any) -> FieldProblem:
    return FieldProblem(
        rf.path,
        FieldProblem.KIND_RANGE,
        rf.expected_description(),
        value,
        f"字段 '{rf.path}' 取值越界：期望 {rf.expected_description()}，实际 {value!r}",
    )


def _check_type(value: Any, ftype: str, elem_type: Optional[str]) -> bool:
    # 注意：Python 中 bool 是 int 的子类，必须先排除
    if ftype == T_BOOL:
        return isinstance(value, bool)
    if ftype == T_INT:
        return isinstance(value, int) and not isinstance(value, bool)
    if ftype == T_FLOAT:
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if ftype == T_STR:
        return isinstance(value, str)
    if ftype == T_ENUM:
        return isinstance(value, str)
    if ftype == T_LIST:
        return isinstance(value, list)
    return False


class FieldSpec:
    """字段的完整演进规则（不可对外直接修改，统一由内核登记构造）。"""

    def __init__(
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
        degrade_fallback: Any = _UNSET,
    ) -> None:
        self.path = path
        self.introduced = Version(introduced)
        self.changes: Dict[Version, FieldChange] = {}
        # 引入版本上的初始规则，以一条隐式 change 保存，便于统一 resolve
        initial_members: List[EnumMember] = []
        seen: Dict[str, EnumMember] = {}
        for item in enum_members or []:
            name, intro = item
            if name in seen:
                raise ValueError(f"枚举成员重复: {name}")
            member = EnumMember(value=name, introduced=Version(intro))
            seen[name] = member
            initial_members.append(member)
        self._initial = FieldChange(
            version=self.introduced,
            ftype=ftype,
            default=default,
            min_value=min_value,
            max_value=max_value,
            min_length=min_length,
            max_length=max_length,
            elem_type=elem_type,
            enum_members_added=tuple(initial_members),
            deprecated=False,
            range_policy=range_policy,
            degrade_fallback=degrade_fallback,
        )
        self.required_capability = required_capability

    # -- 变化登记（由 kernel 转发，参数校验集中在 kernel 做） ----------------

    def add_change(self, change: FieldChange) -> None:
        if change.version in self.changes or change.version == self.introduced:
            raise ValueError(
                f"字段 '{self.path}' 在版本 {change.version} 已存在规则定义，"
                "同一字段同一版本不得重复登记"
            )
        self.changes[change.version] = change

    # -- 解析某版本上的规则快照 --------------------------------------------

    def resolve_at(self, ver: Version) -> Optional[ResolvedField]:
        """返回该字段在 ver 上的规则；ver 早于引入版本时返回 None。"""
        if ver < self.introduced:
            return None
        chain = sorted(self.changes)
        current = self._initial
        members: Dict[str, EnumMember] = {
            m.value: m for m in current.enum_members_added
        }
        state = {
            "ftype": current.ftype,
            "default": current.default,
            "min_value": current.min_value,
            "max_value": current.max_value,
            "min_length": current.min_length,
            "max_length": current.max_length,
            "elem_type": current.elem_type,
            "deprecated": False,
            "range_policy": current.range_policy or POLICY_ERROR,
            "degrade_fallback": current.degrade_fallback,
        }
        for cv in chain:
            if cv > ver:
                break
            ch = self.changes[cv]
            members.update({m.value: m for m in ch.enum_members_added})
            for removed in ch.enum_members_removed:
                old = members.get(removed)
                if old is None:
                    raise ValueError(
                        f"字段 '{self.path}' 在 {cv} 试图移除不存在的枚举成员 {removed!r}"
                    )
                if old.removed is not None:
                    raise ValueError(
                        f"字段 '{self.path}' 的枚举成员 {removed!r} 已在 "
                        f"{old.removed} 移除，不得在 {cv} 重复移除"
                    )
                members[removed] = EnumMember(
                    value=old.value, introduced=old.introduced, removed=cv
                )
            # default / degrade_fallback 以 _UNSET 表示“沿用”，显式 None 是合法新值；
            # 其余属性以 None 表示“沿用”。
            if ch.default is not _UNSET:
                state["default"] = ch.default
            if ch.degrade_fallback is not _UNSET:
                state["degrade_fallback"] = ch.degrade_fallback
            for attr in (
                "ftype", "min_value", "max_value", "min_length",
                "max_length", "elem_type", "deprecated", "range_policy",
            ):
                val = getattr(ch, attr)
                if val is not None:
                    state[attr] = val
        active_members = tuple(
            m for m in (members[k] for k in sorted(members)) if m.active_at(ver)
        )
        return ResolvedField(
            path=self.path,
            version=ver,
            ftype=state["ftype"],
            default=state["default"],
            introduced=self.introduced,
            deprecated=bool(state["deprecated"]),
            min_value=state["min_value"],
            max_value=state["max_value"],
            min_length=state["min_length"],
            max_length=state["max_length"],
            elem_type=state["elem_type"],
            enum_members=active_members,
            range_policy=state["range_policy"] or POLICY_ERROR,
            degrade_fallback=state["degrade_fallback"],
            required_capability=self.required_capability,
        )

    def change_versions(self) -> List[Version]:
        return sorted(self.changes)

    # -- 序列化 ------------------------------------------------------------

    def to_json(self) -> dict:
        return {
            "path": self.path,
            "introduced": self.introduced.to_json(),
            "required_capability": self.required_capability,
            "initial": self._initial.to_json(),
            "changes": [self.changes[v].to_json() for v in sorted(self.changes)],
        }

    @classmethod
    def from_json(cls, data: dict) -> "FieldSpec":
        initial = FieldChange.from_json(data["initial"])
        spec = cls(
            path=data["path"],
            ftype=initial.ftype or T_STR,
            introduced=data["introduced"],
            default=initial.default,
            min_value=initial.min_value,
            max_value=initial.max_value,
            min_length=initial.min_length,
            max_length=initial.max_length,
            elem_type=initial.elem_type,
            enum_members=[
                (m.value, m.introduced.to_json())
                for m in initial.enum_members_added
            ],
            required_capability=data.get("required_capability"),
            range_policy=initial.range_policy or POLICY_ERROR,
            degrade_fallback=initial.degrade_fallback,
        )
        for ch_data in data.get("changes", []):
            spec.add_change(FieldChange.from_json(ch_data))
        return spec
