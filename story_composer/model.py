"""编排模块的数据模型（全部为不可变值对象）。

核心概念
========
- ``MaterialUnit``：素材单元。有唯一标识、类型、正文、版本号；可声明前置依赖。
  同一逻辑素材的多个"替代版本"用相同 ``group`` 串起来（group 缺省取单元 id，
  即该单元没有替代版本）。
- ``NarrativeGoal``：叙事目标。有唯一标识、受众取向，以及一组有序槽位。
- ``Slot``：段落槽位。声明所需素材类型、是否必填。
- ``Selection``：某个来源对 (目标, 槽位) 给出的素材选择。
- ``SlotResolution``：槽位的解析结果（单素材 / 双方矛盾的冲突）。
- ``ConflictRecord``：可读的冲突记录。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import FrozenSet, Optional, Tuple

# 素材"来源"：谁给出的选择，例如编剧手工指派 "editor"、自动组合器 "auto"。
# 来源相同、槽位相同却给出不同素材属于硬冲突，直接拒绝（见 SlotConflictError）；
# 来源不同则双方都保留并生成冲突记录（需求 6）。
Source = str

# 单元的稳定指纹：(组, 版本号, id)。版本选择与缓存失效都基于它。
Fingerprint = Tuple[str, int, str]


@dataclass(frozen=True)
class MaterialUnit:
    """素材单元。

    - ``unit_id``：全局唯一标识。
    - ``unit_type``：素材类型，须与槽位所需类型一致。
    - ``body``：正文。
    - ``version``：版本号，同一 group 内越大越新（整数，便于确定性比较）。
    - ``prerequisites``：前置依赖单元的 id（frozenset，顺序无关）。
    - ``group``：替代版本组 id；同组单元互为替代版本。缺省等于 unit_id。
    """

    unit_id: str
    unit_type: str
    body: str
    version: int = 1
    prerequisites: FrozenSet[str] = frozenset()
    group: Optional[str] = None

    def __post_init__(self):
        if not isinstance(self.unit_id, str) or not self.unit_id:
            raise ValueError("素材单元 id 必须是非空字符串")
        if not isinstance(self.unit_type, str) or not self.unit_type:
            raise ValueError(f"素材 '{self.unit_id}' 的类型必须是非空字符串")
        if not isinstance(self.version, int) or isinstance(self.version, bool):
            raise ValueError(f"素材 '{self.unit_id}' 的版本号必须是整数")
        if self.version < 1:
            raise ValueError(f"素材 '{self.unit_id}' 的版本号必须 >= 1")
        if not isinstance(self.body, str):
            raise ValueError(f"素材 '{self.unit_id}' 的正文必须是字符串")
        prs = []
        for dep in self.prerequisites:
            if not isinstance(dep, str) or not dep:
                raise ValueError(
                    f"素材 '{self.unit_id}' 的前置依赖 id 必须是非空字符串"
                )
            prs.append(dep)
        if len(prs) != len(set(prs)):
            raise ValueError(f"素材 '{self.unit_id}' 的前置依赖存在重复")
        # dataclass(frozen=True) 下用 object.__setattr__ 做规范化
        object.__setattr__(self, "prerequisites", frozenset(prs))
        if self.unit_id in self.prerequisites:
            raise ValueError(f"素材 '{self.unit_id}' 不能依赖自身")
        if self.group is None:
            object.__setattr__(self, "group", self.unit_id)
        elif not isinstance(self.group, str) or not self.group:
            raise ValueError(f"素材 '{self.unit_id}' 的 group 必须是非空字符串")

    @property
    def fingerprint(self) -> Fingerprint:
        """该版本的稳定指纹；指纹不变则解析结果不需要重算。"""
        return (self.group, self.version, self.unit_id)


@dataclass(frozen=True)
class Slot:
    """段落槽位。"""

    slot_id: str
    required_type: str
    required: bool = True

    def __post_init__(self):
        if not isinstance(self.slot_id, str) or not self.slot_id:
            raise ValueError("槽位 id 必须是非空字符串")
        if not isinstance(self.required_type, str) or not self.required_type:
            raise ValueError(f"槽位 '{self.slot_id}' 的所需类型必须是非空字符串")
        if not isinstance(self.required, bool):
            raise ValueError(f"槽位 '{self.slot_id}' 的 required 必须是布尔值")


@dataclass(frozen=True)
class NarrativeGoal:
    """叙事目标：受众取向 + 有序段落槽位。"""

    goal_id: str
    audience: str
    slots: Tuple[Slot, ...]

    def __init__(self, goal_id, audience, slots):
        if not isinstance(goal_id, str) or not goal_id:
            raise ValueError("叙事目标 id 必须是非空字符串")
        if not isinstance(audience, str) or not audience:
            raise ValueError(f"目标 '{goal_id}' 的受众取向必须是非空字符串")
        norm = tuple(slots)
        if not norm:
            raise ValueError(f"目标 '{goal_id}' 至少要有一个槽位")
        for s in norm:
            if not isinstance(s, Slot):
                raise ValueError(f"目标 '{goal_id}' 的槽位必须是 Slot 实例")
        ids = [s.slot_id for s in norm]
        dup = sorted({x for x in ids if ids.count(x) > 1})
        if dup:
            raise ValueError(
                f"目标 '{goal_id}' 的槽位 id 重复：{', '.join(dup)}"
            )
        object.__setattr__(self, "goal_id", goal_id)
        object.__setattr__(self, "audience", audience)
        object.__setattr__(self, "slots", norm)

    def slot_index(self, slot_id: str) -> int:
        for i, s in enumerate(self.slots):
            if s.slot_id == slot_id:
                return i
        raise KeyError(slot_id)


@dataclass(frozen=True)
class Selection:
    """某个来源对 (目标, 槽位) 给出的素材选择。"""

    goal_id: str
    slot_id: str
    source: Source
    unit_id: str


@dataclass(frozen=True)
class ChosenUnit:
    """槽位最终入选的一个素材版本（含来源）。"""

    unit_id: str
    version: int
    group: str
    source: Source


@dataclass(frozen=True)
class ConflictRecord:
    """同一槽位被不同来源给出互相矛盾的素材选择。

    双方（及多方）选择全部保留，绝不静默择一。
    """

    goal_id: str
    slot_id: str
    choices: Tuple[ChosenUnit, ...]

    def render(self) -> str:
        """生成人类可读的冲突描述。"""
        parts = [
            f"素材 {c.unit_id}(v{c.version}, 来源 '{c.source}')" for c in self.choices
        ]
        return (
            f"[冲突] 目标 '{self.goal_id}' 槽位 '{self.slot_id}' 存在 "
            f"{len(self.choices)} 个互相矛盾的素材选择：" + " vs ".join(parts)
        )


@dataclass(frozen=True)
class SlotResolution:
    """单个槽位的解析结果。

    - 无选择：``choices`` 为空。
    - 一致：所有来源选择了同一 group 的同一版本，``chosen`` 即该版本，
      ``sources`` 列出全部一致来源。
    - 矛盾：选择落到不同 group，``conflict`` 保留双方，``chosen`` 为 None。

    同组多版本共存的情况（A v1 vs A v2）由版本选择规则消解，不算矛盾，
    详见 composer 模块文档。
    """

    slot_id: str
    required_type: str
    required: bool
    position: int
    choices: Tuple[ChosenUnit, ...]
    sources: Tuple[Source, ...]
    chosen: Optional[ChosenUnit]
    conflict: Optional[ConflictRecord]

    @property
    def is_empty(self) -> bool:
        return not self.choices

    @property
    def is_conflicted(self) -> bool:
        return self.conflict is not None


@dataclass(frozen=True)
class SequenceEntry:
    """素材序列中的一个条目：槽位与其入选素材（冲突/未填时入选素材为 None）。"""

    position: int
    slot_id: str
    required_type: str
    required: bool
    unit_id: Optional[str]
    version: Optional[int]
    sources: Tuple[Source, ...]


@dataclass(frozen=True)
class GoalSequence:
    """某目标当前的完整素材序列。"""

    goal_id: str
    audience: str
    entries: Tuple[SequenceEntry, ...]

    def material_ids(self) -> Tuple[str, ...]:
        """已填入素材的单元 id 序列（跳过未填/冲突槽位）。"""
        return tuple(e.unit_id for e in self.entries if e.unit_id is not None)


@dataclass(frozen=True)
class UnitReference:
    """素材被某目标的某槽位引用的一条记录。"""

    goal_id: str
    slot_id: str
    source: Source
    unit_id: str
    version: int
    # 该引用当前是否真正入选（False 表示它处于被版本规则盖过或冲突保留状态）
    effective: bool
