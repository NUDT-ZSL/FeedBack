"""JSON 持久化：保存货物、车厢、不可用区域、装载方案与编排记录。

载入时做完整校验（标识唯一、尺寸合法、无重叠、不超载、支撑与堆叠
合法），任何错误都抛 PersistenceError；所有对象先在临时状态中构建，
全部通过后才返回新的 LoadingSystem，因此失败不会产生半成品状态。
"""

import json
import os
import tempfile

from .errors import PersistenceError
from .geometry import overlap
from .models import Cargo, Vehicle, Placement, LoadPlan, oriented_dims
from .planner import VehicleState, cargo_sort_key
from .system import LoadingSystem

FORMAT = "loading-plan"
VERSION = 1


def save_to_file(system, path):
    """原子写入：先写临时文件再替换，避免半截文件。"""
    data = {
        "format": FORMAT,
        "version": VERSION,
        "cargos": [c.to_dict() for c in system.list_cargos()],
        "vehicles": [v.to_dict() for v in system.list_vehicles()],
        "plan": None,
        "records": list(system.records),
        "seq": system._seq,
    }
    if system.plan is not None:
        data["plan"] = {
            vid: [p.to_dict() for p in system.plan.placements.get(vid, [])]
            for vid in sorted(system.plan.placements)
        }
    directory = os.path.dirname(os.path.abspath(path))
    fd, tmp = tempfile.mkstemp(suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def load_from_file(path):
    """从 JSON 文件载入并完整校验，返回新的 LoadingSystem。"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        raise PersistenceError(f"文件不存在: {path}")
    except json.JSONDecodeError as exc:
        raise PersistenceError(
            f"JSON 解析失败（第 {exc.lineno} 行第 {exc.colno} 列）: {exc.msg}"
        )
    except OSError as exc:
        raise PersistenceError(f"文件无法读取: {exc}")

    return _build_system(data)


def _require(data, key, where, types):
    if key not in data:
        raise PersistenceError(f"缺少必填字段 {key!r}（位置: {where}）")
    if not isinstance(data[key], types):
        raise PersistenceError(
            f"字段 {key!r} 类型错误（位置: {where}）"
        )
    return data[key]


def _build_system(data):
    if not isinstance(data, dict):
        raise PersistenceError("顶层结构必须是 JSON 对象")
    fmt = _require(data, "format", "$", str)
    if fmt != FORMAT:
        raise PersistenceError(f"文件格式标识错误: {fmt!r}，应为 {FORMAT!r}")

    cargos_raw = _require(data, "cargos", "$", list)
    vehicles_raw = _require(data, "vehicles", "$", list)
    records_raw = data.get("records", [])
    if not isinstance(records_raw, list):
        raise PersistenceError("字段 'records' 必须是数组（位置: $.records）")

    # 1) 货物
    cargos = {}
    for i, raw in enumerate(cargos_raw):
        try:
            c = Cargo.from_dict(raw, prefix=f"$.cargos[{i}]")
        except Exception as exc:
            raise PersistenceError(f"货物定义非法: {exc}")
        if c.id in cargos:
            raise PersistenceError(
                f"货物标识重复: {c.id}（位置: $.cargos[{i}]）"
            )
        cargos[c.id] = c

    # 2) 车厢（构造时校验尺寸与不可用区域）
    vehicles = {}
    for i, raw in enumerate(vehicles_raw):
        try:
            v = Vehicle.from_dict(raw, prefix=f"$.vehicles[{i}]")
        except Exception as exc:
            raise PersistenceError(f"车厢定义非法: {exc}")
        if v.id in vehicles:
            raise PersistenceError(
                f"车厢标识重复: {v.id}（位置: $.vehicles[{i}]）"
            )
        vehicles[v.id] = v

    # 3) 方案校验
    plan = None
    plan_raw = data.get("plan")
    if plan_raw is not None:
        plan = _build_and_verify_plan(plan_raw, cargos, vehicles)

    # 4) 记录轻量校验
    records = []
    for i, rec in enumerate(records_raw):
        where = f"$.records[{i}]"
        if not isinstance(rec, dict):
            raise PersistenceError(f"编排记录必须是对象（位置: {where}）")
        for key in ("seq", "action", "changed_cargos", "affected_vehicles"):
            if key not in rec:
                raise PersistenceError(f"记录缺少字段 {key!r}（位置: {where}）")
        if not isinstance(rec["seq"], int) or isinstance(rec["seq"], bool):
            raise PersistenceError(f"记录 seq 必须是整数（位置: {where}）")
        records.append(
            {
                "seq": rec["seq"],
                "action": str(rec["action"]),
                "changed_cargos": list(rec["changed_cargos"]),
                "affected_vehicles": list(rec["affected_vehicles"]),
                "replanned": bool(rec.get("replanned", True)),
            }
        )

    system = LoadingSystem()
    system.cargos = cargos
    system.vehicles = vehicles
    system.plan = plan
    system.records = records
    system._seq = data.get("seq", len(records))
    if not isinstance(system._seq, int):
        raise PersistenceError("字段 'seq' 必须是整数（位置: $.seq）")
    return system


def _build_and_verify_plan(plan_raw, cargos, vehicles):
    """重放方案：逐件货物校验位置/朝向/重叠/载重/支撑/堆叠。"""
    if not isinstance(plan_raw, dict):
        raise PersistenceError("字段 'plan' 必须是对象（位置: $.plan）")

    entries = []  # (cargo, vehicle_id, Placement)
    seen = set()
    for vid, plist in plan_raw.items():
        where = f"$.plan[{vid!r}]"
        if vid not in vehicles:
            raise PersistenceError(f"方案引用了不存在的车厢: {vid}（位置: {where}）")
        if not isinstance(plist, list):
            raise PersistenceError(f"车厢方案必须是数组（位置: {where}）")
        for i, raw in enumerate(plist):
            pwhere = f"{where}[{i}]"
            if not isinstance(raw, dict):
                raise PersistenceError(f"放置记录必须是对象（位置: {pwhere}）")
            cid = raw.get("cargo")
            if cid not in cargos:
                raise PersistenceError(
                    f"放置记录引用了不存在的货物: {cid!r}（位置: {pwhere}）"
                )
            if cid in seen:
                raise PersistenceError(
                    f"货物 {cid} 被重复装载（位置: {pwhere}）"
                )
            seen.add(cid)
            try:
                orient = tuple(raw["orientation"])
                x, y, z = raw["x"], raw["y"], raw["z"]
            except KeyError as exc:
                raise PersistenceError(
                    f"放置记录缺少字段 {exc.args[0]!r}（位置: {pwhere}）"
                )
            except TypeError:
                raise PersistenceError(
                    f"朝向必须是长度为 3 的数组（位置: {pwhere}）"
                )
            valid_orient = (
                len(orient) == 3
                and all(isinstance(a, int) and not isinstance(a, bool) for a in orient)
                and sorted(orient) == [0, 1, 2]
            )
            if not valid_orient:
                raise PersistenceError(
                    f"朝向必须是 (0,1,2) 的一个排列，实际为 {list(orient)}"
                    f"（位置: {pwhere}）"
                )
            for coord in ("x", "y", "z"):
                val = raw[coord]
                if not isinstance(val, (int, float)) or isinstance(val, bool) \
                        or val != val or val in (float("inf"), float("-inf")):
                    raise PersistenceError(
                        f"坐标 {coord} 必须是有限数字，实际为 {val!r}"
                        f"（位置: {pwhere}）"
                    )
                if val < 0:
                    raise PersistenceError(
                        f"坐标 {coord} 不能为负，实际为 {val}（位置: {pwhere}）"
                    )
            cargo = cargos[cid]
            dx, dy, dz = oriented_dims(cargo.dims, orient)
            placement = Placement(
                cargo_id=cid,
                vehicle_id=vid,
                x=x,
                y=y,
                z=z,
                dx=dx,
                dy=dy,
                dz=dz,
                orientation=orient,
            )
            entries.append((cargo, vid, placement))

    missing = sorted(set(cargos) - seen)
    if missing:
        raise PersistenceError(
            f"方案不完整，以下货物未被装载: {', '.join(missing)}"
        )

    # 按全局货物顺序重放（方案文件中的列表顺序即提交顺序）
    states = {vid: VehicleState(v) for vid, v in vehicles.items()}
    result = {vid: [] for vid in vehicles}
    entries.sort(key=lambda t: cargo_sort_key(t[0]))
    for cargo, vid, placement in entries:
        state = states[vid]
        ok, reason, info = state.check_placement(cargo, placement)
        if not ok:
            if reason == "weight":
                detail = "超过车厢最大载重"
            elif reason == "stack":
                level, other, direction = info
                if direction == "below":
                    detail = f"在第 {level} 层超过货物 {other} 的可堆叠层数"
                else:
                    detail = (f"其上方第 {level} 层已有货物 {other}，"
                              f"超过该货物自身的可堆叠层数")
            else:
                detail = "与车厢边界、不可用区域或其他货物冲突（空间/支撑不合法）"
            raise PersistenceError(
                f"方案校验失败：货物 {cargo.id} 在车厢 {vid} 的放置非法——{detail}"
            )
        state.commit(cargo, placement)
        # 层号以重放计算为准
        computed_level = state.items[-1][2]
        placement = Placement(
            cargo_id=placement.cargo_id,
            vehicle_id=placement.vehicle_id,
            x=placement.x,
            y=placement.y,
            z=placement.z,
            dx=placement.dx,
            dy=placement.dy,
            dz=placement.dz,
            orientation=placement.orientation,
            level=computed_level,
        )
        result[vid].append(placement)

    # 不可用区域之间/货物之间重叠已在重放中保证；再做一次跨货物显式核对
    for vid, state in states.items():
        boxes = [b for b, _c, _l in state.items]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                if overlap(boxes[i], boxes[j]):
                    raise PersistenceError(
                        f"方案校验失败：车厢 {vid} 内存在货物重叠"
                    )
    return LoadPlan(result)
