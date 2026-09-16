"""确定性装载规划器。

装填规则（每节车厢独立维护状态）：
  * 货物按 (体积降序, id 升序) 排序；车厢按 id 升序尝试，与到达顺序无关；
  * 每件货物依次尝试各车厢，第一个能合法放入的车厢即落点（跨车厢改派）；
  * 车厢内按六个轴对齐朝向、extreme-point 候选点枚举，取
    (z, x, y, 朝向序号) 最小的合法位置；
  * 合法位置必须：在车厢内部、不与不可用区域/货物重叠、不超载、
    底面被完全支撑（地板或下方盒顶）、满足堆叠限制。

堆叠语义：货物 b 的 stack_limit 是其【正上方允许的累计层数】。
新货物所在层为 L、直接支持者 b 所在层为 Lb 时，要求
L - Lb <= b.stack_limit，否则该位置在第 L 层被拒绝。易碎货物
stack_limit 恒为 0，其上方永远无法放货。
"""

from .errors import PlacementError, StackRuleError, ValidationError
from .geometry import Box, overlap, candidate_positions
from .models import ORIENTATIONS, Placement, oriented_dims

_EPS = 1e-9

_WEIGHT = "weight"
_STACK = "stack"
_SPACE = "space"


def _eq(a, b):
    return abs(a - b) <= _EPS


def _le(a, b):
    return a <= b + _EPS


def _ge(a, b):
    return a >= b - _EPS


def _footprint_covered(x, y, dx, dy, supporters):
    """支持者盒（顶面已对齐）的 xy 投影是否完整覆盖 [x,x+dx]×[y,y+dy]。

    坐标压缩：按所有相关 x 边界切条带，每个条带内检查横跨条带的
    矩形其 y 区间是否无缝覆盖整个底边。
    """
    xs = {x, x + dx}
    relevant = []
    for b in supporters:
        bx2, by2 = b.x + b.dx, b.y + b.dy
        if _le(bx2, x) or _ge(b.x, x + dx) or _le(by2, y) or _ge(b.y, y + dy):
            continue
        relevant.append(b)
        if b.x > x:
            xs.add(b.x)
        if bx2 < x + dx:
            xs.add(bx2)
    coords = sorted(xs)
    for lo, hi in zip(coords, coords[1:]):
        if hi - lo <= _EPS:
            continue
        y_intervals = []
        for b in relevant:
            if _le(b.x, lo) and _ge(b.x + b.dx, hi):
                y_intervals.append((max(b.y, y), min(b.y + b.dy, y + dy)))
        if not y_intervals:
            return False
        y_intervals.sort()
        cursor = y
        for ay, by in y_intervals:
            if ay > cursor + _EPS:
                return False
            cursor = max(cursor, by)
        if cursor < y + dy - _EPS:
            return False
    return True


class VehicleState:
    """一节车厢装填过程中的可变状态（全量/增量/载入校验共用）。"""

    def __init__(self, vehicle):
        self.vehicle = vehicle
        self.items = []  # list[(Box, cargo_id, level)]
        self.weight = 0.0
        self.stack_limits = {}  # cargo_id -> stack_limit

    # -- 基础评估 ----------------------------------------------------------

    def evaluate(self, cargo, box):
        """评估 cargo 以 box 姿态放入本车厢是否合法。

        返回 (ok, reason, info)：
          成功：(True, None, level)
          失败：(False, "weight"/"space"/"stack", 附加信息)
                stack 时 info=(level, 被超限货物id)。
        """
        v = self.vehicle
        # 载重
        if self.weight + cargo.weight > v.max_weight + _EPS:
            return False, _WEIGHT, None
        # 车厢内部
        if (box.x < -_EPS or box.y < -_EPS or box.z < -_EPS
                or box.x + box.dx > v.length + _EPS
                or box.y + box.dy > v.width + _EPS
                or box.z + box.dz > v.height + _EPS):
            return False, _SPACE, None
        # 不与不可用区域重叠
        for b in v.blocked:
            if overlap(box, b):
                return False, _SPACE, None
        # 不与已装货物重叠
        for b, _cid, _lvl in self.items:
            if overlap(box, b):
                return False, _SPACE, None
        # 支撑面：顶面与 box.z 齐平且 xy 投影相交的盒（含地板、不可用区域）
        supporters = []
        if _eq(box.z, 0):
            supporters.append(Box(0, 0, 0, v.length, v.width, 0))
        item_supporters = []
        for b, cid, lvl in self.items:
            if _eq(b.z + b.dz, box.z):
                supporters.append(b)
                item_supporters.append((b, cid, lvl))
        for b in v.blocked:
            if _eq(b.z + b.dz, box.z):
                supporters.append(b)
        if not _footprint_covered(box.x, box.y, box.dx, box.dy, supporters):
            return False, _SPACE, None
        # 堆叠限制：
        #  (a) 下方累计——投影柱内任何位于候选盒下方（直接或非直接相邻，
        #      xy 投影相交即计入，不要求顶底齐平）的货物 b，要求
        #      L - Lb <= b.stack_limit；易碎货物 b 的 limit 恒为 0。
        #  (b) 上方累计——候选盒可能被塞进已有悬挑/桥接板的下方
        #      （增量重排时高处货物先保留、低处货物后决策即可出现）。
        #      沿“顶面=底面且投影相交”的直接支撑边，求候选盒向上能到达
        #      的最长层数，要求 <= 候选货物自身 stack_limit（易碎品为 0，
        #      即其投影柱内一旦还压有任何货物即拒绝）。
        level = 1 + max((lvl for _b, _c, lvl in item_supporters), default=0)

        def xy_intersects(a, b):
            return (
                a.x + a.dx > b.x + _EPS
                and a.x < b.x + b.dx - _EPS
                and a.y + a.dy > b.y + _EPS
                and a.y < b.y + b.dy - _EPS
            )

        #  (a) 向下：投影柱累计；info=(超限层, 超限货物id, "below")
        for b, cid, lvl in self.items:
            if not _le(b.z + b.dz, box.z):
                continue
            if xy_intersects(b, box) and \
                    level - lvl > self.stack_limits.get(cid, 0) + _EPS:
                return False, _STACK, (level, cid, "below")

        # (b) 向上：候选盒 -> 已有货物的直接支撑图最长路径（按 z 自下而上）
        # info=(超限层, 超限货物id, "above")
        nodes = self.items
        above = [None] * len(nodes)
        for j, (jb, _jc, _jl) in enumerate(nodes):
            if _eq(box.z + box.dz, jb.z) and xy_intersects(box, jb):
                above[j] = 1
        for j in sorted(range(len(nodes)), key=lambda k: nodes[k][0].z):
            if above[j] is None:
                continue
            jb = nodes[j][0]
            for k, (kb, _kc, kl) in enumerate(nodes):
                if k == j:
                    continue
                if _eq(jb.z + jb.dz, kb.z) and xy_intersects(jb, kb):
                    above[k] = max(above[k] or 0, above[j] + 1)
        for j, (_b, _cid, lvl) in enumerate(nodes):
            if above[j] is not None and above[j] > cargo.stack_limit + _EPS:
                return False, _STACK, (lvl, cargo.id, "above")
        return True, None, level

    # -- 枚举最佳位置 ------------------------------------------------------

    def try_place(self, cargo):
        """枚举朝向/候选点，返回 (Placement|None, reason, level)。"""
        v = self.vehicle
        occupied = [b for b, _c, _l in self.items]
        candidates = sorted(candidate_positions(occupied + list(v.blocked)))

        best = None
        stack_block = None  # (level, 被压货物id)
        saw_weight_block = False

        seen_dims = set()
        for oi, orient in enumerate(ORIENTATIONS):
            dx, dy, dz = oriented_dims(cargo.dims, orient)
            dim_key = (round(dx, 9), round(dy, 9), round(dz, 9))
            if dim_key in seen_dims:
                continue
            seen_dims.add(dim_key)
            for px, py, pz in candidates:
                box = Box(px, py, pz, dx, dy, dz)
                ok, reason, info = self.evaluate(cargo, box)
                if ok:
                    level = info
                    score = (pz, px, py, oi)
                    if best is None or score < best[0]:
                        best = (
                            score,
                            Placement(
                                cargo_id=cargo.id,
                                vehicle_id=v.id,
                                x=px,
                                y=py,
                                z=pz,
                                dx=dx,
                                dy=dy,
                                dz=dz,
                                orientation=orient,
                                level=level,
                            ),
                        )
                elif reason == _STACK:
                    if stack_block is None or info[0] > stack_block[0]:
                        stack_block = info
                elif reason == _WEIGHT:
                    saw_weight_block = True
        if best is not None:
            return best[1], None, None
        if stack_block is not None:
            return None, _STACK, stack_block
        if saw_weight_block:
            return None, _WEIGHT, None
        return None, _SPACE, None

    # -- 提交与校验 --------------------------------------------------------

    def commit(self, cargo, placement):
        self.items.append((placement.box, cargo.id, placement.level))
        self.weight += cargo.weight
        self.stack_limits[cargo.id] = cargo.stack_limit

    def check_placement(self, cargo, placement):
        """校验给定 placement 在当前状态下合法（不提交）。"""
        ok, reason, info = self.evaluate(cargo, placement.box)
        return ok, reason, info


def cargo_sort_key(cargo):
    """体积降序、id 升序：确定性，与输入/到达顺序无关。"""
    return (-cargo.volume, cargo.id)


def _assert_unique(values, kind, location):
    ids = [getattr(x, "id") for x in values]
    if len(set(ids)) != len(ids):
        dup = sorted({i for i in ids if ids.count(i) > 1})
        raise ValidationError(f"{kind}标识重复: {', '.join(dup)}", location)


def try_vehicles(cargo, vehicles, states):
    """按 vehicles 给定顺序逐车厢尝试，成功提交。

    返回 (vehicle_id, placement, None)；全部失败返回
    (None, None, [(vehicle_id, reason, info), ...])。
    """
    failures = []
    for v in vehicles:
        state = states[v.id]
        placement, reason, info = state.try_place(cargo)
        if placement is not None:
            state.commit(cargo, placement)
            return v.id, placement, None
        failures.append((v.id, reason, info))
    return None, None, failures


def _raise_if_unplaceable(cargo, failures):
    # 优先报告堆叠违规（需求 4：指出超限层与超限货物）
    for vid, reason, info in failures:
        if reason == _STACK:
            level, other_id, direction = info
            if direction == "below":
                message = (
                    f"货物 {cargo.id} 无法装载：放入车厢 {vid} 时将压在货物 "
                    f"{other_id} 上方达到第 {level} 层，超过货物 {other_id} "
                    f"的可堆叠层数"
                )
            else:
                message = (
                    f"货物 {cargo.id} 无法装载：放入车厢 {vid} 后，其上方第 "
                    f"{level} 层已有货物 {other_id}，超过货物 {cargo.id} "
                    f"自身的可堆叠层数"
                    + ("（易碎货物上方不得压货）" if cargo.fragile else "")
                )
            raise StackRuleError(message, level=level)
    if all(reason == _WEIGHT for _vid, reason, _info in failures):
        raise PlacementError(
            f"货物 {cargo.id} 无法装载：各车厢剩余载重均不足"
        )
    detail = "；".join(
        f"车厢 {vid}: {'载重不足' if reason == _WEIGHT else '无合法空间'}"
        for vid, reason, _info in failures
    )
    raise PlacementError(f"货物 {cargo.id} 无法装入任何车厢（{detail}）")


def plan_loading(cargos, vehicles):
    """对整批货物做确定性全量装载，返回 {vehicle_id: [Placement...]}。"""
    _assert_unique(cargos, "货物", "cargo")
    _assert_unique(vehicles, "车厢", "vehicle")
    ordered_vehicles = sorted(vehicles, key=lambda v: v.id)
    states = {v.id: VehicleState(v) for v in ordered_vehicles}
    result = {v.id: [] for v in ordered_vehicles}

    for cargo in sorted(cargos, key=cargo_sort_key):
        vid, placement, failures = try_vehicles(cargo, ordered_vehicles, states)
        if vid is None:
            _raise_if_unplaceable(cargo, failures)
        result[vid].append(placement)
    return result


def plan_incremental(cargos, vehicles, old_index, changed_cargo_ids,
                     affected_vehicle_ids):
    """增量装载：只重排受影响车厢，结果与全量 plan_loading 完全一致。

    参数：
      cargos: 当前全部货物（dict id->Cargo）
      vehicles: 当前全部车厢（dict id->Vehicle）
      old_index: 旧方案 cargo_id -> Placement
      changed_cargo_ids: 新增/属性变化的货物 id 集合
      affected_vehicle_ids: 初始受影响车厢（blocked 变化车厢、
                            被改/被删货物的原车厢）

    算法（货物按全局顺序逐个处理，归纳保证与全量方案同刻状态相同）：
      * 变更货物、旧车厢受影响或已删除的货物：在全部车厢上重决策；
      * 其余货物：先按序试探旧车厢之前的各车厢——若某车厢能接收，
        说明全量方案此刻也会把它放进更早的车厢（容量释放后的"吸入"），
        随之把旧车厢与新车厢都标记为受影响；都不能接收时，旧位置在
        归纳相同的状态下仍合法，原样保留（未受影响车厢装载不变）。

    返回 (result, affected_set)。失败时抛错且不修改外部状态。
    """
    ordered_vehicles = sorted(vehicles.values(), key=lambda v: v.id)
    states = {v.id: VehicleState(v) for v in ordered_vehicles}
    result = {v.id: [] for v in ordered_vehicles}
    affected = set(affected_vehicle_ids)
    changed = set(changed_cargo_ids)

    for cargo in sorted(cargos.values(), key=cargo_sort_key):
        oldp = old_index.get(cargo.id)
        old_vid = oldp.vehicle_id if oldp is not None else None
        full_redecide = (
            cargo.id in changed
            or oldp is None
            or old_vid not in states
            or old_vid in affected
        )

        if not full_redecide:
            # 先看是否会被更早（容量已释放）的车厢吸入
            earlier = [v for v in ordered_vehicles if v.id < old_vid]
            vid, placement, _ = try_vehicles(cargo, earlier, states)
            if vid is not None:
                result[vid].append(placement)
                affected.add(vid)
                affected.add(old_vid)
                continue
            # 否则旧位置在当前（与全量归纳相同的）状态下仍合法，原样保留
            ok, _r, _i = states[old_vid].check_placement(cargo, oldp)
            if ok:
                states[old_vid].commit(cargo, oldp)
                result[old_vid].append(oldp)
                continue
            # 兜底：理论上不应发生（支撑货物变化等），转入全量重决策
            affected.add(old_vid)

        vid, placement, failures = try_vehicles(cargo, ordered_vehicles, states)
        if vid is None:
            _raise_if_unplaceable(cargo, failures)
        result[vid].append(placement)
        affected.add(vid)
        if old_vid is not None and old_vid != vid:
            affected.add(old_vid)
    return result, affected
