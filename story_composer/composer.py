"""互动叙事素材编排引擎（仅依赖标准库）。

确定性版本选择规则
==================
同一槽位收到的全部选择按"替代版本组"（``MaterialUnit.group``）归并：

1. 若所有选择都落在**同一个组**（同一素材的不同替代版本），按
   ``(版本号降序, 单元 id 字典序升序)`` 选出唯一入选版本——即优先新版本，
   版本相同（同分）时按标识字典序打破平局。所有给出选择的来源都记为一致来源。
2. 若选择落在**不同组**，属于互相矛盾的素材选择，双方全部保留、生成冲突记录，
   绝不静默择一（需求 6）。
3. 槽位没有任何选择时为空；必填槽位是否缺失可通过 ``unfilled_required`` 查询。

``auto_fill`` 自动组合也使用同一套确定性规则：按槽位顺序，在"类型匹配且前置
依赖均已在更早槽位出现"的候选单元中，取 ``(版本号降序, id 字典序升序)`` 的
第一名。因此同一目标、同一素材库重复组合，必然得到完全相同的素材序列。

增量重算
========
每个素材版本有稳定指纹 ``(group, version, id)``。素材被改写或新增版本后，只把
"直接或间接引用它"的目标标记为脏；查询时仅重算脏目标，且重算函数是关于
（目标定义、选择集合、当前素材库）的纯函数，所以增量结果与从头重新组合逐字节
一致。未受影响的槽位其解析结果也保持不变（槽位解析相互独立）。
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, FrozenSet, List, Optional, Tuple

from .errors import (
    CyclicDependencyError,
    DanglingReferenceError,
    DuplicateIdError,
    SlotConflictError,
    SlotFillError,
    UnknownGoalError,
    UnknownUnitError,
    ValidationError,
)
from .model import (
    ChosenUnit,
    ConflictRecord,
    GoalSequence,
    MaterialUnit,
    NarrativeGoal,
    SequenceEntry,
    Slot,
    SlotResolution,
    UnitReference,
)

DEFAULT_SOURCE = "manual"
AUTO_SOURCE = "auto"

# (槽位索引, 来源) -> 单元 id；保留每个来源在每个槽位的独立选择。
SlotKey = Tuple[int, str]


class Composer:
    """素材与叙事目标的编排器。

    用法::

        c = Composer()
        c.register_unit(MaterialUnit("setup", "scene", "开端", 1))
        c.register_unit(MaterialUnit("duel", "scene", "决斗", 1, {"setup"}))
        c.register_goal(NarrativeGoal("g1", "新观众", [Slot("s1", "scene")]))
        c.fill_slot("g1", "s1", "setup", source="editor")
        c.get_sequence("g1")
    """

    def __init__(self):
        self._units: Dict[str, MaterialUnit] = {}
        self._goals: Dict[str, NarrativeGoal] = {}
        # goal_id -> {(slot_index, source): unit_id}
        self._selections: Dict[str, Dict[SlotKey, str]] = {}
        # goal_id -> {slot_index: SlotResolution}
        self._cache: Dict[str, Dict[int, SlotResolution]] = {}
        # goal_id -> {slot_index: 输入指纹}；指纹不变的槽位直接复用旧解析结果
        self._slot_sig: Dict[str, Dict[int, tuple]] = {}
        self._dirty: Dict[str, bool] = {}
        # 仅用于观测与测试：记录每次实际重算的目标
        self.recompose_log: List[str] = []

    # ------------------------------------------------------------------ #
    # 素材单元
    # ------------------------------------------------------------------ #

    def register_unit(self, unit: MaterialUnit) -> None:
        """注册一个新素材单元。id 已存在时拒绝（改写请用 ``update_unit``）。

        - 前置依赖引用了不存在的单元：拒绝并指出具体位置。
        - 依赖成环：拒绝并给出环路径。
        """
        if not isinstance(unit, MaterialUnit):
            raise ValidationError("register_unit 只接受 MaterialUnit 实例")
        if unit.unit_id in self._units:
            raise DuplicateIdError(
                f"素材单元 id '{unit.unit_id}' 已存在；"
                f"改写既有素材请使用 update_unit()",
                where=f"素材 '{unit.unit_id}'",
                unit_id=unit.unit_id,
            )
        self._put_unit(unit, is_overwrite=False)

    def update_unit(self, unit: MaterialUnit) -> None:
        """改写既有素材单元（相同 id，可改正文/版本/依赖等）。

        - 单元必须已存在（新增请用 ``register_unit``）。
        - 若改写会破坏任何故事线中已成立的编排（类型不再匹配 /
          新前置依赖无法满足），拒绝改写并指出位置，状态保持不变。
        - 改写成功后仅重算直接或间接引用它的目标。
        """
        if not isinstance(unit, MaterialUnit):
            raise ValidationError("update_unit 只接受 MaterialUnit 实例")
        if unit.unit_id not in self._units:
            raise UnknownUnitError(
                f"素材单元 '{unit.unit_id}' 不存在，无法改写；"
                f"新增请使用 register_unit()"
            )
        self._put_unit(unit, is_overwrite=True)

    def _put_unit(self, unit: MaterialUnit, *, is_overwrite: bool) -> None:
        new_units = dict(self._units)
        new_units[unit.unit_id] = unit

        # 1) 悬空引用：依赖必须存在（逐个指出位置）
        for i, dep in enumerate(sorted(unit.prerequisites)):
            if dep not in new_units:
                raise DanglingReferenceError(
                    f"素材 '{unit.unit_id}' 引用了不存在的素材单元 '{dep}'",
                    where=f"素材 '{unit.unit_id}' 的前置依赖[{i}]（"
                    f"prerequisites 中的 '{dep}'）",
                    unit_id=unit.unit_id,
                    dependency=dep,
                )

        # 2) 成环检测（在假定写入后的整张图上做，确定性遍历）
        cycle = _find_cycle(new_units, start=unit.unit_id)
        if cycle is not None:
            raise CyclicDependencyError(
                "素材前置依赖不允许成环",
                cycle=cycle,
                where=f"素材 '{unit.unit_id}' 的前置依赖",
                unit_id=unit.unit_id,
            )

        # 3) 改写时，重新校验所有会受影响的既有编排
        affected_unit_ids = self._affected_unit_ids(unit.unit_id, new_units)
        if is_overwrite:
            affected_goals = self._goals_affected_by_units(
                affected_unit_ids, new_units
            )
            self._revalidate_goals(affected_goals, new_units, changed=unit.unit_id)

        # 全部通过，提交
        self._units = new_units
        for g in self._goals_affected_by_units(affected_unit_ids, new_units):
            self._dirty[g] = True

    def remove_unit(self, unit_id: str) -> None:
        """删除素材单元。

        若它仍被其他单元声明为前置依赖，或仍被任何故事线引用，则拒绝删除
        （避免产生悬空引用），并列出引用位置。
        """
        if unit_id not in self._units:
            raise UnknownUnitError(f"素材单元 '{unit_id}' 不存在")

        depended_by = sorted(
            u.unit_id for u in self._units.values() if unit_id in u.prerequisites
        )
        if depended_by:
            raise ValidationError(
                f"素材 '{unit_id}' 仍被 {len(depended_by)} 个素材声明为前置依赖："
                f"{', '.join(depended_by)}，请先解除依赖",
                where=f"素材 {', '.join(depended_by)} 的 prerequisites",
                unit_id=unit_id,
            )

        used_in = self._selection_locations_referencing(unit_id)
        if used_in:
            desc = "; ".join(
                f"目标 '{g}' 槽位 '{s}'（来源 '{src}'）" for g, s, src in used_in
            )
            raise ValidationError(
                f"素材 '{unit_id}' 仍被故事线引用：{desc}",
                unit_id=unit_id,
            )

        affected = self._affected_unit_ids(unit_id, self._units)
        del self._units[unit_id]
        for g in self._goals_affected_by_units(affected, self._units):
            self._dirty[g] = True

    def get_unit(self, unit_id: str) -> MaterialUnit:
        try:
            return self._units[unit_id]
        except KeyError:
            raise UnknownUnitError(f"素材单元 '{unit_id}' 不存在")

    def all_units(self) -> Tuple[MaterialUnit, ...]:
        """按 id 字典序返回全部素材单元（稳定顺序）。"""
        return tuple(sorted(self._units.values(), key=lambda u: u.unit_id))

    def _affected_unit_ids(
        self, changed_id: str, units: Dict[str, MaterialUnit]
    ) -> FrozenSet[str]:
        """变更可能影响到的全部单元：自身 + 传递依赖于它的单元。"""
        # 反向邻接：被依赖者 -> 依赖者列表
        reverse: Dict[str, List[str]] = defaultdict(list)
        for uid, u in units.items():
            for dep in u.prerequisites:
                reverse[dep].append(uid)
        affected = {changed_id}
        stack = [changed_id]
        while stack:
            cur = stack.pop()
            for dependent in reverse.get(cur, ()):  # 反向依赖者
                if dependent not in affected:
                    affected.add(dependent)
                    stack.append(dependent)
        return frozenset(affected)

    def _goals_affected_by_units(
        self, unit_ids: FrozenSet[str], units: Dict[str, MaterialUnit]
    ) -> List[str]:
        """直接选择了 unit_ids 中任一单元的目标（按 id 字典序）。

        unit_ids 通常是"被改写单元 + 传递依赖于它的单元"的闭包。
        """
        return sorted({
            g
            for g, sels in self._selections.items()
            if any(uid in unit_ids for uid in sels.values())
        })

    def _revalidate_goals(
        self,
        goal_ids: List[str],
        units: Dict[str, MaterialUnit],
        *,
        changed: str,
    ) -> None:
        """用假定的新素材库，重新校验这些目标中的每一条选择。

        这里对受影响目标采取保守的全量重校验（该目标至少有一条选择落在被改
        单元的反向依赖闭包内）。未被波及的目标无需检查；被波及目标中与改动
        无关的选择在新库下仍然合法，因此全量校验不会误报，却能以简单的方式
        覆盖所有传递性影响。
        """
        for goal_id in sorted(goal_ids):
            goal = self._goals[goal_id]
            sels = self._selections[goal_id]
            for (idx, source), uid in sorted(sels.items()):
                unit = units.get(uid)
                if unit is None:
                    continue
                slot = goal.slots[idx]
                try:
                    self._check_placement(goal, idx, slot, unit, sels, units)
                except SlotFillError as err:
                    # 改写会破坏既有编排：连同目标/槽位/来源一起抛出
                    err.source = source
                    raise ValidationError(
                        f"改写素材 '{changed}' 将破坏既有编排：{err}",
                        where=f"目标 '{goal_id}' 槽位 '{slot.slot_id}'"
                        f"（来源 '{source}'）",
                        unit_id=uid,
                        goal_id=goal_id,
                        slot_id=slot.slot_id,
                        source=source,
                        dependency=err.missing_dependency,
                    )

    def _selection_locations_referencing(
        self, unit_id: str
    ) -> List[Tuple[str, str, str]]:
        out = []
        for g in sorted(self._selections):
            goal = self._goals[g]
            for (idx, source), uid in self._selections[g].items():
                if uid == unit_id:
                    out.append((g, goal.slots[idx].slot_id, source))
        out.sort()
        return out

    # ------------------------------------------------------------------ #
    # 叙事目标
    # ------------------------------------------------------------------ #

    def register_goal(self, goal: NarrativeGoal) -> None:
        """注册叙事目标；重复注册（改写）时校验既有选择在新配置下仍合法。"""
        if not isinstance(goal, NarrativeGoal):
            raise ValidationError("register_goal 只接受 NarrativeGoal 实例")

        new_selections: Optional[Dict[SlotKey, str]] = None
        if goal.goal_id in self._goals:
            old = self._goals[goal.goal_id]
            new_index = {s.slot_id: i for i, s in enumerate(goal.slots)}
            # 槽位允许重排，按槽位 id 把既有选择映射到新索引
            remapped: Dict[SlotKey, str] = {}
            for (old_idx, source), uid in self._selections[goal.goal_id].items():
                old_slot = old.slots[old_idx]
                if old_slot.slot_id not in new_index:
                    raise ValidationError(
                        f"目标 '{goal.goal_id}' 的改写删除了仍有素材的槽位 "
                        f"'{old_slot.slot_id}'，请先清空该槽位",
                        goal_id=goal.goal_id,
                        slot_id=old_slot.slot_id,
                        source=source,
                    )
                new_idx = new_index[old_slot.slot_id]
                new_slot = goal.slots[new_idx]
                if new_slot.required_type != old_slot.required_type:
                    raise ValidationError(
                        f"目标 '{goal.goal_id}' 的槽位 '{old_slot.slot_id}' "
                        f"所需类型不可由 '{old_slot.required_type}' 改为 "
                        f"'{new_slot.required_type}'（槽位中已有素材）",
                        goal_id=goal.goal_id,
                        slot_id=old_slot.slot_id,
                        source=source,
                    )
                remapped[(new_idx, source)] = uid
            # 用新配置（顺序可能已变）全量重校验
            for (idx, source), uid in sorted(remapped.items()):
                try:
                    self._check_placement(
                        goal, idx, goal.slots[idx], self._units[uid],
                        remapped, self._units,
                    )
                except SlotFillError as err:
                    err.source = source
                    raise
            new_selections = remapped

        self._goals[goal.goal_id] = goal
        if new_selections is not None:
            self._selections[goal.goal_id] = new_selections
        else:
            self._selections.setdefault(goal.goal_id, {})
        self._dirty[goal.goal_id] = True

    def remove_goal(self, goal_id: str) -> None:
        if goal_id not in self._goals:
            raise UnknownGoalError(f"叙事目标 '{goal_id}' 不存在")
        del self._goals[goal_id]
        self._selections.pop(goal_id, None)
        self._cache.pop(goal_id, None)
        self._slot_sig.pop(goal_id, None)
        self._dirty.pop(goal_id, None)

    def get_goal(self, goal_id: str) -> NarrativeGoal:
        try:
            return self._goals[goal_id]
        except KeyError:
            raise UnknownGoalError(f"叙事目标 '{goal_id}' 不存在")

    def all_goals(self) -> Tuple[NarrativeGoal, ...]:
        """按 id 字典序返回全部叙事目标（稳定顺序）。"""
        return tuple(sorted(self._goals.values(), key=lambda g: g.goal_id))

    # ------------------------------------------------------------------ #
    # 填入素材 / 清空 / 自动组合
    # ------------------------------------------------------------------ #

    def fill_slot(
        self,
        goal_id: str,
        slot_id: str,
        unit_id: str,
        source: str = DEFAULT_SOURCE,
    ) -> None:
        """把素材填入某目标的某槽位。

        校验：目标/槽位/素材存在、类型匹配、前置依赖已在更早槽位满足。
        - 同一来源在同一槽位改填不同素材：拒绝（SlotConflictError）。
        - 不同来源在同一槽位给出不同组素材：不拒绝，双方保留并生成冲突记录。
        - 不同来源给出同组替代版本：不拒绝，按版本规则确定性消解。
        """
        goal = self.get_goal(goal_id)
        idx = self._slot_index(goal, slot_id)
        unit = self._units.get(unit_id)
        if unit is None:
            raise DanglingReferenceError(
                f"槽位 '{slot_id}' 引用了不存在的素材单元 '{unit_id}'",
                where=f"目标 '{goal_id}' 槽位 '{slot_id}'（来源 '{source}'）",
                goal_id=goal_id,
                slot_id=slot_id,
                source=source,
                dependency=unit_id,
            )
        slot = goal.slots[idx]
        sels = self._selections[goal_id]
        self._check_placement(goal, idx, slot, unit, sels, self._units)

        key = (idx, source)
        existing = sels.get(key)
        if existing is not None and existing != unit_id:
            raise SlotConflictError(
                "同一来源在同一槽位给出了不同素材",
                goal_id=goal_id,
                slot_id=slot_id,
                source=source,
                existing_unit_id=existing,
                incoming_unit_id=unit_id,
            )
        if existing != unit_id:
            sels[key] = unit_id
            self._dirty[goal_id] = True

    def clear_slot(
        self,
        goal_id: str,
        slot_id: str,
        source: Optional[str] = None,
        cascade: bool = False,
    ) -> List[str]:
        """撤销某来源在槽位上的选择；source=None 表示清空该槽位全部来源。

        若清空后更后槽位的前置依赖将无处满足，默认拒绝；cascade=True 时
        连带清空那些失去依赖的槽位选择（按槽位顺序传递），返回被清空的槽位 id。
        """
        goal = self.get_goal(goal_id)
        idx = self._slot_index(goal, slot_id)
        sels = self._selections[goal_id]

        if source is None:
            removed_keys = [k for k in sels if k[0] == idx]
        else:
            removed_keys = [(idx, source)] if (idx, source) in sels else []
        if not removed_keys:
            return []

        def groups_at(index, selections):
            return {
                self._units[uid].group
                for (i, _src), uid in selections.items()
                if i == index and uid in self._units
            }

        lost_groups = groups_at(idx, sels)
        trial = dict(sels)
        for k in removed_keys:
            trial.pop(k, None)
        lost_groups -= groups_at(idx, trial)

        # 从紧邻的后槽位向后扫描：依赖组只存在于被移除集合中的选择会失效，
        # 失效槽位贡献的组同样计入丢失集合，使级联按槽位顺序向后传递。
        cascade_indices: List[int] = []
        for j in range(idx + 1, len(goal.slots)):
            earlier_groups = {
                self._units[uid].group
                for (i, _s), uid in trial.items()
                if i < j and uid in self._units
            }
            broken_keys = [
                k
                for k in trial
                if k[0] == j
                and any(
                    self._units[d].group in lost_groups
                    and self._units[d].group not in earlier_groups
                    for d in self._units[trial[k]].prerequisites
                )
            ]
            if broken_keys:
                if not cascade:
                    raise SlotFillError(
                        "清空该槽位会使后续槽位的前置依赖无法满足；"
                        "如需连带清空请置 cascade=True",
                        goal_id=goal_id,
                        slot_id=goal.slots[j].slot_id,
                    )
                lost_groups |= {self._units[trial[k]].group for k in broken_keys}
                for k in broken_keys:
                    del trial[k]
                cascade_indices.append(j)

        changed = False
        for k in removed_keys + [
            k for j in cascade_indices for k in list(sels) if k[0] == j
        ]:
            if k in sels:
                del sels[k]
                changed = True
        if changed:
            self._dirty[goal_id] = True
        return [slot_id] + [goal.slots[j].slot_id for j in cascade_indices]

    def auto_fill(
        self,
        goal_id: str,
        source: str = AUTO_SOURCE,
        only_empty: bool = True,
    ) -> List[str]:
        """按确定性规则为目标自动组合素材。

        按槽位顺序处理；跳过已有任何来源选择的槽位（only_empty=True）。
        候选必须类型匹配、前置依赖已在更早槽位出现；排序键为
        ``(版本号降序, 单元 id 字典序升序)``。返回实际填入的槽位 id 列表。
        """
        goal = self.get_goal(goal_id)
        sels = self._selections[goal_id]
        filled: List[str] = []
        for idx, slot in enumerate(goal.slots):
            if only_empty and any(i == idx for i, _s in sels):
                continue
            earlier_groups = {
                self._units[uid].group
                for (i, _s), uid in sels.items()
                if i < idx and uid in self._units
            }
            candidates = [
                u
                for u in self._units.values()
                if u.unit_type == slot.required_type
                and all(
                    self._units[d].group in earlier_groups for d in u.prerequisites
                )
            ]
            if not candidates:
                continue
            best = sorted(candidates, key=lambda u: (-u.version, u.unit_id))[0]
            self.fill_slot(goal_id, slot.slot_id, best.unit_id, source=source)
            filled.append(slot.slot_id)
        return filled

    # ------------------------------------------------------------------ #
    # 解析 / 查询
    # ------------------------------------------------------------------ #

    def get_sequence(self, goal_id: str) -> GoalSequence:
        """返回目标当前的素材序列（必要时只重算该目标）。

        冲突槽位与未填槽位的 unit_id 为 None；用 get_slot_resolution /
        conflicts 查看被保留的矛盾双方。
        """
        goal = self.get_goal(goal_id)
        resolutions = self._ensure_resolved(goal_id)
        entries = []
        for idx, slot in enumerate(goal.slots):
            r = resolutions[idx]
            entries.append(
                SequenceEntry(
                    position=idx,
                    slot_id=slot.slot_id,
                    required_type=slot.required_type,
                    required=slot.required,
                    unit_id=r.chosen.unit_id if r.chosen else None,
                    version=r.chosen.version if r.chosen else None,
                    sources=r.sources,
                )
            )
        return GoalSequence(
            goal_id=goal.goal_id, audience=goal.audience, entries=tuple(entries)
        )

    def get_slot_resolution(self, goal_id: str, slot_id: str) -> SlotResolution:
        goal = self.get_goal(goal_id)
        idx = self._slot_index(goal, slot_id)
        return self._ensure_resolved(goal_id)[idx]

    def slot_sources(
        self, goal_id: str, slot_id: str
    ) -> Tuple[Tuple[Source, str, int], ...]:
        """返回某槽位上各来源给出的原始选择 ``(来源, 单元 id, 版本号)``。

        按来源名字典序排列；冲突双方可由此完整查看，不被最终入选结果掩盖。
        """
        goal = self.get_goal(goal_id)
        idx = self._slot_index(goal, slot_id)
        sels = self._selections[goal_id]
        out = [
            (src, uid, self._units[uid].version)
            for (_i, src), uid in sels.items()
            if _i == idx
        ]
        out.sort(key=lambda t: (t[0], t[1]))
        return tuple(out)

    def conflicts(self, goal_id: Optional[str] = None) -> List[ConflictRecord]:
        """返回全部未解决冲突，按 (目标 id, 槽位顺序) 稳定排列。"""
        if goal_id is not None:
            self.get_goal(goal_id)
            goals = [goal_id]
        else:
            goals = sorted(self._goals)
        out: List[ConflictRecord] = []
        for g in goals:
            resolutions = self._ensure_resolved(g)
            for idx in sorted(resolutions):
                r = resolutions[idx]
                if r.conflict is not None:
                    out.append(r.conflict)
        return out

    def references(self, unit_id: str) -> List[UnitReference]:
        """返回某素材被哪些目标/槽位/来源引用，按稳定顺序排列。

        effective=True 表示该引用当前真正入选（其版本赢得同组竞争）；
        False 表示它处于版本竞争落败或冲突保留状态。
        """
        if unit_id not in self._units:
            raise UnknownUnitError(f"素材单元 '{unit_id}' 不存在")
        out: List[UnitReference] = []
        for g in sorted(self._goals):
            goal = self._goals[g]
            resolutions = self._ensure_resolved(g)
            for (idx, source), uid in sorted(self._selections[g].items()):
                if uid != unit_id:
                    continue
                r = resolutions[idx]
                effective = r.chosen is not None and r.chosen.unit_id == unit_id
                out.append(
                    UnitReference(
                        goal_id=g,
                        slot_id=goal.slots[idx].slot_id,
                        source=source,
                        unit_id=uid,
                        version=self._units[uid].version,
                        effective=effective,
                    )
                )
        return out

    def referencing_goals(self, unit_id: str) -> List[str]:
        """返回直接引用某素材的目标 id（字典序）。"""
        if unit_id not in self._units:
            raise UnknownUnitError(f"素材单元 '{unit_id}' 不存在")
        return sorted(
            g
            for g, sels in self._selections.items()
            if unit_id in sels.values()
        )

    def referenced_units(self) -> List[Tuple[str, Tuple[str, ...]]]:
        """返回被一个及以上目标引用的素材列表。

        结果为 ``(单元 id, 引用它的目标 id 元组)``，单元与目标均按字典序排列。
        """
        ref: Dict[str, set] = defaultdict(set)
        for g, sels in self._selections.items():
            for uid in sels.values():
                ref[uid].add(g)
        return [(uid, tuple(sorted(gs))) for uid, gs in sorted(ref.items())]

    def unfilled_required(self, goal_id: str) -> List[str]:
        """返回必填但当前没有一致入选素材的槽位 id（含未填与冲突槽位）。"""
        goal = self.get_goal(goal_id)
        resolutions = self._ensure_resolved(goal_id)
        return [
            slot.slot_id
            for idx, slot in enumerate(goal.slots)
            if slot.required and resolutions[idx].chosen is None
        ]

    def recompose_goal(self, goal_id: str) -> None:
        """强制立即重算某目标（一般无需手动调用，查询会自动按需重算）。"""
        self.get_goal(goal_id)
        self._recompose(goal_id)

    def recompose_all(self) -> None:
        """强制从头重算全部目标（主要用于校验/对账）。"""
        for g in sorted(self._goals):
            self._recompose(g)

    def reset_recompose_log(self) -> None:
        self.recompose_log = []

    # ------------------------------------------------------------------ #
    # 内部实现
    # ------------------------------------------------------------------ #

    def _slot_index(self, goal: NarrativeGoal, slot_id: str) -> int:
        try:
            return goal.slot_index(slot_id)
        except KeyError:
            raise ValidationError(
                f"目标 '{goal.goal_id}' 不存在槽位 '{slot_id}'",
                goal_id=goal.goal_id,
                slot_id=slot_id,
            )

    def _check_placement(
        self,
        goal: NarrativeGoal,
        idx: int,
        slot: Slot,
        unit: MaterialUnit,
        sels: Dict[SlotKey, str],
        units: Dict[str, MaterialUnit],
    ) -> None:
        """类型匹配 + 前置依赖已在更早槽位满足；失败一律拒绝并定位。"""
        if unit.unit_type != slot.required_type:
            raise SlotFillError(
                f"素材类型不匹配：素材为 '{unit.unit_type}'，"
                f"槽位要求 '{slot.required_type}'",
                goal_id=goal.goal_id,
                slot_id=slot.slot_id,
                unit_id=unit.unit_id,
            )

        earlier_groups = {
            units[uid].group
            for (i, _src), uid in sels.items()
            if i < idx and uid in units
        }
        for dep in sorted(unit.prerequisites):
            if units[dep].group not in earlier_groups:
                raise SlotFillError(
                    "前置依赖未满足",
                    goal_id=goal.goal_id,
                    slot_id=slot.slot_id,
                    unit_id=unit.unit_id,
                    missing_dependency=dep,
                )

    def _ensure_resolved(self, goal_id: str) -> Dict[int, SlotResolution]:
        if self._dirty.get(goal_id, True) or goal_id not in self._cache:
            self._recompose(goal_id)
        return self._cache[goal_id]

    def _recompose(self, goal_id: str) -> None:
        """对单个目标执行纯函数式重算。

        槽位之间相互独立：输入指纹（槽位定义 + 各来源选择及其版本指纹）不变
        的槽位直接复用上一次的解析结果对象——未受影响的段落连结果都不会变。
        """
        goal = self._goals[goal_id]
        sels = self._selections[goal_id]
        old_cache = self._cache.get(goal_id, {})
        old_sig = self._slot_sig.get(goal_id, {})
        resolutions: Dict[int, SlotResolution] = {}
        new_sig: Dict[int, tuple] = {}
        for idx, slot in enumerate(goal.slots):
            picked_sig = tuple(
                sorted(
                    (src, uid, self._units[uid].fingerprint)
                    for (i, src), uid in sels.items()
                    if i == idx
                )
            )
            sig = (
                slot.slot_id,
                slot.required_type,
                slot.required,
                picked_sig,
            )
            new_sig[idx] = sig
            if idx in old_cache and old_sig.get(idx) == sig:
                resolutions[idx] = old_cache[idx]
                continue

            picked = [
                ChosenUnit(
                    unit_id=uid,
                    version=self._units[uid].version,
                    group=self._units[uid].group,
                    source=src,
                )
                for (i, src), uid in sels.items()
                if i == idx
            ]
            picked.sort(key=lambda c: (c.source, c.unit_id))
            groups = {c.group for c in picked}
            chosen = None
            conflict = None
            sources = tuple(sorted({c.source for c in picked}))
            if len(groups) == 1:
                # 同组替代版本：版本号降序，同分按 id 字典序升序
                chosen = sorted(picked, key=lambda c: (-c.version, c.unit_id))[0]
            elif len(groups) > 1:
                conflict = ConflictRecord(
                    goal_id=goal_id,
                    slot_id=slot.slot_id,
                    choices=tuple(picked),
                )
            resolutions[idx] = SlotResolution(
                slot_id=slot.slot_id,
                required_type=slot.required_type,
                required=slot.required,
                position=idx,
                choices=tuple(picked),
                sources=sources,
                chosen=chosen,
                conflict=conflict,
            )
        self._cache[goal_id] = resolutions
        self._slot_sig[goal_id] = new_sig
        self._dirty[goal_id] = False
        self.recompose_log.append(goal_id)


def _find_cycle(
    units: Dict[str, MaterialUnit], start: Optional[str] = None
) -> Optional[List[str]]:
    """在依赖图上做确定性 DFS；若有环返回形如 [a, b, ..., a] 的环路径。"""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = {uid: WHITE for uid in units}
    stack: List[str] = []

    def dfs(node: str) -> Optional[List[str]]:
        color[node] = GRAY
        stack.append(node)
        for dep in sorted(units[node].prerequisites):
            if dep not in units:
                continue  # 悬空引用已在调用方单独校验
            if color[dep] == GRAY:
                cyc_start = stack.index(dep)
                return stack[cyc_start:] + [dep]
            if color[dep] == WHITE:
                found = dfs(dep)
                if found is not None:
                    return found
        stack.pop()
        color[node] = BLACK
        return None

    # 先从新写入的单元开始（多数环由它引入），再按字典序补查全图
    order = ([start] if start in units else []) + sorted(units)
    for uid in order:
        if color[uid] == WHITE:
            found = dfs(uid)
            if found is not None:
                return found
    return None
