"""装载编排系统：维护货物/车厢，提供全量与增量编排、查询、变更记录。

变更（增删改货物或车厢）后自动做增量重排：只重排受影响车厢，
结果与从头全量编排完全一致；变更失败时系统状态保持不变。
"""

import copy

from .errors import LoadingError
from .models import LoadPlan
from .planner import plan_loading, plan_incremental


class LoadingSystem:
    def __init__(self):
        self.cargos = {}        # id -> Cargo
        self.vehicles = {}      # id -> Vehicle
        self.plan = None        # LoadPlan 或 None（尚未编排）
        self.records = []       # 编排记录（稳定、可序列化）
        self._seq = 0

    # ------------------------------------------------------------------ #
    # 货物维护（需求 1）
    # ------------------------------------------------------------------ #
    def add_cargo(self, cargo):
        if cargo.id in self.cargos:
            raise LoadingError(f"货物标识 {cargo.id} 已存在")
        self._atomic(
            lambda: self.cargos.__setitem__(cargo.id, cargo),
            action="add_cargo",
            changed={cargo.id},
            affected=set(),
        )

    def update_cargo(self, cargo):
        if cargo.id not in self.cargos:
            raise LoadingError(f"货物 {cargo.id} 不存在，无法更新")
        old_vid = self._vehicle_of(cargo.id)
        affected = {old_vid} if old_vid is not None else set()

        def mutate():
            self.cargos[cargo.id] = cargo

        self._atomic(mutate, "update_cargo", {cargo.id}, affected)

    def remove_cargo(self, cargo_id):
        if cargo_id not in self.cargos:
            raise LoadingError(f"货物 {cargo_id} 不存在，无法删除")
        old_vid = self._vehicle_of(cargo_id)
        affected = {old_vid} if old_vid is not None else set()

        def mutate():
            del self.cargos[cargo_id]

        self._atomic(mutate, "remove_cargo", set(), affected)

    # ------------------------------------------------------------------ #
    # 车厢维护（需求 2）
    # ------------------------------------------------------------------ #
    def add_vehicle(self, vehicle):
        if vehicle.id in self.vehicles:
            raise LoadingError(f"车厢标识 {vehicle.id} 已存在")

        def mutate():
            self.vehicles[vehicle.id] = vehicle

        self._atomic(mutate, "add_vehicle", set(), set())

    def update_vehicle(self, vehicle):
        """更新车厢（含不可用区域变化）；该车装载整体重排。"""
        if vehicle.id not in self.vehicles:
            raise LoadingError(f"车厢 {vehicle.id} 不存在，无法更新")

        def mutate():
            self.vehicles[vehicle.id] = vehicle

        self._atomic(mutate, "update_vehicle", set(), {vehicle.id})

    def remove_vehicle(self, vehicle_id):
        if vehicle_id not in self.vehicles:
            raise LoadingError(f"车厢 {vehicle_id} 不存在，无法删除")

        def mutate():
            del self.vehicles[vehicle_id]

        # 该车中的货物在增量编排时发现旧车厢已不存在，会自动改派。
        self._atomic(mutate, "remove_vehicle", set(), {vehicle_id})

    # ------------------------------------------------------------------ #
    # 编排（需求 3/5/6）
    # ------------------------------------------------------------------ #
    def plan_all(self):
        """从头全量编排，返回 LoadPlan。"""
        result = plan_loading(list(self.cargos.values()),
                              list(self.vehicles.values()))
        self.plan = LoadPlan(result)
        self._append_record("full_plan", set(), set())
        return self.plan

    def has_plan(self):
        return self.plan is not None

    def _atomic(self, mutate, action, changed, affected):
        """执行一次变更；若增量重排失败，回滚到变更前状态。"""
        if self.plan is None:
            mutate()
            self._append_record(action, changed, affected, planned=False)
            return None
        snapshot = copy.deepcopy((self.cargos, self.vehicles, self.plan))
        try:
            mutate()
            result, affected_set = plan_incremental(
                self.cargos,
                self.vehicles,
                self.plan.cargo_index(),
                changed,
                affected,
            )
            self.plan = LoadPlan(result)
            self._append_record(action, changed, affected_set)
            return affected_set
        except BaseException:
            self.cargos, self.vehicles, self.plan = snapshot
            raise

    def _append_record(self, action, changed, affected, planned=True):
        self._seq += 1
        self.records.append(
            {
                "seq": self._seq,
                "action": action,
                "changed_cargos": sorted(changed),
                "affected_vehicles": sorted(affected),
                "replanned": planned,
            }
        )

    def _vehicle_of(self, cargo_id):
        if self.plan is None:
            return None
        p = self.plan.cargo_index().get(cargo_id)
        return p.vehicle_id if p else None

    # ------------------------------------------------------------------ #
    # 查询（需求 7，全部按稳定顺序返回）
    # ------------------------------------------------------------------ #
    def list_cargos(self):
        return [self.cargos[i] for i in sorted(self.cargos)]

    def list_vehicles(self):
        return [self.vehicles[i] for i in sorted(self.vehicles)]

    def _sorted_placements(self, vid):
        plist = self.plan.placements.get(vid, []) if self.plan else []
        return sorted(plist, key=lambda p: (p.level, p.z, p.x, p.y, p.cargo_id))

    def vehicle_details(self, vehicle_id):
        """返回某车厢的装载明细、载重/空间占用与利用率。"""
        if vehicle_id not in self.vehicles:
            raise LoadingError(f"车厢 {vehicle_id} 不存在")
        v = self.vehicles[vehicle_id]
        items = []
        used_weight = 0.0
        used_volume = 0.0
        for p in self._sorted_placements(vehicle_id):
            cargo = self.cargos[p.cargo_id]
            used_weight += cargo.weight
            used_volume += p.dx * p.dy * p.dz
            items.append(
                {
                    "cargo_id": cargo.id,
                    "level": p.level,
                    "x": p.x,
                    "y": p.y,
                    "z": p.z,
                    "length": p.dx,
                    "width": p.dy,
                    "height": p.dz,
                    "orientation": tuple(p.orientation),
                    "weight": cargo.weight,
                    "fragile": cargo.fragile,
                }
            )
        usable = v.usable_volume
        return {
            "vehicle_id": v.id,
            "items": items,
            "used_weight": used_weight,
            "remaining_weight": v.max_weight - used_weight,
            "max_weight": v.max_weight,
            "used_volume": used_volume,
            "remaining_volume": usable - used_volume,
            "usable_volume": usable,
            "interior_volume": v.interior_volume,
            "blocked_volume": v.interior_volume - usable,
            "space_utilization": (used_volume / usable) if usable > 0 else 0.0,
            "weight_utilization": (
                used_weight / v.max_weight if v.max_weight > 0 else 0.0
            ),
        }

    def all_vehicle_details(self):
        return [self.vehicle_details(vid) for vid in sorted(self.vehicles)]

    def locate_cargo(self, cargo_id):
        """返回货物所在车厢与坐标；未装载/不存在返回 None。"""
        if cargo_id not in self.cargos:
            raise LoadingError(f"货物 {cargo_id} 不存在")
        if self.plan is None:
            return None
        p = self.plan.cargo_index().get(cargo_id)
        if p is None:
            return None
        return {
            "cargo_id": cargo_id,
            "vehicle_id": p.vehicle_id,
            "x": p.x,
            "y": p.y,
            "z": p.z,
            "level": p.level,
            "orientation": tuple(p.orientation),
        }

    def all_placements(self):
        """全车厢装载明细，按 (车厢, 层, z, x, y, 货物id) 稳定排序。"""
        out = []
        for vid in sorted(self.vehicles):
            out.extend(self._sorted_placements(vid))
        return out

    def loaded_cargo_ids(self):
        if self.plan is None:
            return []
        return sorted(self.plan.cargo_index().keys())
