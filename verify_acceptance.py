"""本轮缺陷修复的离线验收脚本：python verify_acceptance.py

1) 堆叠超限被拒绝，并指出是哪一层、哪个货物超限；
2) 同一批货物按不同到达顺序编排，方案完全一致；
3) 对同一初始方案施加不同变更顺序，每一步增量结果都与从头全量
   重排“逐车厢”一致（含未受影响车厢不变）。
"""

import copy
import random

from loading import Cargo, LoadingError, LoadingSystem, StackRuleError, Vehicle
from loading.geometry import Box


def per_vehicle(sy):
    out = {}
    for vid in sorted(sy.vehicles):
        out[vid] = sorted(
            (p.cargo_id, round(p.x, 9), round(p.y, 9), round(p.z, 9),
             tuple(p.orientation), p.level)
            for p in sy.plan.placements.get(vid, []))
    return out


def full_of(sy):
    f = LoadingSystem()
    for v in sy.list_vehicles():
        f.add_vehicle(copy.deepcopy(v))
    for c in sy.list_cargos():
        f.add_cargo(copy.deepcopy(c))
    f.plan_all()
    return per_vehicle(f)


# ---------------------------------------------------------------- 1
def check_stack_layer():
    print("[1] 堆叠累计层数：非直接相邻也要计入，报错定位层与货物")
    s = LoadingSystem()
    s.add_vehicle(Vehicle("V", 2, 2, 8, max_weight=10000))
    s.add_cargo(Cargo("BASE", 2, 2, 2, 1, stack_limit=1))  # 只允许上方 1 层
    s.add_cargo(Cargo("MID", 2, 2, 2, 1, stack_limit=2))
    s.add_cargo(Cargo("TOP", 2, 2, 2, 1, stack_limit=2))
    try:
        s.plan_all()
        raise SystemExit("  FAIL：应当被拒绝")
    except StackRuleError as e:
        assert e.level == 3, e.level
        assert "BASE" in str(e)
        print(f"    已拒绝：{e}（层号={e.level}，超限货物=BASE）")


# ---------------------------------------------------------------- 2
def check_arrival_orders():
    print("[2] 同一批货物、不同到达顺序 -> 方案完全一致")
    rng = random.Random(2026)
    pool = [
        Cargo(f"C{i:02d}", rng.choice([1, 2, 3]), rng.choice([1, 2, 3]),
              rng.choice([1, 2, 3]), weight=rng.choice([50, 200, 600]),
              stack_limit=rng.choice([0, 1, 2]))
        for i in range(18)
    ]
    vehicles = [Vehicle("VA", 8, 6, 5, 3000), Vehicle("VB", 6, 6, 5, 2500),
                Vehicle("VC", 5, 5, 4, 2000)]

    def build(order):
        sy = LoadingSystem()
        for v in vehicles:
            sy.add_vehicle(copy.deepcopy(v))
        for idx in order:
            sy.add_cargo(copy.deepcopy(pool[idx]))
        sy.plan_all()
        return sy

    base = per_vehicle(build(list(range(18))))
    order_rng = random.Random(7)
    for t in range(20):
        order = list(range(18))
        order_rng.shuffle(order)
        assert per_vehicle(build(order)) == base, f"第 {t} 次打乱不一致"
    print("    20 种到达顺序逐车厢完全一致 OK")


# ---------------------------------------------------------------- 3
def check_change_orders():
    print("[3] 不同变更顺序：每一步增量结果 == 从头全量（逐车厢）")

    def base_system():
        sy = LoadingSystem()
        sy.add_vehicle(Vehicle("VA", 10, 4, 3, 4000))
        sy.add_vehicle(Vehicle("VB", 8, 4, 3, 3000))
        sy.add_vehicle(Vehicle("VC", 6, 4, 3, 2500))
        rng = random.Random(99)
        for i in range(16):
            sy.add_cargo(Cargo(
                f"C{i:02d}", rng.choice([1, 2, 3]), rng.choice([1, 2, 3]),
                rng.choice([1, 2, 3]), weight=rng.choice([50, 200, 500]),
                stack_limit=rng.choice([0, 1, 2])))
        sy.plan_all()
        return sy

    def add_n1(sy):
        if "N1" not in sy.cargos:
            sy.add_cargo(Cargo("N1", 2, 2, 2, weight=150, stack_limit=1))

    def add_n2(sy):
        if "N2" not in sy.cargos:
            sy.add_cargo(Cargo("N2", 3, 1, 2, weight=300, stack_limit=0))

    def add_n3(sy):
        if "N3" not in sy.cargos:
            sy.add_cargo(Cargo("N3", 1, 1, 1, weight=50))

    def remove_c03(sy):
        if "C03" in sy.cargos:
            sy.remove_cargo("C03")

    def remove_c10(sy):
        if "C10" in sy.cargos:
            sy.remove_cargo("C10")

    def block_vb(sy):
        v = sy.vehicles["VB"]
        sy.update_vehicle(Vehicle("VB", v.length, v.width, v.height,
                                  v.max_weight, blocked=(Box(0, 0, 0, 2, 4, 3),)))

    def unblock_vb(sy):
        v = sy.vehicles["VB"]
        sy.update_vehicle(Vehicle("VB", v.length, v.width, v.height,
                                  v.max_weight, blocked=()))

    def shrink_va(sy):
        v = sy.vehicles["VA"]
        sy.update_vehicle(Vehicle("VA", v.length - 1, v.width, v.height,
                                  v.max_weight, blocked=v.blocked))

    ops = [add_n1, add_n2, add_n3, remove_c03, remove_c10,
           block_vb, unblock_vb, shrink_va]
    seq_rng = random.Random(31)
    orders = [ops, list(reversed(ops)),
              [ops[i] for i in [6, 0, 3, 5, 1, 7, 4, 2]]]
    for _ in range(7):
        o = ops[:]
        seq_rng.shuffle(o)
        orders.append(o)

    total_steps = 0
    for k, order in enumerate(orders):
        sy = base_system()
        for op in order:
            before = per_vehicle(sy)
            try:
                op(sy)
            except LoadingError:
                assert per_vehicle(sy) == before, "被拒变更未完全回滚"
                continue
            assert per_vehicle(sy) == full_of(sy), \
                f"变更序列 {k} 后增量与全量不一致"
            total_steps += 1
    print(f"    {len(orders)} 种变更顺序、{total_steps} 个被接受变更，"
          f"逐车厢全部与全量一致 OK")


if __name__ == "__main__":
    check_stack_layer()
    check_arrival_orders()
    check_change_orders()
    print("\n全部验收通过。")
