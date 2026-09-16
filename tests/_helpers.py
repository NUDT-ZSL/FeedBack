"""测试共用工具：装载方案不变量校验与快照。"""

from loading.geometry import overlap


def plan_snapshot(system):
    """整个方案的可比较快照（与返回顺序无关，只含稳定事实）。"""
    return sorted(
        (
            p.cargo_id,
            p.vehicle_id,
            round(p.x, 9),
            round(p.y, 9),
            round(p.z, 9),
            tuple(p.orientation),
            p.level,
        )
        for p in system.all_placements()
    )


def vehicle_placements(system, vid):
    return sorted(
        (p.cargo_id, round(p.x, 9), round(p.y, 9), round(p.z, 9), p.level)
        for p in system.plan.placements[vid]
    )


def assert_plan_valid(testcase, system):
    """校验需求 2/4/5 的全部物理不变量。"""
    cargos, vehicles = system.cargos, system.vehicles
    seen = set()
    total_weight = {vid: 0.0 for vid in vehicles}

    testcase.assertIsNotNone(system.plan)
    for p in system.all_placements():
        c = cargos[p.cargo_id]
        v = vehicles[p.vehicle_id]
        testcase.assertNotIn(p.cargo_id, seen)  # 无重复装载
        seen.add(p.cargo_id)
        total_weight[p.vehicle_id] += c.weight

        # 在车厢内部
        testcase.assertTrue(p.x >= -1e-9 and p.y >= -1e-9 and p.z >= -1e-9)
        testcase.assertTrue(p.x + p.dx <= v.length + 1e-9)
        testcase.assertTrue(p.y + p.dy <= v.width + 1e-9)
        testcase.assertTrue(p.z + p.dz <= v.height + 1e-9)

        # 不与不可用区域重叠
        for b in v.blocked:
            testcase.assertFalse(overlap(p.box, b),
                                 f"{p.cargo_id} 与不可用区域重叠")

        # 易碎货物上方无货
        if c.fragile:
            for q in system.plan.placements[p.vehicle_id]:
                if q is p:
                    continue
                above = (
                    q.z >= p.z + p.dz - 1e-9
                    and q.x < p.x + p.dx - 1e-9
                    and q.x + q.dx > p.x + 1e-9
                    and q.y < p.y + p.dy - 1e-9
                    and q.y + q.dy > p.y + 1e-9
                )
                testcase.assertFalse(above, f"易碎货物 {c.id} 上方有货")

    # 货物两两不重叠
    for vid in vehicles:
        boxes = [(p.box, p.cargo_id) for p in system.plan.placements[vid]]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                testcase.assertFalse(
                    overlap(boxes[i][0], boxes[j][0]),
                    f"{boxes[i][1]} 与 {boxes[j][1]} 在 {vid} 内重叠",
                )

    # 不超载重；每件货物都被装载
    for vid, w in total_weight.items():
        testcase.assertLessEqual(w, vehicles[vid].max_weight + 1e-9)
    testcase.assertEqual(seen, set(cargos))

    # 堆叠累计层数限制
    for vid in vehicles:
        plist = system.plan.placements[vid]
        for top in plist:
            tc = cargos[top.cargo_id]
            for low in plist:
                if low is top or low.z + low.dz > top.z + 1e-9:
                    continue
                lc = cargos[low.cargo_id]
                column = (
                    low.x + low.dx > top.x + 1e-9
                    and low.x < top.x + top.dx - 1e-9
                    and low.y + low.dy > top.y + 1e-9
                    and low.y < top.y + top.dy - 1e-9
                )
                if column:
                    testcase.assertLessEqual(
                        top.level - low.level,
                        lc.stack_limit,
                        f"{lc.id} 上方累计层数超限",
                    )


def full_replan_snapshot(system):
    """用相同货物/车厢从头全量编排，返回其快照。"""
    import copy
    from loading import LoadingSystem

    fresh = LoadingSystem()
    for v in system.list_vehicles():
        fresh.add_vehicle(copy.deepcopy(v))
    for c in system.list_cargos():
        fresh.add_cargo(copy.deepcopy(c))
    fresh.plan_all()
    return plan_snapshot(fresh)
